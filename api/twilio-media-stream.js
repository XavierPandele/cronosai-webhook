/**
 * Endpoint para Twilio Media Streams
 * Recibe audio en tiempo real y lo transcribe usando Google Cloud Speech-to-Text
 * 
 * IMPORTANTE: Este endpoint requiere WebSocket, que NO funciona en Vercel serverless.
 * Para usar este endpoint, necesitas desplegarlo en un servidor que soporte WebSocket
 * (como Railway, Render, o un servidor Node.js dedicado).
 * 
 * Para Vercel/serverless, usa el enfoque híbrido implementado en twilio-call-gemini.js
 * que mejora las transcripciones de Twilio con Google STT cuando está disponible.
 * 
 * Este endpoint usa WebSocket para recibir audio de Twilio Media Streams
 * y lo procesa con Google Cloud Speech-to-Text streaming para transcripción en tiempo real
 */

// NOTA: 'ws' no está instalado por defecto porque no funciona en Vercel
// Instalar solo si vas a usar un servidor dedicado: npm install ws
let WebSocket;
try {
  WebSocket = require('ws');
} catch (error) {
  console.warn('⚠️ [MEDIA_STREAM] WebSocket (ws) no está instalado. Este endpoint requiere un servidor con WebSocket.');
}

const { createStreamingRecognizer } = require('../lib/google-speech-streaming');
const logger = require('../lib/logging');

// Almacenar conexiones activas por CallSid
const activeStreams = new Map();

module.exports = async function handler(req, res) {
  // Verificar si WebSocket está disponible
  if (!WebSocket) {
    return res.status(503).json({ 
      error: 'Service Unavailable',
      message: 'Este endpoint requiere WebSocket, que no está disponible en Vercel serverless. Usa el enfoque híbrido en twilio-call-gemini.js en su lugar.',
      alternative: 'Usa el enfoque híbrido que mejora las transcripciones de Twilio con Google STT cuando está disponible.'
    });
  }

  // Twilio Media Streams requiere WebSocket
  // Verificar si es una actualización de WebSocket
  if (req.headers.upgrade === 'websocket') {
    // Manejar upgrade a WebSocket
    handleWebSocketUpgrade(req, res);
    return;
  }

  // Si no es WebSocket, retornar error
  res.status(426).json({ 
    error: 'Upgrade Required',
    message: 'Este endpoint requiere WebSocket connection. Para Vercel/serverless, usa el enfoque híbrido en twilio-call-gemini.js'
  });
};

/**
 * Maneja la conexión WebSocket de Twilio Media Streams
 */
function handleWebSocketUpgrade(req, res) {
  // Crear servidor WebSocket
  const wss = new WebSocket.Server({ noServer: true });
  
  wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
    handleTwilioMediaStream(ws);
  });
}

/**
 * Maneja el stream de audio de Twilio
 */
function handleTwilioMediaStream(ws) {
  let callSid = null;
  let streamingRecognizer = null;
  let audioBuffer = Buffer.alloc(0);
  let lastTranscriptTime = Date.now();
  let partialTranscript = '';
  let finalTranscript = '';
  
  logger.info('MEDIA_STREAM_CONNECTED', {
    timestamp: new Date().toISOString()
  });

  // Manejar mensajes de Twilio
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Twilio envía eventos de tipo 'connected', 'start', 'media', 'stop'
      switch (data.event) {
        case 'connected':
          logger.info('MEDIA_STREAM_CONNECTED_EVENT', {
            protocol: data.protocol,
            version: data.version
          });
          break;

        case 'start':
          callSid = data.start.callSid;
          logger.info('MEDIA_STREAM_START', {
            callSid,
            accountSid: data.start.accountSid,
            streamSid: data.start.streamSid
          });
          
          // Inicializar reconocedor de Google Speech-to-Text streaming
          streamingRecognizer = createStreamingRecognizer({
            callSid,
            onTranscript: (transcript, isFinal, language, confidence) => {
              handleTranscript(transcript, isFinal, language, confidence, callSid);
            },
            onError: (error) => {
              logger.error('MEDIA_STREAM_RECOGNITION_ERROR', {
                callSid,
                error: error.message
              });
            }
          });
          
          // Guardar stream activo
          activeStreams.set(callSid, {
            ws,
            recognizer: streamingRecognizer,
            startTime: Date.now()
          });
          break;

        case 'media':
          // Recibir chunk de audio
          if (data.media && data.media.payload) {
            // Decodificar audio base64
            const audioChunk = Buffer.from(data.media.payload, 'base64');
            
            // Enviar a Google Speech-to-Text streaming
            if (streamingRecognizer) {
              streamingRecognizer.write(audioChunk);
            }
          }
          break;

        case 'stop':
          logger.info('MEDIA_STREAM_STOP', {
            callSid,
            timestamp: data.timestamp
          });
          
          // Cerrar reconocedor
          if (streamingRecognizer) {
            streamingRecognizer.end();
            streamingRecognizer = null;
          }
          
          // Limpiar stream activo
          if (callSid) {
            activeStreams.delete(callSid);
          }
          
          // Enviar transcripción final si existe
          if (finalTranscript) {
            sendTranscriptToCallHandler(callSid, finalTranscript);
          }
          
          ws.close();
          break;
      }
    } catch (error) {
      logger.error('MEDIA_STREAM_MESSAGE_ERROR', {
        error: error.message,
        stack: error.stack
      });
    }
  });

  ws.on('error', (error) => {
    logger.error('MEDIA_STREAM_WS_ERROR', {
      error: error.message,
      callSid
    });
    
    // Limpiar recursos
    if (streamingRecognizer) {
      streamingRecognizer.end();
    }
    if (callSid) {
      activeStreams.delete(callSid);
    }
  });

  ws.on('close', () => {
    logger.info('MEDIA_STREAM_CLOSED', { callSid });
    
    // Limpiar recursos
    if (streamingRecognizer) {
      streamingRecognizer.end();
    }
    if (callSid) {
      activeStreams.delete(callSid);
    }
  });

  /**
   * Maneja transcripciones de Google Speech-to-Text
   */
  function handleTranscript(transcript, isFinal, language, confidence, callSid) {
    if (isFinal) {
      finalTranscript = transcript;
      lastTranscriptTime = Date.now();
      
      logger.info('MEDIA_STREAM_FINAL_TRANSCRIPT', {
        callSid,
        transcript: transcript.substring(0, 100),
        language,
        confidence: confidence.toFixed(2)
      });
      
      // Enviar transcripción final al handler de la llamada
      sendTranscriptToCallHandler(callSid, transcript, language, confidence);
    } else {
      partialTranscript = transcript;
      
      // Log solo cada 2 segundos para evitar spam
      const now = Date.now();
      if (now - lastTranscriptTime > 2000) {
        logger.info('MEDIA_STREAM_PARTIAL_TRANSCRIPT', {
          callSid,
          transcript: transcript.substring(0, 50),
          language
        });
        lastTranscriptTime = now;
      }
    }
  }
}

/**
 * Envía la transcripción al handler de la llamada
 * Esto actualiza el estado de la conversación con la transcripción de Google
 */
function sendTranscriptToCallHandler(callSid, transcript, language = 'es', confidence = 0) {
  // Obtener el estado de la conversación desde twilio-call-gemini
  // Nota: En producción, esto debería usar Redis o una base de datos compartida
  // Por ahora, usamos un mecanismo de eventos o almacenamiento compartido
  
  // Importar el módulo de estado (si existe)
  try {
    const { updateCallStateWithTranscript } = require('../lib/state-manager');
    updateCallStateWithTranscript(callSid, {
      transcript,
      language,
      confidence,
      source: 'google-stt',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.warn('MEDIA_STREAM_STATE_UPDATE_FAILED', {
      callSid,
      error: error.message
    });
  }
}

/**
 * Obtiene la transcripción actual para un CallSid
 */
function getCurrentTranscript(callSid) {
  const stream = activeStreams.get(callSid);
  if (stream && stream.recognizer) {
    return stream.recognizer.getCurrentTranscript();
  }
  return null;
}

module.exports.getCurrentTranscript = getCurrentTranscript;
module.exports.activeStreams = activeStreams;

