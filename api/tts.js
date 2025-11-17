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
const MODEL_NAME = 'gemini-2.5-pro-tts'; // Requiere Vertex AI

// Cache optimizado para mejor rendimiento
const audioCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora
const MAX_CACHE_SIZE = 1000; // Limitar tamaño del cache para mejor rendimiento

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
  const languageCode = languageCodes[language] || languageCodes.es;
  const hash = crypto.createHash('md5').update(`${text}-${languageCode}`).digest('hex');
  
  // Verificar cache
  const cached = audioCache.get(hash);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}...`);
    return { audio: cached.audio, hash };
  }

  try {
    const accessToken = await getAccessToken();
    
    console.log(`🎤 [TTS] Generando audio con Vertex AI: "${text.substring(0, 50)}..." (${languageCode})`);

    // Endpoint estándar de Text-to-Speech API (el modelo gemini-2.5-pro-tts se especifica en el request body)
    const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

    const requestBody = {
      audioConfig: {
        audioEncoding: 'MP3', // MP3 es más rápido que LINEAR16 para streaming
        pitch: 0,
        speakingRate: 1.1, // Ligeramente más rápido para reducir tiempo de reproducción
        sampleRateHertz: 16000, // Reducido de 24000 a 16000 para generar más rápido (calidad aceptable para voz)
        volumeGainDb: 0 // Sin ganancia adicional para mantener velocidad
      },
      input: {
        text: text
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

    // Guardar en cache (con límite de tamaño para mejor rendimiento)
    if (audioCache.size >= MAX_CACHE_SIZE) {
      // Eliminar la entrada más antigua
      const firstKey = audioCache.keys().next().value;
      audioCache.delete(firstKey);
    }
    audioCache.set(hash, {
      audio: audioBuffer,
      timestamp: Date.now(),
      language: languageCode,
      text: text.substring(0, 100)
    });

    console.log(`✅ [TTS] Audio generado exitosamente con Vertex AI (${audioBuffer.length} bytes)`);

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
        const cached = audioCache.get(hash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          audioData = { audio: cached.audio, hash };
        } else {
          return res.status(404).json({ error: 'Audio not found in cache' });
        }
      } else if (text) {
        audioData = await generateAudioWithVertexAI(decodeURIComponent(text), language);
      }
      
      if (!audioData || !audioData.audio) {
        return res.status(500).json({ error: 'Failed to generate audio' });
      }
      
      res.setHeader('Content-Type', 'audio/mpeg');
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

      const audioData = await generateAudioWithVertexAI(text, language);

      res.setHeader('Content-Type', 'audio/mpeg');
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
