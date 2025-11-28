/**
 * API endpoint para generar audio usando Google Cloud Text-to-Speech
 * Usa las voces Chirp optimizadas para cada idioma
 * REQUIERE: Google Cloud Text-to-Speech API habilitada
 * 
 * Updated: 2025-11-25
 */

const crypto = require('crypto');
const textToSpeech = require('@google-cloud/text-to-speech');
require('dotenv').config();

// OPTIMIZACIÓN: Instanciar cliente TTS una sola vez fuera del handler (reutilización)
let ttsClient = null;

function getTTSClient() {
  if (!ttsClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        throw new Error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurada.');
      }

      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;

      ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: credentials
      });
      
      console.log(`✅ [TTS] Cliente Google Cloud Text-to-Speech inicializado: ${credentials.client_email}`);
    } catch (error) {
      console.error('❌ [TTS] Error inicializando cliente:', error);
      throw error;
    }
  }
  return ttsClient;
}

// Mapeo de idiomas y voces Chirp 3 HD
// Formato correcto: <locale>-Chirp3-HD-<voice>
// Referencia: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd?hl=es-419
const voiceConfig = {
  es: {
    languageCode: 'es-ES',
    voiceName: 'es-ES-Chirp3-HD-Vindemiatrix', // Femenina
    ssmlGender: 'FEMALE'
  },
  en: {
    languageCode: 'en-US',
    voiceName: 'en-US-Chirp3-HD-Leda', // Femenina
    ssmlGender: 'FEMALE'
  },
  de: {
    languageCode: 'de-DE',
    voiceName: 'de-DE-Chirp3-HD-Kore', // Femenina
    ssmlGender: 'FEMALE'
  },
  it: {
    languageCode: 'it-IT',
    voiceName: 'it-IT-Chirp3-HD-Kore', // Femenina
    ssmlGender: 'FEMALE'
  },
  fr: {
    languageCode: 'fr-FR',
    voiceName: 'fr-FR-Chirp3-HD-Kore', // Femenina
    ssmlGender: 'FEMALE'
  },
  pt: {
    languageCode: 'pt-BR',
    voiceName: 'pt-BR-Chirp3-HD-Kore', // Femenina
    ssmlGender: 'FEMALE'
  }
};

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

/**
 * Función centralizada para generar audio usando Google Cloud Text-to-Speech
 * @param {string} text - Texto a convertir a audio
 * @param {string} lang - Código de idioma (es, en, de, it, fr, pt)
 * @returns {Promise<{audio: Buffer, hash: string}>}
 */
async function generateSpeech(text, lang = 'es') {
  // OPTIMIZACIÓN CRÍTICA: Limitar texto antes de procesar (reduce latencia de 4-8s a <1s)
  const preparedText = prepareTextForCall(text);
  const originalLength = text.length;
  const preparedLength = preparedText.length;
  
  // Log solo en DEBUG si se recorta texto (demasiado ruido en producción)
  
  const voice = voiceConfig[lang] || voiceConfig.es;
  const hash = crypto.createHash('md5').update(`${preparedText}-${voice.languageCode}-${voice.voiceName}`).digest('hex');
  
  // Verificar cache PRIMERO (más rápido)
  const cached = audioCache.get(hash);
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < CACHE_TTL_MS) {
      // Log solo en DEBUG (demasiado ruido en producción)
      return { audio: cached.audio, hash };
    } else {
      // Entrada expirada - eliminar
      audioCache.delete(hash);
    }
  }

  try {
    const client = getTTSClient();
    const ttsGenerationStartTime = Date.now();
    
    // Log solo en DEBUG (demasiado ruido en producción)

    // Construir la solicitud
    const request = {
      input: { text: preparedText },
      voice: {
        languageCode: voice.languageCode,
        name: voice.voiceName,
        ssmlGender: voice.ssmlGender
      },
      audioConfig: {
        audioEncoding: 'MULAW', // OPTIMIZACIÓN CRÍTICA: MULAW es ideal para telefonía (formato nativo de Twilio, menos bytes)
        sampleRateHertz: 8000, // OPTIMIZACIÓN CRÍTICA: 8000 Hz (mismo sample rate que Twilio, suficiente para voz telefónica)
        speakingRate: 1.0, // Velocidad normal de habla (1.0 = velocidad estándar)
        pitch: 0,
        volumeGainDb: 0 // Sin ganancia adicional para mantener velocidad
      }
    };

    // OPTIMIZACIÓN: Timeout de 10 segundos para dar tiempo a la generación de audio
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('TTS timeout after 10s')), 10000);
    });

    const synthesizePromise = client.synthesizeSpeech(request);
    
    let response;
    try {
      response = await Promise.race([synthesizePromise, timeoutPromise]);
    } catch (error) {
      if (error.message.includes('timeout')) {
        throw new Error('TTS timeout after 10s');
      }
      throw error;
    }

    if (!response || !response[0] || !response[0].audioContent) {
      throw new Error('No se recibió audioContent en la respuesta');
    }

    const audioBuffer = Buffer.from(response[0].audioContent);

    // OPTIMIZACIÓN: Limpiar cache antes de agregar nueva entrada (evita acumulación de memoria)
    cleanupCache();

    // Guardar en cache
    audioCache.set(hash, {
      audio: audioBuffer,
      timestamp: Date.now(),
      language: voice.languageCode,
      voice: voice.voiceName,
      text: preparedText.substring(0, 100)
    });

    const ttsGenerationTime = Date.now() - ttsGenerationStartTime;
    // Log solo si es lento (>1000ms) o en DEBUG (demasiado ruido en producción)
    if (ttsGenerationTime > 1000) {
      console.warn(JSON.stringify({ts: new Date().toISOString(), level: 'WARN', msg: 'TTS_SLOW', timeMs: ttsGenerationTime, sizeBytes: audioBuffer.length}));
    }

    return { audio: audioBuffer, hash };
  } catch (error) {
    console.error('❌ [TTS] Error generando audio con Google Cloud TTS:', error);
    
    // Mensajes de error más descriptivos
    if (error.code === 7) {
      throw new Error('❌ Permisos denegados. Verifica que el Service Account tiene el rol "Cloud Text-to-Speech API User"');
    } else if (error.code === 16) {
      throw new Error('❌ Autenticación fallida. Verifica que las credenciales JSON son correctas');
    } else if (error.message.includes('timeout')) {
      throw new Error('TTS timeout after 10s');
    }
    
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
          // Log solo en DEBUG (demasiado ruido en producción)
          audioData = { audio: cached.audio, hash };
        } else {
          return res.status(404).json({ error: 'Audio not found in cache' });
        }
      } else if (text) {
        const decodedText = decodeURIComponent(text);
        const textHash = crypto.createHash('md5').update(`${decodedText}-${voiceConfig[language]?.languageCode || voiceConfig.es.languageCode}-${voiceConfig[language]?.voiceName || voiceConfig.es.voiceName}`).digest('hex');
        
        // OPTIMIZACIÓN: Verificar cache antes de generar
        const cached = audioCache.get(textHash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          // Log solo en DEBUG (demasiado ruido en producción)
          audioData = { audio: cached.audio, hash: textHash };
        } else {
          // Generar audio (sin log - demasiado ruido)
          try {
            audioData = await generateSpeech(decodedText, language);
          } catch (error) {
            console.error(`❌ [TTS] Error generando audio: ${error.message}`);
            return res.status(500).json({ 
              error: 'Failed to generate audio',
              message: error.message
            });
          }
        }
      }
      
      if (!audioData || !audioData.audio) {
        return res.status(500).json({ error: 'Failed to generate audio' });
      }
      
      const voice = voiceConfig[language] || voiceConfig.es;
      
      // OPTIMIZACIÓN: MULAW usa Content-Type audio/basic (formato telefónico nativo)
      res.setHeader('Content-Type', 'audio/basic');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', voice.voiceName);
      res.setHeader('X-Provider', 'google-cloud-tts');
      
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

      // Generar audio
      const audioData = await generateSpeech(text, language);

      const voice = voiceConfig[language] || voiceConfig.es;

      // OPTIMIZACIÓN: MULAW usa Content-Type audio/basic (formato telefónico nativo)
      res.setHeader('Content-Type', 'audio/basic');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', voice.voiceName);
      res.setHeader('X-Provider', 'google-cloud-tts');

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
