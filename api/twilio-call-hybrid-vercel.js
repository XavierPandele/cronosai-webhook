// Cargar variables de entorno
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Inicializar Gemini SOLO para detección de idioma
let genAI, model;
if (process.env.GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.1, // Muy baja creatividad para detección precisa
      topP: 0.5,
      topK: 20,
      maxOutputTokens: 10, // Solo necesitamos el código del idioma
    }
  });
  console.log('✅ Gemini 2.0 Flash inicializado SOLO para detección de idioma');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado, usando detección hardcodeada');
}

// Estados de conversación
const conversationStates = new Map();

// Sistema híbrido: Gemini para idioma + Hardcodeado para todo lo demás
class HybridSystem {
  
  // Detectar idioma SOLO al inicio de la conversación
  static async detectLanguageOnce(userInput, phoneNumber) {
    if (!model) {
      console.log(`[LANGUAGE] ${phoneNumber}: es (1.0) via fallback`);
      return 'es';
    }
    
    try {
      const prompt = `Analiza el idioma del siguiente texto y responde SOLO con el código del idioma.

TEXTO: "${userInput}"

Responde únicamente con uno de estos códigos: es, en, de, it, fr, pt

Idioma:`;

      console.log(`[GEMINI_REQUEST] ${phoneNumber}: Enviando a language_detection_only`);
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const detectedLang = response.text().trim().toLowerCase();
      
      const supportedLangs = ['es', 'en', 'de', 'it', 'fr', 'pt'];
      if (supportedLangs.includes(detectedLang)) {
        console.log(`[LANGUAGE] ${phoneNumber}: ${detectedLang} (0.95) via gemini`);
        console.log(`[IDIOMA] Detectado: ${detectedLang} para ${phoneNumber}`);
        return detectedLang;
      }
      
      console.log(`[LANGUAGE] ${phoneNumber}: es (0.5) via fallback_invalid`);
      return 'es';
    } catch (error) {
      console.log(`[LANGUAGE] ${phoneNumber}: es (0.0) via error`);
      console.error('[IDIOMA] Error detectando idioma:', error);
      return 'es';
    }
  }
  
  // Análisis de intención HARDCODEADO (sin Gemini)
  static analyzeIntentHardcoded(userInput, currentStep, language) {
    const lowerInput = userInput.toLowerCase();
    
    // Detectar saludos
    if (this.isGreeting(lowerInput, language)) {
      return {
        intent: 'greeting',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'normal',
        next_step: 'waiting_for_request',
        response_type: 'question',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar solicitud de reserva
    if (this.isReservationRequest(lowerInput, language)) {
      return {
        intent: 'reservation_request',
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
  
  // Detectar saludos por idioma
  static isGreeting(input, language) {
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
  
  // Detectar solicitudes de reserva por idioma
  static isReservationRequest(input, language) {
    const reservationRequests = {
      es: ['reserva', 'reservar', 'mesa', 'comer', 'cenar', 'almorzar', 'quiero', 'necesito', 'hacer una reserva', 'reservar mesa'],
      en: ['reservation', 'reserve', 'table', 'eat', 'dinner', 'lunch', 'want', 'need', 'make a reservation', 'book a table'],
      de: ['reservierung', 'reservieren', 'tisch', 'essen', 'abendessen', 'mittagessen', 'möchte', 'brauche', 'reservierung machen'],
      it: ['prenotazione', 'prenotare', 'tavolo', 'mangiare', 'cena', 'pranzo', 'voglio', 'ho bisogno', 'fare una prenotazione'],
      fr: ['réservation', 'réserver', 'table', 'manger', 'dîner', 'déjeuner', 'veux', 'besoin', 'faire une réservation'],
      pt: ['reserva', 'reservar', 'mesa', 'comer', 'jantar', 'almoçar', 'quero', 'preciso', 'fazer uma reserva']
    };
    
    return reservationRequests[language]?.some(request => input.includes(request)) || false;
  }
  
  // Detectar despedidas por idioma
  static isGoodbye(input, language) {
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
  
  // Detectar frustración por idioma
  static isFrustrated(input, language) {
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
  
  // Detectar confusión por idioma
  static isConfused(input, language) {
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
  
  // Extraer datos hardcodeado por idioma
  static extractDataHardcoded(userInput, currentStep, language) {
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
  
  // Extraer número de personas
  static extractPeople(input, language) {
    // Buscar números del 1 al 20
    const numbers = input.match(/\b(\d+)\b/g);
    if (numbers) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 20) return num;
    }
    
    // Palabras específicas por idioma
    const peopleWords = {
      es: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'],
      en: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
      de: ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'],
      it: ['uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'],
      fr: ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'],
      pt: ['um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
    };
    
    const words = peopleWords[language] || [];
    for (let i = 0; i < words.length; i++) {
      if (input.includes(words[i])) return i + 1;
    }
    
    return null;
  }
  
  // Extraer fecha
  static extractDate(input, language) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    // Detectar "mañana" / "tomorrow" / etc.
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
    
    // Detectar días de la semana
    const weekdays = {
      es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
      en: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      de: ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'],
      it: ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'],
      fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
      pt: ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
    };
    
    const days = weekdays[language] || [];
    for (let i = 0; i < days.length; i++) {
      if (input.includes(days[i])) {
        const targetDate = new Date(today);
        const daysUntilTarget = (i + 1) - today.getDay();
        if (daysUntilTarget <= 0) targetDate.setDate(today.getDate() + 7 + daysUntilTarget);
        else targetDate.setDate(today.getDate() + daysUntilTarget);
        return targetDate.toISOString().split('T')[0];
      }
    }
    
    return null;
  }
  
  // Extraer hora
  static extractTime(input, language) {
    // Buscar formato HH:MM
    const timeMatch = input.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|de la tarde|de la noche|Uhr|heures)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3];
      
      // Convertir a 24h si es necesario
      if (period && (period.toLowerCase().includes('pm') || 
                    period.toLowerCase().includes('tarde') || 
                    period.toLowerCase().includes('noche'))) {
        if (hour < 12) hour += 12;
      }
      
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
    
    // Palabras específicas por idioma
    const timeWords = {
      es: ['mediodía', 'medianoche', 'tarde', 'noche'],
      en: ['noon', 'midnight', 'afternoon', 'evening'],
      de: ['mittag', 'mitternacht', 'nachmittag', 'abend'],
      it: ['mezzogiorno', 'mezzanotte', 'pomeriggio', 'sera'],
      fr: ['midi', 'minuit', 'après-midi', 'soir'],
      pt: ['meio-dia', 'meia-noite', 'tarde', 'noite']
    };
    
    const words = timeWords[language] || [];
    if (input.includes('mediodía') || input.includes('noon') || input.includes('mittag')) {
      return '12:00';
    }
    if (input.includes('medianoche') || input.includes('midnight') || input.includes('mitternacht')) {
      return '00:00';
    }
    
    return null;
  }
  
  // Extraer nombre
  static extractName(input, language) {
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
  
  // Obtener siguiente paso
  static getNextStep(currentStep, extractedData) {
    if (extractedData.people && currentStep === 'greeting') return 'ask_date';
    if (extractedData.date && currentStep === 'ask_people') return 'ask_time';
    if (extractedData.time && currentStep === 'ask_date') return 'ask_name';
    if (extractedData.name && currentStep === 'ask_time') return 'ask_phone';
    if (currentStep === 'ask_phone') return 'complete';
    return currentStep;
  }
  
  // Respuestas hardcodeadas optimizadas por idioma
  static getResponse(step, language, intentAnalysis = null) {
    const responses = {
      greeting: {
        es: '¡Hola! Bienvenido a nuestro restaurante. ¿En qué le puedo ayudar?',
        en: 'Hello! Welcome to our restaurant. How can I help you?',
        de: 'Hallo! Willkommen in unserem Restaurant. Womit kann ich Ihnen helfen?',
        it: 'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarla?',
        fr: 'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
        pt: 'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?'
      },
      waiting_for_request: {
        es: '¿En qué le puedo ayudar?',
        en: 'How can I help you?',
        de: 'Womit kann ich Ihnen helfen?',
        it: 'Come posso aiutarla?',
        fr: 'Comment puis-je vous aider?',
        pt: 'Como posso ajudá-lo?'
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
    
    // Si hay una pregunta de aclaración específica, usarla
    if (intentAnalysis && intentAnalysis.clarification_question) {
      return intentAnalysis.clarification_question;
    }
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿En qué puedo ayudarle?';
  }
  
  // Respuestas para frustración
  static getFrustratedResponse(language) {
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
  
  // Respuestas para confusión
  static getConfusedResponse(language) {
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
  
  // Respuestas de aclaración por paso
  static getClarificationResponse(step, language) {
    const responses = {
      greeting: {
        es: '¿En qué le puedo ayudar?',
        en: 'How can I help you?',
        de: 'Womit kann ich Ihnen helfen?',
        it: 'Come posso aiutarla?',
        fr: 'Comment puis-je vous aider?',
        pt: 'Como posso ajudá-lo?'
      },
      waiting_for_request: {
        es: '¿En qué le puedo ayudar?',
        en: 'How can I help you?',
        de: 'Womit kann ich Ihnen helfen?',
        it: 'Come posso aiutarla?',
        fr: 'Comment puis-je vous aider?',
        pt: 'Como posso ajudá-lo?'
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
}

// Guardar reserva (igual que antes)
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
    if (!state.data.people || !state.data.date || !state.data.time || !state.data.name) {
      console.error('[ERROR] Datos incompletos para guardar reserva');
      return false;
    }
    
    const connection = await createConnection();
    await connection.beginTransaction();
    
    try {
      // Insertar cliente
      await connection.execute(`
        INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          NOM_COMPLET = VALUES(NOM_COMPLET), 
          DATA_ULTIMA_RESERVA = NOW()
      `, [state.data.name, state.data.phone]);
      
      console.log('[GUARDAR] Cliente insertado/actualizado');
      
      // Insertar reserva
      const fechaCompleta = combinarFechaHora(state.data.date, state.data.time);
      await connection.execute(`
        INSERT INTO RESERVA 
        (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        fechaCompleta,
        state.data.people,
        state.data.phone,
        state.data.name,
        'Reserva por teléfono - Sistema Híbrido Vercel',
        JSON.stringify(state.conversationHistory)
      ]);
      
      await connection.commit();
      await connection.end();
      
      console.log('[GUARDAR] ✅ Reserva guardada exitosamente');
      return true;
      
    } catch (error) {
      await connection.rollback();
      await connection.end();
      throw error;
    }
    
  } catch (error) {
    console.error('[ERROR] Error guardando reserva:', error);
    return false;
  }
}

// Generar TwiML con configuración de idioma correcta
function generateTwiML(message, language = 'es') {
  console.log(`[TwiML] Generando para idioma: ${language}`);
  
  const voiceConfig = {
    es: { voice: 'Polly.Lupe', language: 'es-ES' },
    en: { voice: 'Polly.Joanna', language: 'en-US' },
    de: { voice: 'Polly.Marlene', language: 'de-DE' },
    it: { voice: 'Polly.Carla', language: 'it-IT' },
    fr: { voice: 'Polly.Celine', language: 'fr-FR' },
    pt: { voice: 'Polly.Camila', language: 'pt-BR' }
  };
  
  const config = voiceConfig[language] || voiceConfig.es;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${config.voice}" language="${config.language}">
    ${message}
  </Say>
  <Gather input="speech" language="${config.language}" timeout="10" speechTimeout="6" action="/api/twilio-call-hybrid-vercel" method="POST">
    <Say voice="${config.voice}" language="${config.language}">
      ${getWaitMessage(language)}
    </Say>
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">
    ${getTimeoutMessage(language)}
  </Say>
  <Hangup/>
</Response>`;
}

// Mensajes de espera por idioma
function getWaitMessage(language) {
  const messages = {
    es: 'Por favor, responda.',
    en: 'Please respond.',
    de: 'Bitte antworten Sie.',
    it: 'Per favore, rispondi.',
    fr: 'Veuillez répondre.',
    pt: 'Por favor, responda.'
  };
  return messages[language] || messages.es;
}

// Mensajes de timeout por idioma
function getTimeoutMessage(language) {
  const messages = {
    es: 'No he recibido respuesta. Gracias por llamar.',
    en: 'I haven\'t received a response. Thank you for calling.',
    de: 'Ich habe keine Antwort erhalten. Vielen Dank für den Anruf.',
    it: 'Non ho ricevuto una risposta. Grazie per la chiamata.',
    fr: 'Je n\'ai pas reçu de réponse. Merci d\'avoir appelé.',
    pt: 'Não recebi uma resposta. Obrigado por ligar.'
  };
  return messages[language] || messages.es;
}

// Handler principal híbrido optimizado para Vercel
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  const startTime = Date.now();
  console.log(`[CALL_START] ${From}: "${userInput}"`);
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  console.log(`[LLAMADA] Timestamp: ${new Date().toISOString()}`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    data: {},
    conversationHistory: [],
    retryCount: 0,
    maxRetries: 3
  };
  
  // Detectar idioma SOLO si no está detectado
  if (!state.language && userInput) {
    state.language = await HybridSystem.detectLanguageOnce(userInput, From);
    console.log(`[IDIOMA] Idioma detectado: ${state.language}`);
  }
  
  if (!state.language) {
    state.language = 'es';
  }
  
  // Análisis de intención HARDCODEADO (sin Gemini)
  let intentAnalysis;
  if (userInput) {
    intentAnalysis = HybridSystem.analyzeIntentHardcoded(userInput, state.step, state.language);
    console.log(`[INTENT] ${From}: ${intentAnalysis.intent} (${intentAnalysis.confidence})`);
    console.log(`[ANÁLISIS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
  } else {
    intentAnalysis = {
      intent: 'greeting',
      confidence: 1.0,
      extracted_data: {},
      sentiment: 'positive',
      urgency: 'normal',
      next_step: 'ask_people',
      response_type: 'question',
      needs_clarification: false,
      clarification_question: null
    };
  }
  
  // Procesar datos extraídos
  if (intentAnalysis.extracted_data) {
    const { people, date, time, name, phone } = intentAnalysis.extracted_data;
    
    console.log(`[DATA] ${From}: Extraídos ${Object.keys(intentAnalysis.extracted_data).length} campos`);
    
    if (people && !state.data.people) {
      state.data.people = people;
      console.log(`[DATOS] Personas extraídas: ${people}`);
    }
    
    if (date && !state.data.date) {
      state.data.date = date;
      console.log(`[DATOS] Fecha extraída: ${date}`);
    }
    
    if (time && !state.data.time) {
      state.data.time = time;
      console.log(`[DATOS] Hora extraída: ${time}`);
    }
    
    if (name && !state.data.name) {
      state.data.name = name;
      console.log(`[DATOS] Nombre extraído: ${name}`);
    }
    
    if (phone && !state.data.phone) {
      state.data.phone = phone;
      console.log(`[DATOS] Teléfono extraído: ${phone}`);
    }
  }
  
  // Determinar siguiente paso
  let nextStep = state.step;
  let response = '';
  
  try {
    // Si necesita aclaración, mantener el paso actual
    if (intentAnalysis.needs_clarification) {
      nextStep = state.step;
      response = intentAnalysis.clarification_question || 
        HybridSystem.getClarificationResponse(state.step, state.language);
    } else {
      // Avanzar según el flujo
      switch (state.step) {
        case 'greeting':
          if (intentAnalysis.intent === 'reservation_request' || intentAnalysis.extracted_data.people) {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Solicitud de reserva detectada)`);
          } else {
            nextStep = 'waiting_for_request';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Esperando solicitud)`);
          }
          break;
          
        case 'waiting_for_request':
          if (intentAnalysis.intent === 'reservation_request' || intentAnalysis.extracted_data.people) {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Solicitud de reserva detectada)`);
          } else {
            nextStep = 'waiting_for_request';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Esperando solicitud)`);
          }
          break;
          
        case 'ask_people':
          if (intentAnalysis.extracted_data.people) {
            nextStep = 'ask_date';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Datos de personas confirmados)`);
          } else {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de personas)`);
          }
          break;
          
        case 'ask_date':
          if (intentAnalysis.extracted_data.date) {
            nextStep = 'ask_time';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Fecha extraída)`);
          } else {
            nextStep = 'ask_date';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de fecha)`);
          }
          break;
          
        case 'ask_time':
          if (intentAnalysis.extracted_data.time) {
            nextStep = 'ask_name';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Hora extraída)`);
          } else {
            nextStep = 'ask_time';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de hora)`);
          }
          break;
          
        case 'ask_name':
          if (intentAnalysis.extracted_data.name) {
            nextStep = 'ask_phone';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Nombre extraído)`);
          } else {
            nextStep = 'ask_name';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de nombre)`);
          }
          break;
          
        case 'ask_phone':
          state.data.phone = From;
          nextStep = 'complete';
          console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Teléfono del llamador asignado)`);
          break;
          
        case 'complete':
          nextStep = 'finished';
          console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Reserva completada)`);
          break;
      }
      
      // Generar respuesta hardcodeada optimizada
      response = HybridSystem.getResponse(nextStep, state.language, intentAnalysis);
      console.log(`[RESPONSE] ${From}: hardcoded (${state.language})`);
    }
    
    // Si es el paso final, guardar reserva
    if (nextStep === 'complete' && state.data.people && state.data.date && state.data.time && state.data.name) {
      const saved = await saveReservation(state);
      if (saved) {
        response = HybridSystem.getResponse('complete', state.language);
        nextStep = 'finished';
      } else {
        response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        nextStep = 'error';
      }
    }
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
    nextStep = 'error';
  }
  
  // Guardar conversación
  state.conversationHistory.push({
    role: 'user',
    message: userInput,
    timestamp: new Date().toISOString()
  });
  
  state.conversationHistory.push({
    role: 'bot',
    message: response,
    timestamp: new Date().toISOString()
  });
  
  console.log(`[HISTORY] ${From}: ${state.conversationHistory.length} mensajes`);
  
  // Actualizar estado
  state.step = nextStep;
  conversationStates.set(From, state);
  console.log(`[STATE] ${From}: ${state.step} (${state.language})`);
  
  // Generar TwiML
  const twiml = generateTwiML(response, state.language);
  
  // Logging de métricas
  const processingTime = Date.now() - startTime;
  console.log(`[METRICS] ${From}: ${processingTime}ms total`);
  console.log(`[MÉTRICAS] Tiempo de procesamiento: ${processingTime}ms`);
  console.log(`[MÉTRICAS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
  console.log(`[MÉTRICAS] Sentimiento: ${intentAnalysis.sentiment}, Urgencia: ${intentAnalysis.urgency}`);
  console.log(`[MÉTRICAS] Paso: ${state.step} -> ${nextStep}`);
  console.log(`[MÉTRICAS] Idioma: ${state.language}`);
  console.log(`[MÉTRICAS] Sistema: Híbrido Vercel (Gemini solo para idioma)`);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
