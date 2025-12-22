/**
 * Módulo de Google Cloud Speech-to-Text Streaming
 * Procesa audio en tiempo real usando streaming recognition
 */

const speech = require('@google-cloud/speech');
const { GoogleAuth } = require('google-auth-library');
const logger = require('./logging');

// Cliente de Speech-to-Text (singleton)
let speechClient = null;

/**
 * Inicializa el cliente de Google Cloud Speech-to-Text
 */
function initializeSpeechClient() {
  if (speechClient) {
    return speechClient;
  }

  try {
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    
    if (credentialsJson) {
      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;
      
      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      speechClient = new speech.SpeechClient({ auth });
      logger.info('GOOGLE_SPEECH_STREAMING_INIT', { method: 'credentials_json' });
    } else {
      speechClient = new speech.SpeechClient();
      logger.info('GOOGLE_SPEECH_STREAMING_INIT', { method: 'default_credentials' });
    }
    
    return speechClient;
  } catch (error) {
    logger.error('GOOGLE_SPEECH_STREAMING_INIT_FAILED', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Idiomas soportados para detección automática
 */
const SUPPORTED_LANGUAGES = [
  'es-ES', // Español (España) - PRIORIDAD 1
  'en-US', // Inglés (EE.UU.) - PRIORIDAD 2
  'de-DE', // Alemán - PRIORIDAD 3
  'fr-FR', // Francés
  'it-IT', // Italiano
  'pt-PT', // Portugués (Portugal)
];

/**
 * Mapeo de códigos de idioma de Google Cloud a códigos internos
 */
const LANGUAGE_CODE_MAP = {
  'es-ES': 'es',
  'en-US': 'en',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'it-IT': 'it',
  'pt-PT': 'pt',
};

/**
 * Frases contextuales para mejorar la precisión de reconocimiento
 */
const SPEECH_CONTEXT_PHRASES = {
  es: [
    'reservar mesa', 'hacer reserva', 'disponibilidad', 'cancelar reserva',
    'número de personas', 'fecha', 'hora', 'nombre', 'teléfono', 'confirmar',
    'gracias', 'adiós', 'hola', 'buenos días', 'buenas tardes', 'buenas noches',
    'para', 'personas', 'comensales', 'mesa', 'restaurante', 'reserva',
    'mañana', 'tarde', 'noche', 'hoy', 'pasado mañana'
  ],
  en: [
    'reserve table', 'make reservation', 'availability', 'cancel reservation',
    'number of people', 'date', 'time', 'name', 'phone', 'confirm',
    'thank you', 'goodbye', 'hello', 'good morning', 'good afternoon', 'good evening',
    'for', 'people', 'guests', 'table', 'restaurant', 'reservation',
    'morning', 'afternoon', 'evening', 'today', 'tomorrow', 'day after tomorrow'
  ],
  de: [
    'Tisch reservieren', 'Reservierung machen', 'Verfügbarkeit', 'Reservierung stornieren',
    'Anzahl der Personen', 'Datum', 'Uhrzeit', 'Name', 'Telefon', 'bestätigen',
    'danke', 'auf Wiedersehen', 'hallo', 'guten Morgen', 'guten Tag', 'guten Abend',
    'für', 'Personen', 'Gäste', 'Tisch', 'Restaurant', 'Reservierung',
    'Morgen', 'Nachmittag', 'Abend', 'heute', 'morgen', 'übermorgen'
  ],
  fr: [
    'réserver table', 'faire réservation', 'disponibilité', 'annuler réservation',
    'nombre de personnes', 'date', 'heure', 'nom', 'téléphone', 'confirmer',
    'merci', 'au revoir', 'bonjour', 'bon matin', 'bon après-midi', 'bonsoir',
    'pour', 'personnes', 'invités', 'table', 'restaurant', 'réservation',
    'matin', 'après-midi', 'soir', 'aujourd\'hui', 'demain', 'après-demain'
  ],
  it: [
    'prenotare tavolo', 'fare prenotazione', 'disponibilità', 'cancellare prenotazione',
    'numero di persone', 'data', 'ora', 'nome', 'telefono', 'confermare',
    'grazie', 'arrivederci', 'ciao', 'buongiorno', 'buon pomeriggio', 'buonasera',
    'per', 'persone', 'ospiti', 'tavolo', 'ristorante', 'prenotazione',
    'mattina', 'pomeriggio', 'sera', 'oggi', 'domani', 'dopodomani'
  ],
  pt: [
    'reservar mesa', 'fazer reserva', 'disponibilidade', 'cancelar reserva',
    'número de pessoas', 'data', 'hora', 'nome', 'telefone', 'confirmar',
    'obrigado', 'adeus', 'olá', 'bom dia', 'boa tarde', 'boa noite',
    'para', 'pessoas', 'convidados', 'mesa', 'restaurante', 'reserva',
    'manhã', 'tarde', 'noite', 'hoje', 'amanhã', 'depois de amanhã'
  ]
};

/**
 * Crea un reconocedor de streaming para procesar audio en tiempo real
 * 
 * @param {Object} options - Opciones de configuración
 * @param {string} options.callSid - CallSid de Twilio
 * @param {Function} options.onTranscript - Callback cuando hay transcripción (transcript, isFinal, language, confidence)
 * @param {Function} options.onError - Callback cuando hay error
 * @returns {Object} - Objeto con métodos write(), end(), getCurrentTranscript()
 */
function createStreamingRecognizer(options = {}) {
  const { callSid, onTranscript, onError } = options;
  
  const client = initializeSpeechClient();
  
  // Configuración para telefonía (MULAW, 8kHz)
  const request = {
    config: {
      encoding: 'MULAW', // Formato de audio de Twilio
      sampleRateHertz: 8000, // Frecuencia de muestreo para telefonía
      languageCode: 'es-ES', // Idioma principal
      alternativeLanguageCodes: ['en-US', 'de-DE', 'fr-FR', 'it-IT', 'pt-PT'],
      model: 'phone_call', // Modelo optimizado para telefonía
      useEnhanced: true,
      enableAutomaticPunctuation: true,
      enableSpokenPunctuation: false,
      enableSpokenEmojis: false,
      speechContexts: [
        {
          phrases: Object.values(SPEECH_CONTEXT_PHRASES).flat().slice(0, 500),
          boost: 20.0
        }
      ],
      audioChannelCount: 1,
      enableSeparateRecognitionPerChannel: false,
      // Configuración para streaming
      interimResults: true, // Obtener resultados parciales
      enableWordTimeOffsets: false, // No necesitamos timestamps de palabras
      enableWordConfidence: true // Obtener confianza por palabra
    },
    interimResults: true,
    singleUtterance: false // Permitir múltiples frases
  };

  // Crear stream de reconocimiento
  const recognizeStream = client
    .streamingRecognize(request)
    .on('error', (error) => {
      logger.error('GOOGLE_SPEECH_STREAMING_ERROR', {
        callSid,
        error: error.message,
        stack: error.stack
      });
      if (onError) {
        onError(error);
      }
    })
    .on('data', (data) => {
      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        const alternative = result.alternatives[0];
        
        if (alternative && alternative.transcript) {
          const transcript = alternative.transcript.trim();
          const isFinal = result.isFinalTranscript;
          const confidence = alternative.confidence || 0;
          
          // Detectar idioma (si está disponible)
          let language = 'es-ES';
          if (result.languageCode) {
            language = result.languageCode;
          }
          
          // Mapear a código interno
          const internalLanguage = LANGUAGE_CODE_MAP[language] || 'es';
          
          logger.info('GOOGLE_SPEECH_STREAMING_RESULT', {
            callSid,
            transcript: transcript.substring(0, 100),
            isFinal,
            language: internalLanguage,
            confidence: confidence.toFixed(2)
          });
          
          if (onTranscript) {
            onTranscript(transcript, isFinal, internalLanguage, confidence);
          }
        }
      }
    });

  // Estado interno
  let currentTranscript = '';
  let lastFinalTranscript = '';

  return {
    /**
     * Escribe un chunk de audio al stream
     */
    write: (audioChunk) => {
      if (recognizeStream && !recognizeStream.destroyed) {
        recognizeStream.write(audioChunk);
      }
    },

    /**
     * Finaliza el stream
     */
    end: () => {
      if (recognizeStream && !recognizeStream.destroyed) {
        recognizeStream.end();
      }
    },

    /**
     * Obtiene la transcripción actual
     */
    getCurrentTranscript: () => {
      return {
        partial: currentTranscript,
        final: lastFinalTranscript
      };
    },

    /**
     * Actualiza la transcripción actual (llamado desde el callback)
     */
    _updateTranscript: (transcript, isFinal) => {
      if (isFinal) {
        lastFinalTranscript = transcript;
        currentTranscript = '';
      } else {
        currentTranscript = transcript;
      }
    }
  };
}

module.exports = {
  createStreamingRecognizer,
  initializeSpeechClient,
  SUPPORTED_LANGUAGES,
  LANGUAGE_CODE_MAP
};

