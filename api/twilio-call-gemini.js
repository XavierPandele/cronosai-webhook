const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

// ===== GEMINI 2.5 FLASH - INICIALIZACIÓN =====
let geminiClient = null;
function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ GOOGLE_API_KEY no configurado. Gemini no estará disponible.');
      return null;
    }
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

// ===== FUNCIÓN: Obtener horario del restaurante =====
function getRestaurantHours() {
  // Puedes configurar esto en variables de entorno
  const lunchStart = process.env.RESTAURANT_LUNCH_START || '13:00';
  const lunchEnd = process.env.RESTAURANT_LUNCH_END || '15:00';
  const dinnerStart = process.env.RESTAURANT_DINNER_START || '19:00';
  const dinnerEnd = process.env.RESTAURANT_DINNER_END || '23:00';
  
  return {
    lunch: [lunchStart, lunchEnd],
    dinner: [dinnerStart, dinnerEnd]
  };
}

// ===== FUNCIONES AUXILIARES PARA FECHAS =====
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getDayAfterTomorrowDate() {
  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  return dayAfter.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  // Siempre establecer headers primero
  res.setHeader('Content-Type', 'text/xml');
  
  console.log('📞 Twilio Call recibida');
  console.log('Method:', req.method);
  console.log('Body:', req.body);
  console.log('Body type:', typeof req.body);
  console.log('Query:', req.query);

  try {
    // Extraer parámetros de Twilio
    // Manejar todos los casos: body parseado, body string, o query string
    let params = {};
    
    if (req.body) {
      // Si req.body es un string, parsearlo manualmente (Vercel a veces no parsea application/x-www-form-urlencoded)
      if (typeof req.body === 'string') {
        const querystring = require('querystring');
        params = querystring.parse(req.body);
        console.log('📦 Body parseado manualmente como string');
      } else if (typeof req.body === 'object') {
        // Si ya es un objeto, usarlo directamente
        params = req.body;
        console.log('📦 Body usado directamente como objeto');
      }
    } else if (req.query) {
      // Si no hay body, usar query (para GET requests)
      params = req.query;
      console.log('📦 Usando query params');
    }
    
    const { 
      CallSid, 
      SpeechResult, 
      Digits,
      From,
      To,
      CallStatus 
    } = params || {};
    
    // Si no hay CallSid, generar respuesta de saludo inicial
    if (!CallSid) {
      console.warn('⚠️ CallSid no recibido. Generando respuesta de saludo inicial.');
      const greetingMessage = '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?';
      const twiml = generateTwiML({
        message: greetingMessage,
        gather: true
      }, 'es');
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(twiml);
    }

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
    console.error('🔍 [ERROR] Error message:', error.message);
    console.error('🔍 [ERROR] Error stack:', error.stack);
    console.error('🔍 [ERROR] Error name:', error.name);
    console.error('🔍 [ERROR] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    
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

// ===== GEMINI 2.5 FLASH - ANÁLISIS INTELIGENTE DE RESERVA =====

/**
 * Analiza una frase del usuario para extraer TODA la información de reserva posible
 * Usa Gemini 2.5 Flash para extraer: comensales, fecha, hora, intolerancias, movilidad, nombre
 */
async function analyzeReservationWithGemini(userInput) {
  try {
    const client = getGeminiClient();
    if (!client) {
      console.warn('⚠️ Gemini no disponible, usando fallback');
      return null;
    }

    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    // Obtener fecha/hora actual y horarios
    const now = new Date();
    const currentDateTime = now.toISOString().replace('T', ' ').substring(0, 19);
    const tomorrow = getTomorrowDate();
    const dayAfterTomorrow = getDayAfterTomorrowDate();
    const hours = getRestaurantHours();
    
    // Prompt optimizado para extracción máxima de información
    const prompt = `## MISIÓN
Eres un experto analizador de texto especializado en extraer información de reservas de restaurante.
Tu objetivo es analizar UNA SOLA frase del cliente y extraer TODO lo que puedas de ella.

## CONTEXTO ACTUAL
- Fecha y hora actual: ${currentDateTime}
- Fecha de mañana: ${tomorrow}
- Fecha de pasado mañana: ${dayAfterTomorrow}
- Horario del restaurante:
  - Comida: ${hours.lunch[0]} - ${hours.lunch[1]}
  - Cena: ${hours.dinner[0]} - ${hours.dinner[1]}

## TEXTO A ANALIZAR
"${userInput}"

## REGLAS CRÍTICAS
1. NO INVENTES información. Si no está en el texto, devuelve null.
2. Si NO estás seguro, usa porcentaje de credibilidad bajo (0% o 50%).
3. Si estás muy seguro, usa 100%.
4. Valida la hora contra el horario del restaurante. Si está fuera de horario, marca enhorario:false.
5. Convierte todo a formato estándar:
   - Comensales: número (1-20)
   - Fecha: YYYY-MM-DD
   - Hora: HH:MM (formato 24h)
   - Intolerancias: "true" o "false"
   - Movilidad: "true" o "false"
   - Nombre: texto o null

## FORMATO DE SALIDA (SOLO JSON, sin explicaciones)
{
  "intencion": "reservation" | "modify" | "cancel" | "clarify",
  "comensales": null o "número",
  "comensales_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "fecha": null o "YYYY-MM-DD",
  "fecha_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "hora": null o "HH:MM",
  "enhorario": "true" | "false",
  "hora_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "intolerancias": "true" | "false",
  "intolerancias_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "movilidad": "true" | "false",
  "movilidad_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "nombre": null o "texto",
  "nombre_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "idioma_detectado": "es" | "en" | "de" | "fr" | "it" | "pt"
}

NOTA SOBRE INTENCIÓN:
- "reservation": El usuario quiere hacer una nueva reserva
- "modify": El usuario quiere modificar una reserva existente
- "cancel": El usuario quiere cancelar una reserva existente
- "clarify": El texto es ambiguo o no indica una intención clara

IMPORTANTE: Responde SOLO con el JSON, sin texto adicional.`;

    console.log('🤖 [GEMINI] Analizando con Gemini 2.5 Flash...');
    console.log('📝 [GEMINI] Input:', userInput);
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('🤖 [GEMINI] Respuesta raw:', text);
    
    // Extraer JSON de la respuesta (puede venir con markdown o texto extra)
    let jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ [GEMINI] No se pudo extraer JSON de la respuesta');
      return null;
    }
    
    const analysis = JSON.parse(jsonMatch[0]);
    console.log('✅ [GEMINI] Análisis completado:', JSON.stringify(analysis, null, 2));
    
    return analysis;
    
  } catch (error) {
    console.error('❌ [GEMINI] Error en análisis:', error);
    return null;
  }
}

/**
 * Detecta la intención del usuario usando Gemini
 * Retorna: { action: 'reservation' | 'modify' | 'cancel' | 'clarify' }
 */
async function detectIntentionWithGemini(text) {
  try {
    const client = getGeminiClient();
    if (!client) {
      // Fallback: asumir reservation si no hay Gemini
      return { action: 'reservation' };
    }

    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `Analiza este texto del cliente de un restaurante y determina su intención.
Responde SOLO con una de estas opciones:
- "reservation": Quiere hacer una nueva reserva (reservar mesa, hacer reserva, etc.)
- "modify": Quiere modificar una reserva existente (cambiar fecha, hora, personas, etc.)
- "cancel": Quiere cancelar una reserva existente (cancelar, anular, etc.)
- "clarify": El texto es ambiguo o no indica una intención clara

Texto: "${text}"

Responde SOLO con una palabra: reservation, modify, cancel o clarify. Sin explicaciones.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const detectedIntention = response.text().trim().toLowerCase();
    
    const validIntentions = ['reservation', 'modify', 'cancel', 'clarify'];
    const action = validIntentions.includes(detectedIntention) ? detectedIntention : 'clarify';
    
    console.log(`🤖 [GEMINI] Intención detectada: ${action}`);
    return { action };
    
  } catch (error) {
    console.error('❌ [GEMINI] Error detectando intención:', error);
    // Fallback: asumir reservation
    return { action: 'reservation' };
  }
}

/**
 * Detecta el idioma del texto usando Gemini (más preciso que regex)
 */
async function detectLanguageWithGemini(text) {
  try {
    const client = getGeminiClient();
    if (!client) {
      return 'es'; // Fallback
    }

    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    const prompt = `Analiza este texto y determina el idioma. Responde SOLO con el código de idioma:
- "es" para español
- "en" para inglés
- "de" para alemán
- "fr" para francés
- "it" para italiano
- "pt" para portugués

Texto: "${text}"

Responde SOLO con el código de 2 letras, sin explicaciones.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const detectedLang = response.text().trim().toLowerCase().substring(0, 2);
    
    const validLangs = ['es', 'en', 'de', 'fr', 'it', 'pt'];
    return validLangs.includes(detectedLang) ? detectedLang : 'es';
    
  } catch (error) {
    console.error('❌ [GEMINI] Error detectando idioma:', error);
    return 'es';
  }
}

/**
 * Determina qué campos faltan después del análisis de Gemini
 * Retorna array con los campos que faltan
 */
function determineMissingFields(analysis, stateData) {
  const missing = [];
  
  // Verificar comensales (si no está en análisis o en state)
  if (!analysis?.comensales && !stateData.NumeroReserva) {
    missing.push('people');
  }
  
  // Verificar fecha
  if (!analysis?.fecha && !stateData.FechaReserva) {
    missing.push('date');
  }
  
  // Verificar hora
  if (!analysis?.hora && !stateData.HoraReserva) {
    missing.push('time');
  }
  
  // Verificar nombre
  if (!analysis?.nombre && !stateData.NomReserva) {
    missing.push('name');
  }
  
  // Telefono siempre lo pedimos si no está (a menos que estemos en paso de confirmación)
  // Esto lo manejamos en el flujo, no aquí
  
  return missing;
}

/**
 * Aplica los datos extraídos por Gemini al estado de la conversación
 */
function applyGeminiAnalysisToState(analysis, state) {
  if (!analysis) return;
  
  // Aplicar solo si el porcentaje de credibilidad es >= 50%
  const applyIfConfident = (value, percentage) => {
    const pct = parseInt(percentage || '0%');
    return pct >= 50 ? value : null;
  };
  
  // Comensales
  if (analysis.comensales && applyIfConfident(analysis.comensales, analysis.comensales_porcentaje_credivilidad)) {
    const peopleCount = parseInt(analysis.comensales);
    if (peopleCount >= 1 && peopleCount <= 20) {
      state.data.NumeroReserva = peopleCount;
      console.log(`✅ [GEMINI] Comensales aplicados: ${peopleCount}`);
    }
  }
  
  // Fecha
  if (analysis.fecha && applyIfConfident(analysis.fecha, analysis.fecha_porcentaje_credivilidad)) {
    state.data.FechaReserva = analysis.fecha;
    console.log(`✅ [GEMINI] Fecha aplicada: ${analysis.fecha}`);
  }
  
  // Hora (solo si está en horario válido)
  if (analysis.hora && analysis.enhorario === 'true' && 
      applyIfConfident(analysis.hora, analysis.hora_porcentaje_credivilidad)) {
    state.data.HoraReserva = analysis.hora;
    console.log(`✅ [GEMINI] Hora aplicada: ${analysis.hora}`);
  } else if (analysis.hora && analysis.enhorario === 'false') {
    console.log(`⚠️ [GEMINI] Hora fuera de horario, no se aplica: ${analysis.hora}`);
  }
  
  // Nombre
  if (analysis.nombre && applyIfConfident(analysis.nombre, analysis.nombre_porcentaje_credivilidad)) {
    state.data.NomReserva = analysis.nombre.trim();
    console.log(`✅ [GEMINI] Nombre aplicado: ${analysis.nombre}`);
  }
  
  // Intolerancias (guardamos pero no es crítico)
  if (analysis.intolerancias === 'true') {
    state.data.Observacions = (state.data.Observacions || '') + ' Intolerancias alimentarias.';
  }
  
  // Movilidad reducida
  if (analysis.movilidad === 'true') {
    state.data.Observacions = (state.data.Observacions || '') + ' Necesita mesa accesible.';
  }
  
  // Idioma detectado
  if (analysis.idioma_detectado) {
    state.language = analysis.idioma_detectado;
    console.log(`✅ [GEMINI] Idioma detectado: ${analysis.idioma_detectado}`);
  }
}

async function processConversationStep(state, userInput) {
  const step = state.step;
  const text = userInput.toLowerCase();

  console.log(`📋 Procesando paso: ${step}, Input: "${userInput}"`);

  // PASOS CRÍTICOS donde debemos ser más cuidadosos al detectar cancelación
  // para evitar falsos positivos (por ejemplo, "15 de enero" contiene "no")
  const criticalReservationSteps = ['ask_date', 'ask_time', 'ask_name', 'confirm'];
  
  // Verificar si el usuario quiere cancelar la reserva
  if (userInput && userInput.trim()) {
    let shouldCheckCancellation = true;
    
    // En pasos críticos de reserva, verificar primero si la respuesta es un dato válido usando Gemini
    if (criticalReservationSteps.includes(step) && step !== 'confirm') {
      // Usar Gemini para verificar si hay datos válidos en la respuesta
      const quickAnalysis = await analyzeReservationWithGemini(userInput);
      let isValidData = false;
      
      if (quickAnalysis) {
        // Verificar según el paso actual
        switch (step) {
          case 'ask_date':
            isValidData = quickAnalysis.fecha !== null && quickAnalysis.fecha_porcentaje_credivilidad !== '0%';
            break;
          case 'ask_time':
            isValidData = quickAnalysis.hora !== null && quickAnalysis.hora_porcentaje_credivilidad !== '0%';
            break;
          case 'ask_name':
            isValidData = quickAnalysis.nombre !== null && quickAnalysis.nombre_porcentaje_credivilidad !== '0%';
            break;
        }
      }
      
      // Si se detectó un dato válido, NO buscar cancelación
      if (isValidData) {
        console.log(`✅ [PASO CRÍTICO] Se detectó dato válido en paso ${step}, saltando verificación de cancelación`);
        shouldCheckCancellation = false;
      }
    } else if (step === 'confirm') {
      // Las confirmaciones usan handleConfirmationResponse
      const confirmResult = handleConfirmationResponse(text);
      if (confirmResult.action !== 'clarify') {
        console.log(`✅ [PASO CRÍTICO] Se detectó confirmación válida, saltando verificación de cancelación`);
        shouldCheckCancellation = false;
      }
    }
    
    // Verificar cancelación solo si es apropiado
    // EXCLUIR 'greeting' y 'ask_intention' porque usan detectIntentionWithGemini que es más preciso
    if (shouldCheckCancellation && step !== 'greeting' && step !== 'ask_intention' && isCancellationRequest(userInput)) {
      console.log(`🚫 [CANCELACIÓN] Usuario quiere cancelar en paso: ${step}`);
      
      // Si ya está en proceso de cancelación, confirmar
      if (step === 'cancelling') {
        return await handleCancellationConfirmation(state, userInput);
      }
      
      // Iniciar proceso de cancelación
      return await handleCancellationRequest(state, userInput);
    }
  }

  // Detectar idioma solo en pasos específicos para evitar cambios inesperados
  if (userInput && userInput.trim()) {
    // Solo detectar idioma en greeting - NO durante cancelación para evitar cambios
    if (step === 'greeting') {
      const detectedLanguage = await detectLanguageWithGemini(userInput);
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
      
      // Si hay input del usuario, detectar intención con Gemini
      if (userInput && userInput.trim()) {
        console.log(`🔍 [GEMINI] Detectando intención en saludo: "${userInput}"`);
        const intentionResult = await detectIntentionWithGemini(userInput);
        console.log(`🎯 [GEMINI] Intención detectada:`, intentionResult);
        
        if (intentionResult.action === 'reservation') {
          console.log(`🚀 [GEMINI] Intención de reserva detectada, analizando con Gemini...`);
          
          // Usar Gemini para extraer TODO de la primera frase
          const analysis = await analyzeReservationWithGemini(userInput);
          
          if (analysis) {
            // Aplicar los datos extraídos al estado
            applyGeminiAnalysisToState(analysis, state);
            
            // Determinar qué falta
            const missing = determineMissingFields(analysis, state.data);
            
            console.log(`📊 [GEMINI] Campos faltantes: ${missing.join(', ') || 'ninguno'}`);
            
            // Si tenemos todo lo esencial, usar teléfono de la llamada directamente y confirmar
            if (missing.length === 0) {
              // Asegurar que tenemos teléfono (usar el de la llamada)
              if (!state.data.TelefonReserva) {
                state.data.TelefonReserva = state.phone;
              }
              
              // Ir directamente a confirmación con mensaje completo
              state.step = 'confirm';
              const confirmMessage = getConfirmationMessage(state.data, state.language);
              console.log(`✅ [GEMINI] Información completa extraída en greeting, mostrando confirmación`);
              return {
                message: confirmMessage,
                gather: true
              };
            } else {
              // Falta información, confirmar lo que tenemos y preguntar por lo que falta
              const nextField = missing[0];
              
              // Usar confirmación parcial que muestra lo capturado y pregunta por lo faltante
              const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
              
              if (nextField === 'people') {
                state.step = 'ask_people';
              } else if (nextField === 'date') {
                state.step = 'ask_date';
              } else if (nextField === 'time') {
                state.step = 'ask_time';
              } else if (nextField === 'name') {
                state.step = 'ask_name';
              }
              
              return {
                message: partialMessage,
                gather: true
              };
            }
          }
          
          // Fallback: si Gemini falla, usar flujo normal
          console.log(`⚠️ [GEMINI] Gemini falló o no disponible, usando flujo normal`);
          state.step = 'ask_people';
          const reservationMessages = getMultilingualMessages('reservation', state.language);
          return {
            message: getRandomMessage(reservationMessages),
            gather: true
          };
        } else if (intentionResult.action === 'modify') {
          console.log(`✏️ [DEBUG] Intención de modificación detectada en saludo`);
          console.log(`✏️ [DEBUG] Llamando a handleModificationRequest con input: "${userInput}"`);
          console.log(`✏️ [DEBUG] Estado antes de llamar a handleModificationRequest: step=${state.step}, language=${state.language}`);
          const result = await handleModificationRequest(state, userInput);
          console.log(`✏️ [DEBUG] Resultado de handleModificationRequest:`, result);
          console.log(`✏️ [DEBUG] Estado después de llamar a handleModificationRequest: step=${state.step}, language=${state.language}`);
          return result;
        } else if (intentionResult.action === 'cancel') {
          console.log(`🚫 [DEBUG] Intención de cancelación detectada en saludo`);
          return await handleCancellationRequest(state, userInput);
        }
      }
      
      // Si no hay input o no se detectó intención, hacer saludo normal
      console.log(`👋 [DEBUG] Saludo normal - idioma=${state.language}`);
      state.step = 'ask_intention';
      const greetingMessages = getMultilingualMessages('greeting', state.language);
      console.log(`💬 [DEBUG] Mensajes de saludo obtenidos:`, greetingMessages);
       return {
         message: getRandomMessage(greetingMessages),
         gather: true
       };

     case 'ask_intention':
       // Confirmar que quiere hacer una reserva o cancelar - usar Gemini
       const intentionResult = await detectIntentionWithGemini(text);
       
       if (intentionResult.action === 'reservation') {
         // Usuario quiere hacer una reserva - intentar extraer TODA la información de una vez
         console.log(`📝 [RESERVA] Intentando extraer información completa de: "${text}"`);
         const analysis = await analyzeReservationWithGemini(text);
         
         if (analysis) {
           // Aplicar la información extraída al estado
           applyGeminiAnalysisToState(analysis, state);
           
           // Determinar qué campos faltan
           const missingFields = determineMissingFields(analysis, state.data);
           
           console.log(`📊 [RESERVA] Campos faltantes:`, missingFields);
           
           // Si no falta nada, ir directamente a confirmación
           if (missingFields.length === 0) {
             state.step = 'confirm';
             const confirmMessage = getConfirmationMessage(state.data, state.language);
             return {
               message: confirmMessage,
               gather: true
             };
           }
           
           // Si falta información, confirmar lo que tenemos y preguntar por lo que falta
           const nextField = missingFields[0];
           state.step = `ask_${nextField}`;
           
           // Usar confirmación parcial que muestra lo capturado y pregunta por lo faltante
           const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
           
           return {
             message: partialMessage,
             gather: true
           };
         } else {
           // Si Gemini no pudo extraer información, preguntar por personas
           state.step = 'ask_people';
           const reservationMessages = getMultilingualMessages('reservation', state.language);
           return {
             message: getRandomMessage(reservationMessages),
             gather: true
           };
         }
      } else if (intentionResult.action === 'modify') {
        // Usuario quiere modificar una reserva existente
        return await handleModificationRequest(state, userInput);
      } else if (intentionResult.action === 'cancel') {
        // Usuario quiere cancelar una reserva existente
        return await handleCancellationRequest(state, userInput);
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

     // ===== NUEVOS CASOS PARA MODIFICACIÓN DE RESERVAS =====
    case 'modify_ask_phone_choice':
      return await handleModifyAskPhoneChoice(state, userInput);
    case 'modify_ask_phone':
      return await handleModifyAskPhone(state, userInput);
    case 'modify_show_multiple':
      return await handleModifyShowMultiple(state, userInput);
    case 'modify_ask_field':
      return await handleModifyAskField(state, userInput);
    case 'modify_ask_value':
      return await handleModifyAskValue(state, userInput);
    case 'modify_confirm':
      return await handleModifyConfirm(state, userInput);
    case 'modify_success':
      return await handleModifySuccess(state, userInput);
    case 'modify_error':
      return await handleModifyError(state, userInput);
    case 'modify_no_reservations':
      return await handleModifyNoReservations(state, userInput);

    // ===== NUEVOS CASOS PARA CANCELACIÓN DE RESERVAS =====
    case 'cancel_ask_phone_choice':
      return await handleCancelAskPhoneChoice(state, userInput);
    case 'cancel_ask_phone':
      return await handleCancelAskPhone(state, userInput);

     case 'cancel_show_multiple':
       return await handleCancelShowMultiple(state, userInput);

     case 'cancel_confirm_single':
       return await handleCancelConfirmSingle(state, userInput);

     case 'cancel_confirm_multiple':
       return await handleCancelConfirmMultiple(state, userInput);

     case 'cancel_no_reservations':
       return await handleCancelNoReservations(state, userInput);

     case 'ask_people':
       // Usar Gemini para extraer información de la respuesta del usuario
       const peopleAnalysis = await analyzeReservationWithGemini(userInput);
       if (peopleAnalysis) {
         applyGeminiAnalysisToState(peopleAnalysis, state);
       }
       
       if (state.data.NumeroReserva) {
         const people = state.data.NumeroReserva;
         // Determinar siguiente paso según qué falta
         const missing = determineMissingFields(null, state.data);
         const nextField = missing[0];
         
         if (nextField === 'date') {
           state.step = 'ask_date';
         } else if (nextField === 'time') {
           state.step = 'ask_time';
         } else if (nextField === 'name') {
           state.step = 'ask_name';
         } else {
           // Tiene todo, ir a confirmación
           state.step = 'confirm';
         }
         
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
       // Usar Gemini para extraer información de la respuesta del usuario
       const dateAnalysis = await analyzeReservationWithGemini(userInput);
       if (dateAnalysis) {
         applyGeminiAnalysisToState(dateAnalysis, state);
       }
       
       if (state.data.FechaReserva) {
         const date = state.data.FechaReserva;
         // Determinar siguiente paso según qué falta
         const missing = determineMissingFields(null, state.data);
         const nextField = missing[0];
         
         if (nextField === 'time') {
           state.step = 'ask_time';
         } else if (nextField === 'name') {
           state.step = 'ask_name';
         } else {
           // Tiene todo, ir a confirmación
           state.step = 'confirm';
         }
         
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
       // Usar Gemini para extraer información de la respuesta del usuario
       const timeAnalysis = await analyzeReservationWithGemini(userInput);
       if (timeAnalysis) {
         applyGeminiAnalysisToState(timeAnalysis, state);
       }
       
       if (state.data.HoraReserva) {
         const time = state.data.HoraReserva;
         // Determinar siguiente paso según qué falta
         const missing = determineMissingFields(null, state.data);
         const nextField = missing[0];
         
         if (nextField === 'name') {
           state.step = 'ask_name';
           // Confirmar hora capturada y preguntar por nombre
           const timeFormatted = formatTimeForSpeech(time, state.language);
           const partialMessage = getPartialConfirmationMessage(state.data, 'name', state.language);
           return {
             message: partialMessage,
             gather: true
           };
         } else {
           // Tiene todo, ir a confirmación
           state.step = 'confirm';
           const confirmMessage = getConfirmationMessage(state.data, state.language);
           return {
             message: confirmMessage,
             gather: true
           };
         }
       } else {
         const errorResponse = handleUnclearResponse(text, 'time', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

     case 'ask_name':
       // Usar Gemini para extraer información de la respuesta del usuario
       const nameAnalysis = await analyzeReservationWithGemini(userInput);
       if (nameAnalysis) {
         applyGeminiAnalysisToState(nameAnalysis, state);
       }
       
       if (state.data.NomReserva) {
         const name = state.data.NomReserva;
         // Después del nombre, usar directamente el teléfono de la llamada y confirmar
         state.data.TelefonReserva = state.phone;
         state.step = 'confirm';
         
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
         return handleModifyReservationField(state, confirmationResult.modification);
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

// Funciones para manejar modificación de reservas
// ===== NUEVAS FUNCIONES DE MODIFICACIÓN DE RESERVAS EXISTENTES =====

async function handleModificationRequest(state, userInput) {
  try {
    console.log(`✏️ [MODIFICACIÓN] Iniciando proceso de modificación de reserva existente`);
    console.log(`✏️ [DEBUG] Input del usuario: "${userInput}"`);
    console.log(`✏️ [DEBUG] Estado actual: step=${state.step}, language=${state.language}`);
    
    // Usar directamente el teléfono de la llamada (sin preguntar)
    console.log(`✏️ [DEBUG] Usando teléfono de la llamada: ${state.phone}`);
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } catch (error) {
    console.error(`❌ [ERROR] Error en handleModificationRequest:`, error);
    return {
      message: "Error: No se pudo procesar la solicitud de modificación",
      gather: true
    };
  }
}

async function handleModifyAskPhoneChoice(state, userInput) {
  console.log(`📞 [MODIFICACIÓN] Procesando elección de teléfono: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si quiere usar el mismo teléfono (reutilizar lógica de cancelación)
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número/i,
    /usar.*este|usar.*mismo|usar.*igual/i,
    
    // Inglés
    /yes|same|this|current|from.*here/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    /use.*this|use.*same|use.*current/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    /verwenden.*dieses|verwenden.*gleiche/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    /utiliser.*ce|utiliser.*même/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    /usare.*questo|usare.*stesso/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i,
    /usar.*este|usar.*mesmo/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [MODIFICACIÓN] Usuario eligió usar el mismo teléfono: ${state.phone}`);
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } else {
    // Usuario quiere usar otro teléfono
    console.log(`📞 [MODIFICACIÓN] Usuario eligió usar otro teléfono`);
    state.step = 'modify_ask_phone';
    state.modificationData.useOtherPhone = true;
    const phoneMessages = getMultilingualMessages('modify_ask_phone', state.language);
    
    return {
      message: getRandomMessage(phoneMessages),
      gather: true
    };
  }
}

async function handleModifyAskPhone(state, userInput) {
  console.log(`📞 [MODIFICACIÓN] Procesando número de teléfono: ${userInput}`);
  console.log(`📞 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`📞 [DEBUG] Teléfono del estado: "${state.phone}"`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si el usuario quiere usar el mismo teléfono (volver al paso anterior)
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí|el.*mismo|este.*número|mismo.*número|este.*teléfono|mismo.*teléfono/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número|usar.*este|usar.*mismo|usar.*igual|quiere.*usar.*mismo|quisiera.*usar.*mismo/i,
    
    // Inglés
    /yes|same|this|current|from.*here|use.*this|use.*same|use.*current/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier|verwenden.*dieses|verwenden.*gleiche/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici|utiliser.*ce|utiliser.*même/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui|usare.*questo|usare.*stesso/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui|usar.*este|usar.*mesmo/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [MODIFICACIÓN] Usuario quiere usar el mismo teléfono: ${state.phone}`);
    // Volver al paso anterior y usar el teléfono de la llamada
    state.step = 'modify_ask_phone_choice';
    state.modificationData.useOtherPhone = false;
    
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  }
  
  // Extraer número de teléfono del input
  let phoneNumber = extractPhoneFromText(userInput);
  console.log(`📞 [DEBUG] Teléfono extraído del input: "${phoneNumber}"`);
  
  // Si el usuario eligió usar otro teléfono, NO usar el de la llamada
  if (state.modificationData.useOtherPhone) {
    if (!phoneNumber) {
      console.log(`❌ [MODIFICACIÓN] No se pudo extraer teléfono del input: "${userInput}"`);
      const unclearMessages = getMultilingualMessages('modify_ask_phone', state.language);
      return {
        message: `No pude entender el número de teléfono. ${getRandomMessage(unclearMessages)}`,
        gather: true
      };
    }
    console.log(`📞 [MODIFICACIÓN] Usando teléfono proporcionado por el usuario: ${phoneNumber}`);
  } else {
    // Si no se encontró en el texto, usar el teléfono de la llamada
    if (!phoneNumber) {
      phoneNumber = state.phone;
      console.log(`📞 [MODIFICACIÓN] Usando teléfono de la llamada: ${phoneNumber}`);
    }
  }
  
  console.log(`📞 [DEBUG] Teléfono final a usar para búsqueda: "${phoneNumber}"`);
  
  // Buscar reservas para este teléfono
  const reservations = await findReservationsByPhone(phoneNumber);
  
  if (reservations.length === 0) {
    state.step = 'modify_no_reservations';
    const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    state.step = 'modify_ask_field';
    state.modificationData = {
      phone: phoneNumber,
      reservations: reservations,
      selectedReservation: reservations[0]
    };
    
    const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
    return {
      message: getRandomMessage(fieldMessages),
      gather: true
    };
  } else {
    state.step = 'modify_show_multiple';
    state.modificationData = {
      phone: phoneNumber,
      reservations: reservations
    };
    
    const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleModifyShowMultiple(state, userInput) {
  console.log(`🔢 [MODIFICACIÓN] Procesando selección de reserva: ${userInput}`);
  
  // Extraer número de opción del input usando la función mejorada
  const optionNumber = extractOptionFromText(userInput);
  
  if (!optionNumber) {
    const unclearMessages = getMultilingualMessages('modify_unclear_option', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  const selectedIndex = optionNumber - 1; // Convertir a índice 0-based
  const reservations = state.modificationData.reservations;
  
  if (selectedIndex < 0 || selectedIndex >= reservations.length) {
    const invalidMessages = getMultilingualMessages('modify_invalid_option', state.language);
    return {
      message: getRandomMessage(invalidMessages),
      gather: true
    };
  }
  
  // Reserva seleccionada
  const selectedReservation = reservations[selectedIndex];
  state.modificationData.selectedReservation = selectedReservation;
  state.step = 'modify_ask_field';
  
  const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
  return {
    message: getRandomMessage(fieldMessages),
    gather: true
  };
}

async function handleModifyAskField(state, userInput) {
  console.log(`✏️ [MODIFICACIÓN] Procesando campo a modificar: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar qué campo quiere modificar
  const fieldPatterns = {
    name: [/nombre|name/i, /a.*nombre.*de|under.*name/i, /nom.*persona|person.*name/i],
    date: [/fecha|date|día|day/i, /cuando|when|cuándo/i, /día.*mes|day.*month/i],
    time: [/hora|time|tiempo/i, /a.*qué.*hora|what.*time/i, /cuando|when/i],
    people: [/personas|people|gente/i, /cuántas.*personas|how.*many.*people/i, /número.*personas|number.*people/i, /comensales|diners/i]
  };
  
  let selectedField = null;
  for (const [field, patterns] of Object.entries(fieldPatterns)) {
    if (patterns.some(pattern => pattern.test(lowerInput))) {
      selectedField = field;
      break;
    }
  }
  
  if (!selectedField) {
    const unclearMessages = getMultilingualMessages('modify_unclear_field', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  state.modificationData.fieldToModify = selectedField;
  state.step = 'modify_ask_value';
  
  const valueMessages = getMultilingualMessages('modify_ask_value', state.language, { field: selectedField });
  return {
    message: getRandomMessage(valueMessages),
    gather: true
  };
}

async function handleModifyAskValue(state, userInput) {
  console.log(`✏️ [MODIFICACIÓN] Procesando nuevo valor: ${userInput}`);
  
  const field = state.modificationData.fieldToModify;
  let newValue = null;
  
  // Extraer el nuevo valor según el campo
  switch (field) {
    case 'name':
      newValue = extractName(userInput);
      break;
    case 'date':
      newValue = extractDate(userInput);
      break;
    case 'time':
      newValue = extractTime(userInput);
      break;
    case 'people':
      newValue = extractPeopleCount(userInput);
      break;
  }
  
  if (!newValue) {
    const unclearMessages = getMultilingualMessages('modify_unclear_value', state.language, { field });
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  state.modificationData.newValue = newValue;
  state.step = 'modify_confirm';
  
  const confirmMessages = getMultilingualMessages('modify_confirm', state.language, {
    field: field,
    oldValue: getFieldValue(state.modificationData.selectedReservation, field),
    newValue: newValue
  });
  
  return {
    message: getRandomMessage(confirmMessages),
    gather: true
  };
}

async function handleModifyConfirm(state, userInput) {
  console.log(`✅ [MODIFICACIÓN] Procesando confirmación: ${userInput}`);
  
  // Usar detectCancellationConfirmation que retorna 'yes', 'no' o 'unclear'
  // Nota: Aunque se llama detectCancellationConfirmation, funciona igual para cualquier confirmación
  const confirmationResult = detectCancellationConfirmation(userInput);
  
  if (confirmationResult === 'yes') {
    // Confirmar modificación
    const success = await updateReservation(state.modificationData);
    
    if (success) {
      console.log(`✅ [MODIFICACIÓN] Reserva modificada exitosamente`);
      state.step = 'modify_success';
      const successMessages = getMultilingualMessages('modify_success', state.language);
      
      return {
        message: getRandomMessage(successMessages),
        gather: false // Terminar llamada
      };
    } else {
      console.log(`❌ [MODIFICACIÓN] Error modificando reserva`);
      state.step = 'modify_error';
      const errorMessages = getMultilingualMessages('modify_error', state.language);
      
      return {
        message: getRandomMessage(errorMessages),
        gather: false // Terminar llamada
      };
    }
  } else if (confirmationResult === 'no') {
    // Rechazar modificación
    console.log(`🔄 [MODIFICACIÓN] Modificación rechazada`);
    state.step = 'greeting'; // Volver al inicio
    const cancelledMessages = getMultilingualMessages('modify_cancelled', state.language);
    
    return {
      message: getRandomMessage(cancelledMessages),
      gather: true
    };
  } else {
    // Respuesta no clara
    const unclearMessages = getMultilingualMessages('modify_unclear_confirmation', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
}

async function handleModifySuccess(state, userInput) {
  return { message: '', gather: false };
}

async function handleModifyError(state, userInput) {
  return { message: '', gather: false };
}

async function handleModifyNoReservations(state, userInput) {
  console.log(`❌ [MODIFICACIÓN] No hay reservas para modificar`);
  
  const offerNewMessages = getMultilingualMessages('modify_offer_new', state.language);
  return {
    message: getRandomMessage(offerNewMessages),
    gather: true
  };
}

// Función auxiliar para obtener el valor de un campo
function getFieldValue(reservation, field) {
  switch (field) {
    case 'name':
      return reservation.nom_persona_reserva;
    case 'date':
      return formatDateSpanish(reservation.data_reserva.split(' ')[0]);
    case 'time':
      const date = new Date(reservation.data_reserva);
      return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    case 'people':
      return reservation.num_persones;
    default:
      return '';
  }
}

// Función para actualizar la reserva en la base de datos
async function updateReservation(modificationData) {
  try {
    const { selectedReservation, fieldToModify, newValue, phone } = modificationData;
    console.log(`✏️ Actualizando reserva ID: ${selectedReservation.id_reserva}, campo: ${fieldToModify}, nuevo valor: ${newValue}`);
    
    const connection = await createConnection();
    
    try {
      await connection.beginTransaction();
      
      let updateQuery = '';
      let updateValues = [];
      
      switch (fieldToModify) {
        case 'name':
          updateQuery = `UPDATE RESERVA SET nom_persona_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newValue, selectedReservation.id_reserva, phone];
          break;
        case 'date':
          // Combinar nueva fecha con hora existente
          const existingTime = selectedReservation.data_reserva.split(' ')[1];
          const newDateTimeWithTime = `${newValue} ${existingTime}`;
          updateQuery = `UPDATE RESERVA SET data_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newDateTimeWithTime, selectedReservation.id_reserva, phone];
          break;
        case 'time':
          // Combinar fecha existente con nueva hora
          const existingDate = selectedReservation.data_reserva.split(' ')[0];
          const newDateTimeWithDate = `${existingDate} ${newValue}`;
          updateQuery = `UPDATE RESERVA SET data_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newDateTimeWithDate, selectedReservation.id_reserva, phone];
          break;
        case 'people':
          updateQuery = `UPDATE RESERVA SET num_persones = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newValue, selectedReservation.id_reserva, phone];
          break;
      }
      
      const [result] = await connection.execute(updateQuery, updateValues);
      
      if (result.affectedRows === 0) {
        throw new Error('No se encontró la reserva para modificar');
      }
      
      await connection.commit();
      console.log(`✅ Reserva ${selectedReservation.id_reserva} modificada exitosamente`);
      return true;
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error modificando reserva:', error);
    return false;
  }
}

// Funciones para manejar cancelación de reservas
// ===== NUEVAS FUNCIONES DE CANCELACIÓN DE RESERVAS EXISTENTES =====

async function handleCancellationRequest(state, userInput) {
  console.log(`🚫 [CANCELACIÓN] Iniciando proceso de cancelación de reserva existente`);
  
  // Usar directamente el teléfono de la llamada (sin preguntar)
  console.log(`🚫 [DEBUG] Usando teléfono de la llamada: ${state.phone}`);
  const reservations = await findReservationsByPhone(state.phone);
  
  state.cancellationData = { phone: state.phone, reservations: reservations };
  
  if (reservations.length === 0) {
    state.step = 'cancel_no_reservations';
    const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    state.step = 'cancel_confirm_single';
    state.cancellationData.selectedReservation = reservations[0];
    const confirmMessages = getMultilingualMessages('cancel_confirm_selected', state.language);
    const reservationText = formatReservationForDisplay(reservations[0], 0, state.language).single;
    return {
      message: `${getRandomMessage(confirmMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
      gather: true
    };
  } else {
    state.step = 'cancel_show_multiple';
    const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleCancelAskPhoneChoice(state, userInput) {
  console.log(`📞 [CANCELACIÓN] Procesando elección de teléfono: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si quiere usar el mismo teléfono
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número/i,
    /usar.*este|usar.*mismo|usar.*igual/i,
    
    // Inglés
    /yes|same|this|current|from.*here/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    /use.*this|use.*same|use.*current/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    /verwenden.*dieses|verwenden.*gleiche/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    /utiliser.*ce|utiliser.*même/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    /usare.*questo|usare.*stesso/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i,
    /usar.*este|usar.*mesmo/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [CANCELACIÓN] Usuario eligió usar el mismo teléfono: ${state.phone}`);
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'cancel_no_reservations';
      const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'cancel_confirm_single';
      state.cancellationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const singleReservationMessages = getMultilingualMessages('cancel_show_single', state.language);
      const reservationText = formatReservationForDisplay(reservations[0], 0, state.language, reservations).single;
      
      return {
        message: `${getRandomMessage(singleReservationMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
        gather: true
      };
    } else {
      state.step = 'cancel_show_multiple';
      state.cancellationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } else {
    // Usuario quiere usar otro teléfono
    console.log(`📞 [CANCELACIÓN] Usuario eligió usar otro teléfono`);
    state.step = 'cancel_ask_phone';
    state.cancellationData.useOtherPhone = true; // Marcar que debe usar otro teléfono
    const phoneMessages = getMultilingualMessages('cancel_ask_phone', state.language);
    
    return {
      message: getRandomMessage(phoneMessages),
      gather: true
    };
  }
}

async function handleCancelAskPhone(state, userInput) {
  console.log(`📞 [CANCELACIÓN] Procesando número de teléfono: ${userInput}`);
  console.log(`📞 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`📞 [DEBUG] Teléfono del estado: "${state.phone}"`);
  
  // Extraer número de teléfono del input
  let phoneNumber = extractPhoneFromText(userInput);
  console.log(`📞 [DEBUG] Teléfono extraído del input: "${phoneNumber}"`);
  
  // Si el usuario eligió usar otro teléfono, NO usar el de la llamada
  if (state.cancellationData.useOtherPhone) {
    if (!phoneNumber) {
      console.log(`❌ [CANCELACIÓN] No se pudo extraer teléfono del input: "${userInput}"`);
      const unclearMessages = getMultilingualMessages('cancel_ask_phone', state.language);
      return {
        message: `No pude entender el número de teléfono. ${getRandomMessage(unclearMessages)}`,
        gather: true
      };
    }
    console.log(`📞 [CANCELACIÓN] Usando teléfono proporcionado por el usuario: ${phoneNumber}`);
  } else {
    // Si no se encontró en el texto, usar el teléfono de la llamada
    if (!phoneNumber) {
      phoneNumber = state.phone;
      console.log(`📞 [CANCELACIÓN] Usando teléfono de la llamada: ${phoneNumber}`);
    }
  }
  
  console.log(`📞 [DEBUG] Teléfono final a usar para búsqueda: "${phoneNumber}"`);
  
  // Buscar reservas para este teléfono
  const reservations = await findReservationsByPhone(phoneNumber);
  
  if (reservations.length === 0) {
    // No hay reservas
    console.log(`❌ [CANCELACIÓN] No se encontraron reservas para ${phoneNumber}`);
    state.step = 'cancel_no_reservations';
    const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
    
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    // Solo una reserva - mostrar detalles y pedir confirmación
    console.log(`📋 [CANCELACIÓN] Una reserva encontrada:`, reservations[0]);
    state.step = 'cancel_confirm_single';
    state.cancellationData = {
      phone: phoneNumber,
      reservations: reservations,
      selectedReservation: reservations[0]
    };
    
    const singleReservationMessages = getMultilingualMessages('cancel_show_single', state.language);
    const reservationText = formatReservationForDisplay(reservations[0], 0, state.language, reservations).single;
    
    return {
      message: `${getRandomMessage(singleReservationMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
      gather: true
    };
  } else {
    // Múltiples reservas - mostrar lista
    console.log(`📋 [CANCELACIÓN] Múltiples reservas encontradas: ${reservations.length}`);
    state.step = 'cancel_show_multiple';
    state.cancellationData = {
      phone: phoneNumber,
      reservations: reservations
    };
    
    const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    // Agregar cada reserva como opción
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleCancelShowMultiple(state, userInput) {
  console.log(`🔢 [CANCELACIÓN] Procesando selección de reserva: ${userInput}`);
  console.log(`🔢 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`🔢 [DEBUG] Número de reservas disponibles: ${state.cancellationData.reservations.length}`);
  
  // Extraer número de opción del input usando la función mejorada
  const optionNumber = extractOptionFromText(userInput);
  console.log(`🔢 [DEBUG] Número de opción extraído: ${optionNumber}`);
  
  if (!optionNumber) {
    console.log(`❌ [CANCELACIÓN] No se pudo detectar opción en: "${userInput}"`);
    const unclearMessages = getMultilingualMessages('cancel_unclear_option', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  const selectedIndex = optionNumber - 1; // Convertir a índice 0-based
  const reservations = state.cancellationData.reservations;
  
  if (selectedIndex < 0 || selectedIndex >= reservations.length) {
    const invalidMessages = getMultilingualMessages('cancel_invalid_option', state.language);
    return {
      message: getRandomMessage(invalidMessages),
      gather: true
    };
  }
  
  // Guardar reserva seleccionada y pedir confirmación
  const selectedReservation = reservations[selectedIndex];
  state.cancellationData.selectedReservation = selectedReservation;
  state.step = 'cancel_confirm_multiple';
  
  const confirmMessages = getMultilingualMessages('cancel_confirm_selected', state.language);
  const reservationText = formatReservationForDisplay(selectedReservation, selectedIndex, state.language).single;
  
  return {
    message: `${getRandomMessage(confirmMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
    gather: true
  };
}

async function handleCancelConfirmSingle(state, userInput) {
  return await handleCancelConfirmation(state, userInput);
}

async function handleCancelConfirmMultiple(state, userInput) {
  return await handleCancelConfirmation(state, userInput);
}

async function handleCancelConfirmation(state, userInput) {
  console.log(`✅ [CANCELACIÓN] Procesando confirmación: ${userInput}`);
  
  if (isCancellationConfirmation(userInput)) {
    // Confirmar cancelación
    const selectedReservation = state.cancellationData.selectedReservation;
    console.log(`🗑️ [DEBUG] Datos de cancelación:`, {
      selectedReservation: selectedReservation,
      phone: state.cancellationData.phone,
      id_reserva: selectedReservation?.id_reserva
    });
    
    try {
      const success = await cancelReservation(selectedReservation.id_reserva, state.cancellationData.phone);
      
      if (success) {
        console.log(`✅ [CANCELACIÓN] Reserva cancelada exitosamente`);
        state.step = 'cancel_success';
        const successMessages = getMultilingualMessages('cancel_success', state.language);
        
        return {
          message: getRandomMessage(successMessages),
          gather: false // Terminar llamada
        };
      } else {
        console.log(`❌ [CANCELACIÓN] Error cancelando reserva`);
        state.step = 'cancel_error';
        const errorMessages = getMultilingualMessages('cancel_error', state.language);
        
        return {
          message: getRandomMessage(errorMessages),
          gather: false // Terminar llamada
        };
      }
    } catch (error) {
      console.error(`❌ [CANCELACIÓN] Error en cancelación:`, error);
      state.step = 'cancel_error';
      const errorMessages = getMultilingualMessages('cancel_error', state.language);
      
      return {
        message: getRandomMessage(errorMessages),
        gather: false // Terminar llamada
      };
    }
  } else if (isCancellationDenial(userInput)) {
    // Rechazar cancelación
    console.log(`🔄 [CANCELACIÓN] Cancelación rechazada`);
    state.step = 'greeting'; // Volver al inicio
    const cancelledMessages = getMultilingualMessages('cancel_cancelled', state.language);
    
    return {
      message: getRandomMessage(cancelledMessages),
      gather: true
    };
  } else {
    // Respuesta no clara
    const unclearMessages = getMultilingualMessages('cancel_unclear_confirmation', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
}

async function handleCancelNoReservations(state, userInput) {
  console.log(`❌ [CANCELACIÓN] No hay reservas - ofreciendo nueva reserva`);
  
  // Preguntar si quiere hacer una nueva reserva
  const newReservationMessages = getMultilingualMessages('cancel_offer_new', state.language);
  
  return {
    message: getRandomMessage(newReservationMessages),
    gather: true
  };
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
    action="/api/twilio-call-gemini" 
    method="POST"
    language="${config.language}"
    speechTimeout="3"
    timeout="8">
    <Say voice="${config.voice}" language="${config.language}">${escapeXml(message)}</Say>
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">${getRandomMessage(['No escuché respuesta. ¿Sigue ahí?', 'Disculpe, no escuché. ¿Sigue ahí?', '¿Está ahí? No escuché nada.', '¿Sigue en la línea? No escuché respuesta.', 'Disculpe, ¿podría repetir? No escuché bien.'])}</Say>
  <Redirect>/api/twilio-call-gemini</Redirect>
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
        '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle? Puede hacer una nueva reserva, modificar una existente o cancelar una reserva.',
        '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy? Puede reservar una mesa, modificar una reserva existente o cancelar una reserva.',
        '¡Hola! Gracias por llamar. ¿En qué puedo asistirle? Puedo ayudarle con una nueva reserva, modificar una existente o cancelar una reserva.',
        '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita? Puede hacer una reserva, modificar una existente o cancelar una reserva.',
        '¡Hola! Encantado de atenderle. ¿En qué puedo ayudarle? Puede reservar, modificar o cancelar una reserva.'
      ],
      en: [
        'Hello! Welcome to our restaurant. How can I help you? You can make a new reservation, modify an existing one, or cancel a reservation.',
        'Good morning! Welcome. How can I assist you today? You can book a table, modify an existing reservation, or cancel a reservation.',
        'Hello! Thank you for calling. How can I help you? I can help you with a new reservation, modify an existing one, or cancel a reservation.',
        'Good afternoon! Welcome to the restaurant. What do you need? You can make a reservation, modify an existing one, or cancel a reservation.',
        'Hello! Delighted to serve you. How can I help you? You can book, modify, or cancel a reservation.'
      ],
      de: [
        'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen? Sie können eine neue Reservierung vornehmen oder eine bestehende stornieren.',
        'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen? Sie können einen Tisch reservieren oder eine bestehende Reservierung stornieren.',
        'Hallo! Vielen Dank für Ihren Anruf. Wie kann ich Ihnen helfen? Ich kann Ihnen bei einer neuen Reservierung helfen oder eine bestehende stornieren.',
        'Guten Tag! Willkommen im Restaurant. Was benötigen Sie? Sie können eine Reservierung vornehmen oder eine bestehende stornieren.',
        'Hallo! Freue mich, Ihnen zu dienen. Wie kann ich Ihnen helfen? Sie können reservieren oder eine Reservierung stornieren.'
      ],
      it: [
        'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti? Puoi fare una nuova prenotazione o cancellare una esistente.',
        'Buongiorno! Benvenuto. Come posso assisterti oggi? Puoi prenotare un tavolo o cancellare una prenotazione esistente.',
        'Ciao! Grazie per la chiamata. Come posso aiutarti? Posso aiutarti con una nuova prenotazione o cancellare una esistente.',
        'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno? Puoi fare una prenotazione o cancellare una esistente.',
        'Ciao! Felice di servirti. Come posso aiutarti? Puoi prenotare o cancellare una prenotazione.'
      ],
      fr: [
        'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider? Vous pouvez faire une nouvelle réservation ou annuler une existante.',
        'Bonjour! Bienvenue. Comment puis-je vous assister aujourd\'hui? Vous pouvez réserver une table ou annuler une réservation existante.',
        'Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider? Je peux vous aider avec une nouvelle réservation ou annuler une existante.',
        'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin? Vous pouvez faire une réservation ou annuler une existante.',
        'Bonjour! Ravi de vous servir. Comment puis-je vous aider? Vous pouvez réserver ou annuler une réservation.'
      ],
      pt: [
        'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo? Você pode fazer uma nova reserva ou cancelar uma existente.',
        'Bom dia! Bem-vindo. Como posso ajudá-lo hoje? Você pode reservar uma mesa ou cancelar uma reserva existente.',
        'Olá! Obrigado por ligar. Como posso ajudá-lo? Posso ajudá-lo com uma nova reserva ou cancelar uma existente.',
        'Boa tarde! Bem-vindo ao restaurante. O que você precisa? Você pode fazer uma reserva ou cancelar uma existente.',
        'Olá! Prazer em atendê-lo. Como posso ajudá-lo? Você pode reservar ou cancelar uma reserva.'
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
    },
    // ===== MENSAJES PARA MODIFICACIÓN DE RESERVAS =====
    modify_ask_phone_choice: {
      es: [
        'Perfecto, para modificar su reserva necesito verificar su identidad. ¿Quiere usar el mismo número de teléfono desde el que está llamando o prefiere usar otro número?',
        'Entendido, para buscar su reserva necesito su número de teléfono. ¿Desea usar este mismo número o tiene otro?',
        'Muy bien, para localizar su reserva necesito su número. ¿Usa el mismo número de esta llamada o prefiere darme otro?',
        'Perfecto, para modificar necesito verificar su identidad. ¿Quiere usar este número o prefiere usar otro?',
        'Entendido, para proceder con la modificación necesito su número. ¿Usa el mismo número desde el que llama o tiene otro?'
      ],
      en: [
        'Perfect, to modify your reservation I need to verify your identity. Do you want to use the same phone number you are calling from or would you prefer to use another number?',
        'Understood, to find your reservation I need your phone number. Do you want to use this same number or do you have another one?',
        'Very well, to locate your reservation I need your number. Do you use the same number from this call or would you prefer to give me another one?',
        'Perfect, to modify I need to verify your identity. Do you want to use this number or would you prefer to use another one?',
        'Understood, to proceed with the modification I need your number. Do you use the same number you are calling from or do you have another one?'
      ],
      pt: [
        'Perfeito, para modificar sua reserva preciso verificar sua identidade. Quer usar o mesmo número de telefone de onde está ligando ou prefere usar outro número?',
        'Entendido, para buscar sua reserva preciso do seu número de telefone. Quer usar este mesmo número ou tem outro?',
        'Muito bem, para localizar sua reserva preciso do seu número. Usa o mesmo número desta chamada ou prefere me dar outro?',
        'Perfeito, para modificar preciso verificar sua identidade. Quer usar este número ou prefere usar outro?',
        'Entendido, para prosseguir com a modificação preciso do seu número. Usa o mesmo número de onde está ligando ou tem outro?'
      ]
    },
    modify_ask_phone: {
      es: [
        'Perfecto, para modificar su reserva necesito su número de teléfono. ¿Cuál es su número?',
        'Entendido, para buscar su reserva necesito su número de teléfono. ¿Podría darme su número?',
        'Muy bien, para localizar su reserva necesito su número de teléfono. ¿Cuál es?',
        'Perfecto, para modificar necesito verificar su identidad. ¿Cuál es su número de teléfono?',
        'Entendido, para proceder con la modificación necesito su número de teléfono. ¿Podría darmelo?'
      ],
      en: [
        'Perfect, to modify your reservation I need your phone number. What is your number?',
        'Understood, to find your reservation I need your phone number. Could you give me your number?',
        'Very well, to locate your reservation I need your phone number. What is it?',
        'Perfect, to modify I need to verify your identity. What is your phone number?',
        'Understood, to proceed with the modification I need your phone number. Could you give it to me?'
      ],
      pt: [
        'Perfeito, para modificar sua reserva preciso do seu número de telefone. Qual é o seu número?',
        'Entendido, para buscar sua reserva preciso do seu número de telefone. Poderia me dar seu número?',
        'Muito bem, para localizar sua reserva preciso do seu número de telefone. Qual é?',
        'Perfeito, para modificar preciso verificar sua identidade. Qual é o seu número de telefone?',
        'Entendido, para prosseguir com a modificação preciso do seu número de telefone. Poderia me dar?'
      ]
    },
    modify_show_multiple: {
      es: [
        'Muy bien, aquí están sus reservas:',
        'Perfecto, he encontrado sus reservas:',
        'Excelente, estas son sus reservas:',
        'Aquí tiene sus reservas:',
        'He localizado sus reservas:'
      ],
      en: [
        'Very well, here are your reservations:',
        'Perfect, I found your reservations:',
        'Excellent, these are your reservations:',
        'Here are your reservations:',
        'I located your reservations:'
      ]
    },
    modify_choose_option: {
      es: [
        'Por favor, elija qué reserva modificar. Diga el número correspondiente.',
        '¿Cuál de estas reservas quiere modificar? Diga el número.',
        'Seleccione la reserva que desea modificar. Indique el número.',
        '¿Qué reserva quiere modificar? Diga el número de la opción.',
        'Elija la reserva a modificar. Mencione el número correspondiente.'
      ],
      en: [
        'Please choose which reservation to modify. Say the corresponding number.',
        'Which of these reservations do you want to modify? Say the number.',
        'Select the reservation you want to modify. Indicate the number.',
        'What reservation do you want to modify? Say the option number.',
        'Choose the reservation to modify. Mention the corresponding number.'
      ]
    },
    modify_ask_field: {
      es: [
        '¿Qué desea modificar de su reserva? Puede cambiar el nombre, la fecha, la hora o el número de personas.',
        '¿Qué parte de la reserva quiere cambiar? Puede modificar el nombre, la fecha, la hora o las personas.',
        '¿Qué campo desea actualizar? Opciones: nombre, fecha, hora o número de personas.',
        '¿Qué información quiere cambiar? Puede actualizar el nombre, la fecha, la hora o las personas.',
        '¿Qué aspecto de la reserva desea modificar? Nombre, fecha, hora o personas.'
      ],
      en: [
        'What would you like to modify about your reservation? You can change the name, date, time or number of people.',
        'What part of the reservation do you want to change? You can modify the name, date, time or people.',
        'What field do you want to update? Options: name, date, time or number of people.',
        'What information do you want to change? You can update the name, date, time or people.',
        'What aspect of the reservation do you want to modify? Name, date, time or people.'
      ]
    },
    modify_ask_value: {
      es: [
        'Perfecto, ¿cuál es el nuevo {field}?',
        'Entendido, ¿cuál es el nuevo {field}?',
        'Muy bien, ¿cuál es el nuevo {field}?',
        'Perfecto, indique el nuevo {field}.',
        '¿Cuál es el nuevo {field}?'
      ],
      en: [
        'Perfect, what is the new {field}?',
        'Understood, what is the new {field}?',
        'Very well, what is the new {field}?',
        'Perfect, indicate the new {field}.',
        'What is the new {field}?'
      ]
    },
    modify_confirm: {
      es: [
        'Perfecto, voy a cambiar el {field} de "{oldValue}" a "{newValue}". ¿Confirma esta modificación?',
        'Entendido, cambiaré el {field} de "{oldValue}" a "{newValue}". ¿Está de acuerdo?',
        'Muy bien, actualizaré el {field} de "{oldValue}" a "{newValue}". ¿Confirma?',
        'Perfecto, modificaré el {field} de "{oldValue}" a "{newValue}". ¿Procedo?',
        '¿Confirma cambiar el {field} de "{oldValue}" a "{newValue}"?'
      ],
      en: [
        'Perfect, I will change the {field} from "{oldValue}" to "{newValue}". Do you confirm this modification?',
        'Understood, I will change the {field} from "{oldValue}" to "{newValue}". Do you agree?',
        'Very well, I will update the {field} from "{oldValue}" to "{newValue}". Do you confirm?',
        'Perfect, I will modify the {field} from "{oldValue}" to "{newValue}". Shall I proceed?',
        'Do you confirm changing the {field} from "{oldValue}" to "{newValue}"?'
      ]
    },
    modify_success: {
      es: [
        '¡Perfecto! Su reserva ha sido modificada exitosamente. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Excelente! La modificación se ha realizado correctamente. Gracias por contactarnos. ¡Hasta luego!',
        '¡Muy bien! Su reserva ha sido actualizada exitosamente. Gracias por su llamada. ¡Que disfrute!',
        '¡Perfecto! La modificación se ha completado. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Excelente! Su reserva ha sido modificada correctamente. Gracias por contactarnos. ¡Hasta pronto!'
      ],
      en: [
        'Perfect! Your reservation has been modified successfully. Thank you for letting us know. Have a great day!',
        'Excellent! The modification has been completed correctly. Thank you for contacting us. Goodbye!',
        'Very well! Your reservation has been updated successfully. Thank you for your call. Enjoy!',
        'Perfect! The modification has been completed. Thank you for letting us know. Have a great day!',
        'Excellent! Your reservation has been modified correctly. Thank you for contacting us. See you soon!'
      ]
    },
    modify_error: {
      es: [
        'Lo siento, ha ocurrido un error al modificar su reserva. Por favor, inténtelo de nuevo más tarde o contacte con nosotros directamente.',
        'Disculpe, no he podido modificar su reserva. Por favor, llame de nuevo o contacte con nosotros por teléfono.',
        'Lo siento, ha habido un problema con la modificación. Por favor, inténtelo de nuevo o contacte con nosotros.',
        'Disculpe las molestias, no he podido actualizar su reserva. Por favor, contacte con nosotros directamente.',
        'Lo siento, ha ocurrido un error. Por favor, inténtelo de nuevo o llame a nuestro número principal.'
      ],
      en: [
        'Sorry, an error occurred while modifying your reservation. Please try again later or contact us directly.',
        'I apologize, I could not modify your reservation. Please call again or contact us by phone.',
        'Sorry, there was a problem with the modification. Please try again or contact us.',
        'Sorry for the inconvenience, I could not update your reservation. Please contact us directly.',
        'Sorry, an error occurred. Please try again or call our main number.'
      ]
    },
    modify_no_reservations: {
      es: [
        'No he encontrado reservas futuras con ese número de teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he localizado reservas con ese teléfono. ¿Desea reservar una mesa?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he encontrado reservas para ese teléfono. ¿Desea hacer una reserva?'
      ],
      en: [
        'I have not found future reservations with that phone number. Would you like to make a new reservation?',
        'There are no active reservations for that number. Would you like to make a new reservation?',
        'I have not located reservations with that phone. Would you like to reserve a table?',
        'There are no reservations registered for that number. Would you like to make a new reservation?',
        'I have not found reservations for that phone. Would you like to make a reservation?'
      ]
    },
    modify_offer_new: {
      es: [
        'No hay reservas para modificar. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas. ¿Quiere hacer una nueva reserva?',
        'No hay reservas futuras. ¿Desea reservar una mesa?',
        'No hay reservas para modificar. ¿Quiere hacer una reserva?',
        'No hay reservas. ¿Desea hacer una nueva reserva?'
      ],
      en: [
        'There are no reservations to modify. Would you like to make a new reservation?',
        'There are no active reservations. Would you like to make a new reservation?',
        'There are no future reservations. Would you like to reserve a table?',
        'There are no reservations to modify. Would you like to make a reservation?',
        'There are no reservations. Would you like to make a new reservation?'
      ]
    },
    modify_cancelled: {
      es: [
        'Entendido, no se realizará ninguna modificación. ¿En qué más puedo ayudarle?',
        'Perfecto, no modificaremos la reserva. ¿Qué necesita?',
        'Muy bien, no se harán cambios. ¿En qué puedo asistirle?',
        'Entendido, no se modificará nada. ¿Qué desea hacer?',
        'Perfecto, no se realizarán cambios. ¿Cómo puedo ayudarle?'
      ],
      en: [
        'Understood, no modification will be made. How else can I help you?',
        'Perfect, we will not modify the reservation. What do you need?',
        'Very well, no changes will be made. How can I assist you?',
        'Understood, nothing will be modified. What would you like to do?',
        'Perfect, no changes will be made. How can I help you?'
      ]
    },
    modify_unclear_option: {
      es: [
        'No he entendido qué opción quiere seleccionar. Por favor, diga el número de la reserva que desea modificar.',
        'No he podido identificar la opción. Por favor, mencione el número de la reserva.',
        'No he entendido su selección. Por favor, diga el número correspondiente.',
        'No he podido procesar su elección. Por favor, indique el número de la opción.',
        'No he entendido. Por favor, diga el número de la reserva que quiere modificar.'
      ],
      en: [
        'I did not understand which option you want to select. Please say the number of the reservation you want to modify.',
        'I could not identify the option. Please mention the number of the reservation.',
        'I did not understand your selection. Please say the corresponding number.',
        'I could not process your choice. Please indicate the option number.',
        'I did not understand. Please say the number of the reservation you want to modify.'
      ]
    },
    modify_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija un número de la lista.',
        'Esa opción no existe. Por favor, seleccione un número válido.',
        'Opción inválida. Por favor, elija un número de las opciones disponibles.',
        'Esa opción no está disponible. Por favor, seleccione otra.',
        'Opción no válida. Por favor, elija un número de la lista.'
      ],
      en: [
        'That option is not valid. Please choose a number from the list.',
        'That option does not exist. Please select a valid number.',
        'Invalid option. Please choose a number from the available options.',
        'That option is not available. Please select another one.',
        'Invalid option. Please choose a number from the list.'
      ]
    },
    modify_unclear_field: {
      es: [
        'No he entendido qué campo quiere modificar. Por favor, diga si quiere cambiar el nombre, la fecha, la hora o el número de personas.',
        'No he podido identificar qué desea cambiar. Por favor, mencione el campo: nombre, fecha, hora o personas.',
        'No he entendido su elección. Por favor, especifique qué quiere modificar.',
        'No he podido procesar su solicitud. Por favor, indique el campo a cambiar.',
        'No he entendido. Por favor, diga qué campo quiere modificar.'
      ],
      en: [
        'I did not understand which field you want to modify. Please say if you want to change the name, date, time or number of people.',
        'I could not identify what you want to change. Please mention the field: name, date, time or people.',
        'I did not understand your choice. Please specify what you want to modify.',
        'I could not process your request. Please indicate the field to change.',
        'I did not understand. Please say which field you want to modify.'
      ]
    },
    modify_unclear_value: {
      es: [
        'No he entendido el nuevo {field}. Por favor, dígamelo de nuevo.',
        'No he podido procesar el nuevo {field}. Por favor, repítalo.',
        'No he entendido el valor para {field}. Por favor, indíquelo de nuevo.',
        'No he podido identificar el nuevo {field}. Por favor, mencione el valor.',
        'No he entendido. Por favor, diga el nuevo {field} de nuevo.'
      ],
      en: [
        'I did not understand the new {field}. Please tell me again.',
        'I could not process the new {field}. Please repeat it.',
        'I did not understand the value for {field}. Please indicate it again.',
        'I could not identify the new {field}. Please mention the value.',
        'I did not understand. Please say the new {field} again.'
      ]
    },
    modify_unclear_confirmation: {
      es: [
        'No he entendido su respuesta. Por favor, diga "sí" para confirmar la modificación o "no" para cancelarla.',
        'No he podido procesar su confirmación. Por favor, responda "sí" o "no".',
        'No he entendido. Por favor, confirme con "sí" o cancele con "no".',
        'No he podido identificar su respuesta. Por favor, diga "sí" o "no".',
        'No he entendido. Por favor, responda "sí" para confirmar o "no" para cancelar.'
      ],
      en: [
        'I did not understand your response. Please say "yes" to confirm the modification or "no" to cancel it.',
        'I could not process your confirmation. Please answer "yes" or "no".',
        'I did not understand. Please confirm with "yes" or cancel with "no".',
        'I could not identify your response. Please say "yes" or "no".',
        'I did not understand. Please answer "yes" to confirm or "no" to cancel.'
      ]
    },

    // ===== MENSAJES PARA CANCELACIÓN DE RESERVAS =====
    cancel_ask_phone_choice: {
      es: [
        'Perfecto, para cancelar su reserva necesito verificar su identidad. ¿Quiere usar el mismo número de teléfono desde el que está llamando o prefiere usar otro número?',
        'Entendido, para buscar su reserva necesito su número de teléfono. ¿Desea usar este mismo número o tiene otro?',
        'Muy bien, para localizar su reserva necesito su número. ¿Usa el mismo número de esta llamada o prefiere darme otro?',
        'Perfecto, para cancelar necesito verificar su identidad. ¿Quiere usar este número o prefiere usar otro?',
        'Entendido, para proceder con la cancelación necesito su número. ¿Usa el mismo número desde el que llama o tiene otro?'
      ],
      en: [
        'Perfect, to cancel your reservation I need to verify your identity. Do you want to use the same phone number you are calling from or would you prefer to use another number?',
        'Understood, to find your reservation I need your phone number. Do you want to use this same number or do you have another one?',
        'Very well, to locate your reservation I need your number. Do you use the same number from this call or would you prefer to give me another one?',
        'Perfect, to cancel I need to verify your identity. Do you want to use this number or would you prefer to use another one?',
        'Understood, to proceed with the cancellation I need your number. Do you use the same number you are calling from or do you have another one?'
      ],
      de: [
        'Perfekt, um Ihre Reservierung zu stornieren, muss ich Ihre Identität überprüfen. Möchten Sie dieselbe Telefonnummer verwenden, von der aus Sie anrufen, oder bevorzugen Sie eine andere Nummer?',
        'Verstanden, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Möchten Sie dieselbe Nummer verwenden oder haben Sie eine andere?',
        'Sehr gut, um Ihre Reservierung zu finden, brauche ich Ihre Nummer. Verwenden Sie dieselbe Nummer von diesem Anruf oder bevorzugen Sie es, mir eine andere zu geben?',
        'Perfekt, zum Stornieren muss ich Ihre Identität überprüfen. Möchten Sie diese Nummer verwenden oder bevorzugen Sie eine andere?',
        'Verstanden, um mit der Stornierung fortzufahren, brauche ich Ihre Nummer. Verwenden Sie dieselbe Nummer, von der aus Sie anrufen, oder haben Sie eine andere?'
      ],
      fr: [
        'Parfait, pour annuler votre réservation, je dois vérifier votre identité. Voulez-vous utiliser le même numéro de téléphone depuis lequel vous appelez ou préférez-vous utiliser un autre numéro?',
        'Compris, pour trouver votre réservation, j\'ai besoin de votre numéro de téléphone. Voulez-vous utiliser ce même numéro ou en avez-vous un autre?',
        'Très bien, pour localiser votre réservation, j\'ai besoin de votre numéro. Utilisez-vous le même numéro de cet appel ou préférez-vous m\'en donner un autre?',
        'Parfait, pour annuler, je dois vérifier votre identité. Voulez-vous utiliser ce numéro ou préférez-vous utiliser un autre?',
        'Compris, pour procéder à l\'annulation, j\'ai besoin de votre numéro. Utilisez-vous le même numéro depuis lequel vous appelez ou en avez-vous un autre?'
      ],
      it: [
        'Perfetto, per cancellare la sua prenotazione devo verificare la sua identità. Vuole usare lo stesso numero di telefono da cui sta chiamando o preferisce usare un altro numero?',
        'Capito, per trovare la sua prenotazione ho bisogno del suo numero di telefono. Vuole usare questo stesso numero o ne ha un altro?',
        'Molto bene, per localizzare la sua prenotazione ho bisogno del suo numero. Usa lo stesso numero di questa chiamata o preferisce darmene un altro?',
        'Perfetto, per cancellare devo verificare la sua identità. Vuole usare questo numero o preferisce usarne un altro?',
        'Capito, per procedere con la cancellazione ho bisogno del suo numero. Usa lo stesso numero da cui sta chiamando o ne ha un altro?'
      ],
      pt: [
        'Perfeito, para cancelar sua reserva preciso verificar sua identidade. Quer usar o mesmo número de telefone de onde está ligando ou prefere usar outro número?',
        'Entendido, para encontrar sua reserva preciso do seu número de telefone. Quer usar este mesmo número ou tem outro?',
        'Muito bem, para localizar sua reserva preciso do seu número. Usa o mesmo número desta chamada ou prefere me dar outro?',
        'Perfeito, para cancelar preciso verificar sua identidade. Quer usar este número ou prefere usar outro?',
        'Entendido, para prosseguir com o cancelamento preciso do seu número. Usa o mesmo número de onde está ligando ou tem outro?'
      ]
    },
    cancel_ask_phone: {
      es: [
        'Perfecto, para cancelar su reserva necesito su número de teléfono. ¿Cuál es su número?',
        'Entendido, para buscar su reserva necesito su número de teléfono. ¿Podría darme su número?',
        'Muy bien, para localizar su reserva necesito su número de teléfono. ¿Cuál es?',
        'Perfecto, para cancelar necesito verificar su identidad. ¿Cuál es su número de teléfono?',
        'Entendido, para proceder con la cancelación necesito su número de teléfono. ¿Podría darmelo?'
      ],
      en: [
        'Perfect, to cancel your reservation I need your phone number. What is your number?',
        'Understood, to find your reservation I need your phone number. Could you give me your number?',
        'Very well, to locate your reservation I need your phone number. What is it?',
        'Perfect, to cancel I need to verify your identity. What is your phone number?',
        'Understood, to proceed with the cancellation I need your phone number. Could you give it to me?'
      ],
      de: [
        'Perfekt, um Ihre Reservierung zu stornieren, brauche ich Ihre Telefonnummer. Wie lautet Ihre Nummer?',
        'Verstanden, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Könnten Sie mir Ihre Nummer geben?',
        'Sehr gut, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Wie lautet sie?',
        'Perfekt, um zu stornieren, muss ich Ihre Identität überprüfen. Wie lautet Ihre Telefonnummer?',
        'Verstanden, um mit der Stornierung fortzufahren, brauche ich Ihre Telefonnummer. Könnten Sie sie mir geben?'
      ],
      it: [
        'Perfetto, per cancellare la sua prenotazione ho bisogno del suo numero di telefono. Qual è il suo numero?',
        'Capito, per trovare la sua prenotazione ho bisogno del suo numero di telefono. Potrebbe darmi il suo numero?',
        'Molto bene, per localizzare la sua prenotazione ho bisogno del suo numero di telefono. Qual è?',
        'Perfetto, per cancellare devo verificare la sua identità. Qual è il suo numero di telefono?',
        'Capito, per procedere con la cancellazione ho bisogno del suo numero di telefono. Potrebbe darmelo?'
      ],
      fr: [
        'Parfait, pour annuler votre réservation j\'ai besoin de votre numéro de téléphone. Quel est votre numéro?',
        'Compris, pour trouver votre réservation j\'ai besoin de votre numéro de téléphone. Pourriez-vous me donner votre numéro?',
        'Très bien, pour localiser votre réservation j\'ai besoin de votre numéro de téléphone. Quel est-il?',
        'Parfait, pour annuler je dois vérifier votre identité. Quel est votre numéro de téléphone?',
        'Compris, pour procéder à l\'annulation j\'ai besoin de votre numéro de téléphone. Pourriez-vous me le donner?'
      ],
      pt: [
        'Perfeito, para cancelar sua reserva preciso do seu número de telefone. Qual é o seu número?',
        'Entendido, para encontrar sua reserva preciso do seu número de telefone. Poderia me dar o seu número?',
        'Muito bem, para localizar sua reserva preciso do seu número de telefone. Qual é?',
        'Perfeito, para cancelar preciso verificar sua identidade. Qual é o seu número de telefone?',
        'Entendido, para prosseguir com o cancelamento preciso do seu número de telefone. Poderia me dar?'
      ]
    },
    cancel_show_single: {
      es: [
        'He encontrado su reserva:',
        'Perfecto, he localizado su reserva:',
        'Excelente, he encontrado su reserva:',
        'Muy bien, aquí está su reserva:',
        'Perfecto, aquí tiene su reserva:'
      ],
      en: [
        'I found your reservation:',
        'Perfect, I located your reservation:',
        'Excellent, I found your reservation:',
        'Very well, here is your reservation:',
        'Perfect, here is your reservation:'
      ],
      de: [
        'Ich habe Ihre Reservierung gefunden:',
        'Perfekt, ich habe Ihre Reservierung gefunden:',
        'Ausgezeichnet, ich habe Ihre Reservierung gefunden:',
        'Sehr gut, hier ist Ihre Reservierung:',
        'Perfekt, hier ist Ihre Reservierung:'
      ],
      it: [
        'Ho trovato la sua prenotazione:',
        'Perfetto, ho localizzato la sua prenotazione:',
        'Eccellente, ho trovato la sua prenotazione:',
        'Molto bene, ecco la sua prenotazione:',
        'Perfetto, ecco la sua prenotazione:'
      ],
      fr: [
        'J\'ai trouvé votre réservation:',
        'Parfait, j\'ai localisé votre réservation:',
        'Excellent, j\'ai trouvé votre réservation:',
        'Très bien, voici votre réservation:',
        'Parfait, voici votre réservation:'
      ],
      pt: [
        'Encontrei sua reserva:',
        'Perfeito, localizei sua reserva:',
        'Excelente, encontrei sua reserva:',
        'Muito bem, aqui está sua reserva:',
        'Perfeito, aqui está sua reserva:'
      ]
    },
    cancel_show_multiple: {
      es: [
        'He encontrado varias reservas a su nombre:',
        'Perfecto, he localizado múltiples reservas:',
        'Excelente, he encontrado varias reservas:',
        'Muy bien, aquí están sus reservas:',
        'Perfecto, aquí tiene sus reservas:'
      ],
      en: [
        'I found several reservations under your name:',
        'Perfect, I located multiple reservations:',
        'Excellent, I found several reservations:',
        'Very well, here are your reservations:',
        'Perfect, here are your reservations:'
      ],
      de: [
        'Ich habe mehrere Reservierungen unter Ihrem Namen gefunden:',
        'Perfekt, ich habe mehrere Reservierungen gefunden:',
        'Ausgezeichnet, ich habe mehrere Reservierungen gefunden:',
        'Sehr gut, hier sind Ihre Reservierungen:',
        'Perfekt, hier sind Ihre Reservierungen:'
      ],
      it: [
        'Ho trovato diverse prenotazioni a suo nome:',
        'Perfetto, ho localizzato più prenotazioni:',
        'Eccellente, ho trovato diverse prenotazioni:',
        'Molto bene, ecco le sue prenotazioni:',
        'Perfetto, ecco le sue prenotazioni:'
      ],
      fr: [
        'J\'ai trouvé plusieurs réservations à votre nom:',
        'Parfait, j\'ai localisé plusieurs réservations:',
        'Excellent, j\'ai trouvé plusieurs réservations:',
        'Très bien, voici vos réservations:',
        'Parfait, voici vos réservations:'
      ],
      pt: [
        'Encontrei várias reservas em seu nome:',
        'Perfeito, localizei múltiplas reservas:',
        'Excelente, encontrei várias reservas:',
        'Muito bem, aqui estão suas reservas:',
        'Perfeito, aqui estão suas reservas:'
      ]
    },
    cancel_choose_option: {
      es: [
        'Por favor, dígame qué opción desea cancelar. Puede decir "opción 1", "opción 2", etc.',
        '¿Cuál de estas reservas desea cancelar? Diga el número de la opción.',
        'Por favor, indique qué reserva quiere cancelar. Diga "primera", "segunda", etc.',
        '¿Qué opción desea cancelar? Puede decir el número de la opción.',
        'Por favor, elija qué reserva cancelar. Diga el número correspondiente.'
      ],
      en: [
        'Please tell me which option you want to cancel. You can say "option 1", "option 2", etc.',
        'Which of these reservations do you want to cancel? Say the option number.',
        'Please indicate which reservation you want to cancel. Say "first", "second", etc.',
        'Which option do you want to cancel? You can say the option number.',
        'Please choose which reservation to cancel. Say the corresponding number.'
      ],
      de: [
        'Bitte sagen Sie mir, welche Option Sie stornieren möchten. Sie können "Option 1", "Option 2" usw. sagen.',
        'Welche dieser Reservierungen möchten Sie stornieren? Sagen Sie die Optionsnummer.',
        'Bitte geben Sie an, welche Reservierung Sie stornieren möchten. Sagen Sie "erste", "zweite" usw.',
        'Welche Option möchten Sie stornieren? Sie können die Optionsnummer sagen.',
        'Bitte wählen Sie, welche Reservierung storniert werden soll. Sagen Sie die entsprechende Nummer.'
      ],
      it: [
        'Per favore, dimmi quale opzione vuoi cancellare. Puoi dire "opzione 1", "opzione 2", ecc.',
        'Quale di queste prenotazioni vuoi cancellare? Di\' il numero dell\'opzione.',
        'Per favore, indica quale prenotazione vuoi cancellare. Di\' "prima", "seconda", ecc.',
        'Quale opzione vuoi cancellare? Puoi dire il numero dell\'opzione.',
        'Per favore, scegli quale prenotazione cancellare. Di\' il numero corrispondente.'
      ],
      fr: [
        'Veuillez me dire quelle option vous voulez annuler. Vous pouvez dire "option 1", "option 2", etc.',
        'Laquelle de ces réservations voulez-vous annuler? Dites le numéro de l\'option.',
        'Veuillez indiquer quelle réservation vous voulez annuler. Dites "première", "deuxième", etc.',
        'Quelle option voulez-vous annuler? Vous pouvez dire le numéro de l\'option.',
        'Veuillez choisir quelle réservation annuler. Dites le numéro correspondant.'
      ],
      pt: [
        'Por favor, me diga qual opção você quer cancelar. Você pode dizer "opção 1", "opção 2", etc.',
        'Qual dessas reservas você quer cancelar? Diga o número da opção.',
        'Por favor, indique qual reserva você quer cancelar. Diga "primeira", "segunda", etc.',
        'Qual opção você quer cancelar? Você pode dizer o número da opção.',
        'Por favor, escolha qual reserva cancelar. Diga o número correspondente.'
      ]
    },
    cancel_confirm: {
      es: [
        '¿Está seguro de que desea cancelar esta reserva?',
        '¿Confirma que quiere cancelar esta reserva?',
        '¿Desea proceder con la cancelación?',
        '¿Está completamente seguro de cancelar?',
        '¿Confirma la cancelación de esta reserva?'
      ],
      en: [
        'Are you sure you want to cancel this reservation?',
        'Do you confirm that you want to cancel this reservation?',
        'Do you want to proceed with the cancellation?',
        'Are you completely sure about canceling?',
        'Do you confirm the cancellation of this reservation?'
      ],
      de: [
        'Sind Sie sicher, dass Sie diese Reservierung stornieren möchten?',
        'Bestätigen Sie, dass Sie diese Reservierung stornieren möchten?',
        'Möchten Sie mit der Stornierung fortfahren?',
        'Sind Sie sich völlig sicher, dass Sie stornieren möchten?',
        'Bestätigen Sie die Stornierung dieser Reservierung?'
      ],
      it: [
        'È sicuro di voler cancellare questa prenotazione?',
        'Conferma di voler cancellare questa prenotazione?',
        'Vuole procedere con la cancellazione?',
        'È completamente sicuro di cancellare?',
        'Conferma la cancellazione di questa prenotazione?'
      ],
      fr: [
        'Êtes-vous sûr de vouloir annuler cette réservation?',
        'Confirmez-vous que vous voulez annuler cette réservation?',
        'Voulez-vous procéder à l\'annulation?',
        'Êtes-vous complètement sûr d\'annuler?',
        'Confirmez-vous l\'annulation de cette réservation?'
      ],
      pt: [
        'Tem certeza de que quer cancelar esta reserva?',
        'Confirma que quer cancelar esta reserva?',
        'Quer prosseguir com o cancelamento?',
        'Tem certeza absoluta de cancelar?',
        'Confirma o cancelamento desta reserva?'
      ]
    },
    cancel_confirm_selected: {
      es: [
        'Perfecto, ha seleccionado:',
        'Excelente, ha elegido:',
        'Muy bien, ha escogido:',
        'Perfecto, su selección es:',
        'Excelente, ha seleccionado:'
      ],
      en: [
        'Perfect, you selected:',
        'Excellent, you chose:',
        'Very well, you picked:',
        'Perfect, your selection is:',
        'Excellent, you selected:'
      ],
      de: [
        'Perfekt, Sie haben ausgewählt:',
        'Ausgezeichnet, Sie haben gewählt:',
        'Sehr gut, Sie haben ausgewählt:',
        'Perfekt, Ihre Auswahl ist:',
        'Ausgezeichnet, Sie haben ausgewählt:'
      ],
      it: [
        'Perfetto, ha selezionato:',
        'Eccellente, ha scelto:',
        'Molto bene, ha scelto:',
        'Perfetto, la sua selezione è:',
        'Eccellente, ha selezionato:'
      ],
      fr: [
        'Parfait, vous avez sélectionné:',
        'Excellent, vous avez choisi:',
        'Très bien, vous avez choisi:',
        'Parfait, votre sélection est:',
        'Excellent, vous avez sélectionné:'
      ],
      pt: [
        'Perfeito, você selecionou:',
        'Excelente, você escolheu:',
        'Muito bem, você escolheu:',
        'Perfeito, sua seleção é:',
        'Excelente, você selecionou:'
      ]
    },
    cancel_success: {
      es: [
        '¡Perfecto! Su reserva ha sido cancelada exitosamente. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Excelente! La reserva ha sido cancelada correctamente. Gracias por notificarnos. ¡Hasta pronto!',
        '¡Muy bien! Su reserva se ha cancelado exitosamente. Gracias por contactarnos. ¡Que tenga buen día!',
        '¡Perfecto! La cancelación se ha procesado correctamente. Gracias por avisarnos. ¡Hasta la próxima!',
        '¡Excelente! Su reserva ha sido cancelada. Gracias por notificarnos a tiempo. ¡Que tenga buen día!'
      ],
      en: [
        'Perfect! Your reservation has been canceled successfully. Thank you for letting us know. Have a great day!',
        'Excellent! The reservation has been canceled correctly. Thank you for notifying us. See you soon!',
        'Very well! Your reservation has been canceled successfully. Thank you for contacting us. Have a great day!',
        'Perfect! The cancellation has been processed correctly. Thank you for letting us know. Until next time!',
        'Excellent! Your reservation has been canceled. Thank you for notifying us in time. Have a great day!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich storniert. Vielen Dank, dass Sie uns benachrichtigt haben. Haben Sie einen schönen Tag!',
        'Ausgezeichnet! Die Reservierung wurde korrekt storniert. Vielen Dank für die Benachrichtigung. Bis bald!',
        'Sehr gut! Ihre Reservierung wurde erfolgreich storniert. Vielen Dank für den Kontakt. Haben Sie einen schönen Tag!',
        'Perfekt! Die Stornierung wurde korrekt bearbeitet. Vielen Dank, dass Sie uns benachrichtigt haben. Bis zum nächsten Mal!',
        'Ausgezeichnet! Ihre Reservierung wurde storniert. Vielen Dank für die rechtzeitige Benachrichtigung. Haben Sie einen schönen Tag!'
      ],
      it: [
        'Perfetto! La sua prenotazione è stata cancellata con successo. Grazie per averci avvisato. Buona giornata!',
        'Eccellente! La prenotazione è stata cancellata correttamente. Grazie per averci notificato. A presto!',
        'Molto bene! La sua prenotazione è stata cancellata con successo. Grazie per averci contattato. Buona giornata!',
        'Perfetto! La cancellazione è stata elaborata correttamente. Grazie per averci avvisato. Alla prossima!',
        'Eccellente! La sua prenotazione è stata cancellata. Grazie per averci notificato in tempo. Buona giornata!'
      ],
      fr: [
        'Parfait! Votre réservation a été annulée avec succès. Merci de nous avoir prévenus. Passez une bonne journée!',
        'Excellent! La réservation a été annulée correctement. Merci de nous avoir notifiés. À bientôt!',
        'Très bien! Votre réservation a été annulée avec succès. Merci de nous avoir contactés. Passez une bonne journée!',
        'Parfait! L\'annulation a été traitée correctement. Merci de nous avoir prévenus. À la prochaine!',
        'Excellent! Votre réservation a été annulée. Merci de nous avoir notifiés à temps. Passez une bonne journée!'
      ],
      pt: [
        'Perfeito! Sua reserva foi cancelada com sucesso. Obrigado por nos avisar. Tenha um ótimo dia!',
        'Excelente! A reserva foi cancelada corretamente. Obrigado por nos notificar. Até logo!',
        'Muito bem! Sua reserva foi cancelada com sucesso. Obrigado por nos contatar. Tenha um ótimo dia!',
        'Perfeito! O cancelamento foi processado corretamente. Obrigado por nos avisar. Até a próxima!',
        'Excelente! Sua reserva foi cancelada. Obrigado por nos notificar a tempo. Tenha um ótimo dia!'
      ]
    },
    cancel_error: {
      es: [
        'Disculpe, hubo un error al cancelar su reserva. Por favor, contacte directamente al restaurante.',
        'Lo siento, no pude cancelar su reserva. Por favor, llame directamente al restaurante.',
        'Perdón, hubo un problema técnico. Por favor, contacte al restaurante directamente.',
        'Disculpe, no pude procesar la cancelación. Por favor, llame al restaurante.',
        'Lo siento, hubo un error. Por favor, contacte directamente al restaurante.'
      ],
      en: [
        'Sorry, there was an error canceling your reservation. Please contact the restaurant directly.',
        'I\'m sorry, I couldn\'t cancel your reservation. Please call the restaurant directly.',
        'Sorry, there was a technical problem. Please contact the restaurant directly.',
        'Sorry, I couldn\'t process the cancellation. Please call the restaurant.',
        'I\'m sorry, there was an error. Please contact the restaurant directly.'
      ],
      de: [
        'Entschuldigung, es gab einen Fehler beim Stornieren Ihrer Reservierung. Bitte kontaktieren Sie das Restaurant direkt.',
        'Es tut mir leid, ich konnte Ihre Reservierung nicht stornieren. Bitte rufen Sie das Restaurant direkt an.',
        'Entschuldigung, es gab ein technisches Problem. Bitte kontaktieren Sie das Restaurant direkt.',
        'Entschuldigung, ich konnte die Stornierung nicht bearbeiten. Bitte rufen Sie das Restaurant an.',
        'Es tut mir leid, es gab einen Fehler. Bitte kontaktieren Sie das Restaurant direkt.'
      ],
      it: [
        'Scusi, c\'è stato un errore nel cancellare la sua prenotazione. Per favore, contatti direttamente il ristorante.',
        'Mi dispiace, non sono riuscito a cancellare la sua prenotazione. Per favore, chiami direttamente il ristorante.',
        'Scusi, c\'è stato un problema tecnico. Per favore, contatti direttamente il ristorante.',
        'Scusi, non sono riuscito a processare la cancellazione. Per favore, chiami il ristorante.',
        'Mi dispiace, c\'è stato un errore. Per favore, contatti direttamente il ristorante.'
      ],
      fr: [
        'Désolé, il y a eu une erreur lors de l\'annulation de votre réservation. Veuillez contacter directement le restaurant.',
        'Je suis désolé, je n\'ai pas pu annuler votre réservation. Veuillez appeler directement le restaurant.',
        'Désolé, il y a eu un problème technique. Veuillez contacter directement le restaurant.',
        'Désolé, je n\'ai pas pu traiter l\'annulation. Veuillez appeler le restaurant.',
        'Je suis désolé, il y a eu une erreur. Veuillez contacter directement le restaurant.'
      ],
      pt: [
        'Desculpe, houve um erro ao cancelar sua reserva. Por favor, entre em contato diretamente com o restaurante.',
        'Sinto muito, não consegui cancelar sua reserva. Por favor, ligue diretamente para o restaurante.',
        'Desculpe, houve um problema técnico. Por favor, entre em contato diretamente com o restaurante.',
        'Desculpe, não consegui processar o cancelamento. Por favor, ligue para o restaurante.',
        'Sinto muito, houve um erro. Por favor, entre em contato diretamente com o restaurante.'
      ]
    },
    cancel_no_reservations: {
      es: [
        'No he encontrado ninguna reserva activa con ese número de teléfono. ¿Le gustaría hacer una nueva reserva?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he localizado reservas con ese teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Le gustaría reservar una mesa?',
        'No encontré reservas con ese teléfono. ¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'I didn\'t find any active reservations with that phone number. Would you like to make a new reservation?',
        'There are no reservations registered for that number. Do you want to make a new reservation?',
        'I didn\'t locate reservations with that phone. Do you want to make a new reservation?',
        'There are no active reservations for that number. Would you like to reserve a table?',
        'I didn\'t find reservations with that phone. Do you want to make a new reservation?'
      ],
      de: [
        'Ich habe keine aktiven Reservierungen mit dieser Telefonnummer gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine Reservierungen für diese Nummer. Möchten Sie eine neue Reservierung vornehmen?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine aktiven Reservierungen für diese Nummer. Möchten Sie einen Tisch reservieren?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Non ho trovato prenotazioni attive con quel numero di telefono. Vorresti fare una nuova prenotazione?',
        'Non ci sono prenotazioni registrate per quel numero. Vuoi fare una nuova prenotazione?',
        'Non ho localizzato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?',
        'Non ci sono prenotazioni attive per quel numero. Vorresti prenotare un tavolo?',
        'Non ho trovato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Je n\'ai trouvé aucune réservation active avec ce numéro de téléphone. Souhaitez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations enregistrées pour ce numéro. Voulez-vous faire une nouvelle réservation?',
        'Je n\'ai pas localisé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations actives pour ce numéro. Souhaitez-vous réserver une table?',
        'Je n\'ai pas trouvé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Não encontrei reservas ativas com esse número de telefone. Gostaria de fazer uma nova reserva?',
        'Não há reservas registradas para esse número. Quer fazer uma nova reserva?',
        'Não localizei reservas com esse telefone. Quer fazer uma nova reserva?',
        'Não há reservas ativas para esse número. Gostaria de reservar uma mesa?',
        'Não encontrei reservas com esse telefone. Quer fazer uma nova reserva?'
      ]
    },
    cancel_offer_new: {
      es: [
        '¿Le gustaría hacer una nueva reserva en su lugar?',
        '¿Quiere hacer una nueva reserva?',
        '¿Desea reservar una mesa?',
        '¿Le gustaría hacer una reserva?',
        '¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'Would you like to make a new reservation instead?',
        'Do you want to make a new reservation?',
        'Do you want to reserve a table?',
        'Would you like to make a reservation?',
        'Do you want to make a new reservation?'
      ],
      de: [
        'Möchten Sie stattdessen eine neue Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?',
        'Möchten Sie einen Tisch reservieren?',
        'Möchten Sie eine Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Vorresti fare una nuova prenotazione invece?',
        'Vuoi fare una nuova prenotazione?',
        'Vuoi prenotare un tavolo?',
        'Vorresti fare una prenotazione?',
        'Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Souhaitez-vous faire une nouvelle réservation à la place?',
        'Voulez-vous faire une nouvelle réservation?',
        'Voulez-vous réserver une table?',
        'Souhaitez-vous faire une réservation?',
        'Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Gostaria de fazer uma nova reserva em vez disso?',
        'Quer fazer uma nova reserva?',
        'Quer reservar uma mesa?',
        'Gostaria de fazer uma reserva?',
        'Quer fazer uma nova reserva?'
      ]
    },
    cancel_cancelled: {
      es: [
        'Perfecto, no cancelaremos la reserva. ¿En qué más puedo ayudarle?',
        'Entendido, mantendremos la reserva. ¿Qué más necesita?',
        'Muy bien, no procederemos con la cancelación. ¿En qué puedo ayudarle?',
        'Perfecto, la reserva se mantiene. ¿Qué más puedo hacer por usted?',
        'Excelente, no cancelaremos. ¿En qué puedo asistirle?'
      ],
      en: [
        'Perfect, we won\'t cancel the reservation. How else can I help you?',
        'Understood, we\'ll keep the reservation. What else do you need?',
        'Very well, we won\'t proceed with the cancellation. How can I help you?',
        'Perfect, the reservation remains. What else can I do for you?',
        'Excellent, we won\'t cancel. How can I assist you?'
      ],
      de: [
        'Perfekt, wir werden die Reservierung nicht stornieren. Wie kann ich Ihnen sonst helfen?',
        'Verstanden, wir behalten die Reservierung. Was brauchen Sie sonst?',
        'Sehr gut, wir werden nicht mit der Stornierung fortfahren. Wie kann ich Ihnen helfen?',
        'Perfekt, die Reservierung bleibt bestehen. Was kann ich sonst für Sie tun?',
        'Ausgezeichnet, wir werden nicht stornieren. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Perfetto, non cancelleremo la prenotazione. Come altro posso aiutarti?',
        'Capito, manterremo la prenotazione. Cos\'altro ti serve?',
        'Molto bene, non procederemo con la cancellazione. Come posso aiutarti?',
        'Perfetto, la prenotazione rimane. Cos\'altro posso fare per te?',
        'Eccellente, non cancelleremo. Come posso assisterti?'
      ],
      fr: [
        'Parfait, nous n\'annulerons pas la réservation. Comment puis-je vous aider d\'autre?',
        'Compris, nous garderons la réservation. De quoi avez-vous besoin d\'autre?',
        'Très bien, nous ne procéderons pas à l\'annulation. Comment puis-je vous aider?',
        'Parfait, la réservation reste. Que puis-je faire d\'autre pour vous?',
        'Excellent, nous n\'annulerons pas. Comment puis-je vous assister?'
      ],
      pt: [
        'Perfeito, não cancelaremos a reserva. Como mais posso ajudá-lo?',
        'Entendido, manteremos a reserva. O que mais você precisa?',
        'Muito bem, não procederemos com o cancelamento. Como posso ajudá-lo?',
        'Perfeito, a reserva permanece. O que mais posso fazer por você?',
        'Excelente, não cancelaremos. Como posso assisti-lo?'
      ]
    },
    cancel_unclear_option: {
      es: [
        'Disculpe, no entendí qué opción desea. Por favor, diga el número de la opción que quiere cancelar.',
        'No entendí bien. Por favor, indique el número de la opción que desea cancelar.',
        'Perdón, no capté bien. Por favor, diga "opción 1", "opción 2", etc.',
        'No entendí. Por favor, repita el número de la opción que quiere cancelar.',
        'Disculpe, no entendí. Por favor, diga claramente el número de la opción.'
      ],
      en: [
        'Sorry, I didn\'t understand which option you want. Please say the number of the option you want to cancel.',
        'I didn\'t understand well. Please indicate the number of the option you want to cancel.',
        'Sorry, I didn\'t catch that. Please say "option 1", "option 2", etc.',
        'I didn\'t understand. Please repeat the number of the option you want to cancel.',
        'Sorry, I didn\'t understand. Please say the option number clearly.'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, welche Option Sie möchten. Bitte sagen Sie die Nummer der Option, die Sie stornieren möchten.',
        'Ich verstand nicht gut. Bitte geben Sie die Nummer der Option an, die Sie stornieren möchten.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie "Option 1", "Option 2" usw.',
        'Ich verstand nicht. Bitte wiederholen Sie die Nummer der Option, die Sie stornieren möchten.',
        'Entschuldigung, ich verstand nicht. Bitte sagen Sie die Optionsnummer deutlich.'
      ],
      it: [
        'Scusi, non ho capito quale opzione vuole. Per favore, dica il numero dell\'opzione che vuole cancellare.',
        'Non ho capito bene. Per favore, indichi il numero dell\'opzione che vuole cancellare.',
        'Scusi, non ho capito. Per favore, dica "opzione 1", "opzione 2", ecc.',
        'Non ho capito. Per favore, ripeta il numero dell\'opzione che vuole cancellare.',
        'Scusi, non ho capito. Per favore, dica chiaramente il numero dell\'opzione.'
      ],
      fr: [
        'Désolé, je n\'ai pas compris quelle option vous voulez. Veuillez dire le numéro de l\'option que vous voulez annuler.',
        'Je n\'ai pas bien compris. Veuillez indiquer le numéro de l\'option que vous voulez annuler.',
        'Désolé, je n\'ai pas saisi. Veuillez dire "option 1", "option 2", etc.',
        'Je n\'ai pas compris. Veuillez répéter le numéro de l\'option que vous voulez annuler.',
        'Désolé, je n\'ai pas compris. Veuillez dire clairement le numéro de l\'option.'
      ],
      pt: [
        'Desculpe, não entendi qual opção você quer. Por favor, diga o número da opção que quer cancelar.',
        'Não entendi bem. Por favor, indique o número da opção que quer cancelar.',
        'Desculpe, não entendi. Por favor, diga "opção 1", "opção 2", etc.',
        'Não entendi. Por favor, repita o número da opção que quer cancelar.',
        'Desculpe, não entendi. Por favor, diga claramente o número da opção.'
      ]
    },
    cancel_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija una de las opciones disponibles.',
        'Esa opción no existe. Por favor, seleccione una opción válida.',
        'Opción incorrecta. Por favor, elija entre las opciones mostradas.',
        'Esa opción no está disponible. Por favor, seleccione una opción válida.',
        'Opción no válida. Por favor, elija una de las opciones correctas.'
      ],
      en: [
        'That option is not valid. Please choose one of the available options.',
        'That option doesn\'t exist. Please select a valid option.',
        'Incorrect option. Please choose from the options shown.',
        'That option is not available. Please select a valid option.',
        'Invalid option. Please choose one of the correct options.'
      ],
      de: [
        'Diese Option ist nicht gültig. Bitte wählen Sie eine der verfügbaren Optionen.',
        'Diese Option existiert nicht. Bitte wählen Sie eine gültige Option.',
        'Falsche Option. Bitte wählen Sie aus den gezeigten Optionen.',
        'Diese Option ist nicht verfügbar. Bitte wählen Sie eine gültige Option.',
        'Ungültige Option. Bitte wählen Sie eine der korrekten Optionen.'
      ],
      it: [
        'Quell\'opzione non è valida. Per favore, scegli una delle opzioni disponibili.',
        'Quell\'opzione non esiste. Per favore, seleziona un\'opzione valida.',
        'Opzione incorretta. Per favore, scegli tra le opzioni mostrate.',
        'Quell\'opzione non è disponibile. Per favore, seleziona un\'opzione valida.',
        'Opzione non valida. Per favore, scegli una delle opzioni corrette.'
      ],
      fr: [
        'Cette option n\'est pas valide. Veuillez choisir une des options disponibles.',
        'Cette option n\'existe pas. Veuillez sélectionner une option valide.',
        'Option incorrecte. Veuillez choisir parmi les options affichées.',
        'Cette option n\'est pas disponible. Veuillez sélectionner une option valide.',
        'Option non valide. Veuillez choisir une des options correctes.'
      ],
      pt: [
        'Essa opção não é válida. Por favor, escolha uma das opções disponíveis.',
        'Essa opção não existe. Por favor, selecione uma opção válida.',
        'Opção incorreta. Por favor, escolha entre as opções mostradas.',
        'Essa opção não está disponível. Por favor, selecione uma opção válida.',
        'Opção inválida. Por favor, escolha uma das opções corretas.'
      ]
    },
    cancel_unclear_confirmation: {
      es: [
        'Disculpe, no entendí bien su respuesta. ¿Desea cancelar la reserva o no?',
        'No entendí claramente. Por favor, diga "sí" para cancelar o "no" para mantener la reserva.',
        'Perdón, no capté bien. ¿Confirma que quiere cancelar esta reserva?',
        'No entendí. Por favor, responda claramente: ¿sí o no?',
        'Disculpe, no entendí. ¿Quiere cancelar la reserva?'
      ],
      en: [
        'Sorry, I didn\'t understand your response well. Do you want to cancel the reservation or not?',
        'I didn\'t understand clearly. Please say "yes" to cancel or "no" to keep the reservation.',
        'Sorry, I didn\'t catch that. Do you confirm you want to cancel this reservation?',
        'I didn\'t understand. Please answer clearly: yes or no?',
        'Sorry, I didn\'t understand. Do you want to cancel the reservation?'
      ],
      de: [
        'Entschuldigung, ich verstand Ihre Antwort nicht gut. Möchten Sie die Reservierung stornieren oder nicht?',
        'Ich verstand nicht klar. Bitte sagen Sie "ja" zum Stornieren oder "nein" zum Behalten der Reservierung.',
        'Entschuldigung, ich habe das nicht verstanden. Bestätigen Sie, dass Sie diese Reservierung stornieren möchten?',
        'Ich verstand nicht. Bitte antworten Sie klar: ja oder nein?',
        'Entschuldigung, ich verstand nicht. Möchten Sie die Reservierung stornieren?'
      ],
      it: [
        'Scusi, non ho capito bene la sua risposta. Vuole cancellare la prenotazione o no?',
        'Non ho capito chiaramente. Per favore, dica "sì" per cancellare o "no" per mantenere la prenotazione.',
        'Scusi, non ho capito. Conferma di voler cancellare questa prenotazione?',
        'Non ho capito. Per favore, risponda chiaramente: sì o no?',
        'Scusi, non ho capito. Vuole cancellare la prenotazione?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre réponse. Voulez-vous annuler la réservation ou non?',
        'Je n\'ai pas compris clairement. Veuillez dire "oui" pour annuler ou "non" pour garder la réservation.',
        'Désolé, je n\'ai pas saisi. Confirmez-vous que vous voulez annuler cette réservation?',
        'Je n\'ai pas compris. Veuillez répondre clairement: oui ou non?',
        'Désolé, je n\'ai pas compris. Voulez-vous annuler la réservation?'
      ],
      pt: [
        'Desculpe, não entendi bem sua resposta. Quer cancelar a reserva ou não?',
        'Não entendi claramente. Por favor, diga "sim" para cancelar ou "não" para manter a reserva.',
        'Desculpe, não entendi. Confirma que quer cancelar esta reserva?',
        'Não entendi. Por favor, responda claramente: sim ou não?',
        'Desculpe, não entendi. Quer cancelar a reserva?'
      ]
    },
    modify_ask_phone_choice: {
      es: [
        'Para modificar su reserva, ¿desea usar el mismo número de teléfono desde el que está llamando?',
        '¿Quiere usar este número de teléfono para buscar su reserva o tiene otro?',
        '¿Desea buscar su reserva con este número o prefiere usar otro?',
        '¿Usamos este teléfono para encontrar su reserva o tiene otro número?',
        '¿Desea buscar la reserva con este número de teléfono?'
      ],
      en: [
        'To modify your reservation, do you want to use the same phone number you are calling from?',
        'Do you want to use this phone number to find your reservation or do you have another one?',
        'Do you want to search for your reservation with this number or would you prefer to use another?',
        'Shall we use this phone to find your reservation or do you have another number?',
        'Do you want to search for the reservation with this phone number?'
      ],
      de: [
        'Um Ihre Reservierung zu ändern, möchten Sie die gleiche Telefonnummer verwenden, von der Sie anrufen?',
        'Möchten Sie diese Telefonnummer verwenden, um Ihre Reservierung zu finden, oder haben Sie eine andere?',
        'Möchten Sie mit dieser Nummer nach Ihrer Reservierung suchen oder bevorzugen Sie eine andere?',
        'Sollen wir dieses Telefon verwenden, um Ihre Reservierung zu finden, oder haben Sie eine andere Nummer?',
        'Möchten Sie mit dieser Telefonnummer nach der Reservierung suchen?'
      ],
      it: [
        'Per modificare la sua prenotazione, vuole usare lo stesso numero di telefono da cui sta chiamando?',
        'Vuole usare questo numero di telefono per trovare la sua prenotazione o ne ha un altro?',
        'Vuole cercare la sua prenotazione con questo numero o preferisce usare un altro?',
        'Usiamo questo telefono per trovare la sua prenotazione o ha un altro numero?',
        'Vuole cercare la prenotazione con questo numero di telefono?'
      ],
      fr: [
        'Pour modifier votre réservation, souhaitez-vous utiliser le même numéro de téléphone depuis lequel vous appelez?',
        'Voulez-vous utiliser ce numéro de téléphone pour trouver votre réservation ou en avez-vous un autre?',
        'Voulez-vous rechercher votre réservation avec ce numéro ou préférez-vous en utiliser un autre?',
        'Utilisons-nous ce téléphone pour trouver votre réservation ou avez-vous un autre numéro?',
        'Voulez-vous rechercher la réservation avec ce numéro de téléphone?'
      ],
      pt: [
        'Para modificar sua reserva, deseja usar o mesmo número de telefone de onde está ligando?',
        'Quer usar este número de telefone para encontrar sua reserva ou tem outro?',
        'Quer buscar sua reserva com este número ou prefere usar outro?',
        'Usamos este telefone para encontrar sua reserva ou você tem outro número?',
        'Quer buscar a reserva com este número de telefone?'
      ]
    },
    modify_ask_phone: {
      es: [
        'Perfecto. ¿Cuál es el número de teléfono con el que hizo la reserva?',
        'Por favor, dígame el número de teléfono de la reserva que desea modificar.',
        '¿Puede indicarme el número de teléfono asociado a su reserva?',
        'Necesito el número de teléfono con el que hizo la reserva. ¿Cuál es?',
        'Por favor, proporcione el número de teléfono de su reserva.'
      ],
      en: [
        'Perfect. What is the phone number you used for the reservation?',
        'Please tell me the phone number of the reservation you want to modify.',
        'Can you give me the phone number associated with your reservation?',
        'I need the phone number you used for the reservation. What is it?',
        'Please provide the phone number of your reservation.'
      ],
      de: [
        'Perfekt. Wie lautet die Telefonnummer, die Sie für die Reservierung verwendet haben?',
        'Bitte sagen Sie mir die Telefonnummer der Reservierung, die Sie ändern möchten.',
        'Können Sie mir die mit Ihrer Reservierung verbundene Telefonnummer geben?',
        'Ich brauche die Telefonnummer, die Sie für die Reservierung verwendet haben. Wie lautet sie?',
        'Bitte geben Sie die Telefonnummer Ihrer Reservierung an.'
      ],
      it: [
        'Perfetto. Qual è il numero di telefono che ha usato per la prenotazione?',
        'Per favore, mi dica il numero di telefono della prenotazione che desidera modificare.',
        'Può darmi il numero di telefono associato alla sua prenotazione?',
        'Ho bisogno del numero di telefono che ha usato per la prenotazione. Qual è?',
        'Per favore, fornisca il numero di telefono della sua prenotazione.'
      ],
      fr: [
        'Parfait. Quel est le numéro de téléphone que vous avez utilisé pour la réservation?',
        'Veuillez me donner le numéro de téléphone de la réservation que vous souhaitez modifier.',
        'Pouvez-vous me donner le numéro de téléphone associé à votre réservation?',
        'J\'ai besoin du numéro de téléphone que vous avez utilisé pour la réservation. Quel est-il?',
        'Veuillez fournir le numéro de téléphone de votre réservation.'
      ],
      pt: [
        'Perfeito. Qual é o número de telefone que você usou para a reserva?',
        'Por favor, me diga o número de telefone da reserva que deseja modificar.',
        'Pode me dar o número de telefone associado à sua reserva?',
        'Preciso do número de telefone que você usou para a reserva. Qual é?',
        'Por favor, forneça o número de telefone da sua reserva.'
      ]
    },
    modify_show_single: {
      es: [
        'He encontrado su reserva:',
        'Perfecto, he localizado su reserva:',
        'Excelente, he encontrado su reserva:',
        'Muy bien, aquí está su reserva:',
        'Perfecto, aquí tiene su reserva:'
      ],
      en: [
        'I found your reservation:',
        'Perfect, I located your reservation:',
        'Excellent, I found your reservation:',
        'Very well, here is your reservation:',
        'Perfect, here is your reservation:'
      ],
      de: [
        'Ich habe Ihre Reservierung gefunden:',
        'Perfekt, ich habe Ihre Reservierung gefunden:',
        'Ausgezeichnet, ich habe Ihre Reservierung gefunden:',
        'Sehr gut, hier ist Ihre Reservierung:',
        'Perfekt, hier ist Ihre Reservierung:'
      ],
      it: [
        'Ho trovato la sua prenotazione:',
        'Perfetto, ho localizzato la sua prenotazione:',
        'Eccellente, ho trovato la sua prenotazione:',
        'Molto bene, ecco la sua prenotazione:',
        'Perfetto, ecco la sua prenotazione:'
      ],
      fr: [
        'J\'ai trouvé votre réservation:',
        'Parfait, j\'ai localisé votre réservation:',
        'Excellent, j\'ai trouvé votre réservation:',
        'Très bien, voici votre réservation:',
        'Parfait, voici votre réservation:'
      ],
      pt: [
        'Encontrei sua reserva:',
        'Perfeito, localizei sua reserva:',
        'Excelente, encontrei sua reserva:',
        'Muito bem, aqui está sua reserva:',
        'Perfeito, aqui está sua reserva:'
      ]
    },
    modify_show_multiple: {
      es: [
        'He encontrado varias reservas a su nombre:',
        'Perfecto, he localizado múltiples reservas:',
        'Excelente, he encontrado varias reservas:',
        'Muy bien, aquí están sus reservas:',
        'Perfecto, aquí tiene sus reservas:'
      ],
      en: [
        'I found several reservations under your name:',
        'Perfect, I located multiple reservations:',
        'Excellent, I found several reservations:',
        'Very well, here are your reservations:',
        'Perfect, here are your reservations:'
      ],
      de: [
        'Ich habe mehrere Reservierungen unter Ihrem Namen gefunden:',
        'Perfekt, ich habe mehrere Reservierungen gefunden:',
        'Ausgezeichnet, ich habe mehrere Reservierungen gefunden:',
        'Sehr gut, hier sind Ihre Reservierungen:',
        'Perfekt, hier sind Ihre Reservierungen:'
      ],
      it: [
        'Ho trovato diverse prenotazioni a suo nome:',
        'Perfetto, ho localizzato più prenotazioni:',
        'Eccellente, ho trovato diverse prenotazioni:',
        'Molto bene, ecco le sue prenotazioni:',
        'Perfetto, ecco le sue prenotazioni:'
      ],
      fr: [
        'J\'ai trouvé plusieurs réservations à votre nom:',
        'Parfait, j\'ai localisé plusieurs réservations:',
        'Excellent, j\'ai trouvé plusieurs réservations:',
        'Très bien, voici vos réservations:',
        'Parfait, voici vos réservations:'
      ],
      pt: [
        'Encontrei várias reservas em seu nome:',
        'Perfeito, localizei múltiplas reservas:',
        'Excelente, encontrei várias reservas:',
        'Muito bem, aqui estão suas reservas:',
        'Perfeito, aqui estão suas reservas:'
      ]
    },
    modify_choose_option: {
      es: [
        'Por favor, dígame qué opción desea modificar. Puede decir "opción 1", "opción 2", etc.',
        '¿Cuál de estas reservas desea modificar? Diga el número de la opción.',
        'Por favor, indique qué reserva quiere modificar. Diga "primera", "segunda", etc.',
        '¿Qué opción desea modificar? Puede decir el número de la opción.',
        'Por favor, elija qué reserva modificar. Diga el número correspondiente.'
      ],
      en: [
        'Please tell me which option you want to modify. You can say "option 1", "option 2", etc.',
        'Which of these reservations do you want to modify? Say the option number.',
        'Please indicate which reservation you want to modify. Say "first", "second", etc.',
        'Which option do you want to modify? You can say the option number.',
        'Please choose which reservation to modify. Say the corresponding number.'
      ],
      de: [
        'Bitte sagen Sie mir, welche Option Sie ändern möchten. Sie können "Option 1", "Option 2" usw. sagen.',
        'Welche dieser Reservierungen möchten Sie ändern? Sagen Sie die Optionsnummer.',
        'Bitte geben Sie an, welche Reservierung Sie ändern möchten. Sagen Sie "erste", "zweite" usw.',
        'Welche Option möchten Sie ändern? Sie können die Optionsnummer sagen.',
        'Bitte wählen Sie, welche Reservierung geändert werden soll. Sagen Sie die entsprechende Nummer.'
      ],
      it: [
        'Per favore, dimmi quale opzione vuoi modificare. Puoi dire "opzione 1", "opzione 2", ecc.',
        'Quale di queste prenotazioni vuoi modificare? Di\' il numero dell\'opzione.',
        'Per favore, indica quale prenotazione vuoi modificare. Di\' "prima", "seconda", ecc.',
        'Quale opzione vuoi modificare? Puoi dire il numero dell\'opzione.',
        'Per favore, scegli quale prenotazione modificare. Di\' il numero corrispondente.'
      ],
      fr: [
        'Veuillez me dire quelle option vous voulez modifier. Vous pouvez dire "option 1", "option 2", etc.',
        'Laquelle de ces réservations voulez-vous modifier? Dites le numéro de l\'option.',
        'Veuillez indiquer quelle réservation vous voulez modifier. Dites "première", "deuxième", etc.',
        'Quelle option voulez-vous modifier? Vous pouvez dire le numéro de l\'option.',
        'Veuillez choisir quelle réservation modifier. Dites le numéro correspondant.'
      ],
      pt: [
        'Por favor, me diga qual opção você quer modificar. Você pode dizer "opção 1", "opção 2", etc.',
        'Qual dessas reservas você quer modificar? Diga o número da opção.',
        'Por favor, indique qual reserva você quer modificar. Diga "primeira", "segunda", etc.',
        'Qual opção você quer modificar? Você pode dizer o número da opção.',
        'Por favor, escolha qual reserva modificar. Diga o número correspondente.'
      ]
    },
    modify_ask_field: {
      es: [
        '¿Qué desea modificar? Puede decir el nombre, la fecha, la hora o el número de personas.',
        '¿Qué campo quiere cambiar? Nombre, fecha, hora o número de personas.',
        'Por favor, indique qué quiere modificar: nombre, fecha, hora o personas.',
        '¿Qué parte de la reserva desea cambiar? Puede elegir nombre, fecha, hora o personas.',
        'Dígame qué quiere modificar: nombre, fecha, hora o número de personas.'
      ],
      en: [
        'What do you want to modify? You can say name, date, time, or number of people.',
        'What field do you want to change? Name, date, time, or number of people.',
        'Please indicate what you want to modify: name, date, time, or people.',
        'What part of the reservation do you want to change? You can choose name, date, time, or people.',
        'Tell me what you want to modify: name, date, time, or number of people.'
      ],
      de: [
        'Was möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Anzahl der Personen sagen.',
        'Welches Feld möchten Sie ändern? Name, Datum, Uhrzeit oder Anzahl der Personen.',
        'Bitte geben Sie an, was Sie ändern möchten: Name, Datum, Uhrzeit oder Personen.',
        'Welchen Teil der Reservierung möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Personen wählen.',
        'Sagen Sie mir, was Sie ändern möchten: Name, Datum, Uhrzeit oder Anzahl der Personen.'
      ],
      it: [
        'Cosa vuole modificare? Può dire nome, data, ora o numero di persone.',
        'Quale campo vuole cambiare? Nome, data, ora o numero di persone.',
        'Per favore, indichi cosa vuole modificare: nome, data, ora o persone.',
        'Quale parte della prenotazione vuole cambiare? Può scegliere nome, data, ora o persone.',
        'Mi dica cosa vuole modificare: nome, data, ora o numero di persone.'
      ],
      fr: [
        'Que souhaitez-vous modifier? Vous pouvez dire nom, date, heure ou nombre de personnes.',
        'Quel champ voulez-vous changer? Nom, date, heure ou nombre de personnes.',
        'Veuillez indiquer ce que vous voulez modifier: nom, date, heure ou personnes.',
        'Quelle partie de la réservation voulez-vous changer? Vous pouvez choisir nom, date, heure ou personnes.',
        'Dites-moi ce que vous voulez modifier: nom, date, heure ou nombre de personnes.'
      ],
      pt: [
        'O que você quer modificar? Pode dizer nome, data, hora ou número de pessoas.',
        'Qual campo você quer mudar? Nome, data, hora ou número de pessoas.',
        'Por favor, indique o que quer modificar: nome, data, hora ou pessoas.',
        'Qual parte da reserva você quer mudar? Pode escolher nome, data, hora ou pessoas.',
        'Me diga o que quer modificar: nome, data, hora ou número de pessoas.'
      ]
    },
    modify_unclear_field: {
      es: [
        'Disculpe, no entendí qué desea modificar. Por favor, diga nombre, fecha, hora o número de personas.',
        'No entendí bien. ¿Qué campo quiere cambiar? Puede decir nombre, fecha, hora o personas.',
        'Perdón, no capté bien. Por favor, indique qué quiere modificar: nombre, fecha, hora o personas.',
        'No entendí. Por favor, diga claramente qué campo desea cambiar.',
        'Disculpe, no entendí. ¿Quiere modificar el nombre, la fecha, la hora o el número de personas?'
      ],
      en: [
        'Sorry, I didn\'t understand what you want to modify. Please say name, date, time, or number of people.',
        'I didn\'t understand well. What field do you want to change? You can say name, date, time, or people.',
        'Sorry, I didn\'t catch that. Please indicate what you want to modify: name, date, time, or people.',
        'I didn\'t understand. Please say clearly what field you want to change.',
        'Sorry, I didn\'t understand. Do you want to modify the name, date, time, or number of people?'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, was Sie ändern möchten. Bitte sagen Sie Name, Datum, Uhrzeit oder Anzahl der Personen.',
        'Ich verstand nicht gut. Welches Feld möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Personen sagen.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte geben Sie an, was Sie ändern möchten: Name, Datum, Uhrzeit oder Personen.',
        'Ich verstand nicht. Bitte sagen Sie deutlich, welches Feld Sie ändern möchten.',
        'Entschuldigung, ich verstand nicht. Möchten Sie den Namen, das Datum, die Uhrzeit oder die Anzahl der Personen ändern?'
      ],
      it: [
        'Scusi, non ho capito cosa vuole modificare. Per favore, dica nome, data, ora o numero di persone.',
        'Non ho capito bene. Quale campo vuole cambiare? Può dire nome, data, ora o persone.',
        'Scusi, non ho capito. Per favore, indichi cosa vuole modificare: nome, data, ora o persone.',
        'Non ho capito. Per favore, dica chiaramente quale campo desidera cambiare.',
        'Scusi, non ho capito. Vuole modificare il nome, la data, l\'ora o il numero di persone?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris ce que vous voulez modifier. Veuillez dire nom, date, heure ou nombre de personnes.',
        'Je n\'ai pas bien compris. Quel champ voulez-vous changer? Vous pouvez dire nom, date, heure ou personnes.',
        'Désolé, je n\'ai pas saisi. Veuillez indiquer ce que vous voulez modifier: nom, date, heure ou personnes.',
        'Je n\'ai pas compris. Veuillez dire clairement quel champ vous voulez changer.',
        'Désolé, je n\'ai pas compris. Voulez-vous modifier le nom, la date, l\'heure ou le nombre de personnes?'
      ],
      pt: [
        'Desculpe, não entendi o que você quer modificar. Por favor, diga nome, data, hora ou número de pessoas.',
        'Não entendi bem. Qual campo você quer mudar? Pode dizer nome, data, hora ou pessoas.',
        'Desculpe, não entendi. Por favor, indique o que quer modificar: nome, data, hora ou pessoas.',
        'Não entendi. Por favor, diga claramente qual campo deseja mudar.',
        'Desculpe, não entendi. Quer modificar o nome, a data, a hora ou o número de pessoas?'
      ]
    },
    modify_ask_value: {
      es: [
        'Perfecto. ¿Cuál es el nuevo valor que desea?',
        'Excelente. ¿Qué nuevo valor prefiere?',
        'Muy bien. ¿Cuál será el nuevo valor?',
        'Perfecto. Por favor, indique el nuevo valor.',
        'Excelente. ¿Qué valor quiere establecer?'
      ],
      en: [
        'Perfect. What is the new value you want?',
        'Excellent. What new value do you prefer?',
        'Very well. What will be the new value?',
        'Perfect. Please indicate the new value.',
        'Excellent. What value do you want to set?'
      ],
      de: [
        'Perfekt. Wie lautet der neue Wert, den Sie möchten?',
        'Ausgezeichnet. Welchen neuen Wert bevorzugen Sie?',
        'Sehr gut. Wie lautet der neue Wert?',
        'Perfekt. Bitte geben Sie den neuen Wert an.',
        'Ausgezeichnet. Welchen Wert möchten Sie festlegen?'
      ],
      it: [
        'Perfetto. Qual è il nuovo valore che desidera?',
        'Eccellente. Quale nuovo valore preferisce?',
        'Molto bene. Quale sarà il nuovo valore?',
        'Perfetto. Per favore, indichi il nuovo valore.',
        'Eccellente. Quale valore vuole impostare?'
      ],
      fr: [
        'Parfait. Quelle est la nouvelle valeur que vous voulez?',
        'Excellent. Quelle nouvelle valeur préférez-vous?',
        'Très bien. Quelle sera la nouvelle valeur?',
        'Parfait. Veuillez indiquer la nouvelle valeur.',
        'Excellent. Quelle valeur voulez-vous définir?'
      ],
      pt: [
        'Perfeito. Qual é o novo valor que deseja?',
        'Excelente. Qual novo valor você prefere?',
        'Muito bem. Qual será o novo valor?',
        'Perfeito. Por favor, indique o novo valor.',
        'Excelente. Qual valor você quer definir?'
      ]
    },
    modify_unclear_value: {
      es: [
        'Disculpe, no entendí el nuevo valor. Por favor, repítalo.',
        'No entendí bien. ¿Puede indicar el nuevo valor de nuevo?',
        'Perdón, no capté bien. Por favor, diga el nuevo valor claramente.',
        'No entendí. Por favor, proporcione el nuevo valor.',
        'Disculpe, no entendí. ¿Cuál es el nuevo valor que desea?'
      ],
      en: [
        'Sorry, I didn\'t understand the new value. Please repeat it.',
        'I didn\'t understand well. Can you indicate the new value again?',
        'Sorry, I didn\'t catch that. Please say the new value clearly.',
        'I didn\'t understand. Please provide the new value.',
        'Sorry, I didn\'t understand. What is the new value you want?'
      ],
      de: [
        'Entschuldigung, ich verstand den neuen Wert nicht. Bitte wiederholen Sie ihn.',
        'Ich verstand nicht gut. Können Sie den neuen Wert noch einmal angeben?',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie den neuen Wert deutlich.',
        'Ich verstand nicht. Bitte geben Sie den neuen Wert an.',
        'Entschuldigung, ich verstand nicht. Wie lautet der neue Wert, den Sie möchten?'
      ],
      it: [
        'Scusi, non ho capito il nuovo valore. Per favore, lo ripeta.',
        'Non ho capito bene. Può indicare il nuovo valore di nuovo?',
        'Scusi, non ho capito. Per favore, dica il nuovo valore chiaramente.',
        'Non ho capito. Per favore, fornisca il nuovo valore.',
        'Scusi, non ho capito. Qual è il nuovo valore che desidera?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris la nouvelle valeur. Veuillez la répéter.',
        'Je n\'ai pas bien compris. Pouvez-vous indiquer la nouvelle valeur à nouveau?',
        'Désolé, je n\'ai pas saisi. Veuillez dire la nouvelle valeur clairement.',
        'Je n\'ai pas compris. Veuillez fournir la nouvelle valeur.',
        'Désolé, je n\'ai pas compris. Quelle est la nouvelle valeur que vous voulez?'
      ],
      pt: [
        'Desculpe, não entendi o novo valor. Por favor, repita.',
        'Não entendi bem. Pode indicar o novo valor novamente?',
        'Desculpe, não entendi. Por favor, diga o novo valor claramente.',
        'Não entendi. Por favor, forneça o novo valor.',
        'Desculpe, não entendi. Qual é o novo valor que deseja?'
      ]
    },
    modify_confirm: {
      es: [
        'Perfecto. Voy a cambiar el campo. ¿Está de acuerdo?',
        'Excelente. Cambiaré el campo. ¿Confirma?',
        'Muy bien. Modificaré el campo. ¿Le parece bien?',
        'Perfecto. Actualizaré el campo. ¿Está de acuerdo?',
        'Excelente. Cambiaré el campo. ¿Confirma esta modificación?'
      ],
      en: [
        'Perfect. I will change the field. Do you agree?',
        'Excellent. I will change the field. Do you confirm?',
        'Very well. I will modify the field. Does that seem good?',
        'Perfect. I will update the field. Do you agree?',
        'Excellent. I will change the field. Do you confirm this modification?'
      ],
      de: [
        'Perfekt. Ich werde das Feld ändern. Sind Sie einverstanden?',
        'Ausgezeichnet. Ich werde das Feld ändern. Bestätigen Sie?',
        'Sehr gut. Ich werde das Feld ändern. Scheint Ihnen das gut?',
        'Perfekt. Ich werde das Feld aktualisieren. Sind Sie einverstanden?',
        'Ausgezeichnet. Ich werde das Feld ändern. Bestätigen Sie diese Änderung?'
      ],
      it: [
        'Perfetto. Cambierò il campo. È d\'accordo?',
        'Eccellente. Cambierò il campo. Conferma?',
        'Molto bene. Modificherò il campo. Le va bene?',
        'Perfetto. Aggiornerò il campo. È d\'accordo?',
        'Eccellente. Cambierò il campo. Conferma questa modifica?'
      ],
      fr: [
        'Parfait. Je vais changer le champ. Êtes-vous d\'accord?',
        'Excellent. Je vais changer le champ. Confirmez-vous?',
        'Très bien. Je vais modifier le champ. Cela vous semble-t-il bien?',
        'Parfait. Je vais mettre à jour le champ. Êtes-vous d\'accord?',
        'Excellent. Je vais changer le champ. Confirmez-vous cette modification?'
      ],
      pt: [
        'Perfeito. Vou mudar o campo. Está de acordo?',
        'Excelente. Vou mudar o campo. Confirma?',
        'Muito bem. Vou modificar o campo. Parece bom?',
        'Perfeito. Vou atualizar o campo. Está de acordo?',
        'Excelente. Vou mudar o campo. Confirma esta modificação?'
      ]
    },
    modify_unclear_confirmation: {
      es: [
        'Disculpe, no entendí bien su respuesta. ¿Desea confirmar la modificación o no?',
        'No entendí claramente. Por favor, diga "sí" para confirmar o "no" para cancelar la modificación.',
        'Perdón, no capté bien. ¿Confirma que quiere realizar esta modificación?',
        'No entendí. Por favor, responda claramente: ¿sí o no?',
        'Disculpe, no entendí. ¿Quiere confirmar la modificación?'
      ],
      en: [
        'Sorry, I didn\'t understand your response well. Do you want to confirm the modification or not?',
        'I didn\'t understand clearly. Please say "yes" to confirm or "no" to cancel the modification.',
        'Sorry, I didn\'t catch that. Do you confirm you want to make this modification?',
        'I didn\'t understand. Please answer clearly: yes or no?',
        'Sorry, I didn\'t understand. Do you want to confirm the modification?'
      ],
      de: [
        'Entschuldigung, ich verstand Ihre Antwort nicht gut. Möchten Sie die Änderung bestätigen oder nicht?',
        'Ich verstand nicht klar. Bitte sagen Sie "ja" zum Bestätigen oder "nein" zum Abbrechen der Änderung.',
        'Entschuldigung, ich habe das nicht verstanden. Bestätigen Sie, dass Sie diese Änderung vornehmen möchten?',
        'Ich verstand nicht. Bitte antworten Sie klar: ja oder nein?',
        'Entschuldigung, ich verstand nicht. Möchten Sie die Änderung bestätigen?'
      ],
      it: [
        'Scusi, non ho capito bene la sua risposta. Vuole confermare la modifica o no?',
        'Non ho capito chiaramente. Per favore, dica "sì" per confermare o "no" per annullare la modifica.',
        'Scusi, non ho capito. Conferma di voler fare questa modifica?',
        'Non ho capito. Per favore, risponda chiaramente: sì o no?',
        'Scusi, non ho capito. Vuole confermare la modifica?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre réponse. Voulez-vous confirmer la modification ou non?',
        'Je n\'ai pas compris clairement. Veuillez dire "oui" pour confirmer ou "non" pour annuler la modification.',
        'Désolé, je n\'ai pas saisi. Confirmez-vous que vous voulez faire cette modification?',
        'Je n\'ai pas compris. Veuillez répondre clairement: oui ou non?',
        'Désolé, je n\'ai pas compris. Voulez-vous confirmer la modification?'
      ],
      pt: [
        'Desculpe, não entendi bem sua resposta. Quer confirmar a modificação ou não?',
        'Não entendi claramente. Por favor, diga "sim" para confirmar ou "não" para cancelar a modificação.',
        'Desculpe, não entendi. Confirma que quer fazer esta modificação?',
        'Não entendi. Por favor, responda claramente: sim ou não?',
        'Desculpe, não entendi. Quer confirmar a modificação?'
      ]
    },
    modify_success: {
      es: [
        '¡Perfecto! Su reserva ha sido modificada exitosamente. Le esperamos. ¡Buen día!',
        '¡Excelente! La modificación se ha completado. Les esperamos. ¡Que tengan buen día!',
        '¡Muy bien! Reserva actualizada correctamente. Nos vemos pronto. ¡Hasta pronto!',
        '¡Genial! Modificación realizada con éxito. Les esperamos. ¡Buen día!',
        '¡Perfecto! Todo actualizado. Les esperamos. ¡Que disfruten!'
      ],
      en: [
        'Perfect! Your reservation has been successfully modified. We look forward to seeing you. Good day!',
        'Excellent! The modification has been completed. We look forward to seeing you. Have a good day!',
        'Very well! Reservation updated correctly. See you soon. Goodbye!',
        'Great! Modification completed successfully. We look forward to seeing you. Good day!',
        'Perfect! Everything updated. We look forward to seeing you. Enjoy!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich geändert. Wir freuen uns auf Sie. Guten Tag!',
        'Ausgezeichnet! Die Änderung wurde abgeschlossen. Wir freuen uns auf Sie. Haben Sie einen schönen Tag!',
        'Sehr gut! Reservierung korrekt aktualisiert. Bis bald. Auf Wiedersehen!',
        'Großartig! Änderung erfolgreich durchgeführt. Wir freuen uns auf Sie. Guten Tag!',
        'Perfekt! Alles aktualisiert. Wir freuen uns auf Sie. Viel Spaß!'
      ],
      it: [
        'Perfetto! La sua prenotazione è stata modificata con successo. La aspettiamo. Buona giornata!',
        'Eccellente! La modifica è stata completata. La aspettiamo. Buona giornata!',
        'Molto bene! Prenotazione aggiornata correttamente. A presto. Arrivederci!',
        'Fantastico! Modifica completata con successo. La aspettiamo. Buona giornata!',
        'Perfetto! Tutto aggiornato. La aspettiamo. Buon divertimento!'
      ],
      fr: [
        'Parfait! Votre réservation a été modifiée avec succès. Nous avons hâte de vous voir. Bonne journée!',
        'Excellent! La modification a été complétée. Nous avons hâte de vous voir. Bonne journée!',
        'Très bien! Réservation mise à jour correctement. À bientôt. Au revoir!',
        'Génial! Modification complétée avec succès. Nous avons hâte de vous voir. Bonne journée!',
        'Parfait! Tout mis à jour. Nous avons hâte de vous voir. Profitez bien!'
      ],
      pt: [
        'Perfeito! Sua reserva foi modificada com sucesso. Esperamos você. Bom dia!',
        'Excelente! A modificação foi concluída. Esperamos você. Tenha um bom dia!',
        'Muito bem! Reserva atualizada corretamente. Até logo. Tchau!',
        'Ótimo! Modificação concluída com sucesso. Esperamos você. Bom dia!',
        'Perfeito! Tudo atualizado. Esperamos você. Aproveite!'
      ]
    },
    modify_error: {
      es: [
        'Disculpe, hubo un error al modificar su reserva. Por favor, intente de nuevo más tarde o contacte directamente al restaurante.',
        'Lo siento, no se pudo completar la modificación. Por favor, intente nuevamente o llame al restaurante.',
        'Perdón, ocurrió un problema al actualizar la reserva. Por favor, contacte directamente al restaurante.',
        'Disculpe, hubo un error técnico. Por favor, intente de nuevo o contacte al restaurante.',
        'Lo siento, no se pudo procesar la modificación. Por favor, contacte al restaurante directamente.'
      ],
      en: [
        'Sorry, there was an error modifying your reservation. Please try again later or contact the restaurant directly.',
        'I\'m sorry, the modification could not be completed. Please try again or call the restaurant.',
        'Sorry, a problem occurred while updating the reservation. Please contact the restaurant directly.',
        'Sorry, there was a technical error. Please try again or contact the restaurant.',
        'I\'m sorry, the modification could not be processed. Please contact the restaurant directly.'
      ],
      de: [
        'Entschuldigung, es gab einen Fehler beim Ändern Ihrer Reservierung. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Restaurant direkt.',
        'Es tut mir leid, die Änderung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut oder rufen Sie das Restaurant an.',
        'Entschuldigung, es trat ein Problem beim Aktualisieren der Reservierung auf. Bitte kontaktieren Sie das Restaurant direkt.',
        'Entschuldigung, es gab einen technischen Fehler. Bitte versuchen Sie es erneut oder kontaktieren Sie das Restaurant.',
        'Es tut mir leid, die Änderung konnte nicht verarbeitet werden. Bitte kontaktieren Sie das Restaurant direkt.'
      ],
      it: [
        'Scusi, c\'è stato un errore nella modifica della sua prenotazione. Per favore, riprovi più tardi o contatti direttamente il ristorante.',
        'Mi dispiace, la modifica non è stata completata. Per favore, riprovi o chiami il ristorante.',
        'Scusi, si è verificato un problema nell\'aggiornamento della prenotazione. Per favore, contatti direttamente il ristorante.',
        'Scusi, c\'è stato un errore tecnico. Per favore, riprovi o contatti il ristorante.',
        'Mi dispiace, la modifica non è stata elaborata. Per favore, contatti direttamente il ristorante.'
      ],
      fr: [
        'Désolé, une erreur s\'est produite lors de la modification de votre réservation. Veuillez réessayer plus tard ou contacter directement le restaurant.',
        'Je suis désolé, la modification n\'a pas pu être complétée. Veuillez réessayer ou appeler le restaurant.',
        'Désolé, un problème s\'est produit lors de la mise à jour de la réservation. Veuillez contacter directement le restaurant.',
        'Désolé, une erreur technique s\'est produite. Veuillez réessayer ou contacter le restaurant.',
        'Je suis désolé, la modification n\'a pas pu être traitée. Veuillez contacter directement le restaurant.'
      ],
      pt: [
        'Desculpe, houve um erro ao modificar sua reserva. Por favor, tente novamente mais tarde ou entre em contato diretamente com o restaurante.',
        'Sinto muito, a modificação não pôde ser concluída. Por favor, tente novamente ou ligue para o restaurante.',
        'Desculpe, ocorreu um problema ao atualizar a reserva. Por favor, entre em contato diretamente com o restaurante.',
        'Desculpe, houve um erro técnico. Por favor, tente novamente ou entre em contato com o restaurante.',
        'Sinto muito, a modificação não pôde ser processada. Por favor, entre em contato diretamente com o restaurante.'
      ]
    },
    modify_cancelled: {
      es: [
        'Perfecto, no modificaremos la reserva. ¿En qué más puedo ayudarle?',
        'Entendido, mantendremos la reserva sin cambios. ¿Qué más necesita?',
        'Muy bien, no procederemos con la modificación. ¿En qué puedo ayudarle?',
        'Perfecto, la reserva se mantiene como está. ¿Qué más puedo hacer por usted?',
        'Excelente, no modificaremos. ¿En qué puedo asistirle?'
      ],
      en: [
        'Perfect, we won\'t modify the reservation. How else can I help you?',
        'Understood, we\'ll keep the reservation unchanged. What else do you need?',
        'Very well, we won\'t proceed with the modification. How can I help you?',
        'Perfect, the reservation remains as is. What else can I do for you?',
        'Excellent, we won\'t modify. How can I assist you?'
      ],
      de: [
        'Perfekt, wir werden die Reservierung nicht ändern. Wie kann ich Ihnen sonst helfen?',
        'Verstanden, wir behalten die Reservierung unverändert. Was brauchen Sie sonst?',
        'Sehr gut, wir werden nicht mit der Änderung fortfahren. Wie kann ich Ihnen helfen?',
        'Perfekt, die Reservierung bleibt wie sie ist. Was kann ich sonst für Sie tun?',
        'Ausgezeichnet, wir werden nicht ändern. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Perfetto, non modificheremo la prenotazione. Come altro posso aiutarti?',
        'Capito, manterremo la prenotazione invariata. Cos\'altro ti serve?',
        'Molto bene, non procederemo con la modifica. Come posso aiutarti?',
        'Perfetto, la prenotazione rimane così com\'è. Cos\'altro posso fare per te?',
        'Eccellente, non modificheremo. Come posso assisterti?'
      ],
      fr: [
        'Parfait, nous ne modifierons pas la réservation. Comment puis-je vous aider d\'autre?',
        'Compris, nous garderons la réservation inchangée. De quoi avez-vous besoin d\'autre?',
        'Très bien, nous ne procéderons pas à la modification. Comment puis-je vous aider?',
        'Parfait, la réservation reste telle quelle. Que puis-je faire d\'autre pour vous?',
        'Excellent, nous ne modifierons pas. Comment puis-je vous assister?'
      ],
      pt: [
        'Perfeito, não modificaremos a reserva. Como mais posso ajudá-lo?',
        'Entendido, manteremos a reserva inalterada. O que mais você precisa?',
        'Muito bem, não procederemos com a modificação. Como posso ajudá-lo?',
        'Perfeito, a reserva permanece como está. O que mais posso fazer por você?',
        'Excelente, não modificaremos. Como posso assisti-lo?'
      ]
    },
    modify_no_reservations: {
      es: [
        'No encontré reservas activas con ese número de teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No localicé reservas con ese teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Le gustaría reservar una mesa?',
        'No encontré reservas con ese teléfono. ¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'I didn\'t find any active reservations with that phone number. Would you like to make a new reservation?',
        'There are no reservations registered for that number. Do you want to make a new reservation?',
        'I didn\'t locate reservations with that phone. Do you want to make a new reservation?',
        'There are no active reservations for that number. Would you like to reserve a table?',
        'I didn\'t find reservations with that phone. Do you want to make a new reservation?'
      ],
      de: [
        'Ich habe keine aktiven Reservierungen mit dieser Telefonnummer gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine Reservierungen für diese Nummer. Möchten Sie eine neue Reservierung vornehmen?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine aktiven Reservierungen für diese Nummer. Möchten Sie einen Tisch reservieren?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Non ho trovato prenotazioni attive con quel numero di telefono. Vorresti fare una nuova prenotazione?',
        'Non ci sono prenotazioni registrate per quel numero. Vuoi fare una nuova prenotazione?',
        'Non ho localizzato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?',
        'Non ci sono prenotazioni attive per quel numero. Vorresti prenotare un tavolo?',
        'Non ho trovato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Je n\'ai trouvé aucune réservation active avec ce numéro de téléphone. Souhaitez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations enregistrées pour ce numéro. Voulez-vous faire une nouvelle réservation?',
        'Je n\'ai pas localisé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations actives pour ce numéro. Souhaitez-vous réserver une table?',
        'Je n\'ai pas trouvé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Não encontrei reservas ativas com esse número de telefone. Gostaria de fazer uma nova reserva?',
        'Não há reservas registradas para esse número. Quer fazer uma nova reserva?',
        'Não localizei reservas com esse telefone. Quer fazer uma nova reserva?',
        'Não há reservas ativas para esse número. Gostaria de reservar uma mesa?',
        'Não encontrei reservas com esse telefone. Quer fazer uma nova reserva?'
      ]
    },
    modify_offer_new: {
      es: [
        '¿Le gustaría hacer una nueva reserva en su lugar?',
        '¿Quiere hacer una nueva reserva?',
        '¿Desea reservar una mesa?',
        '¿Le gustaría hacer una reserva?',
        '¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'Would you like to make a new reservation instead?',
        'Do you want to make a new reservation?',
        'Do you want to reserve a table?',
        'Would you like to make a reservation?',
        'Do you want to make a new reservation?'
      ],
      de: [
        'Möchten Sie stattdessen eine neue Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?',
        'Möchten Sie einen Tisch reservieren?',
        'Möchten Sie eine Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Vorresti fare una nuova prenotazione invece?',
        'Vuoi fare una nuova prenotazione?',
        'Vuoi prenotare un tavolo?',
        'Vorresti fare una prenotazione?',
        'Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Souhaitez-vous faire une nouvelle réservation à la place?',
        'Voulez-vous faire une nouvelle réservation?',
        'Voulez-vous réserver une table?',
        'Souhaitez-vous faire une réservation?',
        'Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Gostaria de fazer uma nova reserva em vez disso?',
        'Quer fazer uma nova reserva?',
        'Quer reservar uma mesa?',
        'Gostaria de fazer uma reserva?',
        'Quer fazer uma nova reserva?'
      ]
    },
    modify_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija una de las opciones disponibles.',
        'Esa opción no existe. Por favor, seleccione una opción válida.',
        'Opción incorrecta. Por favor, elija entre las opciones mostradas.',
        'Esa opción no está disponible. Por favor, seleccione una opción válida.',
        'Opción no válida. Por favor, elija una de las opciones correctas.'
      ],
      en: [
        'That option is not valid. Please choose one of the available options.',
        'That option doesn\'t exist. Please select a valid option.',
        'Incorrect option. Please choose from the options shown.',
        'That option is not available. Please select a valid option.',
        'Invalid option. Please choose one of the correct options.'
      ],
      de: [
        'Diese Option ist nicht gültig. Bitte wählen Sie eine der verfügbaren Optionen.',
        'Diese Option existiert nicht. Bitte wählen Sie eine gültige Option.',
        'Falsche Option. Bitte wählen Sie aus den gezeigten Optionen.',
        'Diese Option ist nicht verfügbar. Bitte wählen Sie eine gültige Option.',
        'Ungültige Option. Bitte wählen Sie eine der korrekten Optionen.'
      ],
      it: [
        'Quell\'opzione non è valida. Per favore, scegli una delle opzioni disponibili.',
        'Quell\'opzione non esiste. Per favore, seleziona un\'opzione valida.',
        'Opzione incorretta. Per favore, scegli tra le opzioni mostrate.',
        'Quell\'opzione non è disponibile. Per favore, seleziona un\'opzione valida.',
        'Opzione non valida. Per favore, scegli una delle opzioni corrette.'
      ],
      fr: [
        'Cette option n\'est pas valide. Veuillez choisir une des options disponibles.',
        'Cette option n\'existe pas. Veuillez sélectionner une option valide.',
        'Option incorrecte. Veuillez choisir parmi les options affichées.',
        'Cette option n\'est pas disponible. Veuillez sélectionner une option valide.',
        'Option non valide. Veuillez choisir une des options correctes.'
      ],
      pt: [
        'Essa opção não é válida. Por favor, escolha uma das opções disponíveis.',
        'Essa opção não existe. Por favor, selecione uma opção válida.',
        'Opção incorreta. Por favor, escolha entre as opções mostradas.',
        'Essa opção não está disponível. Por favor, selecione uma opção válida.',
        'Opção inválida. Por favor, escolha uma das opções corretas.'
      ]
    },
    modify_unclear_option: {
      es: [
        'Disculpe, no entendí qué opción desea. Por favor, diga el número de la opción que quiere modificar.',
        'No entendí bien. Por favor, indique el número de la opción que desea modificar.',
        'Perdón, no capté bien. Por favor, diga "opción 1", "opción 2", etc.',
        'No entendí. Por favor, repita el número de la opción que quiere modificar.',
        'Disculpe, no entendí. Por favor, diga claramente el número de la opción.'
      ],
      en: [
        'Sorry, I didn\'t understand which option you want. Please say the number of the option you want to modify.',
        'I didn\'t understand well. Please indicate the number of the option you want to modify.',
        'Sorry, I didn\'t catch that. Please say "option 1", "option 2", etc.',
        'I didn\'t understand. Please repeat the number of the option you want to modify.',
        'Sorry, I didn\'t understand. Please say the option number clearly.'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, welche Option Sie möchten. Bitte sagen Sie die Nummer der Option, die Sie ändern möchten.',
        'Ich verstand nicht gut. Bitte geben Sie die Nummer der Option an, die Sie ändern möchten.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie "Option 1", "Option 2" usw.',
        'Ich verstand nicht. Bitte wiederholen Sie die Nummer der Option, die Sie ändern möchten.',
        'Entschuldigung, ich verstand nicht. Bitte sagen Sie die Optionsnummer deutlich.'
      ],
      it: [
        'Scusi, non ho capito quale opzione vuole. Per favore, dica il numero dell\'opzione che vuole modificare.',
        'Non ho capito bene. Per favore, indichi il numero dell\'opzione che vuole modificare.',
        'Scusi, non ho capito. Per favore, dica "opzione 1", "opzione 2", ecc.',
        'Non ho capito. Per favore, ripeta il numero dell\'opzione che vuole modificare.',
        'Scusi, non ho capito. Per favore, dica chiaramente il numero dell\'opzione.'
      ],
      fr: [
        'Désolé, je n\'ai pas compris quelle option vous voulez. Veuillez dire le numéro de l\'option que vous voulez modifier.',
        'Je n\'ai pas bien compris. Veuillez indiquer le numéro de l\'option que vous voulez modifier.',
        'Désolé, je n\'ai pas saisi. Veuillez dire "option 1", "option 2", etc.',
        'Je n\'ai pas compris. Veuillez répéter le numéro de l\'option que vous voulez modifier.',
        'Désolé, je n\'ai pas compris. Veuillez dire clairement le numéro de l\'option.'
      ],
      pt: [
        'Desculpe, não entendi qual opção você quer. Por favor, diga o número da opção que quer modificar.',
        'Não entendi bem. Por favor, indique o número da opção que quer modificar.',
        'Desculpe, não entendi. Por favor, diga "opção 1", "opção 2", etc.',
        'Não entendi. Por favor, repita o número da opção que quer modificar.',
        'Desculpe, não entendi. Por favor, diga claramente o número da opção.'
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
      'meu nome', 'como você se chama', 'me chamo',
      // Palabras específicas de portugués que NO existen en español
      'você', 'vocês', 'nós', 'a gente', 'gostaria de', 'queria',
      'modificar uma', 'alterar uma', 'mudar uma', 'editar uma',
      'modificar reserva', 'alterar reserva', 'mudar reserva', 'editar reserva'
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
      // Palabras EXCLUSIVAS de español que NO existen en portugués (prioridad alta)
      'querría', 'querría modificar', 'querría cambiar', 'querría editar',
      'quisiera modificar', 'quisiera cambiar', 'quisiera editar',
      'podría modificar', 'podría cambiar', 'podría editar',
      'me gustaría modificar', 'me gustaría cambiar', 'me gustaría editar',
      'te', 'tú', 'ustedes', 'vosotros', 'vosotras',
      'mi reserva', 'una reserva', 'la reserva', 'las reservas',
      'modificar una reserva', 'cambiar una reserva', 'editar una reserva',
      'modificar mi reserva', 'cambiar mi reserva', 'editar mi reserva',
      'modificar la reserva', 'cambiar la reserva', 'editar la reserva',
      // Patrones específicos de español para evitar confusión con portugués
      'ya debo', 'debo cambiar', 'cambiar la fecha', 'fecha de mi',
      'modificar mi reserva', 'cambiar mi reserva', 'editar mi reserva',
      'actualizar mi reserva', 'quiero modificar', 'necesito cambiar',
      'quiero cambiar', 'necesito modificar', 'quiero editar',
      'necesito editar', 'quiero actualizar', 'necesito actualizar',
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

  // Sistema de pesos: patrones más específicos tienen mayor peso
  const languageScores = {
    es: 0,
    en: 0,
    de: 0,
    it: 0,
    fr: 0,
    pt: 0
  };

  console.log(`🔍 Detectando idioma para: "${text}"`);

  // Palabras de alta prioridad (peso 3) - exclusivas de cada idioma
  const highPriorityPatterns = {
    es: ['querría', 'quisiera', 'podría', 'me gustaría', 'te', 'tú', 'ustedes', 'vosotros', 'vosotras', 'una reserva', 'la reserva', 'mi reserva'],
    pt: ['você', 'vocês', 'nós', 'a gente', 'gostaria de', 'queria', 'uma reserva'],
    en: ['i would like', 'i want to', 'i need to', 'would like to', 'book a table'],
    de: ['ich möchte', 'ich würde', 'ich hätte', 'könnte ich', 'darf ich'],
    it: ['vorrei', 'ho bisogno', 'mi chiamo', 'come ti chiami'],
    fr: ['je voudrais', 'j\'ai besoin', 'je cherche', 'je m\'appelle']
  };

  // Palabras de prioridad media (peso 2)
  const mediumPriorityPatterns = {
    es: ['modificar una reserva', 'cambiar una reserva', 'editar una reserva', 'quiero modificar', 'necesito cambiar'],
    pt: ['modificar uma', 'alterar uma', 'mudar uma', 'quero modificar', 'preciso mudar'],
    en: ['modify reservation', 'change reservation', 'edit reservation'],
    de: ['reservierung ändern', 'reservierung modifizieren'],
    it: ['modificare prenotazione', 'cambiare prenotazione'],
    fr: ['modifier réservation', 'changer réservation']
  };

  // Primero verificar patrones de alta prioridad
  for (const [lang, patterns] of Object.entries(highPriorityPatterns)) {
    for (const pattern of patterns) {
      if (normalizedText.includes(pattern)) {
        languageScores[lang] += 3;
        console.log(`  ⭐ [ALTA PRIORIDAD] ${lang}: "${pattern}" encontrado (+3)`);
      }
    }
  }

  // Luego verificar patrones de prioridad media
  for (const [lang, patterns] of Object.entries(mediumPriorityPatterns)) {
    for (const pattern of patterns) {
      if (normalizedText.includes(pattern)) {
        languageScores[lang] += 2;
        console.log(`  ⚡ [MEDIA PRIORIDAD] ${lang}: "${pattern}" encontrado (+2)`);
      }
    }
  }

  // Finalmente verificar todos los patrones (peso 1)
  for (const [lang, patterns] of Object.entries(languagePatterns)) {
    const matches = patterns.filter(pattern => normalizedText.includes(pattern)).length;
    languageScores[lang] += matches;
    console.log(`  ${lang}: ${matches} coincidencias base (+${matches}), total: ${languageScores[lang]}`);
  }

  // Reglas especiales para evitar falsos positivos entre español y portugués
  if (normalizedText.includes('querría') || normalizedText.includes('quisiera')) {
    languageScores.es += 5; // Bonus muy alto para español
    console.log(`  🔥 [ESPECIAL] Español detectado por "querría/quisiera" (+5)`);
  }
  
  if (normalizedText.includes('você') || normalizedText.includes('gostaria de')) {
    languageScores.pt += 5; // Bonus muy alto para portugués
    console.log(`  🔥 [ESPECIAL] Portugués detectado por "você/gostaria" (+5)`);
  }

  // Detección especial para transcripciones malas de italiano
  if (normalizedText.includes('chau') || normalizedText.includes('borrey') || 
      normalizedText.includes('pre') || normalizedText.includes('notar')) {
    console.log(`🇮🇹 [DEBUG] Detectado patrón de transcripción italiana incorrecta`);
    languageScores.it += 3;
  }

  // Encontrar el idioma con mayor puntuación
  let maxScore = 0;
  let detectedLanguage = 'es'; // Por defecto español

  for (const [lang, score] of Object.entries(languageScores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLanguage = lang;
    }
  }

  // Si hay empate entre español y portugués, priorizar español si tiene palabras exclusivas
  if (languageScores.es === languageScores.pt && languageScores.es > 0) {
    if (normalizedText.includes('querría') || normalizedText.includes('quisiera') || 
        normalizedText.includes('podría') || normalizedText.includes('me gustaría')) {
      detectedLanguage = 'es';
      console.log(`  ⚖️ [DESEMPATE] Español elegido por patrones exclusivos`);
    } else if (normalizedText.includes('você') || normalizedText.includes('gostaria')) {
      detectedLanguage = 'pt';
      console.log(`  ⚖️ [DESEMPATE] Portugués elegido por patrones exclusivos`);
    }
  }

  console.log(`✅ Idioma detectado: ${detectedLanguage} (puntuación: ${languageScores[detectedLanguage]})`);
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

// Función para modificar campos durante la creación de reserva (flujo diferente)
function handleModifyReservationField(state, modification) {
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
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
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
  
  // Verificar modificación de reserva existente (PRIORIDAD ALTA - antes de otras verificaciones)
  console.log(`🔍 [DEBUG] handleIntentionResponse - Texto recibido: "${text}"`);
  const isModify = isModificationRequest(text);
  console.log(`🔍 [DEBUG] handleIntentionResponse - isModificationRequest result: ${isModify}`);
  if (isModify) {
    console.log(`✏️ [DEBUG] ✅ Acción MODIFY detectada para: "${text}"`);
    return { action: 'modify' };
  }
  
  // Verificar cancelación de reserva existente
  if (isCancellationRequest(text)) {
    return { action: 'cancel' };
  }
  
  // Verificar reserva directa
  if (directReservationWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Verificar negación
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { 
      action: 'clarify', 
      message: 'Entiendo. Si cambia de opinión y quiere hacer una reserva o cancelar una existente, solo dígamelo.' 
    };
  }
  
  // Verificar intención general (asumir que es para reserva)
  if (generalIntentionWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Respuesta ambigua
  return { 
    action: 'clarify', 
    message: '¿Le gustaría hacer una nueva reserva o cancelar una existente?' 
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

/**
 * Genera un mensaje de confirmación parcial que muestra lo que se capturó y pregunta por lo que falta
 * Ejemplo: "Perfecto, mesa para 4 el día 7 de noviembre. ¿A qué hora desean la reserva?"
 */
function getPartialConfirmationMessage(data, missingField, language = 'es') {
  const parts = [];
  
  // Formatear según el idioma
  const formatFunctions = {
    es: {
      date: (dateStr) => formatDateSpanish(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'es'),
      people: (num) => `mesa para ${num} ${num === 1 ? 'persona' : 'personas'}`,
      name: (name) => `a nombre de ${name}`
    },
    en: {
      date: (dateStr) => formatDateEnglish(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'en'),
      people: (num) => `table for ${num} ${num === 1 ? 'person' : 'people'}`,
      name: (name) => `under the name of ${name}`
    },
    de: {
      date: (dateStr) => formatDateGerman(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'de'),
      people: (num) => `Tisch für ${num} ${num === 1 ? 'Person' : 'Personen'}`,
      name: (name) => `unter dem Namen ${name}`
    },
    it: {
      date: (dateStr) => formatDateItalian(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'it'),
      people: (num) => `tavolo per ${num} ${num === 1 ? 'persona' : 'persone'}`,
      name: (name) => `a nome di ${name}`
    },
    fr: {
      date: (dateStr) => formatDateFrench(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'fr'),
      people: (num) => `table pour ${num} ${num === 1 ? 'personne' : 'personnes'}`,
      name: (name) => `au nom de ${name}`
    },
    pt: {
      date: (dateStr) => formatDatePortuguese(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'pt'),
      people: (num) => `mesa para ${num} ${num === 1 ? 'pessoa' : 'pessoas'}`,
      name: (name) => `em nome de ${name}`
    }
  };
  
  const formatter = formatFunctions[language] || formatFunctions['es'];
  
  // Construir la parte de confirmación con lo que tenemos
  if (data.NumeroReserva) {
    parts.push(formatter.people(data.NumeroReserva));
  }
  if (data.FechaReserva) {
    const dateStr = formatter.date(data.FechaReserva);
    const datePrefix = {
      es: 'el día',
      en: 'on',
      de: 'am',
      it: 'il',
      fr: 'le',
      pt: 'no dia'
    };
    parts.push(`${datePrefix[language] || datePrefix['es']} ${dateStr}`);
  }
  if (data.HoraReserva) {
    const timeStr = formatter.time(data.HoraReserva);
    const timePrefix = {
      es: 'a las',
      en: 'at',
      de: 'um',
      it: 'alle',
      fr: 'à',
      pt: 'às'
    };
    parts.push(`${timePrefix[language] || timePrefix['es']} ${timeStr}`);
  }
  if (data.NomReserva) {
    parts.push(formatter.name(data.NomReserva));
  }
  
  // Mensajes según el idioma
  const messages = {
    es: {
      prefix: parts.length > 0 ? `Perfecto, ${parts.join(', ')}.` : 'Perfecto.',
      time: '¿A qué hora desean la reserva?',
      date: '¿Para qué día desean la reserva?',
      people: '¿Para cuántas personas desean la reserva?',
      name: '¿A nombre de quién será la reserva?'
    },
    en: {
      prefix: parts.length > 0 ? `Perfect, ${parts.join(', ')}.` : 'Perfect.',
      time: 'What time would you like the reservation?',
      date: 'What day would you like the reservation?',
      people: 'How many people will the reservation be for?',
      name: 'Under whose name will the reservation be?'
    },
    de: {
      prefix: parts.length > 0 ? `Perfekt, ${parts.join(', ')}.` : 'Perfekt.',
      time: 'Zu welcher Uhrzeit möchten Sie die Reservierung?',
      date: 'Für welchen Tag möchten Sie die Reservierung?',
      people: 'Für wie viele Personen ist die Reservierung?',
      name: 'Unter welchem Namen soll die Reservierung sein?'
    },
    it: {
      prefix: parts.length > 0 ? `Perfetto, ${parts.join(', ')}.` : 'Perfetto.',
      time: 'A che ora desiderate la prenotazione?',
      date: 'Per quale giorno desiderate la prenotazione?',
      people: 'Per quante persone è la prenotazione?',
      name: 'A nome di chi sarà la prenotazione?'
    },
    fr: {
      prefix: parts.length > 0 ? `Parfait, ${parts.join(', ')}.` : 'Parfait.',
      time: 'À quelle heure souhaitez-vous la réservation?',
      date: 'Pour quel jour souhaitez-vous la réservation?',
      people: 'Pour combien de personnes est la réservation?',
      name: 'Au nom de qui sera la réservation?'
    },
    pt: {
      prefix: parts.length > 0 ? `Perfeito, ${parts.join(', ')}.` : 'Perfeito.',
      time: 'A que horas desejam a reserva?',
      date: 'Para que dia desejam a reserva?',
      people: 'Para quantas pessoas é a reserva?',
      name: 'Em nome de quem será a reserva?'
    }
  };
  
  const msg = messages[language] || messages['es'];
  const questionMap = {
    'time': msg.time,
    'date': msg.date,
    'people': msg.people,
    'name': msg.name
  };
  
  return `${msg.prefix} ${questionMap[missingField] || ''}`;
}

/**
 * Formatea la hora en formato amigable para el habla
 * Ejemplo: "20:00" -> "8 de la noche" o "las 8 de la noche"
 */
function formatTimeForSpeech(timeStr, language = 'es') {
  if (!timeStr) return '';
  
  // Parsear hora (formato HH:MM)
  const [hours, minutes] = timeStr.split(':').map(Number);
  const hour24 = hours;
  
  const formats = {
    es: () => {
      if (hour24 >= 13 && hour24 < 20) {
        // Tarde: 13:00 - 19:59
        return `las ${hour24 === 13 ? '1' : hour24 - 12}${minutes > 0 ? ` y ${minutes}` : ''} de la tarde`;
      } else if (hour24 >= 20 || hour24 < 6) {
        // Noche: 20:00 - 05:59
        const nightHour = hour24 >= 20 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        return `las ${nightHour}${minutes > 0 ? ` y ${minutes}` : ''} de la noche`;
      } else {
        // Mañana: 06:00 - 12:59
        return `las ${hour24}${minutes > 0 ? ` y ${minutes}` : ''} de la mañana`;
      }
    },
    en: () => {
      const period = hour24 >= 12 ? 'PM' : 'AM';
      const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
      return `${hour12}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''} ${period}`;
    },
    de: () => {
      return `${hour24}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''} Uhr`;
    },
    it: () => {
      return `le ${hour24}${minutes > 0 ? ` e ${minutes}` : ''}`;
    },
    fr: () => {
      return `${hour24}h${minutes > 0 ? minutes.toString().padStart(2, '0') : ''}`;
    },
    pt: () => {
      if (hour24 >= 13 && hour24 < 20) {
        return `às ${hour24 === 13 ? '1' : hour24 - 12}${minutes > 0 ? ` e ${minutes}` : ''} da tarde`;
      } else if (hour24 >= 20 || hour24 < 6) {
        const nightHour = hour24 >= 20 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        return `às ${nightHour}${minutes > 0 ? ` e ${minutes}` : ''} da noite`;
      } else {
        return `às ${hour24}${minutes > 0 ? ` e ${minutes}` : ''} da manhã`;
      }
    }
  };
  
  const formatter = formats[language] || formats['es'];
  return formatter();
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

// ===== FUNCIONES PARA CANCELACIÓN DE RESERVAS =====

// Buscar reservas por número de teléfono
async function findReservationsByPhone(phoneNumber) {
  try {
      console.log(`🔍 [DEBUG] Buscando reservas para el teléfono: "${phoneNumber}" (versión actualizada)`);
      console.log(`🔍 [DEBUG] Tipo de dato del teléfono:`, typeof phoneNumber);
      console.log(`🔍 [DEBUG] Longitud del teléfono:`, phoneNumber ? phoneNumber.length : 'undefined');
    
    const connection = await createConnection();
    
    try {
      // Normalizar el teléfono: extraer solo dígitos para búsqueda flexible
      const normalizedPhone = phoneNumber.replace(/\D/g, ''); // Solo dígitos
      console.log(`🔍 [DEBUG] Teléfono normalizado (solo dígitos): "${normalizedPhone}"`);
      
      // Buscar reservas futuras (no canceladas) por teléfono
      // Buscar tanto con el número completo como solo con los últimos dígitos (sin prefijo)
      // Esto maneja casos donde el teléfono está guardado como "+3463254378" pero se busca como "63254378"
      // Verificación de sincronización: commit 2024-12-19
      const searchPattern1 = `%${normalizedPhone}%`; // Buscar número completo
      const searchPattern2 = normalizedPhone.length >= 8 ? `%${normalizedPhone.slice(-8)}%` : null; // Últimos 8 dígitos
      
      console.log(`🔍 [DEBUG] Patrón de búsqueda 1 (completo): "${searchPattern1}"`);
      if (searchPattern2) {
        console.log(`🔍 [DEBUG] Patrón de búsqueda 2 (últimos 8 dígitos): "${searchPattern2}"`);
      }
      
      // Buscar con ambos patrones usando OR
      let query;
      let params;
      
      if (searchPattern2) {
        query = `
          SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon
          FROM RESERVA 
          WHERE (telefon LIKE ? OR telefon LIKE ?)
          AND data_reserva >= NOW() 
          AND observacions NOT LIKE '%CANCELADA%'
          ORDER BY data_reserva ASC
        `;
        params = [searchPattern1, searchPattern2];
      } else {
        query = `
          SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon
          FROM RESERVA 
          WHERE telefon LIKE ? 
          AND data_reserva >= NOW() 
          AND observacions NOT LIKE '%CANCELADA%'
          ORDER BY data_reserva ASC
        `;
        params = [searchPattern1];
      }
      
      console.log(`🔍 [DEBUG] Ejecutando consulta SQL:`, query);
      console.log(`🔍 [DEBUG] Parámetros:`, params);
      
      const [rows] = await connection.execute(query, params);
      console.log(`📋 [DEBUG] Resultado de la consulta:`, rows);
      console.log(`📋 [DEBUG] Número de filas encontradas: ${rows.length}`);
      
      // Log adicional: buscar TODAS las reservas para este teléfono (sin filtros de fecha)
      let debugQuery;
      let debugParams;
      
      if (searchPattern2) {
        debugQuery = `SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon FROM RESERVA WHERE telefon LIKE ? OR telefon LIKE ?`;
        debugParams = [searchPattern1, searchPattern2];
      } else {
        debugQuery = `SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon FROM RESERVA WHERE telefon LIKE ?`;
        debugParams = [searchPattern1];
      }
      
      const [debugRows] = await connection.execute(debugQuery, debugParams);
      console.log(`🔍 [DEBUG] TODAS las reservas (incluyendo pasadas):`, debugRows);
      
      return rows;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error buscando reservas:', error);
    return [];
  }
}

// Cancelar una reserva específica (BORRAR de la base de datos)
async function cancelReservation(reservationId, phoneNumber) {
  try {
    console.log(`🗑️ Borrando reserva ID: ${reservationId} para teléfono: ${phoneNumber}`);
    
    const connection = await createConnection();
    
    try {
      await connection.beginTransaction();
      
      // BORRAR la reserva directamente de la base de datos
      const deleteQuery = `
        DELETE FROM RESERVA 
        WHERE id_reserva = ? AND telefon = ?
      `;
      
      const [result] = await connection.execute(deleteQuery, [reservationId, phoneNumber]);
      
      if (result.affectedRows === 0) {
        throw new Error('No se encontró la reserva para cancelar');
      }
      
      await connection.commit();
      console.log(`✅ Reserva ${reservationId} borrada exitosamente`);
      return true;
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error cancelando reserva:', error);
    return false;
  }
}

// Formatear reserva para mostrar al usuario
function formatReservationForDisplay(reservation, index, language = 'es', reservations = []) {
  const date = new Date(reservation.data_reserva);
  // Convertir a string ISO para formatDateSpanish
  const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD
  const formattedDate = formatDateSpanish(dateString);
  const formattedTime = date.toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  // Verificar si hay múltiples reservas con el mismo nombre
  const sameNameReservations = reservations.filter(r => r.nom_persona_reserva === reservation.nom_persona_reserva);
  const hasMultipleSameName = sameNameReservations.length > 1;
  
  // Si hay múltiples reservas con el mismo nombre, incluir fecha y hora
  const nameDisplay = hasMultipleSameName 
    ? `${reservation.nom_persona_reserva} para ${formattedDate} a las ${formattedTime}`
    : reservation.nom_persona_reserva;
  
  const messages = {
    es: {
      option: `Opción ${index + 1}: Reserva a nombre de ${nameDisplay} para ${reservation.num_persones} persona${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Tiene una reserva a nombre de ${nameDisplay} para ${reservation.num_persones} persona${reservation.num_persones > 1 ? 's' : ''}`
    },
    en: {
      option: `Option ${index + 1}: Reservation under ${nameDisplay} for ${reservation.num_persones} person${reservation.num_persones > 1 ? 's' : ''}`,
      single: `You have a reservation under ${nameDisplay} for ${reservation.num_persones} person${reservation.num_persones > 1 ? 's' : ''}`
    },
    de: {
      option: `Option ${index + 1}: Reservierung unter ${nameDisplay} für ${reservation.num_persones} Person${reservation.num_persones > 1 ? 'en' : ''}`,
      single: `Sie haben eine Reservierung unter ${nameDisplay} für ${reservation.num_persones} Person${reservation.num_persones > 1 ? 'en' : ''}`
    },
    fr: {
      option: `Option ${index + 1}: Réservation au nom de ${nameDisplay} pour ${reservation.num_persones} personne${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Vous avez une réservation au nom de ${nameDisplay} pour ${reservation.num_persones} personne${reservation.num_persones > 1 ? 's' : ''}`
    },
    it: {
      option: `Opzione ${index + 1}: Prenotazione a nome di ${nameDisplay} per ${reservation.num_persones} persona${reservation.num_persones > 1 ? 'e' : ''}`,
      single: `Hai una prenotazione a nome di ${nameDisplay} per ${reservation.num_persones} persona${reservation.num_persones > 1 ? 'e' : ''}`
    },
    pt: {
      option: `Opção ${index + 1}: Reserva em nome de ${nameDisplay} para ${reservation.num_persones} pessoa${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Você tem uma reserva em nome de ${nameDisplay} para ${reservation.num_persones} pessoa${reservation.num_persones > 1 ? 's' : ''}`
    }
  };
  
  return messages[language] || messages.es;
}

// Detectar si el usuario quiere modificar una reserva existente
function isModificationRequest(text) {
  console.log(`🔍 [DEBUG] isModificationRequest - Analizando: "${text}"`);
  const modificationPatterns = [
    // Español - Patrones mejorados y más específicos
    /modificar.*reserva|editar.*reserva|cambiar.*reserva|actualizar.*reserva/i,
    /reserva.*modificar|reserva.*editar|reserva.*cambiar|reserva.*actualizar/i,
    /quiero.*modificar.*reserva|quiero.*editar.*reserva|quiero.*cambiar.*reserva/i,
    /quiero.*modificar|quiero.*editar|quiero.*cambiar/i,
    /necesito.*modificar.*reserva|necesito.*editar.*reserva|necesito.*cambiar.*reserva/i,
    /necesito.*modificar|necesito.*editar|necesito.*cambiar/i,
    /puedo.*modificar.*reserva|puedo.*editar.*reserva|puedo.*cambiar.*reserva/i,
    /puedo.*modificar|puedo.*editar|puedo.*cambiar/i,
    // Patrones con "una reserva"
    /modificar.*una.*reserva|editar.*una.*reserva|cambiar.*una.*reserva/i,
    
    // Inglés
    /modify|edit|change|update.*reservation/i,
    /reservation.*modify|reservation.*edit|reservation.*change/i,
    /want.*to.*modify|want.*to.*edit|want.*to.*change/i,
    /need.*to.*modify|need.*to.*edit|need.*to.*change/i,
    /can.*modify|can.*edit|can.*change/i,
    
    // Alemán
    /modifizieren|bearbeiten|ändern|aktualisieren.*reservierung/i,
    /reservierung.*modifizieren|reservierung.*bearbeiten|reservierung.*ändern/i,
    /möchte.*modifizieren|möchte.*bearbeiten|möchte.*ändern/i,
    
    // Francés
    /modifier|éditer|changer|mettre.*à.*jour.*réservation/i,
    /réservation.*modifier|réservation.*éditer|réservation.*changer/i,
    /vouloir.*modifier|vouloir.*éditer|vouloir.*changer/i,
    
    // Italiano
    /modificare|editare|cambiare|aggiornare.*prenotazione/i,
    /prenotazione.*modificare|prenotazione.*editare|prenotazione.*cambiare/i,
    /volere.*modificare|volere.*editare|volere.*cambiare/i,
    
    // Português
    /modificar|editar|alterar|atualizar.*reserva/i,
    /reserva.*modificar|reserva.*editar|reserva.*alterar/i,
    /querer.*modificar|querer.*editar|querer.*alterar/i
  ];
  
  const result = modificationPatterns.some(pattern => {
    const match = pattern.test(text);
    if (match) {
      console.log(`✅ [DEBUG] isModificationRequest - Patrón coincidió: ${pattern}`);
    }
    return match;
  });
  console.log(`🔍 [DEBUG] isModificationRequest result para "${text}": ${result}`);
  return result;
}

// Extraer número de opción del texto (mejorado)
function extractOptionFromText(text) {
  console.log(`🔢 [DEBUG] Extrayendo opción del texto: "${text}"`);
  
  const lowerText = text.toLowerCase().trim();
  
  // Patrones para detectar selección de opciones
  const optionPatterns = [
    // Números directos: "1", "2", "3"
    /^(\d+)$/,
    
    // Con artículo: "la 1", "la 2", "el 1", "el 2"
    /^(?:la|el|lo)\s*(\d+)$/,
    
    // Con "opción": "opción 1", "opción número 1", "opción uno"
    /^opci[oó]n\s*(?:n[úu]mero\s*)?(\d+)$/,
    /^opci[oó]n\s*(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Con "primera", "segunda", etc.
    /^(primera?|segunda?|tercera?|cuarta?|quinta?|sexta?|séptima?|octava?|novena?|décima?)$/,
    
    // Con "número": "número 1", "número uno"
    /^n[úu]mero\s*(\d+)$/,
    /^n[úu]mero\s*(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Patrones más específicos para selección
    /^(?:quiero\s+)?(?:cancelar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:quiero\s+)?(?:borrar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:selecciono\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:escojo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:elijo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    
    // Patrones con palabras
    /^(?:quiero\s+)?(?:cancelar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:quiero\s+)?(?:borrar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:selecciono\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:escojo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:elijo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Inglés
    /^(?:the\s*)?(\d+)$/,
    /^(?:the\s*)?(?:option\s*)?(\d+)$/,
    /^(?:the\s*)?(?:option\s*)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/,
    
    // Patrones específicos en inglés
    /^(?:i\s+want\s+to\s+)?(?:cancel\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+want\s+to\s+)?(?:delete\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+select\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+choose\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+pick\s+)?(?:option\s+)?(\d+)$/,
    
    /^(?:i\s+want\s+to\s+)?(?:cancel\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+want\s+to\s+)?(?:delete\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+select\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+choose\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+pick\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    
    // Alemán
    /^(?:die\s*)?(\d+)$/,
    /^(?:die\s*)?(?:option\s*)?(\d+)$/,
    /^(?:die\s*)?(?:option\s*)?(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)$/,
    /^(erste?|zweite?|dritte?|vierte?|fünfte?|sechste?|siebte?|achte?|neunte?|zehnte?)$/,
    
    // Francés
    /^(?:la\s*)?(\d+)$/,
    /^(?:la\s*)?(?:option\s*)?(\d+)$/,
    /^(?:la\s*)?(?:option\s*)?(un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)$/,
    /^(première?|deuxième?|troisième?|quatrième?|cinquième?|sixième?|septième?|huitième?|neuvième?|dixième?)$/,
    
    // Italiano
    /^(?:la\s*)?(\d+)$/,
    /^(?:la\s*)?(?:opzione\s*)?(\d+)$/,
    /^(?:la\s*)?(?:opzione\s*)?(uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)$/,
    /^(prima?|seconda?|terza?|quarta?|quinta?|sesta?|settima?|ottava?|nona?|decima?)$/,
    
    // Português
    /^(?:a\s*)?(\d+)$/,
    /^(?:a\s*)?(?:opção\s*)?(\d+)$/,
    /^(?:a\s*)?(?:opção\s*)?(um|dois|três|quatro|cinco|seis|sete|oito|nove|dez)$/,
    /^(primeira?|segunda?|terceira?|quarta?|quinta?|sexta?|sétima?|oitava?|nona?|décima?)$/
  ];
  
  // Diccionarios para convertir palabras a números
  const wordToNumber = {
    // Español
    'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'primera': 1, 'primero': 1, 'segunda': 2, 'segundo': 2,
    'tercera': 3, 'tercero': 3, 'cuarta': 4, 'cuarto': 4,
    'quinta': 5, 'quinto': 5, 'sexta': 6, 'sexto': 6,
    'séptima': 7, 'séptimo': 7, 'octava': 8, 'octavo': 8,
    'novena': 9, 'noveno': 9, 'décima': 10, 'décimo': 10,
    
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
    
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'erste': 1, 'erster': 1, 'zweite': 2, 'zweiter': 2,
    'dritte': 3, 'dritter': 3, 'vierte': 4, 'vierter': 4,
    'fünfte': 5, 'fünfter': 5, 'sechste': 6, 'sechster': 6,
    'siebte': 7, 'siebter': 7, 'achte': 8, 'achter': 8,
    'neunte': 9, 'neunter': 9, 'zehnte': 10, 'zehnter': 10,
    
    // Francés
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    'première': 1, 'premier': 1, 'deuxième': 2, 'troisième': 3,
    'quatrième': 4, 'cinquième': 5, 'sixième': 6, 'septième': 7,
    'huitième': 8, 'neuvième': 9, 'dixième': 10,
    
    // Italiano
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'prima': 1, 'primo': 1, 'seconda': 2, 'secondo': 2,
    'terza': 3, 'terzo': 3, 'quarta': 4, 'quarto': 4,
    'quinta': 5, 'quinto': 5, 'sesta': 6, 'sesto': 6,
    'settima': 7, 'settimo': 7, 'ottava': 8, 'ottavo': 8,
    'nona': 9, 'nono': 9, 'decima': 10, 'decimo': 10,
    
    // Português
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
    'primeira': 1, 'primeiro': 1, 'segunda': 2, 'segundo': 2,
    'terceira': 3, 'terceiro': 3, 'quarta': 4, 'quarto': 4,
    'quinta': 5, 'quinto': 5, 'sexta': 6, 'sexto': 6,
    'sétima': 7, 'sétimo': 7, 'oitava': 8, 'oitavo': 8,
    'nona': 9, 'nono': 9, 'décima': 10, 'décimo': 10
  };
  
  // Probar cada patrón
  for (const pattern of optionPatterns) {
    const match = lowerText.match(pattern);
    if (match) {
      let optionNumber;
      
      if (match[1]) {
        // Patrón con grupo de captura (número o palabra)
        const captured = match[1];
        optionNumber = wordToNumber[captured] || parseInt(captured);
      } else {
        // Patrón sin grupo de captura (palabras ordinales)
        const captured = match[0];
        optionNumber = wordToNumber[captured];
      }
      
      if (optionNumber && optionNumber > 0) {
        console.log(`🔢 [DEBUG] Opción detectada: "${text}" -> ${optionNumber}`);
        return optionNumber;
      }
    }
  }
  
  console.log(`🔢 [DEBUG] No se pudo detectar opción en: "${text}"`);
  return null;
}

// Extraer número de teléfono del texto
function extractPhoneFromText(text) {
  console.log(`📞 [DEBUG] Extrayendo teléfono del texto: "${text}"`);
  
  // Primero, intentar extraer cualquier secuencia de dígitos (mínimo 7 dígitos para ser un teléfono válido)
  // Esto captura números simples como "63254378", "632543787", etc.
  const allDigits = text.replace(/\D/g, ''); // Extraer solo dígitos
  console.log(`📞 [DEBUG] Dígitos extraídos del texto: "${allDigits}"`);
  
  // Si hay 7 o más dígitos consecutivos, usarlos como teléfono
  if (allDigits.length >= 7 && allDigits.length <= 15) {
    let phoneNumber = allDigits;
    
    // Si empieza por 34 y no tiene +, agregarlo (números españoles)
    if (phoneNumber.startsWith('34') && phoneNumber.length >= 9) {
      phoneNumber = '+' + phoneNumber;
      console.log(`📞 [DEBUG] Agregando prefijo +34: "${phoneNumber}"`);
    } else if (phoneNumber.length === 9 && !phoneNumber.startsWith('+')) {
      // Número español de 9 dígitos sin prefijo, agregar +34
      phoneNumber = '+34' + phoneNumber;
      console.log(`📞 [DEBUG] Agregando prefijo +34 a número de 9 dígitos: "${phoneNumber}"`);
    }
    
    console.log(`📞 [DEBUG] Teléfono final extraído (método dígitos): "${phoneNumber}"`);
    return phoneNumber;
  }
  
  // Patrones específicos para formatos con espacios o guiones (fallback)
  const phonePatterns = [
    /(\+?[0-9]{9,15})/g,  // Números con 9-15 dígitos
    /(\d{3}[\s\-]?\d{3}[\s\-]?\d{3})/g,  // Formato español: 123 456 789
    /(\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato español: 12 345 67 89
    /(\d{3}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato: 611 67 01 89
    /(\d{3}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato: 611 67 01 89 12
  ];
  
  const matches = [];
  phonePatterns.forEach((pattern, index) => {
    const found = text.match(pattern);
    console.log(`📞 [DEBUG] Patrón ${index + 1} (${pattern}):`, found);
    if (found) {
      // Limpiar el número pero mantener el + si existe
      const cleanedMatches = found.map(match => {
        const cleaned = match.replace(/[\s\-]/g, '');
        console.log(`📞 [DEBUG] Match original: "${match}" -> Limpiado: "${cleaned}"`);
        // Si no tiene + y empieza por 34, agregarlo
        if (!cleaned.startsWith('+') && cleaned.startsWith('34') && cleaned.length >= 9) {
          const withPlus = '+' + cleaned;
          console.log(`📞 [DEBUG] Agregando +34: "${cleaned}" -> "${withPlus}"`);
          return withPlus;
        }
        return cleaned;
      });
      matches.push(...cleanedMatches);
    }
  });
  
  console.log(`📞 [DEBUG] Todos los matches encontrados:`, matches);
  const result = matches.length > 0 ? matches[0] : null;
  console.log(`📞 [DEBUG] Teléfono final extraído: "${result}"`);
  
  // Devolver el primer número encontrado
  return result;
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
