const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const RESPONSES_OPTIMIZED = require('../RESPUESTAS_OPTIMIZADAS_MULTIIDIOMA');

// Configurar Gemini (opcional)
let genAI = null;
let model = null;

// Verificar si Gemini está disponible
if (process.env.GOOGLE_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log('✅ Gemini AI configurado correctamente');
  } catch (error) {
    console.log('⚠️ Error configurando Gemini:', error.message);
    console.log('🔄 Usando sistema híbrido (fallback a respuestas hard-coded)');
  }
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurada');
  console.log('🔄 Usando sistema híbrido (fallback a respuestas hard-coded)');
}

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

module.exports = async function handler(req, res) {
  console.log('🌟 Twilio Premium Call recibida');
  console.log('Method:', req.method);
  console.log('Body:', req.body);

  try {
    // Extraer parámetros de Twilio
    const { 
      CallSid, 
      SpeechResult, 
      Digits,
      From,
      To,
      CallStatus 
    } = req.body;

    // Obtener o crear estado de conversación
    let state = conversationStates.get(CallSid) || {
      step: 'greeting',
      data: {},
      phone: From,
      conversationHistory: [],
      language: null,
      sentiment: 'neutral',
      urgency: 'medium',
      startTime: Date.now()
    };

    // Guardar entrada del usuario si existe
    const userInput = SpeechResult || Digits || '';
    if (userInput) {
      state.conversationHistory.push({
        role: 'user',
        message: userInput,
        timestamp: new Date().toISOString()
      });
    }

    // Procesar según el paso actual con IA
    const response = await processConversationStepPremium(state, userInput);
    
    // Guardar el mensaje del bot
    state.conversationHistory.push({
      role: 'bot',
      message: response.message,
      timestamp: new Date().toISOString()
    });

    // Actualizar estado
    conversationStates.set(CallSid, state);

    // Si la conversación está completa, guardar en BD
    if (state.step === 'complete') {
      await saveReservationPremium(state);
      // Limpiar el estado después de guardar
      setTimeout(() => conversationStates.delete(CallSid), 60000);
    }

    // Generar TwiML response premium
    const twiml = generatePremiumTwiML(response);
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

  } catch (error) {
    console.error('❌ Error en Twilio Premium Call:', error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.es-ES-Neural2-B" language="es-ES">
    Disculpe, hubo un error técnico. Por favor, intente de nuevo más tarde o contacte directamente al restaurante.
  </Say>
  <Hangup/>
</Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(errorTwiml);
  }
}

async function processConversationStepPremium(state, userInput) {
  const step = state.step;
  const text = userInput.toLowerCase();

  console.log(`📋 Procesando paso premium: ${step}, Input: "${userInput}"`);

  // 1. Analizar input del usuario con IA
  const analysis = await analyzeUserInputPremium(userInput, state.conversationHistory);
  
  // 2. Actualizar estado con análisis (solo si no está ya establecido)
  if (analysis.language && !state.language) {
    state.language = analysis.language;
    console.log(`🌍 Idioma detectado y bloqueado: ${state.language}`);
  }
  if (analysis.sentiment) state.sentiment = analysis.sentiment;
  if (analysis.urgency) state.urgency = analysis.urgency;

  console.log(`🧠 Análisis IA: Idioma=${state.language}, Sentimiento=${state.sentiment}, Urgencia=${state.urgency}`);

  switch (step) {
    case 'greeting':
      state.step = 'ask_intention';
      const greetingMessage = await generatePremiumResponse('greeting', state.language, state.sentiment, state.urgency, state);
      return {
        message: greetingMessage,
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };

    case 'ask_intention':
      const intentionResult = await analyzeIntentionWithGemini(text, state);
      
      if (intentionResult.action === 'reservation') {
        state.step = 'ask_people';
        const reservationMessage = await generatePremiumResponse('ask_people', state.language, state.sentiment, state.urgency, state);
        return {
          message: reservationMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else if (intentionResult.action === 'clarify') {
        return {
          message: intentionResult.message,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const fallbackMessage = await generatePremiumResponse('clarify_intention', state.language, state.sentiment, state.urgency, state);
        return {
          message: fallbackMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'ask_people':
      const people = await extractInfoWithGemini(text, 'people', state);
      if (people && people.people) {
        state.data.NumeroReserva = people.people;
        state.step = 'ask_date';
        const dateMessage = await generatePremiumResponse('ask_date', state.language, state.sentiment, state.urgency, state);
        return {
          message: dateMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        // Si no puede extraer, usar fallback y pedir de nuevo
        console.log('⚠️ No se pudo extraer número de personas, usando fallback');
        const fallbackMessage = await generatePremiumResponse('ask_people_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: fallbackMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'ask_date':
      const date = await extractInfoWithGemini(text, 'date', state);
      if (date && date.date) {
        state.data.FechaReserva = date.date;
        state.step = 'ask_time';
        const timeMessage = await generatePremiumResponse('ask_time', state.language, state.sentiment, state.urgency, state);
        return {
          message: timeMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const errorMessage = await generatePremiumResponse('ask_date_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: errorMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'ask_time':
      const time = await extractInfoWithGemini(text, 'time', state);
      if (time && time.time) {
        state.data.HoraReserva = time.time;
        state.step = 'ask_name';
        const nameMessage = await generatePremiumResponse('ask_name', state.language, state.sentiment, state.urgency, state);
        return {
          message: nameMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const errorMessage = await generatePremiumResponse('ask_time_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: errorMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'ask_name':
      const name = await extractInfoWithGemini(text, 'name', state);
      if (name && name.name) {
        state.data.NomReserva = name.name;
        state.step = 'ask_phone';
        const phoneMessage = await generatePremiumResponse('ask_phone', state.language, state.sentiment, state.urgency, state);
        return {
          message: phoneMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const errorMessage = await generatePremiumResponse('ask_name_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: errorMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'ask_phone':
      const phone = await extractInfoWithGemini(text, 'phone', state);
      if (phone && phone.phone) {
        state.data.TelefonReserva = phone.phone;
        state.step = 'confirm';
        const confirmMessage = await generateConfirmationMessagePremium(state);
        return {
          message: confirmMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const errorMessage = await generatePremiumResponse('ask_phone_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: errorMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    case 'confirm':
      const confirmationResult = await analyzeConfirmationWithGemini(text, state);
      
      if (confirmationResult.action === 'confirm') {
        state.step = 'complete';
        const completeMessage = await generatePremiumResponse('complete', state.language, state.sentiment, state.urgency, state);
        return {
          message: completeMessage,
          gather: false,
          language: state.language,
          sentiment: state.sentiment
        };
      } else if (confirmationResult.action === 'modify') {
        return handleModificationRequestPremium(state, confirmationResult.modification);
      } else if (confirmationResult.action === 'restart') {
        state.step = 'ask_people';
        state.data = {};
        const restartMessage = await generatePremiumResponse('restart', state.language, state.sentiment, state.urgency, state);
        return {
          message: restartMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      } else {
        const clarifyMessage = await generatePremiumResponse('confirm_clarify', state.language, state.sentiment, state.urgency, state);
        return {
          message: clarifyMessage,
          gather: true,
          language: state.language,
          sentiment: state.sentiment
        };
      }

    default:
      state.step = 'greeting';
      const defaultMessage = await generatePremiumResponse('default', state.language, state.sentiment, state.urgency, state);
      return {
        message: defaultMessage,
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
  }
}

// ==================== FUNCIONES DE IA PREMIUM ====================

async function analyzeUserInputPremium(userInput, conversationHistory) {
  // Si Gemini no está disponible, usar detección básica
  if (!model) {
    return analyzeUserInputFallback(userInput);
  }
  
  try {
    const prompt = `
    Analiza este input del usuario: "${userInput}"
    
    Contexto de la conversación (últimas 3 interacciones): ${JSON.stringify(conversationHistory.slice(-3))}
    
    Responde en JSON con:
    {
      "language": "código del idioma (es, en, de, it, fr, pt)",
      "sentiment": "positive/neutral/negative/frustrated",
      "intent": "reservation/information/cancellation/other",
      "urgency": "low/medium/high",
      "confidence": 0.0-1.0
    }
    
    Si no estás seguro del idioma, usa "es" (español por defecto).
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('🧠 Análisis IA:', text);
    
    // Intentar parsear JSON
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.log('⚠️ Error parseando JSON, usando fallback');
      return analyzeUserInputFallback(userInput);
    }
  } catch (error) {
    console.error('❌ Error en análisis IA:', error);
    return analyzeUserInputFallback(userInput);
  }
}

function analyzeUserInputFallback(userInput) {
  console.log('🔄 Usando análisis fallback (sin Gemini)');
  
  // Detección básica de idioma por palabras clave
  const languagePatterns = {
    en: /\b(hello|hi|reservation|table|people|time|date|yes|no|thank you)\b/i,
    de: /\b(hallo|reservierung|tisch|personen|zeit|datum|ja|nein|danke)\b/i,
    it: /\b(ciao|prenotazione|tavolo|persone|ora|data|sì|no|grazie)\b/i,
    fr: /\b(bonjour|réservation|table|personnes|heure|date|oui|non|merci)\b/i,
    pt: /\b(olá|reserva|mesa|pessoas|hora|data|sim|não|obrigado)\b/i
  };
  
  let detectedLanguage = 'es'; // Español por defecto
  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(userInput)) {
      detectedLanguage = lang;
      break;
    }
  }
  
  // Detección básica de sentimiento
  let sentiment = 'neutral';
  if (userInput.includes('gracias') || userInput.includes('perfecto') || userInput.includes('excelente')) {
    sentiment = 'positive';
  } else if (userInput.includes('no') || userInput.includes('mal') || userInput.includes('error')) {
    sentiment = 'negative';
  } else if (userInput.includes('urgente') || userInput.includes('rápido') || userInput.includes('ya')) {
    sentiment = 'frustrated';
  }
  
  return {
    language: detectedLanguage,
    sentiment: sentiment,
    intent: 'reservation',
    urgency: 'medium',
    confidence: 0.7
  };
}

async function generatePremiumResponse(step, language, sentiment, urgency, context) {
  // Si Gemini no está disponible, usar respuestas hard-coded
  if (!model) {
    return generateResponseFallback(step, language, sentiment);
  }
  
  try {
    const prompts = {
      greeting: {
        es: `Eres un recepcionista premium de restaurante en español. 
             Sentimiento del cliente: ${sentiment}
             Urgencia: ${urgency}
             Genera un saludo natural y profesional. Máximo 15 palabras.`,
        en: `You are a premium restaurant receptionist in English.
             Client sentiment: ${sentiment}
             Urgency: ${urgency}
             Generate a natural and professional greeting. Maximum 15 words.`,
        de: `Du bist ein Premium-Restaurant-Empfang auf Deutsch.
             Kundenstimmung: ${sentiment}
             Dringlichkeit: ${urgency}
             Erstelle einen natürlichen und professionellen Gruß. Maximal 15 Wörter.`,
        it: `Sei un receptionist premium di ristorante in italiano.
             Sentimento del cliente: ${sentiment}
             Urgenza: ${urgency}
             Genera un saluto naturale e professionale. Massimo 15 parole.`,
        fr: `Tu es un réceptionniste premium de restaurant en français.
             Sentiment du client: ${sentiment}
             Urgence: ${urgency}
             Génère un salut naturel et professionnel. Maximum 15 mots.`,
        pt: `Você é um recepcionista premium de restaurante em português.
             Sentimento do cliente: ${sentiment}
             Urgência: ${urgency}
             Gere uma saudação natural e profissional. Máximo 15 palavras.`
      },
      
      ask_people: {
        es: `Pregunta cuántas personas de forma natural. 
             Sentimiento: ${sentiment}
             Si el cliente está frustrado, sé más directo.
             Si está contento, sé más amigable. Máximo 12 palabras.`,
        en: `Ask how many people naturally.
             Sentiment: ${sentiment}
             If client is frustrated, be more direct.
             If happy, be more friendly. Maximum 12 words.`,
        de: `Frage natürlich nach der Anzahl der Personen.
             Stimmung: ${sentiment}
             Wenn der Kunde frustriert ist, sei direkter.
             Wenn glücklich, sei freundlicher. Maximal 12 Wörter.`,
        it: `Chiedi quante persone in modo naturale.
             Sentimento: ${sentiment}
             Se il cliente è frustrato, sii più diretto.
             Se felice, sii più amichevole. Massimo 12 parole.`,
        fr: `Demande combien de personnes naturellement.
             Sentiment: ${sentiment}
             Si le client est frustré, sois plus direct.
             Si heureux, sois plus amical. Maximum 12 mots.`,
        pt: `Pergunte quantas pessoas naturalmente.
             Sentimento: ${sentiment}
             Se o cliente está frustrado, seja mais direto.
             Se feliz, seja mais amigável. Máximo 12 palavras.`
      },
      
      ask_date: {
        es: `Pregunta por la fecha de forma natural.
             Sentimiento: ${sentiment}
             Si el cliente está frustrado, sé más directo.
             Si está contento, sé más amigable. Máximo 12 palabras.`,
        en: `Ask for the date naturally.
             Sentiment: ${sentiment}
             If client is frustrated, be more direct.
             If happy, be more friendly. Maximum 12 words.`,
        de: `Frage nach dem Datum natürlich.
             Stimmung: ${sentiment}
             Wenn frustriert, sei direkter.
             Wenn glücklich, sei freundlicher. Maximal 12 Wörter.`,
        it: `Chiedi la data in modo naturale.
             Sentimento: ${sentiment}
             Se frustrato, sii più diretto.
             Se felice, sii più amichevole. Massimo 12 parole.`,
        fr: `Demande la date naturellement.
             Sentiment: ${sentiment}
             Si frustré, sois plus direct.
             Si heureux, sois plus amical. Maximum 12 mots.`,
        pt: `Pergunte a data naturalmente.
             Sentimento: ${sentiment}
             Se frustrado, seja mais direto.
             Se feliz, seja mais amigável. Máximo 12 palavras.`
      },
      
      ask_time: {
        es: `Pregunta por la hora de forma natural.
             Sentimiento: ${sentiment}
             Si el cliente está frustrado, sé más directo.
             Si está contento, sé más amigable. Máximo 12 palabras.`,
        en: `Ask for the time naturally.
             Sentiment: ${sentiment}
             If client is frustrated, be more direct.
             If happy, be more friendly. Maximum 12 words.`,
        de: `Frage nach der Uhrzeit natürlich.
             Stimmung: ${sentiment}
             Wenn frustriert, sei direkter.
             Wenn glücklich, sei freundlicher. Maximal 12 Wörter.`,
        it: `Chiedi l'ora in modo naturale.
             Sentimento: ${sentiment}
             Se frustrato, sii più diretto.
             Se felice, sii più amichevole. Massimo 12 parole.`,
        fr: `Demande l'heure naturellement.
             Sentiment: ${sentiment}
             Si frustré, sois plus direct.
             Si heureux, sois plus amical. Maximum 12 mots.`,
        pt: `Pergunte a hora naturalmente.
             Sentimento: ${sentiment}
             Se frustrado, seja mais direto.
             Se feliz, seja mais amigável. Máximo 12 palavras.`
      },
      
      ask_name: {
        es: `Pide el nombre de forma natural.
             Sentimiento: ${sentiment}
             Si el cliente está frustrado, sé más directo.
             Si está contento, sé más amigable. Máximo 12 palabras.`,
        en: `Ask for the name naturally.
             Sentiment: ${sentiment}
             If client is frustrated, be more direct.
             If happy, be more friendly. Maximum 12 words.`,
        de: `Frage nach dem Namen natürlich.
             Stimmung: ${sentiment}
             Wenn frustriert, sei direkter.
             Wenn glücklich, sei freundlicher. Maximal 12 Wörter.`,
        it: `Chiedi il nome in modo naturale.
             Sentimento: ${sentiment}
             Se frustrato, sii più diretto.
             Se felice, sii più amichevole. Massimo 12 parole.`,
        fr: `Demande le nom naturellement.
             Sentiment: ${sentiment}
             Si frustré, sois plus direct.
             Si heureux, sois plus amical. Maximum 12 mots.`,
        pt: `Pergunte o nome naturalmente.
             Sentimento: ${sentiment}
             Se frustrado, seja mais direto.
             Se feliz, seja mais amigável. Máximo 12 palavras.`
      },
      
      ask_phone: {
        es: `Pregunta si quiere usar este número o dar otro.
             Sentimiento: ${sentiment}
             Si el cliente está frustrado, sé más directo.
             Si está contento, sé más amigable. Máximo 15 palabras.`,
        en: `Ask if they want to use this number or give another.
             Sentiment: ${sentiment}
             If client is frustrated, be more direct.
             If happy, be more friendly. Maximum 15 words.`,
        de: `Frage, ob sie diese Nummer verwenden oder eine andere angeben möchten.
             Stimmung: ${sentiment}
             Wenn frustriert, sei direkter.
             Wenn glücklich, sei freundlicher. Maximal 15 Wörter.`,
        it: `Chiedi se vogliono usare questo numero o darne un altro.
             Sentimento: ${sentiment}
             Se frustrato, sii più diretto.
             Se felice, sii più amichevole. Massimo 15 parole.`,
        fr: `Demande s'ils veulent utiliser ce numéro ou en donner un autre.
             Sentiment: ${sentiment}
             Si frustré, sois plus direct.
             Si heureux, sois plus amical. Maximum 15 mots.`,
        pt: `Pergunte se querem usar este número ou dar outro.
             Sentimento: ${sentiment}
             Se frustrado, seja mais direto.
             Se feliz, seja mais amigável. Máximo 15 palavras.`
      },
      
      complete: {
        es: `Confirma que la reserva está lista de forma natural.
             Sentimiento: ${sentiment}
             Si el cliente está contento, sé más entusiasta.
             Si está neutral, sé profesional. Máximo 15 palabras.`,
        en: `Confirm the reservation is ready naturally.
             Sentiment: ${sentiment}
             If client is happy, be more enthusiastic.
             If neutral, be professional. Maximum 15 words.`,
        de: `Bestätige, dass die Reservierung bereit ist, natürlich.
             Stimmung: ${sentiment}
             Wenn glücklich, sei enthusiastischer.
             Wenn neutral, sei professionell. Maximal 15 Wörter.`,
        it: `Conferma che la prenotazione è pronta in modo naturale.
             Sentimento: ${sentiment}
             Se felice, sii più entusiasta.
             Se neutrale, sii professionale. Massimo 15 parole.`,
        fr: `Confirme que la réservation est prête naturellement.
             Sentiment: ${sentiment}
             Si heureux, sois plus enthousiaste.
             Si neutre, sois professionnel. Maximum 15 mots.`,
        pt: `Confirme que a reserva está pronta naturalmente.
             Sentimento: ${sentiment}
             Se feliz, seja mais entusiasmado.
             Se neutro, seja profissional. Máximo 15 palavras.`
      }
    };
    
    const prompt = prompts[step][language] || prompts[step]['es'];
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log(`🤖 Respuesta generada (${step}):`, text);
    return text.trim();
    
  } catch (error) {
    console.error('❌ Error generando respuesta premium:', error);
    return generateResponseFallback(step, language, sentiment);
  }
}

function generateResponseFallback(step, language, sentiment) {
  console.log('🔄 Usando respuestas fallback optimizadas (sin Gemini)');
  
  // Usar respuestas optimizadas si están disponibles
  if (RESPONSES_OPTIMIZED[step] && RESPONSES_OPTIMIZED[step][language]) {
    const stepResponses = RESPONSES_OPTIMIZED[step][language][sentiment] || RESPONSES_OPTIMIZED[step][language]['neutral'];
    if (stepResponses && stepResponses.length > 0) {
      const randomIndex = Math.floor(Math.random() * stepResponses.length);
      return stepResponses[randomIndex];
    }
  }
  
  // Fallback a respuestas básicas si no hay optimizadas
  const responses = {
    greeting: {
      es: {
        positive: ['¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?', '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy?'],
        neutral: ['¡Hola! Gracias por llamar. ¿En qué puedo asistirle?', '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita?'],
        negative: ['¡Hola! Entiendo que puede estar molesto. ¿En qué puedo ayudarle?', '¡Hola! Lamento cualquier inconveniente. ¿Cómo puedo asistirle?'],
        frustrated: ['¡Hola! Entiendo su urgencia. ¿En qué puedo ayudarle rápidamente?', '¡Hola! Veo que necesita ayuda urgente. ¿Qué puedo hacer por usted?']
      },
      en: {
        positive: ['Hello! Welcome to our restaurant. How can I help you?', 'Good morning! Welcome. How can I assist you today?'],
        neutral: ['Hello! Thank you for calling. How can I help you?', 'Good afternoon! Welcome to the restaurant. What do you need?'],
        negative: ['Hello! I understand you may be upset. How can I help you?', 'Hello! I apologize for any inconvenience. How can I assist you?'],
        frustrated: ['Hello! I understand your urgency. How can I help you quickly?', 'Hello! I see you need urgent help. What can I do for you?']
      },
      de: {
        positive: ['Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?', 'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?'],
        neutral: ['Hallo! Vielen Dank für den Anruf. Wie kann ich Ihnen helfen?', 'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?'],
        negative: ['Hallo! Ich verstehe, dass Sie verärgert sein könnten. Wie kann ich Ihnen helfen?', 'Hallo! Entschuldigung für die Unannehmlichkeiten. Wie kann ich Ihnen helfen?'],
        frustrated: ['Hallo! Ich verstehe Ihre Dringlichkeit. Wie kann ich Ihnen schnell helfen?', 'Hallo! Ich sehe, Sie brauchen dringend Hilfe. Was kann ich für Sie tun?']
      },
      it: {
        positive: ['Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?', 'Buongiorno! Benvenuto. Come posso aiutarti oggi?'],
        neutral: ['Ciao! Grazie per la chiamata. Come posso aiutarti?', 'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?'],
        negative: ['Ciao! Capisco che potresti essere arrabbiato. Come posso aiutarti?', 'Ciao! Mi scuso per qualsiasi inconveniente. Come posso aiutarti?'],
        frustrated: ['Ciao! Capisco la tua urgenza. Come posso aiutarti rapidamente?', 'Ciao! Vedo che hai bisogno di aiuto urgente. Cosa posso fare per te?']
      },
      fr: {
        positive: ['Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?', 'Bonjour! Bienvenue. Comment puis-je vous aider aujourd\'hui?'],
        neutral: ['Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?', 'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?'],
        negative: ['Bonjour! Je comprends que vous pourriez être contrarié. Comment puis-je vous aider?', 'Bonjour! Je m\'excuse pour tout inconvénient. Comment puis-je vous aider?'],
        frustrated: ['Bonjour! Je comprends votre urgence. Comment puis-je vous aider rapidement?', 'Bonjour! Je vois que vous avez besoin d\'aide urgente. Que puis-je faire pour vous?']
      },
      pt: {
        positive: ['Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?', 'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?'],
        neutral: ['Olá! Obrigado por ligar. Como posso ajudá-lo?', 'Boa tarde! Bem-vindo ao restaurante. Do que precisa?'],
        negative: ['Olá! Entendo que pode estar chateado. Como posso ajudá-lo?', 'Olá! Peço desculpa por qualquer inconveniente. Como posso ajudá-lo?'],
        frustrated: ['Olá! Entendo a sua urgência. Como posso ajudá-lo rapidamente?', 'Olá! Vejo que precisa de ajuda urgente. O que posso fazer por si?']
      }
    },
    
    ask_people: {
      es: {
        positive: ['¡Perfecto! ¿Para cuántas personas?', '¡Excelente! ¿Cuántas personas serán?'],
        neutral: ['¿Para cuántas personas?', '¿Cuántas personas serán?'],
        negative: ['Entiendo. ¿Para cuántas personas?', 'Disculpe. ¿Cuántas personas serán?'],
        frustrated: ['Rápido, ¿cuántas personas?', '¿Cuántas personas? Necesito saberlo ya.']
      },
      en: {
        positive: ['Perfect! For how many people?', 'Excellent! How many people will it be?'],
        neutral: ['For how many people?', 'How many people will it be?'],
        negative: ['I understand. For how many people?', 'Sorry. How many people will it be?'],
        frustrated: ['Quick, how many people?', 'How many people? I need to know now.']
      },
      de: {
        positive: ['Perfekt! Für wie viele Personen?', 'Ausgezeichnet! Wie viele Personen werden es sein?'],
        neutral: ['Für wie viele Personen?', 'Wie viele Personen werden es sein?'],
        negative: ['Ich verstehe. Für wie viele Personen?', 'Entschuldigung. Wie viele Personen werden es sein?'],
        frustrated: ['Schnell, wie viele Personen?', 'Wie viele Personen? Ich muss es jetzt wissen.']
      },
      it: {
        positive: ['Perfetto! Per quante persone?', 'Eccellente! Quante persone saranno?'],
        neutral: ['Per quante persone?', 'Quante persone saranno?'],
        negative: ['Capisco. Per quante persone?', 'Scusi. Quante persone saranno?'],
        frustrated: ['Veloce, quante persone?', 'Quante persone? Devo saperlo ora.']
      },
      fr: {
        positive: ['Parfait! Pour combien de personnes?', 'Excellent! Combien de personnes seront-ce?'],
        neutral: ['Pour combien de personnes?', 'Combien de personnes seront-ce?'],
        negative: ['Je comprends. Pour combien de personnes?', 'Désolé. Combien de personnes seront-ce?'],
        frustrated: ['Rapidement, combien de personnes?', 'Combien de personnes? Je dois le savoir maintenant.']
      },
      pt: {
        positive: ['Perfeito! Para quantas pessoas?', 'Excelente! Quantas pessoas serão?'],
        neutral: ['Para quantas pessoas?', 'Quantas pessoas serão?'],
        negative: ['Entendo. Para quantas pessoas?', 'Desculpe. Quantas pessoas serão?'],
        frustrated: ['Rápido, quantas pessoas?', 'Quantas pessoas? Preciso saber agora.']
      }
    },
    
    ask_people_error: {
      es: {
        positive: ['Disculpe, no entendí. ¿Para cuántas personas?', '¿Podría repetir? ¿Cuántas personas serán?'],
        neutral: ['No entendí bien. ¿Para cuántas personas?', '¿Cuántas personas serán?'],
        negative: ['Disculpe, no capté. ¿Para cuántas personas?', '¿Podría repetir? ¿Cuántas personas?'],
        frustrated: ['Rápido, ¿cuántas personas?', '¿Cuántas personas? Dígalo claro.']
      },
      en: {
        positive: ['Sorry, I didn\'t understand. For how many people?', 'Could you repeat? How many people will it be?'],
        neutral: ['I didn\'t get that. For how many people?', 'How many people will it be?'],
        negative: ['Sorry, I didn\'t catch that. For how many people?', 'Could you repeat? How many people?'],
        frustrated: ['Quick, how many people?', 'How many people? Say it clearly.']
      },
      de: {
        positive: ['Entschuldigung, ich habe nicht verstanden. Für wie viele Personen?', 'Könnten Sie wiederholen? Wie viele Personen werden es sein?'],
        neutral: ['Ich habe das nicht verstanden. Für wie viele Personen?', 'Wie viele Personen werden es sein?'],
        negative: ['Entschuldigung, ich habe das nicht erfasst. Für wie viele Personen?', 'Könnten Sie wiederholen? Wie viele Personen?'],
        frustrated: ['Schnell, wie viele Personen?', 'Wie viele Personen? Sagen Sie es klar.']
      },
      it: {
        positive: ['Scusi, non ho capito. Per quante persone?', 'Potrebbe ripetere? Quante persone saranno?'],
        neutral: ['Non ho capito. Per quante persone?', 'Quante persone saranno?'],
        negative: ['Scusi, non ho sentito. Per quante persone?', 'Potrebbe ripetere? Quante persone?'],
        frustrated: ['Veloce, quante persone?', 'Quante persone? Dica chiaramente.']
      },
      fr: {
        positive: ['Désolé, je n\'ai pas compris. Pour combien de personnes?', 'Pourriez-vous répéter? Combien de personnes seront-ce?'],
        neutral: ['Je n\'ai pas compris. Pour combien de personnes?', 'Combien de personnes seront-ce?'],
        negative: ['Désolé, je n\'ai pas saisi. Pour combien de personnes?', 'Pourriez-vous répéter? Combien de personnes?'],
        frustrated: ['Rapidement, combien de personnes?', 'Combien de personnes? Dites-le clairement.']
      },
      pt: {
        positive: ['Desculpe, não entendi. Para quantas pessoas?', 'Poderia repetir? Quantas pessoas serão?'],
        neutral: ['Não entendi. Para quantas pessoas?', 'Quantas pessoas serão?'],
        negative: ['Desculpe, não captei. Para quantas pessoas?', 'Poderia repetir? Quantas pessoas?'],
        frustrated: ['Rápido, quantas pessoas?', 'Quantas pessoas? Diga claramente.']
      }
    },
      en: {
        positive: ['Perfect! For how many people?', 'Excellent! How many people will it be?'],
        neutral: ['For how many people?', 'How many people will it be?'],
        negative: ['I understand. For how many people?', 'Sorry. How many people will it be?'],
        frustrated: ['Quick, how many people?', 'How many people? I need to know now.']
      },
      de: {
        positive: ['Perfekt! Für wie viele Personen?', 'Ausgezeichnet! Wie viele Personen werden es sein?'],
        neutral: ['Für wie viele Personen?', 'Wie viele Personen werden es sein?'],
        negative: ['Ich verstehe. Für wie viele Personen?', 'Entschuldigung. Wie viele Personen werden es sein?'],
        frustrated: ['Schnell, wie viele Personen?', 'Wie viele Personen? Ich muss es jetzt wissen.']
      },
      it: {
        positive: ['Perfetto! Per quante persone?', 'Eccellente! Quante persone saranno?'],
        neutral: ['Per quante persone?', 'Quante persone saranno?'],
        negative: ['Capisco. Per quante persone?', 'Scusi. Quante persone saranno?'],
        frustrated: ['Veloce, quante persone?', 'Quante persone? Devo saperlo ora.']
      },
      fr: {
        positive: ['Parfait! Pour combien de personnes?', 'Excellent! Combien de personnes seront-ce?'],
        neutral: ['Pour combien de personnes?', 'Combien de personnes seront-ce?'],
        negative: ['Je comprends. Pour combien de personnes?', 'Désolé. Combien de personnes seront-ce?'],
        frustrated: ['Rapidement, combien de personnes?', 'Combien de personnes? Je dois le savoir maintenant.']
      },
      pt: {
        positive: ['Perfeito! Para quantas pessoas?', 'Excelente! Quantas pessoas serão?'],
        neutral: ['Para quantas pessoas?', 'Quantas pessoas serão?'],
        negative: ['Entendo. Para quantas pessoas?', 'Desculpe. Quantas pessoas serão?'],
        frustrated: ['Rápido, quantas pessoas?', 'Quantas pessoas? Preciso saber agora.']
      }
    }
    
    // ... más respuestas para otros pasos
  };
  
  const stepResponses = responses[step]?.[language]?.[sentiment] || responses[step]?.[language]?.['neutral'] || responses[step]?.['es']?.['neutral'];
  
  if (stepResponses && stepResponses.length > 0) {
    const randomIndex = Math.floor(Math.random() * stepResponses.length);
    return stepResponses[randomIndex];
  }
  
  // Fallback final
  return getFallbackMessage(step, language);
}

async function extractInfoWithGemini(text, infoType, state) {
  // Si Gemini no está disponible, usar extracción básica
  if (!model) {
    return extractInfoFallback(text, infoType);
  }
  
  try {
    const prompts = {
      people: `
      Extrae el número de personas de este texto: "${text}"
      
      Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
      
      Responde en JSON:
      {
        "people": número_de_personas,
        "confidence": 0.0-1.0
      }
      
      Si no encuentras un número claro, responde con "people": null
      `,
      
      date: `
      Extrae la fecha de este texto: "${text}"
      
      Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
      Fecha actual: ${new Date().toLocaleDateString('es-ES')}
      
      Responde en JSON:
      {
        "date": "YYYY-MM-DD",
        "confidence": 0.0-1.0
      }
      
      Si no encuentras una fecha clara, responde con "date": null
      `,
      
      time: `
      Extrae la hora de este texto: "${text}"
      
      Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
      
      Responde en JSON:
      {
        "time": "HH:MM",
        "confidence": 0.0-1.0
      }
      
      Si no encuentras una hora clara, responde con "time": null
      `,
      
      name: `
      Extrae el nombre de este texto: "${text}"
      
      Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
      
      Responde en JSON:
      {
        "name": "nombre_extraído",
        "confidence": 0.0-1.0
      }
      
      Si no encuentras un nombre claro, responde con "name": null
      `,
      
      phone: `
      Extrae el número de teléfono de este texto: "${text}"
      
      Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
      
      Responde en JSON:
      {
        "phone": "número_de_teléfono",
        "confidence": 0.0-1.0
      }
      
      Si no encuentras un teléfono claro, responde con "phone": null
      `
    };
    
    const prompt = prompts[infoType];
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log(`🔍 Extracción IA (${infoType}):`, text);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.log('⚠️ Error parseando extracción, usando fallback');
      return { [infoType]: null, confidence: 0.0 };
    }
    
  } catch (error) {
    console.error('❌ Error en extracción IA:', error);
    return extractInfoFallback(text, infoType);
  }
}

function extractInfoFallback(text, infoType) {
  console.log('🔄 Usando extracción fallback (sin Gemini)');
  
  switch (infoType) {
    case 'people':
      return { people: extractPeopleCountFallback(text), confidence: 0.8 };
    case 'date':
      return { date: extractDateFallback(text), confidence: 0.8 };
    case 'time':
      return { time: extractTimeFallback(text), confidence: 0.8 };
    case 'name':
      return { name: extractNameFallback(text), confidence: 0.8 };
    case 'phone':
      return { phone: extractPhoneNumberFallback(text), confidence: 0.8 };
    default:
      return { [infoType]: null, confidence: 0.0 };
  }
}

function extractPeopleCountFallback(text) {
  const wordToNumber = {
    // Español
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    // Francés
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    // Italiano
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    // Portugués
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10
  };

  // Detectar palabras de corrección en múltiples idiomas
  const correctionWords = [
    // Español
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    // Inglés
    'no', 'better', 'wait', 'sorry', 'change', 'correct',
    // Alemán
    'nein', 'besser', 'warte', 'entschuldigung', 'ändern',
    // Francés
    'non', 'mieux', 'attendez', 'désolé', 'changer',
    // Italiano
    'no', 'meglio', 'aspetta', 'scusa', 'cambiare',
    // Portugués
    'não', 'melhor', 'espera', 'desculpa', 'mudar'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundNumbers = [];

  // Buscar números en palabras
  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      foundNumbers.push({ number, position: match.index });
    }
  }

  // Buscar números digitales
  const digitMatches = text.matchAll(/\b(\d+)\b/g);
  for (const match of digitMatches) {
    const count = parseInt(match[1]);
    if (count >= 1 && count <= 20) {
      foundNumbers.push({ number: count, position: match.index });
    }
  }

  if (foundNumbers.length === 0) return null;

  // Si hay corrección o múltiples números, tomar el último
  if (hasCorrection || foundNumbers.length > 1) {
    foundNumbers.sort((a, b) => b.position - a.position);
    return foundNumbers[0].number;
  }

  return foundNumbers[0].number;
}

function extractDateFallback(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Detectar palabras de corrección
  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundDates = [];
  let textToAnalyze = text;
  
  if (hasCorrection) {
    let lastCorrectionIndex = -1;
    correctionWords.forEach(word => {
      const index = text.lastIndexOf(word);
      if (index > lastCorrectionIndex) {
        lastCorrectionIndex = index;
      }
    });
    if (lastCorrectionIndex !== -1) {
      textToAnalyze = text.substring(lastCorrectionIndex);
    }
  }

  // Manejar "pasado mañana"
  if (textToAnalyze.includes('pasado mañana') || (textToAnalyze.includes('pasado') && textToAnalyze.includes('mañana'))) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return formatDateISO(date);
  }
  
  // Manejar "mañana"
  if (textToAnalyze.includes('mañana') && !textToAnalyze.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return formatDateISO(date);
  }
  
  if (textToAnalyze.includes('hoy')) {
    return formatDateISO(today);
  }

  // Mapeo de nombres de meses
  const monthNames = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
  };

  // Extraer fecha con nombre de mes
  for (const [monthName, monthNumber] of Object.entries(monthNames)) {
    if (textToAnalyze.includes(monthName)) {
      const patterns = [
        new RegExp(`(\\d{1,2})\\s*de\\s*${monthName}`, 'i'),
        new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i'),
        new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i'),
      ];
      
      for (const pattern of patterns) {
        const match = textToAnalyze.match(pattern);
        if (match) {
          const day = parseInt(match[1]);
          if (day >= 1 && day <= 31) {
            const year = today.getFullYear();
            try {
              const date = new Date(year, monthNumber - 1, day);
              if (date < today) {
                date.setFullYear(year + 1);
              }
              return formatDateISO(date);
            } catch (e) {
              return null;
            }
          }
        }
      }
    }
  }

  // Días de la semana
  const daysOfWeek = {
    'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
    'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
  };

  for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
    if (textToAnalyze.includes(dayName)) {
      const currentDay = today.getDay();
      let daysUntil = dayNumber - currentDay;
      
      if (daysUntil <= 0) {
        daysUntil += 7;
      }
      
      if (textToAnalyze.includes('que viene') || textToAnalyze.includes('próximo') || textToAnalyze.includes('proximo')) {
        if (daysUntil < 7) {
          daysUntil += 7;
        }
      }
      
      const date = new Date(today);
      date.setDate(date.getDate() + daysUntil);
      return formatDateISO(date);
    }
  }

  return null;
}

function extractTimeFallback(text) {
  const wordToNumber = {
    'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12
  };

  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundTimes = [];

  // Buscar horas en palabras
  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      let hours = number;
      let minutes = 0;

      if (text.includes('media') || text.includes('treinta')) {
        minutes = 30;
      } else if (text.includes('cuarto') || text.includes('quince')) {
        minutes = 15;
      }

      if (text.includes('noche') || text.includes('tarde')) {
        if (hours < 12) hours += 12;
      }

      if (hours >= 0 && hours <= 23) {
        foundTimes.push({
          time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
          position: match.index
        });
      }
    }
  }

  // Buscar horas en formato digital
  const timeMatches = text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\b/g);
  for (const match of timeMatches) {
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;

    if (text.includes('noche') || text.includes('tarde')) {
      if (hours < 12) hours += 12;
    }

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      foundTimes.push({
        time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        position: match.index
      });
    }
  }

  if (foundTimes.length === 0) return null;

  if (hasCorrection || foundTimes.length > 1) {
    foundTimes.sort((a, b) => b.position - a.position);
    return foundTimes[0].time;
  }

  return foundTimes[0].time;
}

function extractNameFallback(text) {
  const cleaned = text
    .replace(/mi nombre es/gi, '')
    .replace(/me llamo/gi, '')
    .replace(/soy/gi, '')
    .trim();
  
  if (cleaned.length > 1) {
    return cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return null;
}

function extractPhoneNumberFallback(text) {
  const directMatch = text.match(/\d{9,}/);
  if (directMatch) {
    return directMatch[0];
  }

  const wordToDigit = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 
    'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 
    'ocho': '8', 'nueve': '9'
  };

  let phoneNumber = '';
  const words = text.split(/\s+/);
  
  for (const word of words) {
    const cleanWord = word.toLowerCase().replace(/[,\.]/g, '');
    if (wordToDigit[cleanWord]) {
      phoneNumber += wordToDigit[cleanWord];
    } else if (/^\d$/.test(cleanWord)) {
      phoneNumber += cleanWord;
    }
  }

  if (phoneNumber.length >= 9) {
    return phoneNumber;
  }

  return null;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function analyzeIntentionWithGemini(text, state) {
  try {
    const prompt = `
    Analiza la intención de este texto: "${text}"
    
    Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
    
    Responde en JSON:
    {
      "action": "reservation/clarify/other",
      "message": "mensaje_de_respuesta_si_necesario"
    }
    
    Si es claramente una reserva, usa "reservation".
    Si es ambiguo, usa "clarify" con un mensaje de aclaración.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('🎯 Análisis de intención:', text);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { action: 'reservation' };
    }
    
  } catch (error) {
    console.error('❌ Error en análisis de intención:', error);
    return { action: 'reservation' };
  }
}

async function analyzeConfirmationWithGemini(text, state) {
  try {
    const prompt = `
    Analiza si el cliente confirma, niega o quiere modificar: "${text}"
    
    Contexto: Cliente ${state.sentiment}, urgencia ${state.urgency}
    
    Responde en JSON:
    {
      "action": "confirm/modify/restart/clarify",
      "modification": "people/date/time/name/phone" (solo si action es modify)
    }
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('✅ Análisis de confirmación:', text);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { action: 'clarify' };
    }
    
  } catch (error) {
    console.error('❌ Error en análisis de confirmación:', error);
    return { action: 'clarify' };
  }
}

async function generateConfirmationMessagePremium(state) {
  try {
    const prompt = `
    Genera un mensaje de confirmación en ${state.language} con estos datos:
    - Personas: ${state.data.NumeroReserva}
    - Fecha: ${state.data.FechaReserva}
    - Hora: ${state.data.HoraReserva}
    - Nombre: ${state.data.NomReserva}
    - Teléfono: ${state.data.TelefonReserva}
    
    Sentimiento del cliente: ${state.sentiment}
    Urgencia: ${state.urgency}
    
    Sé natural y profesional. Máximo 25 palabras.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('📋 Mensaje de confirmación generado:', text);
    return text.trim();
    
  } catch (error) {
    console.error('❌ Error generando confirmación:', error);
    return `Confirmo: ${state.data.NumeroReserva} personas, ${state.data.FechaReserva} a las ${state.data.HoraReserva}, a nombre de ${state.data.NomReserva}. ¿Es correcto?`;
  }
}

function handleModificationRequestPremium(state, modification) {
  switch (modification) {
    case 'people':
      state.step = 'ask_people';
      return {
        message: 'Perfecto. ¿Para cuántas personas?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
      
    case 'date':
      state.step = 'ask_date';
      return {
        message: 'Perfecto. ¿Para qué fecha?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
      
    case 'time':
      state.step = 'ask_time';
      return {
        message: 'Perfecto. ¿A qué hora?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
      
    case 'name':
      state.step = 'ask_name';
      return {
        message: 'Perfecto. ¿Su nombre?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
      
    case 'phone':
      state.step = 'ask_phone';
      return {
        message: 'Perfecto. ¿Desea usar este número o prefiere otro?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
      
    default:
      return {
        message: '¿Qué específicamente quiere cambiar?',
        gather: true,
        language: state.language,
        sentiment: state.sentiment
      };
  }
}

// ==================== FUNCIONES AUXILIARES ====================

function getFallbackMessage(step, language) {
  const fallbacks = {
    greeting: {
      es: '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
      en: 'Hello! Welcome to our restaurant. How can I help you?',
      de: 'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?',
      it: 'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?',
      fr: 'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
      pt: 'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?'
    },
    ask_people: {
      es: '¿Para cuántas personas?',
      en: 'For how many people?',
      de: 'Für wie viele Personen?',
      it: 'Per quante persone?',
      fr: 'Pour combien de personnes?',
      pt: 'Para quantas pessoas?'
    },
    ask_date: {
      es: '¿Para qué fecha?',
      en: 'For what date?',
      de: 'Für welches Datum?',
      it: 'Per quale data?',
      fr: 'Pour quelle date?',
      pt: 'Para que data?'
    },
    ask_time: {
      es: '¿A qué hora?',
      en: 'At what time?',
      de: 'Um welche Uhrzeit?',
      it: 'A che ora?',
      fr: 'À quelle heure?',
      pt: 'A que horas?'
    },
    ask_name: {
      es: '¿Su nombre?',
      en: 'Your name?',
      de: 'Ihr Name?',
      it: 'Il suo nome?',
      fr: 'Votre nom?',
      pt: 'O seu nome?'
    },
    ask_phone: {
      es: '¿Desea usar este número?',
      en: 'Would you like to use this number?',
      de: 'Möchten Sie diese Nummer verwenden?',
      it: 'Vorreste usare questo numero?',
      fr: 'Souhaitez-vous utiliser ce numéro?',
      pt: 'Gostaria de usar este número?'
    },
    complete: {
      es: 'Reserva confirmada. Les esperamos.',
      en: 'Reservation confirmed. We look forward to seeing you.',
      de: 'Reservierung bestätigt. Wir freuen uns auf Sie.',
      it: 'Prenotazione confermata. Non vediamo l\'ora di vedervi.',
      fr: 'Réservation confirmée. Nous avons hâte de vous voir.',
      pt: 'Reserva confirmada. Esperamos vê-los.'
    }
  };
  
  return fallbacks[step]?.[language] || fallbacks[step]?.['es'] || '¿En qué puedo ayudarle?';
}

function getVoiceForLanguage(language) {
  const voices = {
    es: 'Google.es-ES-Neural2-B',
    en: 'Google.en-US-Neural2-J',
    de: 'Google.de-DE-Neural2-A',
    it: 'Google.it-IT-Neural2-A',
    fr: 'Google.fr-FR-Neural2-A',
    pt: 'Google.pt-PT-Neural2-A'
  };
  
  return voices[language] || voices.es;
}

function getAdaptiveVoiceSettings(language, sentiment, urgency) {
  const baseVoice = getVoiceForLanguage(language);
  
  let rate = '1.0';
  let pitch = '1.0';
  
  // Adaptar según sentimiento
  if (sentiment === 'frustrated') {
    rate = '0.9';  // Más lento y claro
    pitch = '0.8'; // Más grave y calmante
  } else if (sentiment === 'positive') {
    rate = '1.1';  // Más rápido y energético
    pitch = '1.1'; // Más agudo y alegre
  }
  
  // Adaptar según urgencia
  if (urgency === 'high') {
    rate = '1.2';  // Más rápido
  }
  
  return {
    voice: baseVoice,
    rate: rate,
    pitch: pitch
  };
}

function generatePremiumTwiML(response) {
  const { message, gather = true, language = 'es', sentiment = 'neutral' } = response;
  const voiceSettings = getAdaptiveVoiceSettings(language, sentiment, 'medium');
  
  if (gather) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call-premium" 
    method="POST"
    language="${language}"
    speechTimeout="2"
    timeout="4">
    <Say voice="${voiceSettings.voice}" 
          language="${language}"
          rate="${voiceSettings.rate}"
          pitch="${voiceSettings.pitch}">${escapeXml(message)}</Say>
  </Gather>
  <Say voice="${voiceSettings.voice}" 
        language="${language}"
        rate="${voiceSettings.rate}"
        pitch="${voiceSettings.pitch}">${getRandomMessage([
    'No escuché respuesta. ¿Sigue ahí?',
    'Disculpe, no escuché. ¿Sigue ahí?',
    '¿Está ahí? No escuché nada.'
  ], language)}</Say>
  <Redirect>/api/twilio-call-premium</Redirect>
</Response>`;
  } else {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voiceSettings.voice}" 
        language="${language}"
        rate="${voiceSettings.rate}"
        pitch="${voiceSettings.pitch}">${escapeXml(message)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
  }
}

function getRandomMessage(messages, language = 'es') {
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex];
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ==================== GUARDADO PREMIUM ====================

async function saveReservationPremium(state) {
  try {
    console.log('💾 Guardando reserva premium en base de datos...');
    
    const data = state.data;
    
    // Validar datos
    const validacion = validarReserva(data);
    if (!validacion.valido) {
      console.error('❌ Validación fallida:', validacion.errores);
      return false;
    }

    // Preparar conversación completa en formato Markdown premium
    const conversacionCompleta = await generatePremiumMarkdownConversation(state);

    // Combinar fecha y hora
    const dataCombinada = combinarFechaHora(data.FechaReserva, data.HoraReserva);

    // Conectar a base de datos
    const connection = await createConnection();
    
    try {
      await connection.beginTransaction();

      // 1. Insertar o actualizar cliente
      const clienteQuery = `
        INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          NOM_COMPLET = VALUES(NOM_COMPLET), 
          DATA_ULTIMA_RESERVA = NOW()
      `;
      
      await connection.execute(clienteQuery, [
        data.NomReserva,
        data.TelefonReserva
      ]);

      console.log('✅ Cliente insertado/actualizado');

      // 2. Insertar reserva
      const reservaQuery = `
        INSERT INTO RESERVA 
        (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await connection.execute(reservaQuery, [
        dataCombinada,
        data.NumeroReserva,
        data.TelefonReserva,
        data.NomReserva,
        'Reserva realizada por teléfono (Twilio Premium + Gemini AI)',
        conversacionCompleta
      ]);

      const idReserva = result.insertId;
      console.log('✅ Reserva premium guardada con ID:', idReserva);

      await connection.commit();
      return true;

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }

  } catch (error) {
    console.error('❌ Error guardando reserva premium:', error);
    return false;
  }
}

async function generatePremiumMarkdownConversation(state) {
  try {
    const prompt = `
    Genera un análisis premium de esta conversación en ${state.language}:
    
    Idioma: ${state.language}
    Sentimiento promedio: ${state.sentiment}
    Urgencia: ${state.urgency}
    Duración: ${Math.round((Date.now() - state.startTime) / 1000)} segundos
    Conversación: ${JSON.stringify(state.conversationHistory)}
    
    Genera un análisis completo que incluya:
    1. Resumen ejecutivo
    2. Análisis de sentimiento del cliente
    3. Efectividad de las respuestas del bot
    4. Sugerencias de mejora específicas
    5. Puntuación de calidad (0-100)
    6. Recomendaciones para futuras conversaciones
    
    Formato: Markdown estructurado y profesional.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('📊 Análisis premium generado');
    return text;
    
  } catch (error) {
    console.error('❌ Error generando análisis premium:', error);
    return `# 📞 Conversación Premium\n\nAnálisis no disponible debido a error técnico.`;
  }
}
