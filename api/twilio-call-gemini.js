const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

module.exports = async function handler(req, res) {
  console.log('📞 Twilio Call recibida (GEMINI)');
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
      conversationHistory: []
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
    const twiml = generateTwiML(response);
    
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

  switch (step) {
    case 'greeting':
      // Primera interacción - saludo general (generado por Gemini)
      state.step = 'ask_intention';
      const greetingMessage = await generateBotResponse('greeting', state);
      return {
        message: greetingMessage,
        gather: true
      };

    case 'ask_intention':
      // Usar Gemini para entender la intención
      const intentionResult = await analyzeIntentionWithGemini(text, state);
      
      if (intentionResult.action === 'reservation') {
        state.step = 'ask_people';
        const reservationMessage = await generateBotResponse('ask_people', state);
        return {
          message: reservationMessage,
          gather: true
        };
      } else if (intentionResult.action === 'clarify') {
        return {
          message: intentionResult.message,
          gather: true
        };
      } else {
        const clarifyMessage = await generateBotResponse('clarify_intention', state);
        return {
          message: clarifyMessage,
          gather: true
        };
      }

    case 'ask_people':
      // Usar Gemini para extraer información compleja
      const extractedInfo = await extractInfoWithGemini(text, state, 'people');
      const people = extractedInfo.people || extractPeopleCount(text);
      
      if (people) {
        state.data.NumeroReserva = people;
        state.step = 'ask_date';
        const peopleMessage = await generateBotResponse('ask_date', state, { people });
        return {
          message: peopleMessage,
          gather: true
        };
      } else {
        const errorMessage = await generateBotResponse('error_people', state);
        return {
          message: errorMessage,
          gather: true
        };
      }

    case 'ask_date':
      const dateExtracted = await extractInfoWithGemini(text, state, 'date');
      const date = dateExtracted.date || extractDate(text);
      
      if (date) {
        state.data.FechaReserva = date;
        state.step = 'ask_time';
        const dateMessage = await generateBotResponse('ask_time', state, { date: formatDateSpanish(date) });
        return {
          message: dateMessage,
          gather: true
        };
      } else {
        const errorMessage = await generateBotResponse('error_date', state);
        return {
          message: errorMessage,
          gather: true
        };
      }

    case 'ask_time':
      const timeExtracted = await extractInfoWithGemini(text, state, 'time');
      const time = timeExtracted.time || extractTime(text);
      
      if (time) {
        state.data.HoraReserva = time;
        state.step = 'ask_name';
        const timeMessage = await generateBotResponse('ask_name', state, { time });
        return {
          message: timeMessage,
          gather: true
        };
      } else {
        const errorMessage = await generateBotResponse('error_time', state);
        return {
          message: errorMessage,
          gather: true
        };
      }

    case 'ask_name':
      const name = extractName(text);
      if (name) {
        state.data.NomReserva = name;
        state.step = 'ask_phone';
        const nameMessage = await generateBotResponse('ask_phone', state, { name });
        return {
          message: nameMessage,
          gather: true
        };
      } else {
        const errorMessage = await generateBotResponse('error_name', state);
        return {
          message: errorMessage,
          gather: true
        };
      }

    case 'ask_phone':
      // Verificar si quiere usar el número actual o dar otro
      if (text.includes('este') || text.includes('mismo') || text.includes('si') || text.includes('sí') || text.includes('vale') || text.includes('ok')) {
        state.data.TelefonReserva = state.phone;
        state.step = 'confirm';
        return {
          message: getConfirmationMessage(state.data),
          gather: true
        };
      } else if (text.includes('otro') || text.includes('diferente') || text.includes('no')) {
        state.step = 'ask_phone_number';
        const phoneMessage = await generateBotResponse('ask_phone_number', state);
        return {
          message: phoneMessage,
          gather: true
        };
      } else {
        const phoneMatch = text.match(/\d{9,}/);
        if (phoneMatch) {
          state.data.TelefonReserva = phoneMatch[0];
          state.step = 'confirm';
          return {
            message: getConfirmationMessage(state.data),
            gather: true
          };
        } else {
          const retryMessage = await generateBotResponse('retry_phone', state);
          return {
            message: retryMessage,
            gather: true
          };
        }
      }

    case 'ask_phone_number':
      const extractedPhone = extractPhoneNumber(text);
      if (extractedPhone && extractedPhone.length >= 9) {
        state.data.TelefonReserva = extractedPhone;
        state.step = 'confirm';
        return {
          message: getConfirmationMessage(state.data),
          gather: true
        };
      } else {
        const errorMessage = await generateBotResponse('error_phone', state);
        return {
          message: errorMessage,
          gather: true
        };
      }

    case 'confirm':
      const confirmationResult = await analyzeConfirmationWithGemini(text, state);
      
      if (confirmationResult.action === 'confirm') {
        state.step = 'complete';
        const confirmMessage = await generateBotResponse('complete', state);
        return {
          message: confirmMessage,
          gather: false
        };
      } else if (confirmationResult.action === 'modify') {
        return handleModificationRequest(state, confirmationResult.modification);
      } else if (confirmationResult.action === 'restart') {
        state.step = 'ask_people';
        state.data = {};
        const restartMessage = await generateBotResponse('restart', state);
        return {
          message: restartMessage,
          gather: true
        };
      } else if (confirmationResult.action === 'clarify') {
        return {
          message: confirmationResult.message,
          gather: true
        };
      } else {
        const clarifyMessage = await generateBotResponse('clarify_confirmation', state);
        return {
          message: clarifyMessage,
          gather: true
        };
      }

    default:
      state.step = 'greeting';
      const defaultMessage = await generateBotResponse('greeting', state);
      return {
        message: defaultMessage,
        gather: true
      };
  }
}

// ========================================
// FUNCIONES DE GEMINI
// ========================================

async function generateBotResponse(step, state, context = {}) {
  const prompts = {
    greeting: "Eres una recepcionista amable de un restaurante. Saluda y pregunta en qué puedes ayudar. Máximo 15 palabras. Sé natural y cálida.",
    
    ask_people: `Di "Perfecto, encantado de ayudarle" y pregunta para cuántas personas de forma natural. Máximo 15 palabras.`,
    
    ask_date: `El cliente reserva para ${context.people} persona(s). Confirma el número y pregunta qué día prefieren de forma natural. Máximo 15 palabras.`,
    
    ask_time: `La reserva es para el ${context.date}. Confirma la fecha y pregunta a qué hora de forma natural. Máximo 15 palabras.`,
    
    ask_name: `La hora es ${context.time}. Confirma la hora y pregunta el nombre de forma natural. Máximo 12 palabras.`,
    
    ask_phone: `El nombre es ${context.name}. Confirma el nombre y pregunta si desea usar este número de teléfono o dar otro. Máximo 15 palabras.`,
    
    ask_phone_number: "Pregunta qué número de teléfono prefiere de forma natural. Máximo 10 palabras.",
    
    complete: "Di que la reserva está confirmada, que les esperan y despídete cordialmente. Máximo 15 palabras.",
    
    error_people: "Disculpa educadamente y pide el número de personas de nuevo. Máximo 12 palabras.",
    
    error_date: "Disculpa educadamente y pide la fecha de nuevo (pueden decir mañana, pasado mañana, o día específico). Máximo 15 palabras.",
    
    error_time: "Disculpa educadamente y pide la hora de nuevo. Máximo 12 palabras.",
    
    error_name: "Disculpa educadamente y pide el nombre de nuevo. Máximo 10 palabras.",
    
    error_phone: "Disculpa educadamente y pide el teléfono dígito por dígito. Máximo 12 palabras.",
    
    retry_phone: "Pregunta si desea usar este número o prefiere dar otro. Máximo 12 palabras.",
    
    clarify_intention: "Pregunta educadamente si desea hacer una reserva. Máximo 10 palabras.",
    
    clarify_confirmation: "Pregunta si los datos son correctos, puede decir sí, no, o qué quiere cambiar. Máximo 12 palabras.",
    
    restart: "Di 'De acuerdo, empezamos de nuevo' y pregunta para cuántas personas. Máximo 12 palabras."
  };

  try {
    const prompt = prompts[step] || prompts.greeting;
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // Limpiar la respuesta (quitar comillas si las tiene)
    const cleanResponse = response.replace(/^["']|["']$/g, '');
    
    console.log(`🤖 Gemini generó (${step}):`, cleanResponse);
    return cleanResponse;
  } catch (error) {
    console.error('❌ Error generando con Gemini:', error);
    // Fallback a mensajes por defecto
    return getFallbackMessage(step, context);
  }
}

async function extractInfoWithGemini(userInput, state, field) {
  const prompts = {
    people: `
Usuario dice: "${userInput}"

Extrae SOLO el número de personas mencionado. 
Si dice "no mejor X", devuelve X (el último número).
Si no menciona número, devuelve null.

Responde SOLO con JSON: {"people": número o null}
`,
    
    date: `
Usuario dice: "${userInput}"

Extrae la fecha mencionada.
Hoy es ${new Date().toLocaleDateString('es-ES')}.
Si dice "mañana", devuelve la fecha de mañana en formato YYYY-MM-DD.
Si dice "pasado mañana", devuelve dentro de 2 días.
Si dice un día de la semana (lunes, martes, etc), calcula la fecha del próximo.
Si dice un mes y día (10 de octubre), calcula la fecha.
Si no menciona fecha, devuelve null.

Responde SOLO con JSON: {"date": "YYYY-MM-DD" o null}
`,
    
    time: `
Usuario dice: "${userInput}"

Extrae la hora mencionada.
Si dice "las ocho", convierte a formato 20:00 (asume noche si es hora de cena).
Si dice "ocho y media", convierte a 20:30.
Si dice "no mejor X", devuelve X (la última hora).
Si no menciona hora, devuelve null.

Responde SOLO con JSON: {"time": "HH:MM" o null}
`
  };

  try {
    const prompt = prompts[field];
    if (!prompt) return {};
    
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    // Extraer JSON de la respuesta
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`🤖 Gemini extrajo (${field}):`, parsed);
      return parsed;
    }
    
    return {};
  } catch (error) {
    console.error('❌ Error extrayendo con Gemini:', error);
    return {};
  }
}

async function analyzeIntentionWithGemini(userInput, state) {
  const prompt = `
Usuario dice: "${userInput}"

Determina la intención del usuario:
- Si quiere hacer una reserva (menciona "reserva", "mesa", "quiero", "sí"): devuelve "reservation"
- Si dice "no" o no quiere reserva: devuelve "decline"
- Si no está claro: devuelve "unclear"

Responde SOLO con JSON: {"action": "reservation" | "decline" | "unclear"}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('🤖 Gemini analizó intención:', parsed);
      
      if (parsed.action === 'reservation') {
        return { action: 'reservation' };
      } else if (parsed.action === 'decline') {
        return { 
          action: 'clarify', 
          message: 'Entiendo. Si cambia de opinión y quiere hacer una reserva, solo dígamelo.' 
        };
      } else {
        return {
          action: 'clarify',
          message: '¿Le gustaría hacer una reserva para nuestro restaurante?'
        };
      }
    }
    
    return { action: 'clarify', message: '¿Le gustaría hacer una reserva?' };
  } catch (error) {
    console.error('❌ Error analizando intención:', error);
    return { action: 'reservation' }; // Asumir reserva por defecto
  }
}

async function analyzeConfirmationWithGemini(userInput, state) {
  const prompt = `
Usuario dice: "${userInput}"
Contexto: Estamos confirmando una reserva.

Determina qué quiere hacer el usuario:
- Si confirma (dice "sí", "correcto", "perfecto", "ok"): devuelve "confirm"
- Si quiere cambiar algo específico (menciona "personas", "fecha", "hora", "nombre", "teléfono"): devuelve "modify" y qué campo
- Si dice "no" o "cambiar" sin especificar: devuelve "clarify"
- Si quiere empezar de nuevo: devuelve "restart"

Responde SOLO con JSON: {"action": "confirm" | "modify" | "clarify" | "restart", "modification": "people" | "date" | "time" | "name" | "phone" o null}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response.text().trim();
    
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('🤖 Gemini analizó confirmación:', parsed);
      return parsed;
    }
    
    return { action: 'clarify', message: '¿Es correcto?' };
  } catch (error) {
    console.error('❌ Error analizando confirmación:', error);
    // Fallback a lógica básica
    return handleConfirmationResponse(userInput);
  }
}

function getFallbackMessage(step, context = {}) {
  const fallbacks = {
    greeting: '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
    ask_people: '¡Perfecto! ¿Para cuántas personas?',
    ask_date: `Excelente, ${context.people} personas. ¿Para qué día?`,
    ask_time: `Perfecto, ${context.date}. ¿A qué hora?`,
    ask_name: `Muy bien, a las ${context.time}. ¿Su nombre?`,
    ask_phone: `Perfecto, ${context.name}. ¿Desea usar este número o prefiere otro?`,
    ask_phone_number: '¿Qué número de teléfono prefiere?',
    complete: '¡Perfecto! Su reserva está confirmada. Les esperamos. ¡Buen día!',
    error_people: 'Disculpe, no entendí. ¿Cuántas personas serán?',
    error_date: 'No entendí la fecha. ¿Qué día prefieren?',
    error_time: 'No entendí la hora. ¿A qué hora prefieren?',
    error_name: 'Disculpe, ¿cómo se llama?',
    error_phone: 'No entendí el número. ¿Podría decirlo dígito por dígito?',
    retry_phone: '¿Desea usar este número o prefiere dar otro?',
    clarify_intention: '¿Le gustaría hacer una reserva?',
    clarify_confirmation: '¿Es correcto?',
    restart: 'De acuerdo, empezamos de nuevo. ¿Para cuántas personas?'
  };
  
  return fallbacks[step] || fallbacks.greeting;
}

// ========================================
// FUNCIONES ORIGINALES (sin cambios)
// ========================================

function generateTwiML(response) {
  const { message, gather = true } = response;

  if (gather) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call-gemini" 
    method="POST"
    language="es-ES"
     speechTimeout="1"
     timeout="3">
    <Say voice="Google.es-ES-Neural2-B" language="es-ES">${escapeXml(message)}</Say>
  </Gather>
   <Say voice="Google.es-ES-Neural2-B" language="es-ES">No escuché respuesta. ¿Sigue ahí?</Say>
  <Redirect>/api/twilio-call-gemini</Redirect>
</Response>`;
  } else {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.es-ES-Neural2-B" language="es-ES">${escapeXml(message)}</Say>
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

    // Preparar conversación completa
    const conversacionCompleta = JSON.stringify({
      phone: state.phone,
      history: state.conversationHistory,
      gemini: true, // Marcar que fue generado con Gemini
      timestamp: new Date().toISOString()
    });

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
        'Reserva realizada por teléfono (Twilio + Gemini AI)',
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

function handleConfirmationResponse(text) {
  const positiveWords = [
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo'
  ];
  
  const negativeWords = [
    'no', 'incorrecto', 'mal', 'error', 'cambiar', 'modificar', 'corregir',
    'no es', 'no está bien', 'no me parece', 'discrepo', 'no acepto'
  ];
  
  const restartWords = [
    'empezar de nuevo', 'volver a empezar', 'reiniciar', 'otra vez', 'de nuevo',
    'cambiar todo', 'empezamos otra vez', 'resetear'
  ];
  
  const lowerText = text.toLowerCase();
  
  if (positiveWords.some(word => lowerText.includes(word))) {
    return { action: 'confirm' };
  }
  
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { action: 'clarify', message: 'Entiendo. ¿Qué le gustaría cambiar?' };
  }
  
  if (restartWords.some(word => lowerText.includes(word))) {
    return { action: 'restart' };
  }
  
  const modifications = detectSpecificModifications(lowerText);
  if (modifications.length > 0) {
    return { action: 'modify', modification: modifications[0] };
  }
  
  return { action: 'clarify', message: '¿Es correcto?' };
}

function detectSpecificModifications(text) {
  const modifications = [];
  
  if (text.includes('personas') || text.includes('gente') || text.includes('comensales')) {
    modifications.push('people');
  }
  if (text.includes('fecha') || text.includes('día') || text.includes('cuando')) {
    modifications.push('date');
  }
  if (text.includes('hora') || text.includes('tiempo')) {
    modifications.push('time');
  }
  if (text.includes('nombre')) {
    modifications.push('name');
  }
  if (text.includes('teléfono') || text.includes('número')) {
    modifications.push('phone');
  }
  
  return modifications;
}

async function handleModificationRequest(state, modification) {
  const messages = {
    people: 'Perfecto. ¿Para cuántas personas?',
    date: 'Perfecto. ¿Para qué fecha?',
    time: 'Perfecto. ¿A qué hora?',
    name: 'Perfecto. ¿Su nombre?',
    phone: 'Perfecto. ¿Desea usar este número o prefiere otro?'
  };

  const steps = {
    people: 'ask_people',
    date: 'ask_date',
    time: 'ask_time',
    name: 'ask_name',
    phone: 'ask_phone'
  };

  state.step = steps[modification] || 'ask_people';
  
  // Generar mensaje con Gemini
  const message = await generateBotResponse(`retry_${modification}`, state).catch(() => messages[modification]);
  
  return {
    message: message || messages[modification] || '¿Qué desea cambiar?',
    gather: true
  };
}

function extractPeopleCount(text) {
  const wordToNumber = {
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15
  };

  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundNumbers = [];

  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      foundNumbers.push({ number, position: match.index });
    }
  }

  const digitMatches = text.matchAll(/\b(\d+)\b/g);
  for (const match of digitMatches) {
    const count = parseInt(match[1]);
    if (count >= 1 && count <= 20) {
      foundNumbers.push({ number: count, position: match.index });
    }
  }

  if (foundNumbers.length === 0) return null;

  if (hasCorrection || foundNumbers.length > 1) {
    foundNumbers.sort((a, b) => b.position - a.position);
    return foundNumbers[0].number;
  }

  return foundNumbers[0].number;
}

function extractDate(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

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

  if (textToAnalyze.includes('pasado mañana') || (textToAnalyze.includes('pasado') && textToAnalyze.includes('mañana'))) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return formatDateISO(date);
  }
  
  if (textToAnalyze.includes('mañana') && !textToAnalyze.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return formatDateISO(date);
  }
  
  if (textToAnalyze.includes('hoy')) {
    return formatDateISO(today);
  }

  const monthNames = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
  };

  for (const [monthName, monthNumber] of Object.entries(monthNames)) {
    if (textToAnalyze.includes(monthName)) {
      const patterns = [
        new RegExp(`(\\d{1,2})\\s*de\\s*${monthName}`, 'i'),
        new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i'),
        new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i'),
      ];
      
      for (const pattern of patterns) {
        const match = textToAnalyze.match(pattern);
        if (match) {
          const day = parseInt(match[1]);
          
          if (day >= 1 && day <= 31) {
            const year = today.getFullYear();
            try {
              const date = new Date(year, monthNumber - 1, day);
              if (date < today) {
                date.setFullYear(year + 1);
              }
              return formatDateISO(date);
            } catch (e) {
              return null;
            }
          }
        }
      }
    }
  }

  const daysOfWeek = {
    'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
    'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
  };

  for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
    if (textToAnalyze.includes(dayName)) {
      const currentDay = today.getDay();
      let daysUntil = dayNumber - currentDay;
      
      if (daysUntil <= 0) {
        daysUntil += 7;
      }
      
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

  return null;
}

function extractTime(text) {
  const wordToNumber = {
    'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12
  };

  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundTimes = [];

  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      let hours = number;
      let minutes = 0;

      if (text.includes('media') || text.includes('treinta')) {
        minutes = 30;
      } else if (text.includes('cuarto') || text.includes('quince')) {
        minutes = 15;
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

  if (hasCorrection || foundTimes.length > 1) {
    foundTimes.sort((a, b) => b.position - a.position);
    return foundTimes[0].time;
  }

  return foundTimes[0].time;
}

function extractName(text) {
  const cleaned = text
    .replace(/mi nombre es/gi, '')
    .replace(/me llamo/gi, '')
    .replace(/soy/gi, '')
    .trim();
  
  if (cleaned.length > 1) {
    return cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return null;
}

function extractPhoneNumber(text) {
  const directMatch = text.match(/\d{9,}/);
  if (directMatch) {
    return directMatch[0];
  }

  const wordToDigit = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 
    'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 
    'ocho': '8', 'nueve': '9'
  };

  let phoneNumber = '';
  const words = text.split(/\s+/);
  
  for (const word of words) {
    const cleanWord = word.toLowerCase().replace(/[,\.]/g, '');
    if (wordToDigit[cleanWord]) {
      phoneNumber += wordToDigit[cleanWord];
    } else if (/^\d$/.test(cleanWord)) {
      phoneNumber += cleanWord;
    }
  }

  if (phoneNumber.length >= 9) {
    return phoneNumber;
  }

  return null;
}

function getConfirmationMessage(data) {
  const phoneFormatted = formatPhoneForSpeech(data.TelefonReserva);
  return `Confirmo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'personas'}, ${formatDateSpanish(data.FechaReserva)} a las ${data.HoraReserva}, a nombre de ${data.NomReserva}, teléfono ${phoneFormatted}. ¿Es correcto?`;
}

function formatPhoneForSpeech(phone) {
  const cleanPhone = phone.replace(/\D/g, '');
  
  const digitWords = {
    '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
    '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
  };
  
  let result = '';
  for (let i = 0; i < cleanPhone.length; i++) {
    result += digitWords[cleanPhone[i]];
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
  const [year, month, day] = dateStr.split('-');
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
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

