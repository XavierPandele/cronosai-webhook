const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurar Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
  
  // 2. Actualizar estado con análisis
  if (analysis.language) state.language = analysis.language;
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
        const errorMessage = await generatePremiumResponse('ask_people_error', state.language, state.sentiment, state.urgency, state);
        return {
          message: errorMessage,
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
      return {
        language: 'es',
        sentiment: 'neutral',
        intent: 'reservation',
        urgency: 'medium',
        confidence: 0.5
      };
    }
  } catch (error) {
    console.error('❌ Error en análisis IA:', error);
    return {
      language: 'es',
      sentiment: 'neutral',
      intent: 'reservation',
      urgency: 'medium',
      confidence: 0.5
    };
  }
}

async function generatePremiumResponse(step, language, sentiment, urgency, context) {
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
    return getFallbackMessage(step, language);
  }
}

async function extractInfoWithGemini(text, infoType, state) {
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
    return { [infoType]: null, confidence: 0.0 };
  }
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
    }
    // ... más fallbacks
  };
  
  return fallbacks[step][language] || fallbacks[step]['es'] || '¿En qué puedo ayudarle?';
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
