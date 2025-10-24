#!/usr/bin/env node

const fs = require('fs');
const readline = require('readline');

console.log('🔑 Configurando GOOGLE_API_KEY para Gemini 2.0-flash\n');

// Crear interfaz para leer input del usuario
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Función para hacer preguntas al usuario
function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

// Función para crear archivo .env
function createEnvFile(apiKey, dbConfig) {
  const envContent = `# Configuración del Sistema de Comprensión Mejorado
# IMPORTANTE: No subir este archivo a Git por seguridad

# Google Gemini 2.0-flash API Key
GOOGLE_API_KEY=${apiKey}

# Base de datos MySQL
DB_HOST=${dbConfig.host}
DB_USER=${dbConfig.user}
DB_PASSWORD=${dbConfig.password}
DB_NAME=${dbConfig.database}
DB_PORT=${dbConfig.port}

# Twilio (opcional para pruebas)
TWILIO_ACCOUNT_SID=tu_account_sid
TWILIO_AUTH_TOKEN=tu_auth_token
TWILIO_PHONE_NUMBER=tu_numero_twilio

# Configuración del sistema
NODE_ENV=development
LOG_LEVEL=info
MAX_CONVERSATION_HISTORY=10
GEMINI_TEMPERATURE=0.3
GEMINI_MAX_TOKENS=1024
`;

  fs.writeFileSync('.env', envContent);
  console.log('✅ Archivo .env creado exitosamente');
}

// Función para validar API Key
function validateApiKey(apiKey) {
  // Validación básica de formato de API Key
  if (!apiKey || apiKey.length < 20) {
    return false;
  }
  
  // Verificar que no sea el placeholder
  if (apiKey.includes('tu_api_key_aqui')) {
    return false;
  }
  
  return true;
}

// Función principal
async function configureApiKey() {
  try {
    console.log('📋 Para obtener tu API Key de Google Gemini:');
    console.log('1. Ve a: https://aistudio.google.com/app/apikey');
    console.log('2. Inicia sesión con tu cuenta de Google');
    console.log('3. Crea una nueva API Key');
    console.log('4. Copia la API Key generada\n');
    
    // Solicitar API Key
    let apiKey = await askQuestion('🔑 Ingresa tu GOOGLE_API_KEY: ');
    
    // Validar API Key
    while (!validateApiKey(apiKey)) {
      console.log('❌ API Key inválida. Por favor, ingresa una API Key válida.');
      apiKey = await askQuestion('🔑 Ingresa tu GOOGLE_API_KEY: ');
    }
    
    console.log('✅ API Key válida\n');
    
    // Solicitar configuración de base de datos
    console.log('📊 Configuración de base de datos:');
    const dbConfig = {
      host: await askQuestion('🏠 Host de la base de datos (localhost): ') || 'localhost',
      user: await askQuestion('👤 Usuario de la base de datos: '),
      password: await askQuestion('🔒 Contraseña de la base de datos: '),
      database: await askQuestion('🗄️ Nombre de la base de datos: '),
      port: await askQuestion('🔌 Puerto de la base de datos (3306): ') || '3306'
    };
    
    // Crear archivo .env
    createEnvFile(apiKey, dbConfig);
    
    console.log('\n🎉 Configuración completada exitosamente!');
    console.log('\n📋 Próximos pasos:');
    console.log('1. Probar el sistema: node test_enhanced_comprehension.js');
    console.log('2. Ejecutar migración: node migrate_to_enhanced.js');
    console.log('3. Monitorear: node monitor_enhanced_system.js');
    
  } catch (error) {
    console.error('❌ Error en la configuración:', error.message);
  } finally {
    rl.close();
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  configureApiKey();
}

module.exports = { configureApiKey, validateApiKey, createEnvFile };
