// Cargar variables de entorno
require('dotenv').config();

const logger = require('../../lib/logger');

// Simular una llamada completa para generar logs de ejemplo
async function simulateCall(phoneNumber) {
  console.log(`\n🧪 Simulando llamada desde ${phoneNumber}`);
  console.log('='.repeat(50));
  
  // 1. Inicio de llamada
  logger.logCallStart(phoneNumber, 'Hola, quiero hacer una reserva');
  
  // 2. Detección de idioma
  logger.logLanguageDetection(phoneNumber, 'es', 0.9, 'gemini');
  
  // 3. Solicitud a Gemini
  const prompt = `Eres un experto en análisis de intenciones...`;
  logger.logGeminiRequest(phoneNumber, prompt, 'gemini-2.0-flash-exp');
  
  // 4. Respuesta de Gemini (simulada)
  const geminiResponse = `{
    "intent": "reservation",
    "confidence": 0.85,
    "extracted_data": {
      "people": 4,
      "date": null,
      "time": null,
      "name": null,
      "phone": null
    },
    "sentiment": "positive",
    "urgency": "normal",
    "next_step": "ask_date",
    "response_type": "confirmation",
    "needs_clarification": false,
    "clarification_question": null
  }`;
  
  logger.logGeminiResponse(phoneNumber, geminiResponse, 1200);
  
  // 5. Análisis de intención
  const analysis = JSON.parse(geminiResponse);
  logger.logIntentAnalysis(phoneNumber, analysis, 'greeting');
  
  // 6. Extracción de datos
  logger.logDataExtraction(phoneNumber, analysis.extracted_data, 'greeting');
  
  // 7. Transición de paso
  logger.logStepTransition(phoneNumber, 'greeting', 'ask_date', 'Datos de personas extraídos');
  
  // 8. Generación de respuesta
  const response = 'Perfecto, para 4 personas. ¿Para qué fecha necesita la reserva?';
  logger.logResponseGeneration(phoneNumber, response, 'intelligent', 'es');
  
  // 9. Historial de conversación
  const conversationHistory = [
    { role: 'user', message: 'Hola, quiero hacer una reserva', timestamp: new Date().toISOString() },
    { role: 'bot', message: response, timestamp: new Date().toISOString() }
  ];
  logger.logConversationHistory(phoneNumber, conversationHistory);
  
  // 10. Actualización de estado
  const state = {
    step: 'ask_date',
    language: 'es',
    data: { people: 4 },
    retryCount: 0,
    maxRetries: 3
  };
  logger.logStateUpdate(phoneNumber, state);
  
  // 11. Métricas finales
  const metrics = {
    totalTime: 1500,
    geminiTime: 1200,
    processingTime: 1500,
    intent: 'reservation',
    confidence: 0.85,
    sentiment: 'positive',
    urgency: 'normal',
    step: 'greeting',
    nextStep: 'ask_date',
    language: 'es',
    fallbackUsed: false
  };
  logger.logMetrics(phoneNumber, metrics);
  
  console.log('✅ Simulación completada');
}

// Simular llamada con problemas
async function simulateProblematicCall(phoneNumber) {
  console.log(`\n🚨 Simulando llamada problemática desde ${phoneNumber}`);
  console.log('='.repeat(50));
  
  // 1. Inicio de llamada
  logger.logCallStart(phoneNumber, 'Hello, I want to make a reservation');
  
  // 2. Detección de idioma incorrecta
  logger.logLanguageDetection(phoneNumber, 'en', 0.7, 'gemini');
  
  // 3. Error de Gemini
  const error = new Error('Model is overloaded');
  error.status = 503;
  logger.logGeminiError(phoneNumber, error, 1);
  
  // 4. Uso de fallback
  logger.logFallbackUsage(phoneNumber, 'Modelo sobrecargado (503)', 'getFallbackIntent');
  
  // 5. Cambio de idioma
  logger.logLanguageDetection(phoneNumber, 'es', 0.5, 'fallback');
  
  // 6. Error del sistema
  const systemError = new Error('Database connection failed');
  logger.logError(phoneNumber, systemError, 'saveReservation');
  
  // 7. Métricas con problemas
  const metrics = {
    totalTime: 5000,
    geminiTime: 0,
    processingTime: 5000,
    intent: 'clarification',
    confidence: 0.3,
    sentiment: 'frustrated',
    urgency: 'high',
    step: 'error',
    nextStep: 'error',
    language: 'es',
    fallbackUsed: true
  };
  logger.logMetrics(phoneNumber, metrics);
  
  console.log('⚠️ Simulación problemática completada');
}

// Función principal
async function main() {
  console.log('🧪 GENERADOR DE LOGS DE PRUEBA');
  console.log('===============================');
  
  // Simular llamadas normales
  await simulateCall('+1234567890');
  await simulateCall('+0987654321');
  
  // Simular llamada problemática
  await simulateProblematicCall('+5555555555');
  
  console.log('\n📊 LOGS GENERADOS');
  console.log('================');
  console.log('Los logs se han guardado en: ./logs/detailed-[fecha].log');
  console.log('');
  console.log('Para ver los logs:');
  console.log('  node view_logs.js summary +1234567890');
  console.log('  node view_logs.js watch');
  console.log('');
  console.log('✅ Pruebas completadas');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { simulateCall, simulateProblematicCall };
