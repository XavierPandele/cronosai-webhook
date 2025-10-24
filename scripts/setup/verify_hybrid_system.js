// Cargar variables de entorno
require('dotenv').config();

const fs = require('fs');
const path = require('path');

class HybridSystemVerifier {
  constructor() {
    this.checks = [];
    this.errors = [];
    this.warnings = [];
  }

  // Verificar archivos requeridos
  checkRequiredFiles() {
    console.log('📁 Verificando archivos requeridos...');
    
    const requiredFiles = [
      'api/twilio-call-hybrid.js',
      'lib/logger.js',
      'lib/database.js',
      'lib/utils.js',
      'scripts/logging/analyze_logs.js',
      'scripts/logging/view_logs.js',
      'tests/test_hybrid_system.js'
    ];

    requiredFiles.forEach(file => {
      if (fs.existsSync(file)) {
        console.log(`  ✅ ${file}`);
        this.checks.push({ type: 'file', name: file, status: 'ok' });
      } else {
        console.log(`  ❌ ${file} - NO ENCONTRADO`);
        this.errors.push(`Archivo requerido no encontrado: ${file}`);
      }
    });
  }

  // Verificar variables de entorno
  checkEnvironmentVariables() {
    console.log('\n🔧 Verificando variables de entorno...');
    
    const requiredVars = [
      'GOOGLE_API_KEY',
      'DB_HOST',
      'DB_USER', 
      'DB_PASS',
      'DB_NAME'
    ];

    requiredVars.forEach(varName => {
      if (process.env[varName]) {
        console.log(`  ✅ ${varName}`);
        this.checks.push({ type: 'env', name: varName, status: 'ok' });
      } else {
        console.log(`  ❌ ${varName} - NO CONFIGURADO`);
        this.errors.push(`Variable de entorno no configurada: ${varName}`);
      }
    });
  }

  // Verificar dependencias
  checkDependencies() {
    console.log('\n📦 Verificando dependencias...');
    
    const requiredDeps = [
      'dotenv',
      '@google/generative-ai',
      'mysql2'
    ];

    requiredDeps.forEach(dep => {
      try {
        require(dep);
        console.log(`  ✅ ${dep}`);
        this.checks.push({ type: 'dep', name: dep, status: 'ok' });
      } catch (error) {
        console.log(`  ❌ ${dep} - NO INSTALADO`);
        this.errors.push(`Dependencia no instalada: ${dep}`);
      }
    });
  }

  // Verificar configuración de Gemini
  async checkGeminiConfiguration() {
    console.log('\n🤖 Verificando configuración de Gemini...');
    
    if (!process.env.GOOGLE_API_KEY) {
      console.log('  ❌ GOOGLE_API_KEY no configurado');
      this.errors.push('GOOGLE_API_KEY no configurado');
      return;
    }

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        generationConfig: {
          temperature: 0.1,
          topP: 0.5,
          topK: 20,
          maxOutputTokens: 10,
        }
      });

      // Probar con una solicitud simple
      const result = await model.generateContent('Responde solo: es');
      const response = await result.response;
      const text = response.text().trim();
      
      if (text.toLowerCase().includes('es')) {
        console.log('  ✅ Gemini configurado correctamente');
        this.checks.push({ type: 'gemini', name: 'configuration', status: 'ok' });
      } else {
        console.log('  ⚠️ Gemini responde pero con formato inesperado');
        this.warnings.push('Gemini responde pero el formato puede ser inesperado');
      }
    } catch (error) {
      console.log(`  ❌ Error con Gemini: ${error.message}`);
      this.errors.push(`Error de Gemini: ${error.message}`);
    }
  }

  // Verificar base de datos
  async checkDatabase() {
    console.log('\n🗄️ Verificando conexión a base de datos...');
    
    try {
      const { createConnection } = require('../../lib/database');
      const connection = await createConnection();
      
      // Probar consulta simple
      const [rows] = await connection.execute('SELECT 1 as test');
      await connection.end();
      
      console.log('  ✅ Base de datos conectada correctamente');
      this.checks.push({ type: 'database', name: 'connection', status: 'ok' });
    } catch (error) {
      console.log(`  ❌ Error de base de datos: ${error.message}`);
      this.errors.push(`Error de base de datos: ${error.message}`);
    }
  }

  // Verificar sistema de logging
  checkLoggingSystem() {
    console.log('\n📝 Verificando sistema de logging...');
    
    try {
      const logger = require('../../lib/logger');
      
      // Probar logging
      logger.logCallStart('+34600000001', 'Test message');
      console.log('  ✅ Sistema de logging funcionando');
      this.checks.push({ type: 'logging', name: 'system', status: 'ok' });
    } catch (error) {
      console.log(`  ❌ Error de logging: ${error.message}`);
      this.errors.push(`Error de logging: ${error.message}`);
    }
  }

  // Verificar directorio de logs
  checkLogsDirectory() {
    console.log('\n📁 Verificando directorio de logs...');
    
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    
    if (fs.existsSync(logsDir)) {
      console.log('  ✅ Directorio de logs existe');
      this.checks.push({ type: 'logs', name: 'directory', status: 'ok' });
    } else {
      console.log('  ⚠️ Directorio de logs no existe, se creará automáticamente');
      this.warnings.push('Directorio de logs no existe, se creará automáticamente');
    }
  }

  // Verificar sistema híbrido
  async checkHybridSystem() {
    console.log('\n🔄 Verificando sistema híbrido...');
    
    try {
      // Importar el sistema híbrido
      const hybridSystem = require('../../api/twilio-call-hybrid');
      
      if (typeof hybridSystem === 'function') {
        console.log('  ✅ Sistema híbrido cargado correctamente');
        this.checks.push({ type: 'hybrid', name: 'system', status: 'ok' });
      } else {
        console.log('  ❌ Sistema híbrido no es una función');
        this.errors.push('Sistema híbrido no es una función');
      }
    } catch (error) {
      console.log(`  ❌ Error cargando sistema híbrido: ${error.message}`);
      this.errors.push(`Error cargando sistema híbrido: ${error.message}`);
    }
  }

  // Ejecutar todas las verificaciones
  async runAllChecks() {
    console.log('🔍 VERIFICACIÓN DEL SISTEMA HÍBRIDO');
    console.log('===================================');
    
    this.checkRequiredFiles();
    this.checkEnvironmentVariables();
    this.checkDependencies();
    await this.checkGeminiConfiguration();
    await this.checkDatabase();
    this.checkLoggingSystem();
    this.checkLogsDirectory();
    await this.checkHybridSystem();
    
    this.generateReport();
  }

  // Generar reporte final
  generateReport() {
    console.log('\n📊 REPORTE DE VERIFICACIÓN');
    console.log('============================');
    
    const totalChecks = this.checks.length;
    const successfulChecks = this.checks.filter(c => c.status === 'ok').length;
    const errorCount = this.errors.length;
    const warningCount = this.warnings.length;
    
    console.log(`\n📈 RESUMEN:`);
    console.log(`  Total de verificaciones: ${totalChecks}`);
    console.log(`  Exitosas: ${successfulChecks}`);
    console.log(`  Errores: ${errorCount}`);
    console.log(`  Advertencias: ${warningCount}`);
    
    if (errorCount === 0) {
      console.log('\n✅ SISTEMA LISTO PARA IMPLEMENTACIÓN');
      console.log('   El sistema híbrido está configurado correctamente');
      console.log('   Puedes proceder con las pruebas telefónicas');
    } else {
      console.log('\n❌ SISTEMA NO LISTO');
      console.log('   Hay errores que deben corregirse antes de implementar');
    }
    
    if (this.errors.length > 0) {
      console.log('\n🚨 ERRORES ENCONTRADOS:');
      this.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    if (this.warnings.length > 0) {
      console.log('\n⚠️ ADVERTENCIAS:');
      this.warnings.forEach((warning, index) => {
        console.log(`  ${index + 1}. ${warning}`);
      });
    }
    
    // Recomendaciones
    console.log('\n💡 RECOMENDACIONES:');
    
    if (errorCount === 0) {
      console.log('  1. ✅ Sistema listo para pruebas telefónicas');
      console.log('  2. 📞 Configurar endpoint en Twilio: /api/twilio-call-hybrid');
      console.log('  3. 🧪 Realizar pruebas básicas primero');
      console.log('  4. 📊 Monitorear logs durante las pruebas');
    } else {
      console.log('  1. 🔧 Corregir errores antes de implementar');
      console.log('  2. 🔄 Ejecutar verificación nuevamente');
      console.log('  3. 📞 Contactar soporte si persisten los errores');
    }
    
    console.log('\n📚 DOCUMENTACIÓN:');
    console.log('  - docs/IMPLEMENTATION_GUIDE.md - Guía de implementación');
    console.log('  - docs/HYBRID_SYSTEM_COMPARISON.md - Comparación de sistemas');
    console.log('  - tests/test_hybrid_system.js - Pruebas del sistema');
    
    console.log('\n🔧 COMANDOS ÚTILES:');
    console.log('  node scripts/setup/verify_hybrid_system.js - Verificar sistema');
    console.log('  node tests/test_hybrid_system.js - Probar sistema');
    console.log('  node scripts/logging/analyze_logs.js - Analizar logs');
    console.log('  node scripts/logging/view_logs.js watch - Ver logs en tiempo real');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const verifier = new HybridSystemVerifier();
  verifier.runAllChecks().catch(console.error);
}

module.exports = HybridSystemVerifier;
