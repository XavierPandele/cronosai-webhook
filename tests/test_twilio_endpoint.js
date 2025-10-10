#!/usr/bin/env node

/**
 * Script de prueba para el endpoint de Twilio
 * Simula una llamada de Twilio sin necesidad de hacer una llamada real
 */

const https = require('https');

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, prefix, message) {
  console.log(`${color}${prefix}${COLORS.reset} ${message}`);
}

async function testEndpoint(url, step, speechResult = '') {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = new URLSearchParams({
      CallSid: 'CA_test_12345678',
      From: '+34600123456',
      To: '+34600999888',
      CallStatus: 'in-progress',
      SpeechResult: speechResult
    }).toString();

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    log(COLORS.cyan, '🔍', `Probando paso: ${step}`);
    if (speechResult) {
      log(COLORS.blue, '💬', `Entrada: "${speechResult}"`);
    }

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          // Extraer el mensaje del Say
          const sayMatch = data.match(/<Say[^>]*>(.*?)<\/Say>/);
          const message = sayMatch ? sayMatch[1] : 'No se encontró mensaje';
          
          log(COLORS.green, '✅', `Respuesta del bot: "${message}"`);
          resolve({ success: true, message, xml: data });
        } else {
          log(COLORS.red, '❌', `Error HTTP ${res.statusCode}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (error) => {
      log(COLORS.red, '❌', `Error de conexión: ${error.message}`);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('\n' + '='.repeat(70));
  log(COLORS.cyan, '🧪', 'PRUEBA DEL ENDPOINT DE TWILIO');
  console.log('='.repeat(70) + '\n');

  // URL del endpoint (cambiar si es diferente)
  const url = 'https://cronosai-webhook.vercel.app/api/twilio-call';
  
  log(COLORS.blue, '🌐', `URL: ${url}\n`);

  try {
    // Paso 1: Saludo inicial
    console.log('--- PASO 1: SALUDO INICIAL ---');
    await testEndpoint(url, 'greeting', '');
    await sleep(1000);

    // Paso 2: Número de personas
    console.log('\n--- PASO 2: NÚMERO DE PERSONAS ---');
    await testEndpoint(url, 'ask_people', 'para cuatro personas');
    await sleep(1000);

    // Paso 3: Fecha
    console.log('\n--- PASO 3: FECHA ---');
    await testEndpoint(url, 'ask_date', 'para mañana');
    await sleep(1000);

    // Paso 4: Hora
    console.log('\n--- PASO 4: HORA ---');
    await testEndpoint(url, 'ask_time', 'a las ocho de la noche');
    await sleep(1000);

    // Paso 5: Nombre
    console.log('\n--- PASO 5: NOMBRE ---');
    await testEndpoint(url, 'ask_name', 'Juan García');
    await sleep(1000);

    // Paso 6: Confirmación
    console.log('\n--- PASO 6: CONFIRMACIÓN ---');
    await testEndpoint(url, 'confirm', 'sí confirmo');

    console.log('\n' + '='.repeat(70));
    log(COLORS.green, '✅', 'TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE');
    console.log('='.repeat(70) + '\n');

    log(COLORS.yellow, '💡', 'Nota: Este test simula la conversación pero no usa el mismo CallSid,');
    log(COLORS.yellow, '   ', 'por lo que cada petición es independiente en el servidor.');
    log(COLORS.yellow, '   ', 'Para probar el flujo completo, realiza una llamada real.\n');

  } catch (error) {
    console.log('\n' + '='.repeat(70));
    log(COLORS.red, '❌', 'ERROR EN LAS PRUEBAS');
    console.log('='.repeat(70) + '\n');
    console.error(error);
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ejecutar pruebas
runTests();

