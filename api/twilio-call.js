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
      // Primera interacción - saludo general
      state.step = 'ask_intention';
      return {
        message: '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
        gather: true
      };

    case 'ask_intention':
      // Confirmar que quiere hacer una reserva
      if (isReservationRequest(text)) {
        state.step = 'ask_people';
        return {
          message: '¡Perfecto! Encantado de ayudarle con su reserva. ¿Para cuántas personas?',
          gather: true
        };
      } else {
        return {
          message: 'Disculpe, solo puedo ayudarle con reservas. ¿Le gustaría hacer una reserva?',
          gather: true
        };
      }

    case 'ask_people':
      const people = extractPeopleCount(text);
      if (people) {
        state.data.NumeroReserva = people;
        state.step = 'ask_date';
        return {
          message: `Perfecto, ${people} ${people === 1 ? 'persona' : 'personas'}. ¿Para qué fecha?`,
          gather: true
        };
      } else {
        return {
          message: 'No entendí. ¿Cuántas personas?',
          gather: true
        };
      }

    case 'ask_date':
      const date = extractDate(text);
      if (date) {
        state.data.FechaReserva = date;
        state.step = 'ask_time';
        return {
          message: `Perfecto, ${formatDateSpanish(date)}. ¿A qué hora?`,
          gather: true
        };
      } else {
        return {
          message: 'No entendí la fecha. ¿Qué día?',
          gather: true
        };
      }

    case 'ask_time':
      const time = extractTime(text);
      if (time) {
        state.data.HoraReserva = time;
        state.step = 'ask_name';
        return {
          message: `Perfecto, a las ${time}. ¿Su nombre?`,
          gather: true
        };
      } else {
        return {
          message: 'No entendí. ¿A qué hora?',
          gather: true
        };
      }

    case 'ask_name':
      const name = extractName(text);
      if (name) {
        state.data.NomReserva = name;
        state.step = 'ask_phone';
        return {
          message: `Perfecto, ${name}. ¿Desea usar este número de teléfono para la reserva, o prefiere indicar otro?`,
          gather: true
        };
      } else {
        return {
          message: 'No entendí. ¿Su nombre?',
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
          message: getConfirmationMessage(state.data),
          gather: true
        };
      } else if (text.includes('otro') || text.includes('diferente') || text.includes('no')) {
        // Preguntar por otro número
        state.step = 'ask_phone_number';
        return {
          message: '¿Qué número de teléfono prefiere?',
          gather: true
        };
      } else {
        // Intentar extraer un número directamente
        const phoneMatch = text.match(/\d{9,}/);
        if (phoneMatch) {
          state.data.TelefonReserva = phoneMatch[0];
          state.step = 'confirm';
          return {
            message: getConfirmationMessage(state.data),
            gather: true
          };
        } else {
          return {
            message: '¿Desea usar este número o prefiere dar otro?',
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
          message: getConfirmationMessage(state.data),
          gather: true
        };
      } else {
        return {
          message: 'No entendí el número. Por favor, dígalo dígito por dígito.',
          gather: true
        };
      }

    case 'confirm':
      if (text.includes('si') || text.includes('sí') || text.includes('confirmo') || text.includes('correcto')) {
        state.step = 'complete';
        return {
          message: '¡Perfecto! Su reserva está confirmada. Le esperamos. ¡Buen día!',
          gather: false
        };
      } else if (text.includes('no') || text.includes('cambiar')) {
        state.step = 'ask_people';
        state.data = {};
        return {
          message: 'De acuerdo. ¿Para cuántas personas?',
          gather: true
        };
      } else {
        return {
          message: '¿Es correcto? Diga sí o no.',
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
    speechTimeout="2"
    timeout="3">
    <Say voice="Google.es-ES-Neural2-B" language="es-ES">${escapeXml(message)}</Say>
  </Gather>
  <Say voice="Google.es-ES-Neural2-B" language="es-ES">No escuché respuesta. ¿Sigue ahí?</Say>
  <Redirect>/api/twilio-call</Redirect>
</Response>`;
  } else {
    // Solo decir el mensaje y colgar
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

  // Detectar palabras de corrección
  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
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

  // Detectar palabras de corrección
  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundDates = [];

  // Si hay corrección, buscar la última fecha mencionada
  // Dividir el texto en partes para analizar la última después de la corrección
  let textToAnalyze = text;
  if (hasCorrection) {
    // Buscar la última ocurrencia de palabras de corrección
    let lastCorrectionIndex = -1;
    correctionWords.forEach(word => {
      const index = text.lastIndexOf(word);
      if (index > lastCorrectionIndex) {
        lastCorrectionIndex = index;
      }
    });
    // Analizar solo el texto después de la corrección
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
  
  if (textToAnalyze.includes('hoy')) {
    console.log('✅ Detectado: hoy');
    return formatDateISO(today);
  }

  // Mapeo de nombres de meses en español (ANTES de días de la semana para priorizar)
  const monthNames = {
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
  };

  // Intentar extraer fecha con nombre de mes: "10 de octubre", "15 de enero"
  for (const [monthName, monthNumber] of Object.entries(monthNames)) {
    if (textToAnalyze.includes(monthName)) {
      console.log(`✅ Detectado mes: ${monthName}`);
      
      // Buscar el número antes del mes (más preciso)
      const patterns = [
        new RegExp(`(\\d{1,2})\\s*de\\s*${monthName}`, 'i'),  // "10 de octubre"
        new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i'),         // "10 octubre"
        new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i'),         // "octubre 10"
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
    'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
    'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
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

  // Intentar extraer fecha numérica: "10/10", "10-10"
  const dateMatch = textToAnalyze.match(/(\d{1,2})[\/\-\s](?:de\s)?(\d{1,2})/);
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

  // Detectar palabras de corrección
  const correctionWords = ['no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo'];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundTimes = [];

  // Buscar horas en palabras
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

  // Mapeo de palabras a dígitos
  const wordToDigit = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 
    'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 
    'ocho': '8', 'nueve': '9'
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

function getConfirmationMessage(data) {
  const phoneFormatted = formatPhoneForSpeech(data.TelefonReserva);
  return `Confirmo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'personas'}, ${formatDateSpanish(data.FechaReserva)} a las ${data.HoraReserva}, a nombre de ${data.NomReserva}, teléfono ${phoneFormatted}. ¿Es correcto?`;
}

function formatPhoneForSpeech(phone) {
  // Limpiar el teléfono de caracteres no numéricos
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Convertir cada dígito en su palabra en español con espacios para pausas
  const digitWords = {
    '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
    '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
  };
  
  // Convertir cada dígito y añadir comas para pausas naturales cada 3 dígitos
  let result = '';
  for (let i = 0; i < cleanPhone.length; i++) {
    result += digitWords[cleanPhone[i]];
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


