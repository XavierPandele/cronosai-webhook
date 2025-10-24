// Cargar variables de entorno
require('dotenv').config();

const logger = require('../../lib/logger');

// Simulaciones por idioma con diferentes escenarios
class MultiLanguageSimulator {
  constructor() {
    this.phoneNumbers = {
      es: '+34600000001',
      en: '+12345678901', 
      de: '+49300000001',
      it: '+39300000001',
      fr: '+33300000001',
      pt: '+55300000001'
    };
  }

  // Simulación en español
  async simulateSpanish() {
    console.log('\n🇪🇸 SIMULACIÓN EN ESPAÑOL');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.es;
    
    // Escenario 1: Llamada normal
    await this.simulateCall(phoneNumber, 'es', [
      'Hola, quiero hacer una reserva',
      'Para 4 personas',
      'Para mañana',
      'A las 8 de la tarde',
      'Me llamo Juan Pérez'
    ]);
    
    // Escenario 2: Llamada con confusión
    await this.simulateCall(phoneNumber + '1', 'es', [
      'Hola',
      'No entiendo qué necesito',
      'Para 2 personas',
      'El viernes',
      'A las 7',
      'Soy María García'
    ]);
    
    // Escenario 3: Llamada con frustración
    await this.simulateCall(phoneNumber + '2', 'es', [
      'Estoy muy frustrado con este sistema',
      'Solo quiero reservar para 3 personas',
      'Para el sábado',
      'A las 9',
      'Carlos López'
    ]);
  }

  // Simulación en inglés
  async simulateEnglish() {
    console.log('\n🇺🇸 SIMULACIÓN EN INGLÉS');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.en;
    
    // Escenario 1: Llamada normal
    await this.simulateCall(phoneNumber, 'en', [
      'Hello, I want to make a reservation',
      'For 2 people',
      'For tomorrow',
      'At 7 PM',
      'My name is John Smith'
    ]);
    
    // Escenario 2: Llamada con acento
    await this.simulateCall(phoneNumber + '1', 'en', [
      'Hi there',
      'I need a table for 6 people',
      'Next Friday',
      'Around 8 o\'clock',
      'I\'m Sarah Johnson'
    ]);
    
    // Escenario 3: Llamada con confusión
    await this.simulateCall(phoneNumber + '2', 'en', [
      'Hello',
      'I don\'t understand what you need',
      'For 4 people',
      'This weekend',
      'At 6:30',
      'Mike Wilson'
    ]);
  }

  // Simulación en alemán
  async simulateGerman() {
    console.log('\n🇩🇪 SIMULACIÓN EN ALEMÁN');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.de;
    
    // Escenario 1: Llamada normal
    await this.simulateCall(phoneNumber, 'de', [
      'Hallo, ich möchte eine Reservierung',
      'Für 4 Personen',
      'Für morgen',
      'Um 19 Uhr',
      'Ich heiße Hans Müller'
    ]);
    
    // Escenario 2: Llamada con confusión
    await this.simulateCall(phoneNumber + '1', 'de', [
      'Guten Tag',
      'Ich verstehe nicht, was Sie brauchen',
      'Für 2 Personen',
      'Am Freitag',
      'Um 18:30',
      'Anna Schmidt'
    ]);
    
    // Escenario 3: Llamada con frustración
    await this.simulateCall(phoneNumber + '2', 'de', [
      'Ich bin frustriert mit diesem System',
      'Ich will nur für 3 Personen reservieren',
      'Für Samstag',
      'Um 20 Uhr',
      'Peter Weber'
    ]);
  }

  // Simulación en italiano
  async simulateItalian() {
    console.log('\n🇮🇹 SIMULACIÓN EN ITALIANO');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.it;
    
    await this.simulateCall(phoneNumber, 'it', [
      'Ciao, vorrei fare una prenotazione',
      'Per 4 persone',
      'Per domani',
      'Alle 19:30',
      'Mi chiamo Marco Rossi'
    ]);
  }

  // Simulación en francés
  async simulateFrench() {
    console.log('\n🇫🇷 SIMULACIÓN EN FRANCÉS');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.fr;
    
    await this.simulateCall(phoneNumber, 'fr', [
      'Bonjour, je voudrais faire une réservation',
      'Pour 2 personnes',
      'Pour demain',
      'À 20 heures',
      'Je m\'appelle Pierre Dubois'
    ]);
  }

  // Simulación en portugués
  async simulatePortuguese() {
    console.log('\n🇵🇹 SIMULACIÓN EN PORTUGUÉS');
    console.log('='.repeat(50));
    
    const phoneNumber = this.phoneNumbers.pt;
    
    await this.simulateCall(phoneNumber, 'pt', [
      'Olá, gostaria de fazer uma reserva',
      'Para 3 pessoas',
      'Para amanhã',
      'Às 19:30',
      'Meu nome é João Silva'
    ]);
  }

  // Simular una llamada completa
  async simulateCall(phoneNumber, language, messages) {
    console.log(`\n📞 Llamada desde ${phoneNumber} (${language.toUpperCase()})`);
    console.log('-'.repeat(40));
    
    // 1. Inicio de llamada
    logger.logCallStart(phoneNumber, messages[0]);
    
    // 2. Detección de idioma
    const confidence = this.getLanguageConfidence(language);
    logger.logLanguageDetection(phoneNumber, language, confidence, 'gemini');
    
    // 3. Procesar cada mensaje
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const step = this.getStepFromIndex(i);
      
      console.log(`  ${i + 1}. "${message}"`);
      
      // Simular solicitud a Gemini
      await this.simulateGeminiRequest(phoneNumber, message, step, language);
      
      // Simular respuesta de Gemini
      const geminiResponse = this.generateGeminiResponse(message, step, language);
      await this.simulateGeminiResponse(phoneNumber, geminiResponse);
      
      // Simular análisis de intención
      const analysis = JSON.parse(geminiResponse);
      logger.logIntentAnalysis(phoneNumber, analysis, step);
      
      // Simular extracción de datos
      if (analysis.extracted_data) {
        logger.logDataExtraction(phoneNumber, analysis.extracted_data, step);
      }
      
      // Simular transición de paso
      const nextStep = this.getNextStep(step, analysis);
      logger.logStepTransition(phoneNumber, step, nextStep, 'Procesando mensaje');
      
      // Simular generación de respuesta
      const response = this.generateResponse(nextStep, language);
      logger.logResponseGeneration(phoneNumber, response, 'intelligent', language);
      
      // Simular historial de conversación
      const conversationHistory = this.buildConversationHistory(messages.slice(0, i + 1), language);
      logger.logConversationHistory(phoneNumber, conversationHistory);
      
      // Simular actualización de estado
      const state = {
        step: nextStep,
        language: language,
        data: this.extractDataFromMessages(messages.slice(0, i + 1)),
        retryCount: 0,
        maxRetries: 3
      };
      logger.logStateUpdate(phoneNumber, state);
      
      // Simular métricas
      const metrics = {
        totalTime: 1000 + Math.random() * 2000,
        geminiTime: 800 + Math.random() * 1000,
        processingTime: 1000 + Math.random() * 2000,
        intent: analysis.intent,
        confidence: analysis.confidence,
        sentiment: analysis.sentiment,
        urgency: analysis.urgency,
        step: step,
        nextStep: nextStep,
        language: language,
        fallbackUsed: false
      };
      logger.logMetrics(phoneNumber, metrics);
      
      // Simular errores ocasionales
      if (Math.random() < 0.1) { // 10% de probabilidad de error
        await this.simulateError(phoneNumber, language);
      }
    }
    
    console.log(`  ✅ Llamada completada`);
  }

  // Simular solicitud a Gemini
  async simulateGeminiRequest(phoneNumber, message, step, language) {
    const prompt = `Analiza la intención del cliente en ${language}: "${message}"`;
    logger.logGeminiRequest(phoneNumber, prompt, 'gemini-2.0-flash-exp');
  }

  // Simular respuesta de Gemini
  async simulateGeminiResponse(phoneNumber, response) {
    const processingTime = 800 + Math.random() * 1000;
    logger.logGeminiResponse(phoneNumber, response, processingTime);
  }

  // Generar respuesta de Gemini simulada
  generateGeminiResponse(message, step, language) {
    const lowerMessage = message.toLowerCase();
    
    // Detectar intención básica
    let intent = 'reservation';
    let confidence = 0.8;
    let sentiment = 'positive';
    let urgency = 'normal';
    let extractedData = {};
    
    // Detectar números
    const numbers = message.match(/\b(\d+)\b/g);
    if (numbers && numbers.length > 0) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 20) {
        extractedData.people = num;
      }
    }
    
    // Detectar fechas
    if (lowerMessage.includes('mañana') || lowerMessage.includes('tomorrow') || lowerMessage.includes('morgen')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      extractedData.date = tomorrow.toISOString().split('T')[0];
    }
    
    // Detectar horas
    const timeMatch = message.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|de la tarde|de la noche|Uhr|heures)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3];
      
      if (period && (period.toLowerCase().includes('pm') || period.toLowerCase().includes('tarde') || period.toLowerCase().includes('noche'))) {
        if (hour < 12) hour += 12;
      }
      
      extractedData.time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    // Detectar nombres
    const namePatterns = [
      /me llamo (\w+)/i,
      /mi nombre es (\w+)/i,
      /my name is (\w+)/i,
      /ich heiße (\w+)/i,
      /mi chiamo (\w+)/i,
      /je m'appelle (\w+)/i,
      /meu nome é (\w+)/i
    ];
    
    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match) {
        extractedData.name = match[1];
        break;
      }
    }
    
    // Detectar frustración
    if (lowerMessage.includes('frustrado') || lowerMessage.includes('frustrated') || lowerMessage.includes('frustriert')) {
      sentiment = 'frustrated';
      urgency = 'high';
      confidence = 0.9;
    }
    
    // Detectar confusión
    if (lowerMessage.includes('no entiendo') || lowerMessage.includes('don\'t understand') || lowerMessage.includes('verstehe nicht')) {
      sentiment = 'confused';
      intent = 'clarification';
      confidence = 0.7;
    }
    
    // Determinar siguiente paso
    let nextStep = step;
    if (extractedData.people && step === 'greeting') nextStep = 'ask_date';
    else if (extractedData.date && step === 'ask_people') nextStep = 'ask_time';
    else if (extractedData.time && step === 'ask_date') nextStep = 'ask_name';
    else if (extractedData.name && step === 'ask_time') nextStep = 'ask_phone';
    else if (step === 'ask_phone') nextStep = 'complete';
    
    return JSON.stringify({
      intent: intent,
      confidence: confidence,
      extracted_data: extractedData,
      sentiment: sentiment,
      urgency: urgency,
      next_step: nextStep,
      response_type: 'question',
      needs_clarification: false,
      clarification_question: null
    });
  }

  // Generar respuesta del sistema
  generateResponse(step, language) {
    const responses = {
      greeting: {
        es: '¡Hola! Bienvenido al restaurante. ¿Para cuántas personas será la reserva?',
        en: 'Hello! Welcome to the restaurant. How many people will the reservation be for?',
        de: 'Hallo! Willkommen im Restaurant. Für wie viele Personen soll die Reservierung sein?',
        it: 'Ciao! Benvenuto al ristorante. Per quante persone sarà la prenotazione?',
        fr: 'Bonjour! Bienvenue au restaurant. Pour combien de personnes sera la réservation?',
        pt: 'Olá! Bem-vindo ao restaurante. Para quantas pessoas será a reserva?'
      },
      ask_people: {
        es: '¿Para cuántas personas será la reserva?',
        en: 'How many people will the reservation be for?',
        de: 'Für wie viele Personen soll die Reservierung sein?',
        it: 'Per quante persone sarà la prenotazione?',
        fr: 'Pour combien de personnes sera la réservation?',
        pt: 'Para quantas pessoas será a reserva?'
      },
      ask_date: {
        es: '¿Para qué fecha necesita la reserva?',
        en: 'What date do you need the reservation for?',
        de: 'Für welches Datum benötigen Sie die Reservierung?',
        it: 'Per quale data avete bisogno della prenotazione?',
        fr: 'Pour quelle date avez-vous besoin de la réservation?',
        pt: 'Para que data vocês precisam da reserva?'
      },
      ask_time: {
        es: '¿A qué hora prefieren venir?',
        en: 'What time would you prefer to come?',
        de: 'Um welche Uhrzeit möchten Sie kommen?',
        it: 'A che ora preferite venire?',
        fr: 'À quelle heure préférez-vous venir?',
        pt: 'Que horas preferem vir?'
      },
      ask_name: {
        es: '¿Cómo se llama?',
        en: 'What\'s your name?',
        de: 'Wie heißen Sie?',
        it: 'Come si chiama?',
        fr: 'Comment vous appelez-vous?',
        pt: 'Como se chama?'
      },
      ask_phone: {
        es: '¿Podría confirmar su número de teléfono?',
        en: 'Could you confirm your phone number?',
        de: 'Könnten Sie Ihre Telefonnummer bestätigen?',
        it: 'Potrebbe confermare il suo numero di telefono?',
        fr: 'Pourriez-vous confirmer votre numéro de téléphone?',
        pt: 'Poderia confirmar o seu número de telefone?'
      },
      complete: {
        es: '¡Perfecto! Su reserva está confirmada. ¡Que disfruten!',
        en: 'Perfect! Your reservation is confirmed. Enjoy!',
        de: 'Perfekt! Ihre Reservierung ist bestätigt. Viel Spaß!',
        it: 'Perfetto! La sua prenotazione è confermata. Buon appetito!',
        fr: 'Parfait! Votre réservation est confirmée. Bon appétit!',
        pt: 'Perfeito! Sua reserva está confirmada. Bom apetite!'
      }
    };
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿En qué puedo ayudarle?';
  }

  // Simular error
  async simulateError(phoneNumber, language) {
    const errorTypes = [
      { type: 'GEMINI_ERROR', message: 'Model is overloaded', status: 503 },
      { type: 'GEMINI_ERROR', message: 'Rate limit exceeded', status: 429 },
      { type: 'SYSTEM_ERROR', message: 'Database connection failed' },
      { type: 'FALLBACK_USAGE', reason: 'Gemini timeout' }
    ];
    
    const error = errorTypes[Math.floor(Math.random() * errorTypes.length)];
    
    if (error.type === 'GEMINI_ERROR') {
      const errorObj = new Error(error.message);
      errorObj.status = error.status;
      logger.logGeminiError(phoneNumber, errorObj, 1);
    } else if (error.type === 'SYSTEM_ERROR') {
      const errorObj = new Error(error.message);
      logger.logError(phoneNumber, errorObj, 'database');
    } else if (error.type === 'FALLBACK_USAGE') {
      logger.logFallbackUsage(phoneNumber, error.reason, 'getFallbackIntent');
    }
  }

  // Métodos auxiliares
  getLanguageConfidence(language) {
    const baseConfidence = {
      es: 0.9,
      en: 0.8,
      de: 0.7,
      it: 0.6,
      fr: 0.6,
      pt: 0.6
    };
    return baseConfidence[language] || 0.5;
  }

  getStepFromIndex(index) {
    const steps = ['greeting', 'ask_people', 'ask_date', 'ask_time', 'ask_name', 'ask_phone'];
    return steps[index] || 'complete';
  }

  getNextStep(currentStep, analysis) {
    if (analysis.extracted_data.people && currentStep === 'greeting') return 'ask_date';
    if (analysis.extracted_data.date && currentStep === 'ask_people') return 'ask_time';
    if (analysis.extracted_data.time && currentStep === 'ask_date') return 'ask_name';
    if (analysis.extracted_data.name && currentStep === 'ask_time') return 'ask_phone';
    if (currentStep === 'ask_phone') return 'complete';
    return currentStep;
  }

  buildConversationHistory(messages, language) {
    return messages.map((message, index) => ({
      role: index % 2 === 0 ? 'user' : 'bot',
      message: message,
      timestamp: new Date().toISOString()
    }));
  }

  extractDataFromMessages(messages) {
    const data = {};
    messages.forEach(message => {
      const numbers = message.match(/\b(\d+)\b/g);
      if (numbers && numbers.length > 0) {
        const num = parseInt(numbers[0]);
        if (num >= 1 && num <= 20) data.people = num;
      }
    });
    return data;
  }

  // Ejecutar todas las simulaciones
  async runAllSimulations() {
    console.log('🌍 SIMULACIONES MULTIIDIOMA');
    console.log('============================');
    
    await this.simulateSpanish();
    await this.simulateEnglish();
    await this.simulateGerman();
    await this.simulateItalian();
    await this.simulateFrench();
    await this.simulatePortuguese();
    
    console.log('\n✅ Todas las simulaciones completadas');
    console.log('\n📊 Para analizar los resultados:');
    console.log('  node scripts/logging/analyze_logs.js');
    console.log('  node scripts/logging/view_logs.js summary +34600000001');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const simulator = new MultiLanguageSimulator();
  simulator.runAllSimulations().catch(console.error);
}

module.exports = MultiLanguageSimulator;
