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

// Respuestas optimizadas por idioma - Variadas y específicas
const RESPONSES = {
  greeting: {
    es: [
      '¡Hola! Soy el asistente de reservas. ¿Para cuántas personas necesitan mesa?',
      '¡Buenos días! ¿Cuántas personas serán para la reserva?',
      '¡Hola! Bienvenidos. ¿Para cuántos comensales?',
      '¡Saludos! ¿Cuántas personas en su grupo?',
      '¡Hola! ¿Para cuántas personas es la reserva?'
    ],
    en: [
      'Hello! I\'m your reservation assistant. How many people will be dining?',
      'Good day! How many guests are we expecting?',
      'Hi there! How many people in your party?',
      'Hello! How many diners will we have?',
      'Good morning! How many people for the reservation?'
    ],
    de: [
      'Hallo! Ich bin Ihr Reservierungsassistent. Für wie viele Personen?',
      'Guten Tag! Wie viele Gäste erwarten wir?',
      'Hallo! Wie viele Personen in Ihrer Gruppe?',
      'Guten Morgen! Für wie viele Personen reservieren Sie?',
      'Hallo! Wie viele Gäste werden es sein?'
    ],
    it: [
      'Ciao! Sono il vostro assistente prenotazioni. Per quante persone?',
      'Buongiorno! Quanti ospiti aspettiamo?',
      'Ciao! Quante persone nel vostro gruppo?',
      'Salve! Per quante persone prenotate?',
      'Ciao! Quanti ospiti saranno?'
    ],
    fr: [
      'Bonjour! Je suis votre assistant réservations. Pour combien de personnes?',
      'Bonjour! Combien d\'invités attendons-nous?',
      'Salut! Combien de personnes dans votre groupe?',
      'Bonjour! Pour combien de personnes réservez-vous?',
      'Salut! Combien d\'invités seront là?'
    ],
    pt: [
      'Olá! Sou seu assistente de reservas. Para quantas pessoas?',
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

// Extraer número de personas con Gemini o fallback
async function extractPeople(text, language) {
  if (model) {
    try {
      const prompt = `
      Extrae el número de personas del siguiente texto: "${text}"
      
      IDIOMA: ${language}
      
      INSTRUCCIONES:
      - Busca números de personas (1-20)
      - Reconoce palabras como "uno", "two", "drei", "quattro", "cinq", "um"
      - Reconoce frases como "para 4 personas", "for 4 people", "für 4 Personen"
      - Si hay corrección (no, mejor, change), toma el último número mencionado
      
      RESPUESTA: Solo el número (1-20) o "null" si no encuentra nada.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const extracted = response.text().trim();
      
      if (extracted !== 'null' && extracted !== '') {
        const num = parseInt(extracted);
        if (num >= 1 && num <= 20) {
          return num;
        }
      }
    } catch (error) {
      console.error('Error con Gemini en extracción de personas:', error);
    }
  }
  
  // Fallback a extracción básica
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
      Eres un asistente de restaurante muy profesional, amigable y conversacional.
      
      SITUACIÓN: Cliente llamando para hacer una reserva
      PASO ACTUAL: ${step}
      IDIOMA: ${language}
      CONTEXTO: ${JSON.stringify(context)}
      
      INSTRUCCIONES ESPECÍFICAS:
      - Responde SOLO en ${language}
      - Sé natural, amigable y profesional
      - Usa un tono conversacional, no robótico
      - Máximo 15 palabras
      - Sé específico y directo
      - No uses frases genéricas
      
      EJEMPLOS DE RESPUESTAS NATURALES POR PASO:
      
      GREETING (${language}):
      - "¡Hola! Soy el asistente de reservas. ¿Para cuántas personas necesitan mesa?"
      - "¡Buenos días! ¿Cuántas personas serán para la reserva?"
      - "¡Hola! Bienvenidos. ¿Para cuántos comensales?"
      
      ASK_DATE (${language}):
      - "Perfecto. ¿Para qué día necesitan la mesa?"
      - "Excelente. ¿Qué fecha prefieren?"
      - "Genial. ¿Para cuándo es la reserva?"
      
      ASK_TIME (${language}):
      - "¿A qué hora prefieren venir?"
      - "¿Qué hora les conviene?"
      - "¿A qué hora quieren la mesa?"
      
      ASK_NAME (${language}):
      - "¿Cómo se llama la persona que hace la reserva?"
      - "¿Cuál es el nombre para la reserva?"
      - "¿Bajo qué nombre reservamos?"
      
      ASK_PHONE (${language}):
      - "¿Usamos este número de teléfono para confirmar?"
      - "¿Este es el número de contacto correcto?"
      - "¿Confirmamos con este teléfono?"
      
      COMPLETE (${language}):
      - "¡Reserva confirmada! Los esperamos con gusto."
      - "¡Perfecto! Su mesa está reservada. ¡Hasta pronto!"
      - "¡Excelente! Reserva lista. ¡Nos vemos pronto!"
      
      GENERA UNA RESPUESTA NATURAL Y CONVERSACIONAL PARA EL PASO ${step} EN ${language}:
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Error con Gemini:', error);
    }
  }
  
  // Fallback a respuestas hardcoded variadas
  const responses = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (responses && Array.isArray(responses)) {
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  return '¿En qué puedo ayudarle?';
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
