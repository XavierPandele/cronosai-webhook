/**
 * API endpoint para generar audio usando Google Cloud Text-to-Speech
 * Usa la voz Algieba con el modelo gemini-2.5-pro-tts
 */

const crypto = require('crypto');
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

/**
 * Genera un hash del texto para usar como identificador único
 */
function generateHash(text, language) {
  return crypto.createHash('md5').update(`${text}-${language}`).digest('hex');
}

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
 * Genera audio usando Google Cloud Text-to-Speech API REST
 * (Usamos REST porque la API key funciona mejor con fetch)
 */
async function generateAudioWithAPIKey(text, language = 'es') {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY no está configurada');
  }

  const languageCode = languageCodes[language] || languageCodes.es;
  const hash = generateHash(text, languageCode);
  
  // Verificar cache por hash
  const cached = audioCache.get(hash);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}...`);
    return { audio: cached.audio, hash };
  }

  try {
    const url = `https://texttospeech.googleapis.com/v1beta1/text:synthesize`;
    
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
        languageCode: languageCode,
        modelName: MODEL_NAME,
        name: VOICE_NAME
      }
    };

    console.log(`🎤 [TTS] Generando audio para: "${text.substring(0, 50)}..." (${languageCode})`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [TTS] Error en API: ${response.status} - ${errorText}`);
      throw new Error(`Error en Text-to-Speech API: ${response.status} - ${errorText}`);
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
        audioData = await generateAudioWithAPIKey(decodeURIComponent(text), language);
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
      const audioData = await generateAudioWithAPIKey(text, language);

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
