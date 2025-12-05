/**
 * Endpoint para procesar audio con Google Cloud Speech-to-Text
 * Mejora la detección multi-idioma y precisión de transcripción
 */

const { transcribeAudioWithLanguageDetection, transcribeAudioFromUrl } = require('../lib/google-speech');
const logger = require('../lib/logging');

module.exports = async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Método no permitido',
      method: req.method 
    });
  }
  
  try {
    const { 
      audioUrl, 
      audioBase64, 
      encoding = 'MULAW',
      sampleRateHertz = 8000,
      hints = [],
      enableAutomaticPunctuation = true
    } = req.body || {};
    
    // Validar que se proporcione audio
    if (!audioUrl && !audioBase64) {
      return res.status(400).json({
        error: 'Se requiere audioUrl o audioBase64',
        received: { audioUrl: !!audioUrl, audioBase64: !!audioBase64 }
      });
    }
    
    logger.info('SPEECH_TO_TEXT_REQUEST', {
      hasUrl: !!audioUrl,
      hasBase64: !!audioBase64,
      encoding,
      sampleRateHertz
    });
    
    let result;
    
    if (audioUrl) {
      // Transcribir desde URL
      result = await transcribeAudioFromUrl(audioUrl, {
        encoding,
        sampleRateHertz,
        hints,
        enableAutomaticPunctuation
      });
    } else {
      // Transcribir desde base64
      result = await transcribeAudioWithLanguageDetection(audioBase64, {
        encoding,
        sampleRateHertz,
        hints,
        enableAutomaticPunctuation
      });
    }
    
    // Retornar resultado
    return res.status(200).json({
      success: true,
      transcript: result.transcript,
      language: result.language,
      googleLanguageCode: result.googleLanguageCode,
      confidence: result.confidence,
      alternatives: result.alternatives,
      processingTime: result.processingTime,
      error: result.error || null
    });
    
  } catch (error) {
    logger.error('SPEECH_TO_TEXT_ERROR', {
      error: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.message,
      transcript: '',
      language: 'es',
      confidence: 0
    });
  }
};

