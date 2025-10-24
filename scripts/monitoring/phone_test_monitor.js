// Cargar variables de entorno
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');

class PhoneTestMonitor {
  constructor() {
    this.logDir = path.join(__dirname, '..', '..', 'logs');
    this.isMonitoring = false;
    this.lastLogSize = 0;
    this.testResults = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      languages: {},
      averageResponseTime: 0,
      errors: []
    };
  }

  // Iniciar monitoreo en tiempo real
  startMonitoring() {
    console.log('📞 MONITOR DE PRUEBAS TELEFÓNICAS');
    console.log('==================================');
    console.log('🔍 Monitoreando logs en tiempo real...');
    console.log('📊 Presiona Ctrl+C para detener\n');
    
    this.isMonitoring = true;
    this.monitorLogs();
  }

  // Monitorear archivos de log
  monitorLogs() {
    const logFile = this.getCurrentLogFile();
    
    if (!fs.existsSync(logFile)) {
      console.log('⏳ Esperando archivo de log...');
      setTimeout(() => this.monitorLogs(), 1000);
      return;
    }

    // Verificar si el archivo ha cambiado
    const stats = fs.statSync(logFile);
    if (stats.size > this.lastLogSize) {
      this.readNewLogs(logFile);
      this.lastLogSize = stats.size;
    }

    if (this.isMonitoring) {
      setTimeout(() => this.monitorLogs(), 500);
    }
  }

  // Leer nuevos logs
  readNewLogs(logFile) {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Procesar solo las líneas nuevas
      const newLines = lines.slice(this.lastLogSize > 0 ? Math.floor(this.lastLogSize / 100) : 0);
      
      newLines.forEach(line => {
        try {
          const logEntry = JSON.parse(line);
          this.processLogEntry(logEntry);
        } catch (error) {
          // Ignorar líneas que no son JSON válido
        }
      });
    } catch (error) {
      console.error('Error leyendo logs:', error.message);
    }
  }

  // Procesar entrada de log
  processLogEntry(logEntry) {
    const { type, phoneNumber, message, data } = logEntry;
    
    switch (type) {
      case 'CALL_START':
        this.handleCallStart(phoneNumber, message);
        break;
      case 'LANGUAGE_DETECTION':
        this.handleLanguageDetection(phoneNumber, data);
        break;
      case 'INTENT_ANALYSIS':
        this.handleIntentAnalysis(phoneNumber, data);
        break;
      case 'STEP_TRANSITION':
        this.handleStepTransition(phoneNumber, data);
        break;
      case 'RESPONSE_GENERATION':
        this.handleResponseGeneration(phoneNumber, data);
        break;
      case 'METRICS':
        this.handleMetrics(phoneNumber, data);
        break;
      case 'GEMINI_ERROR':
        this.handleError(phoneNumber, 'Gemini Error', data);
        break;
      case 'SYSTEM_ERROR':
        this.handleError(phoneNumber, 'System Error', data);
        break;
    }
  }

  // Manejar inicio de llamada
  handleCallStart(phoneNumber, userInput) {
    this.testResults.totalCalls++;
    console.log(`\n📞 NUEVA LLAMADA: ${phoneNumber}`);
    console.log(`   💬 Input: "${userInput}"`);
    console.log(`   ⏰ Timestamp: ${new Date().toLocaleTimeString()}`);
  }

  // Manejar detección de idioma
  handleLanguageDetection(phoneNumber, data) {
    const { detectedLanguage, confidence, method } = data;
    console.log(`   🌍 Idioma detectado: ${detectedLanguage} (${confidence}) via ${method}`);
    
    if (!this.testResults.languages[detectedLanguage]) {
      this.testResults.languages[detectedLanguage] = 0;
    }
    this.testResults.languages[detectedLanguage]++;
  }

  // Manejar análisis de intención
  handleIntentAnalysis(phoneNumber, data) {
    const { intent, confidence, sentiment, urgency } = data;
    console.log(`   🎯 Intención: ${intent} (${confidence})`);
    console.log(`   😊 Sentimiento: ${sentiment}, Urgencia: ${urgency}`);
  }

  // Manejar transición de paso
  handleStepTransition(phoneNumber, data) {
    const { fromStep, toStep, reason } = data;
    console.log(`   🔄 Paso: ${fromStep} → ${toStep} (${reason})`);
  }

  // Manejar generación de respuesta
  handleResponseGeneration(phoneNumber, data) {
    const { response, type, language } = data;
    console.log(`   💬 Respuesta (${type}): "${response.substring(0, 50)}..."`);
    console.log(`   🗣️ Idioma: ${language}`);
  }

  // Manejar métricas
  handleMetrics(phoneNumber, data) {
    const { totalTime, intent, confidence, step, language, systemType } = data;
    console.log(`   ⏱️ Tiempo: ${totalTime}ms`);
    console.log(`   📊 Sistema: ${systemType || 'hybrid'}`);
    
    // Actualizar métricas
    this.testResults.averageResponseTime = 
      (this.testResults.averageResponseTime + totalTime) / 2;
    
    // Determinar si la llamada fue exitosa
    if (step === 'complete' || step === 'finished') {
      this.testResults.successfulCalls++;
      console.log(`   ✅ LLAMADA COMPLETADA EXITOSAMENTE`);
    }
  }

  // Manejar errores
  handleError(phoneNumber, errorType, data) {
    console.log(`   ❌ ERROR (${errorType}): ${data.error || 'Unknown error'}`);
    this.testResults.failedCalls++;
    this.testResults.errors.push({
      phoneNumber,
      errorType,
      error: data.error,
      timestamp: new Date().toISOString()
    });
  }

  // Obtener archivo de log actual
  getCurrentLogFile() {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return path.join(this.logDir, `detailed-${year}-${month}-${day}.log`);
  }

  // Mostrar resumen de pruebas
  showTestSummary() {
    console.log('\n📊 RESUMEN DE PRUEBAS TELEFÓNICAS');
    console.log('===================================');
    console.log(`📞 Total de llamadas: ${this.testResults.totalCalls}`);
    console.log(`✅ Exitosas: ${this.testResults.successfulCalls}`);
    console.log(`❌ Fallidas: ${this.testResults.failedCalls}`);
    console.log(`⏱️ Tiempo promedio: ${this.testResults.averageResponseTime.toFixed(0)}ms`);
    
    console.log('\n🌍 Idiomas detectados:');
    Object.entries(this.testResults.languages).forEach(([lang, count]) => {
      console.log(`  ${lang}: ${count} llamadas`);
    });
    
    if (this.testResults.errors.length > 0) {
      console.log('\n❌ Errores encontrados:');
      this.testResults.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.phoneNumber}: ${error.errorType} - ${error.error}`);
      });
    }
    
    // Calcular tasa de éxito
    const successRate = this.testResults.totalCalls > 0 
      ? (this.testResults.successfulCalls / this.testResults.totalCalls * 100).toFixed(1)
      : 0;
    
    console.log(`\n📈 Tasa de éxito: ${successRate}%`);
    
    if (successRate >= 90) {
      console.log('🎉 EXCELENTE RENDIMIENTO');
    } else if (successRate >= 80) {
      console.log('✅ BUEN RENDIMIENTO');
    } else if (successRate >= 70) {
      console.log('⚠️ RENDIMIENTO ACEPTABLE');
    } else {
      console.log('❌ RENDIMIENTO BAJO - REVISAR CONFIGURACIÓN');
    }
  }

  // Detener monitoreo
  stopMonitoring() {
    this.isMonitoring = false;
    console.log('\n🛑 Monitoreo detenido');
    this.showTestSummary();
  }

  // Configurar manejo de señales
  setupSignalHandlers() {
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Deteniendo monitoreo...');
      this.stopMonitoring();
      process.exit(0);
    });
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const monitor = new PhoneTestMonitor();
  monitor.setupSignalHandlers();
  monitor.startMonitoring();
}

module.exports = PhoneTestMonitor;
