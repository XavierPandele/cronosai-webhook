const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

export default async function handler(req, res) {
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
  <Say voice="Polly.Lucia" language="es-ES">
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
      // Detectar si es una solicitud de reserva
      if (isReservationRequest(text) || !userInput) {
        state.step = 'ask_people';
        return {
          message: userInput ? 
            '¡Perfecto! Me alegra ayudarle con su reserva. ¿Para cuántas personas sería la mesa?' :
            '¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una reserva? ¿Para cuántas personas?',
          gather: true
        };
      } else {
        return {
          message: '¿Le gustaría hacer una reserva? Diga sí para continuar.',
          gather: true
        };
      }

    case 'ask_people':
      const people = extractPeopleCount(text);
      if (people) {
        state.data.NumeroReserva = people;
        state.step = 'ask_date';
        return {
          message: `Excelente, mesa para ${people} ${people === 1 ? 'persona' : 'personas'}. ¿Para qué fecha le gustaría la reserva? Puede decir mañana, pasado mañana o una fecha específica.`,
          gather: true
        };
      } else {
        return {
          message: 'Disculpe, no entendí cuántas personas. Por favor, dígame el número de personas.',
          gather: true
        };
      }

    case 'ask_date':
      const date = extractDate(text);
      if (date) {
        state.data.FechaReserva = date;
        state.step = 'ask_time';
        return {
          message: `Perfecto, reserva para el ${formatDateSpanish(date)}. ¿A qué hora le gustaría venir? Por ejemplo: a las ocho o a las siete y media.`,
          gather: true
        };
      } else {
        return {
          message: 'Disculpe, no entendí la fecha. ¿Podría especificar la fecha? Por ejemplo: mañana, pasado mañana o quince de enero.',
          gather: true
        };
      }

    case 'ask_time':
      const time = extractTime(text);
      if (time) {
        state.data.HoraReserva = time;
        state.step = 'ask_name';
        return {
          message: `Excelente, a las ${time}. ¿Cuál es su nombre para la reserva?`,
          gather: true
        };
      } else {
        return {
          message: 'Disculpe, no entendí la hora. ¿Podría especificar la hora? Por ejemplo: a las ocho de la noche.',
          gather: true
        };
      }

    case 'ask_name':
      const name = extractName(text);
      if (name) {
        state.data.NomReserva = name;
        state.data.TelefonReserva = state.phone;
        state.step = 'confirm';
        return {
          message: getConfirmationMessage(state.data),
          gather: true
        };
      } else {
        return {
          message: 'Disculpe, no entendí su nombre. ¿Podría decirme su nombre completo?',
          gather: true
        };
      }

    case 'confirm':
      if (text.includes('si') || text.includes('sí') || text.includes('confirmo') || text.includes('correcto')) {
        state.step = 'complete';
        return {
          message: '¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá una confirmación por mensaje. ¡Esperamos darle la bienvenida! Que tenga un buen día.',
          gather: false
        };
      } else if (text.includes('no') || text.includes('cambiar')) {
        state.step = 'ask_people';
        state.data = {};
        return {
          message: 'Está bien, empecemos de nuevo. ¿Para cuántas personas sería la reserva?',
          gather: true
        };
      } else {
        return {
          message: '¿Confirma los datos de la reserva? Diga sí para confirmar o no para modificar algo.',
          gather: true
        };
      }

    default:
      state.step = 'greeting';
      return {
        message: '¿En qué puedo ayudarle? ¿Le gustaría hacer una reserva?',
        gather: true
      };
  }
}

function generateTwiML(response) {
  const { message, gather = true } = response;

  if (gather) {
    // Usar Gather para capturar la respuesta del usuario
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call" 
    method="POST"
    language="es-ES"
    speechTimeout="3"
    timeout="5">
    <Say voice="Polly.Lucia" language="es-ES">${escapeXml(message)}</Say>
  </Gather>
  <Say voice="Polly.Lucia" language="es-ES">No escuché respuesta. ¿Sigue ahí?</Say>
  <Redirect>/api/twilio-call</Redirect>
</Response>`;
  } else {
    // Solo decir el mensaje y colgar
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Lucia" language="es-ES">${escapeXml(message)}</Say>
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

function isReservationRequest(text) {
  const words = ['reservar', 'mesa', 'reserva', 'quiero', 'necesito', 'si', 'sí'];
  return words.some(word => text.includes(word));
}

function extractPeopleCount(text) {
  const wordToNumber = {
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
  };

  for (const [word, number] of Object.entries(wordToNumber)) {
    if (text.includes(word)) return number;
  }

  const match = text.match(/(\d+)/);
  if (match) {
    const count = parseInt(match[1]);
    if (count >= 1 && count <= 20) return count;
  }

  return null;
}

function extractDate(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (text.includes('mañana') && !text.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    return formatDateISO(date);
  }
  
  if (text.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    return formatDateISO(date);
  }
  
  if (text.includes('hoy')) {
    return formatDateISO(today);
  }

  // Intentar extraer fecha específica
  const dateMatch = text.match(/(\d{1,2})[\/\-\s](?:de\s)?(\d{1,2})/);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]);
    const year = today.getFullYear();
    
    try {
      const date = new Date(year, month - 1, day);
      if (date < today) {
        date.setFullYear(year + 1);
      }
      return formatDateISO(date);
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

  for (const [word, number] of Object.entries(wordToNumber)) {
    if (text.includes(word)) {
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
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
  }

  const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

    if (text.includes('noche') || text.includes('tarde')) {
      if (hours < 12) hours += 12;
    }

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  return null;
}

function extractName(text) {
  // Limpiar el texto
  const cleaned = text
    .replace(/mi nombre es/gi, '')
    .replace(/me llamo/gi, '')
    .replace(/soy/gi, '')
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

function getConfirmationMessage(data) {
  return `Perfecto, déjeme confirmar los datos de su reserva. Mesa para ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'personas'}, fecha ${formatDateSpanish(data.FechaReserva)}, hora ${data.HoraReserva}, a nombre de ${data.NomReserva}, teléfono ${data.TelefonReserva}. ¿Está todo correcto? Diga sí para confirmar o no para modificar.`;
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

