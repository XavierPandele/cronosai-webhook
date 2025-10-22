const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection, executeQuery } = require('../lib/database');

// Inicializar Gemini 2.0 Flash
let genAI, model;
if (process.env.GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
  console.log('✅ Gemini 2.0 Flash inicializado');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado, usando sistema hardcodeado');
}

// Estados de conversación
const conversationStates = new Map();

// Respuestas hardcodeadas como fallback
const RESPONSES = {
  greeting: {
    es: [
      '¡Hola! Bienvenido al restaurante. ¿En qué puedo ayudarle?',
      '¡Buenos días! Gracias por llamar. ¿Cómo puedo asistirle?',
      '¡Hola! Me da mucho gusto atenderle. ¿En qué le puedo ayudar?'
    ],
    en: [
      'Hello! Welcome to the restaurant. How can I help you?',
      'Good day! Thank you for calling. How may I assist you?',
      'Hi there! I\'m happy to help. What can I do for you?'
    ],
    de: [
      'Hallo! Willkommen im Restaurant. Wie kann ich Ihnen helfen?',
      'Guten Tag! Vielen Dank für den Anruf. Wie kann ich Ihnen behilflich sein?',
      'Hallo! Es freut mich, Ihnen zu helfen. Womit kann ich dienen?'
    ],
    it: [
      'Ciao! Benvenuto al ristorante. Come posso aiutarla?',
      'Buongiorno! Grazie per la chiamata. Come posso assisterla?',
      'Salve! Sono felice di aiutarla. Cosa posso fare per lei?'
    ],
    fr: [
      'Bonjour! Bienvenue au restaurant. Comment puis-je vous aider?',
      'Bonjour! Merci d\'avoir appelé. Comment puis-je vous assister?',
      'Salut! Je suis ravi de vous aider. Que puis-je faire pour vous?'
    ],
    pt: [
      'Olá! Bem-vindo ao restaurante. Como posso ajudá-lo?',
      'Bom dia! Obrigado por ligar. Como posso assisti-lo?',
      'Oi! Fico feliz em ajudar. O que posso fazer por você?'
    ]
  },
  ask_people: {
    es: [
      '¿Para cuántas personas será la reserva?',
      '¿Cuántas personas van a venir?',
      '¿Para cuántos comensales necesitan la mesa?'
    ],
    en: [
      'How many people will the reservation be for?',
      'How many people are coming?',
      'For how many guests do you need the table?'
    ],
    de: [
      'Für wie viele Personen soll die Reservierung sein?',
      'Wie viele Personen kommen?',
      'Für wie viele Gäste benötigen Sie den Tisch?'
    ],
    it: [
      'Per quante persone sarà la prenotazione?',
      'Quante persone vengono?',
      'Per quanti ospiti avete bisogno del tavolo?'
    ],
    fr: [
      'Pour combien de personnes sera la réservation?',
      'Combien de personnes viennent?',
      'Pour combien d\'invités avez-vous besoin de la table?'
    ],
    pt: [
      'Para quantas pessoas será a reserva?',
      'Quantas pessoas vão vir?',
      'Para quantos convidados vocês precisam da mesa?'
    ]
  },
  ask_date: {
    es: [
      '¿Para qué fecha necesita la reserva?',
      '¿Cuándo desean venir?',
      '¿Qué día prefieren?'
    ],
    en: [
      'What date do you need the reservation for?',
      'When would you like to come?',
      'What day do you prefer?'
    ],
    de: [
      'Für welches Datum benötigen Sie die Reservierung?',
      'Wann möchten Sie kommen?',
      'Welchen Tag bevorzugen Sie?'
    ],
    it: [
      'Per quale data avete bisogno della prenotazione?',
      'Quando vorreste venire?',
      'Che giorno preferite?'
    ],
    fr: [
      'Pour quelle date avez-vous besoin de la réservation?',
      'Quand aimeriez-vous venir?',
      'Quel jour préférez-vous?'
    ],
    pt: [
      'Para que data vocês precisam da reserva?',
      'Quando gostariam de vir?',
      'Que dia preferem?'
    ]
  },
  ask_time: {
    es: [
      '¿A qué hora prefieren venir?',
      '¿Qué hora les conviene?',
      '¿A qué hora desean la mesa?'
    ],
    en: [
      'What time would you prefer to come?',
      'What time works for you?',
      'What time do you want the table?'
    ],
    de: [
      'Um welche Uhrzeit möchten Sie kommen?',
      'Welche Uhrzeit passt Ihnen?',
      'Um welche Uhrzeit möchten Sie den Tisch?'
    ],
    it: [
      'A che ora preferite venire?',
      'Che ora vi conviene?',
      'A che ora volete il tavolo?'
    ],
    fr: [
      'À quelle heure préférez-vous venir?',
      'Quelle heure vous convient?',
      'À quelle heure voulez-vous la table?'
    ],
    pt: [
      'Que horas preferem vir?',
      'Que horas lhes convém?',
      'Que horas querem a mesa?'
    ]
  },
  ask_name: {
    es: [
      '¿Cómo se llama?',
      '¿Cuál es su nombre?',
      '¿Bajo qué nombre hago la reserva?'
    ],
    en: [
      'What\'s your name?',
      'What should I call you?',
      'Under what name should I make the reservation?'
    ],
    de: [
      'Wie heißen Sie?',
      'Wie ist Ihr Name?',
      'Unter welchem Namen soll ich die Reservierung machen?'
    ],
    it: [
      'Come si chiama?',
      'Qual è il suo nome?',
      'Sotto quale nome faccio la prenotazione?'
    ],
    fr: [
      'Comment vous appelez-vous?',
      'Quel est votre nom?',
      'Sous quel nom dois-je faire la réservation?'
    ],
    pt: [
      'Como se chama?',
      'Qual é o seu nome?',
      'Sob qual nome faço a reserva?'
    ]
  },
  ask_phone: {
    es: [
      '¿Podría confirmar su número de teléfono?',
      '¿Cuál es su número de contacto?',
      '¿Me da su teléfono para confirmar?'
    ],
    en: [
      'Could you confirm your phone number?',
      'What\'s your contact number?',
      'Could you give me your phone to confirm?'
    ],
    de: [
      'Könnten Sie Ihre Telefonnummer bestätigen?',
      'Wie ist Ihre Kontaktnummer?',
      'Könnten Sie mir Ihre Telefonnummer zur Bestätigung geben?'
    ],
    it: [
      'Potrebbe confermare il suo numero di telefono?',
      'Qual è il suo numero di contatto?',
      'Potrebbe darmi il suo telefono per confermare?'
    ],
    fr: [
      'Pourriez-vous confirmer votre numéro de téléphone?',
      'Quel est votre numéro de contact?',
      'Pourriez-vous me donner votre téléphone pour confirmer?'
    ],
    pt: [
      'Poderia confirmar o seu número de telefone?',
      'Qual é o seu número de contato?',
      'Poderia me dar o seu telefone para confirmar?'
    ]
  },
  complete: {
    es: [
      '¡Perfecto! Su reserva está confirmada. ¡Que disfruten!',
      '¡Excelente! Mesa reservada. ¡Que tengan un buen día!',
      '¡Listo! Reserva confirmada. ¡Buen provecho!'
    ],
    en: [
      'Perfect! Your reservation is confirmed. Enjoy!',
      'Excellent! Table reserved. Have a great day!',
      'Done! Reservation confirmed. Bon appétit!'
    ],
    de: [
      'Perfekt! Ihre Reservierung ist bestätigt. Viel Spaß!',
      'Ausgezeichnet! Tisch reserviert. Einen schönen Tag!',
      'Fertig! Reservierung bestätigt. Guten Appetit!'
    ],
    it: [
      'Perfetto! La sua prenotazione è confermata. Buon appetito!',
      'Eccellente! Tavolo prenotato. Buona giornata!',
      'Fatto! Prenotazione confermata. Buon appetito!'
    ],
    fr: [
      'Parfait! Votre réservation est confirmée. Bon appétit!',
      'Excellent! Table réservée. Bonne journée!',
      'Terminé! Réservation confirmée. Bon appétit!'
    ],
    pt: [
      'Perfeito! Sua reserva está confirmada. Bom apetite!',
      'Excelente! Mesa reservada. Tenham um ótimo dia!',
      'Pronto! Reserva confirmada. Bom apetite!'
    ]
  }
};

// Detectar idioma con Gemini 2.0
async function detectLanguageWithGemini(text) {
  if (!model) return 'es';
  
  try {
    const prompt = `Analiza el siguiente texto y determina el idioma. Responde SOLO con el código del idioma (es, en, de, it, fr, pt).

Texto: "${text}"

Idioma:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const detectedLang = response.text().trim().toLowerCase();
    
    // Validar que sea un idioma soportado
    const supportedLangs = ['es', 'en', 'de', 'it', 'fr', 'pt'];
    if (supportedLangs.includes(detectedLang)) {
      console.log(`[GEMINI] Idioma detectado: ${detectedLang}`);
      return detectedLang;
    }
    
    return 'es';
  } catch (error) {
    console.error('[GEMINI] Error detectando idioma:', error);
    return 'es';
  }
}

// Analizar sentimiento con Gemini 2.0
async function analyzeSentimentWithGemini(text, language) {
  if (!model) return { sentiment: 'neutral', urgency: 'normal' };
  
  try {
    const prompt = `Analiza el sentimiento y urgencia del siguiente texto en ${language}. Responde en formato JSON:

{
  "sentiment": "positive|neutral|negative|frustrated",
  "urgency": "low|normal|high",
  "confidence": 0.0-1.0
}

Texto: "${text}"

Análisis:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const analysis = JSON.parse(response.text().trim());
    
    console.log(`[GEMINI] Sentimiento: ${analysis.sentiment}, Urgencia: ${analysis.urgency}`);
    return analysis;
  } catch (error) {
    console.error('[GEMINI] Error analizando sentimiento:', error);
    return { sentiment: 'neutral', urgency: 'normal', confidence: 0.5 };
  }
}

// Generar respuesta natural con Gemini 2.0
async function generateNaturalResponseWithGemini(step, language, sentiment, urgency, reservationData) {
  if (!model) {
    return generateResponseFallback(step, language);
  }
  
  try {
    const context = {
      step,
      language,
      sentiment,
      urgency,
      reservationData: reservationData || {}
    };
    
    const prompt = `Eres un asistente de restaurante profesional. Genera una respuesta natural y amigable para el paso "${step}" en idioma ${language}.

Contexto:
- Sentimiento del cliente: ${sentiment}
- Urgencia: ${urgency}
- Datos de reserva: ${JSON.stringify(reservationData || {})}

Genera UNA respuesta natural, amigable y profesional. No uses frases robóticas. Responde directamente sin explicaciones.

Respuesta:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const naturalResponse = response.text().trim();
    
    console.log(`[GEMINI] Respuesta generada: "${naturalResponse}"`);
    return naturalResponse;
  } catch (error) {
    console.error('[GEMINI] Error generando respuesta:', error);
    return generateResponseFallback(step, language);
  }
}

// Extraer información con Gemini 2.0
async function extractInfoWithGemini(text, infoType, language) {
  if (!model) return null;
  
  try {
    let prompt = '';
    
    switch (infoType) {
      case 'people':
        prompt = `Extrae el número de personas del siguiente texto en ${language}. Responde SOLO con el número (1-20) o "null" si no se puede determinar.

Texto: "${text}"

Número de personas:`;
        break;
        
      case 'date':
        prompt = `Extrae la fecha del siguiente texto en ${language}. Responde en formato YYYY-MM-DD o "null" si no se puede determinar.

Texto: "${text}"

Fecha (YYYY-MM-DD):`;
        break;
        
      case 'time':
        prompt = `Extrae la hora del siguiente texto en ${language}. Responde en formato HH:MM (24h) o "null" si no se puede determinar.

Texto: "${text}"

Hora (HH:MM):`;
        break;
        
      case 'name':
        prompt = `Extrae el nombre de la persona del siguiente texto en ${language}. Responde SOLO con el nombre o "null" si no se puede determinar.

Texto: "${text}"

Nombre:`;
        break;
        
      case 'phone':
        prompt = `Extrae el número de teléfono del siguiente texto en ${language}. Responde SOLO con el número o "null" si no se puede determinar.

Texto: "${text}"

Teléfono:`;
        break;
    }
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const extracted = response.text().trim();
    
    if (extracted === 'null' || extracted === '') {
      console.log(`[GEMINI] No se pudo extraer ${infoType}`);
      return null;
    }
    
    console.log(`[GEMINI] ${infoType} extraído: "${extracted}"`);
    return extracted;
  } catch (error) {
    console.error(`[GEMINI] Error extrayendo ${infoType}:`, error);
    return null;
  }
}

// Fallback para respuestas
function generateResponseFallback(step, language) {
  const responses = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (responses && Array.isArray(responses)) {
    return responses[Math.floor(Math.random() * responses.length)];
  }
  return '¿En qué puedo ayudarle?';
}

// Extraer número de personas - Fallback robusto
function extractPeopleFallback(text) {
  console.log(`[FALLBACK] Extrayendo personas de: "${text}"`);
  
  // Números en palabras
  const wordNumbers = {
    // Español
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
    
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'elf': 11, 'zwölf': 12, 'dreizehn': 13, 'vierzehn': 14, 'fünfzehn': 15,
    'sechzehn': 16, 'siebzehn': 17, 'achtzehn': 18, 'neunzehn': 19, 'zwanzig': 20,
    
    // Italiano
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'undici': 11, 'dodici': 12, 'tredici': 13, 'quattordici': 14, 'quindici': 15,
    'sedici': 16, 'diciassette': 17, 'diciotto': 18, 'diciannove': 19, 'venti': 20,
    
    // Francés
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15,
    'seize': 16, 'dix-sept': 17, 'dix-huit': 18, 'dix-neuf': 19, 'vingt': 20,
    
    // Portugués
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
    'onze': 11, 'doze': 12, 'treze': 13, 'catorze': 14, 'quinze': 15,
    'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19, 'vinte': 20
  };
  
  // Buscar números en palabras
  for (const [word, number] of Object.entries(wordNumbers)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(text)) {
      console.log(`[FALLBACK] Palabra encontrada: ${word} = ${number}`);
      return number;
    }
  }
  
  // Buscar números digitales
  const digitMatches = text.match(/\b(\d+)\b/g);
  if (digitMatches) {
    for (const numStr of digitMatches) {
      const number = parseInt(numStr);
      if (number >= 1 && number <= 20) {
        console.log(`[FALLBACK] Número directo: ${number}`);
        return number;
      }
    }
  }
  
  return null;
}

// Extraer fecha - Fallback robusto
function extractDateFallback(text) {
  console.log(`[FALLBACK] Extrayendo fecha de: "${text}"`);
  
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  
  // Fechas relativas
  const relativeDates = {
    'mañana': tomorrow, 'tomorrow': tomorrow, 'morgen': tomorrow,
    'domani': tomorrow, 'demain': tomorrow, 'amanhã': tomorrow,
    'pasado mañana': dayAfterTomorrow, 'day after tomorrow': dayAfterTomorrow,
    'übermorgen': dayAfterTomorrow, 'dopodomani': dayAfterTomorrow,
    'après-demain': dayAfterTomorrow, 'depois de amanhã': dayAfterTomorrow
  };
  
  for (const [phrase, date] of Object.entries(relativeDates)) {
    if (text.toLowerCase().includes(phrase)) {
      const result = date.toISOString().split('T')[0];
      console.log(`[FALLBACK] Fecha detectada: ${phrase} = ${result}`);
      return result;
    }
  }
  
  return null;
}

// Extraer hora - Fallback robusto
function extractTimeFallback(text) {
  console.log(`[FALLBACK] Extrayendo hora de: "${text}"`);
  
  // Patrones de hora
  const timePatterns = [
    /(\d{1,2}):(\d{2})/g,
    /(\d{1,2})\.(\d{2})/g,
    /(\d{1,2})\s+(\d{2})/g,
    /(\d{1,2})\s*(am|pm|AM|PM)/g,
    /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)/g
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
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
      
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        console.log(`[FALLBACK] Hora detectada: ${time}`);
        return time;
      }
    }
  }
  
  return null;
}

// Extraer nombre - Fallback robusto
function extractNameFallback(text) {
  console.log(`[FALLBACK] Extrayendo nombre de: "${text}"`);
  
  const patterns = [
    /(?:me llamo|soy|mi nombre es)\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+)/i,
    /(?:my name is|i am|i'm)\s+([a-zA-Z\s]+)/i,
    /(?:ich heiße|ich bin)\s+([a-zA-ZäöüßÄÖÜ\s]+)/i,
    /(?:mi chiamo|sono)\s+([a-zA-ZàèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ\s]+)/i,
    /(?:je m'appelle|je suis)\s+([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s]+)/i,
    /(?:meu nome é|eu sou)\s+([a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      console.log(`[FALLBACK] Nombre detectado: ${name}`);
      return name;
    }
  }
  
  return null;
}

// Guardar reserva
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    
    const { people, date, time, name, phone } = state.data;
    
    if (!people || !date || !time || !name) {
      console.log('[GUARDAR] Datos incompletos para guardar');
      return false;
    }
    
    const connection = await createConnection();
    await connection.beginTransaction();
    
    try {
      const insertQuery = `
        INSERT INTO reservas (personas, fecha, hora, nombre, telefono, conversacion_completa, idioma, sentimiento, urgencia, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;
      
      const conversationMarkdown = generateConversationMarkdown(state);
      
      await connection.execute(insertQuery, [
        people,
        date,
        time,
        name,
        phone || 'N/A',
        conversationMarkdown,
        state.language,
        state.sentiment || 'neutral',
        state.urgency || 'normal'
      ]);
      
      await connection.commit();
      console.log('[GUARDAR] Reserva guardada exitosamente');
      return true;
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
    
  } catch (error) {
    console.error('[GUARDAR] Error guardando reserva:', error);
    return false;
  }
}

// Generar conversación en Markdown
function generateConversationMarkdown(state) {
  let markdown = `# Conversación de Reserva\n\n`;
  markdown += `**Idioma**: ${state.language}\n`;
  markdown += `**Sentimiento**: ${state.sentiment || 'neutral'}\n`;
  markdown += `**Urgencia**: ${state.urgency || 'normal'}\n\n`;
  
  markdown += `## Datos de la Reserva\n\n`;
  markdown += `- **Personas**: ${state.data.people}\n`;
  markdown += `- **Fecha**: ${state.data.date}\n`;
  markdown += `- **Hora**: ${state.data.time}\n`;
  markdown += `- **Nombre**: ${state.data.name}\n`;
  markdown += `- **Teléfono**: ${state.data.phone || 'N/A'}\n\n`;
  
  markdown += `## Conversación Completa\n\n`;
  
  state.conversationHistory.forEach((entry, index) => {
    const role = entry.role === 'user' ? 'Cliente' : 'Bot';
    markdown += `### ${role} (${entry.timestamp})\n\n`;
    markdown += `${entry.message}\n\n`;
  });
  
  return markdown;
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
  <Gather input="speech" language="${config.language}" timeout="8" speechTimeout="5" action="/api/twilio-call-gemini-2.0" method="POST">
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

// Handler principal
module.exports = async function handler(req, res) {
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    sentiment: 'neutral',
    urgency: 'normal',
    data: {},
    conversationHistory: []
  };
  
  // Detectar idioma con Gemini 2.0
  if (!state.language && userInput) {
    state.language = await detectLanguageWithGemini(userInput);
    console.log(`[IDIOMA] Idioma detectado: ${state.language}`);
  }
  
  if (!state.language) {
    state.language = 'es';
  }
  
  // Analizar sentimiento con Gemini 2.0
  if (userInput) {
    const sentimentAnalysis = await analyzeSentimentWithGemini(userInput, state.language);
    state.sentiment = sentimentAnalysis.sentiment;
    state.urgency = sentimentAnalysis.urgency;
  }
  
  // Procesar según el paso actual
  let response = '';
  
  try {
    switch (state.step) {
      case 'greeting':
        state.step = 'ask_people';
        response = await generateNaturalResponseWithGemini('greeting', state.language, state.sentiment, state.urgency, state.data);
        break;
        
      case 'ask_people':
        let people = await extractInfoWithGemini(userInput, 'people', state.language);
        if (!people) {
          people = extractPeopleFallback(userInput);
        }
        
        if (people) {
          state.data.people = parseInt(people);
          state.step = 'ask_date';
          response = await generateNaturalResponseWithGemini('ask_date', state.language, state.sentiment, state.urgency, state.data);
        } else {
          response = await generateNaturalResponseWithGemini('ask_people', state.language, state.sentiment, state.urgency, state.data);
        }
        break;
        
      case 'ask_date':
        let date = await extractInfoWithGemini(userInput, 'date', state.language);
        if (!date) {
          date = extractDateFallback(userInput);
        }
        
        if (date) {
          state.data.date = date;
          state.step = 'ask_time';
          response = await generateNaturalResponseWithGemini('ask_time', state.language, state.sentiment, state.urgency, state.data);
        } else {
          response = await generateNaturalResponseWithGemini('ask_date', state.language, state.sentiment, state.urgency, state.data);
        }
        break;
        
      case 'ask_time':
        let time = await extractInfoWithGemini(userInput, 'time', state.language);
        if (!time) {
          time = extractTimeFallback(userInput);
        }
        
        if (time) {
          state.data.time = time;
          state.step = 'ask_name';
          response = await generateNaturalResponseWithGemini('ask_name', state.language, state.sentiment, state.urgency, state.data);
        } else {
          response = await generateNaturalResponseWithGemini('ask_time', state.language, state.sentiment, state.urgency, state.data);
        }
        break;
        
      case 'ask_name':
        let name = await extractInfoWithGemini(userInput, 'name', state.language);
        if (!name) {
          name = extractNameFallback(userInput);
        }
        
        if (name) {
          state.data.name = name;
          state.step = 'ask_phone';
          response = await generateNaturalResponseWithGemini('ask_phone', state.language, state.sentiment, state.urgency, state.data);
        } else {
          response = await generateNaturalResponseWithGemini('ask_name', state.language, state.sentiment, state.urgency, state.data);
        }
        break;
        
      case 'ask_phone':
        state.data.phone = From;
        state.step = 'complete';
        
        const saved = await saveReservation(state);
        if (saved) {
          response = await generateNaturalResponseWithGemini('complete', state.language, state.sentiment, state.urgency, state.data);
          state.step = 'finished';
        } else {
          response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        }
        break;
        
      default:
        response = await generateNaturalResponseWithGemini('greeting', state.language, state.sentiment, state.urgency, state.data);
    }
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
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
  conversationStates.set(From, state);
  
  // Generar TwiML
  const twiml = generateTwiML(response, state.language);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
