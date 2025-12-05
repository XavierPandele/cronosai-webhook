/**
 * Módulo de Google Cloud Speech-to-Text con detección automática de idioma
 * Mejora la precisión de transcripción y detección multi-idioma
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
    // Intentar usar credenciales desde variable de entorno
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    
    if (credentialsJson) {
      // Parsear JSON de credenciales desde variable de entorno
      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;
      
      // Crear cliente con credenciales explícitas
      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      speechClient = new speech.SpeechClient({ auth });
      logger.info('GOOGLE_SPEECH_INIT', { method: 'credentials_json' });
    } else {
      // Usar credenciales por defecto (archivo o Application Default Credentials)
      speechClient = new speech.SpeechClient();
      logger.info('GOOGLE_SPEECH_INIT', { method: 'default_credentials' });
    }
    
    return speechClient;
  } catch (error) {
    logger.error('GOOGLE_SPEECH_INIT_FAILED', { 
      error: error.message,
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Idiomas soportados para detección automática
 */
// PRIORIDAD: Español, Inglés y Alemán son los idiomas principales
const SUPPORTED_LANGUAGES = [
  'es-ES', // Español (España) - PRIORIDAD 1
  'en-US', // Inglés (EE.UU.) - PRIORIDAD 2
  'de-DE', // Alemán - PRIORIDAD 3 (idioma principal de clientes)
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
 * Convierte código de idioma de Google Cloud a código interno
 */
function mapLanguageCode(googleLangCode) {
  return LANGUAGE_CODE_MAP[googleLangCode] || 'es';
}

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
 * Transcribe audio usando Google Cloud Speech-to-Text con detección automática de idioma
 * 
 * @param {Buffer|string} audioContent - Contenido de audio (Buffer o URL/base64)
 * @param {Object} options - Opciones de configuración
 * @param {string} options.encoding - Codificación de audio ('LINEAR16', 'MULAW', 'ALAW', 'WEBM_OPUS', etc.)
 * @param {number} options.sampleRateHertz - Frecuencia de muestreo (default: 8000 para telefonía)
 * @param {string[]} options.hints - Frases contextuales adicionales
 * @param {boolean} options.enableAutomaticPunctuation - Habilitar puntuación automática
 * @returns {Promise<Object>} - Objeto con transcript, language, confidence
 */
async function transcribeAudioWithLanguageDetection(audioContent, options = {}) {
  const startTime = Date.now();
  
  try {
    // Inicializar cliente si no está inicializado
    const client = initializeSpeechClient();
    
    // Configuración por defecto para telefonía
    const encoding = options.encoding || 'MULAW'; // MULAW es común en telefonía
    const sampleRateHertz = options.sampleRateHertz || 8000; // 8kHz es estándar para telefonía
    
    // Preparar contenido de audio
    let audio;
    if (Buffer.isBuffer(audioContent)) {
      audio = { content: audioContent };
    } else if (typeof audioContent === 'string') {
      // Si es una URL, necesitaríamos descargarla primero
      // Por ahora, asumimos que es base64 o contenido directo
      if (audioContent.startsWith('http://') || audioContent.startsWith('https://')) {
        throw new Error('URLs de audio no soportadas directamente. Descarga el audio primero.');
      }
      // Asumir que es base64
      audio = { content: Buffer.from(audioContent, 'base64') };
    } else {
      throw new Error('Formato de audio no soportado. Debe ser Buffer o string base64.');
    }
    
    // Obtener frases contextuales (combinar todas las lenguas para mejor detección)
    const allPhrases = [];
    Object.values(SPEECH_CONTEXT_PHRASES).forEach(phrases => {
      allPhrases.push(...phrases);
    });
    
    // Añadir hints personalizados si se proporcionan
    const hints = options.hints || [];
    const allHints = [...allPhrases, ...hints];
    
    // Configuración de reconocimiento con detección automática de idioma
    // PRIORIDAD: Español, Inglés y Alemán son los idiomas principales
    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRateHertz,
      languageCode: 'es-ES', // Idioma principal (fallback)
      // Priorizar es, en, de en los idiomas alternativos
      alternativeLanguageCodes: ['en-US', 'de-DE', 'fr-FR', 'it-IT', 'pt-PT'],
      model: 'phone_call', // Modelo optimizado para llamadas telefónicas
      useEnhanced: true, // Usar modelo mejorado
      enableAutomaticPunctuation: options.enableAutomaticPunctuation !== false,
      enableSpokenPunctuation: false,
      enableSpokenEmojis: false,
      speechContexts: [
        {
          phrases: allHints.slice(0, 500), // Google limita a 500 frases
          boost: 20.0 // Boost para palabras contextuales
        }
      ],
      // Configuración adicional para telefonía
      audioChannelCount: 1, // Mono (común en telefonía)
      enableSeparateRecognitionPerChannel: false
    };
    
    // Realizar reconocimiento
    const request = {
      config: config,
      audio: audio
    };
    
    logger.info('GOOGLE_SPEECH_RECOGNIZE_START', {
      encoding,
      sampleRateHertz,
      languages: SUPPORTED_LANGUAGES.length
    });
    
    const [response] = await client.recognize(request);
    
    const processingTime = Date.now() - startTime;
    
    // Procesar resultados
    if (!response.results || response.results.length === 0) {
      logger.warn('GOOGLE_SPEECH_NO_RESULTS', { processingTime });
      return {
        transcript: '',
        language: 'es',
        confidence: 0,
        alternatives: []
      };
    }
    
    // Obtener el mejor resultado
    const result = response.results[0];
    const alternative = result.alternatives[0];
    
    // Detectar idioma del resultado
    // Google Cloud Speech-to-Text puede devolver el idioma detectado en algunos casos
    // Si no está disponible, usar el idioma principal configurado
    let detectedLanguage = 'es-ES';
    if (result.languageCode) {
      detectedLanguage = result.languageCode;
    }
    
    const transcript = alternative.transcript || '';
    const confidence = alternative.confidence || 0;
    
    // Obtener alternativas si están disponibles
    const alternatives = result.alternatives.slice(1, 5).map(alt => ({
      transcript: alt.transcript || '',
      confidence: alt.confidence || 0
    }));
    
    // Mapear código de idioma a código interno
    const internalLanguageCode = mapLanguageCode(detectedLanguage);
    
    logger.info('GOOGLE_SPEECH_RECOGNIZE_SUCCESS', {
      transcript: transcript.substring(0, 100), // Primeros 100 caracteres
      language: internalLanguageCode,
      googleLanguageCode: detectedLanguage,
      confidence: confidence.toFixed(2),
      alternativesCount: alternatives.length,
      processingTime
    });
    
    return {
      transcript: transcript.trim(),
      language: internalLanguageCode,
      googleLanguageCode: detectedLanguage,
      confidence: confidence,
      alternatives: alternatives,
      processingTime
    };
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('GOOGLE_SPEECH_RECOGNIZE_FAILED', {
      error: error.message,
      stack: error.stack,
      processingTime
    });
    
    // Retornar resultado vacío en caso de error
    return {
      transcript: '',
      language: 'es',
      confidence: 0,
      alternatives: [],
      error: error.message
    };
  }
}

/**
 * Transcribe audio desde una URL (descarga primero y luego transcribe)
 * 
 * @param {string} audioUrl - URL del audio
 * @param {Object} options - Opciones de configuración
 * @returns {Promise<Object>} - Objeto con transcript, language, confidence
 */
async function transcribeAudioFromUrl(audioUrl, options = {}) {
  try {
    // Descargar audio desde URL
    const https = require('https');
    const http = require('http');
    
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(audioUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      client.get(audioUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Error descargando audio: ${response.statusCode}`));
          return;
        }
        
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', async () => {
          try {
            const audioBuffer = Buffer.concat(chunks);
            const result = await transcribeAudioWithLanguageDetection(audioBuffer, options);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  } catch (error) {
    logger.error('GOOGLE_SPEECH_URL_FAILED', { error: error.message });
    return {
      transcript: '',
      language: 'es',
      confidence: 0,
      alternatives: [],
      error: error.message
    };
  }
}

module.exports = {
  transcribeAudioWithLanguageDetection,
  transcribeAudioFromUrl,
  initializeSpeechClient,
  SUPPORTED_LANGUAGES,
  LANGUAGE_CODE_MAP,
  mapLanguageCode
};

