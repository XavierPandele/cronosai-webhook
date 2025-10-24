// Script para configurar el archivo .env
const fs = require('fs');
const path = require('path');
const readline = require('readline');

class EnvSetup {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async setupEnvironment() {
    console.log('🔧 CONFIGURACIÓN DEL ARCHIVO .ENV');
    console.log('==================================');
    console.log('Este script te ayudará a configurar las variables de entorno necesarias.\n');

    const envVars = {};

    // GOOGLE_API_KEY
    envVars.GOOGLE_API_KEY = await this.askQuestion('🔑 Ingresa tu GOOGLE_API_KEY: ');
    
    // DB_HOST
    envVars.DB_HOST = await this.askQuestion('🗄️ Ingresa el DB_HOST (ej: localhost): ', 'localhost');
    
    // DB_USER
    envVars.DB_USER = await this.askQuestion('👤 Ingresa el DB_USER: ');
    
    // DB_PASSWORD
    envVars.DB_PASSWORD = await this.askQuestion('🔒 Ingresa el DB_PASSWORD: ');
    
    // DB_NAME
    envVars.DB_NAME = await this.askQuestion('📊 Ingresa el DB_NAME: ');

    // NODE_ENV
    envVars.NODE_ENV = 'development';

    // Crear contenido del archivo .env
    const envContent = this.generateEnvContent(envVars);
    
    // Escribir archivo .env
    const envPath = path.join(__dirname, '..', '..', '.env');
    fs.writeFileSync(envPath, envContent);
    
    console.log('\n✅ Archivo .env creado exitosamente!');
    console.log('📁 Ubicación:', envPath);
    
    // Verificar configuración
    console.log('\n🔍 Verificando configuración...');
    await this.verifyConfiguration();
    
    this.rl.close();
  }

  async askQuestion(question, defaultValue = '') {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} (${defaultValue}): ` : question;
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  generateEnvContent(vars) {
    return `# Configuración de la API de Google Gemini
GOOGLE_API_KEY=${vars.GOOGLE_API_KEY}

# Configuración de la base de datos MySQL
DB_HOST=${vars.DB_HOST}
DB_USER=${vars.DB_USER}
DB_PASSWORD=${vars.DB_PASSWORD}
DB_NAME=${vars.DB_NAME}

# Configuración adicional
NODE_ENV=${vars.NODE_ENV}
`;
  }

  async verifyConfiguration() {
    try {
      // Cargar variables de entorno
      require('dotenv').config();
      
      const requiredVars = ['GOOGLE_API_KEY', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
      let allConfigured = true;
      
      console.log('\n📋 Verificación de variables:');
      requiredVars.forEach(varName => {
        if (process.env[varName]) {
          console.log(`  ✅ ${varName}: CONFIGURADO`);
        } else {
          console.log(`  ❌ ${varName}: NO CONFIGURADO`);
          allConfigured = false;
        }
      });
      
      if (allConfigured) {
        console.log('\n🎉 ¡Todas las variables están configuradas!');
        console.log('💡 Ahora puedes ejecutar: node scripts/setup/verify_hybrid_system.js');
      } else {
        console.log('\n⚠️ Algunas variables no están configuradas. Revisa el archivo .env');
      }
      
    } catch (error) {
      console.error('❌ Error verificando configuración:', error.message);
    }
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const setup = new EnvSetup();
  setup.setupEnvironment().catch(console.error);
}

module.exports = EnvSetup;
