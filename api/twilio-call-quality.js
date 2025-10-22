const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Inicializar Gemini solo si hay API key
let model = null;
if (process.env.GOOGLE_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
    console.log('[GEMINI] Inicializado correctamente');
  } catch (error) {
    console.log('[WARN] Error inicializando Gemini:', error.message);
  }
} else {
  console.log('[WARN] GOOGLE_API_KEY no configurada, usando respuestas optimizadas');
}

// Estados de conversación con persistencia mejorada
const conversationStates = new Map();

// Respuestas optimizadas - MÁS NATURALES Y VARIADAS
const RESPONSES = {
  greeting: {
    es: [
      '¡Hola! ¿Para cuántas personas necesitan mesa?',
      '¡Buenos días! ¿Cuántas personas serán?',
      '¡Hola! ¿Para cuántos comensales?',
      '¡Saludos! ¿Cuántas personas en su grupo?',
      '¡Hola! ¿Para cuántas personas es la reserva?'
    ],
    en: [
      'Hello! How many people will be dining?',
      'Good day! How many guests are we expecting?',
      'Hi there! How many people in your party?',
      'Hello! How many diners will we have?',
      'Good morning! How many people for the reservation?'
    ],
    de: [
      'Hallo! Für wie viele Personen?',
      'Guten Tag! Wie viele Gäste erwarten wir?',
      'Hallo! Wie viele Personen in Ihrer Gruppe?',
      'Guten Morgen! Für wie viele Personen reservieren Sie?',
      'Hallo! Wie viele Gäste werden es sein?'
    ],
    it: [
      'Ciao! Per quante persone?',
      'Buongiorno! Quanti ospiti aspettiamo?',
      'Ciao! Quante persone nel vostro gruppo?',
      'Salve! Per quante persone prenotate?',
      'Ciao! Quanti ospiti saranno?'
    ],
    fr: [
      'Bonjour! Pour combien de personnes?',
      'Bonjour! Combien d\'invités attendons-nous?',
      'Salut! Combien de personnes dans votre groupe?',
      'Bonjour! Pour combien de personnes réservez-vous?',
      'Salut! Combien d\'invités seront là?'
    ],
    pt: [
      'Olá! Para quantas pessoas?',
      'Bom dia! Quantos convidados esperamos?',
      'Oi! Quantas pessoas no seu grupo?',
      'Olá! Para quantas pessoas está reservando?',
      'Oi! Quantos convidados serão?'
    ]
  },
  ask_date: {
    es: [
      'Perfecto. ¿Para qué día necesitan la mesa?',
      'Excelente. ¿Qué fecha prefieren?',
      'Genial. ¿Para cuándo es la reserva?',
      'Muy bien. ¿Qué día les conviene?',
      'Perfecto. ¿Cuándo quieren venir?'
    ],
    en: [
      'Perfect. What day do you need the table?',
      'Great. What date works for you?',
      'Excellent. When would you like to come?',
      'Wonderful. What day suits you?',
      'Perfect. When do you want to dine?'
    ],
    de: [
      'Perfekt. Für welchen Tag brauchen Sie den Tisch?',
      'Großartig. Welches Datum passt Ihnen?',
      'Ausgezeichnet. Wann möchten Sie kommen?',
      'Wunderbar. Welcher Tag passt Ihnen?',
      'Perfekt. Wann möchten Sie essen?'
    ],
    it: [
      'Perfetto. Per quale giorno avete bisogno del tavolo?',
      'Ottimo. Quale data vi conviene?',
      'Eccellente. Quando vorreste venire?',
      'Meraviglioso. Quale giorno vi va bene?',
      'Perfetto. Quando volete cenare?'
    ],
    fr: [
      'Parfait. Pour quel jour avez-vous besoin de la table?',
      'Excellent. Quelle date vous convient?',
      'Parfait. Quand aimeriez-vous venir?',
      'Merveilleux. Quel jour vous arrange?',
      'Parfait. Quand voulez-vous dîner?'
    ],
    pt: [
      'Perfeito. Para que dia precisam da mesa?',
      'Ótimo. Que data lhes convém?',
      'Excelente. Quando gostariam de vir?',
      'Maravilhoso. Que dia lhes serve?',
      'Perfeito. Quando querem jantar?'
    ]
  },
  ask_time: {
    es: [
      '¿A qué hora prefieren venir?',
      '¿Qué hora les conviene?',
      '¿A qué hora quieren la mesa?',
      '¿Cuál es su hora preferida?',
      '¿A qué hora desean cenar?'
    ],
    en: [
      'What time would you prefer?',
      'What time works for you?',
      'What time do you want the table?',
      'What\'s your preferred time?',
      'What time would you like to dine?'
    ],
    de: [
      'Um welche Uhrzeit möchten Sie kommen?',
      'Welche Zeit passt Ihnen?',
      'Um welche Uhrzeit brauchen Sie den Tisch?',
      'Was ist Ihre bevorzugte Zeit?',
      'Um welche Uhrzeit möchten Sie essen?'
    ],
    it: [
      'A che ora preferite venire?',
      'Che ora vi conviene?',
      'A che ora volete il tavolo?',
      'Qual è il vostro orario preferito?',
      'A che ora volete cenare?'
    ],
    fr: [
      'À quelle heure préférez-vous venir?',
      'Quelle heure vous convient?',
      'À quelle heure voulez-vous la table?',
      'Quel est votre horaire préféré?',
      'À quelle heure voulez-vous dîner?'
    ],
    pt: [
      'A que hora preferem vir?',
      'Que hora lhes convém?',
      'A que hora querem a mesa?',
      'Qual é o seu horário preferido?',
      'A que hora querem jantar?'
    ]
  },
  ask_name: {
    es: [
      '¿Cómo se llama la persona que hace la reserva?',
      '¿Cuál es el nombre para la reserva?',
      '¿Bajo qué nombre reservamos?',
      '¿Cómo debo anotar el nombre?',
      '¿Cuál es su nombre completo?'
    ],
    en: [
      'What\'s the name for the reservation?',
      'Who should I put the reservation under?',
      'What name should I use?',
      'How should I note the name?',
      'What\'s your full name?'
    ],
    de: [
      'Unter welchem Namen soll ich reservieren?',
      'Wie ist der Name für die Reservierung?',
      'Welchen Namen soll ich verwenden?',
      'Wie soll ich den Namen notieren?',
      'Wie ist Ihr vollständiger Name?'
    ],
    it: [
      'Sotto quale nome devo prenotare?',
      'Qual è il nome per la prenotazione?',
      'Che nome devo usare?',
      'Come devo annotare il nome?',
      'Qual è il vostro nome completo?'
    ],
    fr: [
      'Sous quel nom dois-je réserver?',
      'Quel est le nom pour la réservation?',
      'Quel nom dois-je utiliser?',
      'Comment dois-je noter le nom?',
      'Quel est votre nom complet?'
    ],
    pt: [
      'Sob qual nome devo reservar?',
      'Qual é o nome para a reserva?',
      'Que nome devo usar?',
      'Como devo anotar o nome?',
      'Qual é o seu nome completo?'
    ]
  },
  ask_phone: {
    es: [
      '¿Usamos este número de teléfono para confirmar?',
      '¿Este es el número de contacto correcto?',
      '¿Confirmamos con este teléfono?',
      '¿Este número está bien para avisos?',
      '¿Usamos este teléfono para la confirmación?'
    ],
    en: [
      'Should we use this phone number for confirmation?',
      'Is this the correct contact number?',
      'Do we confirm with this phone?',
      'Is this number good for notifications?',
      'Do we use this phone for confirmation?'
    ],
    de: [
      'Sollen wir diese Telefonnummer zur Bestätigung verwenden?',
      'Ist das die richtige Kontaktnummer?',
      'Bestätigen wir mit diesem Telefon?',
      'Ist diese Nummer gut für Benachrichtigungen?',
      'Verwenden wir dieses Telefon zur Bestätigung?'
    ],
    it: [
      'Dovremmo usare questo numero di telefono per la conferma?',
      'È questo il numero di contatto corretto?',
      'Confermiamo con questo telefono?',
      'Questo numero va bene per le notifiche?',
      'Usiamo questo telefono per la conferma?'
    ],
    fr: [
      'Devons-nous utiliser ce numéro de téléphone pour la confirmation?',
      'Est-ce le bon numéro de contact?',
      'Confirmons-nous avec ce téléphone?',
      'Ce numéro est-il bon pour les notifications?',
      'Utilisons-nous ce téléphone pour la confirmation?'
    ],
    pt: [
      'Devemos usar este número de telefone para confirmação?',
      'Este é o número de contato correto?',
      'Confirmamos com este telefone?',
      'Este número serve para notificações?',
      'Usamos este telefone para confirmação?'
    ]
  },
  complete: {
    es: [
      '¡Reserva confirmada! Los esperamos con gusto.',
      '¡Perfecto! Su mesa está reservada. ¡Hasta pronto!',
      '¡Excelente! Reserva lista. ¡Nos vemos pronto!',
      '¡Confirmado! Su reserva está lista. ¡Buen provecho!',
      '¡Listo! Mesa reservada. ¡Que disfruten!'
    ],
    en: [
      'Reservation confirmed! We look forward to seeing you.',
      'Perfect! Your table is reserved. See you soon!',
      'Excellent! Reservation is ready. See you soon!',
      'Confirmed! Your reservation is set. Enjoy!',
      'Done! Table reserved. Have a great time!'
    ],
    de: [
      'Reservierung bestätigt! Wir freuen uns auf Sie.',
      'Perfekt! Ihr Tisch ist reserviert. Bis bald!',
      'Ausgezeichnet! Reservierung ist bereit. Bis bald!',
      'Bestätigt! Ihre Reservierung ist festgelegt. Viel Spaß!',
      'Fertig! Tisch reserviert. Haben Sie eine schöne Zeit!'
    ],
    it: [
      'Prenotazione confermata! Non vediamo l\'ora di vedervi.',
      'Perfetto! Il vostro tavolo è prenotato. A presto!',
      'Eccellente! La prenotazione è pronta. A presto!',
      'Confermato! La vostra prenotazione è fissata. Buon appetito!',
      'Fatto! Tavolo prenotato. Divertitevi!'
    ],
    fr: [
      'Réservation confirmée! Nous avons hâte de vous voir.',
      'Parfait! Votre table est réservée. À bientôt!',
      'Excellent! La réservation est prête. À bientôt!',
      'Confirmé! Votre réservation est fixée. Bon appétit!',
      'Terminé! Table réservée. Amusez-vous bien!'
    ],
    pt: [
      'Reserva confirmada! Esperamos vê-los.',
      'Perfeito! Sua mesa está reservada. Até logo!',
      'Excelente! A reserva está pronta. Até logo!',
      'Confirmado! Sua reserva está marcada. Bom apetite!',
      'Pronto! Mesa reservada. Divirtam-se!'
    ]
  }
};

// Detectar idioma con patrones mejorados
function detectLanguage(text) {
  console.log(`[IDIOMA] Detectando idioma en: "${text}"`);
  
  const patterns = {
    es: /\b(hola|buenos|buenas|gracias|por favor|sí|no|reservar|mesa|personas|fecha|hora|nombre|teléfono|mañana|pasado mañana)\b/i,
    en: /\b(hello|hi|good|thanks|please|yes|no|book|table|people|date|time|name|phone|tomorrow|day after tomorrow)\b/i,
    de: /\b(hallo|guten|danke|bitte|ja|nein|buchen|tisch|personen|datum|zeit|name|telefon|morgen|übermorgen)\b/i,
    it: /\b(ciao|buongiorno|grazie|per favore|sì|no|prenotare|tavolo|persone|data|ora|nome|telefono|domani|dopodomani)\b/i,
    fr: /\b(bonjour|salut|merci|s'il vous plaît|oui|non|réserver|table|personnes|date|heure|nom|téléphone|demain|après-demain)\b/i,
    pt: /\b(olá|bom|obrigado|por favor|sim|não|reservar|mesa|pessoas|data|hora|nome|telefone|amanhã|depois de amanhã)\b/i
  };
  
  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      console.log(`[IDIOMA] Detectado: ${lang}`);
      return lang;
    }
  }
  
  console.log(`[IDIOMA] No detectado, usando español por defecto`);
  return 'es'; // Default
}

// Extraer número de personas con Gemini mejorado
async function extractPeople(text, language) {
  console.log(`[EXTRACCION] Extrayendo personas de: "${text}"`);
  
  if (model) {
    try {
      const prompt = `Extrae el número de personas del texto: "${text}". Responde solo con un número (1-20) o "null" si no hay número claro.`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const extracted = response.text().trim();
      
      console.log(`[GEMINI] Extracción personas: "${extracted}"`);
      
      if (extracted !== 'null' && extracted !== '') {
        const num = parseInt(extracted);
        if (num >= 1 && num <= 20) {
          return num;
        }
      }
    } catch (error) {
      console.error('[ERROR] Gemini falló en extracción personas:', error.message);
    }
  }
  
  // Fallback mejorado
  const numbers = text.match(/\b(\d+)\b/g);
  if (numbers) {
    const num = parseInt(numbers[numbers.length - 1]);
    if (num >= 1 && num <= 20) {
      console.log(`[FALLBACK] Número encontrado: ${num}`);
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
      console.log(`[FALLBACK] Palabra encontrada: ${word} = ${num}`);
      return num;
    }
  }
  
  console.log(`[EXTRACCION] No se encontró número de personas`);
  return null;
}

// Extraer fecha con Gemini mejorado
async function extractDate(text, language) {
  console.log(`[EXTRACCION] Extrayendo fecha de: "${text}"`);
  
  if (model) {
    try {
      const prompt = `Extrae la fecha del texto: "${text}". Responde en formato YYYY-MM-DD o "null" si no hay fecha clara.`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const extracted = response.text().trim();
      
      console.log(`[GEMINI] Extracción fecha: "${extracted}"`);
      
      if (extracted !== 'null' && extracted !== '') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(extracted)) {
          return extracted;
        }
      }
    } catch (error) {
      console.error('[ERROR] Gemini falló en extracción fecha:', error.message);
    }
  }
  
  // Fallback mejorado
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (text.toLowerCase().includes('mañana') || text.toLowerCase().includes('tomorrow')) {
    console.log(`[FALLBACK] Fecha detectada: mañana`);
    return tomorrow.toISOString().split('T')[0];
  }
  
  if (text.toLowerCase().includes('pasado mañana') || text.toLowerCase().includes('day after tomorrow')) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    console.log(`[FALLBACK] Fecha detectada: pasado mañana`);
    return dayAfter.toISOString().split('T')[0];
  }
  
  console.log(`[EXTRACCION] No se encontró fecha`);
  return null;
}

// Extraer hora con Gemini mejorado
async function extractTime(text, language) {
  console.log(`[EXTRACCION] Extrayendo hora de: "${text}"`);
  
  if (model) {
    try {
      const prompt = `Extrae la hora del texto: "${text}". Responde en formato HH:MM (24h) o "null" si no hay hora clara.`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const extracted = response.text().trim();
      
      console.log(`[GEMINI] Extracción hora: "${extracted}"`);
      
      if (extracted !== 'null' && extracted !== '') {
        if (/^\d{2}:\d{2}$/.test(extracted)) {
          return extracted;
        }
      }
    } catch (error) {
      console.error('[ERROR] Gemini falló en extracción hora:', error.message);
    }
  }
  
  // Fallback mejorado
  const timeMatch = text.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const period = timeMatch[3];
    
    if (period && period.toLowerCase() === 'pm' && hour < 12) {
      hour += 12;
    }
    
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    console.log(`[FALLBACK] Hora detectada: ${time}`);
    return time;
  }
  
  console.log(`[EXTRACCION] No se encontró hora`);
  return null;
}

// Extraer nombre con Gemini mejorado
async function extractName(text, language) {
  console.log(`[EXTRACCION] Extrayendo nombre de: "${text}"`);
  
  if (model) {
    try {
      const prompt = `Extrae el nombre de persona del texto: "${text}". Responde solo el nombre o "null" si no hay nombre claro.`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const extracted = response.text().trim();
      
      console.log(`[GEMINI] Extracción nombre: "${extracted}"`);
      
      if (extracted !== 'null' && extracted !== '') {
        return extracted;
      }
    } catch (error) {
      console.error('[ERROR] Gemini falló en extracción nombre:', error.message);
    }
  }
  
  // Fallback mejorado
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
      const name = match[1].trim();
      console.log(`[FALLBACK] Nombre detectado: ${name}`);
      return name;
    }
  }
  
  // Si no hay patrón, tomar la primera palabra que parezca nombre
  const words = text.split(' ').filter(word => word.length > 2 && /^[a-zA-Z]+$/.test(word));
  if (words.length > 0) {
    console.log(`[FALLBACK] Nombre por palabra: ${words[0]}`);
    return words[0];
  }
  
  console.log(`[EXTRACCION] No se encontró nombre`);
  return null;
}

// Generar respuesta con Gemini simplificado o fallback
async function generateResponse(step, language, context) {
  console.log(`[RESPUESTA] Generando para paso: ${step}, idioma: ${language}`);
  
  if (model) {
    try {
      // Prompts simplificados y más naturales
      const simplePrompts = {
        greeting: `Saluda amigablemente y pregunta cuántas personas necesitan mesa. Responde en ${language}.`,
        ask_people: `Pregunta cuántas personas serán para la reserva. Responde en ${language}.`,
        ask_date: `Pregunta para qué fecha necesitan la mesa. Responde en ${language}.`,
        ask_time: `Pregunta a qué hora quieren venir. Responde en ${language}.`,
        ask_name: `Pregunta el nombre de la persona que hace la reserva. Responde en ${language}.`,
        ask_phone: `Pregunta si usan este número de teléfono para confirmar. Responde en ${language}.`,
        complete: `Confirma que la reserva está lista y se despide amigablemente. Responde en ${language}.`
      };
      
      const prompt = simplePrompts[step] || `Responde naturalmente en ${language}.`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text().trim();
      
      console.log(`[GEMINI] Respuesta generada: "${text}"`);
      return text;
      
    } catch (error) {
      console.error('[ERROR] Gemini falló, usando fallback:', error.message);
    }
  }
  
  // Fallback mejorado con respuestas más naturales
  const responses = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (responses && Array.isArray(responses)) {
    const selected = responses[Math.floor(Math.random() * responses.length)];
    console.log(`[FALLBACK] Respuesta seleccionada: "${selected}"`);
    return selected;
  }
  
  // Fallback final más natural
  const finalFallbacks = {
    greeting: {
      es: '¡Hola! ¿Para cuántas personas necesitan mesa?',
      en: 'Hello! How many people will be dining?',
      de: 'Hallo! Für wie viele Personen?',
      it: 'Ciao! Per quante persone?',
      fr: 'Bonjour! Pour combien de personnes?',
      pt: 'Olá! Para quantas pessoas?'
    }
  };
  
  return finalFallbacks[step]?.[language] || finalFallbacks[step]?.['es'] || '¿En qué puedo ayudarle?';
}

// Guardar reserva con validación mejorada
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
    // Validar datos antes de guardar
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
        'Reserva por teléfono - Sistema Premium',
        JSON.stringify(state.conversation)
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

// Función principal mejorada
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null, // Se detectará en la primera interacción
    data: {},
    conversation: []
  };
  
  // Detectar idioma si es la primera interacción
  if (!state.language && userInput) {
    state.language = detectLanguage(userInput);
    console.log(`[IDIOMA] Idioma bloqueado: ${state.language}`);
  }
  
  // Si no se detectó idioma, usar español por defecto
  if (!state.language) {
    state.language = 'es';
  }
  
  // Procesar según el paso actual
  let response = '';
  
  try {
    switch (state.step) {
      case 'greeting':
        state.step = 'ask_people';
        response = await generateResponse('greeting', state.language, {});
        break;
        
      case 'ask_people':
        const people = await extractPeople(userInput, state.language);
        if (people) {
          state.data.people = people;
          state.step = 'ask_date';
          response = await generateResponse('ask_date', state.language, state.data);
        } else {
          response = await generateResponse('ask_people', state.language, state.data);
        }
        break;
        
      case 'ask_date':
        const date = await extractDate(userInput, state.language);
        if (date) {
          state.data.date = date;
          state.step = 'ask_time';
          response = await generateResponse('ask_time', state.language, state.data);
        } else {
          response = await generateResponse('ask_date', state.language, state.data);
        }
        break;
        
      case 'ask_time':
        const time = await extractTime(userInput, state.language);
        if (time) {
          state.data.time = time;
          state.step = 'ask_name';
          response = await generateResponse('ask_name', state.language, state.data);
        } else {
          response = await generateResponse('ask_time', state.language, state.data);
        }
        break;
        
      case 'ask_name':
        const name = await extractName(userInput, state.language);
        if (name) {
          state.data.name = name;
          state.step = 'ask_phone';
          response = await generateResponse('ask_phone', state.language, state.data);
        } else {
          response = await generateResponse('ask_name', state.language, state.data);
        }
        break;
        
      case 'ask_phone':
        // Usar número de Twilio
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
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
  }
  
  // Guardar conversación
  state.conversation.push({
    user: userInput,
    bot: response,
    timestamp: new Date().toISOString(),
    step: state.step
  });
  
  // Actualizar estado
  conversationStates.set(From, state);
  
  // Generar TwiML con timeouts aumentados
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Lupe" language="${state.language}-ES">
    ${response}
  </Say>
  <Gather input="speech" timeout="8" speechTimeout="5" action="/api/twilio-call-quality" method="POST">
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
