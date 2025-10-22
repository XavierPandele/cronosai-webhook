// Cargar variables de entorno
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Inicializar Gemini 2.0 Flash con configuración optimizada
let genAI, model;
if (process.env.GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3, // Menos creatividad, más precisión
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 1024,
    }
  });
  console.log('✅ Gemini 2.0 Flash Enhanced inicializado');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado, usando sistema hardcodeado');
}

// Estados de conversación
const conversationStates = new Map();

// Sistema de comprensión mejorado con Gemini 2.0
class EnhancedComprehensionSystem {
  
  // Analizar intención del cliente con contexto completo
  static async analyzeIntent(userInput, conversationHistory, currentStep, language) {
    if (!model) return this.getFallbackIntent(userInput, currentStep);
    
    try {
      const context = this.buildConversationContext(conversationHistory, currentStep);
      
      const prompt = `Eres un experto en análisis de intenciones para un sistema de reservas de restaurante.

CONTEXTO DE LA CONVERSACIÓN:
${context}

PASO ACTUAL: ${currentStep}
IDIOMA: ${language}
ÚLTIMO MENSAJE DEL CLIENTE: "${userInput}"

Analiza la intención del cliente y responde en formato JSON:

{
  "intent": "reservation|clarification|correction|confirmation|greeting|goodbye|complaint|question",
  "confidence": 0.0-1.0,
  "extracted_data": {
    "people": number|null,
    "date": "YYYY-MM-DD"|null,
    "time": "HH:MM"|null,
    "name": string|null,
    "phone": string|null
  },
  "sentiment": "positive|neutral|negative|frustrated|confused",
  "urgency": "low|normal|high",
  "next_step": "ask_people|ask_date|ask_time|ask_name|ask_phone|complete|clarify",
  "response_type": "question|confirmation|clarification|error",
  "needs_clarification": boolean,
  "clarification_question": string|null
}

IMPORTANTE:
- Si el cliente está confundido o necesita aclaración, marca "needs_clarification": true
- Si hay datos ambiguos, pide clarificación específica
- Considera el contexto completo de la conversación
- Prioriza la comprensión sobre la velocidad

Análisis:`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      let responseText = response.text().trim();
      
      // Limpiar markdown si está presente
      if (responseText.includes('```json')) {
        responseText = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '');
      }
      
      const analysis = JSON.parse(responseText);
      
      console.log(`[GEMINI-ENHANCED] Análisis de intención:`, analysis);
      return analysis;
      
    } catch (error) {
      console.error('[GEMINI-ENHANCED] Error analizando intención:', error);
      
      // Si es error de sobrecarga, usar fallback inmediatamente
      if (error.status === 503 || error.message?.includes('overloaded')) {
        console.log('[GEMINI-ENHANCED] Modelo sobrecargado, usando fallback');
        return this.getFallbackIntent(userInput, currentStep);
      }
      
      // Si es error de JSON, intentar limpiar y parsear
      if (error.message?.includes('JSON')) {
        console.log('[GEMINI-ENHANCED] Error de JSON, intentando limpiar respuesta');
        try {
          let responseText = error.response?.text()?.trim() || '';
          if (responseText.includes('```json')) {
            responseText = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '');
          }
          const analysis = JSON.parse(responseText);
          return analysis;
        } catch (jsonError) {
          console.log('[GEMINI-ENHANCED] No se pudo limpiar JSON, usando fallback');
        }
      }
      
      return this.getFallbackIntent(userInput, currentStep);
    }
  }
  
  // Construir contexto de conversación
  static buildConversationContext(conversationHistory, currentStep) {
    let context = `FLUJO DE RESERVA ACTUAL:
1. greeting -> ask_people (¿Cuántas personas?)
2. ask_people -> ask_date (¿Qué fecha?)
3. ask_date -> ask_time (¿Qué hora?)
4. ask_time -> ask_name (¿Cuál es su nombre?)
5. ask_name -> ask_phone (¿Confirmar teléfono?)
6. ask_phone -> complete (Reserva confirmada)

PASO ACTUAL: ${currentStep}

HISTORIAL DE CONVERSACIÓN:`;
    
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.slice(-6).forEach((entry, index) => {
        const role = entry.role === 'user' ? 'CLIENTE' : 'BOT';
        context += `\n${index + 1}. ${role}: "${entry.message}"`;
      });
    } else {
      context += '\n(Conversación nueva)';
    }
    
    return context;
  }
  
  // Generar respuesta inteligente con Gemini 2.0
  static async generateIntelligentResponse(intentAnalysis, language, conversationHistory) {
    if (!model) return this.getFallbackResponse(intentAnalysis.next_step, language);
    
    try {
      const context = this.buildConversationContext(conversationHistory, intentAnalysis.next_step);
      
      const prompt = `Eres un asistente de restaurante profesional y amigable. Genera una respuesta natural basada en el análisis de intención.

CONTEXTO:
${context}

ANÁLISIS DE INTENCIÓN:
- Intención: ${intentAnalysis.intent}
- Confianza: ${intentAnalysis.confidence}
- Sentimiento: ${intentAnalysis.sentiment}
- Urgencia: ${intentAnalysis.urgency}
- Necesita aclaración: ${intentAnalysis.needs_clarification}
- Datos extraídos: ${JSON.stringify(intentAnalysis.extracted_data)}

INSTRUCCIONES:
1. Si necesita aclaración, haz una pregunta específica y clara
2. Si hay datos extraídos, confírmalos de manera natural
3. Adapta el tono al sentimiento del cliente
4. Si está frustrado, sé empático y paciente
5. Si está confundido, explica de manera simple
6. Mantén un tono profesional pero amigable
7. Responde en ${language}

Genera UNA respuesta natural, directa y útil. No uses frases robóticas.

Respuesta:`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const intelligentResponse = response.text().trim();
      
      console.log(`[GEMINI-ENHANCED] Respuesta inteligente: "${intelligentResponse}"`);
      return intelligentResponse;
      
    } catch (error) {
      console.error('[GEMINI-ENHANCED] Error generando respuesta:', error);
      return this.getFallbackResponse(intentAnalysis.next_step, language);
    }
  }
  
  // Detectar idioma con contexto
  static async detectLanguageWithContext(userInput, conversationHistory) {
    if (!model) return 'es';
    
    try {
      const context = conversationHistory && conversationHistory.length > 0 
        ? conversationHistory.slice(-3).map(entry => entry.message).join(' ')
        : '';
      
      const prompt = `Analiza el idioma del siguiente texto considerando el contexto de conversación.

CONTEXTO: "${context}"
TEXTO ACTUAL: "${userInput}"

Responde SOLO con el código del idioma: es, en, de, it, fr, pt

Idioma:`;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const detectedLang = response.text().trim().toLowerCase();
      
      const supportedLangs = ['es', 'en', 'de', 'it', 'fr', 'pt'];
      if (supportedLangs.includes(detectedLang)) {
        console.log(`[GEMINI-ENHANCED] Idioma detectado: ${detectedLang}`);
        return detectedLang;
      }
      
      return 'es';
    } catch (error) {
      console.error('[GEMINI-ENHANCED] Error detectando idioma:', error);
      return 'es';
    }
  }
  
  // Fallback para intención - MEJORADO
  static getFallbackIntent(userInput, currentStep) {
    const lowerInput = userInput.toLowerCase();
    
    // Detectar intenciones básicas
    if (lowerInput.includes('hola') || lowerInput.includes('hello') || lowerInput.includes('hi')) {
      return {
        intent: 'greeting',
        confidence: 0.8,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'normal',
        next_step: 'ask_people',
        response_type: 'question',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    if (lowerInput.includes('gracias') || lowerInput.includes('thanks') || lowerInput.includes('bye')) {
      return {
        intent: 'goodbye',
        confidence: 0.8,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'low',
        next_step: 'complete',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar frustración
    if (lowerInput.includes('frustrado') || lowerInput.includes('complicado') || lowerInput.includes('difícil')) {
      return {
        intent: 'complaint',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'frustrated',
        urgency: 'high',
        next_step: currentStep,
        response_type: 'clarification',
        needs_clarification: true,
        clarification_question: 'Entiendo su frustración. Le ayudo paso a paso. ¿Para cuántas personas será la reserva?'
      };
    }
    
    // Detectar confusión
    if (lowerInput.includes('no entiendo') || lowerInput.includes('confundido') || lowerInput.includes('qué necesito')) {
      return {
        intent: 'clarification',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'confused',
        urgency: 'normal',
        next_step: currentStep,
        response_type: 'question',
        needs_clarification: true,
        clarification_question: 'No se preocupe, le ayudo paso a paso. ¿Para cuántas personas será la reserva?'
      };
    }
    
    // Extraer números básicos
    const numbers = userInput.match(/\b(\d+)\b/g);
    if (numbers && numbers.length > 0) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 20) {
        return {
          intent: 'reservation',
          confidence: 0.7,
          extracted_data: { people: num },
          sentiment: 'neutral',
          urgency: 'normal',
          next_step: 'ask_date',
          response_type: 'confirmation',
          needs_clarification: false,
          clarification_question: null
        };
      }
    }
    
    // Detectar fechas básicas
    if (lowerInput.includes('mañana') || lowerInput.includes('tomorrow') || lowerInput.includes('hoy') || lowerInput.includes('today')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        intent: 'reservation',
        confidence: 0.6,
        extracted_data: { date: tomorrow.toISOString().split('T')[0] },
        sentiment: 'neutral',
        urgency: 'normal',
        next_step: 'ask_time',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar horas básicas
    const timeMatch = userInput.match(/(\d{1,2}):?(\d{2})?\s*(am|pm|de la tarde|de la noche)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const period = timeMatch[3];
      
      if (period && period.toLowerCase().includes('pm') && hour < 12) {
        hour += 12;
      }
      
      const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      return {
        intent: 'reservation',
        confidence: 0.6,
        extracted_data: { time: time },
        sentiment: 'neutral',
        urgency: 'normal',
        next_step: 'ask_name',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    return {
      intent: 'clarification',
      confidence: 0.5,
      extracted_data: {},
      sentiment: 'neutral',
      urgency: 'normal',
      next_step: currentStep,
      response_type: 'question',
      needs_clarification: true,
      clarification_question: '¿Podría repetir eso, por favor?'
    };
  }
  
  // Fallback para respuesta
  static getFallbackResponse(step, language) {
    const responses = {
      greeting: {
        es: '¡Hola! Bienvenido al restaurante. ¿Para cuántas personas será la reserva?',
        en: 'Hello! Welcome to the restaurant. How many people will the reservation be for?',
        de: 'Hallo! Willkommen im Restaurant. Für wie viele Personen soll die Reservierung sein?',
        it: 'Ciao! Benvenuto al ristorante. Per quante persone sarà la prenotazione?',
        fr: 'Bonjour! Bienvenue au restaurant. Pour combien de personnes sera la réservation?',
        pt: 'Olá! Bem-vindo ao restaurante. Para quantas pessoas será a reserva?'
      },
      ask_people: {
        es: '¿Para cuántas personas será la reserva?',
        en: 'How many people will the reservation be for?',
        de: 'Für wie viele Personen soll die Reservierung sein?',
        it: 'Per quante persone sarà la prenotazione?',
        fr: 'Pour combien de personnes sera la réservation?',
        pt: 'Para quantas pessoas será a reserva?'
      },
      ask_date: {
        es: '¿Para qué fecha necesita la reserva?',
        en: 'What date do you need the reservation for?',
        de: 'Für welches Datum benötigen Sie die Reservierung?',
        it: 'Per quale data avete bisogno della prenotazione?',
        fr: 'Pour quelle date avez-vous besoin de la réservation?',
        pt: 'Para que data vocês precisam da reserva?'
      },
      ask_time: {
        es: '¿A qué hora prefieren venir?',
        en: 'What time would you prefer to come?',
        de: 'Um welche Uhrzeit möchten Sie kommen?',
        it: 'A che ora preferite venire?',
        fr: 'À quelle heure préférez-vous venir?',
        pt: 'Que horas preferem vir?'
      },
      ask_name: {
        es: '¿Cómo se llama?',
        en: 'What\'s your name?',
        de: 'Wie heißen Sie?',
        it: 'Come si chiama?',
        fr: 'Comment vous appelez-vous?',
        pt: 'Como se chama?'
      },
      ask_phone: {
        es: '¿Podría confirmar su número de teléfono?',
        en: 'Could you confirm your phone number?',
        de: 'Könnten Sie Ihre Telefonnummer bestätigen?',
        it: 'Potrebbe confermare il suo numero di telefono?',
        fr: 'Pourriez-vous confirmer votre numéro de téléphone?',
        pt: 'Poderia confirmar o seu número de telefone?'
      },
      complete: {
        es: '¡Perfecto! Su reserva está confirmada. ¡Que disfruten!',
        en: 'Perfect! Your reservation is confirmed. Enjoy!',
        de: 'Perfekt! Ihre Reservierung ist bestätigt. Viel Spaß!',
        it: 'Perfetto! La sua prenotazione è confermata. Buon appetito!',
        fr: 'Parfait! Votre réservation est confirmée. Bon appétit!',
        pt: 'Perfeito! Sua reserva está confirmada. Bom apetite!'
      }
    };
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿En qué puedo ayudarle?';
  }
}

// Guardar reserva mejorado
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
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
        'Reserva por teléfono - Sistema Enhanced',
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

// Generar TwiML con configuración de idioma correcta
function generateTwiML(message, language = 'es') {
  console.log(`[TwiML] Generando para idioma: ${language}`);
  
  const voiceConfig = {
    es: { voice: 'Polly.Lupe', language: 'es-ES' },
    en: { voice: 'Polly.Joanna', language: 'en-US' },
    de: { voice: 'Polly.Marlene', language: 'de-DE' },
    it: { voice: 'Polly.Carla', language: 'it-IT' },
    fr: { voice: 'Polly.Celine', language: 'fr-FR' },
    pt: { voice: 'Polly.Camila', language: 'pt-BR' }
  };
  
  const config = voiceConfig[language] || voiceConfig.es;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${config.voice}" language="${config.language}">
    ${message}
  </Say>
  <Gather input="speech" language="${config.language}" timeout="10" speechTimeout="6" action="/api/twilio-call-gemini-enhanced" method="POST">
    <Say voice="${config.voice}" language="${config.language}">
      ${getWaitMessage(language)}
    </Say>
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">
    ${getTimeoutMessage(language)}
  </Say>
  <Hangup/>
</Response>`;
}

// Mensajes de espera por idioma
function getWaitMessage(language) {
  const messages = {
    es: 'Por favor, responda.',
    en: 'Please respond.',
    de: 'Bitte antworten Sie.',
    it: 'Per favore, rispondi.',
    fr: 'Veuillez répondre.',
    pt: 'Por favor, responda.'
  };
  return messages[language] || messages.es;
}

// Mensajes de timeout por idioma
function getTimeoutMessage(language) {
  const messages = {
    es: 'No he recibido respuesta. Gracias por llamar.',
    en: 'I haven\'t received a response. Thank you for calling.',
    de: 'Ich habe keine Antwort erhalten. Vielen Dank für den Anruf.',
    it: 'Non ho ricevuto una risposta. Grazie per la chiamata.',
    fr: 'Je n\'ai pas reçu de réponse. Merci d\'avoir appelé.',
    pt: 'Não recebi uma resposta. Obrigado por ligar.'
  };
  return messages[language] || messages.es;
}

// Handler principal mejorado
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  const startTime = Date.now();
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  console.log(`[LLAMADA] Timestamp: ${new Date().toISOString()}`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    data: {},
    conversationHistory: [],
    retryCount: 0,
    maxRetries: 3
  };
  
  // Detectar idioma con contexto
  if (!state.language && userInput) {
    state.language = await EnhancedComprehensionSystem.detectLanguageWithContext(userInput, state.conversationHistory);
    console.log(`[IDIOMA] Idioma detectado: ${state.language}`);
  }
  
  if (!state.language) {
    state.language = 'es';
  }
  
  // Analizar intención con Gemini 2.0 Enhanced - CON REINTENTOS
  let intentAnalysis;
  if (userInput) {
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount < maxRetries) {
      try {
        intentAnalysis = await EnhancedComprehensionSystem.analyzeIntent(
          userInput, 
          state.conversationHistory, 
          state.step, 
          state.language
        );
        
        if (intentAnalysis && intentAnalysis.intent) {
          console.log(`[ANÁLISIS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
          break;
        } else {
          throw new Error('Análisis vacío o inválido');
        }
      } catch (error) {
        retryCount++;
        console.log(`[ANÁLISIS] Intento ${retryCount}/${maxRetries} falló:`, error.message);
        
        if (retryCount >= maxRetries) {
          console.log('[ANÁLISIS] Usando fallback después de reintentos');
          intentAnalysis = EnhancedComprehensionSystem.getFallbackIntent(userInput, state.step);
          break;
        }
        
        // Esperar antes del siguiente intento
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
  } else {
    intentAnalysis = {
      intent: 'greeting',
      confidence: 1.0,
      extracted_data: {},
      sentiment: 'positive',
      urgency: 'normal',
      next_step: 'ask_people',
      response_type: 'question',
      needs_clarification: false,
      clarification_question: null
    };
  }
  
  // Procesar datos extraídos
  if (intentAnalysis.extracted_data) {
    const { people, date, time, name, phone } = intentAnalysis.extracted_data;
    
    if (people && !state.data.people) {
      state.data.people = people;
      console.log(`[DATOS] Personas extraídas: ${people}`);
    }
    
    if (date && !state.data.date) {
      state.data.date = date;
      console.log(`[DATOS] Fecha extraída: ${date}`);
    }
    
    if (time && !state.data.time) {
      state.data.time = time;
      console.log(`[DATOS] Hora extraída: ${time}`);
    }
    
    if (name && !state.data.name) {
      state.data.name = name;
      console.log(`[DATOS] Nombre extraído: ${name}`);
    }
    
    if (phone && !state.data.phone) {
      state.data.phone = phone;
      console.log(`[DATOS] Teléfono extraído: ${phone}`);
    }
  }
  
  // Determinar siguiente paso
  let nextStep = state.step;
  let response = '';
  
  try {
    // Si necesita aclaración, mantener el paso actual
    if (intentAnalysis.needs_clarification) {
      nextStep = state.step;
      response = intentAnalysis.clarification_question || 
        await EnhancedComprehensionSystem.generateIntelligentResponse(intentAnalysis, state.language, state.conversationHistory);
    } else {
      // Avanzar según el flujo
      switch (state.step) {
        case 'greeting':
          if (intentAnalysis.extracted_data.people) {
            nextStep = 'ask_date';
          } else {
            nextStep = 'ask_people';
          }
          break;
          
        case 'ask_people':
          if (intentAnalysis.extracted_data.people) {
            nextStep = 'ask_date';
          } else {
            nextStep = 'ask_people';
          }
          break;
          
        case 'ask_date':
          if (intentAnalysis.extracted_data.date) {
            nextStep = 'ask_time';
          } else {
            nextStep = 'ask_date';
          }
          break;
          
        case 'ask_time':
          if (intentAnalysis.extracted_data.time) {
            nextStep = 'ask_name';
          } else {
            nextStep = 'ask_time';
          }
          break;
          
        case 'ask_name':
          if (intentAnalysis.extracted_data.name) {
            nextStep = 'ask_phone';
          } else {
            nextStep = 'ask_name';
          }
          break;
          
        case 'ask_phone':
          state.data.phone = From;
          nextStep = 'complete';
          break;
          
        case 'complete':
          nextStep = 'finished';
          break;
      }
      
          // Generar respuesta inteligente con fallback
      try {
        response = await EnhancedComprehensionSystem.generateIntelligentResponse(
          intentAnalysis, 
          state.language, 
          state.conversationHistory
        );
      } catch (error) {
        console.log('[RESPUESTA] Error generando respuesta inteligente, usando fallback');
        response = EnhancedComprehensionSystem.getFallbackResponse(nextStep, state.language);
      }
    }
    
    // Si es el paso final, guardar reserva
    if (nextStep === 'complete' && state.data.people && state.data.date && state.data.time && state.data.name) {
      const saved = await saveReservation(state);
      if (saved) {
        response = await EnhancedComprehensionSystem.generateIntelligentResponse({
          intent: 'confirmation',
          confidence: 1.0,
          extracted_data: state.data,
          sentiment: 'positive',
          urgency: 'normal',
          next_step: 'complete',
          response_type: 'confirmation',
          needs_clarification: false,
          clarification_question: null
        }, state.language, state.conversationHistory);
        nextStep = 'finished';
      } else {
        response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        nextStep = 'error';
      }
    }
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
    nextStep = 'error';
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
  state.step = nextStep;
  conversationStates.set(From, state);
  
  // Generar TwiML
  const twiml = generateTwiML(response, state.language);
  
  // Logging de métricas
  const processingTime = Date.now() - startTime;
  console.log(`[MÉTRICAS] Tiempo de procesamiento: ${processingTime}ms`);
  console.log(`[MÉTRICAS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
  console.log(`[MÉTRICAS] Sentimiento: ${intentAnalysis.sentiment}, Urgencia: ${intentAnalysis.urgency}`);
  console.log(`[MÉTRICAS] Paso: ${state.step} -> ${nextStep}`);
  console.log(`[MÉTRICAS] Idioma: ${state.language}`);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
