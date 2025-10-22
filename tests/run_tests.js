#!/usr/bin/env node

const { runAllTests } = require('../test_gemini_2.0_system');

console.log('🧪 Ejecutando tests del Sistema Gemini 2.0 Flash\n');

runAllTests().then(() => {
  console.log('\n🎉 Tests completados');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error en tests:', error);
  process.exit(1);
});
