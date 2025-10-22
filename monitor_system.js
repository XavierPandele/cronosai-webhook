#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📊 Monitoreo del Sistema Gemini 2.0 Flash\n');

// Función para verificar el estado del sistema
function checkSystemStatus() {
  const checks = {
    'Gemini 2.0 API': process.env.GOOGLE_API_KEY ? '✅ Configurado' : '❌ No configurado',
    'Base de datos': process.env.DB_HOST ? '✅ Configurado' : '❌ No configurado',
    'Twilio': process.env.TWILIO_ACCOUNT_SID ? '✅ Configurado' : '❌ No configurado',
    'Archivo principal': fs.existsSync('api/twilio-call-gemini-2.0.js') ? '✅ Existe' : '❌ No existe',
    'Tests': fs.existsSync('test_gemini_2.0_system.js') ? '✅ Existe' : '❌ No existe',
    'Documentación': fs.existsSync('docs/GEMINI_2.0_SYSTEM.md') ? '✅ Existe' : '❌ No existe'
  };
  
  console.log('🔍 Estado del sistema:');
  Object.entries(checks).forEach(([check, status]) => {
    console.log(`  ${status} ${check}`);
  });
  
  const allGood = Object.values(checks).every(status => status.includes('✅'));
  console.log(`\n${allGood ? '🎉 Sistema listo' : '⚠️ Sistema necesita configuración'}`);
}

// Ejecutar verificación
checkSystemStatus();
