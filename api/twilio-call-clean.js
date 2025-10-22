const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Inicializar Gemini solo si hay API key
let model = null;
if (process.env.GOOGLE_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log('✅ Gemini inicializado correctamente');
  } catch (error) {
    console.log('⚠️ Error inicializando Gemini:', error.message);
  }
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurada, usando respuestas hardcoded');
}

// Estados de conversación
const conversationStates = new Map();

// Respuestas optimizadas por idioma
const RESPONSES = {
  greeting: {
    es: '¡Hola! Bienvenido a nuestro restaurante. ¿Para cuántas personas desea reservar?',
    en: 'Hello! Welcome to our restaurant. For how many people would you like to make a reservation?',
    de: 'Hallo! Willkommen in unserem Restaurant. Für wie viele Personen möchten Sie reservieren?',
    it: 'Ciao! Benvenuto nel nostro ristorante. Per quante persone vorreste prenotare?',
    fr: 'Bonjour! Bienvenue dans notre restaurant. Pour combien de personnes souhaitez-vous réserver?',
    pt: 'Olá! Bem-vindo ao nosso restaurante. Para quantas pessoas gostaria de fazer uma reserva?'
  },
  ask_date: {
    es: 'Perfecto. ¿Para qué fecha?',
    en: 'Perfect. For what date?',
    de: 'Perfekt. Für welches Datum?',
    it: 'Perfetto. Per quale data?',
    fr: 'Parfait. Pour quelle date?',
    pt: 'Perfeito. Para que data?'
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
    es: '¿Su nombre completo?',
    en: 'Your full name?',
    de: 'Ihr vollständiger Name?',
    it: 'Il suo nome completo?',
    fr: 'Votre nom complet?',
    pt: 'O seu nome completo?'
  },
  ask_phone: {
    es: '¿Desea usar este número de teléfono?',
    en: 'Would you like to use this phone number?',
    de: 'Möchten Sie diese Telefonnummer verwenden?',
    it: 'Vorrebbe usare questo numero di telefono?',
    fr: 'Souhaitez-vous utiliser ce numéro de téléphone?',
    pt: 'Gostaria de usar este número de telefone?'
  },
  complete: {
    es: 'Reserva confirmada. ¡Les esperamos!',
    en: 'Reservation confirmed. We look forward to seeing you!',
    de: 'Reservierung bestätigt. Wir freuen uns auf Sie!',
    it: 'Prenotazione confermata. Non vediamo l\'ora di vedervi!',
    fr: 'Réservation confirmée. Nous avons hâte de vous voir!',
    pt: 'Reserva confirmada. Esperamos vê-los!'
  }
};

// Detectar idioma
function detectLanguage(text) {
  const patterns = {
    es: /\b(hola|buenos|buenas|gracias|por favor|sí|no|reservar|mesa|personas|fecha|hora|nombre|teléfono)\b/i,
    en: /\b(hello|hi|good|thanks|please|yes|no|book|table|people|date|time|name|phone)\b/i,
    de: /\b(hallo|guten|danke|bitte|ja|nein|buchen|tisch|personen|datum|zeit|name|telefon)\b/i,
    it: /\b(ciao|buongiorno|grazie|per favore|sì|no|prenotare|tavolo|persone|data|ora|nome|telefono)\b/i,
    fr: /\b(bonjour|salut|merci|s\'il vous plaît|oui|non|réserver|table|personnes|date|heure|nom|téléphone)\b/i,
    pt: /\b(olá|bom|obrigado|por favor|sim|não|reservar|mesa|pessoas|data|hora|nome|telefone)\b/i
  };
  
  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      return lang;
    }
  }
  
  return 'es'; // Default
}

// Extraer número de personas
function extractPeople(text) {
  const numbers = text.match(/\b(\d+)\b/g);
  if (numbers) {
    const num = parseInt(numbers[numbers.length - 1]);
    if (num >= 1 && num <= 20) {
      return num;
    }
  }
  
  // Palabras en diferentes idiomas
  const wordNumbers = {
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5
  };
  
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (text.toLowerCase().includes(word)) {
      return num;
    }
  }
  
  return null;
}

// Extraer fecha
function extractDate(text) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (text.toLowerCase().includes('mañana') || text.toLowerCase().includes('tomorrow')) {
    return tomorrow.toISOString().split('T')[0];
  }
  
  if (text.toLowerCase().includes('pasado mañana') || text.toLowerCase().includes('day after tomorrow')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter.toISOString().split('T')[0];
  }
  
  return null;
}

// Extraer hora
function extractTime(text) {
  const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3];
    
    if (period && period.toLowerCase() === 'pm' && hour < 12) {
      hour += 12;
    }
    
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }
  
  return null;
}

// Extraer nombre
function extractName(text) {
  // Buscar patrones como "me llamo", "soy", "my name is", etc.
  const patterns = [
    /(?:me llamo|soy|mi nombre es)\s+([a-zA-Z\s]+)/i,
    /(?:my name is|i am|i'm)\s+([a-zA-Z\s]+)/i,
    /(?:ich heiße|ich bin)\s+([a-zA-Z\s]+)/i,
    /(?:mi chiamo|sono)\s+([a-zA-Z\s]+)/i,
    /(?:je m'appelle|je suis)\s+([a-zA-Z\s]+)/i,
    /(?:meu nome é|eu sou)\s+([a-zA-Z\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  // Si no hay patrón, tomar la primera palabra que parezca nombre
  const words = text.split(' ').filter(word => word.length > 2 && /^[a-zA-Z]+$/.test(word));
  return words.length > 0 ? words[0] : null;
}

// Generar respuesta con Gemini o fallback
async function generateResponse(step, language, context) {
  if (model) {
    try {
      const prompt = `
      Eres un asistente de restaurante amigable y profesional.
      
      Paso: ${step}
      Idioma: ${language}
      Contexto: ${JSON.stringify(context)}
      
      Responde de forma natural y conversacional en ${language}.
      Máximo 15 palabras.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error con Gemini:', error);
    }
  }
  
  // Fallback a respuestas hardcoded
  return RESPONSES[step]?.[language] || RESPONSES[step]?.['es'] || '¿En qué puedo ayudarle?';
}

// Guardar reserva
async function saveReservation(state) {
  try {
    console.log('💾 Guardando reserva...', state.data);
    
    const connection = await createConnection();
    await connection.beginTransaction();
    
    // Insertar cliente
    await connection.execute(`
      INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
      VALUES (?, ?, NOW()) 
      ON DUPLICATE KEY UPDATE 
        NOM_COMPLET = VALUES(NOM_COMPLET), 
        DATA_ULTIMA_RESERVA = NOW()
    `, [state.data.name, state.data.phone]);
    
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
      'Reserva por teléfono',
      JSON.stringify(state.conversation)
    ]);
    
    await connection.commit();
    await connection.end();
    
    console.log('✅ Reserva guardada exitosamente');
    return true;
  } catch (error) {
    console.error('❌ Error guardando reserva:', error);
    return false;
  }
}

// Función principal
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  console.log(`📞 Llamada de ${From}: "${userInput}"`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: 'es',
    data: {},
    conversation: []
  };
  
  // Detectar idioma si es la primera interacción
  if (state.step === 'greeting' && userInput) {
    state.language = detectLanguage(userInput);
    console.log(`🌍 Idioma detectado: ${state.language}`);
  }
  
  // Procesar según el paso actual
  let response = '';
  
  switch (state.step) {
    case 'greeting':
      state.step = 'ask_people';
      response = await generateResponse('greeting', state.language, {});
      break;
      
    case 'ask_people':
      const people = extractPeople(userInput);
      if (people) {
        state.data.people = people;
        state.step = 'ask_date';
        response = await generateResponse('ask_date', state.language, state.data);
      } else {
        response = await generateResponse('ask_people', state.language, state.data);
      }
      break;
      
    case 'ask_date':
      const date = extractDate(userInput);
      if (date) {
        state.data.date = date;
        state.step = 'ask_time';
        response = await generateResponse('ask_time', state.language, state.data);
      } else {
        response = await generateResponse('ask_date', state.language, state.data);
      }
      break;
      
    case 'ask_time':
      const time = extractTime(userInput);
      if (time) {
        state.data.time = time;
        state.step = 'ask_name';
        response = await generateResponse('ask_name', state.language, state.data);
      } else {
        response = await generateResponse('ask_time', state.language, state.data);
      }
      break;
      
    case 'ask_name':
      const name = extractName(userInput);
      if (name) {
        state.data.name = name;
        state.step = 'ask_phone';
        response = await generateResponse('ask_phone', state.language, state.data);
      } else {
        response = await generateResponse('ask_name', state.language, state.data);
      }
      break;
      
    case 'ask_phone':
      // Usar número de Twilio o extraer de input
      state.data.phone = From;
      state.step = 'complete';
      
      // Guardar reserva
      const saved = await saveReservation(state);
      if (saved) {
        response = await generateResponse('complete', state.language, state.data);
        state.step = 'finished';
      } else {
        response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
      }
      break;
      
    default:
      response = await generateResponse('greeting', state.language, {});
  }
  
  // Guardar conversación
  state.conversation.push({
    user: userInput,
    bot: response,
    timestamp: new Date().toISOString()
  });
  
  // Actualizar estado
  conversationStates.set(From, state);
  
  // Generar TwiML
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Lupe" language="${state.language}-ES">
    ${response}
  </Say>
  <Gather input="speech" timeout="5" speechTimeout="3" action="/api/twilio-call-clean" method="POST">
    <Say voice="Polly.Lupe" language="${state.language}-ES">
      Por favor, responda.
    </Say>
  </Gather>
  <Say voice="Polly.Lupe" language="${state.language}-ES">
    No he recibido respuesta. Gracias por llamar.
  </Say>
  <Hangup/>
</Response>`;
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
