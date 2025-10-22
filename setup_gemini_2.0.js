#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Configurando Sistema Gemini 2.0 Flash\n');

// Verificar si existe el archivo .env
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.log('📝 Creando archivo .env...');
  const envContent = `# Configuración del Sistema Gemini 2.0 Flash
GOOGLE_API_KEY=tu_api_key_de_gemini_2.0

# Configuración de base de datos
DB_HOST=db1.bwai.cc
DB_PORT=3306
DB_USER=cronosdev
DB_PASS=)CDJ6gwpCO9rg-W/
DB_NAME=cronosai

# Configuración de Twilio
TWILIO_ACCOUNT_SID=tu_account_sid
TWILIO_AUTH_TOKEN=tu_auth_token
`;
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Archivo .env creado');
} else {
  console.log('✅ Archivo .env ya existe');
}

// Verificar dependencias
console.log('\n📦 Verificando dependencias...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  
  if (!packageJson.dependencies['@google/generative-ai']) {
    console.log('⚠️ @google/generative-ai no encontrado en package.json');
    console.log('💡 Ejecuta: npm install @google/generative-ai@^0.24.1');
  } else {
    console.log('✅ @google/generative-ai encontrado');
  }
  
  if (!packageJson.dependencies['mysql2']) {
    console.log('⚠️ mysql2 no encontrado en package.json');
    console.log('💡 Ejecuta: npm install mysql2@^3.6.0');
  } else {
    console.log('✅ mysql2 encontrado');
  }
  
  if (!packageJson.dependencies['twilio']) {
    console.log('⚠️ twilio no encontrado en package.json');
    console.log('💡 Ejecuta: npm install twilio@^5.3.0');
  } else {
    console.log('✅ twilio encontrado');
  }
} else {
  console.log('❌ package.json no encontrado');
}

// Crear estructura de directorios
console.log('\n📁 Creando estructura de directorios...');
const dirs = ['docs', 'tests', 'logs'];
dirs.forEach(dir => {
  const dirPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✅ Directorio ${dir} creado`);
  } else {
    console.log(`✅ Directorio ${dir} ya existe`);
  }
});

// Crear archivo de configuración de Vercel
console.log('\n🔧 Configurando Vercel...');
const vercelConfigPath = path.join(process.cwd(), 'vercel.json');
if (!fs.existsSync(vercelConfigPath)) {
  const vercelConfig = {
    "functions": {
      "api/twilio-call-gemini-2.0.js": {
        "runtime": "nodejs18.x"
      }
    },
    "env": {
      "GOOGLE_API_KEY": "@google_api_key",
      "DB_HOST": "@db_host",
      "DB_PORT": "@db_port",
      "DB_USER": "@db_user",
      "DB_PASS": "@db_pass",
      "DB_NAME": "@db_name"
    }
  };
  fs.writeFileSync(vercelConfigPath, JSON.stringify(vercelConfig, null, 2));
  console.log('✅ vercel.json creado');
} else {
  console.log('✅ vercel.json ya existe');
}

// Crear script de testing
console.log('\n🧪 Configurando tests...');
const testScriptPath = path.join(process.cwd(), 'tests', 'run_tests.js');
if (!fs.existsSync(testScriptPath)) {
  const testScript = `#!/usr/bin/env node

const { runAllTests } = require('../test_gemini_2.0_system');

console.log('🧪 Ejecutando tests del Sistema Gemini 2.0 Flash\\n');

runAllTests().then(() => {
  console.log('\\n🎉 Tests completados');
  process.exit(0);
}).catch(error => {
  console.error('❌ Error en tests:', error);
  process.exit(1);
});
`;
  fs.writeFileSync(testScriptPath, testScript);
  fs.chmodSync(testScriptPath, '755');
  console.log('✅ Script de tests creado');
} else {
  console.log('✅ Script de tests ya existe');
}

// Crear script de monitoreo
console.log('\n📊 Configurando monitoreo...');
const monitorScriptPath = path.join(process.cwd(), 'monitor_system.js');
if (!fs.existsSync(monitorScriptPath)) {
  const monitorScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📊 Monitoreo del Sistema Gemini 2.0 Flash\\n');

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
    console.log(\`  \${status} \${check}\`);
  });
  
  const allGood = Object.values(checks).every(status => status.includes('✅'));
  console.log(\`\\n\${allGood ? '🎉 Sistema listo' : '⚠️ Sistema necesita configuración'}\`);
}

// Ejecutar verificación
checkSystemStatus();
`;
  fs.writeFileSync(monitorScriptPath, monitorScript);
  fs.chmodSync(monitorScriptPath, '755');
  console.log('✅ Script de monitoreo creado');
} else {
  console.log('✅ Script de monitoreo ya existe');
}

// Mostrar resumen
console.log('\n🎯 Resumen de configuración:');
console.log('✅ Archivo .env configurado');
console.log('✅ Estructura de directorios creada');
console.log('✅ Configuración de Vercel lista');
console.log('✅ Scripts de testing y monitoreo creados');

console.log('\n📋 Próximos pasos:');
console.log('1. Configura tu GOOGLE_API_KEY en el archivo .env');
console.log('2. Ejecuta: npm install');
console.log('3. Prueba el sistema: node test_gemini_2.0_system.js');
console.log('4. Despliega en Vercel: vercel deploy');
console.log('5. Configura el webhook en Twilio: https://tu-dominio.vercel.app/api/twilio-call-gemini-2.0');

console.log('\n🚀 ¡Sistema Gemini 2.0 Flash listo para usar!');
