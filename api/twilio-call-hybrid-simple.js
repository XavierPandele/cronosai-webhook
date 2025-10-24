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
      temperature: 0.1,
      topP: 0.3,
      topK: 10,
      maxOutputTokens: 5,
    }
  });
  console.log('✅ Gemini 2.0 Flash inicializado SOLO para detección de idioma');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado, usando detección hardcodeada');
}

// Estados de conversación
const conversationStates = new Map();

// Respuestas optimizadas y naturales (del código original)
const RESPONSES = {
  greeting: {
    es: [
      '¡Hola! Bienvenido a nuestro restaurante. ¿Para cuántas personas necesitan mesa?',
      '¡Buenos días! ¿Cuántas personas serán para la reserva?',
      '¡Hola! ¿Para cuántos comensales?',
      '¡Saludos! ¿Cuántas personas en su grupo?',
      '¡Hola! ¿Para cuántas personas es la reserva?'
    ],
    en: [
      'Hello! Welcome to our restaurant. How many people will be dining?',
      'Good day! How many guests are we expecting?',
      'Hi there! How many people in your party?',
      'Hello! How many diners will we have?',
      'Good morning! How many people for the reservation?'
    ],
    de: [
      'Hallo! Willkommen in unserem Restaurant. Für wie viele Personen?',
      'Guten Tag! Wie viele Gäste erwarten wir?',
      'Hallo! Wie viele Personen in Ihrer Gruppe?',
      'Guten Morgen! Für wie viele Personen reservieren Sie?',
      'Hallo! Wie viele Gäste werden es sein?'
    ],
    it: [
      'Ciao! Benvenuto nel nostro ristorante. Per quante persone?',
      'Buongiorno! Quanti ospiti aspettiamo?',
      'Ciao! Quante persone nel vostro gruppo?',
      'Salve! Per quanti ospiti prenotate?',
      'Buongiorno! Quanti ospiti saranno?'
    ],
    fr: [
      'Bonjour! Bienvenue dans notre restaurant. Pour combien de personnes?',
      'Bonjour! Combien d\'invités attendons-nous?',
      'Salut! Combien de personnes dans votre groupe?',
      'Bonjour! Pour combien d\'invités réservez-vous?',
      'Bonjour! Combien d\'invités seront là?'
    ],
    pt: [
      'Olá! Bem-vindo ao nosso restaurante. Para quantas pessoas?',
      'Bom dia! Quantos convidados esperamos?',
      'Oi! Quantas pessoas no seu grupo?',
      'Olá! Para quantos convidados está reservando?',
      'Bom dia! Quantos convidados serão?'
    ]
  },
  ask_people: {
    es: [
      '¿Para cuántas personas será la reserva?',
      '¿Cuántas personas serán?',
      '¿Para cuántos comensales?',
      '¿Cuántas personas en su grupo?',
      '¿Para cuántas personas necesitan mesa?'
    ],
    en: [
      'How many people will the reservation be for?',
      'How many guests will be dining?',
      'How many people in your party?',
      'How many diners will we have?',
      'How many people for the reservation?'
    ],
    de: [
      'Für wie viele Personen soll die Reservierung sein?',
      'Wie viele Gäste werden es sein?',
      'Für wie viele Personen?',
      'Wie viele Personen in Ihrer Gruppe?',
      'Für wie viele Gäste reservieren Sie?'
    ],
    it: [
      'Per quante persone sarà la prenotazione?',
      'Quanti ospiti saranno?',
      'Per quante persone?',
      'Quanti ospiti nel vostro gruppo?',
      'Per quanti ospiti prenotate?'
    ],
    fr: [
      'Pour combien de personnes sera la réservation?',
      'Combien d\'invités seront là?',
      'Pour combien de personnes?',
      'Combien de personnes dans votre groupe?',
      'Pour combien d\'invités réservez-vous?'
    ],
    pt: [
      'Para quantas pessoas será a reserva?',
      'Quantos convidados serão?',
      'Para quantas pessoas?',
      'Quantas pessoas no seu grupo?',
      'Para quantos convidados está reservando?'
    ]
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

// Detectar idioma con Gemini (solo al inicio)
async function detectLanguage(userInput, phoneNumber) {
  if (!model) {
    console.log(`[LANGUAGE] ${phoneNumber}: es (1.0) via fallback`);
    return 'es';
  }
  
  try {
    const prompt = `Idioma de: "${userInput}"

Responde solo: es, en, de, it, fr, pt`;

    console.log(`[GEMINI_REQUEST] ${phoneNumber}: Enviando a language_detection_only`);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawLang = response.text().trim();
    
    // Sanitizar y normalizar idioma
    const detectedLang = normalizeLanguage(rawLang);
    
    const supportedLangs = ['es', 'en', 'de', 'it', 'fr', 'pt'];
    if (supportedLangs.includes(detectedLang)) {
      console.log(`[LANGUAGE] ${phoneNumber}: ${detectedLang} (0.95) via gemini`);
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

// Normalizar idioma detectado por Gemini
function normalizeLanguage(raw) {
  const s = raw.trim().toLowerCase().replace(/[`"' \t\n\r]/g, '');
  const two = s.slice(0, 2);
  const alias = {
    'es-es': 'es', 'en-us': 'en', 'pt-br': 'pt', 
    'fr-fr': 'fr', 'de-de': 'de', 'it-it': 'it'
  };
  return alias[s] || alias[two] || (['es', 'en', 'de', 'it', 'fr', 'pt'].includes(two) ? two : 'es');
}

// Extraer datos (del código original)
function extractData(userInput, currentStep, language) {
  const data = {};
  
  // Extraer número de personas
  if (currentStep === 'greeting' || currentStep === 'ask_people') {
    const people = extractPeople(userInput, language);
    if (people) data.people = people;
  }
  
  // Extraer fecha
  if (currentStep === 'ask_people' || currentStep === 'ask_date') {
    const date = extractDate(userInput, language);
    if (date) data.date = date;
  }
  
  // Extraer hora
  if (currentStep === 'ask_date' || currentStep === 'ask_time') {
    const time = extractTime(userInput, language);
    if (time) data.time = time;
  }
  
  // Extraer nombre
  if (currentStep === 'ask_time' || currentStep === 'ask_name') {
    const name = extractName(userInput, language);
    if (name) data.name = name;
  }
  
  return data;
}

// Extraer número de personas (del código original)
function extractPeople(input, language) {
  const numbers = input.match(/\b(\d+)\b/g);
  if (numbers) {
    const num = parseInt(numbers[0]);
    if (num >= 1 && num <= 20) return num;
  }
  
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

// Extraer fecha (del código original)
function extractDate(input, language) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const relativeDates = {
    es: { 'hoy': today, 'mañana': tomorrow },
    en: { 'today': today, 'tomorrow': tomorrow },
    de: { 'heute': today, 'morgen': tomorrow },
    it: { 'oggi': today, 'domani': tomorrow },
    fr: { 'aujourd\'hui': today, 'demain': tomorrow },
    pt: { 'hoje': today, 'amanhã': tomorrow }
  };
  
  const dates = relativeDates[language] || relativeDates.es;
  for (const [phrase, date] of Object.entries(dates)) {
    if (input.toLowerCase().includes(phrase)) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return null;
}

// Extraer hora (del código original)
function extractTime(input, language) {
  const timePatterns = [
    /(\d{1,2}):(\d{2})/g,
    /(\d{1,2})\s*(am|pm|AM|PM)/g,
    /(\d{1,2})\s*(de la mañana|de la tarde|de la noche)/gi
  ];
  
  for (const pattern of timePatterns) {
    const match = input.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const period = match[3];
      
      if (period) {
        const periodLower = period.toLowerCase();
        if (periodLower === 'pm' && hour < 12) {
          hour += 12;
        } else if (periodLower === 'am' && hour === 12) {
          hour = 0;
        }
      }
      
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
  }
  
  return null;
}

// Extraer nombre (del código original)
function extractName(input, language) {
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

// Obtener respuesta (del código original)
function getResponse(step, language) {
  const responseArray = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (Array.isArray(responseArray)) {
    return responseArray[Math.floor(Math.random() * responseArray.length)];
  }
  return responseArray || '¿En qué puedo ayudarle?';
}

// Generar TwiML (del código original)
function generateTwiML(message, language = 'es') {
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
  <Gather input="speech" language="${config.language}" timeout="6" speechTimeout="2" action="/api/twilio-call-hybrid-simple" method="POST" numDigits="0" enhanced="true">
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">
    No pude entender su respuesta. Por favor, llame de nuevo. Gracias.
  </Say>
  <Hangup/>
</Response>`;
}

// Guardar reserva (del código original)
async function saveReservation(state) {
  try {
    if (!state.data.people || !state.data.date || !state.data.time || !state.data.name) {
      return false;
    }
    
    const connection = await createConnection();
    await connection.beginTransaction();
    
    try {
      await connection.execute(`
        INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          NOM_COMPLET = VALUES(NOM_COMPLET), 
          DATA_ULTIMA_RESERVA = NOW()
      `, [state.data.name, state.data.phone]);
      
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
        'Reserva por teléfono - Sistema Híbrido Simple',
        JSON.stringify(state.conversationHistory)
      ]);
      
      await connection.commit();
      await connection.end();
      
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

// Handler principal (del código original + Gemini para idioma)
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  console.log(`[CALL_START] ${From}: "${userInput}"`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    data: {},
    conversationHistory: []
  };
  
  // Detectar idioma SOLO si no está detectado
  if (!state.language && userInput) {
    state.language = await detectLanguage(userInput, From);
    console.log(`[IDIOMA] Idioma detectado: ${state.language}`);
  }
  
  if (!state.language) {
    state.language = 'es';
  }
  
  // Extraer datos
  const extractedData = extractData(userInput, state.step, state.language);
  
  // Procesar datos extraídos
  if (extractedData.people && !state.data.people) {
    state.data.people = extractedData.people;
  }
  if (extractedData.date && !state.data.date) {
    state.data.date = extractedData.date;
  }
  if (extractedData.time && !state.data.time) {
    state.data.time = extractedData.time;
  }
  if (extractedData.name && !state.data.name) {
    state.data.name = extractedData.name;
  }
  
  // Determinar siguiente paso
  let nextStep = state.step;
  let response = '';
  
  switch (state.step) {
    case 'greeting':
      if (state.data.people) {
        nextStep = 'ask_date';
      } else {
        nextStep = 'ask_people';
      }
      break;
      
    case 'ask_people':
      if (state.data.people) {
        nextStep = 'ask_date';
      } else {
        nextStep = 'ask_people';
      }
      break;
      
    case 'ask_date':
      if (state.data.date) {
        nextStep = 'ask_time';
      } else {
        nextStep = 'ask_date';
      }
      break;
      
    case 'ask_time':
      if (state.data.time) {
        nextStep = 'ask_name';
      } else {
        nextStep = 'ask_time';
      }
      break;
      
    case 'ask_name':
      if (state.data.name) {
        state.data.phone = From;
        nextStep = 'complete';
      } else {
        nextStep = 'ask_name';
      }
      break;
      
    case 'complete':
      nextStep = 'finished';
      break;
  }
  
  // Generar respuesta
  response = getResponse(nextStep, state.language);
  
  // Si es el paso final, guardar reserva
  if (nextStep === 'complete' && state.data.people && state.data.date && state.data.time && state.data.name) {
    const saved = await saveReservation(state);
    if (saved) {
      response = getResponse('complete', state.language);
      nextStep = 'finished';
    } else {
      response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
      nextStep = 'error';
    }
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
  
  // Actualizar estado
  state.step = nextStep;
  conversationStates.set(From, state);
  
  // Limpiar estado al finalizar
  if (nextStep === 'finished' || nextStep === 'error') {
    conversationStates.delete(From);
  }
  
  // Generar TwiML
  const twiml = generateTwiML(response, state.language);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
