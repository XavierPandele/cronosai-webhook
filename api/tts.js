/**
 * API endpoint para generar audio usando Vertex AI Text-to-Speech
 * Usa la voz Algieba con el modelo gemini-2.5-pro-tts
 * REQUIERE: Vertex AI API habilitada
 */

const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

// Configuración de Vertex AI
const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'cronosai-473114';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Mapeo de idiomas
const languageCodes = {
  es: 'es-es',
  en: 'en-us',
  de: 'de-de',
  it: 'it-it',
  fr: 'fr-fr',
  pt: 'pt-br'
};

// Configuración de la voz Algieba
const VOICE_NAME = 'Algieba';
const MODEL_NAME = 'gemini-2.5-flash-tts'; // OPTIMIZACIÓN: Usar Flash en lugar de Pro para mayor velocidad en llamadas telefónicas

// OPTIMIZACIÓN CRÍTICA: Limitar texto para reducir latencia de TTS
// La latencia crece casi linealmente con la longitud del texto
const MAX_TEXT_LENGTH = 180; // Caracteres máximos para llamadas telefónicas (1-2 frases cortas)

/**
 * Prepara el texto para llamadas telefónicas limitando su longitud
 * Esto reduce significativamente la latencia de TTS (de varios segundos a <1s)
 */
function prepareTextForCall(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  
  let text = rawText.trim();
  
  // Quitar saltos de línea y espacios múltiples
  text = text.replace(/\s+/g, ' ');
  
  // Si el texto es muy corto, devolverlo tal cual
  if (text.length <= MAX_TEXT_LENGTH) {
    return text;
  }
  
  // Intentar cortar en el punto más cercano a MAX_TEXT_LENGTH
  const cutPoint = text.lastIndexOf('.', MAX_TEXT_LENGTH);
  if (cutPoint > 50) {
    // Si encontramos un punto razonablemente cerca, cortar ahí
    text = text.slice(0, cutPoint + 1);
  } else {
    // Si no hay punto cercano, cortar y agregar elipsis
    text = text.slice(0, MAX_TEXT_LENGTH) + '…';
  }
  
  return text;
}

// Cache optimizado para mejor rendimiento
const audioCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_CACHE_SIZE = 500; // OPTIMIZACIÓN: Reducido de 1000 a 500 para mejor gestión de memoria
const MAX_CACHE_MEMORY_MB = 50; // OPTIMIZACIÓN: Límite de memoria en MB (aprox 50MB de audio en cache)

/**
 * Limpia el cache eliminando entradas expiradas y las más antiguas si excede límites
 */
function cleanupCache() {
  const now = Date.now();
  let totalMemoryBytes = 0;
  const entries = [];
  
  // Calcular memoria total y recopilar entradas válidas
  for (const [hash, cached] of audioCache.entries()) {
    const age = now - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      // Entrada válida
      const size = cached.audio ? cached.audio.length : 0;
      totalMemoryBytes += size;
      entries.push({ hash, timestamp: cached.timestamp, size });
    } else {
      // Entrada expirada - eliminar
      audioCache.delete(hash);
    }
  }
  
  // Si excede límite de memoria, eliminar las más antiguas
  const maxMemoryBytes = MAX_CACHE_MEMORY_MB * 1024 * 1024;
  if (totalMemoryBytes > maxMemoryBytes) {
    // Ordenar por timestamp (más antiguas primero)
    entries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Eliminar hasta que estemos bajo el límite
    for (const entry of entries) {
      if (totalMemoryBytes <= maxMemoryBytes) break;
      audioCache.delete(entry.hash);
      totalMemoryBytes -= entry.size;
    }
    
    console.log(`🧹 [TTS] Cache limpiado por memoria. Eliminadas entradas antiguas. Memoria actual: ${(totalMemoryBytes / 1024 / 1024).toFixed(2)}MB`);
  }
  
  // Si excede límite de entradas, eliminar las más antiguas
  if (audioCache.size > MAX_CACHE_SIZE) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = audioCache.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toDelete; i++) {
      audioCache.delete(entries[i].hash);
    }
    console.log(`🧹 [TTS] Cache limpiado por tamaño. Eliminadas ${toDelete} entradas antiguas. Tamaño actual: ${audioCache.size}`);
  }
}

// OPTIMIZACIÓN: Pre-generar respuestas comunes para reducir latencia
let commonResponsesPreGenerated = false;
const commonResponsesToPreGenerate = [
  // Mensajes de greeting en todos los idiomas
  { text: '¡Buenos días! Qué gusto tenerle por aquí. ¿Cómo puedo ayudarle?', language: 'es' },
  { text: '¡Buenas tardes! Encantado de atenderle. ¿En qué puedo ayudarle?', language: 'es' },
  { text: '¡Buenas noches! Bienvenido. ¿Cómo puedo ayudarle?', language: 'es' },
  { text: 'Good morning! How can I help you?', language: 'en' },
  { text: 'Good afternoon! How can I assist you?', language: 'en' },
  { text: 'Good evening! How can I help you?', language: 'en' },
  // Mensajes de ask_people
  { text: '¿Para cuántas personas será la reserva?', language: 'es' },
  { text: '¿Cuántas personas serán?', language: 'es' },
  { text: 'How many people will the reservation be for?', language: 'en' },
  { text: 'How many people?', language: 'en' },
  // Mensajes de ask_date
  { text: '¿Para qué fecha desea la reserva?', language: 'es' },
  { text: '¿Qué día prefiere?', language: 'es' },
  { text: 'What date would you like the reservation for?', language: 'en' },
  { text: 'What day do you prefer?', language: 'en' },
  // Mensajes de ask_time
  { text: '¿A qué hora desea la reserva?', language: 'es' },
  { text: '¿Qué hora prefiere?', language: 'es' },
  { text: 'What time would you like the reservation?', language: 'en' },
  { text: 'What time do you prefer?', language: 'en' },
  // Mensajes de ask_name
  { text: '¿A nombre de quién será la reserva?', language: 'es' },
  { text: '¿Me puede decir su nombre?', language: 'es' },
  { text: 'What name should the reservation be under?', language: 'en' },
  { text: 'Can you tell me your name?', language: 'en' },
  // Mensajes de confirmación
  { text: 'Perfecto, ¿está todo correcto?', language: 'es' },
  { text: 'Perfect, is everything correct?', language: 'en' },
  // Mensajes de error comunes
  { text: 'Disculpe, no he entendido bien. ¿Podría repetir, por favor?', language: 'es' },
  { text: 'Sorry, I didn\'t understand. Could you repeat, please?', language: 'en' }
];

/**
 * Pre-genera respuestas comunes en background para reducir latencia
 */
async function preGenerateCommonResponses() {
  if (commonResponsesPreGenerated) {
    return;
  }
  
  console.log(`🎤 [TTS] Pre-generando ${commonResponsesToPreGenerate.length} respuestas comunes...`);
  const startTime = Date.now();
  
  // Generar en paralelo (máximo 5 a la vez para no sobrecargar)
  const batchSize = 5;
  for (let i = 0; i < commonResponsesToPreGenerate.length; i += batchSize) {
    const batch = commonResponsesToPreGenerate.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async ({ text, language }) => {
        try {
          const hash = crypto.createHash('md5').update(`${text}-${languageCodes[language] || languageCodes.es}`).digest('hex');
          // Solo generar si no está en cache
          if (!audioCache.has(hash)) {
            await generateAudioWithVertexAI(text, language).catch(err => {
              console.warn(`⚠️ [TTS] Error pre-generando "${text.substring(0, 30)}...": ${err.message}`);
            });
          }
        } catch (error) {
          // Ignorar errores en pre-generación (no crítico)
          console.warn(`⚠️ [TTS] Error pre-generando respuesta común: ${error.message}`);
        }
      })
    );
  }
  
  const preGenTime = Date.now() - startTime;
  console.log(`✅ [TTS] Pre-generación completada en ${preGenTime}ms. ${audioCache.size} audios en cache.`);
  commonResponsesPreGenerated = true;
}

// DESACTIVADO: Pre-generación causa error 429 (quota exceeded)
// Iniciar pre-generación en background (no bloquea)
// setImmediate(() => {
//   preGenerateCommonResponses().catch(err => {
//     console.warn(`⚠️ [TTS] Error en pre-generación inicial: ${err.message}`);
//   });
// });

// Cliente de autenticación
let authClient = null;
let cachedAccessToken = null;
let tokenExpiryTime = 0;
const TOKEN_CACHE_DURATION_MS = 50 * 60 * 1000; // Cachear token por 50 minutos (los tokens duran ~1 hora)

async function getAccessToken() {
  // Verificar si tenemos un token válido en cache
  if (cachedAccessToken && Date.now() < tokenExpiryTime) {
    return cachedAccessToken;
  }

  if (!authClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        throw new Error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurada.');
      }

      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;

      authClient = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      console.log(`✅ [TTS] Cliente de autenticación inicializado: ${credentials.client_email}`);
    } catch (error) {
      console.error('❌ [TTS] Error inicializando cliente:', error);
      throw error;
    }
  }
  
  const client = await authClient.getClient();
  const accessTokenResponse = await client.getAccessToken();
  
  if (!accessTokenResponse.token) {
    throw new Error('❌ No se pudo obtener el token de acceso');
  }
  
  // Cachear el token
  cachedAccessToken = accessTokenResponse.token;
  tokenExpiryTime = Date.now() + TOKEN_CACHE_DURATION_MS;
  
  return cachedAccessToken;
}

async function generateAudioWithVertexAI(text, language = 'es') {
  // OPTIMIZACIÓN CRÍTICA: Limitar texto antes de procesar (reduce latencia de 4-8s a <1s)
  const preparedText = prepareTextForCall(text);
  const originalLength = text.length;
  const preparedLength = preparedText.length;
  
  if (originalLength > preparedLength) {
    console.log(`✂️ [TTS] Texto recortado de ${originalLength} a ${preparedLength} caracteres para reducir latencia`);
  }
  
  const languageCode = languageCodes[language] || languageCodes.es;
  const hash = crypto.createHash('md5').update(`${preparedText}-${languageCode}`).digest('hex');
  
  // Verificar cache PRIMERO (más rápido)
  const cached = audioCache.get(hash);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}... (${cached.audio.length} bytes, edad: ${Math.round(age / 1000)}s)`);
      return { audio: cached.audio, hash };
    } else {
      // Entrada expirada - eliminar
      audioCache.delete(hash);
    }
  }
  
  // OPTIMIZACIÓN: Si no está en cache y es una respuesta común, intentar pre-generarla
  // (esto se hace automáticamente en background, pero aquí verificamos si ya está)

  try {
    const accessToken = await getAccessToken();
    const ttsGenerationStartTime = Date.now();
    
    console.log(`🎤 [TTS] Generando audio con Vertex AI: "${preparedText.substring(0, 50)}..." (${languageCode}) - INICIO`);

    // Endpoint estándar de Text-to-Speech API (el modelo gemini-2.5-pro-tts se especifica en el request body)
    const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

    const requestBody = {
      audioConfig: {
        audioEncoding: 'MULAW', // OPTIMIZACIÓN CRÍTICA: MULAW es ideal para telefonía (formato nativo de Twilio, menos bytes)
        pitch: 0,
        speakingRate: 1.0, // Velocidad normal de habla (1.0 = velocidad estándar)
        sampleRateHertz: 8000, // OPTIMIZACIÓN CRÍTICA: 8000 Hz (mismo sample rate que Twilio, suficiente para voz telefónica)
        volumeGainDb: 0 // Sin ganancia adicional para mantener velocidad
      },
      input: {
        text: preparedText // Usar texto preparado (limitado)
      },
      voice: {
        languageCode: languageCode,
        name: VOICE_NAME,
        modelName: MODEL_NAME // gemini-2.5-pro-tts (requiere Vertex AI)
      }
    };

    console.log(`🔍 [TTS] Text-to-Speech API Request:`, {
      projectId: PROJECT_ID,
      location: LOCATION,
      languageCode: languageCode,
      voiceName: VOICE_NAME,
      modelName: MODEL_NAME,
      url: url
    });

    // OPTIMIZACIÓN: Timeout de 10 segundos para dar tiempo a la generación de audio
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('TTS fetch timeout after 10s');
      }
      throw fetchError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [TTS] Error en Vertex AI: ${response.status} - ${errorText}`);
      
      // Mensajes de error más descriptivos
      let errorMessage = `Error en Vertex AI TTS: ${response.status}`;
      
      if (response.status === 403) {
        errorMessage = `❌ Permisos denegados. Verifica que:
1. El Service Account tiene el rol "Vertex AI User" (roles/aiplatform.user)
2. La API "Vertex AI API" está habilitada
3. Las credenciales JSON son correctas
4. El proyecto ID es correcto: ${PROJECT_ID}
Error: ${errorText}`;
      } else if (response.status === 401) {
        errorMessage = `❌ Autenticación fallida. Verifica que:
1. Las credenciales JSON son correctas
2. El Service Account existe y está activo
3. Las credenciales no han expirado
Error: ${errorText}`;
      } else if (response.status === 429) {
        // ERROR 429: Quota exceeded - fallback inmediato sin retry
        errorMessage = `TTS quota exceeded (429) - using fallback`;
        const quotaError = new Error(errorMessage);
        quotaError.statusCode = 429;
        quotaError.isQuotaError = true;
        throw quotaError;
      } else if (response.status === 400) {
        errorMessage = `❌ Solicitud inválida. Verifica que:
1. El código de idioma es correcto (${languageCode})
2. La voz "Algieba" está disponible para el idioma ${languageCode}
3. El modelo "${MODEL_NAME}" es válido y está disponible
4. La API "Cloud Text-to-Speech API" está habilitada
5. El modelo "${MODEL_NAME}" requiere Vertex AI API habilitada
Error: ${errorText}`;
      } else if (response.status === 404) {
        errorMessage = `❌ Endpoint no encontrado. Verifica que:
1. La API "Cloud Text-to-Speech API" está habilitada
2. El endpoint es correcto
3. El modelo "${MODEL_NAME}" está disponible
Error: ${errorText}`;
      } else {
        errorMessage = `Error en Text-to-Speech API: ${response.status} - ${errorText}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    if (!data.audioContent) {
      throw new Error('No se recibió audioContent en la respuesta');
    }

    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    // OPTIMIZACIÓN: Limpiar cache antes de agregar nueva entrada (evita acumulación de memoria)
    cleanupCache();

    // Guardar en cache
    audioCache.set(hash, {
      audio: audioBuffer,
      timestamp: Date.now(),
      language: languageCode,
      text: preparedText.substring(0, 100)
    });

    const ttsGenerationTime = Date.now() - ttsGenerationStartTime;
    console.log(`✅ [TTS] Audio generado exitosamente en ${ttsGenerationTime}ms (${audioBuffer.length} bytes)`);

    return { audio: audioBuffer, hash };
  } catch (error) {
    console.error('❌ [TTS] Error generando audio con Vertex AI:', error);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  const { method, query, body } = req;
  
  if (method === 'GET') {
    try {
      const { hash, text, language = 'es' } = query;
      
      if (!hash && !text) {
        return res.status(400).json({ error: 'Hash or text is required' });
      }
      
      let audioData;
      
      if (hash) {
        // OPTIMIZACIÓN: Buscar por hash primero (más rápido)
        const cached = audioCache.get(hash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          console.log(`✅ [TTS] Cache hit por hash: ${hash.substring(0, 8)}... (${cached.audio.length} bytes)`);
          audioData = { audio: cached.audio, hash };
        } else {
          return res.status(404).json({ error: 'Audio not found in cache' });
        }
      } else if (text) {
        const decodedText = decodeURIComponent(text);
        const textHash = crypto.createHash('md5').update(`${decodedText}-${languageCodes[language] || languageCodes.es}`).digest('hex');
        
        // OPTIMIZACIÓN: Verificar cache antes de generar
        const cached = audioCache.get(textHash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          console.log(`✅ [TTS] Cache hit por texto: "${decodedText.substring(0, 30)}..." (${cached.audio.length} bytes)`);
          audioData = { audio: cached.audio, hash: textHash };
        } else {
          // OPTIMIZACIÓN CRÍTICA: Generar en background y responder inmediatamente si es texto corto
          // Para textos largos, generar normalmente
          if (decodedText.length > 200) {
            // Texto largo: generar normalmente
            console.log(`🎤 [TTS] Generando audio para texto largo (${decodedText.length} chars)...`);
            audioData = await generateAudioWithVertexAI(decodedText, language);
          } else {
            // Texto corto: intentar generar rápido con timeout más largo
            console.log(`🎤 [TTS] Generando audio rápido para: "${decodedText.substring(0, 50)}..."`);
            try {
              // OPTIMIZACIÓN: Timeout de 10 segundos para dar tiempo a la generación de audio
              const ttsTimeout = 10000; // 10 segundos máximo
              audioData = await Promise.race([
                generateAudioWithVertexAI(decodedText, language),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error(`TTS timeout after ${ttsTimeout}ms`)), ttsTimeout)
                )
              ]);
            } catch (error) {
              console.error(`❌ [TTS] Error o timeout generando audio: ${error.message}`);
              // OPTIMIZACIÓN: En lugar de fallar, intentar usar Twilio Say como fallback
              // Pero como estamos en el endpoint TTS, mejor devolver error y que Twilio use Say
              return res.status(500).json({ 
                error: 'Failed to generate audio',
                message: error.message,
                fallback: 'Use Twilio Say instead'
              });
            }
          }
        }
      }
      
      if (!audioData || !audioData.audio) {
        return res.status(500).json({ error: 'Failed to generate audio' });
      }
      
      // OPTIMIZACIÓN: MULAW usa Content-Type audio/basic (formato telefónico nativo)
      res.setHeader('Content-Type', 'audio/basic');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);
      res.setHeader('X-Vertex-AI', 'true');
      
      return res.status(200).send(audioData.audio);
    } catch (error) {
      console.error('❌ [TTS] Error en GET endpoint:', error);
      return res.status(500).json({ 
        error: 'Error retrieving audio',
        message: error.message 
      });
    }
  }
  
  if (method === 'POST') {
    try {
      const { text, language = 'es' } = body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      if (text.length > 5000) {
        return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
      }

      // OPTIMIZACIÓN: Limitar texto antes de generar audio
      const preparedText = prepareTextForCall(text);
      const audioData = await generateAudioWithVertexAI(preparedText, language);

      // OPTIMIZACIÓN: MULAW usa Content-Type audio/basic (formato telefónico nativo)
      res.setHeader('Content-Type', 'audio/basic');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);
      res.setHeader('X-Vertex-AI', 'true');

      return res.status(200).send(audioData.audio);
    } catch (error) {
      console.error('❌ [TTS] Error en POST endpoint:', error);
      return res.status(500).json({ 
        error: 'Error generating audio',
        message: error.message 
      });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};
