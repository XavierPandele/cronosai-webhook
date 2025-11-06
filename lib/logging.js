/**
 * Sistema de logging estructurado
 * Niveles: error, warn, info, debug
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

const currentLogLevel = process.env.LOG_LEVEL || 'INFO';
const logLevelValue = LOG_LEVELS[currentLogLevel.toUpperCase()] || LOG_LEVELS.INFO;

/**
 * Formatea el mensaje de log con timestamp y nivel
 */
function formatLog(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;
  
  if (data) {
    return `${prefix} ${message} ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
  }
  return `${prefix} ${message}`;
}

/**
 * Log de error
 */
function error(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.ERROR) {
    console.error(formatLog('ERROR', message, data));
  }
}

/**
 * Log de advertencia
 */
function warn(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.WARN) {
    console.warn(formatLog('WARN', message, data));
  }
}

/**
 * Log de información
 */
function info(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.INFO) {
    console.log(formatLog('INFO', message, data));
  }
}

/**
 * Log de debug
 */
function debug(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.DEBUG) {
    console.log(formatLog('DEBUG', message, data));
  }
}

/**
 * Log específico para Gemini
 */
function gemini(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.DEBUG) {
    console.log(formatLog('GEMINI', message, data));
  }
}

/**
 * Log específico para capacidad
 */
function capacity(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.INFO) {
    console.log(formatLog('CAPACITY', message, data));
  }
}

/**
 * Log específico para reservas
 */
function reservation(message, data = null) {
  if (logLevelValue >= LOG_LEVELS.INFO) {
    console.log(formatLog('RESERVATION', message, data));
  }
}

module.exports = {
  error,
  warn,
  info,
  debug,
  gemini,
  capacity,
  reservation
};

