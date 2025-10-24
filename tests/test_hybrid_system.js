// Cargar variables de entorno
require('dotenv').config();

const logger = require('../lib/logger');

// Simulaciones para el sistema híbrido
class HybridSystemTester {
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

  // Simular detección de idioma
  async simulateLanguageDetection(phoneNumber, userInput, expectedLanguage) {
    console.log(`\n🌍 SIMULANDO DETECCIÓN DE IDIOMA`);
    console.log(`📞 ${phoneNumber}: "${userInput}"`);
    console.log(`🎯 Idioma esperado: ${expectedLanguage}`);
    
    // Simular detección de idioma
    logger.logCallStart(phoneNumber, userInput);
    logger.logLanguageDetection(phoneNumber, expectedLanguage, 0.95, 'gemini');
    
    console.log(`✅ Idioma detectado: ${expectedLanguage}`);
    return expectedLanguage;
  }

  // Simular flujo completo hardcodeado
  async simulateHardcodedFlow(phoneNumber, language, messages) {
    console.log(`\n🔄 SIMULANDO FLUJO HARDCODEADO EN ${language.toUpperCase()}`);
    console.log('-'.repeat(50));
    
    let currentStep = 'greeting';
    let extractedData = {};
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      console.log(`\n${i + 1}. "${message}"`);
      
      // Simular análisis hardcodeado
      const analysis = this.analyzeIntentHardcoded(message, currentStep, language);
      console.log(`   📊 Intención: ${analysis.intent} (${analysis.confidence})`);
      console.log(`   📝 Datos extraídos: ${JSON.stringify(analysis.extracted_data)}`);
      
      // Procesar datos extraídos
      if (analysis.extracted_data.people) extractedData.people = analysis.extracted_data.people;
      if (analysis.extracted_data.date) extractedData.date = analysis.extracted_data.date;
      if (analysis.extracted_data.time) extractedData.time = analysis.extracted_data.time;
      if (analysis.extracted_data.name) extractedData.name = analysis.extracted_data.name;
      
      // Determinar siguiente paso
      const nextStep = this.getNextStep(currentStep, analysis.extracted_data);
      console.log(`   🔄 Paso: ${currentStep} -> ${nextStep}`);
      
      // Generar respuesta hardcodeada
      const response = this.getResponse(nextStep, language, analysis);
      console.log(`   💬 Respuesta: "${response}"`);
      
      // Logging
      logger.logIntentAnalysis(phoneNumber, analysis, currentStep);
      logger.logDataExtraction(phoneNumber, analysis.extracted_data, currentStep);
      logger.logStepTransition(phoneNumber, currentStep, nextStep, 'Procesando mensaje');
      logger.logResponseGeneration(phoneNumber, response, 'hardcoded', language);
      
      currentStep = nextStep;
      
      // Simular historial de conversación
      const conversationHistory = this.buildConversationHistory(messages.slice(0, i + 1), language);
      logger.logConversationHistory(phoneNumber, conversationHistory);
      
      // Simular métricas
      const metrics = {
        totalTime: 100 + Math.random() * 200, // Muy rápido sin Gemini
        geminiTime: 0, // No se usa Gemini
        processingTime: 100 + Math.random() * 200,
        intent: analysis.intent,
        confidence: analysis.confidence,
        sentiment: analysis.sentiment,
        urgency: analysis.urgency,
        step: currentStep,
        nextStep: nextStep,
        language: language,
        fallbackUsed: false,
        systemType: 'hybrid'
      };
      logger.logMetrics(phoneNumber, metrics);
    }
    
    console.log(`\n✅ Flujo completado en ${language.toUpperCase()}`);
    console.log(`📊 Datos finales: ${JSON.stringify(extractedData)}`);
  }

  // Análisis hardcodeado (copiado del sistema híbrido)
  analyzeIntentHardcoded(userInput, currentStep, language) {
    const lowerInput = userInput.toLowerCase();
    
    // Detectar saludos
    if (this.isGreeting(lowerInput, language)) {
      return {
        intent: 'greeting',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'normal',
        next_step: 'ask_people',
        response_type: 'question',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar despedidas
    if (this.isGoodbye(lowerInput, language)) {
      return {
        intent: 'goodbye',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'low',
        next_step: 'complete',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar frustración
    if (this.isFrustrated(lowerInput, language)) {
      return {
        intent: 'complaint',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'frustrated',
        urgency: 'high',
        next_step: currentStep,
        response_type: 'clarification',
        needs_clarification: true,
        clarification_question: this.getFrustratedResponse(language)
      };
    }
    
    // Detectar confusión
    if (this.isConfused(lowerInput, language)) {
      return {
        intent: 'clarification',
        confidence: 0.8,
        extracted_data: {},
        sentiment: 'confused',
        urgency: 'normal',
        next_step: currentStep,
        response_type: 'question',
        needs_clarification: true,
        clarification_question: this.getConfusedResponse(language)
      };
    }
    
    // Extraer datos según el paso actual
    const extractedData = this.extractDataHardcoded(userInput, currentStep, language);
    
    if (Object.keys(extractedData).length > 0) {
      return {
        intent: 'reservation',
        confidence: 0.8,
        extracted_data: extractedData,
        sentiment: 'positive',
        urgency: 'normal',
        next_step: this.getNextStep(currentStep, extractedData),
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Si no se detecta nada específico
    return {
      intent: 'clarification',
      confidence: 0.5,
      extracted_data: {},
      sentiment: 'neutral',
      urgency: 'normal',
      next_step: currentStep,
      response_type: 'question',
      needs_clarification: true,
      clarification_question: this.getClarificationResponse(currentStep, language)
    };
  }

  // Métodos auxiliares (copiados del sistema híbrido)
  isGreeting(input, language) {
    const greetings = {
      es: ['hola', 'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'hi'],
      en: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'],
      de: ['hallo', 'guten tag', 'guten morgen', 'guten abend', 'hey'],
      it: ['ciao', 'buongiorno', 'buonasera', 'salve', 'hey'],
      fr: ['bonjour', 'salut', 'bonsoir', 'hey'],
      pt: ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hey']
    };
    
    return greetings[language]?.some(greeting => input.includes(greeting)) || false;
  }

  isGoodbye(input, language) {
    const goodbyes = {
      es: ['gracias', 'hasta luego', 'adiós', 'chao', 'bye', 'thanks'],
      en: ['thank you', 'thanks', 'bye', 'goodbye', 'see you'],
      de: ['danke', 'tschüss', 'auf wiedersehen', 'bye'],
      it: ['grazie', 'arrivederci', 'ciao', 'bye'],
      fr: ['merci', 'au revoir', 'à bientôt', 'bye'],
      pt: ['obrigado', 'obrigada', 'tchau', 'até logo', 'bye']
    };
    
    return goodbyes[language]?.some(goodbye => input.includes(goodbye)) || false;
  }

  isFrustrated(input, language) {
    const frustrated = {
      es: ['frustrado', 'molesto', 'enojado', 'complicado', 'difícil', 'problema'],
      en: ['frustrated', 'angry', 'annoyed', 'complicated', 'difficult', 'problem'],
      de: ['frustriert', 'ärgerlich', 'kompliziert', 'schwierig', 'problem'],
      it: ['frustrato', 'arrabbiato', 'complicato', 'difficile', 'problema'],
      fr: ['frustré', 'énervé', 'compliqué', 'difficile', 'problème'],
      pt: ['frustrado', 'irritado', 'complicado', 'difícil', 'problema']
    };
    
    return frustrated[language]?.some(word => input.includes(word)) || false;
  }

  isConfused(input, language) {
    const confused = {
      es: ['no entiendo', 'confundido', 'qué necesito', 'no sé', 'ayuda'],
      en: ['don\'t understand', 'confused', 'what do i need', 'don\'t know', 'help'],
      de: ['verstehe nicht', 'verwirrt', 'was brauche ich', 'weiß nicht', 'hilfe'],
      it: ['non capisco', 'confuso', 'cosa serve', 'non so', 'aiuto'],
      fr: ['ne comprends pas', 'confus', 'que faut-il', 'ne sais pas', 'aide'],
      pt: ['não entendo', 'confuso', 'o que preciso', 'não sei', 'ajuda']
    };
    
    return confused[language]?.some(word => input.includes(word)) || false;
  }

  extractDataHardcoded(userInput, currentStep, language) {
    const data = {};
    
    // Extraer número de personas
    if (currentStep === 'greeting' || currentStep === 'ask_people') {
      const people = this.extractPeople(userInput, language);
      if (people) data.people = people;
    }
    
    // Extraer fecha
    if (currentStep === 'ask_people' || currentStep === 'ask_date') {
      const date = this.extractDate(userInput, language);
      if (date) data.date = date;
    }
    
    // Extraer hora
    if (currentStep === 'ask_date' || currentStep === 'ask_time') {
      const time = this.extractTime(userInput, language);
      if (time) data.time = time;
    }
    
    // Extraer nombre
    if (currentStep === 'ask_time' || currentStep === 'ask_name') {
      const name = this.extractName(userInput, language);
      if (name) data.name = name;
    }
    
    return data;
  }

  extractPeople(input, language) {
    const numbers = input.match(/\b(\d+)\b/g);
    if (numbers) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 20) return num;
    }
    return null;
  }

  extractDate(input, language) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    const tomorrowWords = {
      es: ['mañana', 'tomorrow'],
      en: ['tomorrow'],
      de: ['morgen'],
      it: ['domani'],
      fr: ['demain'],
      pt: ['amanhã']
    };
    
    const words = tomorrowWords[language] || [];
    if (words.some(word => input.includes(word))) {
      return tomorrow.toISOString().split('T')[0];
    }
    
    return null;
  }

  extractTime(input, language) {
    const timeMatch = input.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|de la tarde|de la noche|Uhr|heures)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3];
      
      if (period && (period.toLowerCase().includes('pm') || 
                    period.toLowerCase().includes('tarde') || 
                    period.toLowerCase().includes('noche'))) {
        if (hour < 12) hour += 12;
      }
      
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    return null;
  }

  extractName(input, language) {
    const namePatterns = {
      es: [/me llamo (\w+)/i, /mi nombre es (\w+)/i, /soy (\w+)/i],
      en: [/my name is (\w+)/i, /i'm (\w+)/i, /i am (\w+)/i],
      de: [/ich heiße (\w+)/i, /mein name ist (\w+)/i, /ich bin (\w+)/i],
      it: [/mi chiamo (\w+)/i, /il mio nome è (\w+)/i, /sono (\w+)/i],
      fr: [/je m'appelle (\w+)/i, /mon nom est (\w+)/i, /je suis (\w+)/i],
      pt: [/meu nome é (\w+)/i, /me chamo (\w+)/i, /sou (\w+)/i]
    };
    
    const patterns = namePatterns[language] || [];
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }

  getNextStep(currentStep, extractedData) {
    if (extractedData.people && currentStep === 'greeting') return 'ask_date';
    if (extractedData.date && currentStep === 'ask_people') return 'ask_time';
    if (extractedData.time && currentStep === 'ask_date') return 'ask_name';
    if (extractedData.name && currentStep === 'ask_time') return 'ask_phone';
    if (currentStep === 'ask_phone') return 'complete';
    return currentStep;
  }

  getResponse(step, language, intentAnalysis = null) {
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
    
    if (intentAnalysis && intentAnalysis.clarification_question) {
      return intentAnalysis.clarification_question;
    }
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿En qué puedo ayudarle?';
  }

  getFrustratedResponse(language) {
    const responses = {
      es: 'Entiendo su frustración. Le ayudo paso a paso. ¿Para cuántas personas será la reserva?',
      en: 'I understand your frustration. Let me help you step by step. How many people will the reservation be for?',
      de: 'Ich verstehe Ihre Frustration. Lassen Sie mich Ihnen Schritt für Schritt helfen. Für wie viele Personen soll die Reservierung sein?',
      it: 'Capisco la sua frustrazione. La aiuto passo dopo passo. Per quante persone sarà la prenotazione?',
      fr: 'Je comprends votre frustration. Laissez-moi vous aider étape par étape. Pour combien de personnes sera la réservation?',
      pt: 'Entendo sua frustração. Deixe-me ajudá-lo passo a passo. Para quantas pessoas será a reserva?'
    };
    
    return responses[language] || responses['es'];
  }

  getConfusedResponse(language) {
    const responses = {
      es: 'No se preocupe, le ayudo paso a paso. ¿Para cuántas personas será la reserva?',
      en: 'Don\'t worry, I\'ll help you step by step. How many people will the reservation be for?',
      de: 'Keine Sorge, ich helfe Ihnen Schritt für Schritt. Für wie viele Personen soll die Reservierung sein?',
      it: 'Non si preoccupi, la aiuto passo dopo passo. Per quante persone sarà la prenotazione?',
      fr: 'Ne vous inquiétez pas, je vous aide étape par étape. Pour combien de personnes sera la réservation?',
      pt: 'Não se preocupe, vou ajudá-lo passo a passo. Para quantas pessoas será a reserva?'
    };
    
    return responses[language] || responses['es'];
  }

  getClarificationResponse(step, language) {
    const responses = {
      greeting: {
        es: '¿Para cuántas personas será la reserva?',
        en: 'How many people will the reservation be for?',
        de: 'Für wie viele Personen soll die Reservierung sein?',
        it: 'Per quante persone sarà la prenotazione?',
        fr: 'Pour combien de personnes sera la réservation?',
        pt: 'Para quantas pessoas será a reserva?'
      },
      ask_people: {
        es: 'Por favor, dígame cuántas personas serán.',
        en: 'Please tell me how many people will be coming.',
        de: 'Bitte sagen Sie mir, für wie viele Personen.',
        it: 'Per favore, dimmi per quante persone.',
        fr: 'Veuillez me dire pour combien de personnes.',
        pt: 'Por favor, me diga para quantas pessoas.'
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
      }
    };
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿Podría repetir eso, por favor?';
  }

  buildConversationHistory(messages, language) {
    return messages.map((message, index) => ({
      role: index % 2 === 0 ? 'user' : 'bot',
      message: message,
      timestamp: new Date().toISOString()
    }));
  }

  // Ejecutar todas las pruebas
  async runAllTests() {
    console.log('🧪 PRUEBAS DEL SISTEMA HÍBRIDO');
    console.log('==============================');
    
    // Prueba 1: Español
    await this.simulateLanguageDetection(this.phoneNumbers.es, 'Hola, quiero hacer una reserva', 'es');
    await this.simulateHardcodedFlow(this.phoneNumbers.es, 'es', [
      'Hola, quiero hacer una reserva',
      'Para 4 personas',
      'Para mañana',
      'A las 8 de la tarde',
      'Me llamo Juan Pérez'
    ]);
    
    // Prueba 2: Inglés
    await this.simulateLanguageDetection(this.phoneNumbers.en, 'Hello, I want to make a reservation', 'en');
    await this.simulateHardcodedFlow(this.phoneNumbers.en, 'en', [
      'Hello, I want to make a reservation',
      'For 2 people',
      'For tomorrow',
      'At 7 PM',
      'My name is John Smith'
    ]);
    
    // Prueba 3: Alemán
    await this.simulateLanguageDetection(this.phoneNumbers.de, 'Hallo, ich möchte eine Reservierung', 'de');
    await this.simulateHardcodedFlow(this.phoneNumbers.de, 'de', [
      'Hallo, ich möchte eine Reservierung',
      'Für 3 Personen',
      'Für morgen',
      'Um 19 Uhr',
      'Ich heiße Hans Müller'
    ]);
    
    // Prueba 4: Casos problemáticos
    await this.simulateLanguageDetection(this.phoneNumbers.es + '1', 'Estoy muy frustrado con este sistema', 'es');
    await this.simulateHardcodedFlow(this.phoneNumbers.es + '1', 'es', [
      'Estoy muy frustrado con este sistema',
      'Solo quiero reservar para 2 personas',
      'Para el viernes',
      'A las 7',
      'Soy María García'
    ]);
    
    console.log('\n✅ Todas las pruebas completadas');
    console.log('\n📊 Para analizar los resultados:');
    console.log('  node scripts/logging/analyze_logs.js');
    console.log('  node scripts/logging/view_logs.js summary +34600000001');
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  const tester = new HybridSystemTester();
  tester.runAllTests().catch(console.error);
}

module.exports = HybridSystemTester;
