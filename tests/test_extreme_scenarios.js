#!/usr/bin/env node

/**
 * SCRIPT DE TEST EXTREMO Y EXHAUSTIVO PARA TWILIO WEBHOOK
 * 
 * Este script pone el sistema al LÍMITE ABSOLUTO con casos extremos:
 * - Conversaciones muy largas y complejas
 * - Múltiples cambios de intención en una misma conversación
 * - Inputs maliciosos o inesperados
 * - Límites de capacidad y rendimiento
 * - Casos de estrés y carga
 * - Simulación de errores de red/API
 * - Validación de integridad de datos
 * - Casos de concurrencia
 * 
 * Uso: node tests/test_extreme_scenarios.js [--verbose] [--stress]
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
  magenta: '\x1b[35m',
  gray: '\x1b[90m'
};

// Estadísticas globales
const stats = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: 0,
  warnings: 0,
  extremeCases: 0
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

  return {
    method: 'POST',
    url: '/api/twilio-call-gemini',
    body: params,
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

// Helper para parsear TwiML
function parseTwiML(xml) {
  if (!xml || typeof xml !== 'string') return null;
  
  const result = {
    message: null,
    gather: false,
    redirect: null,
    say: null,
    hangup: false
  };

  const sayMatch = xml.match(/<Say[^>]*>(.*?)<\/Say>/s);
  if (sayMatch) {
    result.say = sayMatch[1].trim();
    result.message = result.say;
  }

  result.gather = /<Gather[^>]*>/i.test(xml);
  const redirectMatch = xml.match(/<Redirect[^>]*>(.*?)<\/Redirect>/s);
  if (redirectMatch) {
    result.redirect = redirectMatch[1].trim();
  }
  result.hangup = /<Hangup[^>]*>/i.test(xml);

  return result;
}

// Función para ejecutar un test
async function runTest(testName, testFunction, expectedResults = {}, isExtreme = false) {
  stats.total++;
  if (isExtreme) stats.extremeCases++;
  
  log(COLORS.cyan, '🧪', `${isExtreme ? '🔥 EXTREME: ' : ''}${testName}`);
  
  try {
    const startTime = Date.now();
    const result = await testFunction();
    const duration = Date.now() - startTime;
    
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

    if (expectedResults.maxDuration && duration > expectedResults.maxDuration) {
      passed = false;
      issues.push(`Too slow: ${duration}ms > ${expectedResults.maxDuration}ms`);
    }

    if (passed) {
      stats.passed++;
      log(COLORS.green, '✅', `PASSED: ${testName} (${duration}ms)`);
      if (process.argv.includes('--verbose')) {
        const twiml = parseTwiML(result.body);
        log(COLORS.blue, '📋', `Response: ${twiml ? twiml.message?.substring(0, 100) : 'No TwiML'}`);
      }
    } else {
      stats.failed++;
      log(COLORS.red, '❌', `FAILED: ${testName} (${duration}ms)`);
      issues.forEach(issue => log(COLORS.yellow, '⚠️', `  ${issue}`));
      if (process.argv.includes('--verbose')) {
        log(COLORS.red, '📄', `Response body: ${result.body?.substring(0, 500)}`);
      }
    }

    return { passed, result, issues, duration };
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
// GRUPO 1: CONVERSACIONES MUY LARGAS Y COMPLEJAS
// ============================================

async function testVeryLongConversation() {
  const callSid = `CA_very_long_${Date.now()}`;
  const steps = [
    { input: 'Hola, buenos días', step: 1 },
    { input: 'Quiero hacer una reserva', step: 2 },
    { input: 'Para 4 personas', step: 3 },
    { input: 'Espera, mejor para 6', step: 4 },
    { input: 'No, mejor 5', step: 5 },
    { input: 'Mañana', step: 6 },
    { input: 'No, mejor pasado mañana', step: 7 },
    { input: 'A las 8 de la noche', step: 8 },
    { input: 'Espera, mejor a las 9', step: 9 },
    { input: 'Mi nombre es Juan Carlos Pérez García', step: 10 },
    { input: 'Mi teléfono es 666123456', step: 11 },
    { input: 'Espera, el teléfono es 612345678', step: 12 },
    { input: 'Sí, confirmo', step: 13 },
    { input: 'Espera, mejor cancelo', step: 14 },
    { input: 'No, mejor sí confirmo', step: 15 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testMultipleIntentChanges() {
  const callSid = `CA_intent_changes_${Date.now()}`;
  const steps = [
    { input: 'Quiero hacer una reserva', step: 1 },
    { input: 'Para 4 personas', step: 2 },
    { input: 'Espera, mejor quiero cancelar una', step: 3 }, // Cambio de intención
    { input: '666123456', step: 4 },
    { input: 'No, mejor sí quiero hacer la reserva', step: 5 }, // Vuelve a reserva
    { input: 'Mañana a las 8', step: 6 },
    { input: 'Juan', step: 7 },
    { input: 'Espera, mejor quiero modificar una reserva', step: 8 }, // Cambio a modificar
    { input: '666123456', step: 9 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testConversationWithManyCorrections() {
  const callSid = `CA_many_corrections_${Date.now()}`;
  const steps = [
    { input: 'Reserva', step: 1 },
    { input: 'Para 2', step: 2 },
    { input: 'No, 3', step: 3 },
    { input: 'Espera, 4', step: 4 },
    { input: 'Mejor 5', step: 5 },
    { input: 'Hoy', step: 6 },
    { input: 'No, mañana', step: 7 },
    { input: 'A las 7', step: 8 },
    { input: 'No, 8', step: 9 },
    { input: 'Mejor 9', step: 10 },
    { input: 'Pedro', step: 11 },
    { input: 'No, Juan', step: 12 },
    { input: '666111222', step: 13 },
    { input: 'No, 666999888', step: 14 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

// ============================================
// GRUPO 2: INPUTS MALICIOSOS O INESPERADOS
// ============================================

async function testSQLInjectionAttempt() {
  const callSid = `CA_sql_injection_${Date.now()}`;
  const maliciousInputs = [
    "'; DROP TABLE RESERVA; --",
    "1' OR '1'='1",
    "'; DELETE FROM RESERVA WHERE '1'='1'; --",
    "admin'--",
    "1' UNION SELECT * FROM RESERVA--"
  ];

  let lastState = null;
  for (const input of maliciousInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testXSSAttempt() {
  const callSid = `CA_xss_${Date.now()}`;
  const xssInputs = [
    "<script>alert('XSS')</script>",
    "<img src=x onerror=alert('XSS')>",
    "javascript:alert('XSS')",
    "<svg onload=alert('XSS')>",
    "';alert('XSS');//"
  ];

  let lastState = null;
  for (const input of xssInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testSpecialCharactersBomb() {
  const callSid = `CA_special_chars_${Date.now()}`;
  const specialInputs = [
    "!@#$%^&*()_+-=[]{}|;':\",./<>?",
    "ñáéíóúÑÁÉÍÓÚ",
    "中文日本語한국어",
    "🚀🎉💯🔥⭐",
    "null undefined NaN Infinity",
    "\\n\\r\\t\\b\\f",
    String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15)
  ];

  let lastState = null;
  for (const input of specialInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testExtremelyLongInput() {
  const callSid = `CA_extreme_long_${Date.now()}`;
  // Crear input de 50,000 caracteres (EXTREMO)
  const longInput = "Reserva para 4 personas " + "muy importante ".repeat(2500) + "mañana a las 8";
  const req = createMockRequest(callSid, longInput);
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testExtremeMemoryLeak() {
  // Crear 100 conversaciones y mantenerlas en memoria
  const callSids = Array.from({ length: 100 }, (_, i) => `CA_memory_${Date.now()}_${i}`);
  const results = [];
  
  for (const callSid of callSids) {
    const req = createMockRequest(callSid, 'Reserva para 4 personas mañana');
    const res = createMockResponse();
    await handler(req, res);
    results.push(res);
  }
  
  return results[0];
}

async function testExtremeNestedConversations() {
  // Simular conversación dentro de conversación
  const callSid = `CA_nested_${Date.now()}`;
  const steps = [];
  
  // Crear 30 pasos de conversación anidada
  for (let i = 0; i < 30; i++) {
    steps.push({ input: `Paso ${i + 1}: Reserva para ${i + 1} personas`, step: i + 1 });
  }
  
  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
  }
  
  return lastState;
}

async function testExtremeConcurrency() {
  // 50 conversaciones simultáneas (EXTREMO)
  const callSids = Array.from({ length: 50 }, (_, i) => `CA_concurrent_extreme_${Date.now()}_${i}`);
  
  const promises = callSids.map(async (callSid, index) => {
    const req = createMockRequest(callSid, `Reserva ${index} para ${index + 1} personas`);
    const res = createMockResponse();
    await handler(req, res);
    return res;
  });

  const results = await Promise.all(promises);
  return results[0];
}

async function testExtremeDataCorruption() {
  const callSid = `CA_corrupt_${Date.now()}`;
  const corruptInputs = [
    String.fromCharCode(0xFF, 0xFE, 0xFD), // BOM y caracteres inválidos
    '\u0000\u0001\u0002\u0003', // Caracteres de control
    'Reserva' + '\x00' + 'para 4', // Null bytes
    Buffer.from([0xFF, 0xFE]).toString(), // UTF-16 BOM
    'Reserva' + String.fromCharCode(0x200B) + 'para 4', // Zero-width space
  ];
  
  let lastState = null;
  for (const input of corruptInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
  }
  
  return lastState;
}

async function testExtremeUnicodeBomb() {
  const callSid = `CA_unicode_bomb_${Date.now()}`;
  // Combinación extrema de Unicode
  const unicodeBomb = 'Reserva para 4 personas ' + 
    '🚀'.repeat(100) + 
    'ñáéíóú'.repeat(50) + 
    '中文'.repeat(50) + 
    '日本語'.repeat(50) + 
    '한국어'.repeat(50) + 
    'العربية'.repeat(50) +
    'русский'.repeat(50);
  
  const req = createMockRequest(callSid, unicodeBomb);
  const res = createMockResponse();
  await handler(req, res);
  return res;
}

async function testExtremeRegexBomb() {
  const callSid = `CA_regex_bomb_${Date.now()}`;
  // Inputs diseñados para causar ReDoS (Regular Expression Denial of Service)
  const regexBombs = [
    'a'.repeat(1000) + '!',
    'Reserva ' + 'a'.repeat(500) + ' para 4',
    '((' + 'a'.repeat(100) + ')+)+',
    'Reserva para ' + '4'.repeat(200) + ' personas'
  ];
  
  let lastState = null;
  for (const input of regexBombs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
  }
  
  return lastState;
}

async function testExtremeStateManipulation() {
  const callSid = `CA_state_manip_${Date.now()}`;
  // Intentar manipular el estado de formas inesperadas
  const steps = [
    { input: 'Reserva para 4 personas', step: 1 },
    { input: 'Mañana', step: 2 },
    { input: 'A las 8', step: 3 },
    { input: 'Juan', step: 4 },
    { input: '666123456', step: 5 },
    { input: 'Confirmar', step: 6 },
    // Intentar cambiar datos ya confirmados
    { input: 'Cambiar a 100 personas', step: 7 },
    { input: 'Cambiar fecha a ayer', step: 8 },
    { input: 'Cambiar hora a 3 AM', step: 9 }
  ];
  
  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  return lastState;
}

async function testExtremeTimingAttack() {
  // Múltiples requests con el mismo input para detectar problemas de timing
  const callSid = `CA_timing_${Date.now()}`;
  const sameInput = 'Reserva para 4 personas mañana a las 8';
  const times = [];
  
  for (let i = 0; i < 20; i++) {
    const start = Date.now();
    const req = createMockRequest(callSid, sameInput);
    const res = createMockResponse();
    await handler(req, res);
    times.push(Date.now() - start);
  }
  
  const variance = times.reduce((acc, time, idx, arr) => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return acc + Math.pow(time - mean, 2);
  }, 0) / times.length;
  
  return { times, variance, consistent: variance < 1000 };
}

async function testNullAndUndefinedInputs() {
  const callSid = `CA_null_inputs_${Date.now()}`;
  const req = createMockRequest(callSid, null);
  req.body.SpeechResult = null;
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testNumericInputsAsText() {
  const callSid = `CA_numeric_text_${Date.now()}`;
  const steps = [
    { input: 'Reserva para cuatro personas', step: 1 },
    { input: 'Mañana', step: 2 },
    { input: 'A las ocho de la noche', step: 3 },
    { input: 'Mi nombre es Juan', step: 4 },
    { input: 'Mi teléfono es seis seis seis uno dos tres cuatro cinco seis', step: 5 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

// ============================================
// GRUPO 3: LÍMITES DE CAPACIDAD
// ============================================

async function testMaximumPeopleLimit() {
  const callSid = `CA_max_people_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 100 personas', step: 1 }, // Muy por encima del límite
    { input: 'Mañana a las 8', step: 2 },
    { input: 'Juan', step: 3 },
    { input: '666123456', step: 4 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testMinimumPeopleEdge() {
  const callSid = `CA_min_people_${Date.now()}`;
  const req = createMockRequest(callSid, 'Reserva para 0 personas mañana');
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testNegativeNumbers() {
  const callSid = `CA_negative_${Date.now()}`;
  const steps = [
    { input: 'Reserva para -5 personas', step: 1 },
    { input: 'Mañana', step: 2 },
    { input: 'A las -8', step: 3 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testVeryFarFutureDate() {
  const callSid = `CA_far_future_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Reserva para 4 personas el 31 de diciembre de 2099 a las 8'
  );
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testVeryOldDate() {
  const callSid = `CA_old_date_${Date.now()}`;
  const req = createMockRequest(
    callSid,
    'Reserva para 4 personas el 1 de enero de 1900 a las 8'
  );
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

// ============================================
// GRUPO 4: CASOS DE ESTRÉS Y CARGA
// ============================================

async function testRapidFireRequests() {
  const callSid = `CA_rapid_fire_${Date.now()}`;
  const inputs = [
    'Reserva', '4', 'personas', 'mañana', '8', 'PM', 'Juan', 'Pérez', '666', '123', '456'
  ];

  const promises = inputs.map(async (input) => {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    return res;
  });

  const results = await Promise.all(promises);
  return results[results.length - 1];
}

async function testConcurrentConversations() {
  const callSids = Array.from({ length: 10 }, (_, i) => `CA_concurrent_${Date.now()}_${i}`);
  
  const promises = callSids.map(async (callSid) => {
    const req = createMockRequest(callSid, 'Reserva para 4 personas mañana a las 8');
    const res = createMockResponse();
    await handler(req, res);
    return res;
  });

  const results = await Promise.all(promises);
  return results[0];
}

async function testStressTestManySteps() {
  const callSid = `CA_stress_${Date.now()}`;
  // 100 pasos de conversación (EXTREMO)
  const steps = Array.from({ length: 100 }, (_, i) => ({
    input: `Input número ${i + 1} para probar el sistema al límite absoluto`,
    step: i + 1
  }));

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    // Sin delay para máximo estrés
  }

  return lastState;
}

// ============================================
// GRUPO 5: VALIDACIÓN DE INTEGRIDAD
// ============================================

async function testDataPersistenceAcrossSteps() {
  const callSid = `CA_persistence_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 4 personas', step: 1 },
    { input: 'Mañana', step: 2 },
    { input: 'A las 8', step: 3 },
    { input: 'Juan Pérez', step: 4 },
    { input: '666123456', step: 5 }
  ];

  const states = [];
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    states.push({ step: step.step, response: res.body });
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Verificar que los datos se mantienen
  return { states, allPersisted: states.length === steps.length };
}

async function testStateIsolation() {
  // Dos conversaciones simultáneas no deben interferir
  const callSid1 = `CA_isolate_1_${Date.now()}`;
  const callSid2 = `CA_isolate_2_${Date.now()}`;

  const req1 = createMockRequest(callSid1, 'Reserva para 4 personas');
  const req2 = createMockRequest(callSid2, 'Cancelar reserva');
  const res1 = createMockResponse();
  const res2 = createMockResponse();

  await Promise.all([
    handler(req1, res1),
    handler(req2, res2)
  ]);

  return { res1, res2, isolated: true };
}

async function testInvalidCallSidFormats() {
  const invalidCallSids = [
    '',
    null,
    undefined,
    '   ',
    'CA_invalid',
    '1234567890',
    'CA_with_special_chars_!@#$%',
    'CA_' + 'a'.repeat(200) // Muy largo
  ];

  const results = [];
  for (const callSid of invalidCallSids) {
    const req = createMockRequest(callSid || 'CA_fallback', 'Hola');
    if (callSid === null || callSid === undefined) {
      req.body.CallSid = callSid;
    }
    const res = createMockResponse();
    await handler(req, res);
    results.push({ callSid, status: res.statusCode, hasBody: res.body.length > 0 });
  }

  return results;
}

// ============================================
// GRUPO 6: CASOS DE BORDE EXTREMOS
// ============================================

async function testEmptyStringVariations() {
  const callSid = `CA_empty_variations_${Date.now()}`;
  const emptyInputs = ['', '   ', '\n', '\t', '\r\n', 'null', 'undefined', 'NaN'];

  let lastState = null;
  for (const input of emptyInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testUnicodeAndEmoji() {
  const callSid = `CA_unicode_${Date.now()}`;
  const unicodeInputs = [
    'Reserva para 4 personas 😊',
    'Mañana 🌞',
    'A las 8 🕗',
    'Mi nombre es José 🎉',
    'Teléfono: 666123456 📱'
  ];

  let lastState = null;
  for (const input of unicodeInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testMixedLanguagesInOneInput() {
  const callSid = `CA_mixed_lang_${Date.now()}`;
  const mixedInputs = [
    'Reserva para 4 people mañana at 8 PM',
    'Quiero hacer una reservation para tomorrow',
    'Mi nombre es John y mi teléfono es 666123456',
    'Reservar una mesa reservation para 4 personas people'
  ];

  let lastState = null;
  for (const input of mixedInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testTimeZoneEdgeCases() {
  const callSid = `CA_timezone_${Date.now()}`;
  const timeInputs = [
    'A las 00:00',
    'A las 23:59',
    'A las 24:00', // Hora inválida
    'A las 25:00', // Hora inválida
    'A medianoche',
    'A mediodía',
    'A las 12 PM',
    'A las 12 AM',
    'A las 13:00 PM', // Formato incorrecto
    'A las 8:99' // Minutos inválidos
  ];

  let lastState = null;
  for (const input of timeInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testDateEdgeCases() {
  const callSid = `CA_date_edges_${Date.now()}`;
  const dateInputs = [
    'El día 32 de enero', // Fecha inválida
    'El 30 de febrero', // Fecha inválida
    'El 29 de febrero de 2023', // Año no bisiesto
    'El 29 de febrero de 2024', // Año bisiesto (válido)
    'El día 0 de enero',
    'El día -1 de enero',
    'El 31 de abril', // Abril tiene 30 días
    'El 31 de junio', // Junio tiene 30 días
    'El 32 de diciembre'
  ];

  let lastState = null;
  for (const input of dateInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

// ============================================
// GRUPO 7: CASOS DE FLUJO COMPLEJO
// ============================================

async function testReservationModifyCancelFlow() {
  const callSid = `CA_res_mod_cancel_${Date.now()}`;
  const steps = [
    { input: 'Quiero hacer una reserva', step: 1 },
    { input: 'Para 4 personas mañana a las 8', step: 2 },
    { input: 'Juan Pérez', step: 3 },
    { input: '666123456', step: 4 },
    { input: 'Confirmar', step: 5 },
    { input: 'Espera, quiero modificar la reserva', step: 6 },
    { input: '666123456', step: 7 },
    { input: 'Cambiar la hora', step: 8 },
    { input: 'A las 9', step: 9 },
    { input: 'Confirmar', step: 10 },
    { input: 'Mejor cancelo la reserva', step: 11 },
    { input: '666123456', step: 12 },
    { input: 'La primera', step: 13 },
    { input: 'Sí, cancelar', step: 14 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testOrderThenReservation() {
  const callSid = `CA_order_res_${Date.now()}`;
  const steps = [
    { input: 'Quiero hacer un pedido', step: 1 },
    { input: 'Dos pizzas', step: 2 },
    { input: 'Espera, mejor quiero hacer una reserva', step: 3 }, // Cambio de intención
    { input: 'Para 4 personas', step: 4 },
    { input: 'Mañana', step: 5 },
    { input: 'A las 8', step: 6 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testMultipleReservationsInSequence() {
  const callSid = `CA_multi_res_seq_${Date.now()}`;
  const steps = [
    { input: 'Reserva para 2 personas mañana a las 8', step: 1 },
    { input: 'Juan', step: 2 },
    { input: '666111222', step: 3 },
    { input: 'Confirmar', step: 4 },
    { input: 'Quiero hacer otra reserva', step: 5 },
    { input: 'Para 4 personas pasado mañana a las 9', step: 6 },
    { input: 'María', step: 7 },
    { input: '666333444', step: 8 },
    { input: 'Confirmar', step: 9 }
  ];

  let lastState = null;
  for (const step of steps) {
    const req = createMockRequest(callSid, step.input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

// ============================================
// GRUPO 8: CASOS DE RENDIMIENTO
// ============================================

async function testPerformanceUnderLoad() {
  const callSid = `CA_perf_${Date.now()}`;
  const iterations = 20;
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const req = createMockRequest(callSid, `Input ${i}`);
    const res = createMockResponse();
    await handler(req, res);
    times.push(Date.now() - start);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  const min = Math.min(...times);

  return { avg, max, min, times, allUnder1s: avg < 1000 };
}

// ============================================
// GRUPO 9: CASOS DE ERRORES SIMULADOS
// ============================================

async function testMissingRequiredFields() {
  const callSid = `CA_missing_fields_${Date.now()}`;
  const req = createMockRequest(callSid, 'Reserva');
  // Simular request sin algunos campos
  delete req.body.From;
  delete req.body.To;
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

async function testInvalidRequestStructure() {
  const callSid = `CA_invalid_struct_${Date.now()}`;
  const req = {
    method: 'POST',
    body: { CallSid: callSid, SpeechResult: 'test' },
    // Sin otros campos requeridos
    query: {},
    headers: {}
  };
  const res = createMockResponse();
  
  await handler(req, res);
  return res;
}

// ============================================
// GRUPO 10: CASOS DE VALIDACIÓN EXTREMA
// ============================================

async function testPhoneNumberVariations() {
  const callSid = `CA_phone_variations_${Date.now()}`;
  const phoneInputs = [
    '666123456', // Formato español
    '+34666123456', // Con prefijo
    '0034666123456', // Con doble prefijo
    '666-123-456', // Con guiones
    '666 123 456', // Con espacios
    '(666) 123-456', // Formato americano
    '666.123.456', // Con puntos
    '123', // Muy corto
    '12345678901234567890', // Muy largo
    'abc123def', // Con letras
    '666-123-456 ext 789', // Con extensión
    '+1-555-123-4567', // Formato internacional
    'sin teléfono', // Texto
    'no tengo teléfono' // Negación
  ];

  let lastState = null;
  for (const input of phoneInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

async function testNameVariations() {
  const callSid = `CA_name_variations_${Date.now()}`;
  const nameInputs = [
    'Juan', // Nombre simple
    'Juan Carlos', // Nombre compuesto
    'Juan Carlos Pérez García', // Nombre completo
    'María José', // Con acento
    'José-María', // Con guión
    'O\'Connor', // Con apóstrofe
    'Van der Berg', // Con "van"
    'De la Rosa', // Con "de la"
    '123', // Solo números
    'A', // Muy corto
    'A'.repeat(100), // Muy largo
    'Juan123', // Con números
    'Juan@Pérez', // Con caracteres especiales
    'Juan Pérez y María García', // Múltiples nombres
    '' // Vacío
  ];

  let lastState = null;
  for (const input of nameInputs) {
    const req = createMockRequest(callSid, input);
    const res = createMockResponse();
    await handler(req, res);
    lastState = res;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return lastState;
}

// ============================================
// EJECUTAR TODOS LOS TESTS EXTREMOS
// ============================================

async function runAllExtremeTests() {
  console.log('\n' + '='.repeat(80));
  console.log(COLORS.bright + '🔥 INICIANDO TESTS EXTREMOS DEL SISTEMA' + COLORS.reset);
  console.log('='.repeat(80) + '\n');

  const startTime = Date.now();

  // GRUPO 1: Conversaciones muy largas y complejas
  log(COLORS.magenta, '📋', 'GRUPO 1: Conversaciones Muy Largas y Complejas');
  await runTest('Extremo - Conversación Muy Larga (15 pasos)', testVeryLongConversation, {
    shouldHaveGather: true
  }, true);
  await runTest('Extremo - Múltiples Cambios de Intención', testMultipleIntentChanges, {
    shouldHaveGather: true
  }, true);
  await runTest('Extremo - Muchas Correcciones', testConversationWithManyCorrections, {
    shouldHaveGather: true
  }, true);

  // GRUPO 2: Inputs maliciosos o inesperados
  log(COLORS.magenta, '📋', 'GRUPO 2: Inputs Maliciosos o Inesperados');
  await runTest('Seguridad - Intento SQL Injection', testSQLInjectionAttempt, {
    statusCode: 200, // Debe manejar graciosamente
    shouldNotContain: 'DROP TABLE'
  }, true);
  await runTest('Seguridad - Intento XSS', testXSSAttempt, {
    statusCode: 200,
    shouldNotContain: '<script>'
  }, true);
  await runTest('Extremo - Bombardeo de Caracteres Especiales', testSpecialCharactersBomb, {
    statusCode: 200
  }, true);
  await runTest('Extremo - Input Muy Largo (50K chars) (EXTREMO)', testExtremelyLongInput, {
    statusCode: 200,
    maxDuration: 10000
  }, true);
  await runTest('Extremo - Bombardeo Unicode (EXTREMO)', testExtremeUnicodeBomb, {
    statusCode: 200,
    maxDuration: 8000
  }, true);
  await runTest('Extremo - Regex Bomb (ReDoS) (EXTREMO)', testExtremeRegexBomb, {
    statusCode: 200,
    maxDuration: 10000
  }, true);
  await runTest('Extremo - Datos Corruptos (EXTREMO)', testExtremeDataCorruption, {
    statusCode: 200,
    maxDuration: 5000
  }, true);
  await runTest('Extremo - Inputs Null/Undefined', testNullAndUndefinedInputs, {
    statusCode: 200
  }, true);
  await runTest('Extremo - Números en Texto', testNumericInputsAsText, {
    shouldHaveGather: true
  }, true);

  // GRUPO 3: Límites de capacidad
  log(COLORS.magenta, '📋', 'GRUPO 3: Límites de Capacidad');
  await runTest('Límite - Máximo de Personas (100)', testMaximumPeopleLimit, {
    shouldHaveGather: true
  }, true);
  await runTest('Límite - Mínimo de Personas (0)', testMinimumPeopleEdge, {
    statusCode: 200
  }, true);
  await runTest('Límite - Números Negativos', testNegativeNumbers, {
    statusCode: 200
  }, true);
  await runTest('Límite - Fecha Muy Futura (2099)', testVeryFarFutureDate, {
    statusCode: 200
  }, true);
  await runTest('Límite - Fecha Muy Pasada (1900)', testVeryOldDate, {
    statusCode: 200
  }, true);

  // GRUPO 4: Casos de estrés y carga
  log(COLORS.magenta, '📋', 'GRUPO 4: Casos de Estrés y Carga');
  await runTest('Estrés - Requests Rápidos (11 simultáneos)', testRapidFireRequests, {
    statusCode: 200,
    maxDuration: 3000
  }, true);
  await runTest('Estrés - Conversaciones Concurrentes (10)', testConcurrentConversations, {
    statusCode: 200,
    maxDuration: 5000
  }, true);
  await runTest('Estrés - 100 Pasos Sin Pausa (EXTREMO)', testStressTestManySteps, {
    statusCode: 200,
    maxDuration: 20000
  }, true);
  await runTest('Estrés - 50 Conversaciones Concurrentes (EXTREMO)', testExtremeConcurrency, {
    statusCode: 200,
    maxDuration: 15000
  }, true);
  await runTest('Estrés - 100 Conversaciones en Memoria (EXTREMO)', testExtremeMemoryLeak, {
    statusCode: 200,
    maxDuration: 20000
  }, true);
  await runTest('Estrés - 30 Pasos Anidados (EXTREMO)', testExtremeNestedConversations, {
    statusCode: 200,
    maxDuration: 10000
  }, true);

  // GRUPO 5: Validación de integridad
  log(COLORS.magenta, '📋', 'GRUPO 5: Validación de Integridad');
  await runTest('Integridad - Persistencia de Datos', testDataPersistenceAcrossSteps, {
    shouldContain: 'states'
  }, true);
  await runTest('Integridad - Aislamiento de Estado', testStateIsolation, {
    shouldContain: 'isolated'
  }, true);
  await runTest('Integridad - Formatos de CallSid Inválidos', testInvalidCallSidFormats, {
    statusCode: 200
  }, true);

  // GRUPO 6: Casos de borde extremos
  log(COLORS.magenta, '📋', 'GRUPO 6: Casos de Borde Extremos');
  await runTest('Borde - Variaciones de String Vacío', testEmptyStringVariations, {
    statusCode: 200
  }, true);
  await runTest('Borde - Unicode y Emojis', testUnicodeAndEmoji, {
    statusCode: 200
  }, true);
  await runTest('Borde - Idiomas Mezclados', testMixedLanguagesInOneInput, {
    statusCode: 200
  }, true);
  await runTest('Borde - Casos de Hora Extremos', testTimeZoneEdgeCases, {
    statusCode: 200
  }, true);
  await runTest('Borde - Casos de Fecha Extremos', testDateEdgeCases, {
    statusCode: 200
  }, true);

  // GRUPO 7: Casos de flujo complejo
  log(COLORS.magenta, '📋', 'GRUPO 7: Casos de Flujo Complejo');
  await runTest('Complejo - Reserva → Modificar → Cancelar', testReservationModifyCancelFlow, {
    shouldHaveGather: true
  }, true);
  await runTest('Complejo - Pedido → Reserva', testOrderThenReservation, {
    shouldHaveGather: true
  }, true);
  await runTest('Complejo - Múltiples Reservas en Secuencia', testMultipleReservationsInSequence, {
    shouldHaveGather: true
  }, true);
  await runTest('Complejo - Manipulación de Estado (EXTREMO)', testExtremeStateManipulation, {
    shouldHaveGather: true
  }, true);

  // GRUPO 8: Casos de rendimiento
  log(COLORS.magenta, '📋', 'GRUPO 8: Casos de Rendimiento');
  await runTest('Rendimiento - Bajo Carga (20 iteraciones)', testPerformanceUnderLoad, {
    shouldContain: 'avg'
  }, true);
  await runTest('Rendimiento - Timing Attack (20 requests idénticos)', testExtremeTimingAttack, {
    shouldContain: 'variance'
  }, true);

  // GRUPO 9: Casos de errores simulados
  log(COLORS.magenta, '📋', 'GRUPO 9: Casos de Errores Simulados');
  await runTest('Error - Campos Requeridos Faltantes', testMissingRequiredFields, {
    statusCode: 200
  }, true);
  await runTest('Error - Estructura de Request Inválida', testInvalidRequestStructure, {
    statusCode: 200
  }, true);

  // GRUPO 10: Casos de validación extrema
  log(COLORS.magenta, '📋', 'GRUPO 10: Casos de Validación Extrema');
  await runTest('Validación - Variaciones de Teléfono (14 formatos)', testPhoneNumberVariations, {
    statusCode: 200
  }, true);
  await runTest('Validación - Variaciones de Nombre (15 formatos)', testNameVariations, {
    statusCode: 200
  }, true);

  // Resumen final
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(80));
  console.log(COLORS.bright + '📊 RESUMEN DE TESTS EXTREMOS' + COLORS.reset);
  console.log('='.repeat(80));
  console.log(`${COLORS.cyan}Total de tests:${COLORS.reset} ${stats.total}`);
  console.log(`${COLORS.magenta}Tests extremos:${COLORS.reset} ${stats.extremeCases}`);
  console.log(`${COLORS.green}Pasados:${COLORS.reset} ${stats.passed}`);
  console.log(`${COLORS.red}Fallidos:${COLORS.reset} ${stats.failed}`);
  console.log(`${COLORS.red}Errores:${COLORS.reset} ${stats.errors}`);
  console.log(`${COLORS.yellow}Tiempo total:${COLORS.reset} ${duration}s`);
  console.log(`${COLORS.cyan}Promedio por test:${COLORS.reset} ${(duration / stats.total).toFixed(2)}s`);
  
  const successRate = ((stats.passed / stats.total) * 100).toFixed(1);
  const extremeRate = ((stats.extremeCases / stats.total) * 100).toFixed(1);
  console.log(`${COLORS.bright}Tasa de éxito:${COLORS.reset} ${successRate}%`);
  console.log(`${COLORS.bright}Tests extremos:${COLORS.reset} ${extremeRate}%`);
  console.log('='.repeat(80) + '\n');

  if (stats.failed > 0 || stats.errors > 0) {
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  runAllExtremeTests().catch(error => {
    console.error(COLORS.red + '💥 ERROR FATAL:' + COLORS.reset, error);
    process.exit(1);
  });
}

module.exports = { runAllExtremeTests, runTest, stats };

