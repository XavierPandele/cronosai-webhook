/**
 * API endpoint para generar audio usando Google Cloud Text-to-Speech
 * Usa la voz Algieba con el modelo gemini-2.5-pro-tts
 * MEJORADO: Usa Service Account con credenciales JSON mediante API REST
 */

const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

// Mapeo de idiomas a códigos de idioma para Algieba
// NOTA: Usar formato en minúsculas como en la imagen del usuario (es-es, en-us, etc.)
const languageCodes = {
  es: 'es-es', // Español (España) - formato minúsculas como en la imagen
  en: 'en-us', // Inglés (Estados Unidos)
  de: 'de-de', // Alemán
  it: 'it-it', // Italiano
  fr: 'fr-fr', // Francés
  pt: 'pt-br'  // Portugués (Brasil)
};

// Configuración de la voz Algieba
const VOICE_NAME = 'Algieba';
const MODEL_NAME = 'gemini-2.5-pro-tts';

// Cache simple en memoria (para producción, usar Redis o similar)
const audioCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// Cliente de autenticación (inicializado una vez)
let authClient = null;

/**
 * Obtiene el prompt apropiado para el idioma
 */
function getPromptForLanguage(language) {
  const prompts = {
    es: 'Lee en voz alta con un tono cálido y acogedor.',
    en: 'Read aloud in a warm, welcoming tone.',
    de: 'Lies laut mit einem warmen, einladenden Ton vor.',
    it: 'Leggi ad alta voce con un tono caloroso e accogliente.',
    fr: 'Lisez à haute voix avec un ton chaleureux et accueillant.',
    pt: 'Leia em voz alta com um tom caloroso e acolhedor.'
  };
  return prompts[language] || prompts.es;
}

/**
 * Inicializa el cliente de autenticación con Service Account
 * y obtiene un token de acceso para la API REST
 */
async function getAccessToken() {
  if (!authClient) {
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
      authClient = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      console.log(`✅ [TTS] Cliente de autenticación inicializado con Service Account: ${credentials.client_email || 'unknown'}`);
    } catch (error) {
      console.error('❌ [TTS] Error inicializando cliente de autenticación:', error);
      throw error;
    }
  }
  
  // Obtener token de acceso
  const client = await authClient.getClient();
  const accessTokenResponse = await client.getAccessToken();
  
  if (!accessTokenResponse.token) {
    throw new Error('❌ No se pudo obtener el token de acceso');
  }
  
  return accessTokenResponse.token;
}

/**
 * Genera un hash del texto para usar como identificador único
 */
function generateHash(text, language) {
  return crypto.createHash('md5').update(`${text}-${language}`).digest('hex');
}

/**
 * Genera audio usando Google Cloud Text-to-Speech API REST
 * (Usa Service Account con credenciales JSON mediante OAuth2 token)
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
    // Obtener token de acceso
    const accessToken = await getAccessToken();
    
    console.log(`🎤 [TTS] Generando audio para: "${text.substring(0, 50)}..." (${languageCode})`);

    // Construir request para Text-to-Speech API REST (igual que en la imagen del usuario)
    const requestBody = {
      audioConfig: {
        audioEncoding: 'MP3', // MP3 es mejor para Twilio (más compatible y menor tamaño)
        pitch: 0,
        speakingRate: 1,
        sampleRateHertz: 24000 // Calidad de audio optimizada para voz
      },
      input: {
        prompt: getPromptForLanguage(language),
        text: text
      },
      voice: {
        languageCode: languageCode, // Formato minúsculas (es-es, en-us, etc.)
        modelName: MODEL_NAME,
        name: VOICE_NAME
      }
    };

    console.log(`🔍 [TTS] Request config:`, {
      languageCode: languageCode,
      voiceName: VOICE_NAME,
      modelName: MODEL_NAME,
      url: 'https://texttospeech.googleapis.com/v1beta1/text:synthesize'
    });

    // Llamar a la API REST con token de acceso
    const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [TTS] Error en API REST: ${response.status} - ${errorText}`);
      
      // Mensajes de error más descriptivos
      let errorMessage = `Error en Text-to-Speech API: ${response.status}`;
      
      if (response.status === 403) {
        errorMessage = `❌ Permisos denegados. Verifica que:
1. El Service Account tiene el rol "Cloud Text-to-Speech API User"
2. La API "Cloud Text-to-Speech API" está habilitada
3. Las credenciales JSON son correctas
Error: ${errorText}`;
      } else if (response.status === 401) {
        errorMessage = `❌ Autenticación fallida. Verifica que:
1. Las credenciales JSON son correctas
2. El Service Account existe y está activo
3. Las credenciales no han expirado
Error: ${errorText}`;
      } else if (response.status === 400) {
        errorMessage = `❌ Solicitud inválida. Verifica que:
1. El código de idioma es correcto (${languageCode})
2. La voz "Algieba" está disponible para el idioma ${languageCode}
3. El modelo "gemini-2.5-pro-tts" es válido
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

    // Decodificar audio base64
    const audioBuffer = Buffer.from(data.audioContent, 'base64');

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
    throw error;
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
