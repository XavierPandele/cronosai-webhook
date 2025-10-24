const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

module.exports = async function handler(req, res) {
  console.log('📞 Twilio Call recibida');
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
      language: 'es' // Detectar idioma por defecto
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

    // Procesar según el paso actual
    const response = await processConversationStep(state, userInput);
    
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
      await saveReservation(state);
      // Limpiar el estado después de guardar
      setTimeout(() => conversationStates.delete(CallSid), 60000); // Limpiar después de 1 minuto
    }

    // Generar TwiML response
    const twiml = generateTwiML(response, state.language);
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

  } catch (error) {
    console.error('❌ Error en Twilio Call:', error);
    
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

async function processConversationStep(state, userInput) {
  const step = state.step;
  const text = userInput.toLowerCase();

  console.log(`📋 Procesando paso: ${step}, Input: "${userInput}"`);

  // Detectar idioma si es el primer paso
  if (step === 'greeting' && userInput) {
    state.language = detectLanguage(userInput);
    console.log(`🌍 Idioma detectado: ${state.language}`);
  }

  switch (step) {
     case 'greeting':
       // Primera interacción - saludo general
       // Si detectamos un idioma diferente al español y hay intención de reserva, saltar al siguiente paso
       if (state.language !== 'es' && userInput && isReservationRequest(userInput)) {
         state.step = 'ask_people';
         const reservationMessages = getMultilingualMessages('reservation', state.language);
         return {
           message: getRandomMessage(reservationMessages),
           gather: true
         };
       }
       
       // Saludo normal
       state.step = 'ask_intention';
       const greetingMessages = getMultilingualMessages('greeting', state.language);
       return {
         message: getRandomMessage(greetingMessages),
         gather: true
       };

     case 'ask_intention':
       // Confirmar que quiere hacer una reserva
       const intentionResult = handleIntentionResponse(text);
       
       if (intentionResult.action === 'reservation') {
         state.step = 'ask_people';
         const reservationMessages = getMultilingualMessages('reservation', state.language);
         return {
           message: getRandomMessage(reservationMessages),
           gather: true
         };
       } else if (intentionResult.action === 'clarify') {
         return {
           message: intentionResult.message,
           gather: true
         };
       } else {
         const clarifyMessages = getMultilingualMessages('clarify', state.language);
         return {
           message: getRandomMessage(clarifyMessages),
           gather: true
         };
       }

     case 'ask_people':
       const people = extractPeopleCount(text);
       if (people) {
         state.data.NumeroReserva = people;
         state.step = 'ask_date';
         const peopleMessages = getMultilingualMessages('people', state.language, { people });
         return {
           message: getRandomMessage(peopleMessages),
           gather: true
         };
       } else {
         const errorResponse = handleUnclearResponse(text, 'people', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

     case 'ask_date':
       const date = extractDate(text);
       if (date) {
         state.data.FechaReserva = date;
         state.step = 'ask_time';
         const dateMessages = getMultilingualMessages('date', state.language, { date });
         return {
           message: getRandomMessage(dateMessages),
           gather: true
         };
       } else {
         const errorResponse = handleUnclearResponse(text, 'date', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

     case 'ask_time':
       const time = extractTime(text);
       if (time) {
         state.data.HoraReserva = time;
         state.step = 'ask_name';
         const timeMessages = getMultilingualMessages('time', state.language, { time });
         return {
           message: getRandomMessage(timeMessages),
           gather: true
         };
       } else {
         const errorResponse = handleUnclearResponse(text, 'time', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

     case 'ask_name':
       const name = extractName(text);
       if (name) {
         state.data.NomReserva = name;
         state.step = 'ask_phone';
         const nameMessages = getMultilingualMessages('name', state.language, { name });
         return {
           message: getRandomMessage(nameMessages),
           gather: true
         };
       } else {
         const errorResponse = handleUnclearResponse(text, 'name', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

    case 'ask_phone':
      // Verificar si quiere usar el número actual o dar otro
      if (text.includes('este') || text.includes('mismo') || text.includes('si') || text.includes('sí') || text.includes('vale') || text.includes('ok')) {
        // Usa el número de la llamada
        state.data.TelefonReserva = state.phone;
        state.step = 'confirm';
        return {
          message: getConfirmationMessage(state.data, state.language),
          gather: true
        };
      } else if (text.includes('otro') || text.includes('diferente') || text.includes('no')) {
        // Preguntar por otro número
        state.step = 'ask_phone_number';
        const phoneMessages = getMultilingualMessages('ask_phone', state.language);
        return {
          message: getRandomMessage(phoneMessages),
          gather: true
        };
      } else {
        // Intentar extraer un número directamente
        const phoneMatch = text.match(/\d{9,}/);
        if (phoneMatch) {
          state.data.TelefonReserva = phoneMatch[0];
          state.step = 'confirm';
          return {
            message: getConfirmationMessage(state.data, state.language),
            gather: true
          };
        } else {
          const phoneChoiceMessages = getMultilingualMessages('phone_choice', state.language);
          return {
            message: getRandomMessage(phoneChoiceMessages),
            gather: true
          };
        }
      }

     case 'ask_phone_number':
       // Extraer el número de teléfono (puede estar en dígitos o palabras)
       const extractedPhone = extractPhoneNumber(text);
       if (extractedPhone && extractedPhone.length >= 9) {
         state.data.TelefonReserva = extractedPhone;
         state.step = 'confirm';
         return {
           message: getConfirmationMessage(state.data, state.language),
           gather: true
         };
       } else {
         const errorResponse = handleUnclearResponse(text, 'phone', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

     case 'confirm':
       const confirmationResult = handleConfirmationResponse(text);
       
       if (confirmationResult.action === 'confirm') {
         state.step = 'complete';
         const confirmMessages = getMultilingualMessages('confirm', state.language);
         return {
           message: getRandomMessage(confirmMessages),
           gather: false
         };
       } else if (confirmationResult.action === 'modify') {
         return handleModificationRequest(state, confirmationResult.modification);
       } else if (confirmationResult.action === 'restart') {
         state.step = 'ask_people';
         state.data = {};
         const restartMessages = getMultilingualMessages('restart', state.language);
         return {
           message: getRandomMessage(restartMessages),
           gather: true
         };
       } else if (confirmationResult.action === 'clarify') {
         return {
           message: confirmationResult.message,
           gather: true
         };
       } else {
         const clarifyConfirmMessages = getMultilingualMessages('clarify_confirm', state.language);
         return {
           message: getRandomMessage(clarifyConfirmMessages),
           gather: true
         };
       }

    default:
      state.step = 'greeting';
      const defaultMessages = getMultilingualMessages('default', state.language);
      return {
        message: getRandomMessage(defaultMessages),
        gather: true
      };
  }
}

function generateTwiML(response, language = 'es') {
  const { message, gather = true } = response;

  // Configuración de voz por idioma - Google Neural cuando esté disponible
  const voiceConfig = {
    es: { voice: 'Google.es-ES-Neural2-B', language: 'es-ES' },
    en: { voice: 'Google.en-US-Neural2-A', language: 'en-US' },
    de: { voice: 'Google.de-DE-Neural2-A', language: 'de-DE' },
    it: { voice: 'Google.it-IT-Neural2-A', language: 'it-IT' },
    fr: { voice: 'Google.fr-FR-Neural2-A', language: 'fr-FR' },
    pt: { voice: 'Google.pt-BR-Neural2-A', language: 'pt-BR' }
  };

  const config = voiceConfig[language] || voiceConfig.es;

  if (gather) {
    // Usar Gather para capturar la respuesta del usuario
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call-improved" 
    method="POST"
    language="${config.language}"
    speechTimeout="3"
    timeout="8">
    <Say voice="${config.voice}" language="${config.language}">${escapeXml(message)}</Say>
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">${getRandomMessage(['No escuché respuesta. ¿Sigue ahí?', 'Disculpe, no escuché. ¿Sigue ahí?', '¿Está ahí? No escuché nada.', '¿Sigue en la línea? No escuché respuesta.', 'Disculpe, ¿podría repetir? No escuché bien.'])}</Say>
  <Redirect>/api/twilio-call-improved</Redirect>
</Response>`;
  } else {
    // Solo decir el mensaje y colgar
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${config.voice}" language="${config.language}">${escapeXml(message)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
  }
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
        'Reserva realizada por teléfono (Twilio)',
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

// Funciones auxiliares de extracción

function getRandomMessage(messages) {
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex];
}

// Función para obtener mensajes multilingües
function getMultilingualMessages(type, language = 'es', variables = {}) {
  const messages = {
    greeting: {
      es: [
        '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
        '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy?',
        '¡Hola! Gracias por llamar. ¿En qué puedo asistirle?',
        '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita?',
        '¡Hola! Encantado de atenderle. ¿En qué puedo ayudarle?'
      ],
      en: [
        'Hello! Welcome to our restaurant. How can I help you?',
        'Good morning! Welcome. How can I assist you today?',
        'Hello! Thank you for calling. How can I help you?',
        'Good afternoon! Welcome to the restaurant. What do you need?',
        'Hello! Delighted to serve you. How can I help you?'
      ],
      de: [
        'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?',
        'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?',
        'Hallo! Vielen Dank für Ihren Anruf. Wie kann ich Ihnen helfen?',
        'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?',
        'Hallo! Freue mich, Ihnen zu dienen. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?',
        'Buongiorno! Benvenuto. Come posso assisterti oggi?',
        'Ciao! Grazie per la chiamata. Come posso aiutarti?',
        'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?',
        'Ciao! Felice di servirti. Come posso aiutarti?'
      ],
      fr: [
        'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
        'Bonjour! Bienvenue. Comment puis-je vous assister aujourd\'hui?',
        'Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?',
        'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?',
        'Bonjour! Ravi de vous servir. Comment puis-je vous aider?'
      ],
      pt: [
        'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?',
        'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?',
        'Olá! Obrigado por ligar. Como posso ajudá-lo?',
        'Boa tarde! Bem-vindo ao restaurante. O que você precisa?',
        'Olá! Prazer em atendê-lo. Como posso ajudá-lo?'
      ]
    },
    reservation: {
      es: [
        '¡Perfecto! Encantado de ayudarle con su reserva. ¿Para cuántas personas?',
        '¡Excelente! Me alegra ayudarle con la reserva. ¿Cuántas personas serán?',
        '¡Muy bien! Con gusto le ayudo. ¿Para cuántos comensales?',
        '¡Perfecto! ¿Para cuántas personas necesita la mesa?',
        '¡Genial! ¿Cuántas personas van a venir?'
      ],
      en: [
        'Perfect! I\'m delighted to help you with your reservation. For how many people?',
        'Excellent! I\'m happy to help you with the reservation. How many people will it be?',
        'Great! I\'m happy to help. For how many diners?',
        'Perfect! For how many people do you need the table?',
        'Great! How many people are coming?'
      ],
      de: [
        'Perfekt! Ich helfe Ihnen gerne bei Ihrer Reservierung. Für wie viele Personen?',
        'Ausgezeichnet! Ich helfe Ihnen gerne bei der Reservierung. Wie viele Personen werden es sein?',
        'Sehr gut! Ich helfe Ihnen gerne. Für wie viele Gäste?',
        'Perfekt! Für wie viele Personen benötigen Sie den Tisch?',
        'Großartig! Wie viele Personen kommen?'
      ],
      it: [
        'Perfetto! Sono felice di aiutarti con la tua prenotazione. Per quante persone?',
        'Eccellente! Sono felice di aiutarti con la prenotazione. Quante persone saranno?',
        'Molto bene! Sono felice di aiutarti. Per quanti commensali?',
        'Perfetto! Per quante persone hai bisogno del tavolo?',
        'Fantastico! Quante persone vengono?'
      ],
      fr: [
        'Parfait! Je suis ravi de vous aider avec votre réservation. Pour combien de personnes?',
        'Excellent! Je suis heureux de vous aider avec la réservation. Combien de personnes seront-elles?',
        'Très bien! Je suis heureux de vous aider. Pour combien de convives?',
        'Parfait! Pour combien de personnes avez-vous besoin de la table?',
        'Génial! Combien de personnes viennent?'
      ],
      pt: [
        'Perfeito! Estou encantado em ajudá-lo com sua reserva. Para quantas pessoas?',
        'Excelente! Estou feliz em ajudá-lo com a reserva. Quantas pessoas serão?',
        'Muito bem! Estou feliz em ajudá-lo. Para quantos comensais?',
        'Perfeito! Para quantas pessoas você precisa da mesa?',
        'Ótimo! Quantas pessoas estão vindo?'
      ]
    },
    clarify: {
      es: [
        'Disculpe, solo puedo ayudarle con reservas. ¿Le gustaría hacer una reserva?',
        'Lo siento, solo puedo ayudarle con reservas. ¿Quiere hacer una reserva?',
        'Perdón, únicamente puedo ayudarle con reservas. ¿Le gustaría reservar?',
        'Disculpe, solo manejo reservas. ¿Desea hacer una reserva?',
        'Lo siento, solo puedo ayudarle con reservas. ¿Quiere reservar una mesa?'
      ],
      en: [
        'Sorry, I can only help you with reservations. Would you like to make a reservation?',
        'I apologize, I can only help with reservations. Do you want to make a reservation?',
        'Sorry, I can only assist with reservations. Would you like to book?',
        'Sorry, I only handle reservations. Do you want to make a reservation?',
        'I apologize, I can only help with reservations. Do you want to book a table?'
      ],
      de: [
        'Entschuldigung, ich kann Ihnen nur bei Reservierungen helfen. Möchten Sie eine Reservierung vornehmen?',
        'Es tut mir leid, ich kann nur bei Reservierungen helfen. Möchten Sie eine Reservierung?',
        'Entschuldigung, ich kann nur bei Reservierungen helfen. Möchten Sie reservieren?',
        'Entschuldigung, ich bearbeite nur Reservierungen. Möchten Sie eine Reservierung?',
        'Es tut mir leid, ich kann nur bei Reservierungen helfen. Möchten Sie einen Tisch reservieren?'
      ],
      it: [
        'Scusi, posso aiutarla solo con le prenotazioni. Vorrebbe fare una prenotazione?',
        'Mi dispiace, posso aiutarla solo con le prenotazioni. Vuole fare una prenotazione?',
        'Scusi, posso assisterla solo con le prenotazioni. Vorrebbe prenotare?',
        'Scusi, gestisco solo le prenotazioni. Vuole fare una prenotazione?',
        'Mi dispiace, posso aiutarla solo con le prenotazioni. Vuole prenotare un tavolo?'
      ],
      fr: [
        'Désolé, je ne peux vous aider qu\'avec les réservations. Souhaitez-vous faire une réservation?',
        'Je suis désolé, je ne peux aider qu\'avec les réservations. Voulez-vous faire une réservation?',
        'Désolé, je ne peux assister qu\'avec les réservations. Souhaitez-vous réserver?',
        'Désolé, je ne gère que les réservations. Voulez-vous faire une réservation?',
        'Je suis désolé, je ne peux aider qu\'avec les réservations. Voulez-vous réserver une table?'
      ],
      pt: [
        'Desculpe, só posso ajudá-lo com reservas. Gostaria de fazer uma reserva?',
        'Sinto muito, só posso ajudá-lo com reservas. Quer fazer uma reserva?',
        'Desculpe, só posso assistir com reservas. Gostaria de reservar?',
        'Desculpe, só lido com reservas. Quer fazer uma reserva?',
        'Sinto muito, só posso ajudá-lo com reservas. Quer reservar uma mesa?'
      ]
    },
    people: {
      es: [
        `Perfecto, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para qué fecha?`,
        `Excelente, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día prefieren?`,
        `Muy bien, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para cuándo?`,
        `Perfecto, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para qué día?`,
        `Genial, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Cuándo les gustaría venir?`
      ],
      en: [
        `Perfect, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For what date?`,
        `Excellent, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. What day do you prefer?`,
        `Great, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For when?`,
        `Perfect, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For what day?`,
        `Great, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. When would you like to come?`
      ],
      de: [
        `Perfekt, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für welches Datum?`,
        `Ausgezeichnet, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Welchen Tag bevorzugen Sie?`,
        `Sehr gut, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für wann?`,
        `Perfekt, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für welchen Tag?`,
        `Großartig, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Wann möchten Sie kommen?`
      ],
      it: [
        `Perfetto, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quale data?`,
        `Eccellente, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Quale giorno preferisci?`,
        `Molto bene, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quando?`,
        `Perfetto, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quale giorno?`,
        `Fantastico, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Quando vorresti venire?`
      ],
      fr: [
        `Parfait, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quelle date?`,
        `Excellent, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Quel jour préférez-vous?`,
        `Très bien, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quand?`,
        `Parfait, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quel jour?`,
        `Génial, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Quand aimeriez-vous venir?`
      ],
      pt: [
        `Perfeito, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para que data?`,
        `Excelente, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Que dia você prefere?`,
        `Muito bem, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para quando?`,
        `Perfeito, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para que dia?`,
        `Ótimo, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Quando gostaria de vir?`
      ]
    },
    date: {
      es: [
        `Perfecto, ${formatDateSpanish(variables.date)}. ¿A qué hora?`,
        `Excelente, ${formatDateSpanish(variables.date)}. ¿A qué hora prefieren?`,
        `Muy bien, ${formatDateSpanish(variables.date)}. ¿A qué hora les gustaría venir?`,
        `Perfecto, ${formatDateSpanish(variables.date)}. ¿Qué hora les conviene?`,
        `Genial, ${formatDateSpanish(variables.date)}. ¿A qué hora?`
      ],
      en: [
        `Perfect, ${formatDateEnglish(variables.date)}. What time?`,
        `Excellent, ${formatDateEnglish(variables.date)}. What time do you prefer?`,
        `Great, ${formatDateEnglish(variables.date)}. What time would you like to come?`,
        `Perfect, ${formatDateEnglish(variables.date)}. What time suits you?`,
        `Great, ${formatDateEnglish(variables.date)}. What time?`
      ],
      de: [
        `Perfekt, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit?`,
        `Ausgezeichnet, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit bevorzugen Sie?`,
        `Sehr gut, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit möchten Sie kommen?`,
        `Perfekt, ${formatDateGerman(variables.date)}. Welche Uhrzeit passt Ihnen?`,
        `Großartig, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit?`
      ],
      it: [
        `Perfetto, ${formatDateItalian(variables.date)}. A che ora?`,
        `Eccellente, ${formatDateItalian(variables.date)}. A che ora preferisci?`,
        `Molto bene, ${formatDateItalian(variables.date)}. A che ora vorresti venire?`,
        `Perfetto, ${formatDateItalian(variables.date)}. Che ora ti conviene?`,
        `Fantastico, ${formatDateItalian(variables.date)}. A che ora?`
      ],
      fr: [
        `Parfait, ${formatDateFrench(variables.date)}. À quelle heure?`,
        `Excellent, ${formatDateFrench(variables.date)}. À quelle heure préférez-vous?`,
        `Très bien, ${formatDateFrench(variables.date)}. À quelle heure aimeriez-vous venir?`,
        `Parfait, ${formatDateFrench(variables.date)}. Quelle heure vous convient?`,
        `Génial, ${formatDateFrench(variables.date)}. À quelle heure?`
      ],
      pt: [
        `Perfeito, ${formatDatePortuguese(variables.date)}. Que horas?`,
        `Excelente, ${formatDatePortuguese(variables.date)}. Que horas você prefere?`,
        `Muito bem, ${formatDatePortuguese(variables.date)}. Que horas gostaria de vir?`,
        `Perfeito, ${formatDatePortuguese(variables.date)}. Que horas te convém?`,
        `Ótimo, ${formatDatePortuguese(variables.date)}. Que horas?`
      ]
    },
    time: {
      es: [
        `Perfecto, a las ${variables.time}. ¿Su nombre?`,
        `Excelente, a las ${variables.time}. ¿Cómo se llama?`,
        `Muy bien, a las ${variables.time}. ¿Su nombre, por favor?`,
        `Perfecto, a las ${variables.time}. ¿Cómo me dice su nombre?`,
        `Genial, a las ${variables.time}. ¿Su nombre?`
      ],
      en: [
        `Perfect, at ${variables.time}. Your name?`,
        `Excellent, at ${variables.time}. What's your name?`,
        `Great, at ${variables.time}. Your name, please?`,
        `Perfect, at ${variables.time}. How do you tell me your name?`,
        `Great, at ${variables.time}. Your name?`
      ],
      de: [
        `Perfekt, um ${variables.time}. Ihr Name?`,
        `Ausgezeichnet, um ${variables.time}. Wie heißen Sie?`,
        `Sehr gut, um ${variables.time}. Ihr Name, bitte?`,
        `Perfekt, um ${variables.time}. Wie sagen Sie mir Ihren Namen?`,
        `Großartig, um ${variables.time}. Ihr Name?`
      ],
      it: [
        `Perfetto, alle ${variables.time}. Il tuo nome?`,
        `Eccellente, alle ${variables.time}. Come ti chiami?`,
        `Molto bene, alle ${variables.time}. Il tuo nome, per favore?`,
        `Perfetto, alle ${variables.time}. Come mi dici il tuo nome?`,
        `Fantastico, alle ${variables.time}. Il tuo nome?`
      ],
      fr: [
        `Parfait, à ${variables.time}. Votre nom?`,
        `Excellent, à ${variables.time}. Comment vous appelez-vous?`,
        `Très bien, à ${variables.time}. Votre nom, s'il vous plaît?`,
        `Parfait, à ${variables.time}. Comment me dites-vous votre nom?`,
        `Génial, à ${variables.time}. Votre nom?`
      ],
      pt: [
        `Perfeito, às ${variables.time}. Seu nome?`,
        `Excelente, às ${variables.time}. Como você se chama?`,
        `Muito bem, às ${variables.time}. Seu nome, por favor?`,
        `Perfeito, às ${variables.time}. Como me diz seu nome?`,
        `Ótimo, às ${variables.time}. Seu nome?`
      ]
    },
    name: {
      es: [
        `Perfecto, ${variables.name}. ¿Desea usar este número de teléfono para la reserva, o prefiere indicar otro?`,
        `Excelente, ${variables.name}. ¿Usa este número o prefiere dar otro?`,
        `Muy bien, ${variables.name}. ¿Este teléfono está bien o quiere otro?`,
        `Perfecto, ${variables.name}. ¿Le sirve este número o prefiere uno diferente?`,
        `Genial, ${variables.name}. ¿Usa este número o necesita otro?`
      ],
      en: [
        `Perfect, ${variables.name}. Do you want to use this phone number for the reservation, or do you prefer to provide another one?`,
        `Excellent, ${variables.name}. Do you use this number or do you prefer to give another one?`,
        `Great, ${variables.name}. Is this phone number okay or do you want another one?`,
        `Perfect, ${variables.name}. Does this number work for you or do you prefer a different one?`,
        `Great, ${variables.name}. Do you use this number or do you need another one?`
      ],
      de: [
        `Perfekt, ${variables.name}. Möchten Sie diese Telefonnummer für die Reservierung verwenden, oder bevorzugen Sie eine andere?`,
        `Ausgezeichnet, ${variables.name}. Verwenden Sie diese Nummer oder bevorzugen Sie eine andere?`,
        `Sehr gut, ${variables.name}. Ist diese Telefonnummer in Ordnung oder möchten Sie eine andere?`,
        `Perfekt, ${variables.name}. Funktioniert diese Nummer für Sie oder bevorzugen Sie eine andere?`,
        `Großartig, ${variables.name}. Verwenden Sie diese Nummer oder benötigen Sie eine andere?`
      ],
      it: [
        `Perfetto, ${variables.name}. Vuoi usare questo numero di telefono per la prenotazione, o preferisci indicarne un altro?`,
        `Eccellente, ${variables.name}. Usi questo numero o preferisci darne un altro?`,
        `Molto bene, ${variables.name}. Questo telefono va bene o vuoi un altro?`,
        `Perfetto, ${variables.name}. Ti serve questo numero o preferisci uno diverso?`,
        `Fantastico, ${variables.name}. Usi questo numero o hai bisogno di un altro?`
      ],
      fr: [
        `Parfait, ${variables.name}. Souhaitez-vous utiliser ce numéro de téléphone pour la réservation, ou préférez-vous en indiquer un autre?`,
        `Excellent, ${variables.name}. Utilisez-vous ce numéro ou préférez-vous en donner un autre?`,
        `Très bien, ${variables.name}. Ce téléphone convient-il ou voulez-vous un autre?`,
        `Parfait, ${variables.name}. Ce numéro vous convient-il ou préférez-vous un différent?`,
        `Génial, ${variables.name}. Utilisez-vous ce numéro ou avez-vous besoin d'un autre?`
      ],
      pt: [
        `Perfeito, ${variables.name}. Quer usar este número de telefone para a reserva, ou prefere indicar outro?`,
        `Excelente, ${variables.name}. Usa este número ou prefere dar outro?`,
        `Muito bem, ${variables.name}. Este telefone está bem ou quer outro?`,
        `Perfeito, ${variables.name}. Este número te serve ou prefere um diferente?`,
        `Ótimo, ${variables.name}. Usa este número ou precisa de outro?`
      ]
    },
    ask_phone: {
      es: [
        '¿Qué número de teléfono prefiere?',
        '¿Cuál es su número de teléfono?',
        '¿Podría darme su número de teléfono?',
        '¿Me dice su número de teléfono?',
        '¿Cuál es el número donde podemos contactarle?'
      ],
      en: [
        'What phone number do you prefer?',
        'What is your phone number?',
        'Could you give me your phone number?',
        'Can you tell me your phone number?',
        'What is the number where we can contact you?'
      ],
      de: [
        'Welche Telefonnummer bevorzugen Sie?',
        'Wie ist Ihre Telefonnummer?',
        'Könnten Sie mir Ihre Telefonnummer geben?',
        'Können Sie mir Ihre Telefonnummer sagen?',
        'Wie ist die Nummer, unter der wir Sie erreichen können?'
      ],
      it: [
        'Che numero di telefono preferisci?',
        'Qual è il tuo numero di telefono?',
        'Potresti darmi il tuo numero di telefono?',
        'Puoi dirmi il tuo numero di telefono?',
        'Qual è il numero dove possiamo contattarti?'
      ],
      fr: [
        'Quel numéro de téléphone préférez-vous?',
        'Quel est votre numéro de téléphone?',
        'Pourriez-vous me donner votre numéro de téléphone?',
        'Pouvez-vous me dire votre numéro de téléphone?',
        'Quel est le numéro où nous pouvons vous contacter?'
      ],
      pt: [
        'Que número de telefone você prefere?',
        'Qual é o seu número de telefone?',
        'Poderia me dar o seu número de telefone?',
        'Pode me dizer o seu número de telefone?',
        'Qual é o número onde podemos contatá-lo?'
      ]
    },
    phone_choice: {
      es: [
        '¿Desea usar este número o prefiere dar otro?',
        '¿Usa este número o quiere uno diferente?',
        '¿Este teléfono está bien o prefiere otro?',
        '¿Le sirve este número o necesita otro?',
        '¿Usa este número o prefiere indicar otro?'
      ],
      en: [
        'Do you want to use this number or do you prefer to give another one?',
        'Do you use this number or do you want a different one?',
        'Is this phone okay or do you prefer another one?',
        'Does this number work for you or do you need another one?',
        'Do you use this number or do you prefer to provide another one?'
      ],
      de: [
        'Möchten Sie diese Nummer verwenden oder bevorzugen Sie eine andere?',
        'Verwenden Sie diese Nummer oder möchten Sie eine andere?',
        'Ist dieses Telefon in Ordnung oder bevorzugen Sie ein anderes?',
        'Funktioniert diese Nummer für Sie oder benötigen Sie eine andere?',
        'Verwenden Sie diese Nummer oder bevorzugen Sie eine andere anzugeben?'
      ],
      it: [
        'Vuoi usare questo numero o preferisci darne un altro?',
        'Usi questo numero o vuoi uno diverso?',
        'Questo telefono va bene o preferisci un altro?',
        'Ti serve questo numero o hai bisogno di un altro?',
        'Usi questo numero o preferisci indicarne un altro?'
      ],
      fr: [
        'Souhaitez-vous utiliser ce numéro ou préférez-vous en donner un autre?',
        'Utilisez-vous ce numéro ou voulez-vous un différent?',
        'Ce téléphone convient-il ou préférez-vous un autre?',
        'Ce numéro vous convient-il ou avez-vous besoin d\'un autre?',
        'Utilisez-vous ce numéro ou préférez-vous en indiquer un autre?'
      ],
      pt: [
        'Quer usar este número ou prefere dar outro?',
        'Usa este número ou quer um diferente?',
        'Este telefone está bem ou prefere outro?',
        'Este número te serve ou precisa de outro?',
        'Usa este número ou prefere indicar outro?'
      ]
    },
    confirm: {
      es: [
        '¡Perfecto! Su reserva está confirmada. Le esperamos. ¡Buen día!',
        '¡Excelente! Reserva confirmada. Les esperamos. ¡Que tengan buen día!',
        '¡Muy bien! Todo listo. Les esperamos. ¡Hasta pronto!',
        '¡Genial! Reserva confirmada. Nos vemos pronto. ¡Buen día!',
        '¡Perfecto! Todo confirmado. Les esperamos. ¡Que disfruten!'
      ],
      en: [
        'Perfect! Your reservation is confirmed. We look forward to seeing you. Have a great day!',
        'Excellent! Reservation confirmed. We look forward to seeing you. Have a great day!',
        'Great! Everything is ready. We look forward to seeing you. See you soon!',
        'Great! Reservation confirmed. See you soon. Have a great day!',
        'Perfect! Everything confirmed. We look forward to seeing you. Enjoy!'
      ],
      de: [
        'Perfekt! Ihre Reservierung ist bestätigt. Wir freuen uns auf Sie. Schönen Tag!',
        'Ausgezeichnet! Reservierung bestätigt. Wir freuen uns auf Sie. Schönen Tag!',
        'Sehr gut! Alles bereit. Wir freuen uns auf Sie. Bis bald!',
        'Großartig! Reservierung bestätigt. Bis bald. Schönen Tag!',
        'Perfekt! Alles bestätigt. Wir freuen uns auf Sie. Viel Spaß!'
      ],
      it: [
        'Perfetto! La tua prenotazione è confermata. Ti aspettiamo. Buona giornata!',
        'Eccellente! Prenotazione confermata. Ti aspettiamo. Buona giornata!',
        'Molto bene! Tutto pronto. Ti aspettiamo. A presto!',
        'Fantastico! Prenotazione confermata. A presto. Buona giornata!',
        'Perfetto! Tutto confermato. Ti aspettiamo. Divertiti!'
      ],
      fr: [
        'Parfait! Votre réservation est confirmée. Nous vous attendons. Bonne journée!',
        'Excellent! Réservation confirmée. Nous vous attendons. Bonne journée!',
        'Très bien! Tout est prêt. Nous vous attendons. À bientôt!',
        'Génial! Réservation confirmée. À bientôt. Bonne journée!',
        'Parfait! Tout confirmé. Nous vous attendons. Amusez-vous bien!'
      ],
      pt: [
        'Perfeito! Sua reserva está confirmada. Esperamos por você. Tenha um ótimo dia!',
        'Excelente! Reserva confirmada. Esperamos por você. Tenha um ótimo dia!',
        'Muito bem! Tudo pronto. Esperamos por você. Até logo!',
        'Ótimo! Reserva confirmada. Até logo. Tenha um ótimo dia!',
        'Perfeito! Tudo confirmado. Esperamos por você. Divirta-se!'
      ]
    },
    restart: {
      es: [
        'De acuerdo. Empezamos de nuevo. ¿Para cuántas personas?',
        'Perfecto. Comenzamos de nuevo. ¿Para cuántas personas?',
        'Muy bien. Volvemos a empezar. ¿Para cuántas personas?',
        'Entendido. Empezamos otra vez. ¿Para cuántas personas?',
        'Perfecto. Reiniciamos. ¿Para cuántas personas?'
      ],
      en: [
        'Okay. Let\'s start over. For how many people?',
        'Perfect. Let\'s start again. For how many people?',
        'Great. Let\'s start over. For how many people?',
        'Understood. Let\'s start again. For how many people?',
        'Perfect. Let\'s restart. For how many people?'
      ],
      de: [
        'In Ordnung. Wir fangen von vorne an. Für wie viele Personen?',
        'Perfekt. Wir beginnen von vorne. Für wie viele Personen?',
        'Sehr gut. Wir fangen nochmal an. Für wie viele Personen?',
        'Verstanden. Wir beginnen nochmal. Für wie viele Personen?',
        'Perfekt. Wir starten neu. Für wie viele Personen?'
      ],
      it: [
        'D\'accordo. Ricominciamo. Per quante persone?',
        'Perfetto. Ricominciamo. Per quante persone?',
        'Molto bene. Ricominciamo da capo. Per quante persone?',
        'Capito. Ricominciamo. Per quante persone?',
        'Perfetto. Riavvia. Per quante persone?'
      ],
      fr: [
        'D\'accord. Recommençons. Pour combien de personnes?',
        'Parfait. Recommençons. Pour combien de personnes?',
        'Très bien. Recommençons. Pour combien de personnes?',
        'Compris. Recommençons. Pour combien de personnes?',
        'Parfait. Redémarrons. Pour combien de personnes?'
      ],
      pt: [
        'De acordo. Começamos de novo. Para quantas pessoas?',
        'Perfeito. Começamos novamente. Para quantas pessoas?',
        'Muito bem. Voltamos a começar. Para quantas pessoas?',
        'Entendido. Começamos outra vez. Para quantas pessoas?',
        'Perfeito. Reiniciamos. Para quantas pessoas?'
      ]
    },
    clarify_confirm: {
      es: [
        '¿Es correcto? Puede decir sí, no, o qué quiere cambiar.',
        '¿Está bien? Puede confirmar, negar, o decir qué modificar.',
        '¿Le parece bien? Puede decir sí, no, o qué desea cambiar.',
        '¿Es correcto? Puede aceptar, rechazar, o indicar qué cambiar.',
        '¿Está de acuerdo? Puede confirmar, corregir, o decir qué cambiar.'
      ],
      en: [
        'Is it correct? You can say yes, no, or what you want to change.',
        'Is it okay? You can confirm, deny, or say what to modify.',
        'Does it look good? You can say yes, no, or what you want to change.',
        'Is it correct? You can accept, reject, or indicate what to change.',
        'Do you agree? You can confirm, correct, or say what to change.'
      ],
      de: [
        'Ist es richtig? Sie können ja, nein sagen oder was Sie ändern möchten.',
        'Ist es in Ordnung? Sie können bestätigen, verneinen oder sagen was zu ändern.',
        'Sieht es gut aus? Sie können ja, nein sagen oder was Sie ändern möchten.',
        'Ist es richtig? Sie können akzeptieren, ablehnen oder angeben was zu ändern.',
        'Sind Sie einverstanden? Sie können bestätigen, korrigieren oder sagen was zu ändern.'
      ],
      it: [
        'È corretto? Puoi dire sì, no, o cosa vuoi cambiare.',
        'Va bene? Puoi confermare, negare, o dire cosa modificare.',
        'Ti sembra bene? Puoi dire sì, no, o cosa vuoi cambiare.',
        'È corretto? Puoi accettare, rifiutare, o indicare cosa cambiare.',
        'Sei d\'accordo? Puoi confermare, correggere, o dire cosa cambiare.'
      ],
      fr: [
        'Est-ce correct? Vous pouvez dire oui, non, ou ce que vous voulez changer.',
        'Est-ce que ça va? Vous pouvez confirmer, nier, ou dire ce qu\'il faut modifier.',
        'Ça vous semble bien? Vous pouvez dire oui, non, ou ce que vous voulez changer.',
        'Est-ce correct? Vous pouvez accepter, rejeter, ou indiquer ce qu\'il faut changer.',
        'Êtes-vous d\'accord? Vous pouvez confirmer, corriger, ou dire ce qu\'il faut changer.'
      ],
      pt: [
        'Está correto? Você pode dizer sim, não, ou o que quer mudar.',
        'Está bem? Você pode confirmar, negar, ou dizer o que modificar.',
        'Parece bem? Você pode dizer sim, não, ou o que quer mudar.',
        'Está correto? Você pode aceitar, rejeitar, ou indicar o que mudar.',
        'Você concorda? Você pode confirmar, corrigir, ou dizer o que mudar.'
      ]
    },
    default: {
      es: [
        '¿En qué puedo ayudarle? ¿Le gustaría hacer una reserva?',
        '¿Cómo puedo asistirle? ¿Quiere hacer una reserva?',
        '¿En qué le puedo ayudar? ¿Desea reservar una mesa?',
        '¿Qué necesita? ¿Le gustaría hacer una reserva?',
        '¿Cómo puedo ayudarle? ¿Quiere hacer una reserva?'
      ],
      en: [
        'How can I help you? Would you like to make a reservation?',
        'How can I assist you? Do you want to make a reservation?',
        'How can I help you? Would you like to book a table?',
        'What do you need? Would you like to make a reservation?',
        'How can I help you? Do you want to make a reservation?'
      ],
      de: [
        'Wie kann ich Ihnen helfen? Möchten Sie eine Reservierung vornehmen?',
        'Wie kann ich Ihnen assistieren? Möchten Sie eine Reservierung?',
        'Wie kann ich Ihnen helfen? Möchten Sie einen Tisch reservieren?',
        'Was benötigen Sie? Möchten Sie eine Reservierung vornehmen?',
        'Wie kann ich Ihnen helfen? Möchten Sie eine Reservierung?'
      ],
      it: [
        'Come posso aiutarti? Vorresti fare una prenotazione?',
        'Come posso assisterti? Vuoi fare una prenotazione?',
        'Come posso aiutarti? Vorresti prenotare un tavolo?',
        'Di cosa hai bisogno? Vorresti fare una prenotazione?',
        'Come posso aiutarti? Vuoi fare una prenotazione?'
      ],
      fr: [
        'Comment puis-je vous aider? Souhaitez-vous faire une réservation?',
        'Comment puis-je vous assister? Voulez-vous faire une réservation?',
        'Comment puis-je vous aider? Souhaitez-vous réserver une table?',
        'De quoi avez-vous besoin? Souhaitez-vous faire une réservation?',
        'Comment puis-je vous aider? Voulez-vous faire une réservation?'
      ],
      pt: [
        'Como posso ajudá-lo? Gostaria de fazer uma reserva?',
        'Como posso assisti-lo? Quer fazer uma reserva?',
        'Como posso ajudá-lo? Gostaria de reservar uma mesa?',
        'O que você precisa? Gostaria de fazer uma reserva?',
        'Como posso ajudá-lo? Quer fazer uma reserva?'
      ]
    }
  };

  return messages[type] && messages[type][language] ? messages[type][language] : messages[type]['es'];
}

// Detección básica de idioma
function detectLanguage(text) {
  const languagePatterns = {
    en: ['hello', 'hi', 'good morning', 'good afternoon', 'good evening', 'book', 'reservation', 'table', 'want', 'need', 'would like'],
    de: ['hallo', 'guten tag', 'guten morgen', 'guten abend', 'reservierung', 'tisch', 'möchte', 'brauche'],
    it: ['ciao', 'buongiorno', 'buonasera', 'prenotazione', 'tavolo', 'vorrei', 'ho bisogno'],
    fr: ['bonjour', 'bonsoir', 'réservation', 'table', 'je voudrais', 'j\'ai besoin'],
    pt: ['olá', 'bom dia', 'boa tarde', 'reserva', 'mesa', 'gostaria', 'preciso'],
    es: ['hola', 'buenos días', 'buenas tardes', 'reserva', 'mesa', 'quiero', 'necesito']
  };

  const lowerText = text.toLowerCase();
  let maxMatches = 0;
  let detectedLanguage = 'es'; // Por defecto español

  for (const [lang, patterns] of Object.entries(languagePatterns)) {
    const matches = patterns.filter(pattern => lowerText.includes(pattern)).length;
    if (matches > maxMatches) {
      maxMatches = matches;
      detectedLanguage = lang;
    }
  }

  return detectedLanguage;
}

function handleConfirmationResponse(text) {
  // Palabras de confirmación positiva
  const positiveWords = [
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo'
  ];
  
  // Palabras de negación
  const negativeWords = [
    'no', 'incorrecto', 'mal', 'error', 'cambiar', 'modificar', 'corregir',
    'no es', 'no está bien', 'no me parece', 'discrepo', 'no acepto'
  ];
  
  // Palabras para reiniciar
  const restartWords = [
    'empezar de nuevo', 'volver a empezar', 'reiniciar', 'otra vez', 'de nuevo',
    'cambiar todo', 'empezamos otra vez', 'resetear'
  ];
  
  const lowerText = text.toLowerCase();
  
  // Verificar confirmación positiva
  if (positiveWords.some(word => lowerText.includes(word))) {
    return { action: 'confirm' };
  }
  
  // Verificar negación
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { action: 'clarify', message: 'Entiendo. ¿Qué le gustaría cambiar? Puede decir cambiar personas, cambiar fecha, cambiar hora, cambiar nombre o cambiar teléfono.' };
  }
  
  // Verificar reinicio completo
  if (restartWords.some(word => lowerText.includes(word))) {
    return { action: 'restart' };
  }
  
  // Detectar modificaciones específicas
  const modifications = detectSpecificModifications(lowerText);
  if (modifications.length > 0) {
    return { action: 'modify', modification: modifications[0] };
  }
  
  // Respuesta ambigua
  return { action: 'clarify', message: '¿Es correcto? Puede decir sí para confirmar, no para cambiar algo, o qué específicamente quiere modificar.' };
}

function detectSpecificModifications(text) {
  const modifications = [];
  
  // Detectar cambios específicos
  if (text.includes('personas') || text.includes('gente') || text.includes('comensales') || text.includes('número de personas')) {
    modifications.push('people');
  }
  if (text.includes('fecha') || text.includes('día') || text.includes('día') || text.includes('cuando')) {
    modifications.push('date');
  }
  if (text.includes('hora') || text.includes('tiempo') || text.includes('a qué hora')) {
    modifications.push('time');
  }
  if (text.includes('nombre') || text.includes('como me llamo') || text.includes('mi nombre')) {
    modifications.push('name');
  }
  if (text.includes('teléfono') || text.includes('número') || text.includes('teléfono')) {
    modifications.push('phone');
  }
  
  return modifications;
}

function handleModificationRequest(state, modification) {
  switch (modification) {
    case 'people':
      state.step = 'ask_people';
      return {
        message: 'Perfecto. ¿Para cuántas personas?',
        gather: true
      };
      
    case 'date':
      state.step = 'ask_date';
      return {
        message: 'Perfecto. ¿Para qué fecha?',
        gather: true
      };
      
    case 'time':
      state.step = 'ask_time';
      return {
        message: 'Perfecto. ¿A qué hora?',
        gather: true
      };
      
    case 'name':
      state.step = 'ask_name';
      return {
        message: 'Perfecto. ¿Su nombre?',
        gather: true
      };
      
    case 'phone':
      state.step = 'ask_phone';
      return {
        message: 'Perfecto. ¿Desea usar este número o prefiere otro?',
        gather: true
      };
      
    default:
      return {
        message: '¿Qué específicamente quiere cambiar?',
        gather: true
      };
  }
}

function handleIntentionResponse(text) {
  // Palabras de reserva directa - EXPANDIDAS
  const directReservationWords = [
    'reservar', 'reserva', 'mesa', 'quiero reservar', 'necesito reservar', 
    'me gustaría reservar', 'quisiera reservar', 'deseo reservar', 
    'hacer una reserva', 'reservar mesa', 'quiero mesa', 'book', 'booking',
    'table reservation', 'reservieren', 'prenotazione', 'réservation'
  ];
  
  // Palabras de intención general - EXPANDIDAS
  const generalIntentionWords = [
    'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'quería',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'adelante', 'want', 'need',
    'would like', 'möchte', 'brauche', 'vorrei', 'j\'ai besoin'
  ];
  
  // Palabras de negación o no reserva
  const negativeWords = [
    'no', 'nada', 'solo llamaba', 'información', 'pregunta', 'duda',
    'cancelar', 'cancelación', 'no reserva'
  ];
  
  const lowerText = text.toLowerCase();
  
  // Verificar reserva directa
  if (directReservationWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Verificar negación
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { 
      action: 'clarify', 
      message: 'Entiendo. Si cambia de opinión y quiere hacer una reserva, solo dígamelo.' 
    };
  }
  
  // Verificar intención general (asumir que es para reserva)
  if (generalIntentionWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Respuesta ambigua
  return { 
    action: 'clarify', 
    message: '¿Le gustaría hacer una reserva para nuestro restaurante?' 
  };
}

function handleUnclearResponse(text, field, language = 'es') {
  const responses = {
    people: {
      es: [
        'Disculpe, no entendí. ¿Cuántas personas serán?',
        '¿Para cuántas personas? Dígame un número del 1 al 20.',
        'No capté bien. ¿Cuántas personas van a venir?',
        '¿Podría repetir? ¿Para cuántas personas?',
        'Disculpe, ¿cuántas personas serán en total?'
      ],
      en: [
        'Sorry, I didn\'t understand. How many people will it be?',
        'For how many people? Tell me a number from 1 to 20.',
        'I didn\'t catch that well. How many people are coming?',
        'Could you repeat? For how many people?',
        'Sorry, how many people in total?'
      ],
      de: [
        'Entschuldigung, ich habe nicht verstanden. Für wie viele Personen?',
        'Für wie viele Personen? Sagen Sie mir eine Zahl von 1 bis 20.',
        'Ich habe das nicht gut verstanden. Wie viele Personen kommen?',
        'Könnten Sie wiederholen? Für wie viele Personen?',
        'Entschuldigung, wie viele Personen insgesamt?'
      ],
      it: [
        'Scusi, non ho capito. Per quante persone?',
        'Per quante persone? Dimmi un numero da 1 a 20.',
        'Non ho capito bene. Quante persone vengono?',
        'Potresti ripetere? Per quante persone?',
        'Scusi, quante persone in totale?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris. Pour combien de personnes?',
        'Pour combien de personnes? Dites-moi un nombre de 1 à 20.',
        'Je n\'ai pas bien saisi. Combien de personnes viennent?',
        'Pourriez-vous répéter? Pour combien de personnes?',
        'Désolé, combien de personnes au total?'
      ],
      pt: [
        'Desculpe, não entendi. Para quantas pessoas?',
        'Para quantas pessoas? Diga-me um número de 1 a 20.',
        'Não entendi bem. Quantas pessoas estão vindo?',
        'Poderia repetir? Para quantas pessoas?',
        'Desculpe, quantas pessoas no total?'
      ]
    },
    date: {
      es: [
        'No entendí bien la fecha. ¿Qué día prefieren?',
        '¿Para qué día? Pueden decir mañana, pasado mañana, o un día específico.',
        'Disculpe, no capté la fecha. ¿Qué día les conviene?',
        '¿Podrían repetir? ¿Para qué fecha?',
        'No entendí. ¿Qué día quieren venir?'
      ],
      en: [
        'I didn\'t understand the date well. What day do you prefer?',
        'For what day? You can say tomorrow, the day after tomorrow, or a specific day.',
        'Sorry, I didn\'t catch the date. What day suits you?',
        'Could you repeat? For what date?',
        'I didn\'t understand. What day do you want to come?'
      ],
      de: [
        'Ich habe das Datum nicht gut verstanden. Welchen Tag bevorzugen Sie?',
        'Für welchen Tag? Sie können morgen, übermorgen oder einen bestimmten Tag sagen.',
        'Entschuldigung, ich habe das Datum nicht verstanden. Welcher Tag passt Ihnen?',
        'Könnten Sie wiederholen? Für welches Datum?',
        'Ich habe nicht verstanden. An welchem Tag möchten Sie kommen?'
      ],
      it: [
        'Non ho capito bene la data. Che giorno preferisci?',
        'Per che giorno? Puoi dire domani, dopodomani, o un giorno specifico.',
        'Scusi, non ho capito la data. Che giorno ti conviene?',
        'Potresti ripetere? Per che data?',
        'Non ho capito. Che giorno vuoi venire?'
      ],
      fr: [
        'Je n\'ai pas bien compris la date. Quel jour préférez-vous?',
        'Pour quel jour? Vous pouvez dire demain, après-demain, ou un jour spécifique.',
        'Désolé, je n\'ai pas saisi la date. Quel jour vous convient?',
        'Pourriez-vous répéter? Pour quelle date?',
        'Je n\'ai pas compris. Quel jour voulez-vous venir?'
      ],
      pt: [
        'Não entendi bem a data. Que dia você prefere?',
        'Para que dia? Você pode dizer amanhã, depois de amanhã, ou um dia específico.',
        'Desculpe, não entendi a data. Que dia te convém?',
        'Poderia repetir? Para que data?',
        'Não entendi. Que dia você quer vir?'
      ]
    },
    time: {
      es: [
        'No entendí bien la hora. ¿A qué hora prefieren?',
        '¿A qué hora? Pueden decir por ejemplo: las ocho, las ocho y media...',
        'Disculpe, no capté la hora. ¿A qué hora les gustaría venir?',
        '¿Podrían repetir? ¿A qué hora?',
        'No entendí. ¿A qué hora quieren la reserva?'
      ],
      en: [
        'I didn\'t understand the time well. What time do you prefer?',
        'What time? You can say for example: eight o\'clock, eight thirty...',
        'Sorry, I didn\'t catch the time. What time would you like to come?',
        'Could you repeat? What time?',
        'I didn\'t understand. What time do you want the reservation?'
      ],
      de: [
        'Ich habe die Uhrzeit nicht gut verstanden. Zu welcher Uhrzeit bevorzugen Sie?',
        'Zu welcher Uhrzeit? Sie können zum Beispiel sagen: acht Uhr, halb neun...',
        'Entschuldigung, ich habe die Uhrzeit nicht verstanden. Zu welcher Uhrzeit möchten Sie kommen?',
        'Könnten Sie wiederholen? Zu welcher Uhrzeit?',
        'Ich habe nicht verstanden. Zu welcher Uhrzeit möchten Sie die Reservierung?'
      ],
      it: [
        'Non ho capito bene l\'ora. A che ora preferisci?',
        'A che ora? Puoi dire per esempio: le otto, le otto e mezza...',
        'Scusi, non ho capito l\'ora. A che ora vorresti venire?',
        'Potresti ripetere? A che ora?',
        'Non ho capito. A che ora vuoi la prenotazione?'
      ],
      fr: [
        'Je n\'ai pas bien compris l\'heure. À quelle heure préférez-vous?',
        'À quelle heure? Vous pouvez dire par exemple: huit heures, huit heures et demie...',
        'Désolé, je n\'ai pas saisi l\'heure. À quelle heure aimeriez-vous venir?',
        'Pourriez-vous répéter? À quelle heure?',
        'Je n\'ai pas compris. À quelle heure voulez-vous la réservation?'
      ],
      pt: [
        'Não entendi bem a hora. Que horas você prefere?',
        'Que horas? Você pode dizer por exemplo: oito horas, oito e meia...',
        'Desculpe, não entendi a hora. Que horas gostaria de vir?',
        'Poderia repetir? Que horas?',
        'Não entendi. Que horas você quer a reserva?'
      ]
    },
    name: {
      es: [
        'Disculpe, no entendí bien su nombre. ¿Cómo se llama?',
        '¿Su nombre? Por favor, dígamelo despacio.',
        'No capté su nombre. ¿Podría repetirlo?',
        'Disculpe, ¿cómo se llama?',
        '¿Podría decirme su nombre otra vez?'
      ],
      en: [
        'Sorry, I didn\'t understand your name well. What\'s your name?',
        'Your name? Please tell me slowly.',
        'I didn\'t catch your name. Could you repeat it?',
        'Sorry, what\'s your name?',
        'Could you tell me your name again?'
      ],
      de: [
        'Entschuldigung, ich habe Ihren Namen nicht gut verstanden. Wie heißen Sie?',
        'Ihr Name? Bitte sagen Sie es mir langsam.',
        'Ich habe Ihren Namen nicht verstanden. Könnten Sie ihn wiederholen?',
        'Entschuldigung, wie heißen Sie?',
        'Könnten Sie mir Ihren Namen noch einmal sagen?'
      ],
      it: [
        'Scusi, non ho capito bene il tuo nome. Come ti chiami?',
        'Il tuo nome? Per favore, dimmelo lentamente.',
        'Non ho capito il tuo nome. Potresti ripeterlo?',
        'Scusi, come ti chiami?',
        'Potresti dirmi il tuo nome di nuovo?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre nom. Comment vous appelez-vous?',
        'Votre nom? S\'il vous plaît, dites-le moi lentement.',
        'Je n\'ai pas saisi votre nom. Pourriez-vous le répéter?',
        'Désolé, comment vous appelez-vous?',
        'Pourriez-vous me dire votre nom encore une fois?'
      ],
      pt: [
        'Desculpe, não entendi bem o seu nome. Como você se chama?',
        'Seu nome? Por favor, diga-me devagar.',
        'Não entendi o seu nome. Poderia repetir?',
        'Desculpe, como você se chama?',
        'Poderia me dizer o seu nome novamente?'
      ]
    },
    phone: {
      es: [
        'No entendí bien el número. ¿Podría decirlo dígito por dígito?',
        '¿El número de teléfono? Dígalo despacio, número por número.',
        'Disculpe, no capté el teléfono. ¿Puede repetirlo?',
        '¿Podría repetir el número? Dígito por dígito.',
        'No entendí. ¿Su número de teléfono?'
      ],
      en: [
        'I didn\'t understand the number well. Could you say it digit by digit?',
        'The phone number? Say it slowly, number by number.',
        'Sorry, I didn\'t catch the phone. Can you repeat it?',
        'Could you repeat the number? Digit by digit.',
        'I didn\'t understand. Your phone number?'
      ],
      de: [
        'Ich habe die Nummer nicht gut verstanden. Könnten Sie sie Ziffer für Ziffer sagen?',
        'Die Telefonnummer? Sagen Sie sie langsam, Ziffer für Ziffer.',
        'Entschuldigung, ich habe das Telefon nicht verstanden. Können Sie es wiederholen?',
        'Könnten Sie die Nummer wiederholen? Ziffer für Ziffer.',
        'Ich habe nicht verstanden. Ihre Telefonnummer?'
      ],
      it: [
        'Non ho capito bene il numero. Potresti dirlo cifra per cifra?',
        'Il numero di telefono? Dillo lentamente, cifra per cifra.',
        'Scusi, non ho capito il telefono. Puoi ripeterlo?',
        'Potresti ripetere il numero? Cifra per cifra.',
        'Non ho capito. Il tuo numero di telefono?'
      ],
      fr: [
        'Je n\'ai pas bien compris le numéro. Pourriez-vous le dire chiffre par chiffre?',
        'Le numéro de téléphone? Dites-le lentement, chiffre par chiffre.',
        'Désolé, je n\'ai pas saisi le téléphone. Pouvez-vous le répéter?',
        'Pourriez-vous répéter le numéro? Chiffre par chiffre.',
        'Je n\'ai pas compris. Votre numéro de téléphone?'
      ],
      pt: [
        'Não entendi bem o número. Poderia dizê-lo dígito por dígito?',
        'O número de telefone? Diga devagar, número por número.',
        'Desculpe, não entendi o telefone. Pode repetir?',
        'Poderia repetir o número? Dígito por dígito.',
        'Não entendi. O seu número de telefone?'
      ]
    }
  };
  
  // Seleccionar respuesta aleatoria para evitar monotonía
  const fieldResponses = responses[field] && responses[field][language] ? responses[field][language] : responses[field]['es'];
  return getRandomMessage(fieldResponses);
}

function isReservationRequest(text) {
  const reservationWords = [
    'reservar', 'reserva', 'mesa', 'quiero', 'necesito', 
    'me gustaría', 'quisiera', 'deseo', 'quería',
    'hacer una reserva', 'reservar mesa', 'si', 'sí', 'vale'
  ];
  return reservationWords.some(word => text.includes(word));
}

function extractPeopleCount(text) {
  const wordToNumber = {
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15
  };

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different'
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

  // Si solo hay un número, devolverlo
  return foundNumbers[0].number;
}

function extractDate(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('🔍 extractDate recibió:', text);

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundDates = [];

  // Si hay corrección, buscar la última fecha mencionada
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

  // Manejar "pasado mañana" antes que "mañana"
  if (textToAnalyze.includes('pasado mañana') || (textToAnalyze.includes('pasado') && textToAnalyze.includes('mañana'))) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    console.log('✅ Detectado: pasado mañana');
    return formatDateISO(date);
  }
  
  // Manejar "mañana" pero no "pasado mañana"
  if (textToAnalyze.includes('mañana') && !textToAnalyze.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: mañana');
    return formatDateISO(date);
  }
  
  // Manejar "tomorrow" en inglés
  if (textToAnalyze.includes('tomorrow')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: tomorrow');
    return formatDateISO(date);
  }
  
  // Manejar "today" en inglés
  if (textToAnalyze.includes('today')) {
    console.log('✅ Detectado: today');
    return formatDateISO(today);
  }
  
  if (textToAnalyze.includes('hoy')) {
    console.log('✅ Detectado: hoy');
    return formatDateISO(today);
  }

  // Mapeo de nombres de meses en español e inglés (ANTES de días de la semana para priorizar)
  const monthNames = {
    // Español
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
    // Inglés
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12
  };

  // Intentar extraer fecha con nombre de mes: "10 de octubre", "15 de enero"
  for (const [monthName, monthNumber] of Object.entries(monthNames)) {
    if (textToAnalyze.includes(monthName)) {
      console.log(`✅ Detectado mes: ${monthName}`);
      
      // Buscar el número antes del mes (más preciso)
      const patterns = [
        new RegExp(`(\\d{1,2})\\s*de\\s*${monthName}`, 'i'),  // "10 de octubre"
        new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i'),         // "10 octubre" o "25 october"
        new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i'),         // "octubre 10" o "october 25"
        new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*${monthName}`, 'i'), // "25th october"
        new RegExp(`${monthName}\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?`, 'i'), // "october 25th"
      ];
      
      for (const pattern of patterns) {
        const match = textToAnalyze.match(pattern);
        if (match) {
          const day = parseInt(match[1]);
          console.log(`✅ Detectado día: ${day}`);
          
          if (day >= 1 && day <= 31) {
            const year = today.getFullYear();
            try {
              const date = new Date(year, monthNumber - 1, day);
              // Si la fecha es anterior a hoy, asumir que es el año siguiente
              if (date < today) {
                date.setFullYear(year + 1);
              }
              console.log(`✅ Fecha procesada: ${formatDateISO(date)}`);
              return formatDateISO(date);
            } catch (e) {
              console.log('❌ Error creando fecha:', e);
              return null;
            }
          }
        }
      }
      
      // Si no encontró patrón específico, buscar cualquier número
      const dayMatches = [...textToAnalyze.matchAll(/\b(\d{1,2})\b/g)];
      if (dayMatches.length > 0) {
        const day = parseInt(dayMatches[0][1]);
        if (day >= 1 && day <= 31) {
          const year = today.getFullYear();
          try {
            const date = new Date(year, monthNumber - 1, day);
            if (date < today) {
              date.setFullYear(year + 1);
            }
            console.log(`✅ Fecha procesada (fallback): ${formatDateISO(date)}`);
            return formatDateISO(date);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }

  // Detectar días de la semana (DESPUÉS de los meses)
  const daysOfWeek = {
    // Español
    'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
    'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0,
    // Inglés
    'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
    'friday': 5, 'saturday': 6, 'sunday': 0
  };

  for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
    if (textToAnalyze.includes(dayName)) {
      console.log(`✅ Detectado día de la semana: ${dayName}`);
      const currentDay = today.getDay(); // 0=domingo, 1=lunes, etc.
      let daysUntil = dayNumber - currentDay;
      
      // Si el día ya pasó esta semana, ir a la próxima semana
      if (daysUntil <= 0) {
        daysUntil += 7;
      }
      
      // Si dice "que viene" o "próximo", asegurar que es la próxima semana
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

  // Intentar extraer fecha numérica: "10/10", "10-10", "10/25", "25/10"
  const dateMatch = textToAnalyze.match(/(\d{1,2})[\/\-\s](?:de\s)?(\d{1,2})/);
  if (dateMatch) {
    const first = parseInt(dateMatch[1]);
    const second = parseInt(dateMatch[2]);
    const year = today.getFullYear();
    
    try {
      // Intentar ambos formatos: DD/MM y MM/DD
      let date1 = new Date(year, first - 1, second);
      let date2 = new Date(year, second - 1, first);
      
      // Si la primera fecha es válida y no es pasada, usarla
      if (date1 >= today && date1.getMonth() === first - 1) {
        console.log(`✅ Fecha numérica detectada: ${first}/${second}`);
        return formatDateISO(date1);
      }
      
      // Si la segunda fecha es válida y no es pasada, usarla
      if (date2 >= today && date2.getMonth() === second - 1) {
        console.log(`✅ Fecha numérica detectada: ${second}/${first}`);
        return formatDateISO(date2);
      }
      
      // Si ambas son pasadas, usar la del año siguiente
      if (date1 < today) {
        date1.setFullYear(year + 1);
        console.log(`✅ Fecha numérica detectada (año siguiente): ${first}/${second}`);
        return formatDateISO(date1);
      }
      
    } catch (e) {
      return null;
    }
  }

  return null;
}

function extractTime(text) {
  const wordToNumber = {
    'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12
  };

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundTimes = [];

  // Buscar horas en palabras
  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      let hours = number;
      let minutes = 0;

      // MEJORADO: Manejar "y media", "y cuarto", "menos cuarto"
      if (text.includes('media') || text.includes('treinta')) {
        minutes = 30;
      } else if (text.includes('cuarto') || text.includes('quince')) {
        minutes = 15;
      } else if (text.includes('menos cuarto')) {
        hours = (hours + 23) % 24; // Restar 1 hora
        minutes = 45;
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

  // Si hay corrección o múltiples horas, tomar la última
  if (hasCorrection || foundTimes.length > 1) {
    foundTimes.sort((a, b) => b.position - a.position);
    return foundTimes[0].time;
  }

  // Si solo hay una hora, devolverla
  return foundTimes[0].time;
}

function extractName(text) {
  // Limpiar el texto
  const cleaned = text
    .replace(/mi nombre es/gi, '')
    .replace(/me llamo/gi, '')
    .replace(/soy/gi, '')
    .replace(/my name is/gi, '')
    .replace(/i am/gi, '')
    .replace(/ich heiße/gi, '')
    .replace(/mi chiamo/gi, '')
    .replace(/je m\'appelle/gi, '')
    .replace(/meu nome é/gi, '')
    .trim();
  
  if (cleaned.length > 1) {
    // Capitalizar cada palabra
    return cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return null;
}

function extractPhoneNumber(text) {
  // Primero intentar extraer números directamente
  const directMatch = text.match(/\d{9,}/);
  if (directMatch) {
    return directMatch[0];
  }

  // Mapeo de palabras a dígitos - EXPANDIDO
  const wordToDigit = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 
    'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 
    'ocho': '8', 'nueve': '9', 'zero': '0', 'one': '1', 'two': '2',
    'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
    'eight': '8', 'nine': '9'
  };

  // Convertir palabras a dígitos
  let phoneNumber = '';
  const words = text.split(/\s+/);
  
  for (const word of words) {
    const cleanWord = word.toLowerCase().replace(/[,\.]/g, '');
    if (wordToDigit[cleanWord]) {
      phoneNumber += wordToDigit[cleanWord];
    } else if (/^\d$/.test(cleanWord)) {
      // Si ya es un dígito, agregarlo
      phoneNumber += cleanWord;
    }
  }

  // Si tenemos al menos 9 dígitos, retornar
  if (phoneNumber.length >= 9) {
    return phoneNumber;
  }

  return null;
}

function getConfirmationMessage(data, language = 'es') {
  const phoneFormatted = formatPhoneForSpeech(data.TelefonReserva, language);
  
  const confirmations = {
    es: `Confirmo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'personas'}, ${formatDateSpanish(data.FechaReserva)} a las ${data.HoraReserva}, a nombre de ${data.NomReserva}, teléfono ${phoneFormatted}. ¿Es correcto?`,
    en: `I confirm: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'person' : 'people'}, ${formatDateEnglish(data.FechaReserva)} at ${data.HoraReserva}, under the name of ${data.NomReserva}, phone ${phoneFormatted}. Is it correct?`,
    de: `Ich bestätige: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'Person' : 'Personen'}, ${formatDateGerman(data.FechaReserva)} um ${data.HoraReserva}, unter dem Namen ${data.NomReserva}, Telefon ${phoneFormatted}. Ist es richtig?`,
    it: `Confermo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'persone'}, ${formatDateItalian(data.FechaReserva)} alle ${data.HoraReserva}, a nome di ${data.NomReserva}, telefono ${phoneFormatted}. È corretto?`,
    fr: `Je confirme: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'personne' : 'personnes'}, ${formatDateFrench(data.FechaReserva)} à ${data.HoraReserva}, au nom de ${data.NomReserva}, téléphone ${phoneFormatted}. Est-ce correct?`,
    pt: `Confirmo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'pessoa' : 'pessoas'}, ${formatDatePortuguese(data.FechaReserva)} às ${data.HoraReserva}, em nome de ${data.NomReserva}, telefone ${phoneFormatted}. Está correto?`
  };
  
  return confirmations[language] || confirmations['es'];
}

function formatPhoneForSpeech(phone, language = 'es') {
  // Limpiar el teléfono de caracteres no numéricos
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Convertir cada dígito en su palabra según el idioma
  const digitWords = {
    es: {
      '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
      '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
    },
    en: {
      '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
      '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
    },
    de: {
      '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
      '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun'
    },
    it: {
      '0': 'zero', '1': 'uno', '2': 'due', '3': 'tre', '4': 'quattro',
      '5': 'cinque', '6': 'sei', '7': 'sette', '8': 'otto', '9': 'nove'
    },
    fr: {
      '0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre',
      '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf'
    },
    pt: {
      '0': 'zero', '1': 'um', '2': 'dois', '3': 'três', '4': 'quatro',
      '5': 'cinco', '6': 'seis', '7': 'sete', '8': 'oito', '9': 'nove'
    }
  };
  
  const words = digitWords[language] || digitWords['es'];
  
  // Convertir cada dígito y añadir comas para pausas naturales cada 3 dígitos
  let result = '';
  for (let i = 0; i < cleanPhone.length; i++) {
    result += words[cleanPhone[i]];
    // Añadir una pausa después de cada 3 dígitos (excepto al final)
    if ((i + 1) % 3 === 0 && i !== cleanPhone.length - 1) {
      result += ', ';
    } else if (i !== cleanPhone.length - 1) {
      result += ' ';
    }
  }
  
  return result;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateSpanish(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${parseInt(day)} de ${months[parseInt(month) - 1]}`;
}

function formatDateEnglish(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[parseInt(month) - 1]} ${parseInt(day)}`;
}

function formatDateGerman(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${parseInt(day)}. ${months[parseInt(month) - 1]}`;
}

function formatDateItalian(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  return `${parseInt(day)} ${months[parseInt(month) - 1]}`;
}

function formatDateFrench(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${parseInt(day)} ${months[parseInt(month) - 1]}`;
}

function formatDatePortuguese(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${parseInt(day)} de ${months[parseInt(month) - 1]}`;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateMarkdownConversation(state) {
  const { conversationHistory, phone, data } = state;
  const timestamp = new Date().toISOString();
  
  let markdown = `# 📞 Conversación de Reserva\n\n`;
  
  // Información de la llamada
  markdown += `## 📋 Información de la Llamada\n`;
  markdown += `- **Teléfono**: ${phone}\n`;
  markdown += `- **Fecha**: ${new Date().toLocaleDateString('es-ES')}\n`;
  markdown += `- **Hora**: ${new Date().toLocaleTimeString('es-ES')}\n`;
  markdown += `- **Sistema**: Twilio (Hard-coded Mejorado)\n`;
  markdown += `- **Idioma**: ${state.language || 'es'}\n`;
  markdown += `- **Estado**: ${state.step === 'complete' ? '✅ Completada' : '⚠️ Incompleta'}\n\n`;
  
  // Datos de la reserva (si están disponibles)
  if (data && Object.keys(data).length > 0) {
    markdown += `## 🍽️ Datos de la Reserva\n`;
    if (data.NumeroReserva) markdown += `- **Personas**: ${data.NumeroReserva}\n`;
    if (data.FechaReserva) markdown += `- **Fecha**: ${formatDateSpanish(data.FechaReserva)}\n`;
    if (data.HoraReserva) markdown += `- **Hora**: ${data.HoraReserva}\n`;
    if (data.NomReserva) markdown += `- **Nombre**: ${data.NomReserva}\n`;
    if (data.TelefonReserva) markdown += `- **Teléfono Reserva**: ${data.TelefonReserva}\n`;
    markdown += `\n`;
  }
  
  // Conversación paso a paso
  markdown += `## 💬 Transcripción de la Conversación\n\n`;
  
  conversationHistory.forEach((entry, index) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('es-ES');
    const step = index + 1;
    
    if (entry.role === 'user') {
      markdown += `### ${step}. 👤 Cliente (${time})\n`;
      markdown += `> ${entry.message}\n\n`;
    } else {
      markdown += `### ${step}. 🤖 Bot (${time})\n`;
      markdown += `${entry.message}\n\n`;
    }
  });
  
  // Análisis de la conversación
  markdown += `## 📊 Análisis de la Conversación\n\n`;
  markdown += `- **Total de intercambios**: ${conversationHistory.length}\n`;
  markdown += `- **Duración estimada**: ${Math.ceil(conversationHistory.length * 15)} segundos\n`;
  
  // Contar pasos completados
  const stepsCompleted = ['ask_people', 'ask_date', 'ask_time', 'ask_name', 'ask_phone'].filter(step => {
    return state.data[step === 'ask_people' ? 'NumeroReserva' : 
                      step === 'ask_date' ? 'FechaReserva' :
                      step === 'ask_time' ? 'HoraReserva' :
                      step === 'ask_name' ? 'NomReserva' :
                      'TelefonReserva'];
  }).length;
  
  markdown += `- **Pasos completados**: ${stepsCompleted}/5\n`;
  
  // Detectar si fue exitosa
  const wasSuccessful = state.step === 'complete';
  markdown += `- **Resultado**: ${wasSuccessful ? '✅ Reserva completada exitosamente' : '❌ Conversación incompleta'}\n\n`;
  
  // Detectar problemas comunes y sugerir mejoras
  markdown += `## 🔍 Análisis de Problemas y Mejoras\n\n`;
  
  const issues = [];
  const suggestions = [];
  const history = conversationHistory.map(h => h.message.toLowerCase());
  
  // 1. DETECTAR REPETICIONES
  const repeatedMessages = history.filter((msg, index) => 
    history.indexOf(msg) !== index
  );
  if (repeatedMessages.length > 0) {
    issues.push(`⚠️ Mensajes repetidos detectados (${repeatedMessages.length})`);
    suggestions.push(`💡 **Solución**: Implementar más variaciones de respuestas para evitar repetición`);
    suggestions.push(`💡 **Técnica**: Usar arrays de 10-15 frases diferentes por cada paso`);
  }
  
  // 2. DETECTAR ERRORES DE COMPRENSIÓN
  const errorMessages = history.filter(msg => 
    msg.includes('no entendí') || msg.includes('disculpe') || msg.includes('perdón')
  );
  if (errorMessages.length > 0) {
    issues.push(`⚠️ Errores de comprensión: ${errorMessages.length}`);
    
    // Analizar QUÉ no entendió
    const unclearResponses = conversationHistory.filter(entry => 
      entry.role === 'bot' && (
        entry.message.includes('no entendí') || 
        entry.message.includes('Disculpe') || 
        entry.message.includes('Perdón')
      )
    );
    
    if (unclearResponses.length > 0) {
      suggestions.push(`💡 **Problema específico**: El bot no entendió ${unclearResponses.length} respuestas del cliente`);
      suggestions.push(`💡 **Solución**: Mejorar patrones regex o implementar Gemini para comprensión contextual`);
    }
  }
  
  // 3. DETECTAR CONVERSACIÓN MUY LARGA
  if (conversationHistory.length > 15) {
    issues.push(`⚠️ Conversación muy larga (${conversationHistory.length} intercambios)`);
    suggestions.push(`💡 **Problema**: Conversación excede el promedio ideal de 10-12 intercambios`);
    suggestions.push(`💡 **Causa posible**: Múltiples errores de comprensión o cliente indeciso`);
    suggestions.push(`💡 **Solución**: Reducir timeouts y mejorar comprensión para conversaciones más eficientes`);
  }
  
  // 4. DETECTAR CONVERSACIONES MUY CORTAS (posible problema)
  if (conversationHistory.length < 5 && state.step !== 'complete') {
    issues.push(`⚠️ Conversación muy corta (${conversationHistory.length} intercambios)`);
    suggestions.push(`💡 **Problema**: Conversación terminó prematuramente`);
    suggestions.push(`💡 **Posibles causas**: Cliente colgó, error técnico, o bot muy agresivo`);
  }
  
  // 5. DETECTAR PATRONES DE TIMEOUT
  const timeoutMessages = history.filter(msg => 
    msg.includes('no escuché') || msg.includes('¿sigue ahí?')
  );
  if (timeoutMessages.length > 0) {
    issues.push(`⚠️ Timeouts detectados (${timeoutMessages.length})`);
    suggestions.push(`💡 **Problema**: El bot cortó al cliente ${timeoutMessages.length} vez(es)`);
    suggestions.push(`💡 **Solución**: Aumentar speechTimeout de 1s a 2s o ajustar según el cliente`);
  }
  
  // 6. DETECTAR CORRECCIONES EXCESIVAS
  const correctionWords = history.filter(msg => 
    msg.includes('no, mejor') || msg.includes('espera') || msg.includes('cambiar')
  );
  if (correctionWords.length > 2) {
    issues.push(`⚠️ Múltiples correcciones detectadas (${correctionWords.length})`);
    suggestions.push(`💡 **Problema**: Cliente cambió de opinión muchas veces`);
    suggestions.push(`💡 **Solución**: Mejorar extracción para capturar la corrección final automáticamente`);
  }
  
  // 7. ANÁLISIS DE FLUJO
  const userResponses = conversationHistory.filter(h => h.role === 'user');
  const avgResponseLength = userResponses.reduce((sum, r) => sum + r.message.length, 0) / userResponses.length;
  
  if (avgResponseLength > 50) {
    issues.push(`⚠️ Respuestas del cliente muy largas (promedio: ${Math.round(avgResponseLength)} chars)`);
    suggestions.push(`💡 **Problema**: Cliente dice demasiado en cada respuesta`);
    suggestions.push(`💡 **Solución**: Preguntas más específicas para obtener respuestas más cortas`);
  }
  
  // MOSTRAR RESULTADOS
  if (issues.length === 0) {
    markdown += `✅ **Conversación óptima** - No se detectaron problemas significativos\n\n`;
    markdown += `🎯 **Métricas excelentes**:\n`;
    markdown += `- Conversación fluida y eficiente\n`;
    markdown += `- Sin errores de comprensión\n`;
    markdown += `- Duración apropiada\n`;
    markdown += `- Cliente satisfecho\n\n`;
  } else {
    markdown += `## 📋 Problemas Detectados\n\n`;
    issues.forEach((issue, index) => {
      markdown += `${index + 1}. ${issue}\n`;
    });
    
    markdown += `\n## 💡 Sugerencias de Mejora\n\n`;
    suggestions.forEach((suggestion, index) => {
      markdown += `${index + 1}. ${suggestion}\n`;
    });
    
    // Calcular puntuación de calidad
    const qualityScore = Math.max(0, 100 - (issues.length * 15) - (conversationHistory.length - 10) * 2);
    markdown += `\n## 📊 Puntuación de Calidad\n`;
    markdown += `- **Score**: ${qualityScore}/100\n`;
    markdown += `- **Estado**: ${qualityScore >= 80 ? '🟢 Excelente' : qualityScore >= 60 ? '🟡 Aceptable' : '🔴 Necesita Mejoras'}\n\n`;
  }
  
  markdown += `\n---\n`;
  markdown += `*Generado automáticamente el ${new Date().toLocaleString('es-ES')}*\n`;
  
  return markdown;
}
