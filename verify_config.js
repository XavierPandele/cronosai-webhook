#!/usr/bin/env node

const fs = require('fs');
require('dotenv').config();

console.log('🔍 Verificando configuración del Sistema de Comprensión Mejorado...\n');

// Función para verificar variables de entorno
function checkEnvironmentVariables() {
  const requiredVars = [
    'GOOGLE_API_KEY',
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];
  
  const missingVars = [];
  const configuredVars = [];
  
  requiredVars.forEach(varName => {
    if (process.env[varName] && process.env[varName] !== 'tu_api_key_aqui') {
      configuredVars.push(varName);
    } else {
      missingVars.push(varName);
    }
  });
  
  console.log('📋 Estado de configuración:');
  console.log(`✅ Variables configuradas: ${configuredVars.length}/${requiredVars.length}`);
  
  if (configuredVars.length > 0) {
    console.log('   Variables configuradas:');
    configuredVars.forEach(varName => {
      const value = process.env[varName];
      const maskedValue = varName === 'GOOGLE_API_KEY' 
        ? value.substring(0, 8) + '...' + value.substring(value.length - 4)
        : value;
      console.log(`   - ${varName}: ${maskedValue}`);
    });
  }
  
  if (missingVars.length > 0) {
    console.log('❌ Variables faltantes:');
    missingVars.forEach(varName => {
      console.log(`   - ${varName}`);
    });
  }
  
  return missingVars.length === 0;
}

// Función para verificar archivos del sistema
function checkSystemFiles() {
  const requiredFiles = [
    'api/twilio-call-gemini-enhanced.js',
    'test_enhanced_comprehension.js',
    'docs/ENHANCED_COMPREHENSION_SYSTEM.md'
  ];
  
  console.log('\n📁 Archivos del sistema:');
  
  requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} - FALTANTE`);
    }
  });
}

// Función para verificar dependencias
function checkDependencies() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredDeps = ['@google/generative-ai', 'mysql2', 'twilio'];
  
  console.log('\n📦 Dependencias:');
  
  requiredDeps.forEach(dep => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`✅ ${dep}: ${packageJson.dependencies[dep]}`);
    } else {
      console.log(`❌ ${dep} - FALTANTE`);
    }
  });
}

// Función para probar conexión a Gemini
async function testGeminiConnection() {
  if (!process.env.GOOGLE_API_KEY) {
    console.log('\n⚠️ GOOGLE_API_KEY no configurada, saltando prueba de conexión');
    return false;
  }
  
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    
    console.log('\n🧪 Probando conexión a Gemini 2.0-flash...');
    
    const result = await model.generateContent('Responde solo "OK" si puedes leer este mensaje');
    const response = await result.response;
    const text = response.text().trim();
    
    if (text.toLowerCase().includes('ok')) {
      console.log('✅ Conexión a Gemini 2.0-flash exitosa');
      return true;
    } else {
      console.log('⚠️ Respuesta inesperada de Gemini:', text);
      return false;
    }
    
  } catch (error) {
    console.log('❌ Error conectando a Gemini 2.0-flash:', error.message);
    return false;
  }
}

// Función para generar reporte de configuración
function generateConfigReport() {
  const report = `# Reporte de Configuración - Sistema de Comprensión Mejorado
## Fecha: ${new Date().toISOString()}

### Variables de Entorno
- GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '✅ Configurada' : '❌ Faltante'}
- DB_HOST: ${process.env.DB_HOST || '❌ Faltante'}
- DB_USER: ${process.env.DB_USER || '❌ Faltante'}
- DB_PASSWORD: ${process.env.DB_PASSWORD ? '✅ Configurada' : '❌ Faltante'}
- DB_NAME: ${process.env.DB_NAME || '❌ Faltante'}

### Archivos del Sistema
- api/twilio-call-gemini-enhanced.js: ${fs.existsSync('api/twilio-call-gemini-enhanced.js') ? '✅ Presente' : '❌ Faltante'}
- test_enhanced_comprehension.js: ${fs.existsSync('test_enhanced_comprehension.js') ? '✅ Presente' : '❌ Faltante'}
- docs/ENHANCED_COMPREHENSION_SYSTEM.md: ${fs.existsSync('docs/ENHANCED_COMPREHENSION_SYSTEM.md') ? '✅ Presente' : '❌ Faltante'}

### Estado General
${process.env.GOOGLE_API_KEY ? '✅ Sistema listo para usar' : '❌ Configuración incompleta'}

---
Generado automáticamente por el sistema de verificación
`;

  fs.writeFileSync('config_report.md', report);
  console.log('\n📄 Reporte de configuración generado: config_report.md');
}

// Función principal
async function verifyConfiguration() {
  console.log('🔍 Iniciando verificación de configuración...\n');
  
  // Verificar variables de entorno
  const envOk = checkEnvironmentVariables();
  
  // Verificar archivos del sistema
  checkSystemFiles();
  
  // Verificar dependencias
  checkDependencies();
  
  // Probar conexión a Gemini
  if (envOk) {
    await testGeminiConnection();
  }
  
  // Generar reporte
  generateConfigReport();
  
  console.log('\n📊 RESUMEN:');
  if (envOk) {
    console.log('✅ Configuración completa - Sistema listo para usar');
    console.log('\n🚀 Próximos pasos:');
    console.log('1. Probar sistema: node test_enhanced_comprehension.js');
    console.log('2. Ejecutar migración: node migrate_to_enhanced.js');
    console.log('3. Monitorear: node monitor_enhanced_system.js');
  } else {
    console.log('❌ Configuración incompleta - Revisar variables faltantes');
    console.log('\n🔧 Para configurar:');
    console.log('1. Ejecutar: node configure_api_key.js');
    console.log('2. O crear archivo .env manualmente');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  verifyConfiguration().catch(console.error);
}

module.exports = { verifyConfiguration, checkEnvironmentVariables, testGeminiConnection };
