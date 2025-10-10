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
    greeting: `Eres un recepcionista masculino profesional de un restaurante español. 
Tu tono es amable, directo y eficiente (no cursi ni excesivamente formal).
Genera UN SOLO saludo breve preguntando en qué puedes ayudar.
Ejemplos del estilo que debes imitar:
- "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?"
- "¡Buenos días! ¿Cómo puedo ayudarle?"
- "¡Hola! ¿Qué necesita?"
Genera UNA variación similar pero diferente. Máximo 12 palabras. Solo la frase, sin comillas ni explicaciones.`,
    
    ask_people: `Eres un recepcionista masculino profesional. El cliente quiere hacer una reserva.
Genera UNA frase que:
1. Confirme brevemente que le ayudarás (ej: "Perfecto", "Excelente", "Muy bien")
2. Pregunte para cuántas personas
Ejemplos del estilo:
- "¡Perfecto! ¿Para cuántas personas?"
- "¡Excelente! ¿Cuántas personas serán?"
- "¡Muy bien! ¿Para cuántos?"
Genera UNA variación similar. Máximo 10 palabras. Solo la frase.`,
    
    ask_date: `Eres un recepcionista masculino. El cliente reserva para ${context.people} persona(s).
Genera UNA frase que:
1. Confirme brevemente el número (ej: "Perfecto, ${context.people} personas")
2. Pregunte qué día
Ejemplos del estilo:
- "Perfecto, ${context.people} personas. ¿Para qué día?"
- "Muy bien, ${context.people} personas. ¿Qué día prefieren?"
- "Excelente, ${context.people} personas. ¿Cuándo?"
Genera UNA variación similar. Máximo 12 palabras. Solo la frase.`,
    
    ask_time: `Eres un recepcionista masculino. La reserva es para el ${context.date}.
Genera UNA frase que:
1. Confirme brevemente la fecha (ej: "Perfecto, ${context.date}")
2. Pregunte la hora
Ejemplos del estilo:
- "Perfecto, ${context.date}. ¿A qué hora?"
- "Muy bien, ${context.date}. ¿Qué hora les conviene?"
- "Excelente, ${context.date}. ¿A qué hora prefieren?"
Genera UNA variación similar. Máximo 11 palabras. Solo la frase.`,
    
    ask_name: `Eres un recepcionista masculino. La hora de reserva es las ${context.time}.
Genera UNA frase que:
1. Confirme brevemente la hora (ej: "Perfecto, a las ${context.time}")
2. Pregunte el nombre
Ejemplos del estilo:
- "Perfecto, a las ${context.time}. ¿Su nombre?"
- "Muy bien, a las ${context.time}. ¿Cómo se llama?"
- "Excelente, a las ${context.time}. ¿Su nombre, por favor?"
Genera UNA variación similar. Máximo 10 palabras. Solo la frase.`,
    
    ask_phone: `Eres un recepcionista masculino. El nombre del cliente es ${context.name}.
Genera UNA frase que:
1. Confirme brevemente el nombre (ej: "Perfecto, ${context.name}")
2. Pregunte si desea usar este número de teléfono o dar otro
Ejemplos del estilo:
- "Perfecto, ${context.name}. ¿Usa este número o prefiere otro?"
- "Muy bien, ${context.name}. ¿Este teléfono está bien?"
- "Excelente, ${context.name}. ¿Le sirve este número?"
Genera UNA variación similar. Máximo 13 palabras. Solo la frase.`,
    
    ask_phone_number: `Eres un recepcionista masculino profesional.
Genera UNA pregunta breve pidiendo el número de teléfono.
Ejemplos del estilo:
- "¿Qué número de teléfono prefiere?"
- "¿Su número de teléfono?"
- "¿Cuál es su teléfono?"
Genera UNA variación similar. Máximo 8 palabras. Solo la frase.`,
    
    complete: `Eres un recepcionista masculino profesional. La reserva está confirmada.
Genera UNA frase que:
1. Confirme que está todo listo
2. Diga que les esperan
3. Se despida cordialmente
Ejemplos del estilo:
- "¡Perfecto! Su reserva está confirmada. Les esperamos. ¡Buen día!"
- "¡Excelente! Todo listo. Nos vemos pronto. ¡Que disfruten!"
- "¡Muy bien! Reserva confirmada. Les esperamos. ¡Hasta pronto!"
Genera UNA variación similar. Máximo 14 palabras. Solo la frase.`,
    
    error_people: `Eres un recepcionista masculino. No entendiste el número de personas.
Genera UNA disculpa breve y vuelve a preguntar.
Ejemplos del estilo:
- "Disculpe, no entendí. ¿Cuántas personas serán?"
- "Perdón, ¿para cuántas personas?"
- "No capté bien. ¿Cuántos serán?"
Genera UNA variación similar. Máximo 9 palabras. Solo la frase.`,
    
    error_date: `Eres un recepcionista masculino. No entendiste la fecha.
Genera UNA disculpa breve y vuelve a preguntar la fecha.
Ejemplos del estilo:
- "No entendí la fecha. ¿Qué día prefieren?"
- "Perdón, ¿para qué día?"
- "Disculpe, ¿qué día les conviene?"
Genera UNA variación similar. Máximo 9 palabras. Solo la frase.`,
    
    error_time: `Eres un recepcionista masculino. No entendiste la hora.
Genera UNA disculpa breve y vuelve a preguntar la hora.
Ejemplos del estilo:
- "No entendí la hora. ¿A qué hora prefieren?"
- "Perdón, ¿a qué hora?"
- "Disculpe, ¿qué hora les conviene?"
Genera UNA variación similar. Máximo 9 palabras. Solo la frase.`,
    
    error_name: `Eres un recepcionista masculino. No entendiste el nombre.
Genera UNA disculpa breve y pide el nombre de nuevo.
Ejemplos del estilo:
- "Disculpe, no entendí su nombre. ¿Cómo se llama?"
- "Perdón, ¿su nombre?"
- "No capté. ¿Cómo se llama?"
Genera UNA variación similar. Máximo 8 palabras. Solo la frase.`,
    
    error_phone: `Eres un recepcionista masculino. No entendiste el teléfono.
Genera UNA disculpa breve y pide el teléfono dígito por dígito.
Ejemplos del estilo:
- "No entendí el número. ¿Puede decirlo dígito por dígito?"
- "Perdón, ¿el teléfono? Dígito por dígito."
- "Disculpe, repita el número despacio."
Genera UNA variación similar. Máximo 10 palabras. Solo la frase.`,
    
    retry_phone: `Eres un recepcionista masculino. Pregunta si quiere usar este número u otro.
Ejemplos del estilo:
- "¿Desea usar este número o prefiere otro?"
- "¿Este teléfono está bien o da otro?"
- "¿Le sirve este número?"
Genera UNA variación similar. Máximo 9 palabras. Solo la frase.`,
    
    clarify_intention: `Eres un recepcionista masculino. No está claro si el cliente quiere reservar.
Genera UNA pregunta breve y directa.
Ejemplos del estilo:
- "¿Le gustaría hacer una reserva?"
- "¿Desea reservar mesa?"
- "¿Quiere hacer una reserva?"
Genera UNA variación similar. Máximo 7 palabras. Solo la frase.`,
    
    clarify_confirmation: `Eres un recepcionista masculino. Pregunta si los datos de la reserva son correctos.
Ejemplos del estilo:
- "¿Es correcto? Puede decir sí o qué quiere cambiar."
- "¿Todo bien? Diga sí para confirmar o qué cambiar."
- "¿Correcto? Confirme o diga qué modificar."
Genera UNA variación similar. Máximo 11 palabras. Solo la frase.`,
    
    restart: `Eres un recepcionista masculino. El cliente quiere empezar de nuevo.
Genera UNA frase que confirme y pregunte para cuántas personas.
Ejemplos del estilo:
- "De acuerdo, empezamos de nuevo. ¿Para cuántas personas?"
- "Perfecto, de nuevo. ¿Cuántas personas?"
- "Vale, desde el inicio. ¿Para cuántos?"
Genera UNA variación similar. Máximo 10 palabras. Solo la frase.`
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
  const today = new Date();
  const prompts = {
    people: `Eres un asistente experto en extraer información de reservas en español.

Usuario dice: "${userInput}"

Tu tarea: Extraer el número de personas.

REGLAS:
1. Si dice números en palabras (uno, dos, tres...) o dígitos (1, 2, 3...), extrae el número
2. Si menciona VARIOS números y dice "no" o "mejor", devuelve SOLO el ÚLTIMO número mencionado
3. Si dice "para 3, no mejor 4" → devuelve 4
4. Si dice "mesa para 5" → devuelve 5
5. Si NO menciona ningún número → devuelve null

Responde SOLO con JSON válido: {"people": número o null}
Ejemplo: {"people": 4}`,
    
    date: `Eres un asistente experto en extraer fechas en español.

Usuario dice: "${userInput}"
HOY es: ${today.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Tu tarea: Extraer la fecha de la reserva en formato YYYY-MM-DD.

REGLAS PARA FECHAS:
1. "hoy" → ${formatDateISO(today)}
2. "mañana" → fecha de mañana
3. "pasado mañana" → dentro de 2 días (NO confundir con "mañana")
4. "viernes", "lunes", etc. → próximo día de esa semana
5. "el viernes que viene" → siguiente semana
6. "10 de octubre", "15 de marzo" → calcula la fecha completa (si ya pasó este año, usar año siguiente)
7. Si menciona VARIAS fechas y dice "no" o "mejor", usa SOLO la ÚLTIMA
8. Si NO menciona fecha → null

Responde SOLO con JSON válido: {"date": "YYYY-MM-DD" o null}
Ejemplo: {"date": "2025-10-15"}`,
    
    time: `Eres un asistente experto en extraer horas para reservas de restaurante.

Usuario dice: "${userInput}"

Tu tarea: Extraer la hora en formato 24h (HH:MM).

REGLAS PARA HORAS:
1. "las ocho", "a las 8" → 20:00 (asumir NOCHE para restaurantes, añadir 12 si es < 12)
2. "ocho y media", "8:30" → 20:30
3. "nueve menos cuarto" → 20:45
4. "a las dos de la tarde" → 14:00
5. "a las diez de la noche" → 22:00
6. Si menciona VARIAS horas y dice "no" o "mejor", usa SOLO la ÚLTIMA
7. Horas típicas de restaurante: 13:00-16:00 (almuerzo) o 19:00-23:00 (cena)
8. Si NO menciona hora → null

Responde SOLO con JSON válido: {"time": "HH:MM" o null}
Ejemplo: {"time": "20:30"}`
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
  const prompt = `Eres un asistente experto en entender intenciones de clientes en un restaurante.

El recepcionista preguntó: "¿En qué puedo ayudarle?"
Usuario responde: "${userInput}"

Tu tarea: Determinar si el cliente quiere hacer una RESERVA o no.

ANÁLISIS:
1. Palabras que indican RESERVA: "reservar", "mesa", "quiero", "necesito", "sí", "si", "vale", "ok", "adelante", "quisiera", "me gustaría"
2. Palabras que indican RECHAZO: "no", "nada", "solo llamo para preguntar", "información", "cancelar"
3. Si NO está claro → "unclear"

DECISIÓN:
- Si claramente quiere reserva → {"action": "reservation"}
- Si claramente NO quiere → {"action": "decline"}
- Si no está claro → {"action": "unclear"}

Responde SOLO con JSON válido: {"action": "reservation" | "decline" | "unclear"}
Ejemplo: {"action": "reservation"}`;

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
  const reservationData = state.data;
  const prompt = `Eres un asistente experto en confirmar reservas de restaurante.

El recepcionista acaba de leer los datos de la reserva:
- ${reservationData.NumeroReserva} persona(s)
- ${formatDateSpanish(reservationData.FechaReserva)}
- ${reservationData.HoraReserva}
- ${reservationData.NomReserva}
- Teléfono: ${reservationData.TelefonReserva}

Usuario responde: "${userInput}"

Tu tarea: Determinar qué quiere hacer el cliente.

OPCIONES:
1. CONFIRMAR → Cliente dice "sí", "correcto", "perfecto", "ok", "bien", "vale", "exacto", "confirmo", "adelante"
   → {"action": "confirm"}

2. MODIFICAR ALGO ESPECÍFICO → Cliente menciona QUÉ quiere cambiar:
   - "cambiar personas", "para 5 no mejor 6" → {"action": "modify", "modification": "people"}
   - "cambiar fecha", "otro día", "mañana no" → {"action": "modify", "modification": "date"}
   - "cambiar hora", "más tarde", "a las 9" → {"action": "modify", "modification": "time"}
   - "cambiar nombre", "mal nombre" → {"action": "modify", "modification": "name"}
   - "cambiar teléfono", "otro número" → {"action": "modify", "modification": "phone"}

3. NEGAR SIN ESPECIFICAR → Cliente dice "no", "mal", "incorrecto" pero NO dice QUÉ cambiar
   → {"action": "clarify"}

4. EMPEZAR DE NUEVO → Cliente dice "empezar de nuevo", "volver a empezar", "otra vez todo"
   → {"action": "restart"}

Responde SOLO con JSON válido: {"action": "confirm" | "modify" | "clarify" | "restart", "modification": "people" | "date" | "time" | "name" | "phone" | null}
Ejemplos:
{"action": "confirm"}
{"action": "modify", "modification": "time"}
{"action": "clarify"}`;

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

function generateMarkdownConversation(state) {
  const { conversationHistory, phone, data } = state;
  const timestamp = new Date().toISOString();
  
  let markdown = `# 📞 Conversación de Reserva\n\n`;
  
  // Información de la llamada
  markdown += `## 📋 Información de la Llamada\n`;
  markdown += `- **Teléfono**: ${phone}\n`;
  markdown += `- **Fecha**: ${new Date().toLocaleDateString('es-ES')}\n`;
  markdown += `- **Hora**: ${new Date().toLocaleTimeString('es-ES')}\n`;
  markdown += `- **Sistema**: Twilio + Gemini AI\n`;
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
  
  // Detectar problemas comunes
  markdown += `## 🔍 Detección de Problemas\n\n`;
  
  const issues = [];
  const history = conversationHistory.map(h => h.message.toLowerCase());
  
  // Detectar repeticiones
  const repeatedMessages = history.filter((msg, index) => 
    history.indexOf(msg) !== index
  );
  if (repeatedMessages.length > 0) {
    issues.push(`⚠️ Mensajes repetidos detectados (${repeatedMessages.length})`);
  }
  
  // Detectar errores de comprensión
  const errorMessages = history.filter(msg => 
    msg.includes('no entendí') || msg.includes('disculpe') || msg.includes('perdón')
  );
  if (errorMessages.length > 0) {
    issues.push(`⚠️ Errores de comprensión: ${errorMessages.length}`);
  }
  
  // Detectar conversación muy larga
  if (conversationHistory.length > 15) {
    issues.push(`⚠️ Conversación muy larga (${conversationHistory.length} intercambios)`);
  }
  
  if (issues.length === 0) {
    markdown += `✅ No se detectaron problemas significativos\n`;
  } else {
    issues.forEach(issue => markdown += `${issue}\n`);
  }
  
  markdown += `\n---\n`;
  markdown += `*Generado automáticamente el ${new Date().toLocaleString('es-ES')}*\n`;
  
  return markdown;
}

