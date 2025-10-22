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

// Estado de conversación en memoria
const conversationStates = new Map();

// Función principal del webhook
module.exports = async (req, res) => {
  try {
    console.log('📞 Webhook premium recibido');
    
    const { From, To, CallSid, SpeechResult } = req.body;
    const userInput = SpeechResult || '';
    
    console.log(`📱 Llamada desde: ${From}`);
    console.log(`📱 Llamada hacia: ${To}`);
    console.log(`💬 Input del usuario: "${userInput}"`);
    
    // Obtener o crear estado de conversación
    let state = conversationStates.get(CallSid);
    if (!state) {
      state = {
        step: 'greeting',
        data: {},
        phone: From,
        conversationHistory: [],
        language: null,
        sentiment: 'neutral',
        urgency: 'medium',
        startTime: Date.now()
      };
      conversationStates.set(CallSid, state);
    }
    
    // Procesar paso premium
    const response = await processPremiumStep(userInput, state);
    
    // Generar TwiML
    const twiml = generateTwiML(response, state.language);
    
    console.log(`🤖 Respuesta: "${response}"`);
    console.log(`🌍 Idioma: ${state.language}`);
    
    res.setHeader('Content-Type', 'text/xml');
    res.send(twiml);
    
  } catch (error) {
    console.error('❌ Error en webhook premium:', error);
    
    // Respuesta de error en español
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.es-ES-Neural2-B" language="es-ES">
    Disculpe, ha ocurrido un error técnico. Por favor, intente llamar más tarde.
  </Say>
  <Hangup/>
</Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    res.send(errorTwiml);
  }
};

async function processPremiumStep(userInput, state) {
  console.log(`📋 Procesando paso premium: ${state.step}, Input: "${userInput}"`);
  
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
  
  switch (state.step) {
    case 'greeting':
      state.step = 'ask_people';
      return await generatePremiumResponse('greeting', state.language, state.sentiment, state.urgency, state);
      
    case 'ask_people':
      const peopleCount = await extractInfoWithGemini(userInput, 'people', state);
      if (peopleCount && peopleCount.people) {
        state.data.NumeroReserva = peopleCount.people;
        state.step = 'ask_date';
        return await generatePremiumResponse('ask_people', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('ask_people_error', state.language, state.sentiment, state.urgency, state);
      }
      
    case 'ask_date':
      const date = await extractInfoWithGemini(userInput, 'date', state);
      if (date && date.date) {
        state.data.FechaReserva = date.date;
        state.step = 'ask_time';
        return await generatePremiumResponse('ask_date', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('ask_date_error', state.language, state.sentiment, state.urgency, state);
      }
      
    case 'ask_time':
      const time = await extractInfoWithGemini(userInput, 'time', state);
      if (time && time.time) {
        state.data.HoraReserva = time.time;
        state.step = 'ask_name';
        return await generatePremiumResponse('ask_time', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('ask_time_error', state.language, state.sentiment, state.urgency, state);
      }
      
    case 'ask_name':
      const name = await extractInfoWithGemini(userInput, 'name', state);
      if (name && name.name) {
        state.data.NomReserva = name.name;
        state.step = 'ask_phone';
        return await generatePremiumResponse('ask_name', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('ask_name_error', state.language, state.sentiment, state.urgency, state);
      }
      
    case 'ask_phone':
      const phone = await extractInfoWithGemini(userInput, 'phone', state);
      if (phone && phone.phone) {
        state.data.TelefonReserva = phone.phone;
        state.step = 'complete';
        return await generatePremiumResponse('ask_phone', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('ask_phone_error', state.language, state.sentiment, state.urgency, state);
      }
      
    case 'complete':
      // Guardar reserva
      const saved = await saveReservation(state);
      if (saved) {
        state.step = 'finished';
        return await generatePremiumResponse('complete', state.language, state.sentiment, state.urgency, state);
      } else {
        return await generatePremiumResponse('complete_error', state.language, state.sentiment, state.urgency, state);
      }
      
    default:
      return await generatePremiumResponse('greeting', state.language, state.sentiment, state.urgency, state);
  }
}

async function analyzeUserInputPremium(userInput, conversationHistory) {
  // Si Gemini no está disponible, usar análisis básico
  if (!model) {
    return analyzeUserInputFallback(userInput);
  }
  
  try {
    const prompt = `
    Analiza este input del usuario: "${userInput}"
    
    Contexto de conversación: ${JSON.stringify(conversationHistory.slice(-3))}
    
    Determina:
    1. Idioma (es, en, de, it, fr, pt)
    2. Sentimiento (positive, neutral, negative, frustrated)
    3. Urgencia (low, medium, high)
    4. Confianza (0.0-1.0)
    
    Responde en formato JSON:
    {
      "language": "es",
      "sentiment": "positive",
      "urgency": "medium",
      "confidence": 0.8
    }
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('🧠 Análisis IA:', text);
    
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.log('⚠️ Error parseando análisis, usando fallback');
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
  
  let detectedLanguage = 'es'; // Default
  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(userInput)) {
      detectedLanguage = lang;
      break;
    }
  }
  
  // Detección básica de sentimiento
  let sentiment = 'neutral';
  if (/\b(perfecto|excelente|genial|gracias|sí|yes|ja|sì|oui|sim)\b/i.test(userInput)) {
    sentiment = 'positive';
  } else if (/\b(no|mal|error|problema|urgente|rápido|quick|schnell|veloce|rapidement|rápido)\b/i.test(userInput)) {
    sentiment = 'negative';
  } else if (/\b(urgente|urgent|dringend|urgente|urgent|urgente)\b/i.test(userInput)) {
    sentiment = 'frustrated';
  }
  
  // Detección básica de urgencia
  let urgency = 'medium';
  if (/\b(urgente|urgent|dringend|urgente|urgent|urgente|rápido|quick|schnell|veloce|rapidement|rápido)\b/i.test(userInput)) {
    urgency = 'high';
  }
  
  return {
    language: detectedLanguage,
    sentiment: sentiment,
    urgency: urgency,
    confidence: 0.7
  };
}

async function generatePremiumResponse(step, language, sentiment, urgency, state) {
  // Si Gemini no está disponible, usar respuestas optimizadas
  if (!model) {
    return generateResponseFallback(step, language, sentiment);
  }
  
  try {
    const prompt = `
    Genera una respuesta natural para el paso: ${step}
    Idioma: ${language}
    Sentimiento del cliente: ${sentiment}
    Urgencia: ${urgency}
    
    Contexto: ${JSON.stringify(state.data)}
    
    Responde de forma natural y conversacional, máximo 15 palabras.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('🤖 Respuesta IA generada:', text);
    return text;
    
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
  
  // Fallback final
  return getFallbackMessage(step, language);
}

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

async function extractInfoWithGemini(text, infoType, state) {
  // Si Gemini no está disponible, usar extracción básica
  if (!model) {
    return extractInfoFallback(text, infoType);
  }
  
  try {
    const prompts = {
      people: `Extrae el número de personas de: "${text}"`,
      date: `Extrae la fecha de: "${text}"`,
      time: `Extrae la hora de: "${text}"`,
      name: `Extrae el nombre de: "${text}"`,
      phone: `Extrae el teléfono de: "${text}"`
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
      return extractInfoFallback(text, infoType);
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
      return extractPeopleCountFallback(text);
    case 'date':
      return extractDateFallback(text);
    case 'time':
      return extractTimeFallback(text);
    case 'name':
      return extractNameFallback(text);
    case 'phone':
      return extractPhoneNumberFallback(text);
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
  
  // Mañana
  if (text.includes('mañana') || text.includes('tomorrow') || text.includes('morgen') || text.includes('domani') || text.includes('demain') || text.includes('amanhã')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  // Pasado mañana
  if (text.includes('pasado mañana') || text.includes('day after tomorrow') || text.includes('übermorgen') || text.includes('dopodomani') || text.includes('après-demain') || text.includes('depois de amanhã')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);
    return dayAfter.toISOString().split('T')[0];
  }
  
  // Días de la semana
  const dayMap = {
    'lunes': 1, 'monday': 1, 'montag': 1, 'lunedì': 1, 'lundi': 1, 'segunda': 1,
    'martes': 2, 'tuesday': 2, 'dienstag': 2, 'martedì': 2, 'mardi': 2, 'terça': 2,
    'miércoles': 3, 'wednesday': 3, 'mittwoch': 3, 'mercoledì': 3, 'mercredi': 3, 'quarta': 3,
    'jueves': 4, 'thursday': 4, 'donnerstag': 4, 'giovedì': 4, 'jeudi': 4, 'quinta': 4,
    'viernes': 5, 'friday': 5, 'freitag': 5, 'venerdì': 5, 'vendredi': 5, 'sexta': 5,
    'sábado': 6, 'saturday': 6, 'samstag': 6, 'sabato': 6, 'samedi': 6, 'sábado': 6,
    'domingo': 0, 'sunday': 0, 'sonntag': 0, 'domenica': 0, 'dimanche': 0, 'domingo': 0
  };
  
  for (const [day, dayOfWeek] of Object.entries(dayMap)) {
    if (text.includes(day)) {
      const targetDate = new Date(today);
      const currentDay = today.getDay();
      const daysUntilTarget = (dayOfWeek - currentDay + 7) % 7;
      if (daysUntilTarget === 0) daysUntilTarget = 7; // Próxima semana
      targetDate.setDate(today.getDate() + daysUntilTarget);
      return targetDate.toISOString().split('T')[0];
    }
  }
  
  return null;
}

function extractTimeFallback(text) {
  const timePattern = /(\d{1,2}):(\d{2})/;
  const match = text.match(timePattern);
  if (match) {
    const hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // Buscar patrones como "8 de la noche", "8 PM", etc.
  const hourPattern = /(\d{1,2})\s*(de la noche|PM|p\.m\.|abends|di sera|du soir|da noite)/i;
  const hourMatch = text.match(hourPattern);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    const adjustedHours = hours === 12 ? 12 : hours + 12;
    return `${adjustedHours.toString().padStart(2, '0')}:00`;
  }
  
  return null;
}

function extractNameFallback(text) {
  // Buscar patrones como "mi nombre es", "me llamo", etc.
  const namePatterns = [
    /(?:mi nombre es|me llamo|soy|my name is|ich heiße|mi chiamo|je m'appelle|meu nome é)\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+)/i,
    /(?:nombre|name|nome)\s*:?\s*([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+)/i
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractPhoneNumberFallback(text) {
  // Buscar números de teléfono
  const phonePattern = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const match = text.match(phonePattern);
  if (match) {
    return match[0].replace(/[-.\s]/g, '');
  }
  
  return null;
}

function generateTwiML(response, language) {
  const voice = getVoiceForLanguage(language);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${voice}" language="${language}-${getCountryCode(language)}">
    ${response}
  </Say>
  <Gather input="speech" timeout="3" speechTimeout="2" action="/api/twilio-call-premium" method="POST">
    <Say voice="${voice}" language="${language}-${getCountryCode(language)}">
      Por favor, responda.
    </Say>
  </Gather>
  <Say voice="${voice}" language="${language}-${getCountryCode(language)}">
    No he recibido respuesta. Gracias por llamar.
  </Say>
  <Hangup/>
</Response>`;
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

function getCountryCode(language) {
  const codes = {
    es: 'ES',
    en: 'US',
    de: 'DE',
    it: 'IT',
    fr: 'FR',
    pt: 'PT'
  };
  
  return codes[language] || 'ES';
}

async function saveReservation(state) {
  try {
    console.log('💾 Guardando reserva en base de datos...');
    
    const data = state.data;
    
    // Validar datos
    const validacion = validarReserva(data);
    if (!validacion.valido) {
      console.error('❌ Validación fallida:', validacion.errores);
      return false;
    }

    // Preparar conversación completa en formato Markdown
    const conversacionCompleta = generateMarkdownConversation(state);

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
        'Reserva realizada por teléfono (Twilio Premium)',
        conversacionCompleta
      ]);

      const idReserva = result.insertId;
      console.log('✅ Reserva guardada con ID:', idReserva);

      await connection.commit();
      return true;

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }

  } catch (error) {
    console.error('❌ Error guardando reserva:', error);
    return false;
  }
}

function generateMarkdownConversation(state) {
  const duration = Math.round((Date.now() - state.startTime) / 1000);
  
  return `# 📞 Conversación Premium

**Duración**: ${duration} segundos
**Idioma**: ${state.language}
**Sentimiento**: ${state.sentiment}
**Urgencia**: ${state.urgency}

## 📋 Datos de la Reserva
- **Personas**: ${state.data.NumeroReserva || 'No especificado'}
- **Fecha**: ${state.data.FechaReserva || 'No especificada'}
- **Hora**: ${state.data.HoraReserva || 'No especificada'}
- **Nombre**: ${state.data.NomReserva || 'No especificado'}
- **Teléfono**: ${state.data.TelefonReserva || 'No especificado'}

## 💬 Historial de Conversación
${state.conversationHistory.map(msg => `- **${msg.role}**: ${msg.message}`).join('\n')}

---
*Generado automáticamente por el sistema premium de reservas*
`;
}
