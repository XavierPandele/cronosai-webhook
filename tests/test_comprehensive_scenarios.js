#!/usr/bin/env node

/**
 * SCRIPT DE TEST EXHAUSTIVO PARA TWILIO WEBHOOK
 * 
 * Este script prueba el sistema al límite con múltiples escenarios:
 * - Creación de reservas (normal, edge cases, errores)
 * - Modificación de reservas
 * - Cancelación de reservas
 * - Pedidos
 * - Diferentes idiomas
 * - Casos límite y errores
 * - Flujos interrumpidos
 * 
 * Uso: node tests/test_comprehensive_scenarios.js [--local|--remote] [--verbose]
 */

// Cargar variables de entorno desde .env (necesario para tests locales)
require('dotenv').config();

const handler = require('../api/twilio-call-gemini');
const querystring = require('querystring');

// Colores para output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

// Estadísticas globales
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: 0,
  warnings: 0
};

// Helper para loggear
function log(color, icon, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  console.log(`${color}${icon} [${timestamp}]${COLORS.reset} ${message}`);
  if (data && process.argv.includes('--verbose')) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// Helper para crear request mock
function createMockRequest(callSid, speechResult = '', digits = '', from = '+34600123456', additionalParams = {}) {
  const params = {
    CallSid: callSid,
    From: from,
    To: '+34600999888',
    CallStatus: 'in-progress',
    SpeechResult: speechResult,
    Digits: digits,
    Direction: 'inbound',
    AccountSid: 'AC_test_account',
    ApiVersion: '2010-04-01',
    ...additionalParams
  };

  // El handler puede recibir body como string o como objeto parseado
  // Para los tests, lo pasamos como objeto directamente para simular Vercel
  return {
    method: 'POST',
    url: '/api/twilio-call-gemini',
    body: params, // Objeto directamente (como lo parsea Vercel)
    query: {},
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    }
  };
}

// Helper para crear response mock
function createMockResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: '',
    sent: false,
    setHeader: function(name, value) {
      this.headers[name] = value;
    },
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    send: function(data) {
      this.body = data;
      this.sent = true;
      return this;
    }
  };
  return response;
}

// Helper para parsear TwiML y extraer información
function parseTwiML(xml) {
  if (!xml || typeof xml !== 'string') return null;
  
  const result = {
    message: null,
    gather: false,
    redirect: null,
    say: null,
    play: null,
    pause: null,
    hangup: false
  };

  // Extraer mensaje de <Say>
  const sayMatch = xml.match(/<Say[^>]*>(.*?)<\/Say>/s);
  if (sayMatch) {
    result.say = sayMatch[1].trim();
    result.message = result.say;
  }

  // Verificar si hay <Gather>
  result.gather = /<Gather[^>]*>/i.test(xml);

  // Verificar si hay <Redirect>
  const redirectMatch = xml.match(/<Redirect[^>]*>(.*?)<\/Redirect>/s);
  if (redirectMatch) {
    result.redirect = redirectMatch[1].trim();
  }

  // Verificar si hay <Hangup>
  result.hangup = /<Hangup[^>]*>/i.test(xml);

  return result;
}

// Función para ejecutar un test
async function runTest(testName, testFunction, expectedResults = {}) {
  stats.total++;
  log(COLORS.cyan, '🧪', `TEST: ${testName}`);
  
  try {
    const result = await testFunction();
    
    // Validar resultados esperados
    let passed = true;
    const issues = [];

    if (expectedResults.shouldContain) {
      const contains = result.body && result.body.includes(expectedResults.shouldContain);
      if (!contains) {
        passed = false;
        issues.push(`Expected to contain: "${expectedResults.shouldContain}"`);
      }
    }

    if (expectedResults.shouldNotContain) {
      const contains = result.body && result.body.includes(expectedResults.shouldNotContain);
      if (contains) {
        passed = false;
        issues.push(`Should not contain: "${expectedResults.shouldNotContain}"`);
      }
    }

    if (expectedResults.shouldHaveGather !== undefined) {
      const twiml = parseTwiML(result.body);
      if (twiml && twiml.gather !== expectedResults.shouldHaveGather) {
        passed = false;
        issues.push(`Expected gather: ${expectedResults.shouldHaveGather}, got: ${twiml.gather}`);
      }
    }

    if (expectedResults.statusCode && result.statusCode !== expectedResults.statusCode) {
      passed = false;
      issues.push(`Expected status: ${expectedResults.statusCode}, got: ${result.statusCode}`);
    }

    if (passed) {
      stats.passed++;
      log(COLORS.green, '✅', `PASSED: ${testName}`);
      if (process.argv.includes('--verbose')) {
        const twiml = parseTwiML(result.body);
        log(COLORS.blue, '📋', `Response: ${twiml ? twiml.message?.substring(0, 100) : 'No TwiML'}`);
      }
    } else {
      stats.failed++;
      log(COLORS.red, '❌', `FAILED: ${testName}`);
      issues.forEach(issue => log(COLORS.yellow, '⚠️', `  ${issue}`));
      if (process.argv.includes('--verbose')) {
        log(COLORS.red, '📄', `Response body: ${result.body?.substring(0, 500)}`);
      }
    }

    return { passed, result, issues };
  } catch (error) {
    stats.errors++;
    stats.failed++;
    log(COLORS.red, '💥', `ERROR in ${testName}: ${error.message}`);
    if (process.argv.includes('--verbose')) {
      console.error(error.stack);
    }
    return { passed: false, error: error.message };
  }
}

// ============================================
// GRUPO 1: CREACIÓN DE RESERVAS - CASOS NORMALES
// ============================================

async function testReservationNormalFlow() {
  const callSid = `CA_reservation_normal_${Date.now()}`;
  const steps = [
    { input: 'Hola, quiero hacer una reserva', step: 'greeting' },
    { input: 'Para 4 personas', step: 'ask_people' },
    { input: 'Mañana', step: 'ask_date' },
    { input: 'A las 8 de la tarde', step: 'ask_time' },
    { input: 'Juan Pérez', step: 'ask_name' },
    { input: '666123456', step: 'ask_phone' },
    { input: 'Sí, confirmo', step: 'confirm' }
  ];

  let lastState = null;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    
    await handler(req, res);
    lastState = res;
    
    if (i < steps.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Pequeña pausa
    }
  }

  return lastState;
}

async function testReservationAllInfoAtOnce() {
  const callSid = `CA_reservation_all_info_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Quiero reservar una mesa para 6 personas mañana a las 9 de la noche, mi nombre es María García y mi teléfono es 612345678'
  );
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testReservationPartialInfo() {
  const callSid = `CA_reservation_partial_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 2 personas el viernes', step: 1 },
    { input: 'A las 2', step: 2 },
    { input: 'Pedro', step: 3 },
    { input: '666999888', step: 4 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 2: CREACIÓN DE RESERVAS - CASOS LÍMITE
// ============================================

async function testReservationMaxPeople() {
  const callSid = `CA_reservation_max_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Quiero reservar para 25 personas mañana a las 8'
  );
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testReservationMinPeople() {
  const callSid = `CA_reservation_min_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Reserva para 1 persona mañana'
  );
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testReservationInvalidDate() {
  const callSid = `CA_reservation_invalid_date_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas', step: 1 },
    { input: 'El día 32 de febrero', step: 2 }, // Fecha inválida
    { input: 'Mañana entonces', step: 3 } // Corrección
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testReservationPastDate() {
  const callSid = `CA_reservation_past_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Quiero reservar para 4 personas el día 1 de enero de 2020 a las 8'
  );
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testReservationOutOfHours() {
  const callSid = `CA_reservation_out_hours_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas mañana', step: 1 },
    { input: 'A las 3 de la madrugada', step: 2 }, // Hora fuera de horario
    { input: 'A las 8 de la noche', step: 3 } // Corrección
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testReservationTooSoon() {
  const callSid = `CA_reservation_soon_${Date.now()}`;
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const req = createMockRequest(
    callSid,
    `Reserva para 4 personas hoy ${today} a las ${now.getHours() + 1}:00`
  );
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testReservationEmptyInput() {
  const callSid = `CA_reservation_empty_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas', step: 1 },
    { input: '', step: 2 }, // Input vacío
    { input: 'Mañana', step: 3 } // Corrección
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testReservationAmbiguousInput() {
  const callSid = `CA_reservation_ambiguous_${Date.now()}`;
  const steps = [
    { input: 'Quiero algo', step: 1 }, // Ambiguo
    { input: 'Una reserva para 4 personas', step: 2 }, // Clarificación
    { input: 'Mañana', step: 3 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 3: MODIFICACIÓN DE RESERVAS
// ============================================

async function testModifyReservationFlow() {
  const callSid = `CA_modify_${Date.now()}`;
  const steps = [
    { input: 'Quiero modificar una reserva', step: 1 },
    { input: '666123456', step: 2 }, // Teléfono
    { input: 'Cambiar la fecha', step: 3 }, // Campo a modificar
    { input: 'Para pasado mañana', step: 4 }, // Nuevo valor
    { input: 'Sí, confirmo', step: 5 } // Confirmación
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testModifyReservationChangeTime() {
  const callSid = `CA_modify_time_${Date.now()}`;
  const steps = [
    { input: 'Modificar reserva', step: 1 },
    { input: '666123456', step: 2 },
    { input: 'Cambiar la hora', step: 3 },
    { input: 'A las 9 de la noche', step: 4 },
    { input: 'Confirmar', step: 5 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testModifyReservationChangePeople() {
  const callSid = `CA_modify_people_${Date.now()}`;
  const steps = [
    { input: 'Quiero cambiar mi reserva', step: 1 },
    { input: '666123456', step: 2 },
    { input: 'Cambiar el número de personas', step: 3 },
    { input: 'Para 6 personas', step: 4 },
    { input: 'Sí', step: 5 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testModifyReservationNoReservations() {
  const callSid = `CA_modify_no_res_${Date.now()}`;
  const steps = [
    { input: 'Modificar reserva', step: 1 },
    { input: '999999999', step: 2 } // Teléfono sin reservas
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 4: CANCELACIÓN DE RESERVAS
// ============================================

async function testCancelReservationFlow() {
  const callSid = `CA_cancel_${Date.now()}`;
  const steps = [
    { input: 'Quiero cancelar una reserva', step: 1 },
    { input: '666123456', step: 2 }, // Teléfono
    { input: 'La primera', step: 3 }, // Selección
    { input: 'Sí, cancelar', step: 4 } // Confirmación
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testCancelReservationMultiple() {
  const callSid = `CA_cancel_multiple_${Date.now()}`;
  const steps = [
    { input: 'Cancelar reserva', step: 1 },
    { input: '666123456', step: 2 },
    { input: 'La segunda', step: 3 }, // Si hay múltiples
    { input: 'Confirmo', step: 4 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testCancelReservationCancel() {
  const callSid = `CA_cancel_cancel_${Date.now()}`;
  const steps = [
    { input: 'Cancelar reserva', step: 1 },
    { input: '666123456', step: 2 },
    { input: 'No, mejor no', step: 3 } // Cancelar la cancelación
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 5: PEDIDOS
// ============================================

async function testOrderFlow() {
  const callSid = `CA_order_${Date.now()}`;
  const steps = [
    { input: 'Quiero hacer un pedido', step: 1 },
    { input: 'Dos pizzas y una ensalada', step: 2 },
    { input: 'Calle Mayor 1, piso 2', step: 3 },
    { input: 'Juan Pérez', step: 4 },
    { input: '666123456', step: 5 },
    { input: 'Sin cebolla', step: 6 },
    { input: 'Sí, confirmo', step: 7 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testOrderMultipleItems() {
  const callSid = `CA_order_multiple_${Date.now()}`;
  const steps = [
    { input: 'Pedido', step: 1 },
    { input: 'Tres hamburguesas, dos patatas fritas y una coca cola', step: 2 },
    { input: 'Avenida Principal 5', step: 3 },
    { input: 'María', step: 4 },
    { input: '612345678', step: 5 },
    { input: 'Confirmar', step: 6 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testOrderModifyItems() {
  const callSid = `CA_order_modify_${Date.now()}`;
  const steps = [
    { input: 'Hacer pedido', step: 1 },
    { input: 'Una pizza', step: 2 },
    { input: 'Añadir también una ensalada', step: 3 }, // Modificar pedido
    { input: 'Calle Test 1', step: 4 },
    { input: 'Test', step: 5 },
    { input: '666111222', step: 6 },
    { input: 'Confirmo', step: 7 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 6: DIFERENTES IDIOMAS
// ============================================

async function testEnglishReservation() {
  const callSid = `CA_english_${Date.now()}`;
  const steps = [
    { input: 'Hello, I want to make a reservation', step: 1 },
    { input: 'For 4 people', step: 2 },
    { input: 'Tomorrow', step: 3 },
    { input: 'At 8 PM', step: 4 },
    { input: 'John Smith', step: 5 },
    { input: '666123456', step: 6 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testGermanReservation() {
  const callSid = `CA_german_${Date.now()}`;
  const steps = [
    { input: 'Hallo, ich möchte einen Tisch reservieren', step: 1 },
    { input: 'Für 4 Personen', step: 2 },
    { input: 'Morgen', step: 3 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 7: CASOS DE ERROR Y LÍMITES
// ============================================

async function testNoCallSid() {
  const req = createMockRequest('', 'Hola');
  req.body = querystring.parse(req.body);
  delete req.body.CallSid;
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testInvalidPhoneNumber() {
  const callSid = `CA_invalid_phone_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas mañana', step: 1 },
    { input: 'A las 8', step: 2 },
    { input: 'Juan', step: 3 },
    { input: '123', step: 4 } // Teléfono inválido
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testVeryLongInput() {
  const callSid = `CA_long_input_${Date.now()}`;
  const longInput = 'Quiero hacer una reserva '.repeat(50) + 'para 4 personas mañana a las 8';
  const req = createMockRequest(callSid, longInput);
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testSpecialCharacters() {
  const callSid = `CA_special_chars_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Reserva para 4 personas mañana a las 8. Mi nombre es José-María O\'Connor & Sons'
  );
  req.body = querystring.parse(req.body);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testNumbersAsText() {
  const callSid = `CA_numbers_text_${Date.now()}`;
  const steps = [
    { input: 'Reserva para cuatro personas', step: 1 }, // Número en texto
    { input: 'Mañana', step: 2 },
    { input: 'A las ocho de la noche', step: 3 } // Hora en texto
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testRapidInputs() {
  const callSid = `CA_rapid_${Date.now()}`;
  const inputs = [
    'Reserva',
    '4 personas',
    'Mañana',
    '8 PM',
    'Juan',
    '666123456'
  ];

  let lastState = null;
  for (const input of inputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    // Sin pausa para simular inputs rápidos
  }

  return lastState;
}

async function testInterruptedFlow() {
  const callSid = `CA_interrupted_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas', step: 1 },
    { input: 'Espera, mejor para 6', step: 2 }, // Cambio de opinión
    { input: 'Mañana', step: 3 },
    { input: 'No, mejor pasado mañana', step: 4 }, // Otro cambio
    { input: 'A las 8', step: 5 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

// ============================================
// GRUPO 8: CASOS MIXTOS Y COMPLEJOS
// ============================================

async function testReservationThenCancel() {
  const callSid = `CA_res_then_cancel_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas mañana a las 8', step: 1 },
    { input: 'Juan Pérez', step: 2 },
    { input: '666123456', step: 3 },
    { input: 'Confirmar', step: 4 },
    { input: 'Espera, mejor cancelo', step: 5 }, // Cambio de intención
    { input: 'Sí, cancelar', step: 6 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return lastState;
}

async function testMultipleConversations() {
  // Simular múltiples conversaciones simultáneas
  const callSids = [
    `CA_multi_1_${Date.now()}`,
    `CA_multi_2_${Date.now()}`,
    `CA_multi_3_${Date.now()}`
  ];

  const results = [];
  for (const callSid of callSids) {
    const req = createMockRequest(callSid, 'Reserva para 2 personas mañana');
    const res = createMockResponse();
    await handler(req, res);
    results.push(res);
  }

  return results[0]; // Retornar el primero para validación
}

// ============================================
// EJECUTAR TODOS LOS TESTS
// ============================================

async function runAllTests() {
  console.log('\n' + '='.repeat(80));
  console.log(COLORS.bright + '🚀 INICIANDO TESTS EXHAUSTIVOS DEL SISTEMA' + COLORS.reset);
  console.log('='.repeat(80) + '\n');

  const startTime = Date.now();

  // GRUPO 1: Creación de reservas - Casos normales
  log(COLORS.magenta, '📋', 'GRUPO 1: Creación de Reservas - Casos Normales');
  await runTest('Reserva - Flujo Normal Completo', testReservationNormalFlow, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Toda la Info Junta', testReservationAllInfoAtOnce, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Info Parcial', testReservationPartialInfo, {
    shouldHaveGather: true
  });

  // GRUPO 2: Creación de reservas - Casos límite
  log(COLORS.magenta, '📋', 'GRUPO 2: Creación de Reservas - Casos Límite');
  await runTest('Reserva - Máximo de Personas', testReservationMaxPeople, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Mínimo de Personas', testReservationMinPeople, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Fecha Inválida', testReservationInvalidDate, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Fecha Pasada', testReservationPastDate, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Fuera de Horario', testReservationOutOfHours, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Muy Próxima', testReservationTooSoon, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Input Vacío', testReservationEmptyInput, {
    shouldHaveGather: true
  });
  await runTest('Reserva - Input Ambiguo', testReservationAmbiguousInput, {
    shouldHaveGather: true
  });

  // GRUPO 3: Modificación de reservas
  log(COLORS.magenta, '📋', 'GRUPO 3: Modificación de Reservas');
  await runTest('Modificar - Flujo Completo', testModifyReservationFlow, {
    shouldHaveGather: true
  });
  await runTest('Modificar - Cambiar Hora', testModifyReservationChangeTime, {
    shouldHaveGather: true
  });
  await runTest('Modificar - Cambiar Personas', testModifyReservationChangePeople, {
    shouldHaveGather: true
  });
  await runTest('Modificar - Sin Reservas', testModifyReservationNoReservations, {
    shouldHaveGather: true
  });

  // GRUPO 4: Cancelación de reservas
  log(COLORS.magenta, '📋', 'GRUPO 4: Cancelación de Reservas');
  await runTest('Cancelar - Flujo Completo', testCancelReservationFlow, {
    shouldHaveGather: true
  });
  await runTest('Cancelar - Múltiples Reservas', testCancelReservationMultiple, {
    shouldHaveGather: true
  });
  await runTest('Cancelar - Cancelar Cancelación', testCancelReservationCancel, {
    shouldHaveGather: true
  });

  // GRUPO 5: Pedidos
  log(COLORS.magenta, '📋', 'GRUPO 5: Pedidos');
  await runTest('Pedido - Flujo Completo', testOrderFlow, {
    shouldHaveGather: true
  });
  await runTest('Pedido - Múltiples Items', testOrderMultipleItems, {
    shouldHaveGather: true
  });
  await runTest('Pedido - Modificar Items', testOrderModifyItems, {
    shouldHaveGather: true
  });

  // GRUPO 6: Diferentes idiomas
  log(COLORS.magenta, '📋', 'GRUPO 6: Diferentes Idiomas');
  await runTest('Idioma - Inglés', testEnglishReservation, {
    shouldHaveGather: true
  });
  await runTest('Idioma - Alemán', testGermanReservation, {
    shouldHaveGather: true
  });

  // GRUPO 7: Casos de error y límites
  log(COLORS.magenta, '📋', 'GRUPO 7: Casos de Error y Límites');
  await runTest('Error - Sin CallSid', testNoCallSid, {
    statusCode: 200 // Debería manejar graciosamente
  });
  await runTest('Error - Teléfono Inválido', testInvalidPhoneNumber, {
    shouldHaveGather: true
  });
  await runTest('Error - Input Muy Largo', testVeryLongInput, {
    shouldHaveGather: true
  });
  await runTest('Error - Caracteres Especiales', testSpecialCharacters, {
    shouldHaveGather: true
  });
  await runTest('Límite - Números en Texto', testNumbersAsText, {
    shouldHaveGather: true
  });
  await runTest('Límite - Inputs Rápidos', testRapidInputs, {
    shouldHaveGather: true
  });
  await runTest('Límite - Flujo Interrumpido', testInterruptedFlow, {
    shouldHaveGather: true
  });

  // GRUPO 8: Casos mixtos y complejos
  log(COLORS.magenta, '📋', 'GRUPO 8: Casos Mixtos y Complejos');
  await runTest('Mixto - Reserva y Cancelar', testReservationThenCancel, {
    shouldHaveGather: true
  });
  await runTest('Mixto - Múltiples Conversaciones', testMultipleConversations, {
    shouldHaveGather: true
  });

  // Resumen final
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(80));
  console.log(COLORS.bright + '📊 RESUMEN DE TESTS' + COLORS.reset);
  console.log('='.repeat(80));
  console.log(`${COLORS.cyan}Total de tests:${COLORS.reset} ${stats.total}`);
  console.log(`${COLORS.green}Pasados:${COLORS.reset} ${stats.passed}`);
  console.log(`${COLORS.red}Fallidos:${COLORS.reset} ${stats.failed}`);
  console.log(`${COLORS.red}Errores:${COLORS.reset} ${stats.errors}`);
  console.log(`${COLORS.yellow}Tiempo total:${COLORS.reset} ${duration}s`);
  console.log(`${COLORS.cyan}Promedio por test:${COLORS.reset} ${(duration / stats.total).toFixed(2)}s`);
  
  const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
  console.log(`${COLORS.bright}Tasa de éxito:${COLORS.reset} ${successRate}%`);
  console.log('='.repeat(80) + '\n');

  if (stats.failed > 0 || stats.errors > 0) {
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runAllTests().catch(error => {
    console.error(COLORS.red + '💥 ERROR FATAL:' + COLORS.reset, error);
    process.exit(1);
  });
}

module.exports = { runAllTests, runTest, stats };

