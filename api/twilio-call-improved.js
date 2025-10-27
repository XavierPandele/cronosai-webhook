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

  // Verificar si el usuario quiere cancelar la reserva (en cualquier paso)
  if (userInput && userInput.trim() && isCancellationRequest(userInput)) {
    console.log(`🚫 [CANCELACIÓN] Usuario quiere cancelar en paso: ${step}`);
    
    // Si ya está en proceso de cancelación, confirmar
    if (step === 'cancelling') {
      return await handleCancellationConfirmation(state, userInput);
    }
    
    // Iniciar proceso de cancelación
    return await handleCancellationRequest(state, userInput);
  }

  // Detectar idioma solo en pasos específicos para evitar cambios inesperados
  if (userInput && userInput.trim()) {
    // Solo detectar idioma en greeting - NO durante cancelación para evitar cambios
    if (step === 'greeting') {
      const detectedLanguage = detectLanguage(userInput);
      console.log(`🔍 [DEBUG] Detectando idioma para: "${userInput}"`);
      console.log(`🌍 [DEBUG] Idioma detectado: ${detectedLanguage}`);
      console.log(`🌍 [DEBUG] Idioma actual del estado: ${state.language}`);
      
      // Actualizar idioma solo si es necesario
      if (detectedLanguage !== 'es' && detectedLanguage !== state.language) {
        console.log(`🔄 [DEBUG] Cambiando idioma de ${state.language} a ${detectedLanguage}`);
        state.language = detectedLanguage;
      }
    }
    
    console.log(`📝 [DEBUG] Estado actual: step=${state.step}, language=${state.language}`);
  }

  switch (step) {
     case 'greeting':
       // Primera interacción - saludo general
       console.log(`🎯 [DEBUG] GREETING: language=${state.language}, userInput="${userInput}"`);
       
       // Si detectamos un idioma diferente al español y hay intención de reserva, saltar al siguiente paso
       if (state.language !== 'es' && userInput && isReservationRequest(userInput)) {
         console.log(`🚀 [DEBUG] Saltando saludo - idioma=${state.language}, intención detectada`);
         state.step = 'ask_people';
         const reservationMessages = getMultilingualMessages('reservation', state.language);
         console.log(`💬 [DEBUG] Mensajes de reserva obtenidos:`, reservationMessages);
         return {
           message: getRandomMessage(reservationMessages),
           gather: true
         };
       }
       
       // Si es español o no hay intención clara de reserva, hacer saludo normal
       console.log(`👋 [DEBUG] Saludo normal - idioma=${state.language}`);
       state.step = 'ask_intention';
       const greetingMessages = getMultilingualMessages('greeting', state.language);
       console.log(`💬 [DEBUG] Mensajes de saludo obtenidos:`, greetingMessages);
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
      // Verificar si quiere usar el número actual o dar otro - MULTILINGÜE
      const affirmativeWords = [
        // Español
        'este', 'mismo', 'si', 'sí', 'vale', 'ok', 'bueno', 'perfecto',
        // Inglés
        'this', 'same', 'yes', 'okay', 'ok', 'good', 'perfect', 'sure',
        'this number', 'same number', 'use this', 'keep this',
        // Alemán
        'dieser', 'gleiche', 'ja', 'gut', 'perfekt', 'diese nummer',
        'diese telefonnummer', 'diese handynummer', 'diese mobilnummer',
        'gleiche nummer', 'selbe nummer', 'dieselbe nummer', 'gleiche telefonnummer',
        'selbe telefonnummer', 'dieselbe telefonnummer', 'gleiche handynummer',
        'selbe handynummer', 'dieselbe handynummer', 'gleiche mobilnummer',
        'selbe mobilnummer', 'dieselbe mobilnummer', 'diese', 'gleiche', 'selbe',
        'dieselbe', 'ja', 'gut', 'perfekt', 'ausgezeichnet', 'wunderbar',
        'prima', 'super', 'toll', 'fantastisch', 'okay', 'klar', 'natürlich',
        'gerne', 'sehr gerne', 'sehr gern', 'mit freuden', 'mit vergnügen',
        'selbstverständlich', 'logisch', 'verständlich', 'das passt',
        'das gefällt mir', 'das ist gut', 'das ist perfekt', 'so ist es richtig',
        'so stimmt es', 'so ist es korrekt', 'alles richtig', 'alles korrekt',
        'alles stimmt', 'alles perfekt', 'ich bin einverstanden', 'ich stimme zu',
        'ich akzeptiere', 'ich nehme an', 'ich befürworte', 'ich unterstütze',
        'fortfahren', 'fortsetzen', 'weiter', 'weitergehen', 'procedieren',
        'los gehts', 'los geht es', 'auf gehts', 'auf geht es', 'machen wir',
        'machen wir es', 'lassen wir es so', 'so bleibt es', 'so lassen wir es',
        'so ist es gut', 'das reicht', 'das genügt', 'das ist ausreichend',
        'mehr brauche ich nicht', 'mehr will ich nicht', 'mehr ist nicht nötig',
        'fertig', 'abgeschlossen', 'erledigt', 'vollständig', 'komplett',
        'ganz', 'total', 'völlig', 'absolut', 'verwenden', 'benutzen',
        'nutzen', 'verwende', 'benutze', 'nutze', 'verwende ich', 'benutze ich',
        'nutze ich', 'ich verwende', 'ich benutze', 'ich nutze', 'ich verwende diese',
        'ich benutze diese', 'ich nutze diese', 'ich verwende diese nummer',
        'ich benutze diese nummer', 'ich nutze diese nummer', 'ich verwende diese telefonnummer',
        'ich benutze diese telefonnummer', 'ich nutze diese telefonnummer',
        'ich verwende diese handynummer', 'ich benutze diese handynummer',
        'ich nutze diese handynummer', 'ich verwende diese mobilnummer',
        'ich benutze diese mobilnummer', 'ich nutze diese mobilnummer',
        'ich verwende die gleiche', 'ich benutze die gleiche', 'ich nutze die gleiche',
        'ich verwende die selbe', 'ich benutze die selbe', 'ich nutze die selbe',
        'ich verwende die dieselbe', 'ich benutze die dieselbe', 'ich nutze die dieselbe',
        'ich verwende die gleiche nummer', 'ich benutze die gleiche nummer',
        'ich nutze die gleiche nummer', 'ich verwende die selbe nummer',
        'ich benutze die selbe nummer', 'ich nutze die selbe nummer',
        'ich verwende die dieselbe nummer', 'ich benutze die dieselbe nummer',
        'ich nutze die dieselbe nummer', 'ich verwende die gleiche telefonnummer',
        'ich benutze die gleiche telefonnummer', 'ich nutze die gleiche telefonnummer',
        'ich verwende die selbe telefonnummer', 'ich benutze die selbe telefonnummer',
        'ich nutze die selbe telefonnummer', 'ich verwende die dieselbe telefonnummer',
        'ich benutze die dieselbe telefonnummer', 'ich nutze die dieselbe telefonnummer',
        'ich verwende die gleiche handynummer', 'ich benutze die gleiche handynummer',
        'ich nutze die gleiche handynummer', 'ich verwende die selbe handynummer',
        'ich benutze die selbe handynummer', 'ich nutze die selbe handynummer',
        'ich verwende die dieselbe handynummer', 'ich benutze die dieselbe handynummer',
        'ich nutze die dieselbe handynummer', 'ich verwende die gleiche mobilnummer',
        'ich benutze die gleiche mobilnummer', 'ich nutze die gleiche mobilnummer',
        'ich verwende die selbe mobilnummer', 'ich benutze die selbe mobilnummer',
        'ich nutze die selbe mobilnummer', 'ich verwende die dieselbe mobilnummer',
        'ich benutze die dieselbe mobilnummer', 'ich nutze die dieselbe mobilnummer',
        'behalten', 'behalte', 'behalte ich', 'ich behalte', 'ich behalte diese',
        'ich behalte diese nummer', 'ich behalte diese telefonnummer',
        'ich behalte diese handynummer', 'ich behalte diese mobilnummer',
        'ich behalte die gleiche', 'ich behalte die selbe', 'ich behalte die dieselbe',
        'ich behalte die gleiche nummer', 'ich behalte die selbe nummer',
        'ich behalte die dieselbe nummer', 'ich behalte die gleiche telefonnummer',
        'ich behalte die selbe telefonnummer', 'ich behalte die dieselbe telefonnummer',
        'ich behalte die gleiche handynummer', 'ich behalte die selbe handynummer',
        'ich behalte die dieselbe handynummer', 'ich behalte die gleiche mobilnummer',
        'ich behalte die selbe mobilnummer', 'ich behalte die dieselbe mobilnummer',
        // Italiano
        'questo', 'stesso', 'sì', 'si', 'va bene', 'perfetto', 'questo numero',
        'questo telefono', 'stesso numero', 'stesso telefono', 'va bene questo',
        'perfetto', 'ottimo', 'bene', 'giusto', 'esatto', 'corretto',
        'confermo', 'accetto', 'procedo', 'continua', 'avanti',
        'tutto bene', 'tutto ok', 'tutto perfetto', 'va tutto bene',
        'conferma', 'confermare', 'accettare', 'procedere',
        // Francés
        'ce', 'meme', 'oui', 'bon', 'parfait', 'ce numero',
        // Portugués
        'este', 'mesmo', 'sim', 'bom', 'perfeito', 'este número'
      ];
      
      const negativeWords = [
        // Español
        'otro', 'diferente', 'no', 'cambiar', 'nuevo',
        // Inglés
        'other', 'different', 'no', 'change', 'new', 'another',
        'different number', 'other number', 'new number',
        // Alemán
        'anderer', 'verschieden', 'nein', 'ändern', 'neue',
        'andere nummer', 'andere telefonnummer', 'andere handynummer', 'andere mobilnummer',
        'neue nummer', 'neue telefonnummer', 'neue handynummer', 'neue mobilnummer',
        'verschiedene nummer', 'verschiedene telefonnummer', 'verschiedene handynummer',
        'verschiedene mobilnummer', 'andere', 'neue', 'verschiedene', 'anderer',
        'neuer', 'verschiedener', 'andere', 'neue', 'verschiedene', 'anderer',
        'neuer', 'verschiedener', 'nicht diese', 'nicht diese nummer',
        'nicht diese telefonnummer', 'nicht diese handynummer', 'nicht diese mobilnummer',
        'nicht die gleiche', 'nicht die selbe', 'nicht die dieselbe',
        'nicht die gleiche nummer', 'nicht die selbe nummer', 'nicht die dieselbe nummer',
        'nicht die gleiche telefonnummer', 'nicht die selbe telefonnummer',
        'nicht die dieselbe telefonnummer', 'nicht die gleiche handynummer',
        'nicht die selbe handynummer', 'nicht die dieselbe handynummer',
        'nicht die gleiche mobilnummer', 'nicht die selbe mobilnummer',
        'nicht die dieselbe mobilnummer', 'ändern', 'korrigieren', 'modifizieren',
        'anpassen', 'verbessern', 'berichtigen', 'korrektur', 'berichtigung',
        'änderung', 'modifikation', 'anpassung', 'ich möchte ändern',
        'ich möchte korrigieren', 'ich möchte modifizieren', 'ich möchte anpassen',
        'ich möchte verbessern', 'ich möchte berichtigen', 'das muss geändert werden',
        'das muss korrigiert werden', 'das muss modifiziert werden',
        'das muss angepasst werden', 'das ist nicht das was ich wollte',
        'das ist nicht was ich wollte', 'das ist nicht richtig',
        'das ist nicht korrekt', 'das ist nicht stimmt', 'nicht das', 'nicht so',
        'nicht richtig', 'nicht korrekt', 'anders', 'differenz', 'unterschiedlich',
        'verschieden', 'abweichend', 'nicht gewünscht', 'nicht erwünscht',
        'nicht gewollt', 'nicht gewünscht', 'abbrechen', 'stornieren', 'löschen',
        'entfernen', 'aufheben', 'nicht mehr', 'nicht weiter', 'nicht fortfahren',
        'nicht fortsetzen', 'stopp', 'halt', 'aufhören', 'beenden', 'terminieren',
        // Italiano
        'altro', 'diverso', 'no', 'cambiare', 'nuovo',
        'altro numero', 'numero diverso', 'numero nuovo', 'telefono diverso',
        'telefono nuovo', 'cambiare numero', 'modificare numero',
        'non questo', 'non va bene', 'non mi piace', 'non accetto',
        'sbagliato', 'errato', 'non corretto', 'non è giusto',
        // Francés
        'autre', 'différent', 'non', 'changer', 'nouveau',
        // Portugués
        'outro', 'diferente', 'não', 'mudar', 'novo'
      ];
      
      if (affirmativeWords.some(word => text.toLowerCase().includes(word))) {
        // Usa el número de la llamada
        state.data.TelefonReserva = state.phone;
        state.step = 'confirm';
        return {
          message: getConfirmationMessage(state.data, state.language),
          gather: true
        };
      } else if (negativeWords.some(word => text.toLowerCase().includes(word))) {
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

    case 'cancelling':
      // Estado de cancelación - manejar confirmación
      console.log(`🚫 [CANCELLING] Procesando confirmación de cancelación`);
      return await handleCancellationConfirmation(state, userInput);

    case 'complete':
      // Estado completado - reserva exitosa
      console.log(`✅ [COMPLETE] Reserva completada exitosamente`);
      
      // Limpiar el estado después de un tiempo
      setTimeout(() => conversationStates.delete(state.callSid), 60000);
      
      // Devolver mensaje de confirmación final
      const completeMessages = getMultilingualMessages('complete', state.language);
      return {
        message: getRandomMessage(completeMessages),
        gather: false // No más interacción
      };

    default:
      state.step = 'greeting';
      const defaultMessages = getMultilingualMessages('default', state.language);
      return {
        message: getRandomMessage(defaultMessages),
        gather: true
      };
  }
}

// Funciones para manejar cancelación de reservas
async function handleCancellationRequest(state, userInput) {
  console.log(`🚫 [CANCELACIÓN] Iniciando proceso de cancelación`);
  
  // Cambiar estado a cancelación
  state.step = 'cancelling';
  
  // Obtener mensaje de confirmación de cancelación
  const cancellationMessages = getMultilingualMessages('cancellation_confirm', state.language);
  
  return {
    message: getRandomMessage(cancellationMessages),
    gather: true
  };
}

async function handleCancellationConfirmation(state, userInput) {
  console.log(`🚫 [CANCELACIÓN] Procesando confirmación de cancelación`);
  
  // Detectar si confirma la cancelación
  const confirmation = detectCancellationConfirmation(userInput);
  
  if (confirmation === 'yes') {
    // Cancelación confirmada - COLGAR DIRECTAMENTE
    console.log(`✅ [CANCELACIÓN] Cancelación confirmada - colgando llamada`);
    
    // Obtener mensaje de despedida tras cancelación
    const goodbyeMessages = getMultilingualMessages('cancellation_goodbye', state.language);
    
    return {
      message: getRandomMessage(goodbyeMessages),
      gather: false // No más interacción - CUELGA LA LLAMADA
    };
  } else if (confirmation === 'no') {
    // Cancelación rechazada - volver al paso anterior
    console.log(`🔄 [CANCELACIÓN] Cancelación rechazada, volviendo al proceso normal`);
    
    // Determinar a qué paso volver basado en los datos que ya tenemos
    if (state.data.NumPersonas) {
      if (state.data.FechaReserva) {
        if (state.data.HoraReserva) {
          if (state.data.NombreCliente) {
            state.step = 'ask_phone';
          } else {
            state.step = 'ask_name';
          }
        } else {
          state.step = 'ask_time';
        }
      } else {
        state.step = 'ask_date';
      }
    } else {
      state.step = 'ask_people';
    }
    
    // Obtener mensaje de continuación
    const continueMessages = getMultilingualMessages('cancellation_continue', state.language);
    
    return {
      message: getRandomMessage(continueMessages),
      gather: true
    };
  } else {
    // Respuesta no clara - pedir aclaración
    console.log(`❓ [CANCELACIÓN] Respuesta no clara, pidiendo aclaración`);
    
    const unclearMessages = getMultilingualMessages('cancellation_unclear', state.language);
    
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
}

function generateTwiML(response, language = 'es') {
  const { message, gather = true } = response;

  console.log(`🎤 [DEBUG] generateTwiML - Idioma recibido: ${language}`);
  console.log(`🎤 [DEBUG] generateTwiML - Mensaje: "${message}"`);

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
  console.log(`🎤 [DEBUG] Configuración de voz seleccionada:`, config);

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
        'Great! How many people are coming?',
        'Hello! I\'d be happy to help you make a reservation. For how many people?',
        'Welcome! I can help you with your table reservation. How many people?',
        'Of course! I\'ll help you book a table. For how many people?'
      ],
      de: [
        'Perfekt! Ich helfe Ihnen gerne bei Ihrer Reservierung. Für wie viele Personen?',
        'Ausgezeichnet! Ich helfe Ihnen gerne bei der Reservierung. Wie viele Personen werden es sein?',
        'Sehr gut! Ich helfe Ihnen gerne. Für wie viele Gäste?',
        'Perfekt! Für wie viele Personen benötigen Sie den Tisch?',
        'Großartig! Wie viele Personen kommen?',
        'Hallo! Gerne helfe ich Ihnen bei der Tischreservierung. Für wie viele Personen?',
        'Willkommen! Ich kann Ihnen bei der Tischreservierung helfen. Für wie viele Personen?',
        'Natürlich! Ich helfe Ihnen gerne beim Tischreservieren. Für wie viele Personen?'
      ],
      it: [
        'Perfetto! Sono felice di aiutarti con la tua prenotazione. Per quante persone?',
        'Eccellente! Sono felice di aiutarti con la prenotazione. Quante persone saranno?',
        'Molto bene! Sono felice di aiutarti. Per quanti commensali?',
        'Perfetto! Per quante persone hai bisogno del tavolo?',
        'Fantastico! Quante persone vengono?',
        'Ciao! Sono felice di aiutarti con la prenotazione del tavolo. Per quante persone?',
        'Benvenuto! Posso aiutarti con la prenotazione del tavolo. Per quante persone?',
        'Naturalmente! Ti aiuto volentieri a prenotare un tavolo. Per quante persone?'
      ],
      fr: [
        'Parfait! Je suis ravi de vous aider avec votre réservation. Pour combien de personnes?',
        'Excellent! Je suis heureux de vous aider avec la réservation. Combien de personnes seront-elles?',
        'Très bien! Je suis heureux de vous aider. Pour combien de convives?',
        'Parfait! Pour combien de personnes avez-vous besoin de la table?',
        'Génial! Combien de personnes viennent?',
        'Bonjour! Je serais ravi de vous aider avec votre réservation de table. Pour combien de personnes?',
        'Bienvenue! Je peux vous aider avec votre réservation de table. Pour combien de personnes?',
        'Bien sûr! Je vous aide volontiers à réserver une table. Pour combien de personnes?'
      ],
      pt: [
        'Perfeito! Estou encantado em ajudá-lo com sua reserva. Para quantas pessoas?',
        'Excelente! Estou feliz em ajudá-lo com a reserva. Quantas pessoas serão?',
        'Muito bem! Estou feliz em ajudá-lo. Para quantos comensais?',
        'Perfeito! Para quantas pessoas você precisa da mesa?',
        'Ótimo! Quantas pessoas estão vindo?',
        'Olá! Fico feliz em ajudá-lo com sua reserva de mesa. Para quantas pessoas?',
        'Bem-vindo! Posso ajudá-lo com sua reserva de mesa. Para quantas pessoas?',
        'Claro! Ajudarei você a reservar uma mesa. Para quantas pessoas?'
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
    cancellation_confirm: {
      es: [
        'Entiendo que quiere cancelar la reserva. ¿Está seguro de que desea cancelar?',
        'He entendido que no quiere continuar con la reserva. ¿Confirma que desea cancelar?',
        'Perfecto, entiendo que quiere cancelar. ¿Está completamente seguro?',
        'De acuerdo, cancelaremos la reserva. ¿Está seguro de su decisión?',
        'Entendido, no quiere hacer la reserva. ¿Confirma que desea cancelar?'
      ],
      en: [
        'I understand you want to cancel the reservation. Are you sure you want to cancel?',
        'I\'ve understood that you don\'t want to continue with the reservation. Do you confirm you want to cancel?',
        'Perfect, I understand you want to cancel. Are you completely sure?',
        'All right, we\'ll cancel the reservation. Are you sure about your decision?',
        'Understood, you don\'t want to make the reservation. Do you confirm you want to cancel?'
      ],
      de: [
        'Ich verstehe, dass Sie die Reservierung stornieren möchten. Sind Sie sicher, dass Sie stornieren möchten?',
        'Ich habe verstanden, dass Sie nicht mit der Reservierung fortfahren möchten. Bestätigen Sie, dass Sie stornieren möchten?',
        'Perfekt, ich verstehe, dass Sie stornieren möchten. Sind Sie völlig sicher?',
        'In Ordnung, wir werden die Reservierung stornieren. Sind Sie sich Ihrer Entscheidung sicher?',
        'Verstanden, Sie möchten keine Reservierung vornehmen. Bestätigen Sie, dass Sie stornieren möchten?'
      ],
      it: [
        'Capisco che vuoi cancellare la prenotazione. Sei sicuro di voler cancellare?',
        'Ho capito che non vuoi continuare con la prenotazione. Confermi di voler cancellare?',
        'Perfetto, capisco che vuoi cancellare. Sei completamente sicuro?',
        'D\'accordo, cancelleremo la prenotazione. Sei sicuro della tua decisione?',
        'Capito, non vuoi fare la prenotazione. Confermi di voler cancellare?'
      ],
      fr: [
        'Je comprends que vous voulez annuler la réservation. Êtes-vous sûr de vouloir annuler?',
        'J\'ai compris que vous ne voulez pas continuer avec la réservation. Confirmez-vous que vous voulez annuler?',
        'Parfait, je comprends que vous voulez annuler. Êtes-vous complètement sûr?',
        'D\'accord, nous annulerons la réservation. Êtes-vous sûr de votre décision?',
        'Compris, vous ne voulez pas faire de réservation. Confirmez-vous que vous voulez annuler?'
      ],
      pt: [
        'Entendo que você quer cancelar a reserva. Tem certeza de que quer cancelar?',
        'Entendi que você não quer continuar com a reserva. Confirma que quer cancelar?',
        'Perfeito, entendo que você quer cancelar. Tem certeza absoluta?',
        'Tudo bem, cancelaremos a reserva. Tem certeza da sua decisão?',
        'Entendido, você não quer fazer a reserva. Confirma que quer cancelar?'
      ]
    },
    cancellation_goodbye: {
      es: [
        'Perfecto, he cancelado su reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!',
        'Entendido, la reserva ha sido cancelada. Gracias por llamar y espero haberle sido de ayuda. Le esperamos en otra ocasión. ¡Hasta pronto!',
        'De acuerdo, he cancelado la reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!',
        'Perfecto, la reserva está cancelada. Gracias por su tiempo y espero haberle sido de ayuda. Le esperamos en otra ocasión. ¡Hasta pronto!',
        'Entendido, he cancelado la reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!'
      ],
      en: [
        'Perfect, I\'ve cancelled your reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!',
        'Understood, the reservation has been cancelled. Thank you for calling and I hope I was able to help you. We look forward to seeing you another time. See you soon!',
        'All right, I\'ve cancelled the reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!',
        'Perfect, the reservation is cancelled. Thank you for your time and I hope I was able to help you. We look forward to seeing you another time. See you soon!',
        'Understood, I\'ve cancelled the reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!'
      ],
      de: [
        'Perfekt, ich habe Ihre Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag in unserem Restaurant zu sehen. Haben Sie einen schönen Tag!',
        'Verstanden, die Reservierung wurde storniert. Vielen Dank für Ihren Anruf und ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie bei einer anderen Gelegenheit zu sehen. Bis bald!',
        'In Ordnung, ich habe die Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag in unserem Restaurant zu sehen. Haben Sie einen schönen Tag!',
        'Perfekt, die Reservierung ist storniert. Vielen Dank für Ihre Zeit und ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie bei einer anderen Gelegenheit zu sehen. Bis bald!',
        'Verstanden, ich habe die Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag in unserem Restaurant zu sehen. Haben Sie einen schönen Tag!'
      ],
      it: [
        'Perfetto, ho cancellato la tua prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!',
        'Capito, la prenotazione è stata cancellata. Grazie per aver chiamato e spero di averti aiutato. Non vediamo l\'ora di vederti un\'altra volta. A presto!',
        'D\'accordo, ho cancellato la prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!',
        'Perfetto, la prenotazione è cancellata. Grazie per il tuo tempo e spero di averti aiutato. Non vediamo l\'ora di vederti un\'altra volta. A presto!',
        'Capito, ho cancellato la prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!'
      ],
      fr: [
        'Parfait, j\'ai annulé votre réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!',
        'Compris, la réservation a été annulée. Merci d\'avoir appelé et j\'espère avoir pu vous aider. Nous avons hâte de vous voir une autre fois. À bientôt!',
        'D\'accord, j\'ai annulé la réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!',
        'Parfait, la réservation est annulée. Merci pour votre temps et j\'espère avoir pu vous aider. Nous avons hâte de vous voir une autre fois. À bientôt!',
        'Compris, j\'ai annulé la réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!'
      ],
      pt: [
        'Perfeito, cancelei sua reserva. Espero ter conseguido ajudá-lo. Esperamos vê-lo outro dia em nosso restaurante. Tenha um ótimo dia!',
        'Entendido, a reserva foi cancelada. Obrigado por ligar e espero ter conseguido ajudá-lo. Esperamos vê-lo outra vez. Até logo!',
        'Tudo bem, cancelei a reserva. Espero ter conseguido ajudá-lo. Esperamos vê-lo outro dia em nosso restaurante. Tenha um ótimo dia!',
        'Perfeito, a reserva está cancelada. Obrigado pelo seu tempo e espero ter conseguido ajudá-lo. Esperamos vê-lo outra vez. Até logo!',
      ]
    },
    complete: {
      es: [
        '¡Perfecto! Su reserva ha sido confirmada exitosamente. Gracias por elegir nuestro restaurante. ¡Esperamos darle la bienvenida pronto!',
        '¡Excelente! Su reserva está lista. Gracias por confiar en nosotros. ¡Esperamos verle pronto!',
        '¡Fantástico! Su reserva ha sido procesada correctamente. Gracias por elegir nuestro restaurante. ¡Hasta pronto!',
        '¡Perfecto! Su reserva está confirmada. Gracias por llamar y esperamos darle la bienvenida. ¡Que tenga un buen día!',
        '¡Excelente! Su reserva ha sido completada exitosamente. Gracias por elegir nuestro restaurante. ¡Esperamos verle pronto!'
      ],
      en: [
        'Perfect! Your reservation has been successfully confirmed. Thank you for choosing our restaurant. We look forward to welcoming you soon!',
        'Excellent! Your reservation is ready. Thank you for trusting us. We look forward to seeing you soon!',
        'Fantastic! Your reservation has been processed correctly. Thank you for choosing our restaurant. See you soon!',
        'Perfect! Your reservation is confirmed. Thank you for calling and we look forward to welcoming you. Have a great day!',
        'Excellent! Your reservation has been completed successfully. Thank you for choosing our restaurant. We look forward to seeing you soon!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich bestätigt. Vielen Dank, dass Sie unser Restaurant gewählt haben. Wir freuen uns darauf, Sie bald willkommen zu heißen!',
        'Ausgezeichnet! Ihre Reservierung ist bereit. Vielen Dank für Ihr Vertrauen. Wir freuen uns darauf, Sie bald zu sehen!',
        'Fantastisch! Ihre Reservierung wurde korrekt bearbeitet. Vielen Dank, dass Sie unser Restaurant gewählt haben. Bis bald!',
        'Perfekt! Ihre Reservierung ist bestätigt. Vielen Dank für Ihren Anruf und wir freuen uns darauf, Sie willkommen zu heißen. Haben Sie einen schönen Tag!',
        'Ausgezeichnet! Ihre Reservierung wurde erfolgreich abgeschlossen. Vielen Dank, dass Sie unser Restaurant gewählt haben. Wir freuen uns darauf, Sie bald zu sehen!'
      ],
      it: [
        'Perfetto! La tua prenotazione è stata confermata con successo. Grazie per aver scelto il nostro ristorante. Non vediamo l\'ora di darti il benvenuto presto!',
        'Eccellente! La tua prenotazione è pronta. Grazie per averci fidato. Non vediamo l\'ora di vederti presto!',
        'Fantastico! La tua prenotazione è stata elaborata correttamente. Grazie per aver scelto il nostro ristorante. A presto!',
        'Perfetto! La tua prenotazione è confermata. Grazie per aver chiamato e non vediamo l\'ora di darti il benvenuto. Buona giornata!',
        'Eccellente! La tua prenotazione è stata completata con successo. Grazie per aver scelto il nostro ristorante. Non vediamo l\'ora di vederti presto!'
      ],
      fr: [
        'Parfait! Votre réservation a été confirmée avec succès. Merci d\'avoir choisi notre restaurant. Nous avons hâte de vous accueillir bientôt!',
        'Excellent! Votre réservation est prête. Merci de nous faire confiance. Nous avons hâte de vous voir bientôt!',
        'Fantastique! Votre réservation a été traitée correctement. Merci d\'avoir choisi notre restaurant. À bientôt!',
        'Parfait! Votre réservation est confirmée. Merci d\'avoir appelé et nous avons hâte de vous accueillir. Passez une bonne journée!',
        'Excellent! Votre réservation a été complétée avec succès. Merci d\'avoir choisi notre restaurant. Nous avons hâte de vous voir bientôt!'
      ],
      pt: [
        'Perfeito! Sua reserva foi confirmada com sucesso. Obrigado por escolher nosso restaurante. Esperamos recebê-lo em breve!',
        'Excelente! Sua reserva está pronta. Obrigado por confiar em nós. Esperamos vê-lo em breve!',
        'Fantástico! Sua reserva foi processada corretamente. Obrigado por escolher nosso restaurante. Até logo!',
        'Perfeito! Sua reserva está confirmada. Obrigado por ligar e esperamos recebê-lo. Tenha um ótimo dia!',
        'Excelente! Sua reserva foi concluída com sucesso. Obrigado por escolher nosso restaurante. Esperamos vê-lo em breve!'
      ]
    },
    cancellation_continue: {
      es: [
        'Perfecto, continuemos con su reserva entonces. ¿Para cuántas personas?',
        'Excelente, sigamos con la reserva. ¿Cuántas personas serán?',
        'Muy bien, continuemos. ¿Para cuántos comensales?',
        'Perfecto, sigamos adelante. ¿Cuántas personas necesitan mesa?',
        'Genial, continuemos con la reserva. ¿Para cuántas personas?'
      ],
      en: [
        'Perfect, let\'s continue with your reservation then. For how many people?',
        'Excellent, let\'s continue with the reservation. How many people will it be?',
        'Great, let\'s continue. For how many diners?',
        'Perfect, let\'s go ahead. How many people need a table?',
        'Great, let\'s continue with the reservation. For how many people?'
      ],
      de: [
        'Perfekt, lassen Sie uns dann mit Ihrer Reservierung fortfahren. Für wie viele Personen?',
        'Ausgezeichnet, lassen Sie uns mit der Reservierung fortfahren. Wie viele Personen werden es sein?',
        'Sehr gut, lassen Sie uns fortfahren. Für wie viele Gäste?',
        'Perfekt, lassen Sie uns weitermachen. Wie viele Personen benötigen einen Tisch?',
        'Großartig, lassen Sie uns mit der Reservierung fortfahren. Für wie viele Personen?'
      ],
      it: [
        'Perfetto, continuiamo con la tua prenotazione allora. Per quante persone?',
        'Eccellente, continuiamo con la prenotazione. Quante persone saranno?',
        'Molto bene, continuiamo. Per quanti commensali?',
        'Perfetto, andiamo avanti. Quante persone hanno bisogno di un tavolo?',
        'Fantastico, continuiamo con la prenotazione. Per quante persone?'
      ],
      fr: [
        'Parfait, continuons avec votre réservation alors. Pour combien de personnes?',
        'Excellent, continuons avec la réservation. Combien de personnes seront-ce?',
        'Très bien, continuons. Pour combien de convives?',
        'Parfait, continuons. Combien de personnes ont besoin d\'une table?',
        'Génial, continuons avec la réservation. Pour combien de personnes?'
      ],
      pt: [
        'Perfeito, vamos continuar com sua reserva então. Para quantas pessoas?',
        'Excelente, vamos continuar com a reserva. Quantas pessoas serão?',
        'Muito bem, vamos continuar. Para quantos comensais?',
        'Perfeito, vamos em frente. Quantas pessoas precisam de uma mesa?',
        'Ótimo, vamos continuar com a reserva. Para quantas pessoas?'
      ]
    },
    cancellation_unclear: {
      es: [
        'No he entendido bien su respuesta. ¿Quiere cancelar la reserva o continuar?',
        'Disculpe, no entendí claramente. ¿Desea cancelar o seguir con la reserva?',
        'No estoy seguro de lo que quiere hacer. ¿Cancela la reserva o continúa?',
        'Perdón, no entendí. ¿Quiere cancelar o seguir adelante?',
        'No he captado bien su intención. ¿Cancela o continúa con la reserva?'
      ],
      en: [
        'I didn\'t understand your response well. Do you want to cancel the reservation or continue?',
        'Sorry, I didn\'t understand clearly. Do you want to cancel or continue with the reservation?',
        'I\'m not sure what you want to do. Do you cancel the reservation or continue?',
        'Sorry, I didn\'t understand. Do you want to cancel or go ahead?',
        'I didn\'t catch your intention well. Do you cancel or continue with the reservation?'
      ],
      de: [
        'Ich habe Ihre Antwort nicht gut verstanden. Möchten Sie die Reservierung stornieren oder fortfahren?',
        'Entschuldigung, ich habe nicht klar verstanden. Möchten Sie stornieren oder mit der Reservierung fortfahren?',
        'Ich bin mir nicht sicher, was Sie tun möchten. Stornieren Sie die Reservierung oder fahren Sie fort?',
        'Entschuldigung, ich habe nicht verstanden. Möchten Sie stornieren oder weitermachen?',
        'Ich habe Ihre Absicht nicht gut erfasst. Stornieren Sie oder fahren Sie mit der Reservierung fort?'
      ],
      it: [
        'Non ho capito bene la tua risposta. Vuoi cancellare la prenotazione o continuare?',
        'Scusa, non ho capito chiaramente. Vuoi cancellare o continuare con la prenotazione?',
        'Non sono sicuro di cosa vuoi fare. Cancelli la prenotazione o continui?',
        'Scusa, non ho capito. Vuoi cancellare o andare avanti?',
        'Non ho colto bene la tua intenzione. Cancelli o continui con la prenotazione?'
      ],
      fr: [
        'Je n\'ai pas bien compris votre réponse. Voulez-vous annuler la réservation ou continuer?',
        'Désolé, je n\'ai pas compris clairement. Voulez-vous annuler ou continuer avec la réservation?',
        'Je ne suis pas sûr de ce que vous voulez faire. Annulez-vous la réservation ou continuez-vous?',
        'Désolé, je n\'ai pas compris. Voulez-vous annuler ou continuer?',
        'Je n\'ai pas bien saisi votre intention. Annulez-vous ou continuez-vous avec la réservation?'
      ],
      pt: [
        'Não entendi bem sua resposta. Quer cancelar a reserva ou continuar?',
        'Desculpe, não entendi claramente. Quer cancelar ou continuar com a reserva?',
        'Não tenho certeza do que você quer fazer. Cancela a reserva ou continua?',
        'Desculpe, não entendi. Quer cancelar ou seguir em frente?',
        'Não captei bem sua intenção. Cancela ou continua com a reserva?'
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

  // Verificar que el tipo de mensaje existe
  if (!messages[type]) {
    console.log(`⚠️ Tipo de mensaje no encontrado: ${type}`);
    return ['Disculpe, no tengo esa respuesta disponible.'];
  }
  
  // Verificar que el idioma existe para este tipo
  if (!messages[type][language]) {
    console.log(`⚠️ Idioma ${language} no encontrado para tipo ${type}, usando español`);
    return messages[type]['es'] || ['Disculpe, no tengo esa respuesta disponible.'];
  }
  
  console.log(`✅ Usando mensajes en ${language} para tipo ${type}`);
  return messages[type][language];
}

// Detección mejorada de idioma
function detectLanguage(text) {
  // Normalizar texto para mejor detección
  const normalizedText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remover puntuación
    .replace(/\s+/g, ' ') // Normalizar espacios
    .trim();
  
  console.log(`🔍 [DEBUG] Texto normalizado: "${normalizedText}"`);
  
  const languagePatterns = {
    en: [
      'hello', 'hi', 'good morning', 'good afternoon', 'good evening', 'good night',
      'book', 'booking', 'reservation', 'table', 'tables', 'restaurant',
      'want', 'need', 'would like', 'looking for', 'seeking', 'require',
      'book a table', 'make a reservation', 'table reservation', 'reserve a table',
      'for dinner', 'for lunch', 'for breakfast', 'to eat', 'to dine',
      'yes', 'okay', 'ok', 'sure', 'good', 'perfect', 'great', 'fine',
      'continue', 'proceed', 'accept', 'confirm', 'agreed',
      // Expresiones más naturales y comunes en inglés
      'i would like to book', 'i want to book', 'i need to book', 'i would like to make a reservation',
      'i want to make a reservation', 'i need to make a reservation', 'i would like to reserve',
      'i want to reserve', 'i need to reserve', 'i would like to reserve a table',
      'i want to reserve a table', 'i need to reserve a table', 'i would like to book a table',
      'i want to book a table', 'i need to book a table', 'i would like to get a table',
      'i want to get a table', 'i need to get a table', 'i would like to find a table',
      'i want to find a table', 'i need to find a table', 'i would like to have a table',
      'i want to have a table', 'i need to have a table', 'i would like to get a reservation',
      'i want to get a reservation', 'i need to get a reservation', 'i would like to make a booking',
      'i want to make a booking', 'i need to make a booking', 'i would like to book',
      'i want to book', 'i need to book', 'i would like to reserve',
      'i want to reserve', 'i need to reserve', 'i would like to make a reservation',
      'i want to make a reservation', 'i need to make a reservation',
      'for today', 'for tomorrow', 'for the day after tomorrow', 'for this week',
      'for next week', 'for the weekend', 'for saturday', 'for sunday', 'for monday',
      'for tuesday', 'for wednesday', 'for thursday', 'for friday', 'today', 'tomorrow',
      'the day after tomorrow', 'this week', 'next week', 'the weekend', 'saturday',
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'with my family', 'with my friends', 'with my colleagues', 'with my partner',
      'with my kids', 'with my parents', 'with my siblings', 'with my children',
      'family', 'friends', 'colleagues', 'partner', 'kids', 'children', 'parents',
      'siblings', 'relatives', 'guests', 'diners', 'people', 'folks',
      'for dinner', 'for lunch', 'for breakfast', 'for brunch', 'for drinks',
      'for coffee', 'for tea', 'for wine', 'for cocktails', 'for celebration',
      'for party', 'for anniversary', 'for birthday', 'for graduation', 'for promotion',
      'for farewell', 'for welcome', 'for meeting', 'for gathering', 'for date',
      'for appointment', 'for event', 'for celebration', 'for party', 'for family dinner',
      'for business dinner', 'for team dinner', 'for department dinner',
      'for group dinner', 'for friends dinner', 'for family gathering',
      'dining', 'eating', 'having dinner', 'having lunch', 'having breakfast',
      'having brunch', 'having drinks', 'having coffee', 'having tea', 'having wine',
      'having cocktails', 'celebrating', 'partying', 'meeting', 'gathering',
      'enjoying', 'enjoying dinner', 'enjoying lunch', 'enjoying breakfast',
      'enjoying brunch', 'enjoying drinks', 'enjoying coffee', 'enjoying tea',
      'enjoying wine', 'enjoying cocktails', 'enjoying celebration', 'enjoying party',
      'enjoying meeting', 'enjoying gathering', 'enjoying event',
      'tonight', 'this evening', 'this afternoon', 'this morning', 'tomorrow night',
      'tomorrow evening', 'tomorrow afternoon', 'tomorrow morning',
      'the day after tomorrow night', 'the day after tomorrow evening',
      'the day after tomorrow afternoon', 'the day after tomorrow morning',
      'saturday night', 'saturday evening', 'saturday afternoon', 'saturday morning',
      'sunday night', 'sunday evening', 'sunday afternoon', 'sunday morning',
      'monday night', 'monday evening', 'monday afternoon', 'monday morning',
      'tuesday night', 'tuesday evening', 'tuesday afternoon', 'tuesday morning',
      'wednesday night', 'wednesday evening', 'wednesday afternoon', 'wednesday morning',
      'thursday night', 'thursday evening', 'thursday afternoon', 'thursday morning',
      'friday night', 'friday evening', 'friday afternoon', 'friday morning',
      'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'good', 'perfect', 'great', 'fine',
      'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
      'go ahead', 'move forward', 'keep going', 'carry on',
      'approve', 'endorse', 'support', 'back',
      'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
      'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
      'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
      'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
      'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
      'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
      'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
      'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
      'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
      'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
      'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
      'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
      'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
      'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
      'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
      'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
      'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
      'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
      'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
      'i think the idea is brilliant', 'i think the idea is superb'
    ],
    de: [
      'hallo', 'guten tag', 'guten morgen', 'guten abend', 'gute nacht',
      'reservierung', 'reservieren', 'tisch', 'tische', 'restaurant',
      'möchte', 'brauche', 'würde gerne', 'suche', 'benötige', 'verlange',
      'tisch reservieren', 'reservierung machen', 'tisch buchen', 'tisch reservieren für',
      'zum essen', 'zum abendessen', 'zum mittagessen', 'zum frühstück',
      'ja', 'gut', 'perfekt', 'okay', 'klar', 'natürlich', 'gerne',
      'fortfahren', 'fortsetzen', 'akzeptieren', 'bestätigen', 'einverstanden',
      'ich möchte', 'ich brauche', 'ich würde gerne', 'ich suche',
      // Palabras muy específicas del alemán
      'bitte', 'danke', 'entschuldigung', 'verzeihung', 'wie', 'was', 'wo',
      'heute', 'morgen', 'abend', 'nacht', 'zeit', 'uhr', 'stunde',
      'personen', 'leute', 'gäste', 'familie', 'freunde',
      // Expresiones más naturales y comunes en alemán
      'ich hätte gerne', 'ich würde gerne', 'könnte ich', 'darf ich',
      'eine reservierung', 'einen tisch', 'einen platz', 'einen sitzplatz',
      'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
      'zum essen gehen', 'ausgehen', 'restaurant besuchen',
      'mit freunden', 'mit der familie', 'mit kollegen',
      'bestätigen', 'bestätigung', 'korrekt', 'richtig', 'stimmt',
      'ändern', 'korrigieren', 'modifizieren', 'anpassen',
      'abbrechen', 'stornieren', 'löschen', 'entfernen',
      'wiederholen', 'nochmal', 'erneut', 'von vorne',
      'telefonnummer', 'handynummer', 'mobilnummer', 'nummer',
      'diese nummer', 'gleiche nummer', 'selbe nummer', 'dieselbe nummer',
      'andere nummer', 'neue nummer', 'andere telefonnummer',
      'name', 'nachname', 'vorname', 'vollständiger name',
      'mein name ist', 'ich heiße', 'ich bin', 'ich bin der',
      'wie viele', 'wieviele', 'anzahl', 'personenzahl',
      'für wie viele', 'für wieviele', 'für wie viele personen',
      'datum', 'tag', 'wann', 'an welchem tag', 'welcher tag',
      'uhrzeit', 'zeitpunkt', 'um wieviel uhr', 'um welche uhrzeit',
      'früh', 'spät', 'mittag', 'nachmittag', 'abend', 'nacht'
    ],
    it: [
      'ciao', 'buongiorno', 'buonasera', 'buonanotte', 'salve',
      'prenotazione', 'prenotare', 'tavolo', 'tavoli', 'ristorante',
      'vorrei', 'ho bisogno', 'cerco', 'necessito', 'desidero', 'voglio',
      'prenotare tavolo', 'fare prenotazione', 'prenotazione tavolo', 'prenotare un tavolo',
      'per mangiare', 'per cenare', 'per pranzo', 'per colazione',
      'sì', 'va bene', 'perfetto', 'okay', 'chiaro', 'naturalmente', 'volentieri',
      'continuare', 'procedere', 'accettare', 'confermare', 'd\'accordo',
      'mi chiamo', 'come ti chiami', 'il mio nome',
      // Palabras muy específicas del italiano
      'per favore', 'grazie', 'scusi', 'scusa', 'come', 'cosa', 'dove',
      'oggi', 'domani', 'sera', 'notte', 'tempo', 'ora', 'ore',
      'persone', 'gente', 'ospiti', 'famiglia', 'amici',
      // Patrones de transcripción incorrecta comunes
      'chau', 'ciao', 'borrey', 'vorrei', 'pre', 'notar', 'prenotare',
      'tavolo', 'tavoli', 'ristorante', 'mangiare', 'cenare'
    ],
    fr: [
      'bonjour', 'bonsoir', 'bonne nuit', 'salut', 'bonne journée',
      'réservation', 'réserver', 'table', 'tables', 'restaurant',
      'je voudrais', 'j\'ai besoin', 'je cherche', 'je nécessite', 'je désire', 'je veux',
      'réserver table', 'faire réservation', 'réservation table', 'réserver une table',
      'pour manger', 'pour dîner', 'pour déjeuner', 'pour petit-déjeuner',
      'oui', 'd\'accord', 'parfait', 'okay', 'clair', 'naturellement', 'volontiers',
      'continuer', 'procéder', 'accepter', 'confirmer', 'd\'accord',
      'je m\'appelle', 'comment vous appelez-vous', 'mon nom'
    ],
    pt: [
      'olá', 'bom dia', 'boa tarde', 'boa noite', 'oi',
      'reserva', 'reservar', 'mesa', 'mesas', 'restaurante',
      'quero', 'preciso', 'gostaria', 'busco', 'necessito', 'desejo',
      'fazer reserva', 'reservar mesa', 'reserva mesa', 'reservar uma mesa',
      'para comer', 'para jantar', 'para almoçar', 'para café da manhã',
      'sim', 'bom', 'perfeito', 'okay', 'claro', 'naturalmente', 'com prazer',
      'continuar', 'proceder', 'aceitar', 'confirmar', 'concordo',
      'meu nome', 'como você se chama', 'me chamo'
    ],
    es: [
      'hola', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos',
      'reserva', 'reservar', 'mesa', 'mesas', 'restaurante',
      'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'busco',
      'hacer una reserva', 'reservar mesa', 'reservar una mesa', 'hacer reserva',
      'para comer', 'para cenar', 'para almorzar', 'para desayunar',
      'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto',
      'adelante', 'continúo', 'procedo', 'acepto', 'confirmo',
      'me llamo', 'como te llamas', 'mi nombre',
      // Expresiones más naturales y comunes en español
      'me gustaría reservar', 'quisiera reservar', 'deseo reservar', 'quiero reservar',
      'necesito reservar', 'busco reservar', 'quiero hacer una reserva',
      'necesito hacer una reserva', 'me gustaría hacer una reserva',
      'quisiera hacer una reserva', 'deseo hacer una reserva',
      'quiero reservar mesa', 'necesito reservar mesa', 'me gustaría reservar mesa',
      'quisiera reservar mesa', 'deseo reservar mesa', 'busco reservar mesa',
      'quiero mesa', 'necesito mesa', 'me gustaría mesa', 'quisiera mesa',
      'deseo mesa', 'busco mesa', 'quiero una mesa', 'necesito una mesa',
      'me gustaría una mesa', 'quisiera una mesa', 'deseo una mesa', 'busco una mesa',
      'para hoy', 'para mañana', 'para pasado mañana', 'para esta semana',
      'para la próxima semana', 'para el fin de semana', 'para el sábado',
      'para el domingo', 'para el lunes', 'para el martes', 'para el miércoles',
      'para el jueves', 'para el viernes', 'hoy', 'mañana', 'pasado mañana',
      'esta semana', 'la próxima semana', 'el fin de semana', 'el sábado',
      'el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes',
      'con mi familia', 'con mis amigos', 'con mis compañeros', 'con mi pareja',
      'con mis hijos', 'con mis padres', 'con mis hermanos', 'con mis hermanas',
      'familia', 'amigos', 'compañeros', 'pareja', 'hijos', 'padres', 'hermanos',
      'hermanas', 'familiares', 'invitados', 'comensales', 'personas', 'gente',
      'para comer', 'para cenar', 'para almorzar', 'para desayunar', 'para merendar',
      'para tomar algo', 'para tomar café', 'para tomar té', 'para tomar vino',
      'para celebrar', 'para festejar', 'para conmemorar', 'para recordar',
      'cumpleaños', 'aniversario', 'boda', 'graduación', 'promoción', 'ascenso',
      'despedida', 'bienvenida', 'reunión', 'encuentro', 'cita', 'compromiso',
      'evento', 'celebración', 'fiesta', 'reunión familiar', 'reunión de trabajo',
      'comida de empresa', 'comida de equipo', 'comida de departamento',
      'comida de grupo', 'comida de amigos', 'comida de familia',
      'cenar', 'almorzar', 'desayunar', 'merendar', 'tomar algo', 'tomar café',
      'tomar té', 'tomar vino', 'comer', 'disfrutar', 'disfrutar de la comida',
      'disfrutar de la cena', 'disfrutar del almuerzo', 'disfrutar del desayuno',
      'disfrutar de la merienda', 'disfrutar de la bebida', 'disfrutar del café',
      'disfrutar del té', 'disfrutar del vino', 'disfrutar de la celebración',
      'disfrutar de la fiesta', 'disfrutar de la reunión', 'disfrutar del evento'
    ]
  };

  let maxMatches = 0;
  let detectedLanguage = 'es'; // Por defecto español

  console.log(`🔍 Detectando idioma para: "${text}"`);

  for (const [lang, patterns] of Object.entries(languagePatterns)) {
    const matches = patterns.filter(pattern => normalizedText.includes(pattern)).length;
    console.log(`  ${lang}: ${matches} coincidencias`);
    
    if (matches > maxMatches) {
      maxMatches = matches;
      detectedLanguage = lang;
    }
  }

  // Detección especial para transcripciones malas de italiano
  if (normalizedText.includes('chau') || normalizedText.includes('borrey') || 
      normalizedText.includes('pre') || normalizedText.includes('notar')) {
    console.log(`🇮🇹 [DEBUG] Detectado patrón de transcripción italiana incorrecta`);
    if (detectedLanguage === 'es' && maxMatches === 0) {
      detectedLanguage = 'it';
      maxMatches = 1;
    }
  }

  console.log(`✅ Idioma detectado: ${detectedLanguage} (${maxMatches} coincidencias)`);
  return detectedLanguage;
}

function handleConfirmationResponse(text) {
  // Palabras de confirmación positiva - MULTILINGÜE
  const positiveWords = [
    // Español
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo',
    'excelente', 'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico',
    'espléndido', 'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional',
    'espectacular', 'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente',
    'me parece genial', 'me parece fantástico', 'me parece maravilloso', 'me parece estupendo',
    'me parece magnífico', 'me parece espléndido', 'me parece formidable', 'me parece increíble',
    'me parece asombroso', 'me parece fenomenal', 'me parece sensacional', 'me parece espectacular',
    'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea', 'me parece excelente la idea',
    'me parece genial la idea', 'me parece fantástica la idea', 'me parece maravillosa la idea',
    'me parece estupenda la idea', 'me parece magnífica la idea', 'me parece espléndida la idea',
    'me parece formidable la idea', 'me parece increíble la idea', 'me parece asombrosa la idea',
    'me parece fenomenal la idea', 'me parece sensacional la idea', 'me parece espectacular la idea',
    'perfecto', 'excelente', 'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico',
    'espléndido', 'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional', 'espectacular',
    'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente', 'me parece genial',
    'me parece fantástico', 'me parece maravilloso', 'me parece estupendo', 'me parece magnífico',
    'me parece espléndido', 'me parece formidable', 'me parece increíble', 'me parece asombroso',
    'me parece fenomenal', 'me parece sensacional', 'me parece espectacular', 'me encanta la idea',
    'me gusta la idea', 'me parece perfecta la idea', 'me parece excelente la idea', 'me parece genial la idea',
    'me parece fantástica la idea', 'me parece maravillosa la idea', 'me parece estupenda la idea',
    'me parece magnífica la idea', 'me parece espléndida la idea', 'me parece formidable la idea',
    'me parece increíble la idea', 'me parece asombrosa la idea', 'me parece fenomenal la idea',
    'me parece sensacional la idea', 'me parece espectacular la idea',
    // Inglés
    'yes', 'yeah', 'yep', 'correct', 'confirm', 'perfect', 'good', 'okay', 'ok', 'sure',
    'exactly', 'that\'s right', 'that\'s correct', 'sounds good', 'agree',
    'confirmed', 'accept', 'proceed', 'go ahead',
    'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
    'continue', 'proceed', 'go ahead', 'move forward', 'keep going', 'carry on',
    'accept', 'confirm', 'agree', 'approve', 'endorse', 'support', 'back',
    'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'ja', 'richtig', 'bestätigen', 'perfekt', 'gut', 'okay', 'genau',
    'das stimmt', 'einverstanden', 'bestätigt', 'akzeptieren',
    'korrekt', 'stimmt', 'genau richtig', 'absolut richtig', 'völlig richtig',
    'das ist richtig', 'das stimmt', 'das ist korrekt', 'das ist richtig',
    'ja genau', 'ja richtig', 'ja korrekt', 'ja stimmt', 'ja perfekt',
    'ausgezeichnet', 'wunderbar', 'prima', 'super', 'toll', 'fantastisch',
    'einverstanden', 'zustimmen', 'befürworten', 'unterstützen',
    'bestätigen', 'bestätigung', 'bestätigt', 'bestätige ich',
    'ich bestätige', 'ich bestätige das', 'ich bestätige gerne',
    'gerne', 'sehr gerne', 'sehr gern', 'mit freuden', 'mit vergnügen',
    'selbstverständlich', 'natürlich', 'klar', 'logisch', 'verständlich',
    'das passt', 'das gefällt mir', 'das ist gut', 'das ist perfekt',
    'so ist es richtig', 'so stimmt es', 'so ist es korrekt',
    'alles richtig', 'alles korrekt', 'alles stimmt', 'alles perfekt',
    'ich bin einverstanden', 'ich stimme zu', 'ich akzeptiere',
    'ich nehme an', 'ich befürworte', 'ich unterstütze',
    'fortfahren', 'fortsetzen', 'weiter', 'weitergehen', 'procedieren',
    'los gehts', 'los geht es', 'auf gehts', 'auf geht es',
    'machen wir', 'machen wir es', 'lassen wir es so',
    'so bleibt es', 'so lassen wir es', 'so ist es gut',
    'das reicht', 'das genügt', 'das ist ausreichend',
    'mehr brauche ich nicht', 'mehr will ich nicht', 'mehr ist nicht nötig',
    'fertig', 'abgeschlossen', 'erledigt', 'vollständig',
    'komplett', 'ganz', 'total', 'völlig', 'absolut',
    // Italiano
    'sì', 'si', 'corretto', 'confermo', 'perfetto', 'bene', 'okay', 'ok', 'esatto',
    'va bene', 'd\'accordo', 'confermato', 'accetto', 'giusto', 'esatto',
    'perfetto', 'ottimo', 'eccellente', 'fantastico', 'grande', 'bravo',
    'confermo', 'accetto', 'procedo', 'continua', 'avanti', 'procedi',
    'tutto bene', 'tutto ok', 'tutto perfetto', 'va tutto bene',
    'questo numero', 'questo telefono', 'stesso numero', 'stesso telefono',
    'conferma', 'confermare', 'accettare', 'procedere',
    // Francés
    'oui', 'correct', 'confirmer', 'parfait', 'bien', 'd\'accord',
    'exactement', 'c\'est correct', 'confirmé', 'accepter',
    // Portugués
    'sim', 'correto', 'confirmo', 'perfeito', 'bem', 'okay', 'exato',
    'está bem', 'concordo', 'confirmado', 'aceito'
  ];
  
  // Palabras de negación - MULTILINGÜE
  const negativeWords = [
    // Español
    'no', 'incorrecto', 'mal', 'error', 'cambiar', 'modificar', 'corregir',
    'no es', 'no está bien', 'no me parece', 'discrepo', 'no acepto',
    // Inglés
    'no', 'incorrect', 'wrong', 'error', 'change', 'modify', 'correct',
    'not right', 'not correct', 'disagree', 'don\'t accept',
    // Alemán
    'nein', 'falsch', 'fehler', 'ändern', 'korrigieren', 'nicht richtig',
    'das stimmt nicht', 'das ist falsch', 'das ist nicht richtig',
    'das ist nicht korrekt', 'das ist nicht richtig', 'das ist nicht stimmt',
    'nicht korrekt', 'nicht richtig', 'nicht stimmt', 'nicht richtig',
    'falsch', 'fehlerhaft', 'inkorrekt', 'unrichtig', 'unstimmt',
    'ändern', 'korrigieren', 'modifizieren', 'anpassen', 'verbessern',
    'korrektur', 'berichtigung', 'änderung', 'modifikation', 'anpassung',
    'ich möchte ändern', 'ich möchte korrigieren', 'ich möchte modifizieren',
    'ich möchte anpassen', 'ich möchte verbessern', 'ich möchte berichtigen',
    'das muss geändert werden', 'das muss korrigiert werden',
    'das muss modifiziert werden', 'das muss angepasst werden',
    'das ist nicht das was ich wollte', 'das ist nicht was ich wollte',
    'das ist nicht richtig', 'das ist nicht korrekt', 'das ist nicht stimmt',
    'nicht das', 'nicht so', 'nicht richtig', 'nicht korrekt',
    'anders', 'differenz', 'unterschiedlich', 'verschieden', 'abweichend',
    'nicht gewünscht', 'nicht erwünscht', 'nicht gewollt', 'nicht gewünscht',
    'abbrechen', 'stornieren', 'löschen', 'entfernen', 'aufheben',
    'nicht mehr', 'nicht weiter', 'nicht fortfahren', 'nicht fortsetzen',
    'stopp', 'halt', 'aufhören', 'beenden', 'terminieren',
    // Italiano
    'no', 'sbagliato', 'errore', 'cambiare', 'correggere', 'non è giusto',
    'sbagliato', 'errato', 'non corretto', 'non va bene', 'non mi piace',
    'cambiare', 'modificare', 'correggere', 'altro', 'diverso', 'nuovo',
    'non accetto', 'non confermo', 'non va', 'non è corretto',
    'altro numero', 'numero diverso', 'numero nuovo', 'telefono diverso',
    // Francés
    'non', 'incorrect', 'faux', 'erreur', 'changer', 'corriger', 'pas correct',
    // Portugués
    'não', 'incorreto', 'errado', 'erro', 'mudar', 'corrigir', 'não está certo'
  ];
  
  // Palabras para reiniciar - MULTILINGÜE
  const restartWords = [
    // Español
    'empezar de nuevo', 'volver a empezar', 'reiniciar', 'otra vez', 'de nuevo',
    'cambiar todo', 'empezamos otra vez', 'resetear',
    // Inglés
    'start over', 'start again', 'restart', 'again', 'new', 'change everything',
    'begin again', 'reset',
    // Alemán
    'von vorne anfangen', 'neu beginnen', 'nochmal', 'alles ändern',
    'neu starten', 'restart', 'reset', 'zurücksetzen', 'rücksetzen',
    'von vorne', 'noch einmal', 'erneut', 'wieder', 'nochmal',
    'alles neu', 'alles von vorne', 'komplett neu', 'total neu',
    'ganz neu', 'völlig neu', 'absolut neu', 'komplett von vorne',
    'alles ändern', 'alles modifizieren', 'alles korrigieren',
    'alles anpassen', 'alles verbessern', 'alles berichtigen',
    'neu machen', 'nochmal machen', 'wieder machen', 'erneut machen',
    'von vorne machen', 'neu starten', 'nochmal starten',
    'wieder starten', 'erneut starten', 'von vorne starten',
    'neu beginnen', 'nochmal beginnen', 'wieder beginnen',
    'erneut beginnen', 'von vorne beginnen', 'neu anfangen',
    'nochmal anfangen', 'wieder anfangen', 'erneut anfangen',
    'von vorne anfangen', 'neu', 'nochmal', 'wieder', 'erneut',
    'von vorne', 'komplett', 'ganz', 'total', 'völlig', 'absolut',
    'alles', 'komplett alles', 'ganz alles', 'total alles',
    'völlig alles', 'absolut alles', 'alles komplett', 'alles ganz',
    'alles total', 'alles völlig', 'alles absolut',
    // Italiano
    'ricominciare', 'iniziare di nuovo', 'ancora', 'cambiare tutto',
    // Francés
    'recommencer', 'nouveau', 'changer tout', 'encore',
    // Portugués
    'começar de novo', 'novamente', 'mudar tudo', 'reiniciar'
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
  // Palabras de reserva directa - EXPANDIDAS MULTILINGÜE
  const directReservationWords = [
    // Español
    'reservar', 'reserva', 'mesa', 'quiero reservar', 'necesito reservar', 
    'me gustaría reservar', 'quisiera reservar', 'deseo reservar', 
    'hacer una reserva', 'reservar mesa', 'quiero mesa',
    'quiero hacer una reserva', 'necesito hacer una reserva', 'me gustaría hacer una reserva',
    'quisiera hacer una reserva', 'deseo hacer una reserva', 'busco hacer una reserva',
    'quiero reservar mesa', 'necesito reservar mesa', 'me gustaría reservar mesa',
    'quisiera reservar mesa', 'deseo reservar mesa', 'busco reservar mesa',
    'quiero mesa', 'necesito mesa', 'me gustaría mesa', 'quisiera mesa',
    'deseo mesa', 'busco mesa', 'quiero una mesa', 'necesito una mesa',
    'me gustaría una mesa', 'quisiera una mesa', 'deseo una mesa', 'busco una mesa',
    'para comer', 'para cenar', 'para almorzar', 'para desayunar', 'para merendar',
    'para tomar algo', 'para tomar café', 'para tomar té', 'para tomar vino',
    'para celebrar', 'para festejar', 'para conmemorar', 'para recordar',
    'cumpleaños', 'aniversario', 'boda', 'graduación', 'promoción', 'ascenso',
    'despedida', 'bienvenida', 'reunión', 'encuentro', 'cita', 'compromiso',
    'evento', 'celebración', 'fiesta', 'reunión familiar', 'reunión de trabajo',
    'comida de empresa', 'comida de equipo', 'comida de departamento',
    'comida de grupo', 'comida de amigos', 'comida de familia',
    'cenar', 'almorzar', 'desayunar', 'merendar', 'tomar algo', 'tomar café',
    'tomar té', 'tomar vino', 'comer', 'disfrutar', 'disfrutar de la comida',
    'disfrutar de la cena', 'disfrutar del almuerzo', 'disfrutar del desayuno',
    'disfrutar de la merienda', 'disfrutar de la bebida', 'disfrutar del café',
    'disfrutar del té', 'disfrutar del vino', 'disfrutar de la celebración',
    'disfrutar de la fiesta', 'disfrutar de la reunión', 'disfrutar del evento',
    'con mi familia', 'con mis amigos', 'con mis compañeros', 'con mi pareja',
    'con mis hijos', 'con mis padres', 'con mis hermanos', 'con mis hermanas',
    'familia', 'amigos', 'compañeros', 'pareja', 'hijos', 'padres', 'hermanos',
    'hermanas', 'familiares', 'invitados', 'comensales', 'personas', 'gente',
    'para hoy', 'para mañana', 'para pasado mañana', 'para esta semana',
    'para la próxima semana', 'para el fin de semana', 'para el sábado',
    'para el domingo', 'para el lunes', 'para el martes', 'para el miércoles',
    'para el jueves', 'para el viernes', 'hoy', 'mañana', 'pasado mañana',
    'esta semana', 'la próxima semana', 'el fin de semana', 'el sábado',
    'el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes',
    'esta noche', 'esta tarde', 'esta mañana', 'mañana por la noche',
    'mañana por la tarde', 'mañana por la mañana', 'pasado mañana por la noche',
    'pasado mañana por la tarde', 'pasado mañana por la mañana',
    'el sábado por la noche', 'el sábado por la tarde', 'el sábado por la mañana',
    'el domingo por la noche', 'el domingo por la tarde', 'el domingo por la mañana',
    'el lunes por la noche', 'el lunes por la tarde', 'el lunes por la mañana',
    'el martes por la noche', 'el martes por la tarde', 'el martes por la mañana',
    'el miércoles por la noche', 'el miércoles por la tarde', 'el miércoles por la mañana',
    'el jueves por la noche', 'el jueves por la tarde', 'el jueves por la mañana',
    'el viernes por la noche', 'el viernes por la tarde', 'el viernes por la mañana',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto', 'naturalmente',
    'adelante', 'continúo', 'procedo', 'acepto', 'confirmo', 'está bien', 'me parece bien',
    'de acuerdo', 'perfecto', 'excelente', 'genial', 'fantástico', 'maravilloso',
    'estupendo', 'magnífico', 'espléndido', 'formidable', 'increíble', 'asombroso',
    // Inglés
    'book', 'booking', 'table reservation', 'reserve', 'reservation',
    'book a table', 'make a reservation', 'table booking',
    'i would like to book', 'i want to book', 'i need to book', 'i would like to make a reservation',
    'i want to make a reservation', 'i need to make a reservation', 'i would like to reserve',
    'i want to reserve', 'i need to reserve', 'i would like to reserve a table',
    'i want to reserve a table', 'i need to reserve a table', 'i would like to book a table',
    'i want to book a table', 'i need to book a table', 'i would like to get a table',
    'i want to get a table', 'i need to get a table', 'i would like to find a table',
    'i want to find a table', 'i need to find a table', 'i would like to have a table',
    'i want to have a table', 'i need to have a table', 'i would like to get a reservation',
    'i want to get a reservation', 'i need to get a reservation', 'i would like to make a booking',
    'i want to make a booking', 'i need to make a booking', 'i would like to book',
    'i want to book', 'i need to book', 'i would like to reserve',
    'i want to reserve', 'i need to reserve', 'i would like to make a reservation',
    'i want to make a reservation', 'i need to make a reservation',
    'for dinner', 'for lunch', 'for breakfast', 'for brunch', 'for drinks',
    'for coffee', 'for tea', 'for wine', 'for cocktails', 'for celebration',
    'for party', 'for anniversary', 'for birthday', 'for graduation', 'for promotion',
    'for farewell', 'for welcome', 'for meeting', 'for gathering', 'for date',
    'for appointment', 'for event', 'for celebration', 'for party', 'for family dinner',
    'for business dinner', 'for team dinner', 'for department dinner',
    'for group dinner', 'for friends dinner', 'for family gathering',
    'dining', 'eating', 'having dinner', 'having lunch', 'having breakfast',
    'having brunch', 'having drinks', 'having coffee', 'having tea', 'having wine',
    'having cocktails', 'celebrating', 'partying', 'meeting', 'gathering',
    'enjoying', 'enjoying dinner', 'enjoying lunch', 'enjoying breakfast',
    'enjoying brunch', 'enjoying drinks', 'enjoying coffee', 'enjoying tea',
    'enjoying wine', 'enjoying cocktails', 'enjoying celebration', 'enjoying party',
    'enjoying meeting', 'enjoying gathering', 'enjoying event',
    'with my family', 'with my friends', 'with my colleagues', 'with my partner',
    'with my kids', 'with my parents', 'with my siblings', 'with my children',
    'family', 'friends', 'colleagues', 'partner', 'kids', 'children', 'parents',
    'siblings', 'relatives', 'guests', 'diners', 'people', 'folks',
    'for today', 'for tomorrow', 'for the day after tomorrow', 'for this week',
    'for next week', 'for the weekend', 'for saturday', 'for sunday', 'for monday',
    'for tuesday', 'for wednesday', 'for thursday', 'for friday', 'today', 'tomorrow',
    'the day after tomorrow', 'this week', 'next week', 'the weekend', 'saturday',
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'tonight', 'this evening', 'this afternoon', 'this morning', 'tomorrow night',
    'tomorrow evening', 'tomorrow afternoon', 'tomorrow morning',
    'the day after tomorrow night', 'the day after tomorrow evening',
    'the day after tomorrow afternoon', 'the day after tomorrow morning',
    'saturday night', 'saturday evening', 'saturday afternoon', 'saturday morning',
    'sunday night', 'sunday evening', 'sunday afternoon', 'sunday morning',
    'monday night', 'monday evening', 'monday afternoon', 'monday morning',
    'tuesday night', 'tuesday evening', 'tuesday afternoon', 'tuesday morning',
    'wednesday night', 'wednesday evening', 'wednesday afternoon', 'wednesday morning',
    'thursday night', 'thursday evening', 'thursday afternoon', 'thursday morning',
    'friday night', 'friday evening', 'friday afternoon', 'friday morning',
    'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'good', 'perfect', 'great', 'fine',
    'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
    'continue', 'proceed', 'go ahead', 'move forward', 'keep going', 'carry on',
    'accept', 'confirm', 'agree', 'approve', 'endorse', 'support', 'back',
    'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'reservieren', 'reservierung', 'tisch reservieren', 'tisch buchen',
    'eine reservierung', 'einen tisch', 'einen platz reservieren',
    'ich möchte reservieren', 'ich brauche eine reservierung',
    'ich würde gerne reservieren', 'könnte ich reservieren',
    'darf ich reservieren', 'ich hätte gerne eine reservierung',
    'tisch buchen', 'platz reservieren', 'sitzplatz reservieren',
    'zum essen gehen', 'restaurant besuchen', 'ausgehen zum essen',
    'mit freunden essen', 'mit der familie essen', 'mit kollegen essen',
    'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
    'heute abend', 'morgen mittag', 'morgen abend', 'übermorgen',
    'diese woche', 'nächste woche', 'am wochenende',
    'für zwei personen', 'für vier personen', 'für sechs personen',
    'für acht personen', 'für zehn personen', 'für zwölf personen',
    'mit meiner frau', 'mit meinem mann', 'mit meinen kindern',
    'familienreservierung', 'geschäftsessen', 'feier', 'geburtstag',
    'hochzeit', 'jubiläum', 'firmenfeier', 'teamessen',
    // Italiano
    'prenotazione', 'prenotare', 'tavolo', 'prenotare tavolo',
    // Francés
    'réservation', 'réserver', 'table', 'réserver table',
    // Portugués
    'reserva', 'reservar', 'mesa', 'fazer reserva'
  ];
  
  // Palabras de intención general - EXPANDIDAS MULTILINGÜE
  const generalIntentionWords = [
    // Español
    'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'quería', 'busco',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'adelante', 'claro', 'por supuesto',
    'naturalmente', 'desde luego', 'por supuesto que sí', 'por supuesto que no',
    'está bien', 'me parece bien', 'de acuerdo', 'perfecto', 'excelente',
    'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico', 'espléndido',
    'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional', 'espectacular',
    'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente',
    'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido',
    'me parece formidable', 'me parece increíble', 'me parece asombroso',
    'me parece fenomenal', 'me parece sensacional', 'me parece espectacular',
    'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea', 'me encanta', 'me gusta', 'me parece perfecto',
    'me parece excelente', 'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido', 'me parece formidable',
    'me parece increíble', 'me parece asombroso', 'me parece fenomenal', 'me parece sensacional',
    'me parece espectacular', 'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea', 'me encanta', 'me gusta', 'me parece perfecto',
    'me parece excelente', 'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido', 'me parece formidable',
    'me parece increíble', 'me parece asombroso', 'me parece fenomenal', 'me parece sensacional',
    'me parece espectacular', 'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea',
    // Inglés
    'want', 'need', 'would like', 'yes', 'yeah', 'yep', 'okay', 'ok', 'sure', 'good',
    'please', 'i want', 'i need', 'i would like', 'absolutely', 'definitely', 'certainly',
    'of course', 'naturally', 'obviously', 'continue', 'proceed', 'go ahead', 'move forward',
    'keep going', 'carry on', 'accept', 'confirm', 'agree', 'approve', 'endorse', 'support',
    'back', 'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'möchte', 'brauche', 'würde gerne', 'hätte gerne', 'könnte ich', 'darf ich',
    'ja', 'gut', 'okay', 'klar', 'natürlich', 'gerne', 'bitte', 'danke',
    'perfekt', 'ausgezeichnet', 'wunderbar', 'prima', 'super', 'toll',
    'einverstanden', 'zustimmen', 'akzeptieren', 'annehmen', 'befürworten',
    'fortfahren', 'fortsetzen', 'weiter', 'weitergehen', 'procedieren',
    'bestätigen', 'bestätigung', 'korrekt', 'richtig', 'stimmt', 'genau',
    'ich möchte', 'ich brauche', 'ich würde gerne', 'ich hätte gerne',
    'ich suche', 'ich benötige', 'ich verlange', 'ich wünsche',
    'ich bin interessiert', 'ich bin daran interessiert', 'ich habe interesse',
    'das wäre schön', 'das wäre toll', 'das wäre perfekt', 'das wäre super',
    'gerne', 'sehr gerne', 'sehr gern', 'mit freuden', 'mit vergnügen',
    'selbstverständlich', 'natürlich', 'klar', 'logisch', 'verständlich',
    // Italiano
    'vorrei', 'ho bisogno', 'sì', 'va bene', 'perfetto',
    // Francés
    'j\'ai besoin', 'je voudrais', 'oui', 'd\'accord', 'parfait',
    // Portugués
    'quero', 'preciso', 'sim', 'bom', 'perfeito'
  ];
  
  // Palabras de negación o no reserva - EXPANDIDAS MULTILINGÜE
  const negativeWords = [
    // Español
    'no', 'nada', 'solo llamaba', 'información', 'pregunta', 'duda',
    'cancelar', 'cancelación', 'no reserva',
    // Inglés
    'no', 'nothing', 'just calling', 'information', 'question', 'doubt',
    'cancel', 'cancellation', 'no reservation', 'not interested', 'not looking for',
    'just asking', 'just wondering', 'just checking', 'just inquiring',
    'just wanted to know', 'just wanted to ask', 'just wanted to check',
    'just wanted to inquire', 'just wanted to find out', 'just wanted to learn',
    'just wanted to understand', 'just wanted to clarify', 'just wanted to confirm',
    'just wanted to verify', 'just wanted to double check', 'just wanted to make sure',
    'just wanted to be sure', 'just wanted to be certain', 'just wanted to be clear',
    'just wanted to be positive', 'just wanted to be confident', 'just wanted to be secure',
    'just wanted to be safe', 'just wanted to be certain', 'just wanted to be sure',
    'just wanted to be clear', 'just wanted to be positive', 'just wanted to be confident',
    'just wanted to be secure', 'just wanted to be safe', 'just wanted to be certain',
    'just wanted to be sure', 'just wanted to be clear', 'just wanted to be positive',
    'just wanted to be confident', 'just wanted to be secure', 'just wanted to be safe',
    'wrong number', 'wrong call', 'mistaken call', 'accidental call', 'wrong person',
    'wrong place', 'wrong time', 'wrong day', 'wrong date', 'wrong reservation',
    'wrong booking', 'wrong table', 'wrong restaurant', 'wrong location',
    'wrong address', 'wrong phone number', 'wrong contact', 'wrong information',
    'wrong details', 'wrong specifics', 'wrong particulars', 'wrong data',
    'wrong facts', 'wrong figures', 'wrong numbers', 'wrong amounts',
    'wrong quantities', 'wrong measurements', 'wrong dimensions', 'wrong sizes',
    'wrong lengths', 'wrong widths', 'wrong heights', 'wrong depths',
    'wrong volumes', 'wrong capacities', 'wrong limits', 'wrong boundaries',
    'wrong ranges', 'wrong scopes', 'wrong extents', 'wrong degrees',
    'wrong levels', 'wrong grades', 'wrong classes', 'wrong categories',
    'wrong types', 'wrong kinds', 'wrong sorts', 'wrong varieties',
    'wrong species', 'wrong breeds', 'wrong strains', 'wrong lines',
    'wrong families', 'wrong groups', 'wrong sets', 'wrong collections',
    'wrong batches', 'wrong lots', 'wrong shipments', 'wrong deliveries',
    'wrong orders', 'wrong requests', 'wrong demands', 'wrong requirements',
    'wrong needs', 'wrong wants', 'wrong desires', 'wrong wishes',
    'wrong hopes', 'wrong dreams', 'wrong aspirations', 'wrong ambitions',
    'wrong goals', 'wrong objectives', 'wrong targets', 'wrong aims',
    'wrong purposes', 'wrong intentions', 'wrong plans', 'wrong strategies',
    'wrong approaches', 'wrong methods', 'wrong techniques', 'wrong procedures',
    'wrong processes', 'wrong systems', 'wrong mechanisms', 'wrong operations',
    'wrong functions', 'wrong activities', 'wrong actions', 'wrong behaviors',
    'wrong conduct', 'wrong manners', 'wrong etiquette', 'wrong protocol',
    'wrong customs', 'wrong traditions', 'wrong practices', 'wrong habits',
    'wrong routines', 'wrong patterns', 'wrong cycles', 'wrong rhythms',
    'wrong tempos', 'wrong paces', 'wrong speeds', 'wrong rates',
    'wrong frequencies', 'wrong intervals', 'wrong periods', 'wrong durations',
    'wrong times', 'wrong moments', 'wrong instants', 'wrong seconds',
    'wrong minutes', 'wrong hours', 'wrong days', 'wrong weeks',
    'wrong months', 'wrong years', 'wrong decades', 'wrong centuries',
    'wrong millennia', 'wrong ages', 'wrong eras', 'wrong periods',
    'wrong epochs',
    // Alemán
    'nein', 'nicht', 'keine', 'kein', 'nichts', 'nur anrufen', 'nur fragen',
    'information', 'frage', 'doubt', 'zweifel', 'unsicher', 'nicht sicher',
    'abbrechen', 'stornieren', 'löschen', 'entfernen', 'aufheben',
    'keine reservierung', 'nicht reservieren', 'nicht buchen',
    'nur informieren', 'nur nachfragen', 'nur erkundigen',
    'nur telefonieren', 'nur sprechen', 'nur reden',
    'kein interesse', 'nicht interessiert', 'nicht gewünscht',
    'falsch verbunden', 'verkehrte nummer', 'falsche nummer',
    'nicht gewollt', 'nicht erwünscht', 'nicht gewünscht',
    'entschuldigung', 'verzeihung', 'sorry', 'tut mir leid',
    'falscher anruf', 'versehentlich', 'aus versehen',
    // Italiano
    'no', 'niente', 'solo chiamare', 'informazione', 'domanda',
    // Francés
    'non', 'rien', 'juste appeler', 'information', 'question',
    // Portugués
    'não', 'nada', 'só ligando', 'informação', 'pergunta'
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
    // ESPAÑOL - Expresiones completas y naturales
    'reservar', 'reserva', 'mesa', 'mesas', 'comer', 'cenar', 'almorzar',
    'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'quería',
    'hacer una reserva', 'reservar mesa', 'reservar una mesa', 'reservar mesa para',
    'hacer reserva', 'necesito mesa', 'quiero mesa', 'busco mesa',
    'tengo reserva', 'tengo una reserva', 'mi reserva', 'la reserva',
    'para comer', 'para cenar', 'para almorzar', 'para desayunar',
    'restaurante', 'cenar en', 'comer en', 'vamos a comer',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto',
    'adelante', 'continúo', 'procedo', 'acepto', 'confirmo',
    
    // INGLÉS - Expresiones completas y naturales
    'book', 'booking', 'table', 'tables', 'eat', 'dine', 'lunch', 'dinner',
    'want', 'need', 'would like', 'looking for', 'seeking', 'require',
    'book a table', 'make a reservation', 'table reservation', 'reserve a table',
    'book table', 'reserve table', 'get a table', 'find a table',
    'have a reservation', 'my reservation', 'the reservation',
    'for dinner', 'for lunch', 'for breakfast', 'to eat', 'to dine',
    'restaurant', 'dining', 'eating out', 'going out to eat',
    'yes', 'okay', 'ok', 'sure', 'good', 'perfect', 'great', 'fine',
    'continue', 'proceed', 'accept', 'confirm', 'agreed',
    
    // ALEMÁN - Expresiones completas y naturales
    'reservieren', 'reservierung', 'tisch', 'tische', 'essen', 'dinner', 'mittagessen',
    'möchte', 'brauche', 'würde gerne', 'hätte gerne', 'könnte ich', 'darf ich', 'suche', 'benötige', 'verlange',
    'tisch reservieren', 'reservierung machen', 'tisch buchen', 'tisch reservieren für',
    'tisch buchen', 'tisch bekommen', 'tisch finden', 'tisch suchen',
    'habe reservierung', 'meine reservierung', 'die reservierung',
    'zum essen', 'zum abendessen', 'zum mittagessen', 'zum frühstück',
    'restaurant', 'essen gehen', 'ausgehen zum essen',
    'ja', 'gut', 'perfekt', 'okay', 'klar', 'natürlich', 'gerne',
    'fortfahren', 'fortsetzen', 'akzeptieren', 'bestätigen', 'einverstanden',
    'ich möchte', 'ich brauche', 'ich würde gerne', 'ich hätte gerne', 'ich suche',
    'ich benötige', 'ich verlange', 'ich wünsche', 'ich bin interessiert',
    'eine reservierung', 'einen tisch', 'einen platz', 'einen sitzplatz',
    'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
    'mit freunden', 'mit der familie', 'mit kollegen', 'mit meiner frau',
    'mit meinem mann', 'mit meinen kindern', 'familienreservierung',
    'geschäftsessen', 'feier', 'geburtstag', 'hochzeit', 'jubiläum',
    'firmenfeier', 'teamessen', 'heute abend', 'morgen mittag', 'morgen abend',
    'übermorgen', 'diese woche', 'nächste woche', 'am wochenende',
    'für zwei personen', 'für vier personen', 'für sechs personen',
    'für acht personen', 'für zehn personen', 'für zwölf personen',
    
    // ITALIANO - Expresiones completas y naturales
    'prenotazione', 'prenotare', 'tavolo', 'tavoli', 'mangiare', 'cenare', 'pranzo',
    'vorrei', 'ho bisogno', 'cerco', 'necessito', 'desidero', 'voglio',
    'prenotare tavolo', 'fare prenotazione', 'prenotazione tavolo', 'prenotare un tavolo',
    'prenotare tavolo', 'ottenere tavolo', 'trovare tavolo', 'cercare tavolo',
    'ho prenotazione', 'la mia prenotazione', 'la prenotazione',
    'per mangiare', 'per cenare', 'per pranzo', 'per colazione',
    'ristorante', 'andare a mangiare', 'uscire a mangiare',
    'sì', 'va bene', 'perfetto', 'okay', 'chiaro', 'naturalmente', 'volentieri',
    'continuare', 'procedere', 'accettare', 'confermare', 'd\'accordo',
    
    // FRANCÉS - Expresiones completas y naturales
    'réservation', 'réserver', 'table', 'tables', 'manger', 'dîner', 'déjeuner',
    'je voudrais', 'j\'ai besoin', 'je cherche', 'je nécessite', 'je désire', 'je veux',
    'réserver table', 'faire réservation', 'réservation table', 'réserver une table',
    'réserver table', 'obtenir table', 'trouver table', 'chercher table',
    'j\'ai réservation', 'ma réservation', 'la réservation',
    'pour manger', 'pour dîner', 'pour déjeuner', 'pour petit-déjeuner',
    'restaurant', 'sortir manger', 'aller manger',
    'oui', 'd\'accord', 'parfait', 'okay', 'clair', 'naturellement', 'volontiers',
    'continuer', 'procéder', 'accepter', 'confirmer', 'd\'accord',
    
    // PORTUGUÉS - Expresiones completas y naturales
    'reserva', 'reservar', 'mesa', 'mesas', 'comer', 'jantar', 'almoçar',
    'quero', 'preciso', 'gostaria', 'busco', 'necessito', 'desejo', 'quero',
    'fazer reserva', 'reservar mesa', 'reserva mesa', 'reservar uma mesa',
    'reservar mesa', 'conseguir mesa', 'encontrar mesa', 'procurar mesa',
    'tenho reserva', 'minha reserva', 'a reserva',
    'para comer', 'para jantar', 'para almoçar', 'para café da manhã',
    'restaurante', 'sair para comer', 'ir comer',
    'sim', 'bom', 'perfeito', 'okay', 'claro', 'naturalmente', 'com prazer',
    'continuar', 'proceder', 'aceitar', 'confirmar', 'concordo',
    
    // EXPRESIONES COMUNES MULTILINGÜES
    'this evening', 'tonight', 'this afternoon', 'tomorrow', 'next week',
    'esta noche', 'esta tarde', 'mañana', 'la próxima semana',
    'heute abend', 'heute nacht', 'morgen', 'nächste woche', 'übermorgen',
    'diese woche', 'am wochenende', 'morgen mittag', 'morgen abend',
    'heute mittag', 'heute nachmittag', 'heute abend', 'heute nacht',
    'diese nacht', 'diese nacht', 'diese nacht', 'diese nacht',
    'stasera', 'domani', 'la prossima settimana',
    'ce soir', 'demain', 'la semaine prochaine',
    'esta noite', 'amanhã', 'próxima semana',
    
    // NÚMEROS Y CANTIDADES
    'for two', 'for four', 'for six', 'for eight', 'for ten',
    'para dos', 'para cuatro', 'para seis', 'para ocho', 'para diez',
    'für zwei', 'für vier', 'für sechs', 'für acht', 'für zehn', 'für zwölf',
    'für zwei personen', 'für vier personen', 'für sechs personen', 'für acht personen',
    'für zehn personen', 'für zwölf personen', 'für zwei leute', 'für vier leute',
    'für sechs leute', 'für acht leute', 'für zehn leute', 'für zwölf leute',
    'für zwei gäste', 'für vier gäste', 'für sechs gäste', 'für acht gäste',
    'für zehn gäste', 'für zwölf gäste', 'mit zwei', 'mit vier', 'mit sechs',
    'mit acht', 'mit zehn', 'mit zwölf', 'mit zwei personen', 'mit vier personen',
    'mit sechs personen', 'mit acht personen', 'mit zehn personen', 'mit zwölf personen',
    'mit zwei leute', 'mit vier leute', 'mit sechs leute', 'mit acht leute',
    'mit zehn leute', 'mit zwölf leute', 'mit zwei gäste', 'mit vier gäste',
    'mit sechs gäste', 'mit acht gäste', 'mit zehn gäste', 'mit zwölf gäste',
    'zwei personen', 'vier personen', 'sechs personen', 'acht personen',
    'zehn personen', 'zwölf personen', 'zwei leute', 'vier leute', 'sechs leute',
    'acht leute', 'zehn leute', 'zwölf leute', 'zwei gäste', 'vier gäste',
    'sechs gäste', 'acht gäste', 'zehn gäste', 'zwölf gäste',
    'per due', 'per quattro', 'per sei', 'per otto', 'per dieci',
    'pour deux', 'pour quatre', 'pour six', 'pour huit', 'pour dix',
    'para dois', 'para quatro', 'para seis', 'para oito', 'para dez'
  ];
  
  const lowerText = text.toLowerCase();
  
  console.log(`🔍 [DEBUG] isReservationRequest - Analizando: "${text}"`);
  console.log(`🔍 [DEBUG] Texto en minúsculas: "${lowerText}"`);
  
  // Buscar coincidencias exactas de palabras
  const hasReservationWords = reservationWords.some(word => lowerText.includes(word));
  console.log(`🔍 [DEBUG] Palabras de reserva encontradas: ${hasReservationWords}`);
  
  // Debug específico para italiano
  if (lowerText.includes('ciao') || lowerText.includes('vorrei') || lowerText.includes('prenotare')) {
    console.log(`🇮🇹 [DEBUG] Detectadas palabras italianas en: "${lowerText}"`);
    const italianWords = ['ciao', 'vorrei', 'prenotare', 'tavolo', 'prenotazione', 'ho bisogno'];
    const foundItalian = italianWords.filter(word => lowerText.includes(word));
    console.log(`🇮🇹 [DEBUG] Palabras italianas encontradas:`, foundItalian);
  }
  
  // Buscar patrones de frases comunes
  const commonPatterns = [
    // Patrones en español
    /quiero\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /necesito\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /me\s+gustaría\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /quiero\s+(?:reservar\s+)?(?:una\s+)?mesa/i,
    /necesito\s+(?:reservar\s+)?(?:una\s+)?mesa/i,
    /para\s+\d+\s+(?:personas?|gente|comensales?)/i,
    
    // Patrones en inglés
    /i\s+want\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+need\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+would\s+like\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+want\s+(?:to\s+)?book\s+a\s+table/i,
    /i\s+need\s+(?:to\s+)?book\s+a\s+table/i,
    /for\s+\d+\s+(?:people|persons?)/i,
    
    // Patrones en alemán
    /ich\s+möchte\s+(?:eine\s+)?reservierung/i,
    /ich\s+brauche\s+(?:eine\s+)?reservierung/i,
    /ich\s+würde\s+gerne\s+(?:eine\s+)?reservierung/i,
    /ich\s+hätte\s+gerne\s+(?:eine\s+)?reservierung/i,
    /könnte\s+ich\s+(?:eine\s+)?reservierung/i,
    /darf\s+ich\s+(?:eine\s+)?reservierung/i,
    /ich\s+möchte\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?tisch\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?tisch\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+möchte\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+brauche\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?tisch\s+buchen/i,
    /könnte\s+ich\s+(?:einen\s+)?tisch\s+buchen/i,
    /darf\s+ich\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+möchte\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?platz\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?platz\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+möchte\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /für\s+\d+\s+(?:personen?|leute|gäste)/i,
    /mit\s+(?:freunden|der\s+familie|kollegen|meiner\s+frau|meinem\s+mann|meinen\s+kindern)/i,
    /für\s+(?:heute|morgen|übermorgen|diese\s+woche|nächste\s+woche|am\s+wochenende)/i,
    /heute\s+(?:abend|mittag|nachmittag)/i,
    /morgen\s+(?:abend|mittag|nachmittag)/i,
    /übermorgen/i,
    /diese\s+woche/i,
    /nächste\s+woche/i,
    /am\s+wochenende/i,
    /zum\s+(?:essen|abendessen|mittagessen|frühstück)/i,
    /ausgehen\s+zum\s+essen/i,
    /essen\s+gehen/i,
    /restaurant\s+besuchen/i,
    /familienreservierung/i,
    /geschäftsessen/i,
    /firmenfeier/i,
    /teamessen/i,
    /geburtstag/i,
    /hochzeit/i,
    /jubiläum/i,
    /feier/i,
    
    // Patrones en italiano
    /vorrei\s+(?:fare\s+)?(?:una\s+)?prenotazione/i,
    /ho\s+bisogno\s+di\s+(?:una\s+)?prenotazione/i,
    /vorrei\s+(?:prenotare\s+)?(?:un\s+)?tavolo/i,
    /per\s+\d+\s+(?:persone?|gente)/i,
    
    // Patrones en francés
    /je\s+voudrais\s+(?:faire\s+)?(?:une\s+)?réservation/i,
    /j\'ai\s+besoin\s+d\'(?:une\s+)?réservation/i,
    /je\s+voudrais\s+(?:réserver\s+)?(?:une\s+)?table/i,
    /pour\s+\d+\s+(?:personnes?|gens)/i,
    
    // Patrones en portugués
    /quero\s+(?:fazer\s+)?(?:uma\s+)?reserva/i,
    /preciso\s+de\s+(?:uma\s+)?reserva/i,
    /quero\s+(?:reservar\s+)?(?:uma\s+)?mesa/i,
    /para\s+\d+\s+(?:pessoas?|gente)/i
  ];
  
  const hasPatterns = commonPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones regex encontrados: ${hasPatterns}`);
  
  const result = hasReservationWords || hasPatterns;
  console.log(`🔍 [DEBUG] Resultado final isReservationRequest: ${result}`);
  
  return result;
}

// Función simple para detectar confirmación de cancelación
function detectCancellationConfirmation(text) {
  const lowerText = text.toLowerCase();
  
  // Palabras de confirmación positiva (SÍ quiero cancelar)
  const yesWords = [
    // Español
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo',
    'quiero cancelar', 'necesito cancelar', 'deseo cancelar', 'mejor cancelo',
    'al final no', 'mejor no', 'ya no quiero', 'ya no necesito', 'ya no voy',
    'cambié de opinión', 'cambie de opinion', 'cambié de idea', 'cambie de idea',
    'no me interesa', 'no me convence', 'no me gusta', 'no me conviene',
    'no me sirve', 'no me funciona', 'no me parece bien',
    'mejor paro', 'mejor termino', 'mejor cuelgo', 'mejor me voy',
    'mejor me despido', 'mejor me retiro', 'mejor no hago', 'mejor no reservo',
    
    // Inglés
    'yes', 'yeah', 'yep', 'correct', 'confirm', 'perfect', 'good', 'okay', 'ok', 'sure',
    'exactly', 'that\'s right', 'that\'s correct', 'sounds good', 'agree',
    'confirmed', 'accept', 'proceed', 'go ahead', 'absolutely', 'definitely',
    'want to cancel', 'need to cancel', 'wish to cancel', 'better cancel',
    'actually no', 'better not', 'changed my mind', 'change my mind',
    'not interested', 'not convinced', 'don\'t want to continue',
    'better stop', 'better end', 'better hang up', 'better leave',
    
    // Alemán
    'ja', 'richtig', 'bestätigen', 'perfekt', 'gut', 'okay', 'genau',
    'das stimmt', 'einverstanden', 'bestätigt', 'akzeptieren',
    'will stornieren', 'möchte stornieren', 'besser stornieren',
    'eigentlich nicht', 'besser nicht', 'meinung geändert',
    'nicht interessiert', 'nicht überzeugt', 'besser aufhören',
    
    // Italiano
    'sì', 'si', 'corretto', 'confermo', 'perfetto', 'bene', 'okay', 'ok',
    'va bene', 'd\'accordo', 'confermato', 'accetto',
    'vuole cancellare', 'meglio cancellare', 'cambiato idea',
    'non interessato', 'meglio fermare',
    
    // Francés
    'oui', 'correct', 'confirmer', 'parfait', 'bien', 'd\'accord',
    'veut annuler', 'mieux annuler', 'changé d\'avis',
    'pas intéressé', 'mieux arrêter',
    
    // Portugués
    'sim', 'correto', 'confirmo', 'perfeito', 'bem', 'okay',
    'quer cancelar', 'melhor cancelar', 'mudou de ideia',
    'não interessado', 'melhor parar'
  ];
  
  // Palabras de negación (NO quiero cancelar)
  const noWords = [
    // Español
    'no', 'incorrecto', 'mal', 'error', 'no es', 'no está bien', 'no me parece',
    'discrepo', 'no acepto', 'no quiero cancelar', 'no necesito cancelar',
    'mejor continúo', 'mejor sigo', 'mejor procedo', 'mejor adelante',
    'quiero continuar', 'necesito continuar', 'deseo continuar',
    'mejor sigo adelante', 'mejor continúo adelante', 'mejor procedo adelante',
    'no cancelo', 'no cancelar', 'no quiero cancelar', 'no necesito cancelar',
    'mejor no cancelo', 'mejor no cancelar', 'mejor no quiero cancelar',
    
    // Inglés
    'no', 'incorrect', 'wrong', 'error', 'not right', 'not correct',
    'disagree', 'don\'t accept', 'don\'t want to cancel', 'don\'t need to cancel',
    'better continue', 'better proceed', 'better go ahead',
    'want to continue', 'need to continue', 'wish to continue',
    'don\'t cancel', 'don\'t want to cancel', 'don\'t need to cancel',
    
    // Alemán
    'nein', 'falsch', 'fehler', 'nicht richtig', 'nicht korrekt',
    'nicht einverstanden', 'nicht akzeptieren', 'nicht stornieren',
    'besser fortfahren', 'besser fortgesetzt', 'besser weiter',
    'will fortfahren', 'möchte fortfahren', 'nicht stornieren',
    
    // Italiano
    'no', 'sbagliato', 'errore', 'non è giusto', 'non va bene',
    'non accetto', 'non vuole cancellare', 'meglio continuare',
    'vuole continuare', 'non cancellare',
    
    // Francés
    'non', 'incorrect', 'faux', 'erreur', 'pas correct',
    'pas d\'accord', 'ne veut pas annuler', 'mieux continuer',
    'veut continuer', 'ne pas annuler',
    
    // Portugués
    'não', 'incorreto', 'errado', 'erro', 'não está certo',
    'não concordo', 'não quer cancelar', 'melhor continuar',
    'quer continuar', 'não cancelar'
  ];
  
  // Verificar confirmación positiva
  const hasYesWords = yesWords.some(word => lowerText.includes(word));
  const hasNoWords = noWords.some(word => lowerText.includes(word));
  
  console.log(`🔍 [DEBUG] detectCancellationConfirmation - Texto: "${text}"`);
  console.log(`🔍 [DEBUG] - Palabras SÍ encontradas: ${hasYesWords}`);
  console.log(`🔍 [DEBUG] - Palabras NO encontradas: ${hasNoWords}`);
  
  if (hasYesWords && !hasNoWords) {
    return 'yes';
  } else if (hasNoWords && !hasYesWords) {
    return 'no';
  } else {
    return 'unclear';
  }
}
function isCancellationRequest(text) {
  const cancellationWords = [
    // ESPAÑOL - Expresiones de cancelación (palabras simples y comunes)
    'cancelar', 'cancelación', 'no quiero', 'no necesito', 'no voy a', 'no voy',
    'al final no', 'mejor no', 'no gracias', 'no quiero reservar', 'no necesito reservar',
    'no voy a reservar', 'no voy a hacer', 'no voy a hacer reserva', 'no voy a reservar mesa',
    'mejor cancelo', 'quiero cancelar', 'necesito cancelar', 'deseo cancelar',
    'no me interesa', 'no me convence', 'cambié de opinión', 'cambie de opinion',
    'ya no quiero', 'ya no necesito', 'ya no voy', 'ya no voy a', 'ya no voy a reservar',
    'mejor otro día', 'mejor después', 'mejor más tarde', 'mejor en otro momento',
    'no está bien', 'no esta bien', 'no me parece bien', 'no me gusta',
    'no me conviene', 'no me sirve', 'no me funciona', 'no me interesa',
    'mejor no hago', 'mejor no reservo', 'mejor no hago reserva', 'mejor no reservo mesa',
    'no gracias', 'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'no quiero continuar', 'no quiero seguir', 'no quiero proceder', 'no quiero seguir adelante',
    'mejor paro', 'mejor paro aquí', 'mejor paro acá', 'mejor paro ahora',
    'mejor termino', 'mejor termino aquí', 'mejor termino acá', 'mejor termino ahora',
    'mejor cuelgo', 'mejor cuelgo aquí', 'mejor cuelgo acá', 'mejor cuelgo ahora',
    'mejor me voy', 'mejor me voy ahora', 'mejor me voy aquí', 'mejor me voy acá',
    'mejor me despido', 'mejor me despido ahora', 'mejor me despido aquí', 'mejor me despido acá',
    'mejor me retiro', 'mejor me retiro ahora', 'mejor me retiro aquí', 'mejor me retiro acá',
    'mejor me voy a ir', 'mejor me voy a ir ahora', 'mejor me voy a ir aquí', 'mejor me voy a ir acá',
    'mejor me voy a despedir', 'mejor me voy a despedir ahora', 'mejor me voy a despedir aquí', 'mejor me voy a despedir acá',
    'mejor me voy a retirar', 'mejor me voy a retirar ahora', 'mejor me voy a retirar aquí', 'mejor me voy a retirar acá',
    
    // PALABRAS SIMPLES Y COMUNES QUE LA GENTE USA
    'no', 'no quiero', 'no necesito', 'no voy', 'no voy a', 'no voy a hacer',
    'mejor no', 'mejor no hago', 'mejor no reservo', 'mejor no hago reserva',
    'al final no', 'al final no quiero', 'al final no necesito', 'al final no voy',
    'ya no', 'ya no quiero', 'ya no necesito', 'ya no voy', 'ya no voy a',
    'cambié de opinión', 'cambie de opinion', 'cambié de idea', 'cambie de idea',
    'mejor cancelo', 'quiero cancelar', 'necesito cancelar', 'deseo cancelar',
    'no me interesa', 'no me convence', 'no me gusta', 'no me conviene',
    'no me sirve', 'no me funciona', 'no me interesa', 'no me parece bien',
    'no está bien', 'no esta bien', 'no me parece bien', 'no me gusta',
    'mejor otro día', 'mejor después', 'mejor más tarde', 'mejor en otro momento',
    'mejor no hago', 'mejor no reservo', 'mejor no hago reserva', 'mejor no reservo mesa',
    'no gracias', 'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'no quiero continuar', 'no quiero seguir', 'no quiero proceder', 'no quiero seguir adelante',
    'mejor paro', 'mejor paro aquí', 'mejor paro acá', 'mejor paro ahora',
    'mejor termino', 'mejor termino aquí', 'mejor termino acá', 'mejor termino ahora',
    'mejor cuelgo', 'mejor cuelgo aquí', 'mejor cuelgo acá', 'mejor cuelgo ahora',
    'mejor me voy', 'mejor me voy ahora', 'mejor me voy aquí', 'mejor me voy acá',
    'mejor me despido', 'mejor me despido ahora', 'mejor me despido aquí', 'mejor me despido acá',
    'mejor me retiro', 'mejor me retiro ahora', 'mejor me retiro aquí', 'mejor me retiro acá',
    
    // INGLÉS - Expresiones de cancelación
    'cancel', 'cancellation', 'don\'t want', 'don\'t need', 'not going to', 'not going',
    'actually no', 'better not', 'no thanks', 'don\'t want to book', 'don\'t need to book',
    'not going to book', 'not going to make', 'not going to make reservation', 'not going to book table',
    'better cancel', 'want to cancel', 'need to cancel', 'wish to cancel',
    'not interested', 'not convinced', 'changed my mind', 'change my mind',
    'don\'t want anymore', 'don\'t need anymore', 'not going anymore', 'not going to anymore',
    'better another day', 'better later', 'better another time', 'better some other time',
    'not good', 'not right', 'not suitable', 'not convenient', 'not working', 'not interested',
    'better not do', 'better not book', 'better not make reservation', 'better not book table',
    'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'don\'t want to continue', 'don\'t want to proceed', 'don\'t want to go ahead',
    'better stop', 'better stop here', 'better stop now',
    'better end', 'better end here', 'better end now',
    'better hang up', 'better hang up now',
    'better go', 'better go now', 'better leave', 'better leave now',
    'better say goodbye', 'better say goodbye now',
    'better withdraw', 'better withdraw now',
    
    // ALEMÁN - Expresiones de cancelación
    'stornieren', 'stornierung', 'nicht wollen', 'nicht brauchen', 'nicht gehen', 'nicht gehen zu',
    'eigentlich nicht', 'besser nicht', 'nein danke', 'nicht reservieren wollen', 'nicht reservieren brauchen',
    'nicht reservieren gehen', 'nicht machen gehen', 'nicht reservierung machen gehen', 'nicht tisch reservieren gehen',
    'besser stornieren', 'stornieren wollen', 'stornieren brauchen', 'stornieren wünschen',
    'nicht interessiert', 'nicht überzeugt', 'meinung geändert', 'meinung ändern',
    'nicht mehr wollen', 'nicht mehr brauchen', 'nicht mehr gehen', 'nicht mehr gehen zu',
    'besser anderen tag', 'besser später', 'besser andere zeit', 'besser andere zeit',
    'nicht gut', 'nicht richtig', 'nicht geeignet', 'nicht bequem', 'nicht funktioniert', 'nicht interessiert',
    'besser nicht machen', 'besser nicht buchen', 'besser nicht reservierung machen', 'besser nicht tisch buchen',
    'nein danke', 'nein danke sehr',
    'nicht weiter machen wollen', 'nicht fortfahren wollen', 'nicht vorwärts gehen wollen',
    'besser aufhören', 'besser hier aufhören', 'besser jetzt aufhören',
    'besser beenden', 'besser hier beenden', 'besser jetzt beenden',
    'besser auflegen', 'besser jetzt auflegen',
    'besser gehen', 'besser jetzt gehen', 'besser verlassen', 'besser jetzt verlassen',
    'besser verabschieden', 'besser jetzt verabschieden',
    'besser zurückziehen', 'besser jetzt zurückziehen',
    
    // ITALIANO - Expresiones de cancelación
    'cancellare', 'cancellazione', 'non voglio', 'non ho bisogno', 'non vado', 'non vado a',
    'in realtà no', 'meglio no', 'no grazie', 'non voglio prenotare', 'non ho bisogno di prenotare',
    'non vado a prenotare', 'non vado a fare', 'non vado a fare prenotazione', 'non vado a prenotare tavolo',
    'meglio cancellare', 'voglio cancellare', 'ho bisogno di cancellare', 'desidero cancellare',
    'non interessato', 'non convinto', 'cambiato idea', 'cambiare idea',
    'non voglio più', 'non ho più bisogno', 'non vado più', 'non vado più a',
    'meglio un altro giorno', 'meglio dopo', 'meglio un\'altra volta', 'meglio un altro momento',
    'non va bene', 'non è giusto', 'non è adatto', 'non è conveniente', 'non funziona', 'non interessato',
    'meglio non fare', 'meglio non prenotare', 'meglio non fare prenotazione', 'meglio non prenotare tavolo',
    'no grazie', 'no grazie molto',
    'non voglio continuare', 'non voglio procedere', 'non voglio andare avanti',
    'meglio fermarsi', 'meglio fermarsi qui', 'meglio fermarsi ora',
    'meglio finire', 'meglio finire qui', 'meglio finire ora',
    'meglio riattaccare', 'meglio riattaccare ora',
    'meglio andare', 'meglio andare ora', 'meglio lasciare', 'meglio lasciare ora',
    'meglio salutare', 'meglio salutare ora',
    'meglio ritirarsi', 'meglio ritirarsi ora'
  ];
  
  const lowerText = text.toLowerCase();
  
  console.log(`🔍 [DEBUG] isCancellationRequest - Analizando: "${text}"`);
  console.log(`🔍 [DEBUG] Texto en minúsculas: "${lowerText}"`);
  
  // Buscar coincidencias exactas de palabras
  const hasCancellationWords = cancellationWords.some(word => lowerText.includes(word));
  console.log(`🔍 [DEBUG] Palabras de cancelación encontradas: ${hasCancellationWords}`);
  
  // Buscar patrones simples de cancelación (más flexibles)
  const simpleCancellationPatterns = [
    // Patrones simples en español
    /quiero\s+cancelar/i,
    /necesito\s+cancelar/i,
    /deseo\s+cancelar/i,
    /mejor\s+cancelo/i,
    /mejor\s+no/i,
    /al\s+final\s+no/i,
    /ya\s+no\s+quiero/i,
    /ya\s+no\s+necesito/i,
    /ya\s+no\s+voy/i,
    /cambié\s+de\s+opinión/i,
    /cambie\s+de\s+opinion/i,
    /cambié\s+de\s+idea/i,
    /cambie\s+de\s+idea/i,
    /no\s+me\s+interesa/i,
    /no\s+me\s+convence/i,
    /no\s+me\s+gusta/i,
    /no\s+me\s+conviene/i,
    /no\s+quiero\s+continuar/i,
    /no\s+quiero\s+seguir/i,
    /mejor\s+paro/i,
    /mejor\s+termino/i,
    /mejor\s+cuelgo/i,
    /mejor\s+me\s+voy/i,
    /mejor\s+me\s+despido/i,
    /mejor\s+me\s+retiro/i,
    
    // Patrones simples en inglés
    /want\s+to\s+cancel/i,
    /need\s+to\s+cancel/i,
    /wish\s+to\s+cancel/i,
    /better\s+cancel/i,
    /better\s+not/i,
    /actually\s+no/i,
    /changed\s+my\s+mind/i,
    /change\s+my\s+mind/i,
    /not\s+interested/i,
    /not\s+convinced/i,
    /don\'t\s+want\s+to\s+continue/i,
    /don\'t\s+want\s+to\s+proceed/i,
    /better\s+stop/i,
    /better\s+end/i,
    /better\s+hang\s+up/i,
    /better\s+leave/i,
    /better\s+go/i
  ];
  
  const hasSimplePatterns = simpleCancellationPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones simples de cancelación encontrados: ${hasSimplePatterns}`);
  
  // Buscar patrones de frases comunes de cancelación
  const cancellationPatterns = [
    // Patrones en español
    /no\s+quiero\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /no\s+necesito\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /no\s+voy\s+a\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /al\s+final\s+no/i,
    /mejor\s+no/i,
    /cambié\s+de\s+opinión/i,
    /ya\s+no\s+quiero/i,
    /mejor\s+cancelo/i,
    /quiero\s+cancelar/i,
    /necesito\s+cancelar/i,
    /deseo\s+cancelar/i,
    /no\s+me\s+interesa/i,
    /no\s+me\s+convence/i,
    /no\s+me\s+gusta/i,
    /no\s+me\s+conviene/i,
    /no\s+me\s+sirve/i,
    /no\s+me\s+funciona/i,
    /mejor\s+no\s+hago/i,
    /mejor\s+no\s+reservo/i,
    /mejor\s+no\s+hago\s+reserva/i,
    /mejor\s+no\s+reservo\s+mesa/i,
    /no\s+quiero\s+continuar/i,
    /no\s+quiero\s+seguir/i,
    /no\s+quiero\s+proceder/i,
    /no\s+quiero\s+seguir\s+adelante/i,
    /mejor\s+paro/i,
    /mejor\s+termino/i,
    /mejor\s+cuelgo/i,
    /mejor\s+me\s+voy/i,
    /mejor\s+me\s+despido/i,
    /mejor\s+me\s+retiro/i,
    
    // Patrones en inglés
    /don\'t\s+want\s+to\s+(?:book|make\s+reservation)/i,
    /don\'t\s+need\s+to\s+(?:book|make\s+reservation)/i,
    /not\s+going\s+to\s+(?:book|make\s+reservation)/i,
    /actually\s+no/i,
    /better\s+not/i,
    /changed\s+my\s+mind/i,
    /don\'t\s+want\s+anymore/i,
    /don\'t\s+need\s+anymore/i,
    /not\s+going\s+anymore/i,
    /better\s+cancel/i,
    /want\s+to\s+cancel/i,
    /need\s+to\s+cancel/i,
    /wish\s+to\s+cancel/i,
    /not\s+interested/i,
    /not\s+convinced/i,
    /not\s+good/i,
    /not\s+right/i,
    /not\s+suitable/i,
    /not\s+convenient/i,
    /not\s+working/i,
    /better\s+not\s+do/i,
    /better\s+not\s+book/i,
    /better\s+not\s+make\s+reservation/i,
    /better\s+not\s+book\s+table/i,
    /don\'t\s+want\s+to\s+continue/i,
    /don\'t\s+want\s+to\s+proceed/i,
    /don\'t\s+want\s+to\s+go\s+ahead/i,
    /better\s+stop/i,
    /better\s+end/i,
    /better\s+hang\s+up/i,
    /better\s+go/i,
    /better\s+leave/i,
    /better\s+say\s+goodbye/i,
    /better\s+withdraw/i,
    
    // Patrones en alemán
    /nicht\s+reservieren\s+wollen/i,
    /nicht\s+reservieren\s+brauchen/i,
    /nicht\s+reservieren\s+gehen/i,
    /nicht\s+machen\s+gehen/i,
    /nicht\s+reservierung\s+machen\s+gehen/i,
    /nicht\s+tisch\s+reservieren\s+gehen/i,
    /eigentlich\s+nicht/i,
    /besser\s+nicht/i,
    /meinung\s+geändert/i,
    /meinung\s+ändern/i,
    /nicht\s+mehr\s+wollen/i,
    /nicht\s+mehr\s+brauchen/i,
    /nicht\s+mehr\s+gehen/i,
    /nicht\s+mehr\s+gehen\s+zu/i,
    /besser\s+stornieren/i,
    /stornieren\s+wollen/i,
    /stornieren\s+brauchen/i,
    /stornieren\s+wünschen/i,
    /nicht\s+interessiert/i,
    /nicht\s+überzeugt/i,
    /nicht\s+gut/i,
    /nicht\s+richtig/i,
    /nicht\s+geeignet/i,
    /nicht\s+bequem/i,
    /nicht\s+funktioniert/i,
    /besser\s+nicht\s+machen/i,
    /besser\s+nicht\s+buchen/i,
    /besser\s+nicht\s+reservierung\s+machen/i,
    /besser\s+nicht\s+tisch\s+buchen/i,
    /nicht\s+weiter\s+machen\s+wollen/i,
    /nicht\s+fortfahren\s+wollen/i,
    /nicht\s+vorwärts\s+gehen\s+wollen/i,
    /besser\s+aufhören/i,
    /besser\s+beenden/i,
    /besser\s+auflegen/i,
    /besser\s+gehen/i,
    /besser\s+verlassen/i,
    /besser\s+verabschieden/i,
    /besser\s+zurückziehen/i,
    
    // Patrones en italiano
    /non\s+vuoi\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /non\s+ho\s+bisogno\s+di\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /non\s+vado\s+a\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /in\s+realtà\s+no/i,
    /meglio\s+no/i,
    /cambiato\s+idea/i,
    /cambiare\s+idea/i,
    /non\s+vuoi\s+più/i,
    /non\s+ho\s+più\s+bisogno/i,
    /non\s+vado\s+più/i,
    /non\s+vado\s+più\s+a/i,
    /meglio\s+cancellare/i,
    /vuoi\s+cancellare/i,
    /ho\s+bisogno\s+di\s+cancellare/i,
    /desidero\s+cancellare/i,
    /non\s+interessato/i,
    /non\s+convinto/i,
    /non\s+va\s+bene/i,
    /non\s+è\s+giusto/i,
    /non\s+è\s+adatto/i,
    /non\s+è\s+conveniente/i,
    /non\s+funziona/i,
    /meglio\s+non\s+fare/i,
    /meglio\s+non\s+prenotare/i,
    /meglio\s+non\s+fare\s+prenotazione/i,
    /meglio\s+non\s+prenotare\s+tavolo/i,
    /non\s+vuoi\s+continuare/i,
    /non\s+vuoi\s+procedere/i,
    /non\s+vuoi\s+andare\s+avanti/i,
    /meglio\s+fermarsi/i,
    /meglio\s+finire/i,
    /meglio\s+riattaccare/i,
    /meglio\s+andare/i,
    /meglio\s+lasciare/i,
    /meglio\s+salutare/i,
    /meglio\s+ritirarsi/i
  ];
  
  const hasPatterns = cancellationPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones de cancelación encontrados: ${hasPatterns}`);
  
  const result = hasCancellationWords || hasSimplePatterns || hasPatterns;
  console.log(`🔍 [DEBUG] Resultado final isCancellationRequest: ${result}`);
  console.log(`🔍 [DEBUG] - Palabras: ${hasCancellationWords}`);
  console.log(`🔍 [DEBUG] - Patrones simples: ${hasSimplePatterns}`);
  console.log(`🔍 [DEBUG] - Patrones complejos: ${hasPatterns}`);
  
  return result;
}

function extractPeopleCount(text) {
  const wordToNumber = {
    // Español
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    // Italiano
    'uno': 1, 'una': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'undici': 11, 'dodici': 12, 'tredici': 13, 'quattordici': 14, 'quindici': 15,
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'elf': 11, 'zwölf': 12, 'dreizehn': 13, 'vierzehn': 14, 'fünfzehn': 15,
    'sechzehn': 16, 'siebzehn': 17, 'achtzehn': 18, 'neunzehn': 19, 'zwanzig': 20
  };

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different',
    'nein', 'besser', 'warte', 'entschuldigung', 'verzeihung', 'korrigieren',
    'ändern', 'verschieden', 'anders', 'nicht', 'falsch', 'fehler',
    'no', 'meglio', 'aspetta', 'scusa', 'correggere', 'cambiare', 'diverso',
    'non', 'mieux', 'attendre', 'excuse', 'corriger', 'changer', 'différent',
    'não', 'melhor', 'espera', 'desculpa', 'corrigir', 'mudar', 'diferente'
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
  
  // Manejar fechas en italiano
  if (textToAnalyze.includes('oggi')) {
    console.log('✅ Detectado: oggi (hoy en italiano)');
    return formatDateISO(today);
  }
  
  if (textToAnalyze.includes('domani')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: domani (mañana en italiano)');
    return formatDateISO(date);
  }
  
  if (textToAnalyze.includes('dopodomani')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    console.log('✅ Detectado: dopodomani (pasado mañana en italiano)');
    return formatDateISO(date);
  }

  // Mapeo de nombres de meses en español, inglés e italiano (ANTES de días de la semana para priorizar)
  const monthNames = {
    // Español
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
    // Inglés
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // Italiano
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4,
    'maggio': 5, 'giugno': 6, 'luglio': 7, 'agosto': 8,
    'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
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
    'friday': 5, 'saturday': 6, 'sunday': 0,
    // Italiano
    'lunedì': 1, 'martedì': 2, 'mercoledì': 3, 'giovedì': 4,
    'venerdì': 5, 'sabato': 6, 'domenica': 0,
    'lunedi': 1, 'martedi': 2, 'mercoledi': 3, 'giovedi': 4,
    'venerdi': 5
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
