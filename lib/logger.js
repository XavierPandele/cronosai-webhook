const fs = require('fs');
const path = require('path');

class DetailedLogger {
  constructor() {
    this.logDir = path.join(__dirname, '..', 'logs');
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFileName() {
    const today = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `detailed-${today}.log`);
  }

  formatTimestamp() {
    return new Date().toISOString();
  }

  formatLogEntry(level, category, message, data = null) {
    const timestamp = this.formatTimestamp();
    const logEntry = {
      timestamp,
      level,
      category,
      message,
      data: data || null
    };
    
    return JSON.stringify(logEntry) + '\n';
  }

  writeToFile(logEntry) {
    try {
      const logFile = this.getLogFileName();
      fs.appendFileSync(logFile, logEntry);
    } catch (error) {
      console.error('[LOGGER] Error escribiendo log:', error);
    }
  }

  // Logs específicos para el sistema de reservas
  logCallStart(phoneNumber, userInput) {
    const entry = this.formatLogEntry(
      'INFO',
      'CALL_START',
      `Llamada iniciada desde ${phoneNumber}`,
      { phoneNumber, userInput, timestamp: new Date().toISOString() }
    );
    this.writeToFile(entry);
    console.log(`[CALL_START] ${phoneNumber}: "${userInput}"`);
  }

  logLanguageDetection(phoneNumber, detectedLang, confidence, method) {
    const entry = this.formatLogEntry(
      'INFO',
      'LANGUAGE_DETECTION',
      `Idioma detectado: ${detectedLang} (${confidence})`,
      { phoneNumber, detectedLang, confidence, method }
    );
    this.writeToFile(entry);
    console.log(`[LANGUAGE] ${phoneNumber}: ${detectedLang} (${confidence}) via ${method}`);
  }

  logGeminiRequest(phoneNumber, prompt, model) {
    const entry = this.formatLogEntry(
      'INFO',
      'GEMINI_REQUEST',
      `Solicitud a Gemini ${model}`,
      { 
        phoneNumber, 
        model,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 200) + '...'
      }
    );
    this.writeToFile(entry);
    console.log(`[GEMINI_REQUEST] ${phoneNumber}: Enviando a ${model}`);
  }

  logGeminiResponse(phoneNumber, response, processingTime) {
    const entry = this.formatLogEntry(
      'INFO',
      'GEMINI_RESPONSE',
      `Respuesta de Gemini recibida`,
      { 
        phoneNumber, 
        responseLength: response.length,
        processingTime,
        responsePreview: response.substring(0, 200) + '...',
        fullResponse: response
      }
    );
    this.writeToFile(entry);
    console.log(`[GEMINI_RESPONSE] ${phoneNumber}: ${processingTime}ms`);
  }

  logGeminiError(phoneNumber, error, retryCount) {
    const entry = this.formatLogEntry(
      'ERROR',
      'GEMINI_ERROR',
      `Error en Gemini: ${error.message}`,
      { 
        phoneNumber, 
        error: {
          message: error.message,
          status: error.status,
          code: error.code,
          stack: error.stack
        },
        retryCount
      }
    );
    this.writeToFile(entry);
    console.error(`[GEMINI_ERROR] ${phoneNumber}: ${error.message} (intento ${retryCount})`);
  }

  logIntentAnalysis(phoneNumber, analysis, step) {
    const entry = this.formatLogEntry(
      'INFO',
      'INTENT_ANALYSIS',
      `Análisis de intención completado`,
      { 
        phoneNumber, 
        step,
        analysis: {
          intent: analysis.intent,
          confidence: analysis.confidence,
          sentiment: analysis.sentiment,
          urgency: analysis.urgency,
          extracted_data: analysis.extracted_data,
          needs_clarification: analysis.needs_clarification,
          clarification_question: analysis.clarification_question
        }
      }
    );
    this.writeToFile(entry);
    console.log(`[INTENT] ${phoneNumber}: ${analysis.intent} (${analysis.confidence})`);
  }

  logDataExtraction(phoneNumber, extractedData, step) {
    const entry = this.formatLogEntry(
      'INFO',
      'DATA_EXTRACTION',
      `Datos extraídos del input`,
      { 
        phoneNumber, 
        step,
        extractedData,
        hasPeople: !!extractedData.people,
        hasDate: !!extractedData.date,
        hasTime: !!extractedData.time,
        hasName: !!extractedData.name,
        hasPhone: !!extractedData.phone
      }
    );
    this.writeToFile(entry);
    console.log(`[DATA] ${phoneNumber}: Extraídos ${Object.keys(extractedData).length} campos`);
  }

  logStepTransition(phoneNumber, fromStep, toStep, reason) {
    const entry = this.formatLogEntry(
      'INFO',
      'STEP_TRANSITION',
      `Transición de paso: ${fromStep} → ${toStep}`,
      { 
        phoneNumber, 
        fromStep, 
        toStep, 
        reason,
        timestamp: new Date().toISOString()
      }
    );
    this.writeToFile(entry);
    console.log(`[STEP] ${phoneNumber}: ${fromStep} → ${toStep} (${reason})`);
  }

  logResponseGeneration(phoneNumber, response, method, language) {
    const entry = this.formatLogEntry(
      'INFO',
      'RESPONSE_GENERATION',
      `Respuesta generada`,
      { 
        phoneNumber, 
        method,
        language,
        responseLength: response.length,
        responsePreview: response.substring(0, 100) + '...',
        fullResponse: response
      }
    );
    this.writeToFile(entry);
    console.log(`[RESPONSE] ${phoneNumber}: ${method} (${language})`);
  }

  logFallbackUsage(phoneNumber, reason, fallbackType) {
    const entry = this.formatLogEntry(
      'WARN',
      'FALLBACK_USAGE',
      `Usando fallback: ${reason}`,
      { 
        phoneNumber, 
        reason, 
        fallbackType,
        timestamp: new Date().toISOString()
      }
    );
    this.writeToFile(entry);
    console.warn(`[FALLBACK] ${phoneNumber}: ${reason} (${fallbackType})`);
  }

  logConversationHistory(phoneNumber, history) {
    const entry = this.formatLogEntry(
      'INFO',
      'CONVERSATION_HISTORY',
      `Historial de conversación actualizado`,
      { 
        phoneNumber, 
        historyLength: history.length,
        lastMessages: history.slice(-3),
        fullHistory: history
      }
    );
    this.writeToFile(entry);
    console.log(`[HISTORY] ${phoneNumber}: ${history.length} mensajes`);
  }

  logStateUpdate(phoneNumber, state) {
    const entry = this.formatLogEntry(
      'INFO',
      'STATE_UPDATE',
      `Estado actualizado`,
      { 
        phoneNumber, 
        state: {
          step: state.step,
          language: state.language,
          data: state.data,
          retryCount: state.retryCount,
          maxRetries: state.maxRetries
        }
      }
    );
    this.writeToFile(entry);
    console.log(`[STATE] ${phoneNumber}: ${state.step} (${state.language})`);
  }

  logError(phoneNumber, error, context) {
    const entry = this.formatLogEntry(
      'ERROR',
      'SYSTEM_ERROR',
      `Error del sistema: ${error.message}`,
      { 
        phoneNumber, 
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        context
      }
    );
    this.writeToFile(entry);
    console.error(`[ERROR] ${phoneNumber}: ${error.message}`);
  }

  logMetrics(phoneNumber, metrics) {
    const entry = this.formatLogEntry(
      'INFO',
      'METRICS',
      `Métricas de la llamada`,
      { 
        phoneNumber, 
        metrics: {
          totalTime: metrics.totalTime,
          geminiTime: metrics.geminiTime,
          processingTime: metrics.processingTime,
          intent: metrics.intent,
          confidence: metrics.confidence,
          sentiment: metrics.sentiment,
          urgency: metrics.urgency,
          step: metrics.step,
          nextStep: metrics.nextStep,
          language: metrics.language,
          fallbackUsed: metrics.fallbackUsed
        }
      }
    );
    this.writeToFile(entry);
    console.log(`[METRICS] ${phoneNumber}: ${metrics.totalTime}ms total`);
  }

  // Método para limpiar logs antiguos (mantener solo últimos 7 días)
  cleanOldLogs() {
    try {
      const files = fs.readdirSync(this.logDir);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      files.forEach(file => {
        if (file.startsWith('detailed-') && file.endsWith('.log')) {
          const filePath = path.join(this.logDir, file);
          const stats = fs.statSync(filePath);
          
          if (stats.mtime < sevenDaysAgo) {
            fs.unlinkSync(filePath);
            console.log(`[LOGGER] Log antiguo eliminado: ${file}`);
          }
        }
      });
    } catch (error) {
      console.error('[LOGGER] Error limpiando logs:', error);
    }
  }
}

// Instancia singleton
const logger = new DetailedLogger();

// Limpiar logs antiguos al inicializar
logger.cleanOldLogs();

module.exports = logger;
