/**
 * API endpoint para generar audio usando Google Cloud Text-to-Speech
 * Usa la voz Algieba con el modelo gemini-2.5-pro-tts
 * MEJORADO: Usa Service Account con credenciales JSON
 */

const crypto = require('crypto');
const textToSpeech = require('@google-cloud/text-to-speech');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

// Mapeo de idiomas a códigos de idioma para Algieba
const languageCodes = {
  es: 'es-ES', // Español (España)
  en: 'en-US', // Inglés (Estados Unidos)
  de: 'de-DE', // Alemán
  it: 'it-IT', // Italiano
  fr: 'fr-FR', // Francés
  pt: 'pt-BR'  // Portugués (Brasil)
};

// Configuración de la voz Algieba
const VOICE_NAME = 'Algieba';
const MODEL_NAME = 'gemini-2.5-pro-tts';

// Cache simple en memoria (para producción, usar Redis o similar)
const audioCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// Cliente de Text-to-Speech (inicializado una vez)
let ttsClient = null;

/**
 * Inicializa el cliente de Text-to-Speech con Service Account
 */
function getTtsClient() {
  if (!ttsClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        throw new Error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurada. Verifica que la variable de entorno esté configurada en Vercel.');
      }

      // Parsear las credenciales JSON
      let credentials;
      try {
        credentials = typeof credentialsJson === 'string' 
          ? JSON.parse(credentialsJson) 
          : credentialsJson;
      } catch (parseError) {
        throw new Error(`❌ Error parseando credenciales JSON: ${parseError.message}`);
      }

      // Configurar autenticación
      const auth = new GoogleAuth({
        credentials: credentials
      });

      // Crear cliente de Text-to-Speech
      ttsClient = new textToSpeech.TextToSpeechClient({ auth });
      
      console.log(`✅ [TTS] Cliente inicializado con Service Account: ${credentials.client_email || 'unknown'}`);
    } catch (error) {
      console.error('❌ [TTS] Error inicializando cliente:', error);
      throw error;
    }
  }
  
  return ttsClient;
}

/**
 * Genera un hash del texto para usar como identificador único
 */
function generateHash(text, language) {
  return crypto.createHash('md5').update(`${text}-${language}`).digest('hex');
}

/**
 * Genera audio usando Google Cloud Text-to-Speech SDK
 * (Usa Service Account con credenciales JSON)
 */
async function generateAudioWithServiceAccount(text, language = 'es') {
  const languageCode = languageCodes[language] || languageCodes.es;
  const hash = generateHash(text, languageCode);
  
  // Verificar cache por hash
  const cached = audioCache.get(hash);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}...`);
    return { audio: cached.audio, hash };
  }

  try {
    const client = getTtsClient();
    
    console.log(`🎤 [TTS] Generando audio para: "${text.substring(0, 50)}..." (${languageCode})`);

    // Construir request para Text-to-Speech
    const request = {
      input: {
        text: text
      },
      voice: {
        languageCode: languageCode,
        name: VOICE_NAME,
        modelName: MODEL_NAME
      },
      audioConfig: {
        audioEncoding: 'MP3', // MP3 es mejor para Twilio (más compatible y menor tamaño)
        pitch: 0,
        speakingRate: 1,
        sampleRateHertz: 24000 // Calidad de audio optimizada para voz
      }
    };

    // Generar audio usando el SDK
    const [response] = await client.synthesizeSpeech(request);
    
    if (!response.audioContent) {
      throw new Error('No se recibió audioContent en la respuesta');
    }

    // Convertir audio a Buffer
    const audioBuffer = Buffer.from(response.audioContent);

    // Guardar en cache usando hash como key
    audioCache.set(hash, {
      audio: audioBuffer,
      timestamp: Date.now(),
      language: languageCode,
      text: text.substring(0, 100) // Guardar preview del texto
    });

    console.log(`✅ [TTS] Audio generado exitosamente (${audioBuffer.length} bytes, hash: ${hash.substring(0, 8)}...)`);

    return { audio: audioBuffer, hash };
  } catch (error) {
    console.error('❌ [TTS] Error generando audio:', error);
    
    // Mensajes de error más descriptivos
    let errorMessage = error.message;
    
    if (error.message && (error.message.includes('PERMISSION_DENIED') || error.code === 7)) {
      errorMessage = `❌ Permisos denegados. Verifica que:
1. El Service Account tiene el rol "Cloud Text-to-Speech API User"
2. La API "Cloud Text-to-Speech API" está habilitada
3. Las credenciales JSON son correctas
Error: ${error.message}`;
    } else if (error.message && (error.message.includes('NOT_FOUND') || error.code === 5)) {
      errorMessage = `❌ Recurso no encontrado. Verifica que:
1. El código de idioma es correcto (${languageCode})
2. La voz "Algieba" está disponible para el idioma ${languageCode}
3. El modelo "gemini-2.5-pro-tts" es válido
Error: ${error.message}`;
    } else if (error.message && (error.message.includes('UNAUTHENTICATED') || error.code === 16)) {
      errorMessage = `❌ Autenticación fallida. Verifica que:
1. Las credenciales JSON son correctas
2. El Service Account existe y está activo
3. Las credenciales no han expirado
Error: ${error.message}`;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * Handler del endpoint API
 * GET: Servir audio desde cache usando hash o texto
 * POST: Generar audio y devolverlo
 */
module.exports = async function handler(req, res) {
  const { method, query, body } = req;
  
  // GET: Servir audio desde cache usando hash o texto
  if (method === 'GET') {
    try {
      const { hash, text, language = 'es' } = query;
      
      if (!hash && !text) {
        return res.status(400).json({ error: 'Hash or text is required' });
      }
      
      let audioData;
      
      if (hash) {
        // Buscar por hash
        const cached = audioCache.get(hash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}...`);
          audioData = { audio: cached.audio, hash };
        } else {
          return res.status(404).json({ error: 'Audio not found in cache' });
        }
      } else if (text) {
        // Generar audio desde texto
        audioData = await generateAudioWithServiceAccount(decodeURIComponent(text), language);
      }
      
      if (!audioData || !audioData.audio) {
        return res.status(500).json({ error: 'Failed to generate audio' });
      }
      
      // Devolver audio como respuesta
      // MP3 es el formato que Twilio soporta mejor
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache por 1 hora
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);
      
      return res.status(200).send(audioData.audio);
    } catch (error) {
      console.error('❌ [TTS] Error en GET endpoint:', error);
      return res.status(500).json({ 
        error: 'Error retrieving audio',
        message: error.message 
      });
    }
  }
  
  // POST: Generar audio
  if (method === 'POST') {
    try {
      const { text, language = 'es' } = body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Validar longitud del texto
      if (text.length > 5000) {
        return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
      }

      // Generar audio
      const audioData = await generateAudioWithServiceAccount(text, language);

      // Devolver audio y hash
      res.setHeader('Content-Type', 'audio/mpeg'); // MP3 para Twilio
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);

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
