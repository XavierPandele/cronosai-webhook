// Script para probar el webhook de cancelación con una llamada HTTP real
const http = require('http');

// Función para hacer una llamada HTTP al webhook
function testWebhookCancellation() {
  console.log('🧪 Probando webhook de cancelación con llamada HTTP real...\n');

  // Datos de prueba para simular una llamada de Twilio
  const postData = JSON.stringify({
    CallSid: 'test-call-cancellation-123',
    SpeechResult: 'quiero cancelar mi reserva',
    From: '+34123456789',
    To: '+34987654321',
    CallStatus: 'in-progress'
  });

  const options = {
    hostname: 'localhost',
    port: 3000, // Ajusta el puerto según tu configuración
    path: '/api/twilio-call-improved',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  console.log('📞 Enviando llamada de prueba al webhook...');
  console.log('Datos enviados:', postData);
  console.log('Endpoint:', `http://${options.hostname}:${options.port}${options.path}\n`);

  const req = http.request(options, (res) => {
    console.log(`📡 Respuesta del servidor: ${res.statusCode}`);
    console.log(`📋 Headers:`, res.headers);

    let responseData = '';
    res.on('data', (chunk) => {
      responseData += chunk;
    });

    res.on('end', () => {
      console.log('\n📄 Respuesta TwiML recibida:');
      console.log('─'.repeat(50));
      console.log(responseData);
      console.log('─'.repeat(50));
      
      // Verificar si la respuesta contiene elementos de cancelación
      if (responseData.includes('cancelar') || responseData.includes('teléfono')) {
        console.log('\n✅ ¡ÉXITO! El webhook está respondiendo correctamente al flujo de cancelación');
        console.log('🎯 La respuesta contiene elementos del flujo de cancelación');
      } else {
        console.log('\n⚠️  La respuesta no parece contener elementos de cancelación');
        console.log('🔍 Verifica que el webhook esté funcionando correctamente');
      }
    });
  });

  req.on('error', (e) => {
    console.error('❌ Error en la llamada HTTP:', e.message);
    console.log('\n💡 Sugerencias:');
    console.log('  - Verifica que el servidor esté ejecutándose');
    console.log('  - Ajusta el puerto en la configuración');
    console.log('  - Verifica que el endpoint sea correcto');
  });

  req.write(postData);
  req.end();
}

// Ejecutar la prueba
testWebhookCancellation();
