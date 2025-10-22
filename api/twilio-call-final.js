const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Estados de conversación
const conversationStates = new Map();

// Respuestas optimizadas y naturales
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
      'Salve! Per quante persone prenotate?',
      'Ciao! Quanti ospiti saranno?'
    ],
    fr: [
      'Bonjour! Bienvenue dans notre restaurant. Pour combien de personnes?',
      'Bonjour! Combien d\'invités attendons-nous?',
      'Salut! Combien de personnes dans votre groupe?',
      'Bonjour! Pour combien de personnes réservez-vous?',
      'Salut! Combien d\'invités seront là?'
    ],
    pt: [
      'Olá! Bem-vindo ao nosso restaurante. Para quantas pessoas?',
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

// Detectar idioma de forma simple y efectiva
function detectLanguage(text) {
  console.log(`[IDIOMA] Detectando idioma en: "${text}"`);
  
  const patterns = {
    es: /\b(hola|buenos|buenas|gracias|por favor|sí|no|reservar|mesa|personas|fecha|hora|nombre|teléfono|mañana|pasado mañana|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i,
    en: /\b(hello|hi|good|thanks|please|yes|no|book|table|people|date|time|name|phone|tomorrow|day after tomorrow|four|five|six|seven|eight|nine|ten)\b/i,
    de: /\b(hallo|guten|danke|bitte|ja|nein|buchen|tisch|personen|datum|zeit|name|telefon|morgen|übermorgen|vier|fünf|sechs|sieben|acht|neun|zehn)\b/i,
    it: /\b(ciao|buongiorno|grazie|per favore|sì|no|prenotare|tavolo|persone|data|ora|nome|telefono|domani|dopodomani|quattro|cinque|sei|sette|otto|nove|dieci)\b/i,
    fr: /\b(bonjour|salut|merci|s'il vous plaît|oui|non|réserver|table|personnes|date|heure|nom|téléphone|demain|après-demain|quatre|cinq|six|sept|huit|neuf|dix)\b/i,
    pt: /\b(olá|bom|obrigado|por favor|sim|não|reservar|mesa|pessoas|data|hora|nome|telefone|amanhã|depois de amanhã|quatro|cinco|seis|sete|oito|nove|dez)\b/i
  };
  
  for (const [lang, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      console.log(`[IDIOMA] Detectado: ${lang}`);
      return lang;
    }
  }
  
  console.log(`[IDIOMA] No detectado, usando español por defecto`);
  return 'es';
}

// Extraer número de personas - VERSIÓN ROBUSTA
function extractPeople(text) {
  console.log(`[EXTRACCION] Extrayendo personas de: "${text}"`);
  
  // Palabras de corrección
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'no', 'better', 'wait', 'sorry', 'change', 'correct',
    'nein', 'besser', 'warte', 'entschuldigung', 'ändern',
    'non', 'mieux', 'attendez', 'désolé', 'changer',
    'no', 'meglio', 'aspetta', 'scusa', 'cambiare',
    'não', 'melhor', 'espera', 'desculpa', 'mudar'
  ];
  
  const hasCorrection = correctionWords.some(word => text.toLowerCase().includes(word));
  
  // Números en palabras
  const wordNumbers = {
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
  
  let foundNumbers = [];
  
  // Buscar números en palabras
  for (const [word, number] of Object.entries(wordNumbers)) {
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
  
  // Buscar patrones específicos
  const patterns = [
    /(?:para|for|für|per|pour)\s*(\d+)/i,
    /(\d+)\s*(?:personas|people|personen|persone|personnes|pessoas)/i,
    /(?:mesa|table|tisch|tavolo|table|mesa)\s*(?:para|for|für|per|pour)?\s*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1]);
      if (count >= 1 && count <= 20) {
        foundNumbers.push({ number: count, position: match.index });
      }
    }
  }
  
  console.log(`[EXTRACCION] Números encontrados:`, foundNumbers);
  
  if (foundNumbers.length === 0) return null;
  
  // Si hay corrección o múltiples números, tomar el último
  if (hasCorrection || foundNumbers.length > 1) {
    foundNumbers.sort((a, b) => b.position - a.position);
    console.log(`[EXTRACCION] Usando último número: ${foundNumbers[0].number}`);
    return foundNumbers[0].number;
  }
  
  console.log(`[EXTRACCION] Usando único número: ${foundNumbers[0].number}`);
  return foundNumbers[0].number;
}

// Extraer fecha - VERSIÓN MEJORADA
function extractDate(text) {
  console.log(`[EXTRACCION] Extrayendo fecha de: "${text}"`);
  
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Fechas relativas en múltiples idiomas
  const relativeDates = {
    'mañana': tomorrow,
    'tomorrow': tomorrow,
    'morgen': tomorrow,
    'domani': tomorrow,
    'demain': tomorrow,
    'amanhã': tomorrow,
    'pasado mañana': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    'day after tomorrow': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    'übermorgen': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    'dopodomani': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    'après-demain': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
    'depois de amanhã': new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000)
  };
  
  for (const [phrase, date] of Object.entries(relativeDates)) {
    if (text.toLowerCase().includes(phrase)) {
      const result = date.toISOString().split('T')[0];
      console.log(`[EXTRACCION] Fecha detectada: ${phrase} = ${result}`);
      return result;
    }
  }
  
  console.log(`[EXTRACCION] No se encontró fecha`);
  return null;
}

// Extraer hora - VERSIÓN MEJORADA
function extractTime(text) {
  console.log(`[EXTRACCION] Extrayendo hora de: "${text}"`);
  
  // Patrones de hora más flexibles
  const timePatterns = [
    /(\d{1,2}):(\d{2})/,
    /(\d{1,2})\.(\d{2})/,
    /(\d{1,2})\s+(\d{2})/,
    /(\d{1,2})\s*(am|pm|AM|PM)/,
    /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)/
  ];
  
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      const minute = match[2] ? parseInt(match[2]) : 0;
      const period = match[3];
      
      if (period && period.toLowerCase() === 'pm' && hour < 12) {
        hour += 12;
      }
      
      if (period && period.toLowerCase() === 'am' && hour === 12) {
        hour = 0;
      }
      
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      console.log(`[EXTRACCION] Hora detectada: ${time}`);
      return time;
    }
  }
  
  console.log(`[EXTRACCION] No se encontró hora`);
  return null;
}

// Extraer nombre - VERSIÓN MEJORADA
function extractName(text) {
  console.log(`[EXTRACCION] Extrayendo nombre de: "${text}"`);
  
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
      console.log(`[EXTRACCION] Nombre detectado: ${name}`);
      return name;
    }
  }
  
  // Si no hay patrón, tomar la primera palabra que parezca nombre
  const words = text.split(' ').filter(word => 
    word.length > 2 && 
    /^[a-zA-Z]+$/.test(word) &&
    !['hola', 'hello', 'hi', 'gracias', 'thanks', 'por', 'for', 'favor', 'please'].includes(word.toLowerCase())
  );
  
  if (words.length > 0) {
    console.log(`[EXTRACCION] Nombre por palabra: ${words[0]}`);
    return words[0];
  }
  
  console.log(`[EXTRACCION] No se encontró nombre`);
  return null;
}

// Generar respuesta natural
function generateResponse(step, language) {
  console.log(`[RESPUESTA] Generando para paso: ${step}, idioma: ${language}`);
  
  const responses = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (responses && Array.isArray(responses)) {
    const selected = responses[Math.floor(Math.random() * responses.length)];
    console.log(`[RESPUESTA] Seleccionada: "${selected}"`);
    return selected;
  }
  
  return '¿En qué puedo ayudarle?';
}

// Guardar reserva
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
    // Validar datos
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
        'Reserva por teléfono - Sistema Final',
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

// Función principal
module.exports = async function handler(req, res) {
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
    language: null,
    data: {},
    conversationHistory: []
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
        response = generateResponse('greeting', state.language);
        break;
        
      case 'ask_people':
        const people = extractPeople(userInput);
        if (people) {
          state.data.people = people;
          state.step = 'ask_date';
          response = generateResponse('ask_date', state.language);
        } else {
          response = generateResponse('ask_people', state.language);
        }
        break;
        
      case 'ask_date':
        const date = extractDate(userInput);
        if (date) {
          state.data.date = date;
          state.step = 'ask_time';
          response = generateResponse('ask_time', state.language);
        } else {
          response = generateResponse('ask_date', state.language);
        }
        break;
        
      case 'ask_time':
        const time = extractTime(userInput);
        if (time) {
          state.data.time = time;
          state.step = 'ask_name';
          response = generateResponse('ask_name', state.language);
        } else {
          response = generateResponse('ask_time', state.language);
        }
        break;
        
      case 'ask_name':
        const name = extractName(userInput);
        if (name) {
          state.data.name = name;
          state.step = 'ask_phone';
          response = generateResponse('ask_phone', state.language);
        } else {
          response = generateResponse('ask_name', state.language);
        }
        break;
        
      case 'ask_phone':
        // Usar número de Twilio
        state.data.phone = From;
        state.step = 'complete';
        
        // Guardar reserva
        const saved = await saveReservation(state);
        if (saved) {
          response = generateResponse('complete', state.language);
          state.step = 'finished';
        } else {
          response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        }
        break;
        
      default:
        response = generateResponse('greeting', state.language);
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
  
  // Generar TwiML con timeouts optimizados
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Lupe" language="${state.language}-ES">
    ${response}
  </Say>
  <Gather input="speech" timeout="8" speechTimeout="5" action="/api/twilio-call-final" method="POST">
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
};
