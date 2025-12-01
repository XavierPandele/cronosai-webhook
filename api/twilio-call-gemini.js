const { executeQuery, createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');
// Importar VertexAI - usar el paquete correcto para Generative AI
const { VertexAI } = require('@google-cloud/vertexai');
const { GoogleAuth } = require('google-auth-library');
const { getRestaurantConfig, getRestaurantHours } = require('../config/restaurant-config');
const { checkAvailability, getAlternativeTimeSlots, validateMaxPeoplePerReservation } = require('../lib/capacity');
const { validarReservaCompleta, validarDisponibilidad } = require('../lib/validation');
const logger = require('../lib/logging');
const { sendReservationConfirmationRcs, sendOrderConfirmationRcs } = require('../lib/rcs');
const { deleteCallState } = require('../lib/state-manager');

// NOTA: Circuit Breaker removido - causaba problemas en Vercel/serverless
// Se usa retryWithBackoff directamente que es más simple y confiable

// Estado de conversaciones por CallSid (en memoria - para producción usa Redis/DB)
const conversationStates = new Map();

// Sistema de debounce para evitar procesar webhooks duplicados muy cercanos
const lastWebhookTime = new Map(); // CallSid -> timestamp
const WEBHOOK_DEBOUNCE_MS = 100; // Ignorar webhooks duplicados dentro de 100ms

// ===== CONFIGURACIÓN GLOBAL DEL RESTAURANTE =====
// Variables globales para la configuración (se cargan al inicio)
let restaurantConfig = {
  maxPersonasMesa: 20,
  minPersonas: 1,
  horario1Inicio: null,
  horario1Fin: null,
  horario2Inicio: '13:00',
  horario2Fin: '15:00',
  horario3Inicio: '19:00',
  horario3Fin: '23:00',
  minAntelacionHoras: 2
};

// ===== CARTA DEL RESTAURANTE =====
let menuItemsCache = [];
let menuLoadedAt = 0;
const MENU_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function loadMenuItems(force = false) {
  const menuLoadStartTime = Date.now();
  const now = Date.now();
  if (!force && menuItemsCache.length > 0 && (now - menuLoadedAt) < MENU_CACHE_TTL_MS) {
    const cacheTime = Date.now() - menuLoadStartTime;
    // Cache hit - no log necesario
    return menuItemsCache;
  }

  try {
    const rows = await executeQuery(
      'SELECT id, nombre, precio, descripcion FROM menu ORDER BY nombre ASC'
    );
    menuItemsCache = rows.map(row => ({
      id: row.id,
      nombre: row.nombre,
      precio: Number.parseFloat(row.precio),
      descripcion: row.descripcion || ''
    }));
    menuLoadedAt = now;
    const loadTime = Date.now() - menuLoadStartTime;
    // Menu loaded - no log necesario
  } catch (error) {
    const errorTime = Date.now() - menuLoadStartTime;
    logger.error('MENU_LOAD_FAILED', { message: error.message, timeMs: errorTime });
    if (menuItemsCache.length === 0) {
      menuItemsCache = [];
    }
  }

  return menuItemsCache;
}

function formatMenuForPrompt(items = []) {
  if (!items.length) {
    return 'No hay elementos en el menú disponibles actualmente.';
  }

  return items
    .map(item => `- ID: ${item.id} | Nombre: ${item.nombre} | Precio: ${item.precio.toFixed(2)} | Descripción: ${item.descripcion}`)
    .join('\n');
}

// Cargar configuración del restaurante al inicio
let configLoaded = false;
async function loadRestaurantConfig() {
  const configLoadStartTime = Date.now();
  
  // OPTIMIZACIÓN: Usar cache en memoria si está disponible (misma instancia)
  // Pero siempre llamar a getRestaurantConfig() que tiene su propio cache interno (5min TTL)
  // Esto permite que funcione bien en serverless donde las instancias se reciclan
  if (configLoaded && restaurantConfig) {
    const cacheTime = Date.now() - configLoadStartTime;
    // Config cache hit - no log necesario
    // Aún así, verificar que el cache interno de getRestaurantConfig esté actualizado
    // (pero no esperar si ya tenemos config en memoria)
    return restaurantConfig;
  }
  
  try {
    // getRestaurantConfig() tiene cache interno de 5 minutos, así que es rápido si está cacheado
    const config = await getRestaurantConfig();
    
    // Asignar valores a las variables globales
    restaurantConfig = {
      maxPersonasMesa: config.maxPersonasMesa || 20,
      minPersonas: config.minPersonas || 1,
      horario1Inicio: config.horario1Inicio || null,
      horario1Fin: config.horario1Fin || null,
      horario2Inicio: config.horario2Inicio || '13:00',
      horario2Fin: config.horario2Fin || '15:00',
      horario3Inicio: config.horario3Inicio || '19:00',
      horario3Fin: config.horario3Fin || '23:00',
      minAntelacionHoras: config.minAntelacionHoras || 2,
      // Mantener referencia completa para uso futuro
      fullConfig: config
    };
    
    configLoaded = true;
    const loadTime = Date.now() - configLoadStartTime;
    
    // Solo loggear si tarda más de 50ms (indica carga desde BD, no cache)
    if (loadTime > 50) {
      // Config loaded - no log necesario
    } else {
      // Config cache hit - no log necesario
    }
    
    return restaurantConfig;
  } catch (error) {
    const errorTime = Date.now() - configLoadStartTime;
    logger.error('CONFIG_LOAD_FAILED', { message: error.message, stack: error.stack, timeMs: errorTime });
    configLoaded = true; // Marcar como cargada para no intentar infinitamente
    // Retornar valores por defecto si falla
    if (!restaurantConfig) {
      restaurantConfig = {
        maxPersonasMesa: 20,
        minPersonas: 1,
        horario1Inicio: null,
        horario1Fin: null,
        horario2Inicio: '13:00',
        horario2Fin: '15:00',
        horario3Inicio: '19:00',
        horario3Fin: '23:00',
        minAntelacionHoras: 2,
        fullConfig: {}
      };
    }
    return restaurantConfig;
  }
}

// ===== GEMINI 2.5 FLASH LITE - INICIALIZACIÓN CON VERTEX AI =====
// Configuración de Vertex AI
const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'cronosai-473114';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

let geminiClient = null;
function getGeminiClient() {
  if (!geminiClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        console.warn('⚠️ GOOGLE_APPLICATION_CREDENTIALS_JSON no configurado. Gemini no estará disponible.');
        logger.error('GEMINI_CREDENTIALS_MISSING', {
          reasoning: 'GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurado en las variables de entorno. Verificar .env o variables de entorno de Vercel.'
        });
        return null;
      }

      // MEJORADO: Parsing robusto del JSON con múltiples estrategias
      let credentials;
      if (typeof credentialsJson === 'object' && credentialsJson !== null) {
        // Ya es un objeto, usarlo directamente
        credentials = credentialsJson;
      } else if (typeof credentialsJson === 'string') {
        try {
          // Estrategia 1: Parse directo (caso más común)
          credentials = JSON.parse(credentialsJson);
        } catch (parseError) {
          // Estrategia 2: Intentar limpiar problemas comunes de formato
          try {
            let cleaned = credentialsJson.trim();
            
            // Limpiar comillas simples en keys y valores (excepto en private_key que puede tener \n)
            cleaned = cleaned
              .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3') // Keys con comillas simples
              .replace(/(:\s*)'([^']*)'(\s*[,}])/g, '$1"$2"$3'); // Valores con comillas simples
            
            // Asegurar que los \n en private_key estén correctamente escapados
            // Si hay \\n (doble escape), convertirlo a \n (escape simple)
            cleaned = cleaned.replace(/\\\\n/g, '\\n');
            
            credentials = JSON.parse(cleaned);
          } catch (cleanError) {
            // Estrategia 3: Intentar leer como ruta de archivo si parece una ruta
            const fs = require('fs');
            const path = require('path');
            if (fs.existsSync(credentialsJson)) {
              try {
                const fileContent = fs.readFileSync(credentialsJson, 'utf8');
                credentials = JSON.parse(fileContent);
              } catch (fileError) {
                throw new Error(`Error parseando JSON desde archivo ${credentialsJson}: ${fileError.message}`);
              }
            } else {
              // Estrategia 4: Intentar decodificar si está en base64 (algunos entornos lo codifican así)
              try {
                const base64Decoded = Buffer.from(credentialsJson, 'base64').toString('utf8');
                credentials = JSON.parse(base64Decoded);
              } catch (base64Error) {
                // Estrategia 5: Intentar parsear línea por línea si parece un JSON multilínea mal formateado
                try {
                  // Si el JSON tiene saltos de línea literales sin escapar, intentar arreglarlo
                  let multilineFixed = credentialsJson
                    .replace(/\n/g, '\\n')  // Escapar saltos de línea reales
                    .replace(/\r/g, '')     // Eliminar retornos de carro
                    .replace(/\\n\\n/g, '\\n'); // Normalizar dobles escapes
                  
                  credentials = JSON.parse(multilineFixed);
                } catch (multilineError) {
                  // Si nada funciona, lanzar error con información útil
                  const preview = credentialsJson.substring(0, 200);
                  const errorMsg = `Error parseando GOOGLE_APPLICATION_CREDENTIALS_JSON después de múltiples intentos. ` +
                    `Error original: ${parseError.message}. ` +
                    `Error limpieza: ${cleanError.message}. ` +
                    `Preview (primeros 200 chars): ${preview}... ` +
                    `Verifica que el JSON esté correctamente formateado. ` +
                    `En .env, el JSON debe estar en una sola línea con comillas dobles y \\n para saltos de línea.`;
                  throw new Error(errorMsg);
                }
              }
            }
          }
        }
      } else {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON tiene un formato inesperado');
      }

      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });

      geminiClient = new VertexAI({
        project: PROJECT_ID,
        location: LOCATION,
        googleAuthOptions: {
          credentials: credentials
        }
      });
      
      // Gemini client initialized - no log necesario
    } catch (error) {
      console.error('❌ [Gemini] Error inicializando cliente de Vertex AI:', error);
      logger.error('GEMINI_VERTEX_AI_INIT_ERROR', {
        error: error.message,
        stack: error.stack,
        reasoning: 'Error al inicializar cliente de Vertex AI. Verificar que GOOGLE_APPLICATION_CREDENTIALS_JSON sea válido y que Vertex AI API esté habilitada.'
      });
      return null;
    }
  }
  return geminiClient;
}

// ===== HELPER PARA CREAR MODELOS GEMINI =====
/**
 * Crea un modelo de Gemini con configuración optimizada
 * Elimina duplicación de código en múltiples funciones
 * @param {Object} options - Opciones de configuración del modelo
 * @param {string} options.model - Nombre del modelo (default: 'gemini-2.5-flash-lite')
 * @param {number} options.maxOutputTokens - Tokens máximos de salida
 * @param {number} options.temperature - Temperatura (0-1)
 * @param {number} options.topP - Top P sampling
 * @param {number} options.topK - Top K sampling
 * @param {Object} logger - Logger opcional
 * @returns {Object|null} Modelo de Gemini o null si no está disponible
 */
function createGeminiModel(options = {}, logger = null) {
  const {
    model = 'gemini-2.5-flash-lite',
    maxOutputTokens = 2048,
    temperature = 0.7,
    topP = 0.9,
    topK = 40
  } = options;

  const client = getGeminiClient();
  if (!client) {
    if (logger) {
      logger.warn('⚠️ GEMINI_CLIENT_NOT_AVAILABLE', {
        reasoning: 'Cliente de Vertex AI no disponible. Verificar GOOGLE_APPLICATION_CREDENTIALS_JSON.'
      });
    }
    return null;
  }

  const geminiModel = client.preview.getGenerativeModel({
    model: model,
    generationConfig: {
      maxOutputTokens: maxOutputTokens,
      temperature: temperature,
      topP: topP,
      topK: topK
    }
  });

  if (logger) {
    // Gemini model initialized - no log necesario
  }

  return geminiModel;
}

// ===== HELPER PARA FORMATEAR FECHAS/HORAS DE RESERVAS =====
/**
 * Formatea fecha y hora de una reserva para mostrar al usuario
 * Elimina duplicación de código en múltiples funciones
 * @param {string|Date} reservationDate - Fecha de la reserva (string o Date)
 * @param {string} language - Idioma para formateo (default: 'es')
 * @returns {Object} Objeto con formattedDate y formattedTime
 */
function formatReservationDateTime(reservationDate, language = 'es') {
  const date = reservationDate instanceof Date ? reservationDate : new Date(reservationDate);
  const dateString = date.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Formatear fecha según idioma
  let formattedDate;
  switch (language) {
    case 'en':
      formattedDate = formatDateEnglish(dateString);
      break;
    case 'de':
      formattedDate = formatDateGerman(dateString);
      break;
    case 'fr':
      formattedDate = formatDateFrench(dateString);
      break;
    case 'it':
      formattedDate = formatDateItalian(dateString);
      break;
    case 'pt':
      formattedDate = formatDatePortuguese(dateString);
      break;
    default:
      formattedDate = formatDateSpanish(dateString);
  }
  
  // Formatear hora según idioma
  const localeMap = {
    'es': 'es-ES',
    'en': 'en-US',
    'de': 'de-DE',
    'fr': 'fr-FR',
    'it': 'it-IT',
    'pt': 'pt-PT'
  };
  const locale = localeMap[language] || 'es-ES';
  
  const formattedTime = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit'
  });
  
  return { formattedDate, formattedTime, date, dateString };
}

// ===== HELPER PARA EXTRAER TEXTO DE RESPUESTA DE VERTEX AI =====
/**
 * Extrae el texto de la respuesta de Vertex AI (compatible con diferentes formatos)
 * @param {Object} result - Resultado de generateContent
 * @returns {string} Texto extraído de la respuesta
 */
function extractTextFromVertexAIResponse(result) {
  // Validar que result existe
  if (!result) {
    throw new Error('Result es null o undefined');
  }

  // Intentar diferentes formatos de respuesta de Vertex AI
  // 1. Formato de API estándar (compatibilidad) - result.response.text() como función
  if (result.response && typeof result.response.text === 'function') {
    try {
      const text = result.response.text();
      if (text && typeof text === 'string') {
        return text;
      }
    } catch (error) {
      // Continuar con otros formatos si falla
    }
  }
  
  // 2. Formato de Vertex AI estándar: result.response.candidates[0].content.parts[0].text
  if (result.response && result.response.candidates && Array.isArray(result.response.candidates) && result.response.candidates.length > 0) {
    const candidate = result.response.candidates[0];
    if (candidate && candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
      const text = candidate.content.parts[0].text;
      if (text && typeof text === 'string') {
        return text;
      }
    }
  }
  
  // 3. Formato alternativo: result.candidates[0].content.parts[0].text
  if (result.candidates && Array.isArray(result.candidates) && result.candidates.length > 0) {
    const candidate = result.candidates[0];
    if (candidate && candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts) && candidate.content.parts.length > 0) {
      const text = candidate.content.parts[0].text;
      if (text && typeof text === 'string') {
        return text;
      }
    }
  }
  
  // 4. Si response.text es un string directamente
  if (result.response && result.response.text) {
    const text = typeof result.response.text === 'string' ? result.response.text : String(result.response.text);
    if (text && text.trim().length > 0) {
      return text;
    }
  }
  
  // 5. Último intento: buscar texto en la respuesta usando regex (más flexible)
  try {
    const responseStr = JSON.stringify(result);
    // Buscar texto con regex más flexible que maneja escapes y múltiples formatos
    const textMatch = responseStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (textMatch && textMatch[1]) {
      // Decodificar escapes JSON
      return JSON.parse(`"${textMatch[1]}"`);
    }
  } catch (error) {
    // Ignorar errores de parsing en último intento
  }
  
  // Si nada funciona, lanzar error con información útil
  const resultPreview = JSON.stringify(result).substring(0, 500);
  throw new Error(`No se pudo extraer el texto de la respuesta de Vertex AI. Estructura: ${resultPreview}`);
}

// ===== FUNCIONES DE RESILIENCIA MEJORADAS =====

/**
 * Helper para sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry con Exponential Backoff Inteligente
 * Mejora sobre el retry básico: añade jitter y mejor manejo de errores
 */
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    factor = 2,
    jitter = true,
    retryableErrors = ['429', '503', 'timeout', 'ECONNRESET', 'ETIMEDOUT', 'overloaded', 'Resource exhausted']
  } = options;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      // Si es el último intento, lanzar el error
      if (i === maxRetries - 1) {
        throw error;
      }
      
      // Verificar si el error es recuperable
      const errorMessage = error.message || String(error);
      const isRetryable = retryableErrors.some(err => 
        errorMessage.includes(err)
      );
      
      if (!isRetryable) {
        // Error no recuperable, no reintentar
        throw error;
      }
      
      // Calcular delay con exponential backoff
      const baseDelay = initialDelay * Math.pow(factor, i);
      const delay = Math.min(baseDelay, maxDelay);
      
      // Añadir jitter para evitar "thundering herd"
      const jitterAmount = jitter ? Math.random() * 1000 : 0;
      const totalDelay = delay + jitterAmount;
      
      // Log del retry (solo si hay logger disponible)
      if (options.logger) {
        options.logger.warn('RETRY_WITH_BACKOFF', {
          attempt: i + 1,
          maxRetries,
          delayMs: Math.round(totalDelay),
          error: errorMessage.substring(0, 100)
        });
      }
      
      await sleep(totalDelay);
    }
  }
}

/**
 * Fallback básico basado en reglas cuando Gemini no está disponible
 * Intenta extraer información básica usando expresiones regulares
 */
function useRuleBasedFallback(userInput, context = {}) {
  const lowerInput = userInput.toLowerCase().trim();
  const step = context.step || 'greeting';
  
  // Detección básica de intención
  if (/reserv|mesa|reservar/i.test(lowerInput)) {
    return {
      intencion: 'reservation',
      comensales: null,
      fecha: null,
      hora: null,
      nombre: null,
      idioma_detectado: 'es'
    };
  }
  
  if (/cancel|anular/i.test(lowerInput)) {
    return {
      intencion: 'cancel',
      idioma_detectado: 'es'
    };
  }
  
  if (/modificar|cambiar|editar/i.test(lowerInput)) {
    return {
      intencion: 'modify',
      idioma_detectado: 'es'
    };
  }
  
  if (/pedido|domicilio|comida/i.test(lowerInput)) {
    return {
      intencion: 'order',
      idioma_detectado: 'es'
    };
  }
  
  // Extracción básica de números (personas)
  const peopleMatch = lowerInput.match(/(\d+)\s*(persona|personas|gente|comensales)/i);
  if (peopleMatch && step === 'ask_people') {
    return {
      intencion: 'reservation',
      comensales: parseInt(peopleMatch[1]),
      idioma_detectado: 'es'
    };
  }
  
  // Fallback genérico
  return {
    intencion: 'clarify',
    idioma_detectado: 'es'
  };
}

// ===== CIRCUIT BREAKER REMOVIDO =====
// El Circuit Breaker fue removido porque:
// 1. No se ejecutaba correctamente en Vercel/serverless
// 2. Añadía complejidad innecesaria
// 3. El retryWithBackoff ya maneja bien los errores temporales
// 4. El fallback basado en reglas se maneja en el nivel superior cuando Gemini falla completamente

// ===== FUNCIÓN DE RETRY PARA LLAMADAS A GEMINI =====
/**
 * Llama a Gemini con retry automático para manejar rate limiting (429) y otros errores temporales
 * Usa Exponential Backoff Inteligente con jitter
 * @param {Object} model - Modelo de Gemini
 * @param {string} prompt - Prompt a enviar
 * @param {number} retries - Número máximo de reintentos (default: 3)
 * @param {Object} logger - Logger opcional para registrar intentos
 * @param {Object} context - Contexto adicional (no usado actualmente, mantenido para compatibilidad)
 * @returns {Promise<Object>} Resultado de generateContent
 */
async function callGeminiWithRetry(model, prompt, retries = 3, logger = null, context = {}) {
  const GEMINI_TIMEOUT_MS = 8000;
  
  try {
    return await retryWithBackoff(
      async () => {
        const generatePromise = model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.7
          }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Gemini API timeout')), GEMINI_TIMEOUT_MS)
        );
        
        return await Promise.race([generatePromise, timeoutPromise]);
      },
      {
        maxRetries: retries,
        initialDelay: 1000,
        maxDelay: 10000,
        factor: 2,
        jitter: true,
        retryableErrors: ['429', '503', 'timeout', 'ECONNRESET', 'ETIMEDOUT', 'overloaded', 'Resource exhausted'],
        logger: logger
      }
    );
  } catch (error) {
    // Si todos los reintentos fallan, loggear el error
    if (logger) {
      logger.warn('GEMINI_ALL_RETRIES_FAILED', {
        error: error.message,
        reasoning: 'Todos los reintentos fallaron. El código que llama debe manejar el error.'
      });
    }
    
    // Lanzar el error para que el código que llama pueda manejarlo
    throw error;
  }
}

// ===== CACHE DE ANÁLISIS DE GEMINI =====
// Cache en memoria para análisis recientes (30 segundos TTL)
const geminiAnalysisCache = new Map();
const GEMINI_CACHE_TTL_MS = 30000; // 30 segundos
const GEMINI_CACHE_MAX_SIZE = 100;

function cleanGeminiCache() {
  if (geminiAnalysisCache.size <= GEMINI_CACHE_MAX_SIZE) {
    return;
  }
  const now = Date.now();
  for (const [key, value] of geminiAnalysisCache.entries()) {
    if (now - value.timestamp > GEMINI_CACHE_TTL_MS) {
      geminiAnalysisCache.delete(key);
    }
  }
}

// ===== CACHE DE DISPONIBILIDAD =====
// Cache en memoria para disponibilidad (5 minutos TTL)
const availabilityCache = new Map();
const AVAILABILITY_CACHE_TTL_MS = 300000; // 5 minutos
const AVAILABILITY_CACHE_MAX_SIZE = 50;

function cleanAvailabilityCache() {
  if (availabilityCache.size <= AVAILABILITY_CACHE_MAX_SIZE) {
    return;
  }
  const now = Date.now();
  for (const [key, value] of availabilityCache.entries()) {
    if (now - value.timestamp > AVAILABILITY_CACHE_TTL_MS) {
      availabilityCache.delete(key);
    }
  }
}

// Wrapper para cachear validación de disponibilidad
async function validarDisponibilidadCached(fechaHora, numPersonas, performanceMetrics = null) {
  const availabilityStartTime = Date.now();
  const cacheKey = `${fechaHora}:${numPersonas}`;
  const cached = availabilityCache.get(cacheKey);
  
  logger.capacity('🔍 AVAILABILITY_CHECK_START', {
    fechaHora: fechaHora,
    numPersonas: numPersonas,
    cacheKey: cacheKey,
    reasoning: `Iniciando verificación de disponibilidad para ${numPersonas} personas el ${fechaHora}`
  });
  
  if (cached && (Date.now() - cached.timestamp) < AVAILABILITY_CACHE_TTL_MS) {
    const cacheTime = Date.now() - availabilityStartTime;
    const cacheAge = Date.now() - cached.timestamp;
    
    logger.capacity('✅ AVAILABILITY_CACHE_HIT', { 
      cacheKey, 
      cacheTimeMs: cacheTime,
      cacheAgeMs: cacheAge,
      cachedResult: cached.result,
      reasoning: `Resultado encontrado en cache (edad: ${Math.round(cacheAge/1000)}s). Disponible: ${cached.result.disponible}`
    });
    
    if (performanceMetrics) {
      performanceMetrics.availabilityTime = cacheTime;
    }
    return cached.result;
  }
  
  logger.capacity('🔄 AVAILABILITY_CHECKING_DB', {
    fechaHora: fechaHora,
    numPersonas: numPersonas,
    reasoning: 'No hay resultado en cache. Consultando base de datos para verificar disponibilidad...'
  });
  
  const result = await validarDisponibilidad(fechaHora, numPersonas);
  const availabilityTime = Date.now() - availabilityStartTime;
  
  logger.capacity('✅ AVAILABILITY_CHECKED', { 
    fechaHora: fechaHora, 
    numPersonas: numPersonas,
    disponible: result.disponible,
    capacidadDisponible: result.capacidadDisponible || null,
    capacidadTotal: result.capacidadTotal || null,
    reservasExistentes: result.reservasExistentes || null,
    timeMs: availabilityTime,
    reasoning: `Verificación completada en ${availabilityTime}ms. Disponible: ${result.disponible}. ` +
               `${result.disponible ? `Capacidad disponible: ${result.capacidadDisponible || 'N/A'}` : 'No hay disponibilidad para esta fecha/hora.'}`
  });
  
  if (performanceMetrics) {
    performanceMetrics.availabilityTime = availabilityTime;
  }
  
  availabilityCache.set(cacheKey, {
    result,
    timestamp: Date.now()
  });
  
  // Availability cached - no log necesario
  
  cleanAvailabilityCache();
  
  return result;
}

// ===== FUNCIÓN: Obtener horario del restaurante =====
// Ahora se usa getRestaurantHours() desde config/restaurant-config.js

// ===== FUNCIONES AUXILIARES PARA FECHAS =====
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getDayAfterTomorrowDate() {
  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  return dayAfter.toISOString().split('T')[0];
}

module.exports = async function handler(req, res) {
  // Siempre establecer headers primero
  res.setHeader('Content-Type', 'text/xml');
  
  // PERFORMANCE: Marcar tiempo de inicio de la request
  const requestStartTime = Date.now();
  const performanceMetrics = {
    requestStart: requestStartTime,
    geminiTime: 0,
    stateSaveTime: 0,
    availabilityTime: 0,
    configLoadTime: 0,
    menuLoadTime: 0,
    dbTime: 0,
    totalTime: 0
  };
  
  // Extraer CallSid de forma segura ANTES del try para que esté disponible en el catch
  let CallSid = null;
  try {
    // Intentar extraer CallSid de req.body o req.query
    if (req.body) {
      if (typeof req.body === 'string') {
        const querystring = require('querystring');
        const parsed = querystring.parse(req.body);
        CallSid = parsed.CallSid;
      } else if (typeof req.body === 'object' && req.body.CallSid) {
        CallSid = req.body.CallSid;
      }
    }
    if (!CallSid && req.query && req.query.CallSid) {
      CallSid = req.query.CallSid;
    }
  } catch (e) {
    // Si falla la extracción, CallSid seguirá siendo null
  }
  
  // OPTIMIZACIÓN: Cargar configuración (el cache interno de getRestaurantConfig maneja TTL de 5min)
  // No dependemos de configLoaded en memoria porque en serverless se pierde entre instancias
  const configStartTime = Date.now();
  await loadRestaurantConfig();
  const configLoadTime = Date.now() - configStartTime;
  performanceMetrics.configLoadTime = configLoadTime;
  // Log solo si tarda más de 50ms (indica que no fue cache hit)
  // Config loaded - no log necesario
  
  // Log eliminado - información redundante

  try {
    // Extraer parámetros de Twilio
    // Manejar todos los casos: body parseado, body string, o query string
    let params = {};
    
    if (req.body) {
      // Si req.body es un string, parsearlo manualmente (Vercel a veces no parsea application/x-www-form-urlencoded)
      if (typeof req.body === 'string') {
        const querystring = require('querystring');
        params = querystring.parse(req.body);
      } else if (typeof req.body === 'object') {
        // Si ya es un objeto, usarlo directamente
        params = req.body;
      }
    } else if (req.query) {
      // Si no hay body, usar query (para GET requests)
      params = req.query;
    }
    
    // Si CallSid no se extrajo antes, intentar extraerlo de params
    if (!CallSid) {
      CallSid = params?.CallSid;
    }
    
    const { 
      SpeechResult, 
      Digits,
      From,
      To,
      CallStatus 
    } = params || {};
    
    // Si no hay CallSid, generar respuesta de saludo inicial
    if (!CallSid) {
      const greetingMessage = '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?';
      const twiml = generateTwiML({
        message: greetingMessage,
        gather: true
      }, 'es', null, null, 'greeting');
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(twiml);
    }

    // Obtener o crear estado de conversación
    const callLogger = logger.withContext({
      callSid: CallSid,
      direction: params?.Direction,
      from: From,
      to: To,
      accountSid: params?.AccountSid
    });
    // CRÍTICO: Filtrar webhooks vacíos ANTES de cargar estado para evitar procesamiento innecesario
    let userInput = SpeechResult || Digits || '';
    const isProcessing = req.query && req.query.process === 'true';
    const isCallEnding = CallStatus && CallStatus !== 'in-progress';
    const hasValidInput = userInput && userInput.trim().length >= 2;
    
    // Log consolidado solo para webhooks con input válido o eventos importantes
    if (hasValidInput || isCallEnding || isProcessing) {
      // Este log se completará más abajo con toda la información
    }
    
    // Debounce: Ignorar webhooks duplicados muy cercanos en el tiempo
    const now = Date.now();
    const lastTime = lastWebhookTime.get(CallSid);
    if (lastTime && (now - lastTime) < WEBHOOK_DEBOUNCE_MS && !hasValidInput && !isProcessing) {
      // No loggear webhooks duplicados vacíos (solo ruido)
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    lastWebhookTime.set(CallSid, now);
    
    // Si no hay input válido, no es procesamiento, y la llamada sigue activa, ignorar inmediatamente
    if (!hasValidInput && !isProcessing && !isCallEnding) {
      // No loggear webhooks vacíos (solo ruido)
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    // OPTIMIZACIÓN: Usar solo memoria para el estado durante la conversación
    // NO usamos BD durante la conversación para evitar timeouts y problemas de conexión
    // El estado se construye en memoria y solo se persiste cuando la reserva está completa
    let state = conversationStates.get(CallSid);
    
    // Log para diagnosticar pérdidas de estado
    if (state) {
      log.debug('STATE_LOADED_FROM_MEMORY', {
        callSid: CallSid.substring(0, 20),
        step: state.step,
        hasData: !!state.data && Object.keys(state.data).length > 0,
        dataKeys: state.data ? Object.keys(state.data) : [],
        historyLength: state.conversationHistory?.length || 0
      });
    } else {
      log.warn('STATE_NOT_FOUND_IN_MEMORY', {
        callSid: CallSid.substring(0, 20),
        reasoning: 'Estado no encontrado en memoria. Creando nuevo estado. Esto puede indicar pérdida de estado en serverless.'
      });
    }
    
    // Si no hay estado en memoria, crear uno nuevo
    if (!state) {
      state = {
        step: 'greeting',
        data: {},
        phone: From,
        conversationHistory: [],
        language: 'es'
      };
    }

    // Asegurar datos críticos en el estado
    state.callSid = CallSid;
    if (!state.phone && From) {
      state.phone = From;
    }
    if (!state.language) {
      state.language = 'es';
    }
    
    // Asegurar que state.data existe y es un objeto
    if (!state.data || typeof state.data !== 'object') {
      state.data = {};
    }
    
    callLogger.update({
      phone: state.phone,
      language: state.language,
      step: state.step
    });

    // userInput ya está definido arriba (antes de cargar estado)
    
    // PROTECCIÓN: Límite de longitud de input para prevenir timeouts y sobrecarga
    const MAX_INPUT_LENGTH = 10000;
    if (userInput && userInput.length > MAX_INPUT_LENGTH) {
      userInput = userInput.substring(0, MAX_INPUT_LENGTH);
    }
    
    // isProcessing, isCallEnding, hasValidInput ya están definidos arriba
    // Verificación adicional: si no hay input válido después de cargar estado, ignorar
    if (!hasValidInput && !isProcessing && !isCallEnding) {
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
    
    // Validación adicional: ignorar resultados muy cortos o que parezcan ruido
    // Esto ayuda especialmente con ruido de fondo, música, o habla muy corta
    const isValidInput = userInput && 
                        userInput.trim().length >= 2 && // Mínimo 2 caracteres
                        !/^(ah|eh|oh|um|uh|mm|hm|eh|ah|eh)$/i.test(userInput.trim()); // Filtrar sonidos no verbales
    
    if (!isValidInput && userInput && !isProcessing) {
      // Si el input no es válido, mantener el estado actual y pedir que repita
      // Obtener baseUrl para generar TwiML
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
      const baseUrl = `${protocol}://${host}`;
      
      const unclearMessages = {
        es: ['Disculpe, no entendí bien. ¿Podría repetir?', 'No escuché claramente. ¿Puede repetir?', 'No entendí. ¿Podría decir eso de nuevo?'],
        en: ['Sorry, I didn\'t understand well. Could you repeat?', 'I didn\'t hear clearly. Can you repeat?', 'I didn\'t understand. Could you say that again?'],
        de: ['Entschuldigung, ich habe nicht gut verstanden. Könnten Sie wiederholen?', 'Ich habe nicht klar gehört. Können Sie wiederholen?', 'Ich habe nicht verstanden. Könnten Sie das noch einmal sagen?'],
        it: ['Scusa, non ho capito bene. Potresti ripetere?', 'Non ho sentito chiaramente. Puoi ripetere?', 'Non ho capito. Potresti dirlo di nuovo?'],
        fr: ['Désolé, je n\'ai pas bien compris. Pourriez-vous répéter?', 'Je n\'ai pas entendu clairement. Pouvez-vous répéter?', 'Je n\'ai pas compris. Pourriez-vous le redire?'],
        pt: ['Desculpe, não entendi bem. Você poderia repetir?', 'Não ouvi claramente. Você pode repetir?', 'Não entendi. Você poderia dizer isso novamente?']
      };
      const messages = unclearMessages[state.language] || unclearMessages.es;
      const twiml = generateTwiML({
        message: getRandomMessage(messages),
        gather: true
      }, state.language, null, baseUrl, state.step);
      res.setHeader('Content-Type', 'text/xml');
      return res.status(200).send(twiml);
    }

    // OPTIMIZACIÓN: Guardar mensaje del usuario en memoria inmediatamente (no esperar BD)
    if (isValidInput && userInput && userInput.trim() && !isProcessing) {
      const lastEntry = state.conversationHistory[state.conversationHistory.length - 1];
      if (!lastEntry || lastEntry.role !== 'user' || lastEntry.message !== userInput) {
        state.conversationHistory.push({
          role: 'user',
          message: userInput,
          timestamp: new Date().toISOString()
        });
        conversationStates.set(CallSid, state);
        // No guardar en BD aquí - solo en memoria para velocidad
      }
    }
    
    // Si estamos procesando, obtener el último mensaje del usuario del historial si no hay userInput
    if (isProcessing && (!userInput || !userInput.trim())) {
      const lastUserEntry = state.conversationHistory
        .slice()
        .reverse()
        .find(entry => entry.role === 'user');
      if (lastUserEntry) {
        userInput = lastUserEntry.message;
      }
    }

    // Procesar según el paso actual
    const previousStep = state.step;
    const dataSummary = state.data ? `${state.data.NumeroReserva || '-'}p, ${state.data.FechaReserva || '-'}, ${state.data.HoraReserva || '-'}, ${state.data.NomReserva || '-'}` : 'empty';
    
    // PERFORMANCE: Pasar métricas al proceso de conversación
    const processStepStartTime = Date.now();
    let response;
    try {
      response = await processConversationStep(state, userInput, callLogger, performanceMetrics, isProcessing);
    } catch (stepError) {
      // Log consolidado de error con toda la información
      const errorInput = userInput ? (userInput.length > 50 ? userInput.substring(0, 50) + '...' : userInput) : 'empty';
      callLogger.error('REQUEST_ERROR', {
        input: errorInput,
        step: state.step,
        previousStep,
        data: dataSummary,
        error: stepError.message,
        errorName: stepError.name,
        stack: stepError.stack?.substring(0, 300)
      });
      throw stepError;
    }
    const processStepTime = Date.now() - processStepStartTime;
    performanceMetrics.processStepTime = processStepTime;
    
    // LOG CONSOLIDADO: Toda la información importante en un solo log
    if (hasValidInput || isCallEnding || isProcessing) {
      const responsePreview = response.message ? (response.message.length > 60 ? response.message.substring(0, 60) + '...' : response.message) : 'null';
      const logData = {
        input: userInput ? (userInput.length > 50 ? userInput.substring(0, 50) + '...' : userInput) : 'empty',
        step: state.step,
        previousStep: previousStep !== state.step ? previousStep : null,
        data: dataSummary,
        response: responsePreview,
        timeMs: processStepTime,
        geminiMs: performanceMetrics.geminiTime || 0,
        dbMs: performanceMetrics.stateSaveTime || 0
      };
      
      callLogger.info('REQUEST', logData);
      if (previousStep !== state.step) {
        callLogger.update({ step: state.step });
      }
    }
    
    // Guardar el mensaje del bot
    state.conversationHistory.push({
      role: 'bot',
      message: response.message,
      timestamp: new Date().toISOString()
    });

    // OPTIMIZACIÓN: Actualizar estado en memoria únicamente
    // NO guardamos en BD durante la conversación para evitar timeouts y problemas de conexión
    // El estado se construye en memoria y solo se persiste cuando la reserva está completa
    conversationStates.set(CallSid, state);

    // Si la conversación está completa, guardar en BD
    if (state.step === 'complete') {
      const saveReservationStartTime = Date.now();
      const saved = await saveReservation(state, performanceMetrics);
      performanceMetrics.saveReservationTime = Date.now() - saveReservationStartTime;
      
      // Si no se pudo guardar por falta de disponibilidad, manejar el error
      if (!saved && state.availabilityError) {
        
        // Obtener alternativas si no las tenemos
        if (!state.availabilityError.alternativas || state.availabilityError.alternativas.length === 0) {
          const dataCombinada = combinarFechaHora(state.data.FechaReserva, state.data.HoraReserva);
          const alternativas = await getAlternativeTimeSlots(dataCombinada, state.data.NumeroReserva, 3);
          state.availabilityError.alternativas = alternativas.map(alt => alt.fechaHora);
        }
        
        // Generar mensaje de no disponibilidad con alternativas
        const noAvailabilityMessages = getMultilingualMessages('no_availability', state.language);
        let message = getRandomMessage(noAvailabilityMessages);
        
        // Si hay alternativas, sugerir la primera
        if (state.availabilityError.alternativas && state.availabilityError.alternativas.length > 0) {
          const altFechaHora = state.availabilityError.alternativas[0];
          const altFecha = new Date(altFechaHora);
          const altHora = `${String(altFecha.getHours()).padStart(2, '0')}:${String(altFecha.getMinutes()).padStart(2, '0')}`;
          
          const suggestMessages = getMultilingualMessages('suggest_alternative', state.language);
          const suggestMessage = getRandomMessage(suggestMessages).replace('{time}', altHora);
          message += ` ${suggestMessage}`;
          
          // Guardar alternativa sugerida en el estado
          state.suggestedAlternative = altFechaHora;
        }
        
        // Volver al paso de confirmación para que el usuario pueda aceptar alternativa
        state.step = 'confirm';
        state.data.originalFechaHora = combinarFechaHora(state.data.FechaReserva, state.data.HoraReserva);
        conversationStates.set(CallSid, state);
        // No guardar en BD aquí - solo en memoria para velocidad en tiempo real
        
        // Obtener URL base para generar URLs públicas de audio TTS
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
        const baseUrl = `${protocol}://${host}`;
        const twiml = generateTwiML({ message, gather: true }, state.language, null, baseUrl, state.step);
        res.setHeader('Content-Type', 'text/xml');
        return res.status(200).send(twiml);
      }
      
      // Limpiar el estado después de guardar
      conversationStates.delete(CallSid);
      await deleteCallState(CallSid);
      // Reservation completed - no log necesario

      await sendReservationConfirmationRcs({
        phone: state.data.TelefonReserva || state.phone,
        name: state.data.NomReserva,
        date: state.data.FechaReserva,
        time: state.data.HoraReserva,
        people: state.data.NumeroReserva,
        language: state.language || 'es'
      }, callLogger);
    } else if (state.step === 'order_complete') {
      conversationStates.delete(CallSid);
      await deleteCallState(CallSid);
      // Order completed - no log necesario
    }

    // Obtener URL base para generar URLs públicas de audio TTS
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || process.env.VERCEL_URL || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;
    
    // Generar TwiML response (pasar step actual para evitar interjecciones en greeting)
    const twiml = generateTwiML(response, state.language, null, baseUrl, state.step);
    
    // PERFORMANCE: Calcular tiempo total y loggear métricas (compacto)
    performanceMetrics.totalTime = Date.now() - requestStartTime;
    
    const perf = performanceMetrics;
    // Log consolidado final con todas las métricas y estado final
    const finalDataSummary = state.data ? `${state.data.NumeroReserva || '-'}p, ${state.data.FechaReserva || '-'}, ${state.data.HoraReserva || '-'}, ${state.data.NomReserva || '-'}` : 'empty';
    callLogger.info('REQUEST_COMPLETE', {
      step: state.step,
      data: finalDataSummary,
      totalMs: perf.totalTime,
      geminiMs: perf.geminiTime || 0,
      stepMs: perf.processStepTime || 0,
      dbMs: perf.dbTime || 0,
      configMs: perf.configLoadTime || 0,
      reservationSaved: state.step === 'complete' ? true : false
    });
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twiml);

  } catch (error) {
    // PERFORMANCE: Loggear tiempo total incluso en caso de error
    const errorTotalTime = Date.now() - requestStartTime;
    
    // LOGGING CRÍTICO: Loggear TODA la información del error para debugging (compacto)
    // Intentar extraer userInput si está disponible
    let userInputPreview = 'N/A';
    try {
      if (req.body) {
        const params = typeof req.body === 'string' ? require('querystring').parse(req.body) : req.body;
        userInputPreview = (params.SpeechResult || params.Digits || '').substring(0, 200);
      }
    } catch (e) {
      // Ignorar errores al extraer userInput
    }
    
    // Log compacto de error crítico
    const criticalErrorLog = {
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: 'CRITICAL_HANDLER_ERROR',
      totalTimeMs: errorTotalTime,
      callSid: CallSid || 'unknown',
      errorName: error.name || 'UnknownError',
      errorMessage: error.message,
      method: req.method,
      url: req.url,
      bodyType: typeof req.body,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body).join(',') : 'N/A',
      queryKeys: req.query ? Object.keys(req.query).join(',') : 'N/A',
      userInput: userInputPreview,
      stack: error.stack?.substring(0, 500)
    };
    console.error(JSON.stringify(criticalErrorLog));
    
    const errorContext = {
      message: error.message,
      stack: error.stack,
      name: error.name,
      totalTimeMs: errorTotalTime,
      callSid: CallSid || 'unknown',
      method: req.method,
      url: req.url,
      hasBody: Boolean(req.body),
      bodyType: typeof req.body,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
      queryKeys: req.query ? Object.keys(req.query) : [],
      userInputPreview,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        host: req.headers.host
      }
    };
    
    // Intentar extraer más información del error si está disponible
    if (error.code) errorContext.code = error.code;
    if (error.status) errorContext.status = error.status;
    if (error.statusCode) errorContext.statusCode = error.statusCode;
    if (error.response) {
      errorContext.responseStatus = error.response.status;
      errorContext.responseData = typeof error.response.data === 'string' 
        ? error.response.data.substring(0, 500) 
        : error.response.data;
    }
    
    // Loggear con logger estructurado (ya está en formato compacto)
    logger.error('TWILIO_CALL_HANDLER_ERROR', errorContext);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.es-ES-Neural2-B" language="es-ES">
    Disculpe, hubo un error técnico. Por favor, intente de nuevo más tarde o contacte directamente al restaurante.
  </Say>
  <Hangup/>
</Response>`;
    
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(errorTwiml);
  }
}

// ===== GEMINI 2.5 FLASH LITE - ANÁLISIS INTELIGENTE DE RESERVA =====

/**
 * Analiza una frase del usuario para extraer TODA la información de reserva posible
 * Usa Gemini 2.5 Flash Lite para extraer: comensales, fecha, hora, intolerancias, movilidad, nombre
 * Versión 2.5 Flash Lite: Más rápida (1.2s) que 2.5-flash (12.4s) manteniendo la misma calidad (108.3%) y estabilidad (100% éxito).
 * Ideal para producción: velocidad + precisión + estabilidad.
 */
async function analyzeReservationWithGemini(userInput, context = {}) {
  // PROTECCIÓN: Validar longitud de input antes de procesar
  const MAX_INPUT_LENGTH = 10000;
  if (!userInput || typeof userInput !== 'string') {
    throw new Error('userInput debe ser un string no vacío');
  }
  if (userInput.length > MAX_INPUT_LENGTH) {
    const originalLength = userInput.length;
    userInput = userInput.substring(0, MAX_INPUT_LENGTH);
    const logger = context.logger || require('../lib/logging');
    logger.warn('INPUT_TRUNCATED_IN_ANALYSIS', {
      originalLength,
      truncatedLength: MAX_INPUT_LENGTH,
      callSid: context.callSid,
      reasoning: `Input truncado en analyzeReservationWithGemini (${originalLength} > ${MAX_INPUT_LENGTH} caracteres)`
    });
  }
  const geminiStartTime = Date.now();
  try {
    const geminiLogger = logger.withContext({ ...context, module: 'gemini' });
    
    // Validar que userInput existe y no está vacío
    if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
      geminiLogger.warn('GEMINI_INVALID_INPUT', {
        userInput: userInput,
        reasoning: 'userInput es null, undefined, no es string o está vacío'
      });
      return null;
    }
    
    // OPTIMIZACIÓN: Verificar cache antes de hacer la llamada
    const cacheKey = userInput.trim().toLowerCase();
    const cached = geminiAnalysisCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < GEMINI_CACHE_TTL_MS) {
      const cacheTime = Date.now() - geminiStartTime;
      geminiLogger.debug('GEMINI_CACHE_HIT', { 
        cacheKey, 
        cacheTimeMs: cacheTime 
      });
      if (context.performanceMetrics) {
        context.performanceMetrics.geminiTime = cacheTime;
      }
      return cached.analysis;
    }
    
    geminiLogger.info('🧠 GEMINI_ANALYSIS_START', { 
      userInput: userInput,
      inputLength: userInput.length,
      context: {
        step: context.step || 'unknown',
        callSid: context.callSid || 'unknown'
      },
      reasoning: `Iniciando análisis de Gemini para extraer información de: "${userInput.substring(0, 100)}"`
    });
    
    // REFACTORIZADO: Usar función helper para crear modelo (elimina duplicación)
    const model = createGeminiModel({
      model: 'gemini-2.5-flash-lite',
      maxOutputTokens: 2048, // Reducir para respuesta más rápida
      temperature: 0.7,
      topP: 0.9,
      topK: 40
    }, geminiLogger);
    
    if (!model) {
      return null;
    }
    
    // PERFORMANCE: Medir tiempo de carga de datos
    const dataLoadStartTime = Date.now();
    // OPTIMIZACIÓN: Cargar configuración y menú en paralelo
    const [configResult, menuItems] = await Promise.all([
      configLoaded ? Promise.resolve(restaurantConfig) : loadRestaurantConfig(),
      loadMenuItems()
    ]);
    const dataLoadTime = Date.now() - dataLoadStartTime;
    if (context.performanceMetrics) {
      context.performanceMetrics.configLoadTime += dataLoadTime;
      context.performanceMetrics.menuLoadTime = dataLoadTime;
    }
    
    geminiLogger.info('📊 CONFIGURATION_LOADED', {
      dataLoadTimeMs: dataLoadTime,
      config: {
        maxPersonas: configResult.maxPersonasMesa,
        minPersonas: configResult.minPersonas,
        horarios: {
          horario1: configResult.horario1Inicio && configResult.horario1Fin ? `${configResult.horario1Inicio}-${configResult.horario1Fin}` : null,
          horario2: configResult.horario2Inicio && configResult.horario2Fin ? `${configResult.horario2Inicio}-${configResult.horario2Fin}` : null,
          horario3: configResult.horario3Inicio && configResult.horario3Fin ? `${configResult.horario3Inicio}-${configResult.horario3Fin}` : null
        },
        minAntelacionHoras: configResult.minAntelacionHoras
      },
      menuItemsCount: menuItems.length,
      reasoning: `Configuración del restaurante cargada. ${menuItems.length} items en el menú.`
    });
    
    // Asegurar que la configuración está cargada
    if (!configLoaded) {
      restaurantConfig = configResult;
      configLoaded = true;
    }
    
    // Obtener fecha/hora actual y horarios
    const now = new Date();
    const currentDateTime = now.toISOString().replace('T', ' ').substring(0, 19);
    const tomorrow = getTomorrowDate();
    const dayAfterTomorrow = getDayAfterTomorrowDate();
    
    // Construir información de horarios
    const horariosInfo = [];
    if (restaurantConfig.horario1Inicio && restaurantConfig.horario1Fin) {
      horariosInfo.push(`  - Desayuno: ${restaurantConfig.horario1Inicio} - ${restaurantConfig.horario1Fin}`);
    }
    if (restaurantConfig.horario2Inicio && restaurantConfig.horario2Fin) {
      horariosInfo.push(`  - Comida: ${restaurantConfig.horario2Inicio} - ${restaurantConfig.horario2Fin}`);
    }
    if (restaurantConfig.horario3Inicio && restaurantConfig.horario3Fin) {
      horariosInfo.push(`  - Cena: ${restaurantConfig.horario3Inicio} - ${restaurantConfig.horario3Fin}`);
    }
    const horariosStr = horariosInfo.length > 0 ? horariosInfo.join('\n') : '  - Comida: 13:00 - 15:00\n  - Cena: 19:00 - 23:00';
    const menuStr = formatMenuForPrompt(menuItems);
    
    // Prompt optimizado para extracción máxima de información
    const prompt = `## MISIÓN
Eres un experto analizador de texto especializado en extraer información de reservas de restaurante.
Tu objetivo es analizar UNA SOLA frase del cliente y extraer TODO lo que puedas de ella, VALIDANDO contra las restricciones del restaurante.

## CONTEXTO ACTUAL
- Fecha y hora actual: ${currentDateTime}
- Fecha de mañana: ${tomorrow}
- Fecha de pasado mañana: ${dayAfterTomorrow}

## DATOS YA RECOPILADOS EN ESTA CONVERSACIÓN
${context.state?.data && Object.keys(context.state.data).length > 0 ? `
- Personas: ${context.state.data.NumeroReserva || 'No especificado'}
- Fecha: ${context.state.data.FechaReserva || 'No especificado'}
- Hora: ${context.state.data.HoraReserva || 'No especificado'}
- Nombre: ${context.state.data.NomReserva || 'No especificado'}
- Teléfono: ${context.state.data.TelefonReserva || context.state?.phone || 'No especificado'}
- Paso actual: ${context.state?.step || context.step || 'unknown'}
` : '- Esta es la primera interacción. No hay datos previos recopilados.'}

## HISTORIAL DE CONVERSACIÓN (ÚLTIMOS MENSAJES)
${context.state?.conversationHistory && context.state.conversationHistory.length > 0 ? 
  context.state.conversationHistory.slice(-8).map((entry, idx) => {
    const role = entry.role === 'user' ? '👤 Cliente' : '🤖 Bot';
    const message = entry.message.length > 200 ? entry.message.substring(0, 200) + '...' : entry.message;
    return `${idx + 1}. ${role}: "${message}"`;
  }).join('\n') 
  : '- No hay historial previo (primera interacción)'}

## CONFIGURACIÓN DEL RESTAURANTE
- Máximo de personas por reserva: ${restaurantConfig.maxPersonasMesa}
- Mínimo de personas por reserva: ${restaurantConfig.minPersonas}
- Horarios de servicio:
${horariosStr}
- Antelación mínima requerida: ${restaurantConfig.minAntelacionHoras} horas

## MENÚ DISPONIBLE (PEDIDOS A DOMICILIO)
${menuStr}

## TEXTO A ANALIZAR
"${userInput}"

## REGLAS CRÍTICAS
1. NO INVENTES información. Si no está en el texto, devuelve null.
2. Si NO estás seguro, usa porcentaje de credibilidad bajo (0% o 50%).
3. Si estás muy seguro, usa 100%.
4. **USO DEL CONTEXTO Y HISTORIAL (MUY IMPORTANTE)**:
   - Si un dato YA está recopilado arriba, NO lo extraigas de nuevo a menos que el usuario lo MODIFIQUE explícitamente.
   - Si el usuario dice algo que CONTRADICE un dato ya recopilado, marca la intención como "modify" y extrae el nuevo valor.
   - Usa el historial para entender el contexto. Por ejemplo:
     * Si el bot preguntó "¿Para cuántas personas?" y el usuario responde "2", entonces extrae comensales: 2
     * Si el usuario dijo "mañana" antes y ahora dice "a las 7", entiende que se refiere a la misma fecha
   - Si detectas que el usuario está REPITIENDO información ya mencionada en el historial, puedes aumentar la credibilidad al 100% porque ya se confirmó antes.
   - Si el usuario menciona información que YA está en los datos recopilados, NO la extraigas de nuevo (devuelve null para ese campo).
5. VALIDA contra las restricciones del restaurante:
   - Si el número de comensales es mayor a ${restaurantConfig.maxPersonasMesa}, marca "comensales_validos": "false" y "comensales_error": "max_exceeded"
   - Si el número de comensales es menor a ${restaurantConfig.minPersonas}, marca "comensales_validos": "false" y "comensales_error": "min_not_met"
   - VALIDACIÓN DE HORA (MUY IMPORTANTE): 
     * Si la hora extraída está DENTRO de alguno de los horarios de servicio listados arriba, marca "hora_disponible": "true"
     * Si la hora extraída está FUERA de todos los horarios de servicio, marca "hora_disponible": "false" y "hora_error": "fuera_horario"
     * Ejemplos:
       - Si la hora es 14:00 y hay horario de comida 13:00-15:00, entonces está DENTRO → "hora_disponible": "true"
       - Si la hora es 16:00 y los horarios son 08:00-11:00, 13:00-15:00, 19:00-23:00, entonces está FUERA → "hora_disponible": "false", "hora_error": "fuera_horario"
       - Si la hora es 10:00 y hay horario de desayuno 08:00-11:00, entonces está DENTRO → "hora_disponible": "true"
       - Si la hora es 12:00 y los horarios son 08:00-11:00, 13:00-15:00, 19:00-23:00, entonces está FUERA → "hora_disponible": "false", "hora_error": "fuera_horario"
     * SIEMPRE valida la hora contra los horarios listados arriba antes de marcar "hora_disponible"
5. Convierte todo a formato estándar:
   - Comensales: SIEMPRE extrae el número mencionado en el texto, incluso si es mayor a ${restaurantConfig.maxPersonasMesa}. Si el texto dice "30 personas", devuelve "30" con credibilidad 100%. Si no hay número, devuelve null con credibilidad 0%.
   - Fecha: YYYY-MM-DD
   - Hora: HH:MM (formato 24h)
   - Intolerancias: "true" o "false"
   - Movilidad: "true" o "false"
   - Nombre: texto o null

## FORMATO DE SALIDA (SOLO JSON, sin explicaciones)
{
  "intencion": "reservation" | "modify" | "cancel" | "order" | "clarify",
  "comensales": null o "número",
  "comensales_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "comensales_validos": "true" | "false" | null,
  "comensales_error": null | "max_exceeded" | "min_not_met",
  "fecha": null o "YYYY-MM-DD",
  "fecha_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "hora": null o "HH:MM",
  "hora_disponible": "true" | "false" | null,
  "hora_error": null | "fuera_horario",
  "hora_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "intolerancias": "true" | "false",
  "intolerancias_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "movilidad": "true" | "false",
  "movilidad_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "nombre": null o "texto",
  "nombre_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "idioma_detectado": "es" | "en" | "de" | "fr" | "it" | "pt",
  "pedido_items": [
    {
      "nombre_detectado": null,
      "cantidad_detectada": null,
      "comentarios": null
    }
  ],
  "direccion_entrega": null,
  "nombre_cliente": null,
  "telefono_cliente": null,
  "notas_pedido": null
}

NOTA SOBRE INTENCIÓN:
- "reservation": El usuario quiere hacer una nueva reserva
- "modify": El usuario quiere modificar una reserva existente
- "cancel": El usuario quiere cancelar una reserva existente
- "order": El usuario quiere hacer un pedido a domicilio usando la carta
- "clarify": El texto es ambiguo o no indica una intención clara

NOTA SOBRE "order" (MUY IMPORTANTE):
- Usa el menú disponible para reconocer los productos solicitados.
- Cada elemento de "pedido_items" representa un producto mencionado por el cliente.

INSTRUCCIONES PARA RECONOCER PRODUCTOS:
1. Busca coincidencias EXACTAS primero (nombre completo del menú).
2. Si no hay coincidencia exacta, busca por PALABRAS CLAVE:
   - "pizza margarita" = busca productos con "margarita" o "margherita" en el nombre
   - "pizza de tomate" = busca productos con "tomate" en nombre o descripción
   - "ensalada con pollo" = busca productos con "ensalada" y "pollo" en nombre o descripción
3. Reconoce SINÓNIMOS y VARIACIONES:
   - "pizza napolitana" puede ser "Pizza Margarita" (mismo tipo de pizza)
   - "pizza de pepperoni" = "Pizza Pepperoni"
   - "ensalada césar" = "Ensalada César" (con o sin acento)
   - "pizza hawaiana" = busca productos con "hawaiana" o "hawaiiana"
4. Busca en DESCRIPCIONES si no encuentras en el nombre:
   - Si el cliente dice "pizza con pepperoni", busca en descripciones que contengan "pepperoni"
   - Si dice "ensalada con pollo", busca en descripciones que contengan "pollo"

FORMATO DE "pedido_items":
- "nombre_detectado": Lo que dijo el cliente exactamente (ej: "pizza margarita", "2 pizzas de pepperoni")
- "cantidad_detectada": Número solicitado como string. Si dice "un par", usa "2". Si dice "tres", usa "3". Si no menciona cantidad, usa "1".
- "comentarios": 
  * Si encuentras el producto en el menú, incluye "menu: <nombre exacto del menú>"
  * Si NO encuentras el producto exacto pero hay uno similar, incluye "similar: <nombre del producto similar>"
  * Si NO encuentras nada similar, incluye "no_encontrado: true"

EXTRAS Y MODIFICACIONES:
- Si menciona modificaciones (ej: "sin cebolla", "extra queso", "sin gluten"), inclúyelas en "comentarios" del item correspondiente.
- Si menciona salsas, bebidas o extras que NO están en el menú principal, inclúyelos como items separados con "nombre_detectado" y marca en "comentarios": "extra: true"

OTROS CAMPOS:
- Si menciona dirección, nombre o teléfono, complétalos en los campos correspondientes.
- Cualquier otra instrucción general (ej: "llamar antes de llegar") debe ir en "notas_pedido".

EJEMPLOS:
Cliente: "Quiero 2 pizzas margarita y una ensalada césar"
→ pedido_items: [
    {"nombre_detectado": "pizzas margarita", "cantidad_detectada": "2", "comentarios": "menu: Pizza Margarita"},
    {"nombre_detectado": "ensalada césar", "cantidad_detectada": "1", "comentarios": "menu: Ensalada César"}
  ]

Cliente: "Quiero una pizza napolitana"
→ pedido_items: [
    {"nombre_detectado": "pizza napolitana", "cantidad_detectada": "1", "comentarios": "similar: Pizza Margarita"}
  ]

Cliente: "Quiero una pizza hawaiana"
→ pedido_items: [
    {"nombre_detectado": "pizza hawaiana", "cantidad_detectada": "1", "comentarios": "no_encontrado: true"}
  ]

NOTA SOBRE VALIDACIONES:
- "comensales_validos": "false" si el número excede el máximo o es menor al mínimo
- "hora_disponible": "false" si la hora está fuera de los horarios del restaurante
- Si hay errores de validación, aún devuelve los valores extraídos pero marca los errores para que el sistema pueda informar al cliente

  IMPORTANTE: Responde SOLO con el JSON, sin texto adicional.`;

    geminiLogger.info('📤 GEMINI_REQUEST_SENT', { 
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 200) + '...',
      reasoning: `Enviando prompt a Gemini (${prompt.length} caracteres) para analizar el input del usuario`
    });
    
    // PERFORMANCE: Medir tiempo de llamada a Gemini API
    const apiCallStartTime = Date.now();
    const result = await callGeminiWithRetry(model, prompt, 5, geminiLogger, context);
    const text = extractTextFromVertexAIResponse(result);
    const apiCallTime = Date.now() - apiCallStartTime;
    
    geminiLogger.info('📥 GEMINI_RAW_RESPONSE_RECEIVED', { 
      responseLength: text.length,
      responsePreview: text.substring(0, 300),
      apiCallTimeMs: apiCallTime,
      reasoning: `Respuesta recibida de Gemini en ${apiCallTime}ms. Extrayendo JSON...`
    });
    
    // Extraer JSON de la respuesta (puede venir con markdown o texto extra)
    // Intentar múltiples estrategias para extraer el JSON
    let jsonText = null;
    let analysis = null;
    
    // Estrategia 1: Buscar JSON dentro de bloques de código markdown (```json ... ```)
    const markdownJsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
      jsonText = markdownJsonMatch[1];
    }
    
    // Estrategia 2: Buscar el primer objeto JSON válido (más preciso que /\{[\s\S]*\}/)
    if (!jsonText) {
      // Buscar desde la primera { hasta la última } balanceada
      let braceCount = 0;
      let startIdx = -1;
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
          if (startIdx === -1) startIdx = i;
          braceCount++;
        } else if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0 && startIdx !== -1) {
            jsonText = text.substring(startIdx, i + 1);
            break;
          }
        }
      }
    }
    
    // Estrategia 3: Fallback al regex simple (menos preciso pero puede funcionar)
    if (!jsonText) {
      const simpleMatch = text.match(/\{[\s\S]*\}/);
      if (simpleMatch) {
        jsonText = simpleMatch[0];
      }
    }
    
    if (!jsonText) {
      geminiLogger.error('❌ JSON_EXTRACTION_FAILED', { 
        text: text.substring(0, 500),
        reasoning: 'No se pudo extraer JSON de la respuesta de Gemini. La respuesta puede estar mal formateada.'
      });
      return null;
    }
    
    // Intentar parsear el JSON
    try {
      analysis = JSON.parse(jsonText);
    } catch (parseError) {
      // Si falla, intentar limpiar el JSON (quitar comentarios, trailing commas, etc.)
      try {
        // Intentar limpiar JSON básico (quitar comentarios de línea y trailing commas)
        let cleanedJson = jsonText
          .replace(/\/\/.*$/gm, '') // Quitar comentarios de línea
          .replace(/\/\*[\s\S]*?\*\//g, '') // Quitar comentarios de bloque
          .replace(/,(\s*[}\]])/g, '$1'); // Quitar trailing commas
        
        analysis = JSON.parse(cleanedJson);
        geminiLogger.warn('JSON_CLEANED_AND_PARSED', {
          reasoning: 'JSON tenía caracteres inválidos que fueron limpiados'
        });
      } catch (cleanError) {
        geminiLogger.error('❌ JSON_PARSE_ERROR', {
          error: parseError.message,
          cleanError: cleanError.message,
          jsonPreview: jsonText.substring(0, 500),
          reasoning: 'Error al parsear el JSON extraído de la respuesta de Gemini incluso después de limpiarlo'
        });
        return null;
      }
    }
    
    const totalGeminiTime = Date.now() - geminiStartTime;
    
    // ===== LOG DETALLADO DEL ANÁLISIS COMPLETO =====
    geminiLogger.info('✅ GEMINI_ANALYSIS_COMPLETED', { 
      totalTimeMs: totalGeminiTime,
      apiCallTimeMs: apiCallTime,
      dataLoadTimeMs: dataLoadTime,
      extractedData: {
        intencion: analysis.intencion,
        comensales: analysis.comensales,
        comensales_confidence: analysis.comensales_porcentaje_credivilidad,
        comensales_validos: analysis.comensales_validos,
        comensales_error: analysis.comensales_error,
        fecha: analysis.fecha,
        fecha_confidence: analysis.fecha_porcentaje_credivilidad,
        hora: analysis.hora,
        hora_confidence: analysis.hora_porcentaje_credivilidad,
        hora_disponible: analysis.hora_disponible,
        hora_error: analysis.hora_error,
        nombre: analysis.nombre,
        nombre_confidence: analysis.nombre_porcentaje_credivilidad,
        idioma_detectado: analysis.idioma_detectado,
        intolerancias: analysis.intolerancias,
        movilidad: analysis.movilidad,
        pedido_items_count: analysis.pedido_items?.length || 0
      },
      reasoning: `Análisis completado. Intención: ${analysis.intencion}, Idioma: ${analysis.idioma_detectado}. ` +
                 `Extraídos: ${analysis.comensales ? `${analysis.comensales} personas` : 'sin personas'}, ` +
                 `${analysis.fecha ? `fecha ${analysis.fecha}` : 'sin fecha'}, ` +
                 `${analysis.hora ? `hora ${analysis.hora}` : 'sin hora'}, ` +
                 `${analysis.nombre ? `nombre ${analysis.nombre}` : 'sin nombre'}`
    });
    
    geminiLogger.debug('🔍 GEMINI_ANALYSIS_DETAILS', {
      fullAnalysis: analysis,
      reasoning: 'Análisis completo de Gemini con todos los campos extraídos'
    });
    
    // PERFORMANCE: Actualizar métricas si están disponibles
    if (context.performanceMetrics) {
      context.performanceMetrics.geminiTime = totalGeminiTime;
    }
    
    // OPTIMIZACIÓN: Guardar en cache
    if (analysis) {
      geminiAnalysisCache.set(cacheKey, {
        analysis,
        timestamp: Date.now()
      });
      // Limpiar cache si es necesario
      cleanGeminiCache();
    }
    
    return analysis;
    
  } catch (error) {
    const errorTime = Date.now() - geminiStartTime;
    const geminiLogger = logger.withContext({ ...context, module: 'gemini' });
    
    // LOGGING CRÍTICO: Loggear TODA la información del error
    const errorInfo = {
      error: error.message,
      stack: error.stack,
      name: error.name,
      timeMs: errorTime,
      inputLength: userInput ? userInput.length : 0,
      inputPreview: userInput ? userInput.substring(0, 500) : 'empty',
      context: context
    };
    
    if (error.code) errorInfo.code = error.code;
    if (error.status) errorInfo.status = error.status;
    if (error.response) {
      errorInfo.responseStatus = error.response.status;
      errorInfo.responseData = typeof error.response.data === 'string' 
        ? error.response.data.substring(0, 500) 
        : error.response.data;
    }
    
    // Log compacto de error de Gemini (ya formateado por logger)
    geminiLogger.error('GEMINI_ANALYSIS_ERROR', errorInfo);
    
    if (context.performanceMetrics) {
      context.performanceMetrics.geminiTime = errorTime;
    }
    return null;
  }
}

/**
 * Detecta la intención del usuario usando Gemini
 * Retorna: { action: 'reservation' | 'modify' | 'cancel' | 'clarify' }
 */
async function detectIntentionWithGemini(text, context = {}) {
  try {
    const geminiLogger = logger.withContext({ ...context, module: 'gemini' });
    
    // REFACTORIZADO: Usar función helper para crear modelo (elimina duplicación)
    const model = createGeminiModel({
      model: 'gemini-2.5-flash-lite',
      maxOutputTokens: 512, // Muy corto para detección de intención
      temperature: 0.3, // Baja temperatura para respuestas más deterministas
      topP: 0.8,
      topK: 20
    }, geminiLogger);
    
    if (!model) {
      // Fallback: asumir reservation si no hay Gemini
      return { action: 'reservation' };
    }
    
    const prompt = `Analiza este texto del cliente de un restaurante y determina su intención.
Responde SOLO con una de estas opciones:
- "reservation": Quiere hacer una nueva reserva (reservar mesa, hacer reserva, etc.)
- "modify": Quiere modificar una reserva existente (cambiar fecha, hora, personas, etc.)
- "cancel": Quiere cancelar una reserva existente (cancelar, anular, etc.)
- "clarify": El texto es ambiguo o no indica una intención clara

Texto: "${text}"

Responde SOLO con una palabra: reservation, modify, cancel o clarify. Sin explicaciones.`;

    geminiLogger.gemini('INTENTION_ANALYSIS_START', { text });

    // OPTIMIZACIÓN: Reducir reintentos a 2 para detección de intención (más rápido)
    const result = await callGeminiWithRetry(model, prompt, 2, geminiLogger);
    const responseText = extractTextFromVertexAIResponse(result);
    
    // Validar que la respuesta no esté vacía
    if (!responseText || typeof responseText !== 'string') {
      geminiLogger.warn('GEMINI_EMPTY_RESPONSE', {
        reasoning: 'La respuesta de Gemini está vacía o no es un string'
      });
      return { action: 'clarify' };
    }
    
    const detectedIntention = responseText.trim().toLowerCase();
    
    const validIntentions = ['reservation', 'modify', 'cancel', 'clarify'];
    const action = validIntentions.includes(detectedIntention) ? detectedIntention : 'clarify';
    
    geminiLogger.gemini('INTENTION_DETECTED', { action });
    return { action };
    
  } catch (error) {
    logger.error('GEMINI_INTENTION_ERROR', { message: error.message, stack: error.stack });
    // Fallback: asumir reservation
    return { action: 'reservation' };
  }
}

/**
 * Detecta el idioma del texto usando Gemini (más preciso que regex)
 */
async function detectLanguageWithGemini(text) {
  try {
    // REFACTORIZADO: Usar función helper para crear modelo (elimina duplicación)
    const model = createGeminiModel({
      model: 'gemini-2.5-flash-lite',
      maxOutputTokens: 32, // Muy corto para solo código de idioma
      temperature: 0.1, // Muy baja temperatura para respuesta determinista
      topP: 0.7,
      topK: 10
    });
    
    if (!model) {
      return 'es'; // Fallback
    }
    
    const prompt = `Analiza este texto y determina el idioma. Responde SOLO con el código de idioma:
- "es" para español
- "en" para inglés
- "de" para alemán
- "fr" para francés
- "it" para italiano
- "pt" para portugués

Texto: "${text}"

Responde SOLO con el código de 2 letras, sin explicaciones.`;

    // OPTIMIZACIÓN: Reducir reintentos a 2 para detección de idioma (más rápido)
    const result = await callGeminiWithRetry(model, prompt, 2);
    const responseText = extractTextFromVertexAIResponse(result);
    
    // Validar que la respuesta no esté vacía
    if (!responseText || typeof responseText !== 'string') {
      console.warn('⚠️ [GEMINI] Respuesta vacía en detección de idioma, usando fallback');
      return 'es';
    }
    
    const detectedLang = responseText.trim().toLowerCase().substring(0, 2);
    
    const validLangs = ['es', 'en', 'de', 'fr', 'it', 'pt'];
    return validLangs.includes(detectedLang) ? detectedLang : 'es';
    
  } catch (error) {
    console.error('❌ [GEMINI] Error detectando idioma:', error);
    return 'es';
  }
}

/**
 * Analiza la selección de reserva del usuario usando Gemini
 * Recibe el input del usuario y un array de reservas
 * Retorna el índice (0-based) de la reserva seleccionada o null si no se puede determinar
 */
async function analyzeReservationSelectionWithGemini(userInput, reservations, language = 'es', context = {}) {
  try {
    const geminiLogger = logger.withContext({ ...context, module: 'gemini' });
    
    // REFACTORIZADO: Usar función helper para crear modelo (elimina duplicación)
    const model = createGeminiModel({
      model: 'gemini-2.5-flash-lite',
      maxOutputTokens: 256,
      temperature: 0.3,
      topP: 0.8,
      topK: 20
    }, geminiLogger);
    
    if (!model) {
      console.warn('⚠️ [GEMINI] Cliente no disponible, usando fallback');
      // Fallback: intentar extraer número con función existente
      const optionNumber = extractOptionFromText(userInput);
      return optionNumber ? optionNumber - 1 : null;
    }
    
    // REFACTORIZADO: Usar función helper para formatear fechas/horas (elimina duplicación)
    const reservationsList = reservations.map((reservation, index) => {
      const { formattedDate, formattedTime } = formatReservationDateTime(reservation.data_reserva, language);
      
      return {
        index: index + 1,
        date: formattedDate,
        time: formattedTime,
        name: reservation.nom_persona_reserva,
        people: reservation.num_persones
      };
    });

    // Construir el prompt según el idioma
    const reservationsText = reservationsList.map(r => {
      if (language === 'es') {
        return `  ${r.index}. Reserva el día ${r.date} a las ${r.time} a nombre de ${r.name} para ${r.people} persona${r.people > 1 ? 's' : ''}`;
      } else if (language === 'en') {
        return `  ${r.index}. Reservation on ${r.date} at ${r.time} under ${r.name} for ${r.people} person${r.people > 1 ? 's' : ''}`;
      } else if (language === 'de') {
        return `  ${r.index}. Reservierung am ${r.date} um ${r.time} unter ${r.name} für ${r.people} Person${r.people > 1 ? 'en' : ''}`;
      } else if (language === 'fr') {
        return `  ${r.index}. Réservation le ${r.date} à ${r.time} au nom de ${r.name} pour ${r.people} personne${r.people > 1 ? 's' : ''}`;
      } else if (language === 'it') {
        return `  ${r.index}. Prenotazione il ${r.date} alle ${r.time} a nome di ${r.name} per ${r.people} persona${r.people > 1 ? 'e' : ''}`;
      } else if (language === 'pt') {
        return `  ${r.index}. Reserva no dia ${r.date} às ${r.time} em nome de ${r.name} para ${r.people} pessoa${r.people > 1 ? 's' : ''}`;
      }
      // Fallback a español
      return `  ${r.index}. Reserva el día ${r.date} a las ${r.time} a nombre de ${r.name} para ${r.people} persona${r.people > 1 ? 's' : ''}`;
    }).join('\n');

    const prompt = language === 'es'
      ? `El usuario tiene las siguientes reservas y quiere cancelar una de ellas. Analiza su respuesta y determina qué reserva quiere cancelar.

RESERVAS DISPONIBLES:
${reservationsText}

RESPUESTA DEL USUARIO: "${userInput}"

El usuario puede referirse a la reserva de diferentes formas:
- Por número: "la primera", "la segunda", "opción 1", "opción 2", "número 1", "número 2"
- Por fecha: "la del día X", "la de mañana", "la del viernes"
- Por hora: "la de las X", "la de las 8"
- Por nombre: "la de [nombre]"
- Combinaciones: "la primera reserva", "la segunda opción", "la del día X a las Y"

Responde SOLO con el número de la reserva (1, 2, 3, etc.) sin explicaciones. Si no puedes determinar cuál, responde "null".`
      : `The user has the following reservations and wants to cancel one of them. Analyze their response and determine which reservation they want to cancel.

AVAILABLE RESERVATIONS:
${reservationsText}

USER RESPONSE: "${userInput}"

The user may refer to the reservation in different ways:
- By number: "the first", "the second", "option 1", "option 2", "number 1", "number 2"
- By date: "the one on day X", "tomorrow's", "Friday's"
- By time: "the one at X", "the one at 8"
- By name: "the one under [name]"
- Combinations: "the first reservation", "the second option", "the one on day X at Y"

Respond ONLY with the reservation number (1, 2, 3, etc.) without explanations. If you cannot determine which one, respond "null".`;

    geminiLogger.info('🔍 GEMINI_RESERVATION_SELECTION_START', { 
      userInput,
      reservationsCount: reservations.length,
      language
    });

    const result = await callGeminiWithRetry(model, prompt, 2, geminiLogger);
    const rawResponseText = extractTextFromVertexAIResponse(result);
    
    // Validar que la respuesta no esté vacía
    if (!rawResponseText || typeof rawResponseText !== 'string') {
      geminiLogger.warn('GEMINI_EMPTY_RESPONSE_SELECTION', {
        reasoning: 'La respuesta de Gemini está vacía o no es un string'
      });
      // Fallback: intentar extraer número con función existente
      const optionNumber = extractOptionFromText(userInput);
      return optionNumber ? optionNumber - 1 : null;
    }
    
    const responseText = rawResponseText.trim();
    
    // Intentar extraer el número de la respuesta
    const numberMatch = responseText.match(/\d+/);
    if (numberMatch) {
      const selectedNumber = parseInt(numberMatch[0]);
      const selectedIndex = selectedNumber - 1; // Convertir a índice 0-based
      
      if (selectedIndex >= 0 && selectedIndex < reservations.length) {
        geminiLogger.info('✅ GEMINI_RESERVATION_SELECTED', { 
          selectedNumber,
          selectedIndex,
          reservation: reservations[selectedIndex]
        });
        return selectedIndex;
      }
    }
    
    geminiLogger.warn('⚠️ GEMINI_RESERVATION_SELECTION_FAILED', { 
      responseText,
      reasoning: 'No se pudo determinar la reserva seleccionada'
    });
    
    return null;
    
  } catch (error) {
    console.error('❌ [GEMINI] Error analizando selección de reserva:', error);
    logger.error('GEMINI_RESERVATION_SELECTION_ERROR', { 
      message: error.message, 
      stack: error.stack 
    });
    // Fallback: intentar extraer número con función existente
    const optionNumber = extractOptionFromText(userInput);
    return optionNumber ? optionNumber - 1 : null;
  }
}

/**
 * Determina qué campos faltan después del análisis de Gemini
 * Retorna array con los campos que faltan
 */
function determineMissingFields(analysis, stateData) {
  const missing = [];
  
  // Verificar comensales (si no está en análisis o en state)
  if (!analysis?.comensales && !stateData.NumeroReserva) {
    missing.push('people');
  }
  
  // Verificar fecha
  if (!analysis?.fecha && !stateData.FechaReserva) {
    missing.push('date');
  }
  
  // Verificar hora
  if (!analysis?.hora && !stateData.HoraReserva) {
    missing.push('time');
  }
  
  // Verificar nombre
  if (!analysis?.nombre && !stateData.NomReserva) {
    missing.push('name');
  }
  
  // Telefono siempre lo pedimos si no está (a menos que estemos en paso de confirmación)
  // Esto lo manejamos en el flujo, no aquí
  
  return missing;
}

/**
 * Aplica los datos extraídos por Gemini al estado de la conversación
 * Retorna { success: boolean, error?: string } para indicar si hubo error de validación
 */
async function applyGeminiAnalysisToState(analysis, state, callLogger, originalText = '') {
  if (!analysis) return { success: true };
  
  // RESTAURADO: Log del estado ANTES de aplicar análisis
  const stateBefore = {
    NumeroReserva: state.data?.NumeroReserva,
    FechaReserva: state.data?.FechaReserva,
    HoraReserva: state.data?.HoraReserva,
    NomReserva: state.data?.NomReserva,
    TelefonReserva: state.data?.TelefonReserva
  };
  
  // Log para diagnosticar si el estado está vacío cuando no debería
  const hasDataBefore = state.data && Object.keys(state.data).length > 0;
  if (!hasDataBefore && state.step !== 'greeting' && state.step !== 'ask_intention') {
    log.warn('STATE_EMPTY_BEFORE_APPLY', {
      step: state.step,
      stateBefore: stateBefore,
      reasoning: 'El estado está vacío en un paso avanzado. Esto puede indicar pérdida de datos.'
    });
  }
  
  const attach = (data) => {
    if (!data) return { step: state.step };
    if (typeof data === 'object' && !Array.isArray(data)) {
      return { step: state.step, ...data };
    }
    return { step: state.step, value: data };
  };

  const log = callLogger
    ? {
        warn: (message, data) => callLogger.warn(message, attach(data)),
        reservation: (message, data) => callLogger.reservation(message, attach(data)),
        info: (message, data) => callLogger.info(message, attach(data)),
        debug: (message, data) => callLogger.debug(message, attach(data))
      }
    : {
        warn: (message, data) => logger.warn(message, attach(data)),
        reservation: (message, data) => logger.reservation(message, attach(data)),
        info: (message, data) => logger.info(message, attach(data)),
        debug: (message, data) => logger.debug(message, attach(data))
      };
  
  // MEJORADO: Actualizar idioma PRIMERO si se detectó en el análisis
  if (analysis.idioma_detectado) {
    const validLangs = ['es', 'en', 'de', 'fr', 'it', 'pt'];
    const detectedLang = validLangs.includes(analysis.idioma_detectado) 
      ? analysis.idioma_detectado 
      : (state.language || 'es');
    
    if (detectedLang !== state.language) {
      const oldLanguage = state.language;
      state.language = detectedLang;
      log.info('🌐 LANGUAGE_UPDATED_IN_APPLY', { 
        oldLanguage: oldLanguage,
        newLanguage: detectedLang,
        reasoning: `Idioma detectado por Gemini en applyGeminiAnalysisToState: ${detectedLang}. Actualizando estado.`
      });
    } else if (!state.language) {
      state.language = detectedLang;
      log.info(`[LANG] init=`, { 
        language: detectedLang,
        reasoning: `Idioma inicializado en applyGeminiAnalysisToState: ${detectedLang}`
      });
    }
  } else if (!state.language) {
    state.language = 'es';
    log.info(`[LANG] fallback=`, { 
      language: 'es',
      reasoning: 'No se detectó idioma en análisis. Usando español como fallback.'
    });
  }
  
  // ===== LOG DETALLADO DE APLICACIÓN DE ANÁLISIS =====
  log.info(`[APPLY] `, {
    analysis: {
      intencion: analysis.intencion,
      comensales: analysis.comensales,
      comensales_confidence: analysis.comensales_porcentaje_credivilidad,
      comensales_validos: analysis.comensales_validos,
      comensales_error: analysis.comensales_error,
      fecha: analysis.fecha,
      fecha_confidence: analysis.fecha_porcentaje_credivilidad,
      hora: analysis.hora,
      hora_confidence: analysis.hora_porcentaje_credivilidad,
      hora_disponible: analysis.hora_disponible,
      hora_error: analysis.hora_error,
      nombre: analysis.nombre,
      nombre_confidence: analysis.nombre_porcentaje_credivilidad,
      idioma_detectado: analysis.idioma_detectado
    },
    stateBefore: stateBefore,
    currentLanguage: state.language,
    originalText: originalText.substring(0, 100),
    reasoning: `Aplicando análisis de Gemini al estado. Idioma actual: ${state.language}. Estado actual: ${JSON.stringify(stateBefore)}. ` +
               `Análisis contiene: ${analysis.comensales ? `${analysis.comensales} personas` : 'sin personas'}, ` +
               `${analysis.fecha ? `fecha ${analysis.fecha}` : 'sin fecha'}, ` +
               `${analysis.hora ? `hora ${analysis.hora}` : 'sin hora'}, ` +
               `${analysis.nombre ? `nombre ${analysis.nombre}` : 'sin nombre'}`
  });
  
  // Aplicar solo si el porcentaje de credibilidad es >= 50%
  const applyIfConfident = (value, percentage) => {
    const pct = parseInt(percentage || '0%');
    return pct >= 50 ? value : null;
  };
  
  // Comensales - Validar contra configuración del restaurante
  // Manejar caso cuando Gemini retorna null pero el porcentaje es alto (extraer del texto original)
  let peopleCount = null;
  const comensalesCredibility = parseInt(analysis.comensales_porcentaje_credivilidad || '0%');
  
  if (analysis.comensales) {
    // Gemini retornó un valor
    if (applyIfConfident(analysis.comensales, analysis.comensales_porcentaje_credivilidad)) {
      peopleCount = parseInt(analysis.comensales);
    }
  } else if (comensalesCredibility >= 50) {
    // Gemini retornó null pero tiene alta credibilidad - intentar extraer del texto original
    // Esto puede pasar cuando el número está fuera del rango mencionado en el prompt
    log.warn('GEMINI_NULL_PEOPLE_WITH_CONFIDENCE');
    // Esta lógica se manejará en el paso ask_people donde tenemos acceso al userInput
  }
  
  // Si tenemos un número válido, validar y aplicar
  if (peopleCount !== null && !isNaN(peopleCount)) {
    log.debug('👥 PROCESSING_PEOPLE_COUNT', {
      peopleCount: peopleCount,
      comensales_validos: analysis.comensales_validos,
      comensales_error: analysis.comensales_error,
      maxPersonas: restaurantConfig.maxPersonasMesa,
      minPersonas: restaurantConfig.minPersonas,
      reasoning: `Procesando número de personas: ${peopleCount}. Verificando validación de Gemini y límites del restaurante.`
    });
    
    // Primero verificar si Gemini ya validó (nuevos campos)
    if (analysis.comensales_validos === 'false') {
      if (analysis.comensales_error === 'max_exceeded') {
        log.warn('❌ PEOPLE_MAX_EXCEEDED_GEMINI', { 
          peopleCount, 
          maxPersonas: restaurantConfig.maxPersonasMesa,
          reasoning: `Gemini detectó que ${peopleCount} personas excede el máximo permitido (${restaurantConfig.maxPersonasMesa}). Rechazando.`
        });
        return { 
          success: false, 
          error: 'people_too_many',
          maxPersonas: restaurantConfig.maxPersonasMesa,
          message: `El máximo de personas por reserva es ${restaurantConfig.maxPersonasMesa}`
        };
      } else if (analysis.comensales_error === 'min_not_met') {
        log.warn('❌ PEOPLE_MIN_NOT_MET_GEMINI', { 
          peopleCount, 
          minPersonas: restaurantConfig.minPersonas,
          reasoning: `Gemini detectó que ${peopleCount} personas es menor al mínimo permitido (${restaurantConfig.minPersonas}). Rechazando.`
        });
        return { 
          success: false, 
          error: 'people_too_low',
          minPersonas: restaurantConfig.minPersonas,
          message: `El mínimo de personas por reserva es ${restaurantConfig.minPersonas}`
        };
      }
    }
    
    // Validar mínimo (fallback si Gemini no validó)
    if (peopleCount < 1 || (restaurantConfig.minPersonas && peopleCount < restaurantConfig.minPersonas)) {
      log.warn('PEOPLE_BELOW_MIN', { 
        peopleCount, 
        minPersonas: restaurantConfig.minPersonas || 1 
      });
      return { 
        success: false, 
        error: 'people_too_low',
        minPersonas: restaurantConfig.minPersonas || 1,
        message: `El número de personas debe ser al menos ${restaurantConfig.minPersonas || 1}`
      };
    }
    
    // Validar máximo usando configuración global
    log.debug('PEOPLE_COUNT_VALIDATION', { peopleCount, maxPersonas: restaurantConfig.maxPersonasMesa });
    
    if (peopleCount > restaurantConfig.maxPersonasMesa) {
      log.warn('PEOPLE_ABOVE_MAX', { 
        peopleCount, 
        maxPersonas: restaurantConfig.maxPersonasMesa 
      });
      return { 
        success: false, 
        error: 'people_too_many',
        maxPersonas: restaurantConfig.maxPersonasMesa,
        message: `El máximo de personas por reserva es ${restaurantConfig.maxPersonasMesa}`
      };
    }
    
    // Si pasa la validación, aplicar SOLO si no existe o es diferente (modificación)
    const existingPeople = state.data.NumeroReserva;
    const isModification = analysis.intencion === 'modify' || (existingPeople && existingPeople !== peopleCount);
    
    if (!existingPeople || isModification) {
      state.data.NumeroReserva = peopleCount;
      log.reservation('PEOPLE_APPLIED', { 
        peopleCount,
        peopleAnterior: existingPeople,
        credibilidad: analysis.comensales_porcentaje_credivilidad,
        isNew: !existingPeople,
        isModification: isModification
      });
    } else {
      log.debug('PEOPLE_ALREADY_EXISTS_SKIP', {
        existingPeople: existingPeople,
        newPeople: peopleCount,
        reasoning: 'Número de personas ya está recopilado y no ha cambiado. No se sobrescribe.'
      });
    }
  } else {
    log.debug('PEOPLE_NOT_APPLIED', {
      comensales: analysis.comensales,
      credibilidad: analysis.comensales_porcentaje_credivilidad,
      peopleExistente: state.data.NumeroReserva
    });
    
    // ELIMINADO: Fallback problemático que extraía números incorrectamente
    // Ahora confiamos 100% en Gemini para extraer el número de personas
    // Si Gemini no lo extrae, simplemente no lo aplicamos y preguntamos al usuario
    if (!state.data.NumeroReserva) {
      log.debug('PEOPLE_NOT_EXTRACTED_BY_GEMINI', {
        comensales: analysis.comensales,
        credibilidad: analysis.comensales_porcentaje_credivilidad,
        reasoning: 'Gemini no extrajo número de personas o credibilidad muy baja. Se preguntará al usuario en el siguiente paso.'
      });
    }
  }
  
  // Fecha - Solo aplicar si el análisis tiene fecha Y credibilidad >= 50%
  // IMPORTANTE: NO sobrescribir si ya existe una fecha válida a menos que sea una modificación
  if (analysis.fecha && applyIfConfident(analysis.fecha, analysis.fecha_porcentaje_credivilidad)) {
    const existingDate = state.data.FechaReserva;
    const isModification = analysis.intencion === 'modify' || (existingDate && existingDate !== analysis.fecha);
    
    if (!existingDate || isModification) {
      state.data.FechaReserva = analysis.fecha;
      log.reservation('DATE_APPLIED', { 
        fecha: analysis.fecha,
        fechaAnterior: existingDate,
        credibilidad: analysis.fecha_porcentaje_credivilidad,
        isNew: !existingDate,
        isModification: isModification
      });
    } else {
      log.debug('DATE_ALREADY_EXISTS_SKIP', {
        existingDate: existingDate,
        newDate: analysis.fecha,
        reasoning: 'Fecha ya está recopilada y no ha cambiado. No se sobrescribe.'
      });
    }
  } else if (analysis.fecha) {
    log.debug('DATE_NOT_APPLIED_LOW_CONFIDENCE', {
      fecha: analysis.fecha,
      credibilidad: analysis.fecha_porcentaje_credivilidad,
      fechaExistente: state.data.FechaReserva
    });
  }
  
  // Hora - Validar disponibilidad si Gemini la marcó como no disponible
  let timeApplied = false;
  if (analysis.hora && applyIfConfident(analysis.hora, analysis.hora_porcentaje_credivilidad)) {
    // Si Gemini validó y marcó como no disponible, guardar error para manejar después
    if (analysis.hora_disponible === 'false' && analysis.hora_error === 'fuera_horario') {
      log.warn('TIME_OUT_OF_HOURS_GEMINI', { hora: analysis.hora });
      // Guardar en el estado para manejar el error después (el paso ask_time lo manejará)
      state.data.HoraReserva = analysis.hora;
      state.data.horaError = 'fuera_horario';
      log.reservation('TIME_WITH_ERROR', { hora: analysis.hora, error: 'fuera_horario' });
    } else {
      // Hora válida o no validada, aplicar SOLO si no existe o es diferente (modificación)
      const existingTime = state.data.HoraReserva;
      const isModification = analysis.intencion === 'modify' || (existingTime && existingTime !== analysis.hora);
      
      if (!existingTime || isModification) {
        state.data.HoraReserva = analysis.hora;
        delete state.data.horaError; // Limpiar error si existía
        log.reservation('TIME_APPLIED', { 
          hora: analysis.hora,
          horaAnterior: existingTime,
          credibilidad: analysis.hora_porcentaje_credivilidad,
          isNew: !existingTime,
          isModification: isModification
        });
        timeApplied = true;
      } else {
        log.debug('TIME_ALREADY_EXISTS_SKIP', {
          existingTime: existingTime,
          newTime: analysis.hora,
          reasoning: 'Hora ya está recopilada y no ha cambiado. No se sobrescribe.'
        });
        timeApplied = false; // No se aplicó porque ya existe
      }
    }
  } else if (analysis.hora) {
    log.debug('TIME_NOT_APPLIED_LOW_CONFIDENCE', {
      hora: analysis.hora,
      credibilidad: analysis.hora_porcentaje_credivilidad,
      horaExistente: state.data.HoraReserva
    });
  }

  // ELIMINADO: Fallback problemático de hora que extraía "05:00" de "cinco personas"
  // Ahora confiamos 100% en Gemini para extraer la hora
  // Si Gemini no la extrae, simplemente no la aplicamos y preguntamos al usuario
  if (!timeApplied) {
    log.debug('TIME_NOT_EXTRACTED_BY_GEMINI', {
      hora: analysis.hora,
      credibilidad: analysis.hora_porcentaje_credivilidad,
      horaExistente: state.data.HoraReserva,
      reasoning: 'Gemini no extrajo hora o credibilidad muy baja. Se preguntará al usuario en el siguiente paso.'
    });
  }
  
  // Nombre - Solo aplicar si el análisis tiene nombre Y credibilidad >= 50%
  // IMPORTANTE: NO sobrescribir si ya existe un nombre a menos que sea una modificación
  let nameApplied = false;
  if (analysis.nombre && applyIfConfident(analysis.nombre, analysis.nombre_porcentaje_credivilidad)) {
    const existingName = state.data.NomReserva;
    const isModification = analysis.intencion === 'modify' || (existingName && existingName !== analysis.nombre);
    
    if (!existingName || isModification) {
      state.data.NomReserva = analysis.nombre;
      log.reservation('NAME_APPLIED', { 
        nombre: analysis.nombre,
        nombreAnterior: existingName,
        credibilidad: analysis.nombre_porcentaje_credivilidad,
        isNew: !existingName,
        isModification: isModification
      });
      nameApplied = true;
    } else {
      log.debug('NAME_ALREADY_EXISTS_SKIP', {
        existingName: existingName,
        newName: analysis.nombre,
        reasoning: 'Nombre ya está recopilado y no ha cambiado. No se sobrescribe.'
      });
      nameApplied = false; // No se aplicó porque ya existe
    }
  } else if (analysis.nombre) {
    log.debug('NAME_NOT_APPLIED_LOW_CONFIDENCE', {
      nombre: analysis.nombre,
      credibilidad: analysis.nombre_porcentaje_credivilidad,
      nombreExistente: state.data.NomReserva
    });
  }
  
  // Fallback: intentar extraer nombre del texto original si Gemini no lo detectó
  // IMPORTANTE: Solo aplicar fallback si NO hay nombre existente Y el texto contiene indicadores de nombre
  if (!nameApplied && !state.data.NomReserva && originalText) {
    const textLower = originalText.toLowerCase();
    // Verificar si el texto contiene indicadores de que el usuario está dando su nombre
    const nameIndicators = [
      /(?:^|\s)(?:mi nombre es|me llamo|soy|a nombre de|nombre de|los nombres de|el nombre de|llamado|llamo)\s+/i,
      /(?:^|\s)(?:my name is|i am|i'm|call me|named)\s+/i,
      // Patrones específicos para frases incompletas
      /^a nombre de\s*$/i,
      /^nombre de\s*$/i,
      /^los nombres de\s*$/i,
      /^el nombre de\s*$/i
    ];
    
    const hasNameIndicator = nameIndicators.some(pattern => pattern.test(textLower));
    
    // Si hay indicador pero no nombre extraído, intentar extraer con fallback
    if (hasNameIndicator) {
      const fallbackName = extractName(originalText);
      if (fallbackName && fallbackName.trim().length > 0) {
        state.data.NomReserva = fallbackName;
        log.reservation('NAME_APPLIED_FALLBACK', { 
          nombre: fallbackName,
          originalText: originalText.substring(0, 50),
          reason: 'name_indicator_found'
        });
        nameApplied = true;
      } else {
        // El usuario dijo "a nombre de" pero no completó el nombre - esto es OK, no es error
        log.debug('NAME_INDICATOR_WITHOUT_NAME', {
          originalText: originalText.substring(0, 50),
          reason: 'user_will_provide_name_next'
        });
      }
    }
  }
  
  // Intolerancias (guardamos pero no es crítico)
  if (analysis.intolerancias === 'true') {
    state.data.Observacions = (state.data.Observacions || '') + ' Intolerancias alimentarias.';
    log.debug('INTOLERANCIAS_APPLIED');
  }
  
  // Movilidad reducida
  if (analysis.movilidad === 'true') {
    state.data.Observacions = (state.data.Observacions || '') + ' Necesita mesa accesible.';
    log.debug('MOVILIDAD_APPLIED');
  }
  
  // RESTAURADO: Log del estado DESPUÉS de aplicar análisis
  const stateAfter = {
    NumeroReserva: state.data?.NumeroReserva,
    FechaReserva: state.data?.FechaReserva,
    HoraReserva: state.data?.HoraReserva,
    NomReserva: state.data?.NomReserva,
    TelefonReserva: state.data?.TelefonReserva
  };
  
  log.info('GEMINI_ANALYSIS_APPLY_COMPLETE', {
    stateBefore: stateBefore,
    stateAfter: stateAfter,
    changes: {
      NumeroReserva: stateBefore.NumeroReserva !== stateAfter.NumeroReserva,
      FechaReserva: stateBefore.FechaReserva !== stateAfter.FechaReserva,
      HoraReserva: stateBefore.HoraReserva !== stateAfter.HoraReserva,
      NomReserva: stateBefore.NomReserva !== stateAfter.NomReserva
    }
  });
  
  // NO guardar aquí - se guarda una sola vez al final del request para evitar múltiples INSERTs
  // El estado se guarda en memoria y se persistirá al final del request
  
  return { success: true };
}

const ORDER_STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'con', 'sin', 'para', 'por', 'al', 'a', 'en', 'un', 'una', 'unos', 'unas', 'lo', 'le', 'les'
]);

function normalizeOrderString(value = '') {
  return (value || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .toLowerCase()
    .trim();
}

function singularizeToken(token) {
  if (!token || token.length <= 3) {
    return token;
  }
  if (token.endsWith('es') && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenizeOrder(value = '') {
  return normalizeOrderString(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !ORDER_STOP_WORDS.has(token))
    .map(singularizeToken);
}

function computeTokenSimilarity(a, b) {
  if (!a || !b) return 0;
  const tokensA = Array.from(new Set(tokenizeOrder(a)));
  const tokensB = Array.from(new Set(tokenizeOrder(b)));
  if (!tokensA.length || !tokensB.length) return 0;
  const intersection = tokensA.filter(token => tokensB.includes(token));
  return intersection.length / Math.max(tokensA.length, tokensB.length);
}

function findBestMenuMatch(rawName, menuItems = []) {
  if (!rawName) {
    return { match: null, score: 0 };
  }
  const normalizedRaw = normalizeOrderString(rawName);
  // Extraer tokens del nombre buscado (eliminando números y palabras comunes)
  const rawTokens = tokenizeOrder(rawName);
  let best = { match: null, score: 0 };

  menuItems.forEach(item => {
    const normalizedMenu = normalizeOrderString(item.nombre);
    const menuTokens = tokenizeOrder(item.nombre);
    let score = 0;
    
    // Coincidencia exacta
    if (normalizedMenu === normalizedRaw) {
      score = 1;
    }
    // Coincidencia por substring (uno contiene al otro)
    else if (normalizedMenu.includes(normalizedRaw) || normalizedRaw.includes(normalizedMenu)) {
      score = 0.85;
    }
    // Coincidencia por tokens: si todos los tokens del rawName están en el nombre del menú
    else if (rawTokens.length > 0 && menuTokens.length > 0) {
      const matchingTokens = rawTokens.filter(token => menuTokens.includes(token));
      if (matchingTokens.length === rawTokens.length && rawTokens.length > 0) {
        // Todos los tokens coinciden - score alto
        score = 0.8;
      } else if (matchingTokens.length > 0) {
        // Algunos tokens coinciden - usar similaridad de tokens
        score = computeTokenSimilarity(normalizedRaw, normalizedMenu);
        // Bonus si hay al menos un token importante (más de 3 caracteres) que coincide
        const importantTokens = rawTokens.filter(t => t.length > 3);
        const importantMatches = importantTokens.filter(t => menuTokens.includes(t));
        if (importantMatches.length > 0 && importantMatches.length === importantTokens.length) {
          score = Math.max(score, 0.75); // Asegurar score mínimo alto si todos los tokens importantes coinciden
        }
      } else {
        // Ningún token coincide - usar similaridad general
        score = computeTokenSimilarity(normalizedRaw, normalizedMenu);
      }
    }
    // Fallback: similaridad general
    else {
      score = computeTokenSimilarity(normalizedRaw, normalizedMenu);
    }

    if (score > best.score) {
      best = { match: item, score };
    }
  });

  return best;
}

/**
 * Encuentra los productos más similares del menú (para sugerencias)
 * @param {string} rawName - Nombre del producto que busca el cliente
 * @param {Array} menuItems - Array de productos del menú
 * @param {number} limit - Número máximo de sugerencias (default: 3)
 * @param {number} minScore - Score mínimo para incluir en sugerencias (default: 0.2)
 * @returns {Array} Array de productos similares ordenados por score descendente
 */
function findSimilarMenuItems(rawName, menuItems = [], limit = 3, minScore = 0.2) {
  if (!rawName || !menuItems.length) {
    return [];
  }
  
  const normalizedRaw = normalizeOrderString(rawName);
  const suggestions = [];
  
  menuItems.forEach(item => {
    const normalizedMenu = normalizeOrderString(item.nombre);
    const normalizedDesc = item.descripcion ? normalizeOrderString(item.descripcion) : '';
    
    let score = 0;
    
    // Coincidencia exacta
    if (normalizedMenu === normalizedRaw) {
      score = 1;
    }
    // Coincidencia parcial en nombre
    else if (normalizedMenu.includes(normalizedRaw) || normalizedRaw.includes(normalizedMenu)) {
      score = 0.85;
    }
    // Similaridad por tokens en nombre
    else {
      score = computeTokenSimilarity(normalizedRaw, normalizedMenu);
    }
    
    // También buscar en descripción si el score es bajo
    if (score < 0.5 && normalizedDesc) {
      const descScore = computeTokenSimilarity(normalizedRaw, normalizedDesc);
      if (descScore > score) {
        score = descScore * 0.8; // Descuento porque es en descripción, no nombre
      }
    }
    
    // Solo incluir si supera el score mínimo
    if (score >= minScore) {
      suggestions.push({ match: item, score });
    }
  });
  
  // Ordenar por score descendente y tomar los top N
  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.match);
}

function mapOrderItemsFromAnalysis(analysis, menuItems = []) {
  const items = Array.isArray(analysis?.pedido_items) ? analysis.pedido_items : [];
  const mapped = [];

  items.forEach(item => {
    const rawName =
      item?.nombre_detectado ||
      item?.producto ||
      item?.producto_detectado ||
      item?.comentarios ||
      '';
    if (!rawName || typeof rawName !== 'string') {
      return;
    }

    const quantityRaw = item?.cantidad_detectada || item?.cantidad || '1';
    let quantity = parseInt(quantityRaw, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      quantity = 1;
    }

    const { match, score } = findBestMenuMatch(rawName, menuItems);
    const menuMatch = score >= 0.55 ? match : null;
    const price = menuMatch ? Number.parseFloat(menuMatch.precio) : null;
    
    // Si no se encontró match, buscar sugerencias
    let suggestions = [];
    if (!menuMatch) {
      suggestions = findSimilarMenuItems(rawName, menuItems, 3, 0.2);
    }

    mapped.push({
      id_menu: menuMatch ? menuMatch.id : null,
      nombre_menu: menuMatch ? menuMatch.nombre : null,
      nombre: menuMatch ? menuMatch.nombre : rawName,
      cantidad: quantity,
      precio: price,
      subtotal: Number.isFinite(price) ? price * quantity : null,
      match_score: score,
      menuMatch: Boolean(menuMatch),
      comentarios: item?.comentarios || null,
      raw: rawName,
      // Nuevo: sugerencias cuando no hay match
      suggestions: suggestions.length > 0 ? suggestions.map(s => ({
        id: s.id,
        nombre: s.nombre,
        precio: s.precio,
        descripcion: s.descripcion
      })) : []
    });
  });

  return mapped;
}

function mergeOrderItems(existing = [], incoming = []) {
  if (!incoming.length) {
    return existing;
  }

  const result = [...existing];

  incoming.forEach(item => {
    const identifier = item.id_menu || normalizeOrderString(item.nombre);
    const existingIndex = result.findIndex(existingItem => {
      if (existingItem.id_menu && item.id_menu) {
        return existingItem.id_menu === item.id_menu;
      }
      return normalizeOrderString(existingItem.nombre) === identifier;
    });

    if (existingIndex >= 0) {
      result[existingIndex] = {
        ...result[existingIndex],
        ...item,
        cantidad: item.cantidad || result[existingIndex].cantidad || 1
      };
    } else {
      result.push(item);
    }
  });

  return result;
}

function recalculateOrderTotals(order) {
  if (!order) {
    return 0;
  }

  let total = 0;
  let pendingConfirmation = 0;

  order.items = (order.items || []).map(item => {
    const quantity = item.cantidad || 1;
    const price = Number.isFinite(item.precio) ? item.precio : Number.parseFloat(item.precio || '0');
    const subtotal = Number.isFinite(price) ? price * quantity : null;
    if (Number.isFinite(subtotal)) {
      total += subtotal;
    } else {
      pendingConfirmation += 1;
    }
    return {
      ...item,
      cantidad: quantity,
      precio: price,
      subtotal
    };
  });

  order.total = Number(total.toFixed(2));
  order.pendingItems = pendingConfirmation;
  return order.total;
}

/**
 * Formatea un precio para que suene natural al hablar
 * @param {number} price - Precio en euros (ej: 12.40)
 * @param {string} language - Idioma
 * @returns {string} Precio formateado (ej: "12 con 40 euros")
 */
function formatPriceForSpeech(price, language = 'es') {
  if (!Number.isFinite(price)) return '';
  
  const euros = Math.floor(price);
  const cents = Math.round((price - euros) * 100);
  
  if (language === 'en') {
    if (cents === 0) {
      return `${euros} ${euros === 1 ? 'euro' : 'euros'}`;
    }
    return `${euros} euros and ${cents} cents`;
  }
  
  // Español: "12 con 40 euros" (más natural que "12.40€")
  if (cents === 0) {
    return `${euros} ${euros === 1 ? 'euro' : 'euros'}`;
  }
  // Formato natural: "12 con 40 euros" (no "12 con 40 céntimos")
  return `${euros} con ${cents} euros`;
}

function buildOrderSummary(order, language = 'es', includePrices = true) {
  if (!order?.items || order.items.length === 0) {
    return language === 'en'
      ? 'I have not recorded any products yet.'
      : 'Todavía no he registrado ningún producto.';
  }

  const parts = order.items.map(item => {
    const name = item.nombre || item.nombre_menu || item.raw || 'producto';
    const label = item.menuMatch
      ? name
      : language === 'en'
        ? `${name} (confirmar)`
        : `${name} (por confirmar)`;
    const qty = item.cantidad || 1;
    
    // Formato de cantidad: "2 pizza margarita" en lugar de "2 × pizza margarita"
    let itemText = `${qty} ${label}`;
    
    // Formato de precio: "12 con 40 euros" en lugar de "12.40€"
    if (includePrices && Number.isFinite(item.subtotal)) {
      const priceText = formatPriceForSpeech(item.subtotal, language);
      itemText += ` - ${priceText}`;
    }
    
    return itemText;
  });

  return parts.join(', ');
}

function summarizeMenuSample(menuItems = [], language = 'es', maxItems = 5) {
  if (!menuItems.length) {
    return '';
  }
  const sample = menuItems.slice(0, maxItems).map(item => item.nombre);
  const intro = language === 'en'
    ? 'Some dishes available are'
    : 'Algunos platos disponibles son';
  return `${intro}: ${sample.join(', ')}.`;
}

function determineOrderNextStep(order) {
  if (!order || !order.items || order.items.length === 0) {
    return 'order_collect_items';
  }
  if (order.pendingItems > 0) {
    return 'order_collect_items';
  }
  if (!order.address) {
    return 'order_ask_address';
  }
  if (!order.name) {
    return 'order_ask_name';
  }
  // Preguntar por observaciones/alergias antes de confirmar (solo si no se han proporcionado)
  if (order.notes === null || order.notes === undefined) {
    return 'order_ask_notes';
  }
  return 'order_confirm';
}

function ensureOrderState(state) {
  if (!state.order) {
    state.order = {
      items: [],
      address: null,
      name: null,
      phone: state.phone || null,
      notes: null,
      total: 0,
      rawHistory: [],
      pendingSuggestions: [] // Sugerencias de productos cuando no se encuentra match
    };
  } else {
    state.order.items = state.order.items || [];
    state.order.rawHistory = state.order.rawHistory || [];
    state.order.pendingSuggestions = state.order.pendingSuggestions || [];
    if (!state.order.phone && state.phone) {
      state.order.phone = state.phone;
    }
  }
  return state.order;
}

async function updateOrderStateFromAnalysis(state, analysis, userInput, callLogger) {
  const order = ensureOrderState(state);
  const menuItems = await loadMenuItems();

  if (userInput) {
    order.rawHistory.push({
      text: userInput,
      timestamp: new Date().toISOString()
    });
  }

  const mappedItems = mapOrderItemsFromAnalysis(analysis, menuItems);
  
  // Detectar items sin match que tienen sugerencias
  const itemsWithSuggestions = mappedItems.filter(item => !item.menuMatch && item.suggestions && item.suggestions.length > 0);
  
  if (mappedItems.length) {
    order.items = mergeOrderItems(order.items, mappedItems);
    
    // Guardar sugerencias en el estado del pedido para mostrarlas
    if (itemsWithSuggestions.length > 0) {
      order.pendingSuggestions = itemsWithSuggestions.map(item => ({
        requested: item.raw,
        cantidad: item.cantidad,
        suggestions: item.suggestions
      }));
    } else {
      // Limpiar sugerencias si ya no hay items sin match
      order.pendingSuggestions = [];
    }
  }

  if (analysis?.direccion_entrega && !order.address) {
    order.address = analysis.direccion_entrega;
  }
  if (analysis?.nombre_cliente) {
    const extractedName = extractName(analysis.nombre_cliente);
    if (extractedName) {
      order.name = extractedName;
    }
  }
  if (analysis?.telefono_cliente && !order.phone) {
    order.phone = analysis.telefono_cliente;
  }
  if (analysis?.notas_pedido) {
    order.notes = analysis.notas_pedido;
  }

  recalculateOrderTotals(order);

  if (callLogger) {
    // Order state updated - no log necesario
  }

  return order;
}

function getOrderStepMessage(order, step, language = 'es', menuItems = []) {
  const summary = buildOrderSummary(order, language, true);
  
  // Construir mensaje de sugerencias si hay items sin match
  let suggestionsMessage = '';
  if (order.pendingSuggestions && order.pendingSuggestions.length > 0) {
    const firstSuggestion = order.pendingSuggestions[0];
    if (firstSuggestion.suggestions && firstSuggestion.suggestions.length > 0) {
      const suggestionsList = firstSuggestion.suggestions
        .slice(0, 3)
        .map((s, idx) => {
          const priceStr = s.precio ? formatPriceForSpeech(s.precio, language) : '';
          return `${idx + 1}. ${s.nombre}${priceStr ? ` (${priceStr})` : ''}`;
        })
        .join(', ');
      
      if (language === 'en') {
        suggestionsMessage = ` I couldn't find "${firstSuggestion.requested}" in our menu. We have similar options: ${suggestionsList}. Which one would you like?`;
      } else {
        suggestionsMessage = ` No tenemos "${firstSuggestion.requested}" en nuestro menú. Tenemos opciones similares: ${suggestionsList}. ¿Cuál te gustaría?`;
      }
    }
  }
  
  switch (step) {
    case 'order_collect_items':
      // Si hay sugerencias pendientes, mostrarlas primero
      if (suggestionsMessage) {
        return suggestionsMessage;
      }
      
      return order.items.length > 0 && order.pendingItems === 0
        ? (language === 'en'
            ? `I have your order as: ${summary}. Anything else you would like to add?`
            : `Vale, tengo anotado: ${summary}. ¿Quiere añadir algo más?`)
        : (language === 'en'
            ? `Sure, tell me what you would like to order. ${summarizeMenuSample(menuItems, 'en')}`
            : `Claro, dígame qué le gustaría pedir. ${summarizeMenuSample(menuItems, language)}`);
    case 'order_ask_address':
      return language === 'en'
        ? `Great. I have the order as: ${summary}. What is the delivery address?`
        : `Vale, de momento tengo: ${summary}. ¿Cuál es la dirección de entrega?`;
    case 'order_ask_name':
      return language === 'en'
        ? 'A name for the order, please.'
        : '¿A nombre de quién será el pedido?';
    case 'order_ask_phone':
      return language === 'en'
        ? 'Could you give me a phone number to contact you if needed?'
        : '¿Me facilitas un número de teléfono para contactarte si hace falta?';
    case 'order_ask_notes': {
      const messages = {
        es: [
          `Vale, tengo su pedido: ${summary}. ¿Tiene alguna alergia, restricción alimentaria o algo especial que quiera añadir? Si no, solo diga "no" o "nada".`,
          `Perfecto, tengo anotado: ${summary}. ¿Hay algo más que deba saber? Alergias, preferencias o algo especial. Si no, diga "no".`,
          `Vale, su pedido es: ${summary}. ¿Alguna alergia o preferencia especial? Si no tiene ninguna, diga "no".`,
          `Perfecto, tengo: ${summary}. ¿Quiere añadir algo más? Alergias, modificaciones o algo especial. Si no, diga "nada".`,
          `Vale, pedido: ${summary}. ¿Tiene alguna alergia o algo que deba saber? Si no, solo diga "no".`
        ],
        en: [
          `Perfect. I have your order: ${summary}. Do you have any allergies, dietary restrictions, or special requests? If not, just say "no" or "nothing".`,
          `Great. Your order is: ${summary}. Is there anything else I should know? Allergies, preferences, or special requests. If not, say "no".`,
          `Perfect, I have: ${summary}. Any allergies or special preferences? If not, just say "no".`,
          `Great. Order: ${summary}. Anything else to add? Allergies, modifications, or special requests. If not, say "nothing".`,
          `Perfect. I have your order: ${summary}. Any allergies or anything I should know? If not, just say "no".`
        ]
      };
      const langMessages = messages[language] || messages.es;
      return getRandomMessage(langMessages);
    }
    case 'order_confirm': {
      const totalStr = order.total ? formatPriceForSpeech(order.total, language) : (language === 'en' ? 'pending' : 'pendiente');
      return language === 'en'
        ? `Order summary: ${summary}. Total: ${totalStr}. Shall we confirm and prepare it?`
        : `Resumen del pedido: ${summary}. Total: ${totalStr}. ¿Confirmamos para prepararlo?`;
    }
    case 'order_complete':
      return language === 'en'
        ? 'Perfect! Your delivery order is confirmed. We will prepare it right away.'
        : '¡Vale! Su pedido a domicilio queda confirmado. Lo preparamos de inmediato.';
    default:
      return language === 'en'
        ? 'Could you repeat that, please?'
        : '¿Podrías repetirlo, por favor?';
  }
}

async function handleOrderIntent(state, analysis, callLogger, userInput) {
  await updateOrderStateFromAnalysis(state, analysis, userInput, callLogger);
  const order = ensureOrderState(state);
  const menuItems = await loadMenuItems();
  const nextStep = determineOrderNextStep(order);
  state.step = nextStep;
  return {
    message: getOrderStepMessage(order, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

async function handleOrderCollectItems(state, userInput, callLogger, performanceMetrics = null) {
  const order = ensureOrderState(state);
  
  // Si hay sugerencias pendientes, verificar si el usuario seleccionó una
  if (order.pendingSuggestions && order.pendingSuggestions.length > 0) {
    const firstSuggestion = order.pendingSuggestions[0];
    const userInputLower = userInput.toLowerCase().trim();
    
    // Verificar si el usuario seleccionó una opción numérica (1, 2, 3) o mencionó el nombre
    let selectedSuggestion = null;
    
    // Opción numérica
    const numberMatch = userInputLower.match(/\b([123]|uno|dos|tres|primera|segunda|tercera|primero|segundo|tercero)\b/);
    if (numberMatch) {
      let index = 0;
      const matchText = numberMatch[1];
      if (matchText === '1' || matchText === 'uno' || matchText === 'primera' || matchText === 'primero') index = 0;
      else if (matchText === '2' || matchText === 'dos' || matchText === 'segunda' || matchText === 'segundo') index = 1;
      else if (matchText === '3' || matchText === 'tres' || matchText === 'tercera' || matchText === 'tercero') index = 2;
      
      if (index < firstSuggestion.suggestions.length) {
        selectedSuggestion = firstSuggestion.suggestions[index];
      }
    }
    
    // Buscar por nombre del producto
    if (!selectedSuggestion) {
      for (const suggestion of firstSuggestion.suggestions) {
        const suggestionName = suggestion.nombre.toLowerCase();
        if (userInputLower.includes(suggestionName) || suggestionName.includes(userInputLower)) {
          selectedSuggestion = suggestion;
          break;
        }
      }
    }
    
    // Si seleccionó una sugerencia, añadirla al pedido
    if (selectedSuggestion) {
      const newItem = {
        id_menu: selectedSuggestion.id,
        nombre_menu: selectedSuggestion.nombre,
        nombre: selectedSuggestion.nombre,
        cantidad: firstSuggestion.cantidad,
        precio: Number.parseFloat(selectedSuggestion.precio),
        subtotal: Number.parseFloat(selectedSuggestion.precio) * firstSuggestion.cantidad,
        match_score: 1,
        menuMatch: true,
        comentarios: `Sugerido para: ${firstSuggestion.requested}`,
        raw: firstSuggestion.requested,
        suggestions: []
      };
      
      order.items.push(newItem);
      order.pendingSuggestions = []; // Limpiar sugerencias
      recalculateOrderTotals(order);
      
      const menuItems = await loadMenuItems();
      const nextStep = determineOrderNextStep(order);
      state.step = nextStep;
      
      const summary = buildOrderSummary(order, state.language || 'es', true);
      const message = state.language === 'en'
        ? `Perfect! I've added ${selectedSuggestion.nombre} to your order. ${summary}. Anything else?`
        : `¡Vale! He añadido ${selectedSuggestion.nombre} a su pedido. ${summary}. ¿Algo más?`;
      
      return {
        message: message,
        gather: true
      };
    }
    
    // Si no seleccionó ninguna sugerencia, continuar con el análisis normal
    // (puede que esté pidiendo algo diferente)
  }
  
  // Análisis normal con Gemini
  const analysis = await analyzeReservationWithGemini(userInput, { 
    callSid: state.callSid, 
    step: state.step,
    state: state,  // Pasar estado completo para incluir historial y datos recopilados
    performanceMetrics: performanceMetrics
  });
  await updateOrderStateFromAnalysis(state, analysis || {}, userInput, callLogger);
  const orderUpdated = ensureOrderState(state);
  const menuItems = await loadMenuItems();
  const nextStep = determineOrderNextStep(orderUpdated);
  state.step = nextStep;
  return {
    message: getOrderStepMessage(orderUpdated, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

async function handleOrderAddressStep(state, userInput) {
  const order = ensureOrderState(state);
  order.address = userInput.trim();
  const nextStep = determineOrderNextStep(order);
  state.step = nextStep;
  const menuItems = await loadMenuItems();
  return {
    message: getOrderStepMessage(order, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

async function handleOrderNameStep(state, userInput) {
  const order = ensureOrderState(state);
  const extracted = extractName(userInput);
  order.name = extracted || userInput.trim();
  const nextStep = determineOrderNextStep(order);
  state.step = nextStep;
  const menuItems = await loadMenuItems();
  return {
    message: getOrderStepMessage(order, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

async function handleOrderPhoneStep(state, userInput) {
  const order = ensureOrderState(state);
  const phone = extractPhoneNumber(userInput) || userInput.replace(/\s+/g, '');
  if (!phone || phone.length < 6) {
    return {
      message: state.language === 'en'
        ? 'I could not capture the phone number. Could you repeat it with all the digits, please?'
        : 'No he captado bien el número. ¿Podrías repetirlo con todos los dígitos, por favor?',
      gather: true
    };
  }

  order.phone = phone;
  const nextStep = determineOrderNextStep(order);
  state.step = nextStep;
  const menuItems = await loadMenuItems();
  return {
    message: getOrderStepMessage(order, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

async function handleOrderNotesStep(state, userInput, callLogger) {
  const order = ensureOrderState(state);
  const userInputLower = userInput.toLowerCase().trim();
  
  // Detectar si el usuario dice que no tiene nada que añadir
  const noNotesPatterns = [
    // Respuestas directas
    /^(no|nada|ninguna|ninguno|sin|sin nada|ninguna cosa)$/i,
    /^no (tengo|hay|tiene|necesito|quiero)/i,
    /^(no hay|no tengo|no tiene|no necesito|no quiero)/i,
    // Confirmaciones positivas sin observaciones
    /^(todo bien|está bien|está perfecto|perfecto|bien|ok|okay|vale|correcto)$/i,
    /^(está todo bien|todo correcto|así está bien|así está perfecto)$/i,
    // Negaciones más elaboradas
    /^(no tengo nada|no hay nada|no necesito nada|no quiero nada|sin nada más)$/i,
    /^(no tengo alergias|no tengo restricciones|sin alergias|sin restricciones)$/i,
    /^(no, nada|no nada|nada más|nada especial)$/i
  ];
  
  const hasNoNotes = noNotesPatterns.some(pattern => pattern.test(userInputLower));
  
  if (hasNoNotes) {
    // Usuario no tiene observaciones
    order.notes = '';
  } else {
    // Usuario tiene observaciones - usar Gemini para extraer información relevante
    try {
      const analysis = await analyzeReservationWithGemini(userInput, {
        callSid: state.callSid,
        step: 'order_ask_notes',
        state: state,  // Pasar estado completo para incluir historial y datos recopilados
        performanceMetrics: null
      });
      
      // Extraer notas del análisis de Gemini o usar el input directamente
      if (analysis?.notas_pedido) {
        order.notes = analysis.notas_pedido;
      } else {
        // Si Gemini no extrajo notas específicas, usar el input completo
        order.notes = userInput.trim();
      }
    } catch (error) {
      // Si falla Gemini, usar el input directamente
      console.warn('⚠️ [ORDER] Error analizando observaciones con Gemini, usando input directo:', error.message);
      order.notes = userInput.trim();
    }
  }
  
  const nextStep = determineOrderNextStep(order);
  state.step = nextStep;
  const menuItems = await loadMenuItems();
  return {
    message: getOrderStepMessage(order, nextStep, state.language || 'es', menuItems),
    gather: true
  };
}

function createOrderConfirmationMessage(order, language = 'es') {
  return getOrderStepMessage(order, 'order_confirm', language);
}

async function saveOrder(state, callLogger) {
  const order = state.order;
  if (!order || !order.items || order.items.length === 0) {
    return { success: false, error: 'NO_ITEMS' };
  }

  const connection = await createConnection();
  try {
    await connection.beginTransaction();
    const observaciones = JSON.stringify({
      items: order.items,
      notes: order.notes || null,
      history: order.rawHistory || []
    });

    const [result] = await connection.execute(
      `INSERT INTO pedidos_realizados
        (cliente_nombre, cliente_telefono, direccion_entrega, observaciones, total, estado)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        order.name || 'Cliente',
        order.phone || state.phone || null,
        order.address || null,
        observaciones,
        Number.isFinite(order.total) ? order.total : 0,
        'pendiente'
      ]
    );

    await connection.commit();
    const orderId = result.insertId;
    if (callLogger) {
      // Order saved - no log necesario (ya está en PERF_METRICS)
    }
    return { success: true, orderId };
  } catch (error) {
    await connection.rollback();
    logger.error('ORDER_SAVE_FAILED', { message: error.message });
    return { success: false, error: error.message };
  } finally {
    await connection.end();
  }
}

async function handleOrderConfirm(state, userInput, callLogger) {
  const order = ensureOrderState(state);
  const confirmation = handleConfirmationResponse(userInput.toLowerCase());

  if (confirmation.action === 'confirm') {
    const saveResult = await saveOrder(state, callLogger);
    if (!saveResult.success) {
      return {
        message: state.language === 'en'
          ? 'There was an error saving the order. Could you repeat it later or contact the restaurant?'
          : 'Ha ocurrido un error guardando el pedido. ¿Podrías repetirlo más tarde o contactar con el restaurante?',
        gather: false
      };
    }

    state.order.orderId = saveResult.orderId;
    state.step = 'order_complete';

    await sendOrderConfirmationRcs({
      phone: order.phone || state.phone,
      name: order.name,
      total: order.total,
      items: order.items,
      address: order.address,
      language: state.language || 'es'
    }, callLogger);

    return {
      message: getOrderStepMessage(order, 'order_complete', state.language || 'es'),
      gather: false
    };
  }

  if (confirmation.action === 'modify' || confirmation.action === 'restart') {
    state.step = 'order_collect_items';
    return {
      message: state.language === 'en'
        ? 'Of course. Tell me what changes you would like to make to the order.'
        : 'Vale. Dígame qué cambios quiere hacer en el pedido.',
      gather: true
    };
  }

  return {
    message: state.language === 'en'
      ? 'I did not catch that. Could you confirm if the order is correct?'
      : 'No lo he entendido. ¿Me confirmas si el pedido está correcto?',
    gather: true
  };
}

async function processConversationStep(state, userInput, callLogger, performanceMetrics = null, isProcessing = false) {
  // LOGGING: Loggear entrada a processConversationStep (compacto)
  const stepStartTime = Date.now();
  const inputPreview = userInput ? (userInput.length > 100 ? userInput.substring(0, 100) + '...' : userInput) : 'empty';
  if (callLogger) {
    // Process step start - no log necesario
  }
  
  const step = state.step;
  const text = userInput.toLowerCase();

  const attachStep = (data) => {
    if (!data) {
      return { step: state.step };
    }
    if (typeof data === 'object' && !Array.isArray(data)) {
      return { step: state.step, ...data };
    }
    return { step: state.step, value: data };
  };

  const log = callLogger
    ? {
        debug: (message, data) => callLogger.debug(message, attachStep(data)),
        info: (message, data) => callLogger.info(message, attachStep(data)),
        warn: (message, data) => callLogger.warn(message, attachStep(data)),
        error: (message, data) => callLogger.error(message, attachStep(data)),
        gemini: (message, data) => callLogger.gemini(message, attachStep(data)),
        reservation: (message, data) => callLogger.reservation(message, attachStep(data))
      }
    : {
        debug: (message, data) => logger.debug(message, attachStep(data)),
        info: (message, data) => logger.info(message, attachStep(data)),
        warn: (message, data) => logger.warn(message, attachStep(data)),
        error: (message, data) => logger.error(message, attachStep(data)),
        gemini: (message, data) => logger.gemini(message, attachStep(data)),
        reservation: (message, data) => logger.reservation(message, attachStep(data))
      };

  // ===== LOG COMPLETO DEL ESTADO ACTUAL =====
  log.info('🤖 BOT_STATE_OVERVIEW', {
    currentStep: step,
    userInput: userInput || '(vacío)',
    inputLength: userInput ? userInput.length : 0,
    language: state.language,
    isProcessing: isProcessing,
    hasPendingGeminiText: !!state.pendingGeminiText,
    currentData: {
      personas: state.data?.NumeroReserva || null,
      fecha: state.data?.FechaReserva || null,
      hora: state.data?.HoraReserva || null,
      nombre: state.data?.NomReserva || null,
      telefono: state.data?.TelefonReserva || state.phone || null,
      horaError: state.data?.horaError || null,
      comensalesError: state.data?.comensalesError || null
    },
    conversationHistoryLength: state.conversationHistory?.length || 0,
    geminiAnalysisAvailable: !!state.geminiAnalysis,
    geminiProcessing: state.geminiProcessing || false
  });

  log.debug('PROCESS_STEP_START', { 
    input: userInput,
    step: step,
    reasoning: `Iniciando procesamiento del paso '${step}' con input del usuario`
  });

  // PASOS CRÍTICOS donde debemos ser más cuidadosos al detectar cancelación
  // para evitar falsos positivos (por ejemplo, "15 de enero" contiene "no")
  const criticalReservationSteps = ['ask_date', 'ask_time', 'ask_name', 'confirm'];
  
  // Variable para almacenar el análisis de Gemini y reutilizarlo
  let geminiAnalysis = null;
  
  // ===== VERIFICACIÓN DE CANCELACIÓN CON LÓGICA DETALLADA =====
  // OPTIMIZACIÓN: Solo verificar cancelación si el input es suficientemente largo
  // para evitar falsos positivos con respuestas cortas como "no" que pueden ser válidas
  if (userInput && userInput.trim() && userInput.trim().length > 2) {
    let shouldCheckCancellation = true;
    
    log.debug('🔍 CANCELATION_CHECK_START', {
      step: step,
      inputLength: userInput.trim().length,
      isCriticalStep: criticalReservationSteps.includes(step),
      reasoning: `Verificando si el usuario quiere cancelar. Paso actual: ${step}, input: "${userInput.substring(0, 50)}"`
    });
    
    // En pasos críticos de reserva, verificar primero si la respuesta es un dato válido usando Gemini
    if (criticalReservationSteps.includes(step) && step !== 'confirm') {
      log.info('📊 CRITICAL_STEP_DETECTED', {
        step: step,
        reasoning: `Paso crítico detectado. Usando Gemini para verificar si hay datos válidos antes de buscar cancelación`,
        expectedField: step === 'ask_date' ? 'fecha' : step === 'ask_time' ? 'hora' : step === 'ask_name' ? 'nombre' : 'unknown'
      });
      
      // Usar Gemini para verificar si hay datos válidos en la respuesta
      // Guardar el análisis para reutilizarlo más adelante y evitar llamadas duplicadas
      const analysisStartTime = Date.now();
      geminiAnalysis = await analyzeReservationWithGemini(userInput, { 
        callSid: state.callSid, 
        step: state.step,
        state: state,  // Pasar estado completo para incluir historial y datos recopilados
        performanceMetrics: performanceMetrics
      });
      const analysisTime = Date.now() - analysisStartTime;
      
      let isValidData = false;
      let extractedValue = null;
      let confidence = null;
      
      if (geminiAnalysis) {
        log.gemini('✅ GEMINI_ANALYSIS_RECEIVED', {
          analysisTimeMs: analysisTime,
          intencion: geminiAnalysis.intencion,
          reasoning: `Gemini analizó el input y extrajo información. Revisando si hay datos válidos para el paso '${step}'`
        });
        
        // Verificar según el paso actual
        switch (step) {
          case 'ask_date':
            isValidData = geminiAnalysis.fecha !== null && geminiAnalysis.fecha_porcentaje_credivilidad !== '0%';
            extractedValue = geminiAnalysis.fecha;
            confidence = geminiAnalysis.fecha_porcentaje_credivilidad;
            break;
          case 'ask_time':
            isValidData = geminiAnalysis.hora !== null && geminiAnalysis.hora_porcentaje_credivilidad !== '0%';
            extractedValue = geminiAnalysis.hora;
            confidence = geminiAnalysis.hora_porcentaje_credivilidad;
            break;
          case 'ask_name':
            isValidData = geminiAnalysis.nombre !== null && geminiAnalysis.nombre_porcentaje_credivilidad !== '0%';
            extractedValue = geminiAnalysis.nombre;
            confidence = geminiAnalysis.nombre_porcentaje_credivilidad;
            
            // MEJORADO: Si no hay nombre válido, verificar si el texto contiene frases relacionadas con nombres
            // En este caso, NO es cancelación, sino una frase incompleta
            if (!isValidData) {
              const textLower = (userInput || '').toLowerCase().trim();
              const nameRelatedPatterns = [
                /a nombre de/i,
                /nombre de/i,
                /los nombres de/i,
                /el nombre de/i,
                /un nombre de/i,
                /una nombre de/i,
                /mi nombre de/i,
                /su nombre de/i,
                /sus nombres de/i,
                /^a nombre de\s*$/i,
                /^nombre de\s*$/i,
                /^los nombres de\s*$/i,
                /^el nombre de\s*$/i,
                /me llamo/i,
                /se llama/i,
                /se llaman/i,
                /llamarse/i,
                /llamarnos/i,
                /mi nombre/i,
                /su nombre/i,
                /sus nombres/i,
                /como.*nombre/i,
                /que.*nombre/i,
                /cual.*nombre/i
              ];
              
              const isNameRelated = nameRelatedPatterns.some(pattern => pattern.test(textLower));
              
              if (isNameRelated) {
                log.info('✅ NAME_RELATED_PHRASE_DETECTED', {
                  step: step,
                  userInput: userInput,
                  reasoning: `Se detectó una frase relacionada con nombres ("${userInput}"). NO es cancelación, sino una frase incompleta. Continuar pidiendo el nombre.`
                });
                // Marcar como dato válido (aunque no haya nombre) para evitar buscar cancelación
                // Esto hace que el sistema simplemente pida el nombre de nuevo
                isValidData = true; // Esto hace que shouldCheckCancellation = false
                extractedValue = null; // No hay nombre extraído, pero no es cancelación
                confidence = '0%'; // Baja confianza porque no hay nombre
              }
            }
            break;
        }
        
        log.gemini('🔎 DATA_VALIDATION_RESULT', {
          step: step,
          isValidData: isValidData,
          extractedValue: extractedValue,
          confidence: confidence,
          reasoning: isValidData 
            ? `Se detectó un dato válido (${extractedValue}) con confianza ${confidence}. NO es cancelación.`
            : `No se detectó un dato válido para el paso '${step}'. Continuar verificando cancelación.`
        });
      } else {
        log.warn('⚠️ GEMINI_ANALYSIS_NULL', {
          reasoning: 'Gemini no devolvió análisis. Continuar con verificación de cancelación por defecto.'
        });
      }
      
      // Si se detectó un dato válido, NO buscar cancelación
      if (isValidData) {
        log.info('✅ CRITICAL_DATA_DETECTED_SKIP_CANCEL_CHECK', {
          step: step,
          extractedValue: extractedValue,
          confidence: confidence,
          reasoning: `Dato válido detectado (${extractedValue}). Saltando verificación de cancelación para evitar falsos positivos.`
        });
        shouldCheckCancellation = false;
      }
    } else if (step === 'confirm') {
      log.debug('✅ CONFIRMATION_STEP_DETECTED', {
        reasoning: 'Estamos en paso de confirmación. Usando handleConfirmationResponse para verificar respuesta.'
      });
      
      // Las confirmaciones usan handleConfirmationResponse
      const confirmResult = handleConfirmationResponse(text);
      log.debug('📋 CONFIRMATION_RESPONSE_ANALYZED', {
        action: confirmResult.action,
        reasoning: `Respuesta de confirmación analizada: ${confirmResult.action}`
      });
      
      if (confirmResult.action !== 'clarify') {
        log.info('✅ CRITICAL_CONFIRMATION_DETECTED', {
          action: confirmResult.action,
          reasoning: 'Confirmación válida detectada. Saltando verificación de cancelación.'
        });
        shouldCheckCancellation = false;
      }
    }
    
    // Verificar cancelación solo si es apropiado y el input es suficientemente largo
    // EXCLUIR 'greeting' y 'ask_intention' porque usan detectIntentionWithGemini que es más preciso
    // También excluir 'ask_people' porque "no" puede ser una respuesta válida (negativa)
    const excludedSteps = ['greeting', 'ask_intention', 'ask_people'];
    const canCheckCancellation = shouldCheckCancellation && !excludedSteps.includes(step);
    
    log.debug('🔍 CANCELATION_CHECK_DECISION', {
      shouldCheckCancellation: shouldCheckCancellation,
      step: step,
      isExcludedStep: excludedSteps.includes(step),
      canCheckCancellation: canCheckCancellation,
      reasoning: canCheckCancellation 
        ? `Verificando cancelación porque: paso no excluido (${step}), shouldCheckCancellation=${shouldCheckCancellation}`
        : `NO verificando cancelación porque: ${excludedSteps.includes(step) ? `paso excluido (${step})` : `shouldCheckCancellation=false`}`
    });
    
    if (canCheckCancellation && isCancellationRequest(userInput)) {
      log.info('🚫 CANCELLATION_REQUEST_DETECTED', {
        userInput: userInput,
        currentStep: step,
        reasoning: `El usuario expresó intención de cancelar. Input: "${userInput}"`
      });
      
      // Si ya está en proceso de cancelación, confirmar
      if (step === 'cancelling') {
        log.info('🔄 CANCELLATION_CONFIRMATION', {
          reasoning: 'Ya estamos en proceso de cancelación. Confirmando cancelación.'
        });
        return await handleCancellationConfirmation(state, userInput);
      }
      
      // Iniciar proceso de cancelación
      log.info('🚫 STARTING_CANCELLATION_PROCESS', {
        reasoning: 'Iniciando proceso de cancelación de reserva.'
      });
      return await handleCancellationRequest(state, userInput);
    } else if (canCheckCancellation) {
      log.debug('✅ NO_CANCELLATION_DETECTED', {
        reasoning: `Verificación de cancelación completada. No se detectó intención de cancelar.`
      });
    }
  } else {
    log.debug('⏭️ SKIP_CANCELATION_CHECK', {
      inputLength: userInput ? userInput.trim().length : 0,
      reasoning: `Input muy corto (${userInput ? userInput.trim().length : 0} caracteres). Saltando verificación de cancelación para evitar falsos positivos.`
    });
  }

  // NO resetear el estado si estamos en un paso de reserva y el input es muy corto
  // Esto previene que el sistema vuelva a greeting cuando no debería
  if (step !== 'greeting' && step !== 'ask_intention' && (!userInput || userInput.trim().length < 2)) {
    log.warn('INPUT_TOO_SHORT');
    // Mantener el paso actual y pedir clarificación según el paso
    const unclearMessages = {
      ask_people: [
        'Disculpe, no he captado bien. ¿Para cuántas personas?',
        'Lo siento, no lo he oído bien. ¿Cuántas personas serán?',
        'Perdón, no he entendido. ¿Para cuántas personas será la mesa?',
        'Disculpe, no lo he entendido bien. ¿Cuántas personas?',
        'Lo siento, no lo he captado. ¿Para cuántas personas?'
      ],
      ask_date: [
        'Perdón, no lo he entendido bien. ¿Para qué día les gustaría venir?',
        'Disculpe, no he captado la fecha. ¿Qué día les conviene?',
        'Lo siento, no lo he oído bien. ¿Para qué día?',
        'Disculpe, no lo he entendido. ¿Qué día prefieren?',
        'Perdón, no lo he captado. ¿Para qué día?'
      ],
      ask_time: [
        'Disculpe, no he captado bien. ¿A qué hora les gustaría venir?',
        'Perdón, no lo he entendido. ¿A qué hora les viene bien?',
        'Lo siento, no lo he oído bien. ¿A qué hora?',
        'Disculpe, no lo he entendido. ¿Qué hora prefieren?',
        'Perdón, no lo he captado. ¿A qué hora?'
      ],
      ask_name: [
        'Perdón, no lo he entendido. ¿A nombre de quién será la reserva?',
        'Disculpe, no he captado el nombre. ¿Cómo se llama?',
        'Lo siento, no lo he oído bien. ¿Me puede decir su nombre?',
        'Disculpe, no lo he entendido. ¿Cuál es su nombre?',
        'Perdón, no lo he captado. ¿A nombre de quién?'
      ],
      default: [
        'Perdón, no he entendido bien. ¿Podría repetirlo, por favor?',
        'Disculpe, no lo he captado. ¿Podría repetir, por favor?',
        'Lo siento, no lo he oído bien. ¿Podría decirlo otra vez?',
        'Disculpe, no lo he entendido. ¿Puede repetirlo?',
        'Perdón, no lo he captado. ¿Puede decirlo otra vez?'
      ]
    };
    
    let messageArray = unclearMessages.default;
    if (step === 'ask_people') {
      messageArray = unclearMessages.ask_people;
    } else if (step === 'ask_date') {
      messageArray = unclearMessages.ask_date;
    } else if (step === 'ask_time') {
      messageArray = unclearMessages.ask_time;
    } else if (step === 'ask_name') {
      messageArray = unclearMessages.ask_name;
    } else if (step.startsWith('cancel_')) {
      messageArray = [
        'Disculpe, no he entendido bien. ¿Podría repetir su respuesta, por favor?',
        'Lo siento, no lo he captado. ¿Podría repetirlo?',
        'Perdón, no lo he oído bien. ¿Puede repetir, por favor?'
      ];
    }
    
    return {
      message: getRandomMessage(messageArray),
      gather: true
    };
  }
  
  // El idioma se detecta ahora dentro de analyzeReservationWithGemini para evitar llamadas redundantes
  // Solo actualizar si no se detectó en el análisis
  if (userInput && userInput.trim() && step === 'greeting') {
    // El idioma se detectará en analyzeReservationWithGemini, no necesitamos llamada separada
    log.debug('STATE_OVERVIEW', { language: state.language });
  }

  switch (step) {
    case 'greeting':
      // Primera interacción - saludo general
      log.info('👋 GREETING_STEP_START', { 
        language: state.language, 
        userInput: userInput || '(vacío)',
        reasoning: `Iniciando paso de saludo. ${userInput ? 'Usuario ha proporcionado input, analizando con Gemini...' : 'Sin input, mostrando saludo estándar.'}`
      });
      
      // Si hay input del usuario, analizar directamente con Gemini (ya detecta intención e idioma)
      if (userInput && userInput.trim()) {
        log.info('🧠 ANALYZING_GREETING_INPUT_WITH_GEMINI', {
          userInput: userInput,
          reasoning: `Usuario proporcionó input en el saludo: "${userInput}". Usando Gemini para extraer toda la información posible (intención, idioma, datos de reserva).`
        });
        
        // Usar Gemini para extraer TODO de la primera frase (incluye intención e idioma)
        const analysis = await analyzeReservationWithGemini(userInput, { 
          callSid: state.callSid, 
          step: state.step,
          state: state,  // Pasar estado completo para incluir historial y datos recopilados
          performanceMetrics: performanceMetrics
        });
        
        if (analysis) {
          const geminiData = `${analysis.comensales || '-'}p, ${analysis.fecha || '-'}, ${analysis.hora || '-'}, ${analysis.nombre || '-'}`;
          log.info(`[GEMINI] intent=${analysis.intencion} lang=${analysis.idioma_detectado} data=[${geminiData}]`);
          
          // MEJORADO: Actualizar idioma ANTES de procesar la intención para que todas las respuestas usen el idioma correcto
          if (analysis.idioma_detectado) {
            // Validar que el idioma detectado sea válido
            const validLangs = ['es', 'en', 'de', 'fr', 'it', 'pt'];
            const detectedLang = validLangs.includes(analysis.idioma_detectado) 
              ? analysis.idioma_detectado 
              : 'es';
            
            if (detectedLang !== state.language) {
              const oldLanguage = state.language;
              state.language = detectedLang;
              log.info(`[LANG] ${oldLanguage} → ${detectedLang}`);
            } else if (!state.language) {
              state.language = detectedLang;
              log.info(`[LANG] init=${detectedLang}`);
            }
          } else if (!state.language) {
            state.language = 'es';
            log.info(`[LANG] fallback=es`);
          }
          
          const intention = analysis.intencion || 'reservation';
          log.info(`[INTENT] ${intention}`);
          
          if (intention === 'reservation') {
          
            // Aplicar los datos extraídos al estado
            const applyResult = await applyGeminiAnalysisToState(analysis, state, callLogger, userInput);
            
            // Si hay error de validación (ej: demasiadas personas), manejar
            if (!applyResult.success && applyResult.error === 'people_too_many') {
              const maxPeopleMessages = getMaxPeopleExceededMessages(state.language, applyResult.maxPersonas);
              return {
                message: getRandomMessage(maxPeopleMessages),
                gather: true
              };
            }
            
            // Verificar si hay error de horario (validado por Gemini)
            if (state.data.horaError === 'fuera_horario') {
              const timeErrorMessages = getTimeOutOfHoursMessages(state.language, state.data.HoraReserva);
              // Limpiar el error y la hora para que el usuario pueda proporcionar otra
              delete state.data.HoraReserva;
              delete state.data.horaError;
              return {
                message: getRandomMessage(timeErrorMessages),
                gather: true
              };
            }
            
            // Determinar qué falta
            const missing = determineMissingFields(analysis, state.data);
            
            const currentData = `${state.data?.NumeroReserva || '-'}p, ${state.data?.FechaReserva || '-'}, ${state.data?.HoraReserva || '-'}, ${state.data?.NomReserva || '-'}`;
            log.info(`[MISSING] checking missing=[${missing.join(',') || 'none'}] current=[${currentData}]`);
            
            // Priorizar fecha si solo tenemos hora
            if (missing.includes('date') && state.data.HoraReserva && !state.data.FechaReserva) {
              missing.splice(missing.indexOf('date'), 1);
              missing.unshift('date');
              log.info(`[PRIORITY] date before time`);
            }
            
            log.info(`[MISSING] determined=${missing.length} fields=[${missing.join(',') || 'none'}]`);
            
            // Si tenemos todo lo esencial, usar teléfono de la llamada directamente y confirmar
            if (missing.length === 0) {
              log.info(`[COMPLETE] all fields complete, going to confirm`);
              
              // Asegurar que tenemos teléfono (usar el de la llamada)
              if (!state.data.TelefonReserva) {
                state.data.TelefonReserva = state.phone;
                log.debug('📞 PHONE_AUTO_FILLED', {
                  phone: state.phone,
                  reasoning: 'Teléfono no estaba en los datos. Usando teléfono de la llamada automáticamente.'
                });
              }
              
              // Ir directamente a confirmación con mensaje completo
              const oldStep = state.step;
              state.step = 'confirm';
              const confirmMessage = getConfirmationMessage(state.data, state.language);
              
              log.info(`[TRANSITION] ${oldStep} → ${state.step} (all complete)`);
              
              return {
                message: confirmMessage,
                gather: true
              };
            } else {
              // Falta información, confirmar lo que tenemos y preguntar por lo que falta
              const nextField = missing[0];
              
              log.info(`[ASK] next=${nextField} missing=[${missing.join(',')}]`);
              
              try {
                // Usar confirmación parcial que muestra lo capturado y pregunta por lo faltante
                const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
                
                if (nextField === 'people') {
                  state.step = 'ask_people';
                } else if (nextField === 'date') {
                  state.step = 'ask_date';
                } else if (nextField === 'time') {
                  state.step = 'ask_time';
                } else if (nextField === 'name') {
                  state.step = 'ask_name';
                }
                
                return {
                  message: partialMessage,
                  gather: true
                };
              } catch (error) {
                log.error('PARTIAL_CONFIRMATION_ERROR', {
                  error: error.message,
                  nextField,
                  language: state.language
                });
                
                // Fallback: usar mensaje simple
                const fieldMessages = getMultilingualMessages(`ask_${nextField}`, state.language);
                if (nextField === 'people') {
                  state.step = 'ask_people';
                } else if (nextField === 'date') {
                  state.step = 'ask_date';
                } else if (nextField === 'time') {
                  state.step = 'ask_time';
                } else if (nextField === 'name') {
                  state.step = 'ask_name';
                }
                
                return {
                  message: getRandomMessage(fieldMessages),
                  gather: true
                };
              }
            }
          } else if (intention === 'modify') {
            log.info('MODIFICATION_INTENT_AT_GREETING');
            const result = await handleModificationRequest(state, userInput);
            return result;
          } else if (intention === 'cancel') {
            log.info('CANCELLATION_INTENT_AT_GREETING');
            return await handleCancellationRequest(state, userInput);
          } else if (intention === 'order') {
            log.info('ORDER_INTENT_AT_GREETING');
            return await handleOrderIntent(state, analysis, callLogger, userInput);
          } else {
            // Intención 'clarify' o no reconocida
            // MEJORADO: Si hay datos útiles, preguntar al usuario si quiere hacer una reserva
            // Ejemplo: Usuario dice "a nombre de xavi" → Bot pregunta "¿Desea hacer una reserva a nombre de xavi?"
            const hasUsefulData = analysis.nombre || analysis.fecha || analysis.hora || analysis.comensales;
            
            if (hasUsefulData) {
              log.info('CLARIFY_WITH_USEFUL_DATA_IN_GREETING', {
                hasNombre: Boolean(analysis.nombre),
                hasFecha: Boolean(analysis.fecha),
                hasHora: Boolean(analysis.hora),
                hasComensales: Boolean(analysis.comensales),
                currentStep: state.step,
                reasoning: 'Intención es "clarify" pero Gemini extrajo datos útiles. Preguntando al usuario si quiere hacer una reserva.'
              });
              
              // Guardar temporalmente los datos extraídos para usarlos si el usuario confirma
              // NO aplicar todavía, solo guardar en un campo temporal
              state.pendingClarifyData = {
                nombre: analysis.nombre,
                fecha: analysis.fecha,
                hora: analysis.hora,
                comensales: analysis.comensales,
                analysis: analysis // Guardar el análisis completo para aplicarlo después
              };
              
              // Determinar qué mensaje mostrar según los datos extraídos
              // Prioridad: nombre > fecha > hora > comensales
              if (analysis.nombre) {
                // Si hay nombre, preguntar si quiere hacer reserva a nombre de X
                state.step = 'clarify_confirm';
                const confirmMessages = getMultilingualMessages('clarify_reservation_confirm', state.language, { name: analysis.nombre });
                return {
                  message: getRandomMessage(confirmMessages),
                  gather: true
                };
              } else if (analysis.fecha || analysis.hora || analysis.comensales) {
                // Si hay otros datos pero no nombre, preguntar si quiere hacer reserva
                state.step = 'clarify_confirm';
                const clarifyMessages = getMultilingualMessages('clarify', state.language);
                return {
                  message: getRandomMessage(clarifyMessages),
                  gather: true
                };
              }
            }
            
            // Si no hay datos útiles, usar mensaje de clarify
            const clarifyMessages = getMultilingualMessages('clarify', state.language);
            return {
              message: getRandomMessage(clarifyMessages),
              gather: true
            };
          }
        }
        
        // Si Gemini falló o no devolvió análisis válido, usar flujo normal
        log.warn('GEMINI_FALLBACK_GREETING');
        state.step = 'ask_people';
        const reservationMessages = getMultilingualMessages('reservation', state.language);
        return {
          message: getRandomMessage(reservationMessages),
          gather: true
        };
      }
      
      // Si no hay input o no se detectó intención, hacer saludo normal
      log.debug('GREETING_DEFAULT', { language: state.language });
      state.step = 'ask_intention';
      const greetingMessages = getMultilingualMessages('greeting', state.language);
       return {
         message: getRandomMessage(greetingMessages),
         gather: true
       };

    case 'ask_intention':
      // SIMPLIFICADO: Llamar a Gemini de forma síncrona y directa
      // Eliminado todo el procesamiento asíncrono complejo que causaba problemas
      if (userInput && userInput.trim()) {
        log.info('🧠 ANALYZING_INTENTION_WITH_GEMINI', {
          userInput: userInput,
          reasoning: `Analizando intención del usuario con Gemini de forma síncrona: "${userInput}"`
        });
        
        // Llamar a Gemini de forma síncrona (esperar el resultado directamente)
        const analysis = await analyzeReservationWithGemini(userInput, { 
          callSid: state.callSid, 
          step: state.step,
          state: state,  // Pasar estado completo para incluir historial y datos recopilados
          performanceMetrics: performanceMetrics
        });
        
        if (analysis) {
          // MEJORADO: Actualizar idioma ANTES de procesar la intención
          if (analysis.idioma_detectado) {
            // Validar que el idioma detectado sea válido
            const validLangs = ['es', 'en', 'de', 'fr', 'it', 'pt'];
            const detectedLang = validLangs.includes(analysis.idioma_detectado) 
              ? analysis.idioma_detectado 
              : (state.language || 'es');
            
            if (detectedLang !== state.language) {
              const oldLanguage = state.language;
              state.language = detectedLang;
              log.info('🌐 LANGUAGE_UPDATED', { 
                oldLanguage: oldLanguage,
                newLanguage: detectedLang,
                reasoning: `Idioma detectado por Gemini: ${detectedLang}. Actualizando estado del idioma ANTES de generar respuestas.`
              });
            } else if (!state.language) {
              state.language = detectedLang;
              log.info('🌐 LANGUAGE_INITIALIZED', { 
                language: detectedLang,
                reasoning: `Idioma inicializado desde detección de Gemini: ${detectedLang}`
              });
            }
          } else if (!state.language) {
            state.language = 'es';
            log.info('🌐 LANGUAGE_FALLBACK', { 
              language: 'es',
              reasoning: 'No se detectó idioma y no hay uno previo. Usando español como fallback.'
            });
          }
          
          const intention = analysis.intencion || 'reservation';
          
          if (intention === 'reservation') {
            // Aplicar análisis de Gemini al estado
            const applyResult = await applyGeminiAnalysisToState(analysis, state, callLogger, userInput);
            
            // Si hay error de validación (ej: demasiadas personas), manejar
            if (!applyResult.success && applyResult.error === 'people_too_many') {
              const maxPeopleMessages = getMaxPeopleExceededMessages(state.language, applyResult.maxPersonas);
              return {
                message: getRandomMessage(maxPeopleMessages),
                gather: true
              };
            }
            
            // Verificar si hay error de horario (validado por Gemini)
            if (state.data.horaError === 'fuera_horario') {
              const timeErrorMessages = getTimeOutOfHoursMessages(state.language, state.data.HoraReserva);
              delete state.data.HoraReserva;
              delete state.data.horaError;
              return {
                message: getRandomMessage(timeErrorMessages),
                gather: true
              };
            }
            
            // Determinar qué campos faltan
            const missingFields = determineMissingFields(analysis, state.data);
            
            // Priorizar fecha si solo tenemos hora
            if (missingFields.includes('date') && state.data.HoraReserva && !state.data.FechaReserva) {
              missingFields.splice(missingFields.indexOf('date'), 1);
              missingFields.unshift('date');
            }
            
            log.info('📊 MISSING_FIELDS_DETERMINED', { 
              missing: missingFields,
              missingCount: missingFields.length
            });
            
            // Si no falta nada, ir directamente a confirmación
            if (missingFields.length === 0) {
              if (!state.data.TelefonReserva) {
                state.data.TelefonReserva = state.phone;
              }
              state.step = 'confirm';
              const confirmMessage = getConfirmationMessage(state.data, state.language);
              return {
                message: confirmMessage,
                gather: true
              };
            }
            
            // Si falta información, confirmar lo que tenemos y preguntar por lo que falta
            const nextField = missingFields[0];
            state.step = `ask_${nextField}`;
            
            try {
              const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
              return {
                message: partialMessage,
                gather: true
              };
            } catch (error) {
              log.error('ERROR_GENERATING_PARTIAL_MESSAGE', { error: error.message });
              const fieldMessages = getMultilingualMessages(`ask_${nextField}`, state.language);
              return {
                message: getRandomMessage(fieldMessages),
                gather: true
              };
            }
          } else if (intention === 'modify') {
            return await handleModificationRequest(state, userInput);
          } else if (intention === 'cancel') {
            return await handleCancellationRequest(state, userInput);
          } else if (intention === 'order') {
            return await handleOrderIntent(state, analysis, callLogger, userInput);
          } else {
            // Intención 'clarify' o no reconocida
            // MEJORADO: Si hay datos útiles, preguntar al usuario si quiere hacer una reserva
            // Ejemplo: Usuario dice "a nombre de xavi" → Bot pregunta "¿Desea hacer una reserva a nombre de xavi?"
            const hasUsefulData = analysis.nombre || analysis.fecha || analysis.hora || analysis.comensales;
            
            if (hasUsefulData) {
              log.info('CLARIFY_WITH_USEFUL_DATA', {
                hasNombre: Boolean(analysis.nombre),
                hasFecha: Boolean(analysis.fecha),
                hasHora: Boolean(analysis.hora),
                hasComensales: Boolean(analysis.comensales),
                currentStep: state.step,
                reasoning: 'Intención es "clarify" pero Gemini extrajo datos útiles. Preguntando al usuario si quiere hacer una reserva.'
              });
              
              // Guardar temporalmente los datos extraídos para usarlos si el usuario confirma
              // NO aplicar todavía, solo guardar en un campo temporal
              state.pendingClarifyData = {
                nombre: analysis.nombre,
                fecha: analysis.fecha,
                hora: analysis.hora,
                comensales: analysis.comensales,
                analysis: analysis // Guardar el análisis completo para aplicarlo después
              };
              
              // Determinar qué mensaje mostrar según los datos extraídos
              // Prioridad: nombre > fecha > hora > comensales
              if (analysis.nombre) {
                // Si hay nombre, preguntar si quiere hacer reserva a nombre de X
                state.step = 'clarify_confirm';
                const confirmMessages = getMultilingualMessages('clarify_reservation_confirm', state.language, { name: analysis.nombre });
                return {
                  message: getRandomMessage(confirmMessages),
                  gather: true
                };
              } else if (analysis.fecha || analysis.hora || analysis.comensales) {
                // Si hay otros datos pero no nombre, preguntar si quiere hacer reserva
                state.step = 'clarify_confirm';
                const clarifyMessages = getMultilingualMessages('clarify', state.language);
                return {
                  message: getRandomMessage(clarifyMessages),
                  gather: true
                };
              }
            }
            
            // Si no hay datos útiles, usar mensaje de clarify
            const clarifyMessages = getMultilingualMessages('clarify', state.language);
            return {
              message: getRandomMessage(clarifyMessages),
              gather: true
            };
          }
        } else {
          // Gemini falló - usar fallback simple
          log.warn('GEMINI_ANALYSIS_FAILED', { 
            reasoning: 'Gemini no devolvió análisis. Usando fallback: preguntar por personas.'
          });
          
          state.step = 'ask_people';
          const reservationMessages = getMultilingualMessages('reservation', state.language);
          return {
            message: getRandomMessage(reservationMessages),
            gather: true
          };
        }
      }
      
      // Si no hay input, simplemente preguntar por la intención
      const intentionMessages = getMultilingualMessages('ask_intention', state.language);
      return {
        message: getRandomMessage(intentionMessages),
        gather: true
      };

     // ===== NUEVOS CASOS PARA MODIFICACIÓN DE RESERVAS =====
    case 'modify_ask_phone_choice':
      return await handleModifyAskPhoneChoice(state, userInput);
    case 'modify_ask_phone':
      return await handleModifyAskPhone(state, userInput);
    case 'modify_show_multiple':
      return await handleModifyShowMultiple(state, userInput);
    case 'modify_ask_field':
      return await handleModifyAskField(state, userInput);
    case 'modify_ask_value':
      return await handleModifyAskValue(state, userInput);
    case 'modify_confirm':
      return await handleModifyConfirm(state, userInput);
    case 'modify_success':
      return await handleModifySuccess(state, userInput);
    case 'modify_error':
      return await handleModifyError(state, userInput);
    case 'modify_no_reservations':
      return await handleModifyNoReservations(state, userInput);

    // ===== NUEVOS CASOS PARA CANCELACIÓN DE RESERVAS =====
     case 'cancel_show_multiple':
       return await handleCancelShowMultiple(state, userInput);

     case 'cancel_confirm_single':
       return await handleCancelConfirmSingle(state, userInput);

     case 'cancel_confirm_multiple':
       return await handleCancelConfirmMultiple(state, userInput);

     case 'cancel_no_reservations':
       return await handleCancelNoReservations(state, userInput);

    case 'order_collect_items':
      return await handleOrderCollectItems(state, userInput, callLogger, performanceMetrics);

    case 'order_ask_address':
      return await handleOrderAddressStep(state, userInput);

    case 'order_ask_name':
      return await handleOrderNameStep(state, userInput);

    case 'order_ask_phone':
      return await handleOrderPhoneStep(state, userInput);

    case 'order_ask_notes':
      return await handleOrderNotesStep(state, userInput, callLogger);

    case 'order_confirm':
      return await handleOrderConfirm(state, userInput, callLogger);

    case 'order_complete':
      return {
        message: getOrderStepMessage(state.order, 'order_complete', state.language || 'es'),
        gather: false
      };

     case 'ask_people':
       // Validar que el input no sea muy corto o ambiguo
       if (!userInput || userInput.trim().length < 2) {
         const unclearMessages = getMultilingualMessages('people_unclear', state.language);
         return {
           message: getRandomMessage(unclearMessages || ['Disculpe, no he captado bien. ¿Cuántas personas van a venir?']),
           gather: true
         };
       }
       
       // Detectar respuestas negativas comunes que no son números
       const negativeResponses = /^(no|não|nein|non|ni)$/i;
       if (negativeResponses.test(userInput.trim())) {
         // El usuario dijo "no", pedir clarificación
         const unclearMessages = getMultilingualMessages('people_unclear', state.language);
         return {
           message: getRandomMessage(unclearMessages || ['Disculpe, no he captado bien. ¿Para cuántas personas desean la reserva?']),
           gather: true
         };
       }
       
      // Usar Gemini para extraer información de la respuesta del usuario
      const peopleAnalysis = await analyzeReservationWithGemini(userInput, { 
        callSid: state.callSid, 
        step: state.step,
        state: state,  // Pasar estado completo para incluir historial y datos recopilados
        performanceMetrics: performanceMetrics
      });
      if (peopleAnalysis) {
        // MEJORADO: Si Gemini retornó null para comensales, SIEMPRE intentar fallback
        // No solo cuando tiene alta credibilidad, porque a veces Gemini no está seguro pero el número está ahí
        if (!peopleAnalysis.comensales) {
          // People null from Gemini - trying fallback - no log necesario
          
          // Primero intentar con regex para capturar cualquier número (sin límite)
          const numberMatch = userInput.match(/\b(\d+)\s*(?:personas?|personas|gente|comensales?|invitados?|personas más|personas adicionales)\b/i);
          if (numberMatch) {
            const regexNumber = parseInt(numberMatch[1]);
            // People extracted via regex - no log necesario
            peopleAnalysis.comensales = regexNumber.toString();
            peopleAnalysis.comensales_porcentaje_credivilidad = '100%';
          } else {
            // Si no hay match con "personas", intentar solo número cerca de palabras relacionadas
            const numberMatch2 = userInput.match(/(?:para|de|con|son|y para|y|otras|otros|además)\s+(\d+)/i);
            if (numberMatch2) {
              const regexNumber2 = parseInt(numberMatch2[1]);
              // People extracted via regex2 - no log necesario
              peopleAnalysis.comensales = regexNumber2.toString();
              peopleAnalysis.comensales_porcentaje_credivilidad = '100%';
            } else {
              // Intentar extraer números en palabras (uno, dos, tres, etc.)
              const wordToNumber = {
                'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
                'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
                'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
                'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20
              };
              
              let foundWordNumber = null;
              for (const [word, number] of Object.entries(wordToNumber)) {
                const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
                if (wordRegex.test(userInput.toLowerCase())) {
                  foundWordNumber = number;
                  break;
                }
              }
              
              if (foundWordNumber) {
                // People extracted via word - no log necesario
                peopleAnalysis.comensales = foundWordNumber.toString();
                peopleAnalysis.comensales_porcentaje_credivilidad = '100%';
              } else {
                // Intentar extraer cualquier número en el texto
                const anyNumberMatch = userInput.match(/\b(\d{1,2})\b/);
                if (anyNumberMatch) {
                  const anyNumber = parseInt(anyNumberMatch[1]);
                  // Validar que sea un número razonable (1-20)
                  if (anyNumber >= 1 && anyNumber <= 20) {
                    // People extracted via any number - no log necesario
                    peopleAnalysis.comensales = anyNumber.toString();
                    peopleAnalysis.comensales_porcentaje_credivilidad = '90%';
                  }
                } else {
                  // Último intento: usar extractPeopleCount (limitado a 1-20)
                  const extractedNumber = extractPeopleCount(userInput);
                  if (extractedNumber && extractedNumber > 0) {
                    // People extracted via extract function - no log necesario
                    peopleAnalysis.comensales = extractedNumber.toString();
                    peopleAnalysis.comensales_porcentaje_credivilidad = '100%';
                  }
                }
              }
            }
          }
        }
         
        const applyResult = await applyGeminiAnalysisToState(peopleAnalysis, state, callLogger, userInput);
         
         // Si hay error de validación (ej: demasiadas personas), mostrar mensaje
         if (!applyResult.success && applyResult.error === 'people_too_many') {
           const maxPeopleMessages = getMaxPeopleExceededMessages(state.language, applyResult.maxPersonas);
           return {
             message: getRandomMessage(maxPeopleMessages),
             gather: true
           };
         }
       }
       
       if (state.data.NumeroReserva) {
         // Determinar siguiente paso según qué falta
         const missing = determineMissingFields(null, state.data);
         
         if (missing.length === 0) {
           // Tiene todo, asegurar teléfono y ir a confirmación
           if (!state.data.TelefonReserva) {
             state.data.TelefonReserva = state.phone;
           }
           state.step = 'confirm';
           const confirmMessage = getConfirmationMessage(state.data, state.language);
           return {
             message: confirmMessage,
             gather: true
           };
         }
         
         const nextField = missing[0];
         
         if (nextField === 'date') {
           state.step = 'ask_date';
         } else if (nextField === 'time') {
           state.step = 'ask_time';
         } else if (nextField === 'name') {
           state.step = 'ask_name';
         }
         
         // Usar confirmación parcial para mostrar todo lo capturado y preguntar por lo faltante
         try {
           const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
           return {
             message: partialMessage,
             gather: true
           };
         } catch (error) {
           console.error('❌ [ERROR] Error generando mensaje parcial en ask_people:', error);
           // Fallback: usar mensaje simple
           const people = state.data.NumeroReserva;
           const peopleMessages = getMultilingualMessages('people', state.language, { people });
           return {
             message: getRandomMessage(peopleMessages),
             gather: true
           };
         }
       } else {
         // MEJORADO: Verificar si el usuario está intentando dar un número pero no fue claro
         // Por ejemplo: "Y para otras personas" - el usuario está intentando dar información pero no fue específico
         const textLower = (userInput || '').toLowerCase().trim();
         const peopleIndicators = [
           /^(?:y\s+para|y|para|además|otras?|otros?)\s+(?:personas?|gente|comensales?|invitados?)/i,
           /^(?:y\s+)?(?:otras?|otros?)\s+(?:personas?|gente)/i
         ];
         
         const isIncompletePeoplePhrase = peopleIndicators.some(pattern => pattern.test(textLower));
         
         if (isIncompletePeoplePhrase) {
           // El usuario está intentando dar información sobre personas pero no fue específico
           // Preguntar de forma más directa y clara
           const unclearMessages = getMultilingualMessages('people_unclear', state.language);
           return {
             message: getRandomMessage(unclearMessages || ['Disculpe, no he entendido bien. ¿Para cuántas personas exactamente será la reserva?']),
             gather: true
           };
         } else {
           // No se pudo extraer el número, usar mensaje de error/repetición estándar
           const errorResponse = handleUnclearResponse(text, 'people', state.language);
           return {
             message: errorResponse,
             gather: true
           };
         }
       }

    case 'ask_date': {
      // MEJORADO: Verificar PRIMERO si ya tenemos fecha (puede venir de análisis previo)
      if (state.data.FechaReserva && !userInput) {
        // Ya tenemos fecha, verificar qué falta y avanzar
        const missing = determineMissingFields(null, state.data);
        if (missing.length === 0) {
          if (!state.data.TelefonReserva) {
            state.data.TelefonReserva = state.phone;
          }
          state.step = 'confirm';
          return {
            message: getConfirmationMessage(state.data, state.language),
            gather: true
          };
        }
        const nextField = missing[0];
        if (nextField === 'people') state.step = 'ask_people';
        else if (nextField === 'time') state.step = 'ask_time';
        else if (nextField === 'name') state.step = 'ask_name';
        return {
          message: getPartialConfirmationMessage(state.data, nextField, state.language),
          gather: true
        };
      }
      
      // OPTIMIZACIÓN: Reutilizar análisis de Gemini si ya se hizo
      if (!geminiAnalysis && userInput && userInput.trim()) {
        geminiAnalysis = await analyzeReservationWithGemini(userInput, { 
          callSid: state.callSid, 
          step: state.step,
          state: state,  // Pasar estado completo para incluir historial y datos recopilados
          performanceMetrics: performanceMetrics
        });
      }
      if (geminiAnalysis) {
        await applyGeminiAnalysisToState(geminiAnalysis, state, callLogger, userInput);
      }
       
       // Después de aplicar Gemini, verificar qué tenemos y qué falta
       const missing = determineMissingFields(null, state.data);
       
       if (missing.length === 0) {
         if (!state.data.TelefonReserva) {
           state.data.TelefonReserva = state.phone;
         }
         state.step = 'confirm';
         return {
           message: getConfirmationMessage(state.data, state.language),
           gather: true
         };
       }
       
       // Si tenemos fecha pero falta otra cosa, avanzar a lo que falta
       if (state.data.FechaReserva) {
         const nextField = missing[0];
         if (nextField === 'people') {
           state.step = 'ask_people';
         } else if (nextField === 'time') {
           state.step = 'ask_time';
         } else if (nextField === 'name') {
           state.step = 'ask_name';
         }
         try {
           const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
           return {
             message: partialMessage,
             gather: true
           };
         } catch (error) {
           callLogger.error('PARTIAL_CONFIRMATION_ERROR', { error: error.message, nextField });
           const date = state.data.FechaReserva;
           const dateMessages = getMultilingualMessages('date', state.language, { date });
           return {
             message: getRandomMessage(dateMessages),
             gather: true
           };
         }
       } else {
         // No se detectó fecha válida, pedir clarificación
         const errorResponse = handleUnclearResponse(text, 'date', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }
    }

    case 'ask_time': {
      // MEJORADO: Verificar PRIMERO si ya tenemos hora (puede venir de análisis previo)
      if (state.data.HoraReserva && !userInput) {
        // Ya tenemos hora, verificar qué falta y avanzar
        const missing = determineMissingFields(null, state.data);
        if (missing.length === 0) {
          if (!state.data.TelefonReserva) {
            state.data.TelefonReserva = state.phone;
          }
          state.step = 'confirm';
          return {
            message: getConfirmationMessage(state.data, state.language),
            gather: true
          };
        }
        const nextField = missing[0];
        if (nextField === 'people') state.step = 'ask_people';
        else if (nextField === 'date') state.step = 'ask_date';
        else if (nextField === 'name') state.step = 'ask_name';
        return {
          message: getPartialConfirmationMessage(state.data, nextField, state.language),
          gather: true
        };
      }
      
      // Detectar respuestas parciales como "a las" sin hora completa
      const partialTimePatterns = /^a\s+las?$/i;
      if (partialTimePatterns.test(userInput.trim())) {
        const errorResponse = handleUnclearResponse(text, 'time', state.language);
        return {
          message: errorResponse,
          gather: true
        };
      }
      
      // OPTIMIZACIÓN: Reutilizar análisis de Gemini si ya se hizo
      if (!geminiAnalysis && userInput && userInput.trim()) {
        geminiAnalysis = await analyzeReservationWithGemini(userInput, { 
          callSid: state.callSid, 
          step: state.step,
          state: state,  // Pasar estado completo para incluir historial y datos recopilados
          performanceMetrics: performanceMetrics
        });
      }
      if (geminiAnalysis) {
        if (geminiAnalysis.intencion === 'clarify' && !geminiAnalysis.hora) {
          const errorResponse = handleUnclearResponse(text, 'time', state.language);
          return {
            message: errorResponse,
            gather: true
          };
        }
        await applyGeminiAnalysisToState(geminiAnalysis, state, callLogger, userInput);
      }
       
       // Verificar si hay error de horario (validado por Gemini)
       if (state.data.horaError === 'fuera_horario') {
         const timeErrorMessages = getTimeOutOfHoursMessages(state.language, state.data.HoraReserva);
         delete state.data.HoraReserva;
         delete state.data.horaError;
         return {
           message: getRandomMessage(timeErrorMessages),
           gather: true
         };
       }
       
       // Después de aplicar Gemini, verificar qué tenemos y qué falta
       const missing = determineMissingFields(null, state.data);
       
       if (missing.length === 0) {
         if (!state.data.TelefonReserva) {
           state.data.TelefonReserva = state.phone;
         }
         state.step = 'confirm';
         return {
           message: getConfirmationMessage(state.data, state.language),
           gather: true
         };
       }
       
       // Si tenemos hora pero falta otra cosa, avanzar a lo que falta
       if (state.data.HoraReserva) {
         const nextField = missing[0];
         if (nextField === 'people') {
           state.step = 'ask_people';
         } else if (nextField === 'date') {
           state.step = 'ask_date';
         } else if (nextField === 'name') {
           state.step = 'ask_name';
         }
         try {
           const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
           return {
             message: partialMessage,
             gather: true
           };
         } catch (error) {
           callLogger.error('PARTIAL_CONFIRMATION_ERROR', { error: error.message, nextField });
           const time = state.data.HoraReserva;
           const timeMessages = getMultilingualMessages('time', state.language, { time });
           return {
             message: getRandomMessage(timeMessages),
             gather: true
           };
         }
       } else {
         // No tenemos hora, pedirla
         const errorResponse = handleUnclearResponse(text, 'time', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }
    }

    case 'ask_name':
      // OPTIMIZACIÓN: Reutilizar análisis de Gemini si ya se hizo (evita llamadas duplicadas)
      // El análisis ya se hizo arriba en la verificación de cancelación si step === 'ask_name'
      if (!geminiAnalysis && userInput && userInput.trim()) {
        geminiAnalysis = await analyzeReservationWithGemini(userInput, { 
          callSid: state.callSid, 
          step: state.step,
          state: state,  // Pasar estado completo para incluir historial y datos recopilados
          performanceMetrics: performanceMetrics
        });
      }
      
      // MEJORADO: Aplicar análisis de Gemini PRIMERO, incluso si la intención es "clarify"
      // Esto asegura que si Gemini extrae un nombre (aunque la intención sea "clarify"), se aplique
      if (geminiAnalysis) {
        // IMPORTANTE: Aplicar el análisis incluso si la intención no es "reservation"
        // porque en el paso ask_name, cualquier nombre extraído debe aplicarse
        await applyGeminiAnalysisToState(geminiAnalysis, state, callLogger, userInput);
      }
       
       // MEJORADO: Verificar si el usuario dijo "a nombre de" sin completar
       // En este caso, no es un error, simplemente necesitamos que complete el nombre
       const textLower = (userInput || '').toLowerCase().trim();
       const nameIndicators = [
         /^a\s+nombre\s+de\s*$/i,
         /^nombre\s+de\s*$/i,
         /^los\s+nombres\s+de\s*$/i,
         /^el\s+nombre\s+de\s*$/i,
         /^un\s+nombre\s+de\s*$/i,
         /^una\s+nombre\s+de\s*$/i,
         /^mi\s+nombre\s+de\s*$/i,
         /^su\s+nombre\s+de\s*$/i,
         /^sus\s+nombres\s+de\s*$/i,
         /a nombre de/i,
         /nombre de/i,
         /los nombres de/i,
         /el nombre de/i,
         /me llamo/i,
         /se llama/i,
         /se llaman/i,
         /llamarse/i,
         /llamarnos/i,
         /mi nombre/i,
         /su nombre/i,
         /sus nombres/i,
         /como.*nombre/i,
         /que.*nombre/i,
         /cual.*nombre/i
       ];
       
       const isIncompleteNamePhrase = nameIndicators.some(pattern => pattern.test(textLower));
       
       // MEJORADO: Verificar si el nombre se aplicó después del análisis de Gemini
       // Gemini es la prioridad - si extrajo el nombre, usarlo directamente
       if (state.data.NomReserva) {
         const name = state.data.NomReserva;
         // Después del nombre, usar directamente el teléfono de la llamada y confirmar
         state.data.TelefonReserva = state.phone;
         state.step = 'confirm';
         
         const nameMessages = getMultilingualMessages('name', state.language, { name });
         const nameMessage = getRandomMessage(nameMessages);
         // Ir directamente a confirmación con todos los datos
         const confirmMessage = getConfirmationMessage(state.data, state.language);
         const fullMessage = `${nameMessage} ${confirmMessage}`;
         return {
           message: fullMessage,
           gather: true
         };
       } else if (isIncompleteNamePhrase) {
         // El usuario dijo "a nombre de" pero no completó el nombre
         // Esto es normal, simplemente pedir el nombre de forma más clara
         const nameMessages = getMultilingualMessages('ask_name', state.language);
         return {
           message: getRandomMessage(nameMessages),
           gather: true
         };
       } else {
         // FALLBACK: Si Gemini no extrajo el nombre, intentar con extractName como último recurso
         // Esto solo se usa si Gemini realmente falló (no detectó nombre con suficiente confianza)
         // Prioridad: Gemini primero, extractName solo si Gemini falla
         const fallbackName = extractName(userInput || '');
         if (fallbackName && fallbackName.trim().length > 0) {
           log.info('NAME_EXTRACTED_FALLBACK', {
             nombre: fallbackName,
             originalText: userInput?.substring(0, 50),
             reasoning: 'Gemini no extrajo nombre con suficiente confianza. Usando fallback extractName.'
           });
           state.data.NomReserva = fallbackName;
           state.data.TelefonReserva = state.phone;
           state.step = 'confirm';
           
           const nameMessages = getMultilingualMessages('name', state.language, { name: fallbackName });
           const nameMessage = getRandomMessage(nameMessages);
           const confirmMessage = getConfirmationMessage(state.data, state.language);
           const fullMessage = `${nameMessage} ${confirmMessage}`;
           return {
             message: fullMessage,
             gather: true
           };
         }
         
         // Si ni Gemini ni el fallback pudieron extraer el nombre, usar mensaje de error/repetición
         const errorResponse = handleUnclearResponse(text, 'name', state.language);
         return {
           message: errorResponse,
           gather: true
         };
       }

    case 'clarify_confirm': {
      // Manejar respuesta del usuario cuando se le pregunta si quiere hacer una reserva
      // después de detectar datos útiles con intención "clarify"
      if (!state.pendingClarifyData) {
        // Si no hay datos pendientes, volver a ask_intention
        log.warn('CLARIFY_CONFIRM_NO_PENDING_DATA');
        state.step = 'ask_intention';
        const intentionMessages = getMultilingualMessages('ask_intention', state.language);
        return {
          message: getRandomMessage(intentionMessages),
          gather: true
        };
      }
      
      // Verificar si el usuario confirmó
      const confirmationResult = handleConfirmationResponse(userInput || '');
      
      if (confirmationResult.action === 'confirm') {
        // Usuario confirmó: aplicar los datos guardados y continuar con el flujo de reserva
        log.info('CLARIFY_CONFIRM_ACCEPTED', {
          pendingData: state.pendingClarifyData,
          reasoning: 'Usuario confirmó que quiere hacer una reserva. Aplicando datos extraídos y continuando flujo.'
        });
        
        // Guardar el análisis antes de limpiar
        const savedAnalysis = state.pendingClarifyData.analysis;
        
        // Aplicar el análisis guardado al estado
        const applyResult = await applyGeminiAnalysisToState(
          savedAnalysis, 
          state, 
          callLogger, 
          userInput
        );
        
        // Limpiar datos pendientes
        delete state.pendingClarifyData;
        
        // Verificar errores de validación
        if (!applyResult.success && applyResult.error === 'people_too_many') {
          const maxPeopleMessages = getMaxPeopleExceededMessages(state.language, applyResult.maxPersonas);
          return {
            message: getRandomMessage(maxPeopleMessages),
            gather: true
          };
        }
        
        // Verificar error de horario
        if (state.data.horaError === 'fuera_horario') {
          const timeErrorMessages = getTimeOutOfHoursMessages(state.language, state.data.HoraReserva);
          delete state.data.HoraReserva;
          delete state.data.horaError;
          return {
            message: getRandomMessage(timeErrorMessages),
            gather: true
          };
        }
        
        // Determinar qué campos faltan y continuar con el flujo de reserva
        const missingFields = determineMissingFields(savedAnalysis || {}, state.data);
        
        // Si no falta nada, ir directamente a confirmación
        if (missingFields.length === 0) {
          if (!state.data.TelefonReserva) {
            state.data.TelefonReserva = state.phone;
          }
          state.step = 'confirm';
          const confirmMessage = getConfirmationMessage(state.data, state.language);
          return {
            message: confirmMessage,
            gather: true
          };
        }
        
        // Si falta información, continuar preguntando por lo que falta
        const nextField = missingFields[0];
        state.step = `ask_${nextField}`;
        
        try {
          const partialMessage = getPartialConfirmationMessage(state.data, nextField, state.language);
          return {
            message: partialMessage,
            gather: true
          };
        } catch (error) {
          log.error('ERROR_GENERATING_PARTIAL_MESSAGE', { error: error.message });
          const fieldMessages = getMultilingualMessages(`ask_${nextField}`, state.language);
          return {
            message: getRandomMessage(fieldMessages),
            gather: true
          };
        }
      } else if (confirmationResult.action === 'deny' || confirmationResult.action === 'restart') {
        // Usuario negó o quiere empezar de nuevo
        log.info('CLARIFY_CONFIRM_DENIED', {
          reasoning: 'Usuario negó o quiere empezar de nuevo. Limpiando datos pendientes y volviendo a ask_intention.'
        });
        
        // Limpiar datos pendientes
        delete state.pendingClarifyData;
        state.step = 'ask_intention';
        const intentionMessages = getMultilingualMessages('ask_intention', state.language);
        return {
          message: getRandomMessage(intentionMessages),
          gather: true
        };
      } else {
        // Respuesta no clara, volver a preguntar
        log.warn('CLARIFY_CONFIRM_UNclear', {
          userInput: userInput?.substring(0, 50),
          reasoning: 'Respuesta del usuario no fue clara. Volviendo a preguntar.'
        });
        
        // Volver a preguntar con el mismo mensaje
        if (state.pendingClarifyData?.nombre) {
          const confirmMessages = getMultilingualMessages('clarify_reservation_confirm', state.language, { name: state.pendingClarifyData.nombre });
          return {
            message: getRandomMessage(confirmMessages),
            gather: true
          };
        } else {
          const clarifyMessages = getMultilingualMessages('clarify', state.language);
          return {
            message: getRandomMessage(clarifyMessages),
            gather: true
          };
        }
      }
      break;
    }

     case 'confirm': {
       const confirmationResult = handleConfirmationResponse(text);
       
      if (confirmationResult.action === 'confirm') {
        // CRÍTICO: Cargar configuración completa del restaurante antes de validar
        // Esto asegura que todas las validaciones usen la configuración más reciente
        await loadRestaurantConfig();
        
        // CRÍTICO: Validar horario y otros datos ANTES de confirmar al usuario
        // Esto evita decirle al usuario que está confirmada cuando en realidad fallará al guardar
        const validacionCompleta = await validarReservaCompleta(state.data);
        
        if (!validacionCompleta.valido) {
          log.warn('❌ VALIDATION_FAILED_AT_CONFIRM', {
            errores: validacionCompleta.errores,
            data: state.data,
            reasoning: 'Validación completa falló antes de confirmar. Informando al usuario del error.'
          });
          
          // Si el error es de horario, mostrar mensaje específico
          const horaError = validacionCompleta.errores.find(e => e.includes('abierto de'));
          if (horaError) {
            const timeErrorMessages = getTimeOutOfHoursMessages(state.language, state.data.HoraReserva);
            return {
              message: getRandomMessage(timeErrorMessages),
              gather: true
            };
          }
          
          // Para otros errores, mostrar mensaje genérico con los errores específicos
          const errorMessage = state.language === 'es' 
            ? `Disculpe, ${validacionCompleta.errores.join('. ')}. ¿Podría corregirlo?`
            : state.language === 'en'
            ? `Sorry, ${validacionCompleta.errores.join('. ')}. Could you correct it?`
            : `Entschuldigung, ${validacionCompleta.errores.join('. ')}. Könnten Sie es korrigieren?`;
          return {
            message: errorMessage,
            gather: true
          };
        }
        
        // OPTIMIZACIÓN: Verificar disponibilidad antes de confirmar (con cache)
        const dataCombinada = combinarFechaHora(state.data.FechaReserva, state.data.HoraReserva);
        
        log.info('🔍 CHECKING_AVAILABILITY_BEFORE_CONFIRM', {
          fechaHora: dataCombinada,
          numPersonas: state.data.NumeroReserva,
          fecha: state.data.FechaReserva,
          hora: state.data.HoraReserva,
          reasoning: `Usuario confirmó la reserva. Verificando disponibilidad antes de finalizar...`
        });
        
        const disponibilidad = await validarDisponibilidadCached(dataCombinada, state.data.NumeroReserva, performanceMetrics);
         
         if (!disponibilidad.disponible) {
           log.warn('❌ NO_AVAILABILITY_AT_CONFIRM', {
             fechaHora: dataCombinada,
             numPersonas: state.data.NumeroReserva,
             capacidadDisponible: disponibilidad.capacidadDisponible || null,
             capacidadTotal: disponibilidad.capacidadTotal || null,
             reservasExistentes: disponibilidad.reservasExistentes || null,
             reasoning: `No hay disponibilidad para ${state.data.NumeroReserva} personas el ${dataCombinada}. Buscando alternativas...`
           });
           
           // Obtener alternativas
           const alternativas = await getAlternativeTimeSlots(dataCombinada, state.data.NumeroReserva, 3);
           
           // Generar mensaje de no disponibilidad
           const noAvailabilityMessages = getMultilingualMessages('no_availability', state.language);
           let message = getRandomMessage(noAvailabilityMessages);
           
           // Si hay alternativas, sugerir la primera
           if (alternativas && alternativas.length > 0) {
             const altFechaHora = alternativas[0].fechaHora;
             const altFecha = new Date(altFechaHora);
             const altHora = `${String(altFecha.getHours()).padStart(2, '0')}:${String(altFecha.getMinutes()).padStart(2, '0')}`;
             
             const suggestMessages = getMultilingualMessages('suggest_alternative', state.language);
             const suggestMessage = getRandomMessage(suggestMessages).replace('{time}', altHora);
             message += ` ${suggestMessage}`;
             
             // Guardar alternativa sugerida
             state.suggestedAlternative = altFechaHora;
             state.availabilityError = {
               alternativas: alternativas.map(alt => alt.fechaHora)
             };
           }
           
           return {
             message,
             gather: true
           };
         }
         
         // Si hay disponibilidad y validación pasó, proceder con la confirmación
         state.step = 'complete';
         const confirmMessages = getMultilingualMessages('confirm', state.language);
         return {
           message: getRandomMessage(confirmMessages),
           gather: false
         };
       } else if (confirmationResult.action === 'modify') {
         return handleModifyReservationField(state, confirmationResult.modification);
       } else if (confirmationResult.action === 'restart') {
         state.step = 'ask_people';
         state.data = {};
         const restartMessages = getMultilingualMessages('restart', state.language);
         return {
           message: getRandomMessage(restartMessages),
           gather: true
         };
       } else if (confirmationResult.action === 'clarify') {
         return {
           message: confirmationResult.message,
           gather: true
         };
       } else {
        const clarifyConfirmMessages = getMultilingualMessages('clarify_confirm', state.language);
        return {
          message: getRandomMessage(clarifyConfirmMessages),
          gather: true
        };
      }
      break;
    }

    case 'cancelling':
      // Estado de cancelación - manejar confirmación
      console.log(`🚫 [CANCELLING] Procesando confirmación de cancelación`);
      return await handleCancellationConfirmation(state, userInput);

    case 'complete':
      // Estado completado - reserva exitosa
      console.log(`✅ [COMPLETE] Reserva completada exitosamente`);
      // Devolver mensaje de confirmación final
      const completeMessages = getMultilingualMessages('complete', state.language);
      return {
        message: getRandomMessage(completeMessages),
        gather: false // No más interacción
      };

    default:
      state.step = 'greeting';
      const defaultMessages = getMultilingualMessages('default', state.language);
      return {
        message: getRandomMessage(defaultMessages),
        gather: true
      };
  }
}

// Funciones para manejar modificación de reservas
// ===== NUEVAS FUNCIONES DE MODIFICACIÓN DE RESERVAS EXISTENTES =====

async function handleModificationRequest(state, userInput) {
  try {
    console.log(`✏️ [MODIFICACIÓN] Iniciando proceso de modificación de reserva existente`);
    console.log(`✏️ [DEBUG] Input del usuario: "${userInput}"`);
    console.log(`✏️ [DEBUG] Estado actual: step=${state.step}, language=${state.language}`);
    
    // Usar directamente el teléfono de la llamada (sin preguntar)
    console.log(`✏️ [DEBUG] Usando teléfono de la llamada: ${state.phone}`);
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } catch (error) {
    console.error(`❌ [ERROR] Error en handleModificationRequest:`, error);
    return {
      message: "Error: No se pudo procesar la solicitud de modificación",
      gather: true
    };
  }
}

async function handleModifyAskPhoneChoice(state, userInput) {
  console.log(`📞 [MODIFICACIÓN] Procesando elección de teléfono: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si quiere usar el mismo teléfono (reutilizar lógica de cancelación)
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número/i,
    /usar.*este|usar.*mismo|usar.*igual/i,
    
    // Inglés
    /yes|same|this|current|from.*here/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    /use.*this|use.*same|use.*current/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    /verwenden.*dieses|verwenden.*gleiche/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    /utiliser.*ce|utiliser.*même/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    /usare.*questo|usare.*stesso/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i,
    /usar.*este|usar.*mesmo/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [MODIFICACIÓN] Usuario eligió usar el mismo teléfono: ${state.phone}`);
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } else {
    // Usuario quiere usar otro teléfono
    console.log(`📞 [MODIFICACIÓN] Usuario eligió usar otro teléfono`);
    state.step = 'modify_ask_phone';
    state.modificationData.useOtherPhone = true;
    const phoneMessages = getMultilingualMessages('modify_ask_phone', state.language);
    
    return {
      message: getRandomMessage(phoneMessages),
      gather: true
    };
  }
}

async function handleModifyAskPhone(state, userInput) {
  console.log(`📞 [MODIFICACIÓN] Procesando número de teléfono: ${userInput}`);
  console.log(`📞 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`📞 [DEBUG] Teléfono del estado: "${state.phone}"`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si el usuario quiere usar el mismo teléfono (volver al paso anterior)
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí|el.*mismo|este.*número|mismo.*número|este.*teléfono|mismo.*teléfono/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número|usar.*este|usar.*mismo|usar.*igual|quiere.*usar.*mismo|quisiera.*usar.*mismo/i,
    
    // Inglés
    /yes|same|this|current|from.*here|use.*this|use.*same|use.*current/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier|verwenden.*dieses|verwenden.*gleiche/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici|utiliser.*ce|utiliser.*même/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui|usare.*questo|usare.*stesso/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui|usar.*este|usar.*mesmo/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [MODIFICACIÓN] Usuario quiere usar el mismo teléfono: ${state.phone}`);
    // Volver al paso anterior y usar el teléfono de la llamada
    state.step = 'modify_ask_phone_choice';
    state.modificationData.useOtherPhone = false;
    
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'modify_no_reservations';
      const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'modify_ask_field';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
    } else {
      state.step = 'modify_show_multiple';
      state.modificationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  }
  
  // Extraer número de teléfono del input
  let phoneNumber = extractPhoneFromText(userInput);
  console.log(`📞 [DEBUG] Teléfono extraído del input: "${phoneNumber}"`);
  
  // Si el usuario eligió usar otro teléfono, NO usar el de la llamada
  if (state.modificationData.useOtherPhone) {
    if (!phoneNumber) {
      console.log(`❌ [MODIFICACIÓN] No se pudo extraer teléfono del input: "${userInput}"`);
      const unclearMessages = getMultilingualMessages('modify_ask_phone', state.language);
      return {
        message: `No pude entender el número de teléfono. ${getRandomMessage(unclearMessages)}`,
        gather: true
      };
    }
    console.log(`📞 [MODIFICACIÓN] Usando teléfono proporcionado por el usuario: ${phoneNumber}`);
  } else {
    // Si no se encontró en el texto, usar el teléfono de la llamada
    if (!phoneNumber) {
      phoneNumber = state.phone;
      console.log(`📞 [MODIFICACIÓN] Usando teléfono de la llamada: ${phoneNumber}`);
    }
  }
  
  console.log(`📞 [DEBUG] Teléfono final a usar para búsqueda: "${phoneNumber}"`);
  
  // Buscar reservas para este teléfono
  const reservations = await findReservationsByPhone(phoneNumber);
  
  if (reservations.length === 0) {
    state.step = 'modify_no_reservations';
    const noReservationsMessages = getMultilingualMessages('modify_no_reservations', state.language);
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    state.step = 'modify_ask_field';
    state.modificationData = {
      phone: phoneNumber,
      reservations: reservations,
      selectedReservation: reservations[0]
    };
    
    const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
    return {
      message: getRandomMessage(fieldMessages),
      gather: true
    };
  } else {
    state.step = 'modify_show_multiple';
    state.modificationData = {
      phone: phoneNumber,
      reservations: reservations
    };
    
    const multipleReservationsMessages = getMultilingualMessages('modify_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('modify_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleModifyShowMultiple(state, userInput) {
  console.log(`🔢 [MODIFICACIÓN] Procesando selección de reserva: ${userInput}`);
  
  // Extraer número de opción del input usando la función mejorada
  const optionNumber = extractOptionFromText(userInput);
  
  if (!optionNumber) {
    const unclearMessages = getMultilingualMessages('modify_unclear_option', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  const selectedIndex = optionNumber - 1; // Convertir a índice 0-based
  const reservations = state.modificationData.reservations;
  
  if (selectedIndex < 0 || selectedIndex >= reservations.length) {
    const invalidMessages = getMultilingualMessages('modify_invalid_option', state.language);
    return {
      message: getRandomMessage(invalidMessages),
      gather: true
    };
  }
  
  // Reserva seleccionada
  const selectedReservation = reservations[selectedIndex];
  state.modificationData.selectedReservation = selectedReservation;
  state.step = 'modify_ask_field';
  
  const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
  return {
    message: getRandomMessage(fieldMessages),
    gather: true
  };
}

async function handleModifyAskField(state, userInput) {
  console.log(`✏️ [MODIFICACIÓN] Procesando campo a modificar: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar qué campo quiere modificar
  const fieldPatterns = {
    name: [/nombre|name/i, /a.*nombre.*de|under.*name/i, /nom.*persona|person.*name/i],
    date: [/fecha|date|día|day/i, /cuando|when|cuándo/i, /día.*mes|day.*month/i],
    time: [/hora|time|tiempo/i, /a.*qué.*hora|what.*time/i, /cuando|when/i],
    people: [/personas|people|gente/i, /cuántas.*personas|how.*many.*people/i, /número.*personas|number.*people/i, /comensales|diners/i]
  };
  
  let selectedField = null;
  for (const [field, patterns] of Object.entries(fieldPatterns)) {
    if (patterns.some(pattern => pattern.test(lowerInput))) {
      selectedField = field;
      break;
    }
  }
  
  if (!selectedField) {
    const unclearMessages = getMultilingualMessages('modify_unclear_field', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  state.modificationData.fieldToModify = selectedField;
  state.step = 'modify_ask_value';
  
  const valueMessages = getMultilingualMessages('modify_ask_value', state.language, { field: selectedField });
  return {
    message: getRandomMessage(valueMessages),
    gather: true
  };
}

async function handleModifyAskValue(state, userInput) {
  console.log(`✏️ [MODIFICACIÓN] Procesando nuevo valor: ${userInput}`);
  
  const field = state.modificationData.fieldToModify;
  let newValue = null;
  
  // Extraer el nuevo valor según el campo
  switch (field) {
    case 'name':
      newValue = extractName(userInput);
      break;
    case 'date':
      newValue = extractDate(userInput);
      break;
    case 'time':
      newValue = extractTime(userInput);
      break;
    case 'people':
      newValue = extractPeopleCount(userInput);
      break;
  }
  
  if (!newValue) {
    const unclearMessages = getMultilingualMessages('modify_unclear_value', state.language, { field });
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  state.modificationData.newValue = newValue;
  state.step = 'modify_confirm';
  
  const confirmMessages = getMultilingualMessages('modify_confirm', state.language, {
    field: field,
    oldValue: getFieldValue(state.modificationData.selectedReservation, field),
    newValue: newValue
  });
  
  return {
    message: getRandomMessage(confirmMessages),
    gather: true
  };
}

async function handleModifyConfirm(state, userInput) {
  console.log(`✅ [MODIFICACIÓN] Procesando confirmación: ${userInput}`);
  
  // Usar detectCancellationConfirmation que retorna 'yes', 'no' o 'unclear'
  // Nota: Aunque se llama detectCancellationConfirmation, funciona igual para cualquier confirmación
  const confirmationResult = detectCancellationConfirmation(userInput);
  
  if (confirmationResult === 'yes') {
    // Confirmar modificación
    const success = await updateReservation(state.modificationData);
    
    if (success) {
      console.log(`✅ [MODIFICACIÓN] Reserva modificada exitosamente`);
      state.step = 'modify_success';
      const successMessages = getMultilingualMessages('modify_success', state.language);
      
      return {
        message: getRandomMessage(successMessages),
        gather: false // Terminar llamada
      };
    } else {
      console.log(`❌ [MODIFICACIÓN] Error modificando reserva`);
      state.step = 'modify_error';
      const errorMessages = getMultilingualMessages('modify_error', state.language);
      
      return {
        message: getRandomMessage(errorMessages),
        gather: false // Terminar llamada
      };
    }
  } else if (confirmationResult === 'no') {
    // Rechazar modificación
    console.log(`🔄 [MODIFICACIÓN] Modificación rechazada`);
    state.step = 'greeting'; // Volver al inicio
    const cancelledMessages = getMultilingualMessages('modify_cancelled', state.language);
    
    return {
      message: getRandomMessage(cancelledMessages),
      gather: true
    };
  } else {
    // Respuesta no clara
    const unclearMessages = getMultilingualMessages('modify_unclear_confirmation', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
}

async function handleModifySuccess(state, userInput) {
  return { message: '', gather: false };
}

async function handleModifyError(state, userInput) {
  return { message: '', gather: false };
}

async function handleModifyNoReservations(state, userInput) {
  console.log(`❌ [MODIFICACIÓN] No hay reservas para modificar`);
  
  const offerNewMessages = getMultilingualMessages('modify_offer_new', state.language);
  return {
    message: getRandomMessage(offerNewMessages),
    gather: true
  };
}

// Función auxiliar para obtener el valor de un campo
function getFieldValue(reservation, field) {
  switch (field) {
    case 'name':
      return reservation.nom_persona_reserva;
    case 'date':
      // REFACTORIZADO: Usar función helper para formatear fecha (elimina duplicación)
      const { formattedDate } = formatReservationDateTime(reservation.data_reserva, 'es');
      return formattedDate;
    case 'time':
      // REFACTORIZADO: Usar función helper para formatear hora (elimina duplicación)
      const { formattedTime } = formatReservationDateTime(reservation.data_reserva, 'es');
      return formattedTime;
    case 'people':
      return reservation.num_persones;
    default:
      return '';
  }
}

// Función para actualizar la reserva en la base de datos
async function updateReservation(modificationData) {
  try {
    const { selectedReservation, fieldToModify, newValue, phone } = modificationData;
    console.log(`✏️ Actualizando reserva ID: ${selectedReservation.id_reserva}, campo: ${fieldToModify}, nuevo valor: ${newValue}`);
    
    const connection = await createConnection();
    
    try {
      await connection.beginTransaction();
      
      let updateQuery = '';
      let updateValues = [];
      
      switch (fieldToModify) {
        case 'name':
          updateQuery = `UPDATE RESERVA SET nom_persona_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newValue, selectedReservation.id_reserva, phone];
          break;
        case 'date':
          // Combinar nueva fecha con hora existente
          const existingTime = selectedReservation.data_reserva.split(' ')[1];
          const newDateTimeWithTime = `${newValue} ${existingTime}`;
          updateQuery = `UPDATE RESERVA SET data_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newDateTimeWithTime, selectedReservation.id_reserva, phone];
          break;
        case 'time':
          // Combinar fecha existente con nueva hora
          const existingDate = selectedReservation.data_reserva.split(' ')[0];
          const newDateTimeWithDate = `${existingDate} ${newValue}`;
          updateQuery = `UPDATE RESERVA SET data_reserva = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newDateTimeWithDate, selectedReservation.id_reserva, phone];
          break;
        case 'people':
          updateQuery = `UPDATE RESERVA SET num_persones = ? WHERE id_reserva = ? AND telefon = ?`;
          updateValues = [newValue, selectedReservation.id_reserva, phone];
          break;
      }
      
      const [result] = await connection.execute(updateQuery, updateValues);
      
      if (result.affectedRows === 0) {
        throw new Error('No se encontró la reserva para modificar');
      }
      
      await connection.commit();
      console.log(`✅ Reserva ${selectedReservation.id_reserva} modificada exitosamente`);
      return true;
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error modificando reserva:', error);
    return false;
  }
}

// Funciones para manejar cancelación de reservas
// ===== NUEVAS FUNCIONES DE CANCELACIÓN DE RESERVAS EXISTENTES =====

async function handleCancellationRequest(state, userInput) {
  console.log(`🚫 [CANCELACIÓN] Iniciando proceso de cancelación de reserva existente`);
  
  // Usar directamente el teléfono de la llamada (sin preguntar)
  console.log(`🚫 [DEBUG] Usando teléfono de la llamada: ${state.phone}`);
  const reservations = await findReservationsByPhone(state.phone);
  
  state.cancellationData = { phone: state.phone, reservations: reservations };
  
  if (reservations.length === 0) {
    state.step = 'cancel_no_reservations';
    const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    state.step = 'cancel_confirm_single';
    state.cancellationData.selectedReservation = reservations[0];
    const confirmMessages = getMultilingualMessages('cancel_confirm_selected', state.language);
    const reservationText = formatReservationForDisplay(reservations[0], 0, state.language).single;
    return {
      message: `${getRandomMessage(confirmMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
      gather: true
    };
  } else {
    state.step = 'cancel_show_multiple';
    const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleCancelAskPhoneChoice(state, userInput) {
  console.log(`📞 [CANCELACIÓN] Procesando elección de teléfono: ${userInput}`);
  
  const lowerInput = userInput.toLowerCase().trim();
  
  // Detectar si quiere usar el mismo teléfono
  const samePhonePatterns = [
    // Español
    /sí|si|mismo|igual|este|actual|desde.*aquí|desde.*aquí/i,
    /mismo.*teléfono|mismo.*número|igual.*teléfono|igual.*número/i,
    /usar.*este|usar.*mismo|usar.*igual/i,
    
    // Inglés
    /yes|same|this|current|from.*here/i,
    /same.*phone|same.*number|this.*phone|this.*number/i,
    /use.*this|use.*same|use.*current/i,
    
    // Alemán
    /ja|gleich|dasselbe|dieser|aktuell|von.*hier/i,
    /gleiche.*telefon|gleiche.*nummer|dieses.*telefon/i,
    /verwenden.*dieses|verwenden.*gleiche/i,
    
    // Francés
    /oui|même|identique|cet|actuel|d'ici/i,
    /même.*téléphone|même.*numéro|cet.*téléphone/i,
    /utiliser.*ce|utiliser.*même/i,
    
    // Italiano
    /sì|stesso|uguale|questo|attuale|da.*qui/i,
    /stesso.*telefono|stesso.*numero|questo.*telefono/i,
    /usare.*questo|usare.*stesso/i,
    
    // Português
    /sim|mesmo|igual|este|atual|daqui/i,
    /mesmo.*telefone|mesmo.*número|este.*telefone/i,
    /usar.*este|usar.*mesmo/i
  ];
  
  const useSamePhone = samePhonePatterns.some(pattern => pattern.test(lowerInput));
  
  if (useSamePhone) {
    console.log(`📞 [CANCELACIÓN] Usuario eligió usar el mismo teléfono: ${state.phone}`);
    // Usar el teléfono de la llamada directamente
    const reservations = await findReservationsByPhone(state.phone);
    
    if (reservations.length === 0) {
      state.step = 'cancel_no_reservations';
      const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
      return {
        message: getRandomMessage(noReservationsMessages),
        gather: true
      };
    } else if (reservations.length === 1) {
      state.step = 'cancel_confirm_single';
      state.cancellationData = {
        phone: state.phone,
        reservations: reservations,
        selectedReservation: reservations[0]
      };
      
      const singleReservationMessages = getMultilingualMessages('cancel_show_single', state.language);
      const reservationText = formatReservationForDisplay(reservations[0], 0, state.language, reservations).single;
      
      return {
        message: `${getRandomMessage(singleReservationMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
        gather: true
      };
    } else {
      state.step = 'cancel_show_multiple';
      state.cancellationData = {
        phone: state.phone,
        reservations: reservations
      };
      
      const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
      let message = getRandomMessage(multipleReservationsMessages);
      
      reservations.forEach((reservation, index) => {
        const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
        message += ` ${reservationText}.`;
      });
      
      message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
      
      return {
        message: message,
        gather: true
      };
    }
  } else {
    // Usuario quiere usar otro teléfono
    console.log(`📞 [CANCELACIÓN] Usuario eligió usar otro teléfono`);
    state.step = 'cancel_ask_phone';
    state.cancellationData.useOtherPhone = true; // Marcar que debe usar otro teléfono
    const phoneMessages = getMultilingualMessages('cancel_ask_phone', state.language);
    
    return {
      message: getRandomMessage(phoneMessages),
      gather: true
    };
  }
}

async function handleCancelAskPhone(state, userInput) {
  console.log(`📞 [CANCELACIÓN] Procesando número de teléfono: ${userInput}`);
  console.log(`📞 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`📞 [DEBUG] Teléfono del estado: "${state.phone}"`);
  
  // Extraer número de teléfono del input
  let phoneNumber = extractPhoneFromText(userInput);
  console.log(`📞 [DEBUG] Teléfono extraído del input: "${phoneNumber}"`);
  
  // Si el usuario eligió usar otro teléfono, NO usar el de la llamada
  if (state.cancellationData.useOtherPhone) {
    if (!phoneNumber) {
      console.log(`❌ [CANCELACIÓN] No se pudo extraer teléfono del input: "${userInput}"`);
      const unclearMessages = getMultilingualMessages('cancel_ask_phone', state.language);
      return {
        message: `No pude entender el número de teléfono. ${getRandomMessage(unclearMessages)}`,
        gather: true
      };
    }
    console.log(`📞 [CANCELACIÓN] Usando teléfono proporcionado por el usuario: ${phoneNumber}`);
  } else {
    // Si no se encontró en el texto, usar el teléfono de la llamada
    if (!phoneNumber) {
      phoneNumber = state.phone;
      console.log(`📞 [CANCELACIÓN] Usando teléfono de la llamada: ${phoneNumber}`);
    }
  }
  
  console.log(`📞 [DEBUG] Teléfono final a usar para búsqueda: "${phoneNumber}"`);
  
  // Buscar reservas para este teléfono
  const reservations = await findReservationsByPhone(phoneNumber);
  
  if (reservations.length === 0) {
    // No hay reservas
    console.log(`❌ [CANCELACIÓN] No se encontraron reservas para ${phoneNumber}`);
    state.step = 'cancel_no_reservations';
    const noReservationsMessages = getMultilingualMessages('cancel_no_reservations', state.language);
    
    return {
      message: getRandomMessage(noReservationsMessages),
      gather: true
    };
  } else if (reservations.length === 1) {
    // Solo una reserva - mostrar detalles y pedir confirmación
    console.log(`📋 [CANCELACIÓN] Una reserva encontrada:`, reservations[0]);
    state.step = 'cancel_confirm_single';
    state.cancellationData = {
      phone: phoneNumber,
      reservations: reservations,
      selectedReservation: reservations[0]
    };
    
    const singleReservationMessages = getMultilingualMessages('cancel_show_single', state.language);
    const reservationText = formatReservationForDisplay(reservations[0], 0, state.language, reservations).single;
    
    return {
      message: `${getRandomMessage(singleReservationMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
      gather: true
    };
  } else {
    // Múltiples reservas - mostrar lista
    console.log(`📋 [CANCELACIÓN] Múltiples reservas encontradas: ${reservations.length}`);
    state.step = 'cancel_show_multiple';
    state.cancellationData = {
      phone: phoneNumber,
      reservations: reservations
    };
    
    const multipleReservationsMessages = getMultilingualMessages('cancel_show_multiple', state.language);
    let message = getRandomMessage(multipleReservationsMessages);
    
    // Agregar cada reserva como opción
    reservations.forEach((reservation, index) => {
      const reservationText = formatReservationForDisplay(reservation, index, state.language, reservations).option;
      message += ` ${reservationText}.`;
    });
    
    message += ` ${getRandomMessage(getMultilingualMessages('cancel_choose_option', state.language))}`;
    
    return {
      message: message,
      gather: true
    };
  }
}

async function handleCancelShowMultiple(state, userInput) {
  console.log(`🔢 [CANCELACIÓN] Procesando selección de reserva: ${userInput}`);
  console.log(`🔢 [DEBUG] Input del usuario: "${userInput}"`);
  console.log(`🔢 [DEBUG] Número de reservas disponibles: ${state.cancellationData.reservations.length}`);
  
  const reservations = state.cancellationData.reservations;
  
  // Usar Gemini para interpretar la selección del usuario
  const selectedIndex = await analyzeReservationSelectionWithGemini(
    userInput, 
    reservations, 
    state.language,
    { callSid: state.callSid, step: 'cancel_show_multiple' }
  );
  
  if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= reservations.length) {
    console.log(`❌ [CANCELACIÓN] No se pudo detectar opción en: "${userInput}"`);
    const unclearMessages = getMultilingualMessages('cancel_unclear_option', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
  
  // Guardar reserva seleccionada y pedir confirmación
  const selectedReservation = reservations[selectedIndex];
  state.cancellationData.selectedReservation = selectedReservation;
  state.step = 'cancel_confirm_multiple';
  
  const confirmMessages = getMultilingualMessages('cancel_confirm_selected', state.language);
  const reservationText = formatReservationForDisplay(selectedReservation, selectedIndex, state.language).single;
  
  return {
    message: `${getRandomMessage(confirmMessages)} ${reservationText}. ${getRandomMessage(getMultilingualMessages('cancel_confirm', state.language))}`,
    gather: true
  };
}

async function handleCancelConfirmSingle(state, userInput) {
  return await handleCancelConfirmation(state, userInput);
}

async function handleCancelConfirmMultiple(state, userInput) {
  return await handleCancelConfirmation(state, userInput);
}

async function handleCancelConfirmation(state, userInput) {
  console.log(`✅ [CANCELACIÓN] Procesando confirmación: ${userInput}`);
  
  const confirmationResult = detectCancellationConfirmation(userInput);
  
  if (confirmationResult === 'yes') {
    // Confirmar cancelación
    const selectedReservation = state.cancellationData.selectedReservation;
    console.log(`🗑️ [DEBUG] Datos de cancelación:`, {
      selectedReservation: selectedReservation,
      phone: state.cancellationData.phone,
      id_reserva: selectedReservation?.id_reserva
    });
    
    try {
      const success = await cancelReservation(selectedReservation.id_reserva, state.cancellationData.phone);
      
      if (success) {
        console.log(`✅ [CANCELACIÓN] Reserva cancelada exitosamente`);
        state.step = 'cancel_success';
        const successMessages = getMultilingualMessages('cancel_success', state.language);
        
        return {
          message: getRandomMessage(successMessages),
          gather: false // Terminar llamada
        };
      } else {
        console.log(`❌ [CANCELACIÓN] Error cancelando reserva`);
        state.step = 'cancel_error';
        const errorMessages = getMultilingualMessages('cancel_error', state.language);
        
        return {
          message: getRandomMessage(errorMessages),
          gather: false // Terminar llamada
        };
      }
    } catch (error) {
      console.error(`❌ [CANCELACIÓN] Error en cancelación:`, error);
      state.step = 'cancel_error';
      const errorMessages = getMultilingualMessages('cancel_error', state.language);
      
      return {
        message: getRandomMessage(errorMessages),
        gather: false // Terminar llamada
      };
    }
  } else if (confirmationResult === 'no') {
    // Rechazar cancelación
    console.log(`🔄 [CANCELACIÓN] Cancelación rechazada`);
    state.step = 'greeting'; // Volver al inicio
    const cancelledMessages = getMultilingualMessages('cancel_cancelled', state.language);
    
    return {
      message: getRandomMessage(cancelledMessages),
      gather: true
    };
  } else {
    // Respuesta no clara
    const unclearMessages = getMultilingualMessages('cancel_unclear_confirmation', state.language);
    return {
      message: getRandomMessage(unclearMessages),
      gather: true
    };
  }
}

async function handleCancelNoReservations(state, userInput) {
  console.log(`❌ [CANCELACIÓN] No hay reservas - ofreciendo nueva reserva`);
  
  // Preguntar si quiere hacer una nueva reserva
  const newReservationMessages = getMultilingualMessages('cancel_offer_new', state.language);
  
  return {
    message: getRandomMessage(newReservationMessages),
    gather: true
  };
}

/**
 * Genera la URL del endpoint TTS para el audio
 * CRÍTICO: Twilio necesita URLs absolutas, no relativas
 * MEJORADO: Usa texto completo en URL (hasta 2000 caracteres) para evitar problemas con hash
 */
function getTtsAudioUrl(text, language, baseUrl) {
  // CRÍTICO: Siempre usar URL absoluta para Twilio
  // Si no hay baseUrl, intentar construirla desde variables de entorno o usar localhost
  let absoluteUrl;
  
  if (!baseUrl) {
    // Intentar obtener desde variables de entorno de Vercel
    const vercelUrl = process.env.VERCEL_URL;
    if (vercelUrl) {
      absoluteUrl = `https://${vercelUrl}`;
    } else {
      // Fallback a localhost (solo para desarrollo)
      absoluteUrl = 'http://localhost:3000';
      console.warn('⚠️ [TTS] No se encontró baseUrl. Usando localhost como fallback (solo desarrollo)');
    }
  } else {
    absoluteUrl = baseUrl;
  }
  
  // Limpiar URL (remover trailing slash)
  const cleanUrl = absoluteUrl.replace(/\/$/, '');
  
  // Codificar texto para URL
  // NOTA: Las URLs tienen un límite de ~2000 caracteres, pero Twilio puede manejar URLs más largas
  // Si el texto es muy largo, el endpoint TTS lo manejará correctamente
  const encodedText = encodeURIComponent(text);
  
  // Construir URL absoluta con texto codificado
  // El endpoint TTS generará el audio si no está en cache
  const audioUrl = `${cleanUrl}/api/tts?text=${encodedText}&language=${language}`;
  
  // Validar longitud de URL (opcional, solo para logging)
  if (audioUrl.length > 2000) {
    console.warn(`⚠️ [TTS] URL muy larga (${audioUrl.length} caracteres). Twilio debería poder manejarla, pero puede haber problemas.`);
  }
  
  return audioUrl;
}

/**
 * Genera TwiML usando la voz Algieba de Google Cloud Text-to-Speech
 * Usa <Play> en lugar de <Say> para reproducir audio generado por TTS
 */
function generateTwiML(response, language = 'es', processingMessage = null, baseUrl = null, currentStep = null) {
  const { message, gather = true, redirect, voiceConfig: responseVoiceConfig, useAlgieba = true, addNaturalFlow = true } = response;

  const twimlStartTime = Date.now();
  // Log solo en DEBUG (demasiado ruido en producción)

  // MEJORADO: Procesar mensaje para añadir fluidez natural (interjecciones, fragmentación)
  let processedMessage = message;
  if (addNaturalFlow !== false && message) {
    // Detectar contexto del mensaje
    const context = detectMessageContext(message, language);
    
    // Añadir interjecciones naturales (evitar en greeting)
    processedMessage = addNaturalInterjection(message, language, context, currentStep);
    
    // Log solo en DEBUG (demasiado ruido en producción)
  }

  // MEJORADO: Usar voz Algieba de Google Cloud Text-to-Speech
  // Si useAlgieba es true, usar <Play> con endpoint TTS
  // Si es false, usar <Say> con voces de Twilio (fallback)
  if (useAlgieba !== false) {
    // Fragmentar mensaje largo para añadir pausas naturales
    const messageFragments = fragmentLongMessage(processedMessage, 120);
    // Log solo en DEBUG (demasiado ruido en producción)
    
    // OPTIMIZACIÓN: Intentar usar TTS Play (voz Algieba Flash) con fallback a Say si falla
    const ttsUrlStartTime = Date.now();
    const audioUrl = getTtsAudioUrl(processedMessage, language, baseUrl);
    const ttsUrlTime = Date.now() - ttsUrlStartTime;
    
    // Usar TTS Play (voz Algieba Flash) - con fallback a Say si hay error
    const useTtsPlay = true;
    
    // Log solo en DEBUG (demasiado ruido en producción)

    // Si hay redirect, mostrar mensaje y redirigir (para mensajes de procesamiento)
    if (redirect) {
      // Sin pausas aleatorias (suenan raras) - solo pausas cuando son necesarias
      let redirectTwiML = '';
      redirectTwiML += `<Play>${escapeXml(audioUrl)}</Play>`;
      
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${redirectTwiML}
  <Redirect method="POST">${escapeXml(redirect)}</Redirect>
</Response>`;
    }

    if (gather) {
      // Configuración de idioma para Gather (necesario para speech recognition)
      const languageCodes = {
        es: 'es-ES',
        en: 'en-US',
        de: 'de-DE',
        it: 'it-IT',
        fr: 'fr-FR',
        pt: 'pt-BR'
      };
      const gatherLanguage = languageCodes[language] || languageCodes.es;
      
      // Usar Gather para capturar la respuesta del usuario
      // OPTIMIZACIÓN CRÍTICA: Usar SOLO Play O Say, NUNCA ambos (evita duplicación)
      const twimlTime = Date.now() - twimlStartTime;
      
      // Configuración de voz para Say (fallback)
      const voiceConfig = {
        es: { voice: 'Google.es-ES-Neural2-B', language: 'es-ES' },
        en: { voice: 'Google.en-US-Neural2-A', language: 'en-US' },
        de: { voice: 'Google.de-DE-Neural2-A', language: 'de-DE' },
        it: { voice: 'Google.it-IT-Neural2-A', language: 'it-IT' },
        fr: { voice: 'Google.fr-FR-Neural2-A', language: 'fr-FR' },
        pt: { voice: 'Google.pt-BR-Neural2-A', language: 'pt-BR' }
      };
      const sayVoice = voiceConfig[language] || voiceConfig.es;
      
      // MEJORADO: Construir TwiML con pausas naturales si hay fragmentos
      let twimlContent = '';
      
      if (messageFragments.length === 1) {
        // Mensaje corto: una sola reproducción sin pausas aleatorias
        twimlContent = `<Play>${escapeXml(audioUrl)}</Play>`;
      } else {
        // Mensaje largo: fragmentar con pausas mínimas y consistentes entre fragmentos
        messageFragments.forEach((fragment, index) => {
          // Generar URL TTS para cada fragmento
          const fragmentAudioUrl = getTtsAudioUrl(fragment, language, baseUrl);
          twimlContent += `<Play>${escapeXml(fragmentAudioUrl)}</Play>`;
          if (index < messageFragments.length - 1) {
            // Pausa mínima y consistente entre fragmentos (0.5s siempre)
            twimlContent += `\n    <Pause length="0.5"/>`;
          }
        });
      }
      
      // SIN FALLBACK: Usar SOLO Play con TTS (voz Algieba Flash) - sin Say para pruebas
      // Log solo en DEBUG (demasiado ruido en producción)
      const noInputMessage = getRandomMessage(language === 'es' ? [
        'Disculpe, no he escuchado su respuesta. ¿Sigue ahí?',
        'Perdón, no he oído nada. ¿Sigue en la línea?',
        '¿Está ahí? No he escuchado su respuesta.',
        'Disculpe, ¿sigue ahí? No he oído nada.',
        'Perdón, no he escuchado bien. ¿Podría repetir, por favor?',
        'Lo siento, no he captado su respuesta. ¿Sigue ahí?',
        'Disculpe, no he oído bien. ¿Podría repetir, por favor?',
        'Perdón, no he escuchado nada. ¿Sigue en la llamada?'
      ] : ['Sorry, I didn\'t hear your response. Are you still there?']);
      
      // Palabras clave del dominio para mejorar el reconocimiento de voz
      // Esto ayuda especialmente con ruido de fondo y habla imperfecta
      const speechHints = {
        es: 'reserva,mesa,restaurante,personas,fecha,hora,nombre,teléfono,confirmar,cancelar,modificar,mañana,hoy,pasado mañana,lunes,martes,miércoles,jueves,viernes,sábado,domingo',
        en: 'reservation,table,restaurant,people,date,time,name,phone,confirm,cancel,modify,tomorrow,today,next week,monday,tuesday,wednesday,thursday,friday,saturday,sunday',
        de: 'reservierung,tisch,restaurant,personen,datum,uhrzeit,name,telefon,bestätigen,stornieren,ändern,morgen,heute,übermorgen,montag,dienstag,mittwoch,donnerstag,freitag,samstag,sonntag',
        it: 'prenotazione,tavolo,ristorante,persone,data,ora,nome,telefono,confermare,annullare,modificare,domani,oggi,dopodomani,lunedì,martedì,mercoledì,giovedì,venerdì,sabato,domenica',
        fr: 'réservation,table,restaurant,personnes,date,heure,nom,téléphone,confirmer,annuler,modifier,demain,aujourd\'hui,après-demain,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche',
        pt: 'reserva,mesa,restaurante,pessoas,data,hora,nome,telefone,confirmar,cancelar,modificar,amanhã,hoje,depois de amanhã,segunda,terça,quarta,quinta,sexta,sábado,domingo'
      };

      const hints = speechHints[language] || speechHints.es;

      // Configuración optimizada para máxima velocidad y naturalidad:
      // - speechTimeout="auto": Twilio detecta automáticamente cuando el usuario terminó de hablar (más rápido y natural)
      // - timeout="auto": Twilio ajusta automáticamente el tiempo total según el contexto
      // - IMPORTANTE: "auto" detecta pausas naturales y procesa inmediatamente cuando detecta que terminaste de hablar
      // - Esto da la sensación de respuesta instantánea sin vacíos entre frases
      // - hints: palabras clave del dominio mejoran el reconocimiento
      // - partialResultCallback: procesa resultados parciales para mejor experiencia
      // - profanityFilter: ayuda a filtrar ruido y palabras no deseadas
      // - enhanced: mejora el reconocimiento
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call-gemini" 
    method="POST"
    language="${gatherLanguage}"
    speechTimeout="auto"
    timeout="auto"
    hints="${hints}"
    partialResultCallback="/api/twilio-call-gemini"
    partialResultCallbackMethod="POST"
    profanityFilter="true"
    enhanced="true">
    ${twimlContent}
  </Gather>
  <Play>${escapeXml(getTtsAudioUrl(noInputMessage, language, baseUrl))}</Play>
  <Redirect>/api/twilio-call-gemini</Redirect>
</Response>`;
    } else {
      // Solo decir el mensaje y colgar
      // Añadir pausa inicial ocasional para sonar más natural
      let hangupTwiML = '';
      if (addNaturalFlow !== false && Math.random() > 0.5) {
        hangupTwiML = `<Pause length="1"/>\n  `;
      }
      hangupTwiML += `<Play>${escapeXml(audioUrl)}</Play>`;
      
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${hangupTwiML}
  <Hangup/>
</Response>`;
    }
  }

  // FALLBACK: Usar voces de Twilio si useAlgieba es false
  // Configuración de voz por idioma - Google Neural cuando esté disponible
  const voiceConfig = {
    es: { voice: 'Google.es-ES-Neural2-B', language: 'es-ES' },
    en: { voice: 'Google.en-US-Neural2-A', language: 'en-US' },
    de: { voice: 'Google.de-DE-Neural2-A', language: 'de-DE' },
    it: { voice: 'Google.it-IT-Neural2-A', language: 'it-IT' },
    fr: { voice: 'Google.fr-FR-Neural2-A', language: 'fr-FR' },
    pt: { voice: 'Google.pt-BR-Neural2-A', language: 'pt-BR' }
  };

  const config = responseVoiceConfig || voiceConfig[language] || voiceConfig.es;
  console.log(`🎤 [DEBUG] Configuración de voz seleccionada (fallback):`, config);

  // Aplicar procesamiento natural también en fallback
  let fallbackMessage = processedMessage || message;
  const messageFragments = fragmentLongMessage(fallbackMessage, 120);

  // Si hay redirect, mostrar mensaje y redirigir (para mensajes de procesamiento)
  if (redirect) {
    let redirectTwiML = '';
    if (addNaturalFlow !== false && Math.random() > 0.6) {
      redirectTwiML = `<Pause length="1"/>\n  `;
    }
    redirectTwiML += `<Say voice="${config.voice}" language="${config.language}" rate="slow">${escapeXml(fallbackMessage)}</Say>`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${redirectTwiML}
  <Redirect method="POST">${escapeXml(redirect)}</Redirect>
</Response>`;
  }

  if (gather) {
    // Construir contenido sin pausas aleatorias (suenan raras)
    let sayContent = '';
    if (messageFragments.length === 1) {
      sayContent = `<Say voice="${config.voice}" language="${config.language}" rate="slow">${escapeXml(fallbackMessage)}</Say>`;
    } else {
      messageFragments.forEach((fragment, index) => {
        sayContent += `<Say voice="${config.voice}" language="${config.language}" rate="slow">${escapeXml(fragment)}</Say>`;
        if (index < messageFragments.length - 1) {
          // Pausa mínima y consistente entre fragmentos (0.5s siempre)
          sayContent += `\n    <Pause length="0.5"/>`;
        }
      });
    }
    
    // Palabras clave del dominio para mejorar el reconocimiento de voz
    const speechHints = {
      es: 'reserva,mesa,restaurante,personas,fecha,hora,nombre,teléfono,confirmar,cancelar,modificar,mañana,hoy,pasado mañana,lunes,martes,miércoles,jueves,viernes,sábado,domingo',
      en: 'reservation,table,restaurant,people,date,time,name,phone,confirm,cancel,modify,tomorrow,today,next week,monday,tuesday,wednesday,thursday,friday,saturday,sunday',
      de: 'reservierung,tisch,restaurant,personen,datum,uhrzeit,name,telefon,bestätigen,stornieren,ändern,morgen,heute,übermorgen,montag,dienstag,mittwoch,donnerstag,freitag,samstag,sonntag',
      it: 'prenotazione,tavolo,ristorante,persone,data,ora,nome,telefono,confermare,annullare,modificare,domani,oggi,dopodomani,lunedì,martedì,mercoledì,giovedì,venerdì,sabato,domenica',
      fr: 'réservation,table,restaurant,personnes,date,heure,nom,téléphone,confirmer,annuler,modifier,demain,aujourd\'hui,après-demain,lundi,mardi,mercredi,jeudi,vendredi,samedi,dimanche',
      pt: 'reserva,mesa,restaurante,pessoas,data,hora,nome,telefone,confirmar,cancelar,modificar,amanhã,hoje,depois de amanhã,segunda,terça,quarta,quinta,sexta,sábado,domingo'
    };

    const hints = speechHints[language] || speechHints.es;

    // Usar Gather para capturar la respuesta del usuario
    // Configuración mejorada para entornos ruidosos y habla imperfecta
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call-gemini" 
    method="POST"
    language="${config.language}"
    speechTimeout="auto"
    timeout="auto"
    hints="${hints}"
    partialResultCallback="/api/twilio-call-gemini"
    partialResultCallbackMethod="POST"
    profanityFilter="true"
    enhanced="true">
    ${sayContent}
  </Gather>
  <Say voice="${config.voice}" language="${config.language}" rate="slow">${getRandomMessage(language === 'es' ? [
    'Disculpe, no he escuchado su respuesta. ¿Sigue ahí?',
    'Perdón, no he oído nada. ¿Sigue en la línea?',
    '¿Está ahí? No he escuchado su respuesta.',
    'Disculpe, ¿sigue ahí? No he oído nada.',
    'Perdón, no he escuchado bien. ¿Podría repetir, por favor?',
    'Lo siento, no he captado su respuesta. ¿Sigue ahí?',
    'Disculpe, no he oído bien. ¿Podría repetir, por favor?',
    'Perdón, no he escuchado nada. ¿Sigue en la llamada?'
  ] : ['Sorry, I didn\'t hear your response. Are you still there?'])}</Say>
  <Redirect>/api/twilio-call-gemini</Redirect>
</Response>`;
  } else {
    // Solo decir el mensaje y colgar
    let hangupTwiML = '';
    if (addNaturalFlow !== false && Math.random() > 0.5) {
      hangupTwiML = `<Pause length="1"/>\n  `;
    }
    hangupTwiML += `<Say voice="${config.voice}" language="${config.language}" rate="slow">${escapeXml(fallbackMessage)}</Say>`;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${hangupTwiML}
  <Hangup/>
</Response>`;
  }
}

async function saveReservation(state, performanceMetrics = null) {
  const saveStartTime = Date.now();
  try {
    logger.reservation('Guardando reserva en base de datos...', { data: state.data });
    
    // CRÍTICO: Cargar configuración completa del restaurante antes de validar
    // Esto asegura que todas las validaciones usen la configuración más reciente
    await loadRestaurantConfig();
    
    const data = state.data;
    
    // Validar datos básicos
    logger.reservation('🔍 VALIDATION_START', {
      data: data,
      reasoning: 'Iniciando validación de datos de la reserva antes de guardar en base de datos'
    });
    
    const validationStartTime = Date.now();
    const validacion = validarReserva(data);
    
    if (!validacion.valido) {
      logger.error('❌ BASIC_VALIDATION_FAILED', { 
        errores: validacion.errores,
        data: data,
        reasoning: `Validación básica falló. Errores encontrados: ${validacion.errores.join(', ')}`
      });
      return false;
    }
    
    logger.reservation('✅ BASIC_VALIDATION_PASSED', {
      data: data,
      reasoning: 'Validación básica pasó. Procediendo con validación completa...'
    });

    // Validar datos completos (incluye horarios, antelación, etc.)
    logger.reservation('🔍 FULL_VALIDATION_START', {
      data: data,
      reasoning: 'Iniciando validación completa (horarios, antelación, disponibilidad, etc.)'
    });
    
    const validacionCompleta = await validarReservaCompleta(data);
    const validationTime = Date.now() - validationStartTime;
    
    logger.reservation('✅ FULL_VALIDATION_COMPLETED', {
      validationTimeMs: validationTime,
      valida: validacionCompleta.valida,
      errores: validacionCompleta.errores || [],
      advertencias: validacionCompleta.advertencias || [],
      reasoning: `Validación completa completada en ${validationTime}ms. Válida: ${validacionCompleta.valida}`
    });
    // Validation completed - no log necesario
    
    if (!validacionCompleta.valido) {
      logger.error('Validación completa fallida', { errores: validacionCompleta.errores });
      return false;
    }

    // Combinar fecha y hora
    const dataCombinada = combinarFechaHora(data.FechaReserva, data.HoraReserva);

    // OPTIMIZACIÓN: Validar disponibilidad con cache
    logger.reservation('🔍 CHECKING_AVAILABILITY_BEFORE_SAVE', {
      fechaHora: dataCombinada,
      numPersonas: data.NumeroReserva,
      fecha: data.FechaReserva,
      hora: data.HoraReserva,
      reasoning: 'Verificando disponibilidad final antes de guardar la reserva en base de datos...'
    });
    
    const disponibilidad = await validarDisponibilidadCached(dataCombinada, data.NumeroReserva, performanceMetrics);
    
    if (!disponibilidad.disponible) {
      logger.capacity('❌ NO_AVAILABILITY_AT_SAVE', {
        fechaHora: dataCombinada,
        numPersonas: data.NumeroReserva,
        capacidadDisponible: disponibilidad.capacidadDisponible || null,
        capacidadTotal: disponibilidad.capacidadTotal || null,
        reservasExistentes: disponibilidad.reservasExistentes || null,
        detalles: disponibilidad.detalles,
        reasoning: `No hay disponibilidad para ${data.NumeroReserva} personas el ${dataCombinada}. La reserva no se puede guardar.`
      });
      
      // Guardar información de disponibilidad en el estado para mostrar mensaje
      state.availabilityError = {
        mensaje: disponibilidad.mensaje,
        alternativas: disponibilidad.alternativas || []
      };
      return false;
    }

    logger.capacity('✅ AVAILABILITY_CONFIRMED_AT_SAVE', {
      fechaHora: dataCombinada,
      numPersonas: data.NumeroReserva,
      capacidadDisponible: disponibilidad.capacidadDisponible || null,
      capacidadTotal: disponibilidad.capacidadTotal || null,
      personasOcupadas: disponibilidad.detalles?.personasOcupadas || null,
      capacidad: disponibilidad.detalles?.capacidad || null,
      reasoning: `Disponibilidad confirmada. Hay espacio para ${data.NumeroReserva} personas el ${dataCombinada}. Procediendo a guardar...`
    });

    // Preparar conversación completa en formato Markdown
    const conversacionCompleta = generateMarkdownConversation(state);

    // PERFORMANCE: Medir tiempo de operaciones de BD
    const dbStartTime = Date.now();
    // Conectar a base de datos
    const connection = await createConnection();
    const connectionTime = Date.now() - dbStartTime;
    // DB connection established - no log necesario
    if (performanceMetrics) {
      performanceMetrics.dbTime += connectionTime;
    }
    
    try {
      const transactionStartTime = Date.now();
      await connection.beginTransaction();
      const transactionTime = Date.now() - transactionStartTime;
      if (performanceMetrics) {
        performanceMetrics.dbTime += transactionTime;
      }

      // PERFORMANCE: Medir tiempo de inserción de cliente
      const clienteStartTime = Date.now();
      // 1. Insertar o actualizar cliente
      const clienteQuery = `
        INSERT INTO CLIENT (nom_persona_reserva, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          nom_persona_reserva = VALUES(nom_persona_reserva), 
          DATA_ULTIMA_RESERVA = NOW()
      `;
      
      await connection.execute(clienteQuery, [
        data.NomReserva,
        data.TelefonReserva
      ]);
      const clienteTime = Date.now() - clienteStartTime;
      logger.reservation('Cliente insertado/actualizado', { timeMs: clienteTime });
      if (performanceMetrics) {
        performanceMetrics.dbTime += clienteTime;
      }

      // PERFORMANCE: Medir tiempo de inserción de reserva
      const reservaStartTime = Date.now();
      // 2. Insertar reserva
      const reservaQuery = `
        INSERT INTO RESERVA 
        (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await connection.execute(reservaQuery, [
        dataCombinada,
        data.NumeroReserva,
        data.TelefonReserva,
        data.NomReserva,
        data.Observacions || null,
        conversacionCompleta
      ]);

      const idReserva = result.insertId;
      const reservaTime = Date.now() - reservaStartTime;
      logger.reservation('Reserva insertada', { idReserva, timeMs: reservaTime });
      if (performanceMetrics) {
        performanceMetrics.dbTime += reservaTime;
      }

      // PERFORMANCE: Medir tiempo de commit
      const commitStartTime = Date.now();
      await connection.commit();
      const commitTime = Date.now() - commitStartTime;
      logger.reservation('Transacción confirmada', { timeMs: commitTime });
      if (performanceMetrics) {
        performanceMetrics.dbTime += commitTime;
      }
      
      const totalSaveTime = Date.now() - saveStartTime;
      // Reservation saved - no log necesario (ya está en PERF_METRICS)
      // Reservation saved - no log necesario (ya está en PERF_METRICS)
      
      return true;

    } catch (error) {
      await connection.rollback();
      const dbErrorTime = Date.now() - dbStartTime;
      logger.error('RESERVATION_SAVE_DB_ERROR', {
        error: error.message,
        dbTimeMs: dbErrorTime
      });
      throw error;
    } finally {
      await connection.end();
    }

  } catch (error) {
    const totalErrorTime = Date.now() - saveStartTime;
    logger.error('RESERVATION_SAVE_ERROR', {
      error: error.message,
      stack: error.stack,
      totalTimeMs: totalErrorTime
    });
    return false;
  }
}

// Funciones auxiliares de extracción

function getRandomMessage(messages) {
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex];
}

/**
 * Añade interjecciones naturales al inicio de los mensajes para sonar más humano
 * @param {string} message - Mensaje original
 * @param {string} language - Idioma ('es', 'en', etc.)
 * @param {string} context - Contexto de la conversación ('thinking', 'confirming', 'processing', 'normal')
 * @returns {string} Mensaje con interjección añadida (o sin ella si no aplica)
 */
function addNaturalInterjection(message, language = 'es', context = 'normal', step = null) {
  if (!message || message.trim().length === 0) return message;
  
  // NO añadir interjecciones en el saludo inicial (greeting y ask_intention) - suena artificial
  if (step === 'greeting' || step === 'ask_intention') return message;
  
  // Probabilidad de añadir interjección (15% para sonar natural pero no repetitivo)
  if (Math.random() > 0.15) return message;
  
  const interjections = {
    es: {
      thinking: ['Emm', 'Aja', 'Déjame ver', 'A ver', 'Vale', 'Claro', 'Bueno'],
      confirming: ['Vale', 'Claro', 'De acuerdo', 'Bien', 'Aja', 'Entendido', 'Muy bien'],
      processing: ['Aja', 'Vale', 'Claro', 'Bien', 'Déjame ver', 'Un momento'],
      normal: ['Vale', 'Claro', 'Bien', 'Aja', 'Emm', 'Bueno', 'De acuerdo']
    },
    en: {
      thinking: ['Hmm', 'Well', 'Let me see', 'Okay', 'Right', 'Uh'],
      confirming: ['Perfect', 'Okay', 'Right', 'Sure', 'Got it', 'Alright'],
      processing: ['Okay', 'Right', 'Sure', 'Got it', 'Let me see'],
      normal: ['Okay', 'Right', 'Sure', 'Well', 'Hmm', 'Uh']
    }
  };
  
  const langInterjections = interjections[language] || interjections.es;
  const contextInterjections = langInterjections[context] || langInterjections.normal;
  const interjection = getRandomMessage(contextInterjections);
  
  // Añadir interjección con coma o punto según el contexto
  // Si el mensaje ya empieza con mayúscula, mantenerla; si no, capitalizar
  const firstChar = message.trim()[0];
  const restOfMessage = message.trim().substring(1);
  const capitalizedMessage = firstChar.toUpperCase() + restOfMessage;
  
  return `${interjection}, ${capitalizedMessage}`;
}

/**
 * Fragmenta mensajes largos en partes más naturales con pausas
 * @param {string} message - Mensaje original
 * @param {number} maxLength - Longitud máxima por fragmento (default: 120 caracteres)
 * @returns {Array} Array de fragmentos del mensaje
 */
function fragmentLongMessage(message, maxLength = 120) {
  if (!message || message.length <= maxLength) {
    return [message];
  }
  
  // Dividir por puntos, comas, puntos y comas, o signos de interrogación
  const sentences = message.split(/([.,;?!])\s*/).filter(s => s.trim().length > 0);
  const fragments = [];
  let currentFragment = '';
  
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    
    // Si añadir esta oración excede el límite, guardar fragmento actual
    if (currentFragment.length + sentence.length > maxLength && currentFragment.length > 0) {
      fragments.push(currentFragment.trim());
      currentFragment = sentence;
    } else {
      currentFragment += (currentFragment ? ' ' : '') + sentence;
    }
  }
  
  if (currentFragment.trim().length > 0) {
    fragments.push(currentFragment.trim());
  }
  
  return fragments.length > 0 ? fragments : [message];
}

/**
 * Añade confirmaciones naturales después de procesar input del usuario
 * @param {string} userInput - Input del usuario
 * @param {string} language - Idioma
 * @returns {string} Confirmación natural o string vacío
 */
function getNaturalAcknowledgment(userInput, language = 'es') {
  // Solo añadir confirmación ocasionalmente (25% de las veces para no ser repetitivo)
  if (Math.random() > 0.25) return '';
  
  const acknowledgments = {
    es: ['Okey', 'Vale', 'Claro', 'Bien', 'De acuerdo', 'Entendido', 'Muy bien'],
    en: ['Okay', 'Right', 'Got it', 'Sure', 'Understood', 'Alright']
  };
  
  const langAcks = acknowledgments[language] || acknowledgments.es;
  return getRandomMessage(langAcks);
}

/**
 * Detecta el contexto de un mensaje para añadir interjecciones apropiadas
 * @param {string} message - Mensaje a analizar
 * @param {string} language - Idioma
 * @returns {string} Contexto detectado ('thinking', 'confirming', 'processing', 'normal')
 */
function detectMessageContext(message, language = 'es') {
  if (!message) return 'normal';
  
  const lowerMessage = message.toLowerCase();
  
  // Patrones para detectar contexto
  const thinkingPatterns = {
    es: ['déjame ver', 'déjame comprobar', 'déjame buscar', 'verificar', 'comprobar', 'revisar'],
    en: ['let me see', 'let me check', 'let me find', 'verify', 'check', 'review']
  };
  
  const confirmingPatterns = {
    es: ['perfecto', 'confirm', 'reserva', 'pedido', 'correcto', 'exacto', 'de acuerdo'],
    en: ['perfect', 'confirm', 'reservation', 'order', 'correct', 'exactly', 'agreed']
  };
  
  const processingPatterns = {
    es: ['procesando', 'buscando', 'consultando', 'revisando', 'comprobando'],
    en: ['processing', 'searching', 'checking', 'reviewing', 'consulting']
  };
  
  const patterns = language === 'en' ? {
    thinking: thinkingPatterns.en,
    confirming: confirmingPatterns.en,
    processing: processingPatterns.en
  } : {
    thinking: thinkingPatterns.es,
    confirming: confirmingPatterns.es,
    processing: processingPatterns.es
  };
  
  if (patterns.thinking.some(pattern => lowerMessage.includes(pattern))) {
    return 'thinking';
  }
  if (patterns.confirming.some(pattern => lowerMessage.includes(pattern))) {
    return 'confirming';
  }
  if (patterns.processing.some(pattern => lowerMessage.includes(pattern))) {
    return 'processing';
  }
  
  return 'normal';
}

// Función para obtener mensajes de "procesando" multilingües
// Mensajes naturales y cálidos para hacer la espera más amigable
function getProcessingMessage(language = 'es') {
  const messages = {
    es: [
      'Un segundo por favor, que le confirmo...',
      'Déjeme verificar un momento, por favor...',
      'Un segundo, que lo compruebo ahora mismo...',
      'Muy bien, déjeme revisar eso rápidamente...',
      'Perfecto, un momentito que lo consulto...',
      'Déjeme comprobar un instante, por favor...',
      'Claro, un segundito que lo verifico...',
      'Déjeme confirmar eso ahora mismo...',
      'Un momento, que lo miro aquí...',
      'Sí, sí, déjeme verificar eso un segundo...',
      'Por supuesto, un momentito que lo consulto...',
      'Muy bien, déjeme revisar un momento, por favor...',
      'Eeeh, déjeme ver eso rápidamente...',
      'Un segundito, que lo compruebo ahora...',
      'Claro, claro, déjeme confirmar eso...',
      'Perfecto, un segundo que lo reviso...',
      'Déjeme verificar eso un momento...',
      'Eeh, un segundo por favor, que lo consulto...',
      'Sí, déjeme comprobar eso ahora...',
      'Un momentito, que lo miro aquí...',
      'Claro, déjeme verificar eso rápidamente...',
      'Perfecto, un segundo que lo confirmo...'
    ],
    en: [
      'One moment please.',
      'Just a moment.',
      'Let me check.',
      'Processing information.'
    ],
    de: [
      'Einen Moment bitte.',
      'Einen Augenblick.',
      'Lassen Sie mich überprüfen.',
      'Informationen werden verarbeitet.'
    ],
    it: [
      'Un momento per favore.',
      'Un attimo.',
      'Fammi controllare.',
      'Elaborazione delle informazioni.'
    ],
    fr: [
      'Un instant s\'il vous plaît.',
      'Un moment.',
      'Laissez-moi vérifier.',
      'Traitement des informations.'
    ],
    pt: [
      'Um momento por favor.',
      'Um instante.',
      'Deixe-me verificar.',
      'Processando informações.'
    ]
  };
  
  // Devolver el objeto completo para que el llamador pueda elegir el mensaje
  return messages;
}

// Función para obtener mensajes multilingües
/**
 * Obtiene mensajes multilingües para cuando se excede el máximo de personas
 */
function getTimeOutOfHoursMessages(language = 'es', hora = null) {
  // Construir información de horarios disponibles
  const horariosDisponibles = [];
  if (restaurantConfig.horario1Inicio && restaurantConfig.horario1Fin) {
    horariosDisponibles.push(`${restaurantConfig.horario1Inicio} - ${restaurantConfig.horario1Fin}`);
  }
  if (restaurantConfig.horario2Inicio && restaurantConfig.horario2Fin) {
    horariosDisponibles.push(`${restaurantConfig.horario2Inicio} - ${restaurantConfig.horario2Fin}`);
  }
  if (restaurantConfig.horario3Inicio && restaurantConfig.horario3Fin) {
    horariosDisponibles.push(`${restaurantConfig.horario3Inicio} - ${restaurantConfig.horario3Fin}`);
  }
  const horariosStr = horariosDisponibles.join(' o ');
  
  const messages = {
    es: [
      `Lo siento mucho, a esa hora no estamos disponibles. Nuestro horario es de ${horariosStr}. ¿Qué otra hora les conviene mejor?`,
      `Disculpe, no atendemos a esa hora. Estamos disponibles de ${horariosStr}. ¿Qué hora les vendría mejor?`,
      `Lamentablemente, no estamos abiertos a esa hora. Nuestro horario de servicio es de ${horariosStr}. ¿Prefieren otro horario que les venga mejor?`,
      `A esa hora no podemos atenderles, lo siento. Estamos disponibles de ${horariosStr}. ¿Podrían decirme otra hora que les convenga?`,
      `Lo siento, a esa hora no tenemos disponibilidad. Nuestro horario es de ${horariosStr}. ¿Qué hora les gustaría en su lugar?`,
      `Perdón, a esa hora no podemos atenderles. Nuestro horario es de ${horariosStr}. ¿Qué otra hora les vendría bien?`,
      `Disculpe, no estamos disponibles a esa hora. Estamos abiertos de ${horariosStr}. ¿Qué hora les gustaría en su lugar?`,
      `Lo siento mucho, a esa hora no podemos atenderles. Nuestro horario es de ${horariosStr}. ¿Qué hora les conviene mejor?`
    ],
    en: [
      `I'm sorry, we're not available at that time. Our hours are ${horariosStr}. Could you choose another time?`,
      `Sorry, we don't serve at that time. We're available from ${horariosStr}. What other time would work for you?`,
      `Unfortunately, we're not open at that time. Our service hours are ${horariosStr}. Would you prefer another time?`,
      `We can't serve you at that time. We're available from ${horariosStr}. Could you tell me another time?`
    ],
    de: [
      `Es tut mir leid, wir sind zu dieser Zeit nicht verfügbar. Unsere Öffnungszeiten sind ${horariosStr}. Könnten Sie eine andere Zeit wählen?`,
      `Entschuldigung, wir servieren zu dieser Zeit nicht. Wir sind verfügbar von ${horariosStr}. Welche andere Zeit würde für Sie passen?`,
      `Leider sind wir zu dieser Zeit nicht geöffnet. Unsere Servicezeiten sind ${horariosStr}. Würden Sie eine andere Zeit bevorzugen?`,
      `Wir können Sie zu dieser Zeit nicht bedienen. Wir sind verfügbar von ${horariosStr}. Könnten Sie mir eine andere Zeit nennen?`
    ],
    fr: [
      `Je suis désolé, nous ne sommes pas disponibles à cette heure. Nos horaires sont ${horariosStr}. Pourriez-vous choisir une autre heure?`,
      `Désolé, nous ne servons pas à cette heure. Nous sommes disponibles de ${horariosStr}. Quelle autre heure vous conviendrait?`,
      `Malheureusement, nous ne sommes pas ouverts à cette heure. Nos heures de service sont ${horariosStr}. Préféreriez-vous une autre heure?`,
      `Nous ne pouvons pas vous servir à cette heure. Nous sommes disponibles de ${horariosStr}. Pourriez-vous me dire une autre heure?`
    ],
    it: [
      `Mi dispiace, non siamo disponibili a quell'ora. I nostri orari sono ${horariosStr}. Potresti scegliere un altro orario?`,
      `Scusa, non serviamo a quell'ora. Siamo disponibili dalle ${horariosStr}. Quale altro orario ti andrebbe bene?`,
      `Sfortunatamente, non siamo aperti a quell'ora. I nostri orari di servizio sono ${horariosStr}. Preferiresti un altro orario?`,
      `Non possiamo servirvi a quell'ora. Siamo disponibili dalle ${horariosStr}. Potresti dirmi un altro orario?`
    ],
    pt: [
      `Desculpe, não estamos disponíveis nesse horário. Nossos horários são ${horariosStr}. Você poderia escolher outro horário?`,
      `Desculpe, não servimos nesse horário. Estamos disponíveis das ${horariosStr}. Que outro horário funcionaria para você?`,
      `Infelizmente, não estamos abertos nesse horário. Nossos horários de atendimento são ${horariosStr}. Você prefere outro horário?`,
      `Não podemos atendê-lo nesse horário. Estamos disponíveis das ${horariosStr}. Você poderia me dizer outro horário?`
    ]
  };
  
  return messages[language] || messages.es;
}

function getMaxPeopleExceededMessages(language = 'es', maxPersonas = 20) {
  const messages = {
    es: [
      `Lo siento mucho, el máximo de personas por reserva es ${maxPersonas}. ¿Podrían hacer la reserva para ${maxPersonas} personas o menos?`,
      `Disculpe, solo podemos aceptar hasta ${maxPersonas} personas por reserva. ¿Cuántas personas serían entonces?`,
      `El máximo que podemos aceptar es ${maxPersonas} personas por mesa. ¿Para cuántas personas desean hacer la reserva?`,
      `Lamentablemente, no podemos aceptar más de ${maxPersonas} personas en una sola reserva. ¿Podrían decirme un número menor, por favor?`,
      `Lo siento, tenemos un límite de ${maxPersonas} personas por reserva. ¿Para cuántas personas les gustaría entonces?`,
      `Perdón, el máximo de personas que podemos aceptar por reserva es ${maxPersonas}. ¿Cuántas personas serían?`,
      `Disculpe, solo podemos reservar para hasta ${maxPersonas} personas. ¿Para cuántas personas desean hacer la reserva?`,
      `Lo siento mucho, tenemos un límite máximo de ${maxPersonas} personas por reserva. ¿Cuántas personas serían entonces?`
    ],
    en: [
      `I'm sorry, the maximum number of people per reservation is ${maxPersonas}. Could you make the reservation for ${maxPersonas} people or less?`,
      `Sorry, we can only accept up to ${maxPersonas} people per reservation. How many people would it be?`,
      `The maximum allowed is ${maxPersonas} people per table. How many people would you like to reserve for?`,
      `Unfortunately, we cannot accept more than ${maxPersonas} people in a single reservation. Could you tell me a smaller number?`
    ],
    de: [
      `Es tut mir leid, die maximale Anzahl von Personen pro Reservierung beträgt ${maxPersonas}. Könnten Sie die Reservierung für ${maxPersonas} Personen oder weniger vornehmen?`,
      `Entschuldigung, wir können nur bis zu ${maxPersonas} Personen pro Reservierung akzeptieren. Wie viele Personen wären es?`,
      `Das Maximum beträgt ${maxPersonas} Personen pro Tisch. Für wie viele Personen möchten Sie reservieren?`,
      `Leider können wir nicht mehr als ${maxPersonas} Personen in einer einzigen Reservierung akzeptieren. Könnten Sie mir eine kleinere Anzahl nennen?`
    ],
    fr: [
      `Je suis désolé, le nombre maximum de personnes par réservation est ${maxPersonas}. Pourriez-vous faire la réservation pour ${maxPersonas} personnes ou moins?`,
      `Désolé, nous ne pouvons accepter que jusqu'à ${maxPersonas} personnes par réservation. Combien de personnes seraient-ce?`,
      `Le maximum autorisé est ${maxPersonas} personnes par table. Pour combien de personnes souhaitez-vous réserver?`,
      `Malheureusement, nous ne pouvons pas accepter plus de ${maxPersonas} personnes dans une seule réservation. Pourriez-vous me donner un nombre plus petit?`
    ],
    it: [
      `Mi dispiace, il numero massimo di persone per prenotazione è ${maxPersonas}. Potresti fare la prenotazione per ${maxPersonas} persone o meno?`,
      `Scusa, possiamo accettare solo fino a ${maxPersonas} persone per prenotazione. Quante persone sarebbero?`,
      `Il massimo consentito è ${maxPersonas} persone per tavolo. Per quante persone desideri prenotare?`,
      `Sfortunatamente, non possiamo accettare più di ${maxPersonas} persone in una singola prenotazione. Potresti dirmi un numero più piccolo?`
    ],
    pt: [
      `Desculpe, o número máximo de pessoas por reserva é ${maxPersonas}. Você poderia fazer a reserva para ${maxPersonas} pessoas ou menos?`,
      `Desculpe, só podemos aceitar até ${maxPersonas} pessoas por reserva. Quantas pessoas seriam?`,
      `O máximo permitido é ${maxPersonas} pessoas por mesa. Para quantas pessoas você gostaria de reservar?`,
      `Infelizmente, não podemos aceitar mais de ${maxPersonas} pessoas em uma única reserva. Você poderia me dizer um número menor?`
    ]
  };
  
  return messages[language] || messages.es;
}

function getMultilingualMessages(type, language = 'es', variables = {}) {
  const messages = {
    greeting: {
      es: [
        '¡Hola! ¿Qué tal? ¿En qué puedo ayudarle hoy?',
        '¡Buenos días! ¿Cómo está? ¿Qué necesita?',
        '¡Hola! Gracias por llamar. ¿En qué le puedo ayudar?',
        '¡Buenas tardes! ¿Qué tal? ¿Cómo puedo ayudarle?',
        '¡Hola! ¿En qué puedo asistirle?',
        '¡Buenos días! Dígame, ¿qué necesita?',
        '¡Hola! ¿Qué tal va el día? ¿En qué puedo ayudarle?',
        '¡Buenas! Gracias por llamarnos. ¿Qué puedo hacer por usted?',
        '¡Hola! ¿Cómo está? ¿En qué le puedo ayudar?',
        '¡Buenos días! ¿Qué tal? ¿Qué necesita hoy?',
        '¡Hola! Dígame, ¿en qué puedo ayudarle?',
        '¡Buenas tardes! ¿Cómo está? ¿Qué puedo hacer por usted?'
      ],
      en: [
        'Hello! Welcome to our restaurant. How can I help you?',
        'Good morning! Welcome. How can I assist you today?',
        'Hello! Thank you for calling. How can I help you?',
        'Good afternoon! Welcome to the restaurant. What do you need?',
        'Hello! Delighted to serve you. How can I help you?'
      ],
      de: [
        'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?',
        'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?',
        'Hallo! Vielen Dank für Ihren Anruf. Wie kann ich Ihnen helfen?',
        'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?',
        'Hallo! Freue mich, Ihnen zu dienen. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?',
        'Buongiorno! Benvenuto. Come posso assisterti oggi?',
        'Ciao! Grazie per la chiamata. Come posso aiutarti?',
        'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?',
        'Ciao! Felice di servirti. Come posso aiutarti?'
      ],
      fr: [
        'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
        'Bonjour! Bienvenue. Comment puis-je vous assister aujourd\'hui?',
        'Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?',
        'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?',
        'Bonjour! Ravi de vous servir. Comment puis-je vous aider?'
      ],
      pt: [
        'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?',
        'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?',
        'Olá! Obrigado por ligar. Como posso ajudá-lo?',
        'Boa tarde! Bem-vindo ao restaurante. O que você precisa?',
        'Olá! Prazer em atendê-lo. Como posso ajudá-lo?'
      ]
    },
    reservation: {
      es: [
        '¡Por supuesto! Con mucho gusto. ¿Para cuántas personas será?',
        '¡Claro! Sin problema. ¿Cuántas personas serán?',
        '¡Vale! Por supuesto. ¿Para cuántos comensales?',
        '¡Genial! ¿Para cuántas personas necesita la mesa?',
        '¡De acuerdo! ¿Cuántas personas van a venir?',
        '¡Por supuesto! Con mucho gusto. ¿Para cuántas personas?',
        '¡Claro! Sin problema. ¿Cuántas personas serán?',
        '¡Vale! Por supuesto. ¿Para cuántas personas?',
        '¡Perfecto! ¿Cuántas personas van a venir?',
        '¡Genial! ¿Para cuántas personas será?',
        '¡Claro! ¿Cuántas personas serán?',
        '¡Vale! ¿Para cuántas personas?'
      ],
      en: [
        'Perfect! I\'m delighted to help you with your reservation. For how many people?',
        'Excellent! I\'m happy to help you with the reservation. How many people will it be?',
        'Great! I\'m happy to help. For how many diners?',
        'Perfect! For how many people do you need the table?',
        'Great! How many people are coming?',
        'Hello! I\'d be happy to help you make a reservation. For how many people?',
        'Welcome! I can help you with your table reservation. How many people?',
        'Of course! I\'ll help you book a table. For how many people?'
      ],
      de: [
        'Perfekt! Ich helfe Ihnen gerne bei Ihrer Reservierung. Für wie viele Personen?',
        'Ausgezeichnet! Ich helfe Ihnen gerne bei der Reservierung. Wie viele Personen werden es sein?',
        'Sehr gut! Ich helfe Ihnen gerne. Für wie viele Gäste?',
        'Perfekt! Für wie viele Personen benötigen Sie den Tisch?',
        'Großartig! Wie viele Personen kommen?',
        'Hallo! Gerne helfe ich Ihnen bei der Tischreservierung. Für wie viele Personen?',
        'Willkommen! Ich kann Ihnen bei der Tischreservierung helfen. Für wie viele Personen?',
        'Natürlich! Ich helfe Ihnen gerne beim Tischreservieren. Für wie viele Personen?'
      ],
      it: [
        'Perfetto! Sono felice di aiutarti con la tua prenotazione. Per quante persone?',
        'Eccellente! Sono felice di aiutarti con la prenotazione. Quante persone saranno?',
        'Molto bene! Sono felice di aiutarti. Per quanti commensali?',
        'Perfetto! Per quante persone hai bisogno del tavolo?',
        'Fantastico! Quante persone vengono?',
        'Ciao! Sono felice di aiutarti con la prenotazione del tavolo. Per quante persone?',
        'Benvenuto! Posso aiutarti con la prenotazione del tavolo. Per quante persone?',
        'Naturalmente! Ti aiuto volentieri a prenotare un tavolo. Per quante persone?'
      ],
      fr: [
        'Parfait! Je suis ravi de vous aider avec votre réservation. Pour combien de personnes?',
        'Excellent! Je suis heureux de vous aider avec la réservation. Combien de personnes seront-elles?',
        'Très bien! Je suis heureux de vous aider. Pour combien de convives?',
        'Parfait! Pour combien de personnes avez-vous besoin de la table?',
        'Génial! Combien de personnes viennent?',
        'Bonjour! Je serais ravi de vous aider avec votre réservation de table. Pour combien de personnes?',
        'Bienvenue! Je peux vous aider avec votre réservation de table. Pour combien de personnes?',
        'Bien sûr! Je vous aide volontiers à réserver une table. Pour combien de personnes?'
      ],
      pt: [
        'Perfeito! Estou encantado em ajudá-lo com sua reserva. Para quantas pessoas?',
        'Excelente! Estou feliz em ajudá-lo com a reserva. Quantas pessoas serão?',
        'Muito bem! Estou feliz em ajudá-lo. Para quantos comensais?',
        'Perfeito! Para quantas pessoas você precisa da mesa?',
        'Ótimo! Quantas pessoas estão vindo?',
        'Olá! Fico feliz em ajudá-lo com sua reserva de mesa. Para quantas pessoas?',
        'Bem-vindo! Posso ajudá-lo com sua reserva de mesa. Para quantas pessoas?',
        'Claro! Ajudarei você a reservar uma mesa. Para quantas pessoas?'
      ]
    },
    clarify: {
      es: [
        'Disculpe, solo puedo ayudarle con reservas. ¿Le gustaría hacer una reserva?',
        'Lo siento, solo puedo ayudarle con reservas de mesa. ¿Quiere hacer una reserva?',
        'Perdón, solo manejo reservas para nuestro restaurante. ¿Le gustaría reservar una mesa?',
        'Disculpe, solo puedo ayudarle con reservas. ¿Desea hacer una reserva?',
        'Lo siento, solo puedo ayudarle con reservas. ¿Quiere reservar una mesa?',
        'Disculpe, en este momento solo puedo ayudarle con reservas de mesa. ¿Le gustaría hacer una reserva?',
        'Lo siento, pero solo puedo atender reservas. ¿Quiere reservar una mesa?',
        'Perdón, solo puedo ayudarle con reservas. ¿Le gustaría que le reserve una mesa?'
      ],
    clarify_reservation_confirm: {
      es: [
        '¿Desea hacer una reserva a nombre de ${variables.name}?',
        '¿Quiere hacer una reserva a nombre de ${variables.name}?',
        '¿Le gustaría hacer una reserva a nombre de ${variables.name}?',
        '¿Desea reservar una mesa a nombre de ${variables.name}?',
        '¿Quiere reservar a nombre de ${variables.name}?',
        '¿Desea hacer una reserva a nombre de ${variables.name}?',
        'Vale, ¿quiere hacer una reserva a nombre de ${variables.name}?',
        'Muy bien, ¿desea reservar una mesa a nombre de ${variables.name}?',
        'Entendido, ¿desea hacer una reserva a nombre de ${variables.name}?',
        '¿Quiere reservar una mesa a nombre de ${variables.name}?',
        'Vale, ¿desea hacer una reserva a nombre de ${variables.name}?',
        'Muy bien, ¿quiere hacer una reserva a nombre de ${variables.name}?',
        'Claro, ¿desea hacer una reserva a nombre de ${variables.name}?',
        'Por supuesto, ¿quiere reservar a nombre de ${variables.name}?',
        '¿Desea reservar una mesa a nombre de ${variables.name}?',
        'Vale, ¿quiere hacer una reserva a nombre de ${variables.name}?',
        'Entendido, ¿desea reservar a nombre de ${variables.name}?',
        'Muy bien, ¿quiere hacer una reserva a nombre de ${variables.name}?'
      ],
      en: [
        'Would you like to make a reservation under the name ${variables.name}?',
        'Do you want to make a reservation under the name ${variables.name}?',
        'Would you like to book a table under the name ${variables.name}?',
        'Do you want to reserve a table under the name ${variables.name}?',
        'Perfect, would you like to make a reservation under the name ${variables.name}?'
      ],
      de: [
        'Möchten Sie eine Reservierung unter dem Namen ${variables.name} vornehmen?',
        'Möchten Sie eine Reservierung unter dem Namen ${variables.name} machen?',
        'Möchten Sie einen Tisch unter dem Namen ${variables.name} reservieren?',
        'Perfekt, möchten Sie eine Reservierung unter dem Namen ${variables.name} vornehmen?',
        'Vale, möchten Sie eine Reservierung unter dem Namen ${variables.name} machen?'
      ],
      it: [
        'Vuole fare una prenotazione a nome di ${variables.name}?',
        'Vuole prenotare un tavolo a nome di ${variables.name}?',
        'Perfetto, vuole fare una prenotazione a nome di ${variables.name}?',
        'Va bene, vuole prenotare a nome di ${variables.name}?',
        'Molto bene, vuole fare una prenotazione a nome di ${variables.name}?'
      ],
      fr: [
        'Souhaitez-vous faire une réservation au nom de ${variables.name}?',
        'Voulez-vous faire une réservation au nom de ${variables.name}?',
        'Voulez-vous réserver une table au nom de ${variables.name}?',
        'Parfait, souhaitez-vous faire une réservation au nom de ${variables.name}?',
        'Très bien, voulez-vous réserver au nom de ${variables.name}?'
      ],
      pt: [
        'Gostaria de fazer uma reserva em nome de ${variables.name}?',
        'Quer fazer uma reserva em nome de ${variables.name}?',
        'Quer reservar uma mesa em nome de ${variables.name}?',
        'Perfeito, gostaria de fazer uma reserva em nome de ${variables.name}?',
        'Muito bem, quer fazer uma reserva em nome de ${variables.name}?'
      ]
    },
      en: [
        'Sorry, I can only help you with reservations. Would you like to make a reservation?',
        'I apologize, I can only help with reservations. Do you want to make a reservation?',
        'Sorry, I can only assist with reservations. Would you like to book?',
        'Sorry, I only handle reservations. Do you want to make a reservation?',
        'I apologize, I can only help with reservations. Do you want to book a table?'
      ],
      de: [
        'Entschuldigung, ich kann Ihnen nur bei Reservierungen helfen. Möchten Sie eine Reservierung vornehmen?',
        'Es tut mir leid, ich kann nur bei Reservierungen helfen. Möchten Sie eine Reservierung?',
        'Entschuldigung, ich kann nur bei Reservierungen helfen. Möchten Sie reservieren?',
        'Entschuldigung, ich bearbeite nur Reservierungen. Möchten Sie eine Reservierung?',
        'Es tut mir leid, ich kann nur bei Reservierungen helfen. Möchten Sie einen Tisch reservieren?'
      ],
      it: [
        'Scusi, posso aiutarla solo con le prenotazioni. Vorrebbe fare una prenotazione?',
        'Mi dispiace, posso aiutarla solo con le prenotazioni. Vuole fare una prenotazione?',
        'Scusi, posso assisterla solo con le prenotazioni. Vorrebbe prenotare?',
        'Scusi, gestisco solo le prenotazioni. Vuole fare una prenotazione?',
        'Mi dispiace, posso aiutarla solo con le prenotazioni. Vuole prenotare un tavolo?'
      ],
      fr: [
        'Désolé, je ne peux vous aider qu\'avec les réservations. Souhaitez-vous faire une réservation?',
        'Je suis désolé, je ne peux aider qu\'avec les réservations. Voulez-vous faire une réservation?',
        'Désolé, je ne peux assister qu\'avec les réservations. Souhaitez-vous réserver?',
        'Désolé, je ne gère que les réservations. Voulez-vous faire une réservation?',
        'Je suis désolé, je ne peux aider qu\'avec les réservations. Voulez-vous réserver une table?'
      ],
      pt: [
        'Desculpe, só posso ajudá-lo com reservas. Gostaria de fazer uma reserva?',
        'Sinto muito, só posso ajudá-lo com reservas. Quer fazer uma reserva?',
        'Desculpe, só posso assistir com reservas. Gostaria de reservar?',
        'Desculpe, só lido com reservas. Quer fazer uma reserva?',
        'Sinto muito, só posso ajudá-lo com reservas. Quer reservar uma mesa?'
      ]
    },
    people: {
      es: [
        `Mesa para ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para qué día les gustaría venir?`,
        `Vale, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día prefieren?`,
        `Muy bien, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para cuándo sería?`,
        `Genial, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día les viene bien?`,
        `De acuerdo, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Cuándo les gustaría venir?`,
        `¡Vale! Mesa para ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día les viene mejor?`,
        `Muy bien, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para qué día?`,
        `Entendido, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día les viene bien?`,
        `Vale, mesa para ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día les conviene?`,
        `Claro, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para cuándo?`,
        `Muy bien, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Qué día les gustaría?`,
        `Genial, ${variables.people} ${variables.people === 1 ? 'persona' : 'personas'}. ¿Para qué día?`
      ],
      en: [
        `Perfect, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For what date?`,
        `Excellent, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. What day do you prefer?`,
        `Great, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For when?`,
        `Perfect, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. For what day?`,
        `Great, ${variables.people} ${variables.people === 1 ? 'person' : 'people'}. When would you like to come?`
      ],
      de: [
        `Perfekt, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für welches Datum?`,
        `Ausgezeichnet, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Welchen Tag bevorzugen Sie?`,
        `Sehr gut, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für wann?`,
        `Perfekt, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Für welchen Tag?`,
        `Großartig, ${variables.people} ${variables.people === 1 ? 'Person' : 'Personen'}. Wann möchten Sie kommen?`
      ],
      it: [
        `Perfetto, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quale data?`,
        `Eccellente, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Quale giorno preferisci?`,
        `Molto bene, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quando?`,
        `Perfetto, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Per quale giorno?`,
        `Fantastico, ${variables.people} ${variables.people === 1 ? 'persona' : 'persone'}. Quando vorresti venire?`
      ],
      fr: [
        `Parfait, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quelle date?`,
        `Excellent, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Quel jour préférez-vous?`,
        `Très bien, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quand?`,
        `Parfait, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Pour quel jour?`,
        `Génial, ${variables.people} ${variables.people === 1 ? 'personne' : 'personnes'}. Quand aimeriez-vous venir?`
      ],
      pt: [
        `Perfeito, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para que data?`,
        `Excelente, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Que dia você prefere?`,
        `Muito bem, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para quando?`,
        `Perfeito, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Para que dia?`,
        `Ótimo, ${variables.people} ${variables.people === 1 ? 'pessoa' : 'pessoas'}. Quando gostaria de vir?`
      ]
    },
    date: {
      es: [
        `El ${formatDateSpanish(variables.date)}. ¿A qué hora les gustaría venir?`,
        `Vale, el día ${formatDateSpanish(variables.date)}. ¿Qué hora les viene mejor?`,
        `Muy bien, el ${formatDateSpanish(variables.date)}. ¿A qué hora prefieren?`,
        `Genial, el día ${formatDateSpanish(variables.date)}. ¿A qué hora les viene bien?`,
        `De acuerdo, el ${formatDateSpanish(variables.date)}. ¿A qué hora?`,
        `¡Vale! El ${formatDateSpanish(variables.date)}. ¿Qué hora les gustaría?`,
        `Muy bien, el día ${formatDateSpanish(variables.date)}. ¿A qué hora pueden venir?`,
        `Entendido, el ${formatDateSpanish(variables.date)}. ¿A qué hora les viene bien?`,
        `Vale, el día ${formatDateSpanish(variables.date)}. ¿A qué hora les conviene?`,
        `Claro, el ${formatDateSpanish(variables.date)}. ¿Qué hora prefieren?`,
        `Muy bien, el día ${formatDateSpanish(variables.date)}. ¿A qué hora?`
      ],
      en: [
        `Perfect, ${formatDateEnglish(variables.date)}. What time?`,
        `Excellent, ${formatDateEnglish(variables.date)}. What time do you prefer?`,
        `Great, ${formatDateEnglish(variables.date)}. What time would you like to come?`,
        `Perfect, ${formatDateEnglish(variables.date)}. What time suits you?`,
        `Great, ${formatDateEnglish(variables.date)}. What time?`
      ],
      de: [
        `Perfekt, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit?`,
        `Ausgezeichnet, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit bevorzugen Sie?`,
        `Sehr gut, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit möchten Sie kommen?`,
        `Perfekt, ${formatDateGerman(variables.date)}. Welche Uhrzeit passt Ihnen?`,
        `Großartig, ${formatDateGerman(variables.date)}. Zu welcher Uhrzeit?`
      ],
      it: [
        `Perfetto, ${formatDateItalian(variables.date)}. A che ora?`,
        `Eccellente, ${formatDateItalian(variables.date)}. A che ora preferisci?`,
        `Molto bene, ${formatDateItalian(variables.date)}. A che ora vorresti venire?`,
        `Perfetto, ${formatDateItalian(variables.date)}. Che ora ti conviene?`,
        `Fantastico, ${formatDateItalian(variables.date)}. A che ora?`
      ],
      fr: [
        `Parfait, ${formatDateFrench(variables.date)}. À quelle heure?`,
        `Excellent, ${formatDateFrench(variables.date)}. À quelle heure préférez-vous?`,
        `Très bien, ${formatDateFrench(variables.date)}. À quelle heure aimeriez-vous venir?`,
        `Parfait, ${formatDateFrench(variables.date)}. Quelle heure vous convient?`,
        `Génial, ${formatDateFrench(variables.date)}. À quelle heure?`
      ],
      pt: [
        `Perfeito, ${formatDatePortuguese(variables.date)}. Que horas?`,
        `Excelente, ${formatDatePortuguese(variables.date)}. Que horas você prefere?`,
        `Muito bem, ${formatDatePortuguese(variables.date)}. Que horas gostaria de vir?`,
        `Perfeito, ${formatDatePortuguese(variables.date)}. Que horas te convém?`,
        `Ótimo, ${formatDatePortuguese(variables.date)}. Que horas?`
      ]
    },
    time: {
      es: [
        `A las ${variables.time}. ¿A nombre de quién será la reserva?`,
        `Vale, a las ${variables.time}. ¿Me dice su nombre?`,
        `Muy bien, a las ${variables.time}. ¿A nombre de quién la hacemos?`,
        `Genial, a las ${variables.time}. ¿Cómo se llama?`,
        `De acuerdo, a las ${variables.time}. ¿Me puede decir su nombre?`,
        `¡Vale! A las ${variables.time}. ¿A nombre de quién va la reserva?`,
        `Muy bien, a las ${variables.time}. ¿Cuál es su nombre?`,
        `Entendido, a las ${variables.time}. ¿A nombre de quién será?`,
        `Vale, a las ${variables.time}. ¿Me dice su nombre, por favor?`,
        `Claro, a las ${variables.time}. ¿Cómo se llama?`,
        `Muy bien, a las ${variables.time}. ¿A nombre de quién?`
      ],
      en: [
        `Perfect, at ${variables.time}. Your name?`,
        `Excellent, at ${variables.time}. What's your name?`,
        `Great, at ${variables.time}. Your name, please?`,
        `Perfect, at ${variables.time}. How do you tell me your name?`,
        `Great, at ${variables.time}. Your name?`
      ],
      de: [
        `Perfekt, um ${variables.time}. Ihr Name?`,
        `Ausgezeichnet, um ${variables.time}. Wie heißen Sie?`,
        `Sehr gut, um ${variables.time}. Ihr Name, bitte?`,
        `Perfekt, um ${variables.time}. Wie sagen Sie mir Ihren Namen?`,
        `Großartig, um ${variables.time}. Ihr Name?`
      ],
      it: [
        `Perfetto, alle ${variables.time}. Il tuo nome?`,
        `Eccellente, alle ${variables.time}. Come ti chiami?`,
        `Molto bene, alle ${variables.time}. Il tuo nome, per favore?`,
        `Perfetto, alle ${variables.time}. Come mi dici il tuo nome?`,
        `Fantastico, alle ${variables.time}. Il tuo nome?`
      ],
      fr: [
        `Parfait, à ${variables.time}. Votre nom?`,
        `Excellent, à ${variables.time}. Comment vous appelez-vous?`,
        `Très bien, à ${variables.time}. Votre nom, s'il vous plaît?`,
        `Parfait, à ${variables.time}. Comment me dites-vous votre nom?`,
        `Génial, à ${variables.time}. Votre nom?`
      ],
      pt: [
        `Perfeito, às ${variables.time}. Seu nome?`,
        `Excelente, às ${variables.time}. Como você se chama?`,
        `Muito bem, às ${variables.time}. Seu nome, por favor?`,
        `Perfeito, às ${variables.time}. Como me diz seu nome?`,
        `Ótimo, às ${variables.time}. Seu nome?`
      ]
    },
    name: {
      es: [
        `Perfecto, ${variables.name}.`,
        `Vale, ${variables.name}.`,
        `Muy bien, ${variables.name}.`,
        `Perfecto, ${variables.name}.`,
        `Genial, ${variables.name}.`,
        `¡Vale! ${variables.name}.`,
        `Muy bien, ${variables.name}.`,
        `¡Perfecto! ${variables.name}.`,
        `Vale, ${variables.name}.`,
        `Perfecto, ${variables.name}.`,
        `Muy bien, ${variables.name}.`
      ],
      en: [
        `Perfect, ${variables.name}.`,
        `Excellent, ${variables.name}.`,
        `Great, ${variables.name}.`,
        `Perfect, ${variables.name}.`,
        `Great, ${variables.name}.`
      ],
      de: [
        `Perfekt, ${variables.name}.`,
        `Ausgezeichnet, ${variables.name}.`,
        `Sehr gut, ${variables.name}.`,
        `Perfekt, ${variables.name}.`,
        `Großartig, ${variables.name}.`
      ],
      it: [
        `Perfetto, ${variables.name}.`,
        `Eccellente, ${variables.name}.`,
        `Molto bene, ${variables.name}.`,
        `Perfetto, ${variables.name}.`,
        `Fantastico, ${variables.name}.`
      ],
      fr: [
        `Parfait, ${variables.name}.`,
        `Excellent, ${variables.name}.`,
        `Très bien, ${variables.name}.`,
        `Parfait, ${variables.name}.`,
        `Génial, ${variables.name}.`
      ],
      pt: [
        `Perfeito, ${variables.name}.`,
        `Excelente, ${variables.name}.`,
        `Muito bem, ${variables.name}.`,
        `Perfeito, ${variables.name}.`,
        `Ótimo, ${variables.name}.`
      ]
    },
    ask_phone: {
      es: [
        '¿Qué número de teléfono prefiere?',
        '¿Cuál es su número de teléfono?',
        '¿Podría darme su número de teléfono?',
        '¿Me dice su número de teléfono?',
        '¿Cuál es el número donde podemos contactarle?'
      ],
      en: [
        'What phone number do you prefer?',
        'What is your phone number?',
        'Could you give me your phone number?',
        'Can you tell me your phone number?',
        'What is the number where we can contact you?'
      ],
      de: [
        'Welche Telefonnummer bevorzugen Sie?',
        'Wie ist Ihre Telefonnummer?',
        'Könnten Sie mir Ihre Telefonnummer geben?',
        'Können Sie mir Ihre Telefonnummer sagen?',
        'Wie ist die Nummer, unter der wir Sie erreichen können?'
      ],
      it: [
        'Che numero di telefono preferisci?',
        'Qual è il tuo numero di telefono?',
        'Potresti darmi il tuo numero di telefono?',
        'Puoi dirmi il tuo numero di telefono?',
        'Qual è il numero dove possiamo contattarti?'
      ],
      fr: [
        'Quel numéro de téléphone préférez-vous?',
        'Quel est votre numéro de téléphone?',
        'Pourriez-vous me donner votre numéro de téléphone?',
        'Pouvez-vous me dire votre numéro de téléphone?',
        'Quel est le numéro où nous pouvons vous contacter?'
      ],
      pt: [
        'Que número de telefone você prefere?',
        'Qual é o seu número de telefone?',
        'Poderia me dar o seu número de telefone?',
        'Pode me dizer o seu número de telefone?',
        'Qual é o número onde podemos contatá-lo?'
      ]
    },
    phone_choice: {
      es: [
        '¿Desea usar este número o prefiere dar otro?',
        '¿Usa este número o quiere uno diferente?',
        '¿Este teléfono está bien o prefiere otro?',
        '¿Le sirve este número o necesita otro?',
        '¿Usa este número o prefiere indicar otro?'
      ],
      en: [
        'Do you want to use this number or do you prefer to give another one?',
        'Do you use this number or do you want a different one?',
        'Is this phone okay or do you prefer another one?',
        'Does this number work for you or do you need another one?',
        'Do you use this number or do you prefer to provide another one?'
      ],
      de: [
        'Möchten Sie diese Nummer verwenden oder bevorzugen Sie eine andere?',
        'Verwenden Sie diese Nummer oder möchten Sie eine andere?',
        'Ist dieses Telefon in Ordnung oder bevorzugen Sie ein anderes?',
        'Funktioniert diese Nummer für Sie oder benötigen Sie eine andere?',
        'Verwenden Sie diese Nummer oder bevorzugen Sie eine andere anzugeben?'
      ],
      it: [
        'Vuoi usare questo numero o preferisci darne un altro?',
        'Usi questo numero o vuoi uno diverso?',
        'Questo telefono va bene o preferisci un altro?',
        'Ti serve questo numero o hai bisogno di un altro?',
        'Usi questo numero o preferisci indicarne un altro?'
      ],
      fr: [
        'Souhaitez-vous utiliser ce numéro ou préférez-vous en donner un autre?',
        'Utilisez-vous ce numéro ou voulez-vous un différent?',
        'Ce téléphone convient-il ou préférez-vous un autre?',
        'Ce numéro vous convient-il ou avez-vous besoin d\'un autre?',
        'Utilisez-vous ce numéro ou préférez-vous en indiquer un autre?'
      ],
      pt: [
        'Quer usar este número ou prefere dar outro?',
        'Usa este número ou quer um diferente?',
        'Este telefone está bem ou prefere outro?',
        'Este número te serve ou precisa de outro?',
        'Usa este número ou prefere indicar outro?'
      ]
    },
    confirm: {
      es: [
        '¡Perfecto! Su reserva está confirmada. Les esperamos con muchas ganas. ¡Que tengan un día estupendo!',
        '¡Vale! Reserva confirmada. Estaremos encantados de recibirles. ¡Que disfruten el día!',
        '¡Muy bien! Todo listo y confirmado. Les esperamos con ilusión. ¡Hasta pronto!',
        '¡Genial! Reserva confirmada. Nos vemos muy pronto. ¡Que pasen un día maravilloso!',
        '¡Perfecto! Todo confirmado. Les esperamos con los brazos abiertos. ¡Que disfruten mucho!',
        '¡Vale! Su reserva está confirmada. Estamos deseando recibirles. ¡Que tengan un día fantástico!',
        '¡Perfecto! Todo listo. Les esperamos con mucha ilusión. ¡Que pasen un día estupendo!',
        '¡Genial! Su reserva está confirmada. Les esperamos con muchísimas ganas. ¡Que tengan un día maravilloso!',
        '¡Vale! Reserva confirmada. Estaremos encantados de recibirles. ¡Hasta muy pronto!',
        '¡Perfecto! Todo está listo y confirmado. Les esperamos con ilusión. ¡Que disfruten mucho el día!',
        '¡Muy bien! Reserva confirmada. Estamos deseando verles. ¡Que pasen un día estupendo!'
      ],
      en: [
        'Perfect! Your reservation is confirmed. We look forward to seeing you. Have a great day!',
        'Excellent! Reservation confirmed. We look forward to seeing you. Have a great day!',
        'Great! Everything is ready. We look forward to seeing you. See you soon!',
        'Great! Reservation confirmed. See you soon. Have a great day!',
        'Perfect! Everything confirmed. We look forward to seeing you. Enjoy!'
      ],
      de: [
        'Perfekt! Ihre Reservierung ist bestätigt. Wir freuen uns auf Sie. Schönen Tag!',
        'Ausgezeichnet! Reservierung bestätigt. Wir freuen uns auf Sie. Schönen Tag!',
        'Sehr gut! Alles bereit. Wir freuen uns auf Sie. Bis bald!',
        'Großartig! Reservierung bestätigt. Bis bald. Schönen Tag!',
        'Perfekt! Alles bestätigt. Wir freuen uns auf Sie. Viel Spaß!'
      ],
      it: [
        'Perfetto! La tua prenotazione è confermata. Ti aspettiamo. Buona giornata!',
        'Eccellente! Prenotazione confermata. Ti aspettiamo. Buona giornata!',
        'Molto bene! Tutto pronto. Ti aspettiamo. A presto!',
        'Fantastico! Prenotazione confermata. A presto. Buona giornata!',
        'Perfetto! Tutto confermato. Ti aspettiamo. Divertiti!'
      ],
      fr: [
        'Parfait! Votre réservation est confirmée. Nous vous attendons. Bonne journée!',
        'Excellent! Réservation confirmée. Nous vous attendons. Bonne journée!',
        'Très bien! Tout est prêt. Nous vous attendons. À bientôt!',
        'Génial! Réservation confirmée. À bientôt. Bonne journée!',
        'Parfait! Tout confirmé. Nous vous attendons. Amusez-vous bien!'
      ],
      pt: [
        'Perfeito! Sua reserva está confirmada. Esperamos por você. Tenha um ótimo dia!',
        'Excelente! Reserva confirmada. Esperamos por você. Tenha um ótimo dia!',
        'Muito bem! Tudo pronto. Esperamos por você. Até logo!',
        'Ótimo! Reserva confirmada. Até logo. Tenha um ótimo dia!',
        'Perfeito! Tudo confirmado. Esperamos por você. Divirta-se!'
      ]
    },
    restart: {
      es: [
        'De acuerdo. Empezamos de nuevo. ¿Para cuántas personas?',
        'Perfecto. Comenzamos de nuevo. ¿Para cuántas personas?',
        'Muy bien. Volvemos a empezar. ¿Para cuántas personas?',
        'Entendido. Empezamos otra vez. ¿Para cuántas personas?',
        'Perfecto. Reiniciamos. ¿Para cuántas personas?'
      ],
      en: [
        'Okay. Let\'s start over. For how many people?',
        'Perfect. Let\'s start again. For how many people?',
        'Great. Let\'s start over. For how many people?',
        'Understood. Let\'s start again. For how many people?',
        'Perfect. Let\'s restart. For how many people?'
      ],
      de: [
        'In Ordnung. Wir fangen von vorne an. Für wie viele Personen?',
        'Perfekt. Wir beginnen von vorne. Für wie viele Personen?',
        'Sehr gut. Wir fangen nochmal an. Für wie viele Personen?',
        'Verstanden. Wir beginnen nochmal. Für wie viele Personen?',
        'Perfekt. Wir starten neu. Für wie viele Personen?'
      ],
      it: [
        'D\'accordo. Ricominciamo. Per quante persone?',
        'Perfetto. Ricominciamo. Per quante persone?',
        'Molto bene. Ricominciamo da capo. Per quante persone?',
        'Capito. Ricominciamo. Per quante persone?',
        'Perfetto. Riavvia. Per quante persone?'
      ],
      fr: [
        'D\'accord. Recommençons. Pour combien de personnes?',
        'Parfait. Recommençons. Pour combien de personnes?',
        'Très bien. Recommençons. Pour combien de personnes?',
        'Compris. Recommençons. Pour combien de personnes?',
        'Parfait. Redémarrons. Pour combien de personnes?'
      ],
      pt: [
        'De acordo. Começamos de novo. Para quantas pessoas?',
        'Perfeito. Começamos novamente. Para quantas pessoas?',
        'Muito bem. Voltamos a começar. Para quantas pessoas?',
        'Entendido. Começamos outra vez. Para quantas pessoas?',
        'Perfeito. Reiniciamos. Para quantas pessoas?'
      ]
    },
    clarify_confirm: {
      es: [
        '¿Le parece bien así? Puede decir sí para confirmar, o si quiere cambiar algo, dígame qué.',
        '¿Está todo bien? Si está de acuerdo, diga sí. Si quiere cambiar algo, dígame qué.',
        '¿Le viene bien? Puede confirmar diciendo sí, o si prefiere cambiar algo, dígame qué.',
        '¿Es correcto todo? Si está de acuerdo, diga sí. Si quiere modificar algo, dígame qué cambiar.',
        '¿Le parece bien? Puede decir sí para confirmar, o si quiere cambiar algo, dígame qué.',
        'Perfecto, ¿está todo bien así? Si está de acuerdo, dígame sí. Si quiere cambiar algo, dígame qué.',
        'Muy bien, ¿le parece correcto? Puede confirmar con un sí, o si quiere modificar algo, dígame qué.',
        'Vale, ¿está todo bien? Si está de acuerdo, diga sí. Si quiere cambiar algo, dígame qué modificar.',
        'Perfecto, ¿le viene bien así? Puede decir sí para confirmar, o si prefiere cambiar algo, dígame qué.'
      ],
      en: [
        'Is it correct? You can say yes, no, or what you want to change.',
        'Is it okay? You can confirm, deny, or say what to modify.',
        'Does it look good? You can say yes, no, or what you want to change.',
        'Is it correct? You can accept, reject, or indicate what to change.',
        'Do you agree? You can confirm, correct, or say what to change.'
      ],
      de: [
        'Ist es richtig? Sie können ja, nein sagen oder was Sie ändern möchten.',
        'Ist es in Ordnung? Sie können bestätigen, verneinen oder sagen was zu ändern.',
        'Sieht es gut aus? Sie können ja, nein sagen oder was Sie ändern möchten.',
        'Ist es richtig? Sie können akzeptieren, ablehnen oder angeben was zu ändern.',
        'Sind Sie einverstanden? Sie können bestätigen, korrigieren oder sagen was zu ändern.'
      ],
      it: [
        'È corretto? Puoi dire sì, no, o cosa vuoi cambiare.',
        'Va bene? Puoi confermare, negare, o dire cosa modificare.',
        'Ti sembra bene? Puoi dire sì, no, o cosa vuoi cambiare.',
        'È corretto? Puoi accettare, rifiutare, o indicare cosa cambiare.',
        'Sei d\'accordo? Puoi confermare, correggere, o dire cosa cambiare.'
      ],
      fr: [
        'Est-ce correct? Vous pouvez dire oui, non, ou ce que vous voulez changer.',
        'Est-ce que ça va? Vous pouvez confirmer, nier, ou dire ce qu\'il faut modifier.',
        'Ça vous semble bien? Vous pouvez dire oui, non, ou ce que vous voulez changer.',
        'Est-ce correct? Vous pouvez accepter, rejeter, ou indiquer ce qu\'il faut changer.',
        'Êtes-vous d\'accord? Vous pouvez confirmer, corriger, ou dire ce qu\'il faut changer.'
      ],
      pt: [
        'Está correto? Você pode dizer sim, não, ou o que quer mudar.',
        'Está bem? Você pode confirmar, negar, ou dizer o que modificar.',
        'Parece bem? Você pode dizer sim, não, ou o que quer mudar.',
        'Está correto? Você pode aceitar, rejeitar, ou indicar o que mudar.',
        'Você concorda? Você pode confirmar, corrigir, ou dizer o que mudar.'
      ]
    },
    cancellation_confirm: {
      es: [
        'Entiendo que quiere cancelar la reserva. ¿Está seguro de que desea cancelar?',
        'He entendido que no quiere continuar con la reserva. ¿Confirma que desea cancelar?',
        'Perfecto, entiendo que quiere cancelar. ¿Está completamente seguro?',
        'De acuerdo, cancelaremos la reserva. ¿Está seguro de su decisión?',
        'Entendido, no quiere hacer la reserva. ¿Confirma que desea cancelar?'
      ],
      en: [
        'I understand you want to cancel the reservation. Are you sure you want to cancel?',
        'I\'ve understood that you don\'t want to continue with the reservation. Do you confirm you want to cancel?',
        'Perfect, I understand you want to cancel. Are you completely sure?',
        'All right, we\'ll cancel the reservation. Are you sure about your decision?',
        'Understood, you don\'t want to make the reservation. Do you confirm you want to cancel?'
      ],
      de: [
        'Ich verstehe, dass Sie die Reservierung stornieren möchten. Sind Sie sicher, dass Sie stornieren möchten?',
        'Ich habe verstanden, dass Sie nicht mit der Reservierung fortfahren möchten. Bestätigen Sie, dass Sie stornieren möchten?',
        'Perfekt, ich verstehe, dass Sie stornieren möchten. Sind Sie völlig sicher?',
        'In Ordnung, wir werden die Reservierung stornieren. Sind Sie sich Ihrer Entscheidung sicher?',
        'Verstanden, Sie möchten keine Reservierung vornehmen. Bestätigen Sie, dass Sie stornieren möchten?'
      ],
      it: [
        'Capisco che vuoi cancellare la prenotazione. Sei sicuro di voler cancellare?',
        'Ho capito che non vuoi continuare con la prenotazione. Confermi di voler cancellare?',
        'Perfetto, capisco che vuoi cancellare. Sei completamente sicuro?',
        'D\'accordo, cancelleremo la prenotazione. Sei sicuro della tua decisione?',
        'Capito, non vuoi fare la prenotazione. Confermi di voler cancellare?'
      ],
      fr: [
        'Je comprends que vous voulez annuler la réservation. Êtes-vous sûr de vouloir annuler?',
        'J\'ai compris que vous ne voulez pas continuer avec la réservation. Confirmez-vous que vous voulez annuler?',
        'Parfait, je comprends que vous voulez annuler. Êtes-vous complètement sûr?',
        'D\'accord, nous annulerons la réservation. Êtes-vous sûr de votre décision?',
        'Compris, vous ne voulez pas faire de réservation. Confirmez-vous que vous voulez annuler?'
      ],
      pt: [
        'Entendo que você quer cancelar a reserva. Tem certeza de que quer cancelar?',
        'Entendi que você não quer continuar com a reserva. Confirma que quer cancelar?',
        'Perfeito, entendo que você quer cancelar. Tem certeza absoluta?',
        'Tudo bem, cancelaremos a reserva. Tem certeza da sua decisão?',
        'Entendido, você não quer fazer a reserva. Confirma que quer cancelar?'
      ]
    },
    cancellation_goodbye: {
      es: [
        'Perfecto, he cancelado su reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!',
        'Entendido, la reserva ha sido cancelada. Gracias por llamar y espero haberle sido de ayuda. Le esperamos en otra ocasión. ¡Hasta pronto!',
        'De acuerdo, he cancelado la reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!',
        'Perfecto, la reserva está cancelada. Gracias por su tiempo y espero haberle sido de ayuda. Le esperamos en otra ocasión. ¡Hasta pronto!',
        'Entendido, he cancelado la reserva. Espero haberle sido de ayuda. Le esperamos otro día en nuestro restaurante. ¡Que tenga un buen día!'
      ],
      en: [
        'Perfect, I\'ve cancelled your reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!',
        'Understood, the reservation has been cancelled. Thank you for calling and I hope I was able to help you. We look forward to seeing you another time. See you soon!',
        'All right, I\'ve cancelled the reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!',
        'Perfect, the reservation is cancelled. Thank you for your time and I hope I was able to help you. We look forward to seeing you another time. See you soon!',
        'Understood, I\'ve cancelled the reservation. I hope I was able to help you. We look forward to seeing you another day at our restaurant. Have a great day!'
      ],
      de: [
        'Perfekt, ich habe Ihre Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag zu sehen. Haben Sie einen schönen Tag!',
        'Verstanden, die Reservierung wurde storniert. Vielen Dank für Ihren Anruf. Wir freuen uns darauf, Sie bei einer anderen Gelegenheit zu sehen. Bis bald!',
        'In Ordnung, ich habe die Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag zu sehen. Haben Sie einen schönen Tag!',
        'Perfekt, die Reservierung ist storniert. Vielen Dank für Ihre Zeit. Wir freuen uns darauf, Sie bei einer anderen Gelegenheit zu sehen. Bis bald!',
        'Verstanden, ich habe die Reservierung storniert. Ich hoffe, ich konnte Ihnen helfen. Wir freuen uns darauf, Sie an einem anderen Tag zu sehen. Haben Sie einen schönen Tag!'
      ],
      it: [
        'Perfetto, ho cancellato la tua prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!',
        'Capito, la prenotazione è stata cancellata. Grazie per aver chiamato e spero di averti aiutato. Non vediamo l\'ora di vederti un\'altra volta. A presto!',
        'D\'accordo, ho cancellato la prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!',
        'Perfetto, la prenotazione è cancellata. Grazie per il tuo tempo e spero di averti aiutato. Non vediamo l\'ora di vederti un\'altra volta. A presto!',
        'Capito, ho cancellato la prenotazione. Spero di averti aiutato. Non vediamo l\'ora di vederti un altro giorno nel nostro ristorante. Buona giornata!'
      ],
      fr: [
        'Parfait, j\'ai annulé votre réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!',
        'Compris, la réservation a été annulée. Merci d\'avoir appelé et j\'espère avoir pu vous aider. Nous avons hâte de vous voir une autre fois. À bientôt!',
        'D\'accord, j\'ai annulé la réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!',
        'Parfait, la réservation est annulée. Merci pour votre temps et j\'espère avoir pu vous aider. Nous avons hâte de vous voir une autre fois. À bientôt!',
        'Compris, j\'ai annulé la réservation. J\'espère avoir pu vous aider. Nous avons hâte de vous voir un autre jour dans notre restaurant. Passez une bonne journée!'
      ],
      pt: [
        'Perfeito, cancelei sua reserva. Espero ter conseguido ajudá-lo. Esperamos vê-lo outro dia em nosso restaurante. Tenha um ótimo dia!',
        'Entendido, a reserva foi cancelada. Obrigado por ligar e espero ter conseguido ajudá-lo. Esperamos vê-lo outra vez. Até logo!',
        'Tudo bem, cancelei a reserva. Espero ter conseguido ajudá-lo. Esperamos vê-lo outro dia em nosso restaurante. Tenha um ótimo dia!',
        'Perfeito, a reserva está cancelada. Obrigado pelo seu tempo e espero ter conseguido ajudá-lo. Esperamos vê-lo outra vez. Até logo!',
      ]
    },
    complete: {
      es: [
        '¡Perfecto! Su reserva ha sido confirmada exitosamente. Gracias por elegir nuestro restaurante. ¡Esperamos darle la bienvenida pronto!',
        '¡Excelente! Su reserva está lista. Gracias por confiar en nosotros. ¡Esperamos verle pronto!',
        '¡Fantástico! Su reserva ha sido procesada correctamente. Gracias por elegir nuestro restaurante. ¡Hasta pronto!',
        '¡Perfecto! Su reserva está confirmada. Gracias por llamar y esperamos darle la bienvenida. ¡Que tenga un buen día!',
        '¡Excelente! Su reserva ha sido completada exitosamente. Gracias por elegir nuestro restaurante. ¡Esperamos verle pronto!'
      ],
      en: [
        'Perfect! Your reservation has been successfully confirmed. Thank you for choosing our restaurant. We look forward to welcoming you soon!',
        'Excellent! Your reservation is ready. Thank you for trusting us. We look forward to seeing you soon!',
        'Fantastic! Your reservation has been processed correctly. Thank you for choosing our restaurant. See you soon!',
        'Perfect! Your reservation is confirmed. Thank you for calling and we look forward to welcoming you. Have a great day!',
        'Excellent! Your reservation has been completed successfully. Thank you for choosing our restaurant. We look forward to seeing you soon!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich bestätigt. Vielen Dank, dass Sie unser Restaurant gewählt haben. Wir freuen uns darauf, Sie bald willkommen zu heißen!',
        'Ausgezeichnet! Ihre Reservierung ist bereit. Vielen Dank für Ihr Vertrauen. Wir freuen uns darauf, Sie bald zu sehen!',
        'Fantastisch! Ihre Reservierung wurde korrekt bearbeitet. Vielen Dank, dass Sie unser Restaurant gewählt haben. Bis bald!',
        'Perfekt! Ihre Reservierung ist bestätigt. Vielen Dank für Ihren Anruf und wir freuen uns darauf, Sie willkommen zu heißen. Haben Sie einen schönen Tag!',
        'Ausgezeichnet! Ihre Reservierung wurde erfolgreich abgeschlossen. Vielen Dank, dass Sie unser Restaurant gewählt haben. Wir freuen uns darauf, Sie bald zu sehen!'
      ],
      it: [
        'Perfetto! La tua prenotazione è stata confermata con successo. Grazie per aver scelto il nostro ristorante. Non vediamo l\'ora di darti il benvenuto presto!',
        'Eccellente! La tua prenotazione è pronta. Grazie per averci fidato. Non vediamo l\'ora di vederti presto!',
        'Fantastico! La tua prenotazione è stata elaborata correttamente. Grazie per aver scelto il nostro ristorante. A presto!',
        'Perfetto! La tua prenotazione è confermata. Grazie per aver chiamato e non vediamo l\'ora di darti il benvenuto. Buona giornata!',
        'Eccellente! La tua prenotazione è stata completata con successo. Grazie per aver scelto il nostro ristorante. Non vediamo l\'ora di vederti presto!'
      ],
      fr: [
        'Parfait! Votre réservation a été confirmée avec succès. Merci d\'avoir choisi notre restaurant. Nous avons hâte de vous accueillir bientôt!',
        'Excellent! Votre réservation est prête. Merci de nous faire confiance. Nous avons hâte de vous voir bientôt!',
        'Fantastique! Votre réservation a été traitée correctement. Merci d\'avoir choisi notre restaurant. À bientôt!',
        'Parfait! Votre réservation est confirmée. Merci d\'avoir appelé et nous avons hâte de vous accueillir. Passez une bonne journée!',
        'Excellent! Votre réservation a été complétée avec succès. Merci d\'avoir choisi notre restaurant. Nous avons hâte de vous voir bientôt!'
      ],
      pt: [
        'Perfeito! Sua reserva foi confirmada com sucesso. Obrigado por escolher nosso restaurante. Esperamos recebê-lo em breve!',
        'Excelente! Sua reserva está pronta. Obrigado por confiar em nós. Esperamos vê-lo em breve!',
        'Fantástico! Sua reserva foi processada corretamente. Obrigado por escolher nosso restaurante. Até logo!',
        'Perfeito! Sua reserva está confirmada. Obrigado por ligar e esperamos recebê-lo. Tenha um ótimo dia!',
        'Excelente! Sua reserva foi concluída com sucesso. Obrigado por escolher nosso restaurante. Esperamos vê-lo em breve!'
      ]
    },
    cancellation_continue: {
      es: [
        'Perfecto, continuemos con su reserva entonces. ¿Para cuántas personas?',
        'Excelente, sigamos con la reserva. ¿Cuántas personas serán?',
        'Muy bien, continuemos. ¿Para cuántos comensales?',
        'Perfecto, sigamos adelante. ¿Cuántas personas necesitan mesa?',
        'Genial, continuemos con la reserva. ¿Para cuántas personas?'
      ],
      en: [
        'Perfect, let\'s continue with your reservation then. For how many people?',
        'Excellent, let\'s continue with the reservation. How many people will it be?',
        'Great, let\'s continue. For how many diners?',
        'Perfect, let\'s go ahead. How many people need a table?',
        'Great, let\'s continue with the reservation. For how many people?'
      ],
      de: [
        'Perfekt, lassen Sie uns dann mit Ihrer Reservierung fortfahren. Für wie viele Personen?',
        'Ausgezeichnet, lassen Sie uns mit der Reservierung fortfahren. Wie viele Personen werden es sein?',
        'Sehr gut, lassen Sie uns fortfahren. Für wie viele Gäste?',
        'Perfekt, lassen Sie uns weitermachen. Wie viele Personen benötigen einen Tisch?',
        'Großartig, lassen Sie uns mit der Reservierung fortfahren. Für wie viele Personen?'
      ],
      it: [
        'Perfetto, continuiamo con la tua prenotazione allora. Per quante persone?',
        'Eccellente, continuiamo con la prenotazione. Quante persone saranno?',
        'Molto bene, continuiamo. Per quanti commensali?',
        'Perfetto, andiamo avanti. Quante persone hanno bisogno di un tavolo?',
        'Fantastico, continuiamo con la prenotazione. Per quante persone?'
      ],
      fr: [
        'Parfait, continuons avec votre réservation alors. Pour combien de personnes?',
        'Excellent, continuons avec la réservation. Combien de personnes seront-ce?',
        'Très bien, continuons. Pour combien de convives?',
        'Parfait, continuons. Combien de personnes ont besoin d\'une table?',
        'Génial, continuons avec la réservation. Pour combien de personnes?'
      ],
      pt: [
        'Perfeito, vamos continuar com sua reserva então. Para quantas pessoas?',
        'Excelente, vamos continuar com a reserva. Quantas pessoas serão?',
        'Muito bem, vamos continuar. Para quantos comensais?',
        'Perfeito, vamos em frente. Quantas pessoas precisam de uma mesa?',
        'Ótimo, vamos continuar com a reserva. Para quantas pessoas?'
      ]
    },
    cancellation_unclear: {
      es: [
        'No he entendido bien su respuesta. ¿Quiere cancelar la reserva o continuar?',
        'Disculpe, no entendí claramente. ¿Desea cancelar o seguir con la reserva?',
        'No estoy seguro de lo que quiere hacer. ¿Cancela la reserva o continúa?',
        'Perdón, no entendí. ¿Quiere cancelar o seguir adelante?',
        'No he captado bien su intención. ¿Cancela o continúa con la reserva?'
      ],
      en: [
        'I didn\'t understand your response well. Do you want to cancel the reservation or continue?',
        'Sorry, I didn\'t understand clearly. Do you want to cancel or continue with the reservation?',
        'I\'m not sure what you want to do. Do you cancel the reservation or continue?',
        'Sorry, I didn\'t understand. Do you want to cancel or go ahead?',
        'I didn\'t catch your intention well. Do you cancel or continue with the reservation?'
      ],
      de: [
        'Ich habe Ihre Antwort nicht gut verstanden. Möchten Sie die Reservierung stornieren oder fortfahren?',
        'Entschuldigung, ich habe nicht klar verstanden. Möchten Sie stornieren oder mit der Reservierung fortfahren?',
        'Ich bin mir nicht sicher, was Sie tun möchten. Stornieren Sie die Reservierung oder fahren Sie fort?',
        'Entschuldigung, ich habe nicht verstanden. Möchten Sie stornieren oder weitermachen?',
        'Ich habe Ihre Absicht nicht gut erfasst. Stornieren Sie oder fahren Sie mit der Reservierung fort?'
      ],
      it: [
        'Non ho capito bene la tua risposta. Vuoi cancellare la prenotazione o continuare?',
        'Scusa, non ho capito chiaramente. Vuoi cancellare o continuare con la prenotazione?',
        'Non sono sicuro di cosa vuoi fare. Cancelli la prenotazione o continui?',
        'Scusa, non ho capito. Vuoi cancellare o andare avanti?',
        'Non ho colto bene la tua intenzione. Cancelli o continui con la prenotazione?'
      ],
      fr: [
        'Je n\'ai pas bien compris votre réponse. Voulez-vous annuler la réservation ou continuer?',
        'Désolé, je n\'ai pas compris clairement. Voulez-vous annuler ou continuer avec la réservation?',
        'Je ne suis pas sûr de ce que vous voulez faire. Annulez-vous la réservation ou continuez-vous?',
        'Désolé, je n\'ai pas compris. Voulez-vous annuler ou continuer?',
        'Je n\'ai pas bien saisi votre intention. Annulez-vous ou continuez-vous avec la réservation?'
      ],
      pt: [
        'Não entendi bem sua resposta. Quer cancelar a reserva ou continuar?',
        'Desculpe, não entendi claramente. Quer cancelar ou continuar com a reserva?',
        'Não tenho certeza do que você quer fazer. Cancela a reserva ou continua?',
        'Desculpe, não entendi. Quer cancelar ou seguir em frente?',
        'Não captei bem sua intenção. Cancela ou continua com a reserva?'
      ]
    },
    ask_intention: {
      es: [
        '¿En qué puedo ayudarle? ¿Quiere hacer una reserva, modificar una existente, cancelar o hacer un pedido a domicilio?',
        '¿Qué necesita? ¿Una reserva, modificar una reserva, cancelar o un pedido?',
        '¿Cómo puedo ayudarle? ¿Reserva, modificar, cancelar o pedido a domicilio?',
        '¿Qué desea hacer? ¿Reservar mesa, modificar reserva, cancelar o pedir a domicilio?',
        'Dígame, ¿qué necesita? ¿Reserva, modificar, cancelar o pedido?'
      ],
      en: [
        'How can I help you? Would you like to make a reservation, modify an existing one, cancel, or place a delivery order?',
        'What do you need? A reservation, modify a reservation, cancel, or an order?',
        'How can I assist you? Reservation, modify, cancel, or delivery order?',
        'What would you like to do? Book a table, modify a reservation, cancel, or order delivery?',
        'Tell me, what do you need? Reservation, modify, cancel, or order?'
      ]
    },
    default: {
      es: [
        '¿En qué puedo ayudarle? ¿Le gustaría hacer una reserva?',
        '¿Cómo puedo asistirle? ¿Quiere hacer una reserva?',
        '¿En qué le puedo ayudar? ¿Desea reservar una mesa?',
        '¿Qué necesita? ¿Le gustaría hacer una reserva?',
        '¿Cómo puedo ayudarle? ¿Quiere hacer una reserva?'
      ],
      en: [
        'How can I help you? Would you like to make a reservation?',
        'How can I assist you? Do you want to make a reservation?',
        'How can I help you? Would you like to book a table?',
        'What do you need? Would you like to make a reservation?',
        'How can I help you? Do you want to make a reservation?'
      ],
      de: [
        'Wie kann ich Ihnen helfen? Möchten Sie eine Reservierung vornehmen?',
        'Wie kann ich Ihnen assistieren? Möchten Sie eine Reservierung?',
        'Wie kann ich Ihnen helfen? Möchten Sie einen Tisch reservieren?',
        'Was benötigen Sie? Möchten Sie eine Reservierung vornehmen?',
        'Wie kann ich Ihnen helfen? Möchten Sie eine Reservierung?'
      ],
      it: [
        'Come posso aiutarti? Vorresti fare una prenotazione?',
        'Come posso assisterti? Vuoi fare una prenotazione?',
        'Come posso aiutarti? Vorresti prenotare un tavolo?',
        'Di cosa hai bisogno? Vorresti fare una prenotazione?',
        'Come posso aiutarti? Vuoi fare una prenotazione?'
      ],
      fr: [
        'Comment puis-je vous aider? Souhaitez-vous faire une réservation?',
        'Comment puis-je vous assister? Voulez-vous faire une réservation?',
        'Comment puis-je vous aider? Souhaitez-vous réserver une table?',
        'De quoi avez-vous besoin? Souhaitez-vous faire une réservation?',
        'Comment puis-je vous aider? Voulez-vous faire une réservation?'
      ],
      pt: [
        'Como posso ajudá-lo? Gostaria de fazer uma reserva?',
        'Como posso assisti-lo? Quer fazer uma reserva?',
        'Como posso ajudá-lo? Gostaria de reservar uma mesa?',
        'O que você precisa? Gostaria de fazer uma reserva?',
        'Como posso ajudá-lo? Quer fazer uma reserva?'
      ]
    },
    // ===== MENSAJES PARA MODIFICACIÓN DE RESERVAS =====
    modify_ask_phone_choice: {
      es: [
        'Vale, para modificar su reserva necesito verificar su identidad. ¿Quiere usar el mismo número desde el que está llamando o prefiere usar otro?',
        'Perfecto, para buscar su reserva necesito su número. ¿Desea usar este mismo número o tiene otro?',
        'Muy bien, para localizar su reserva necesito su número. ¿Usa el mismo número de esta llamada o prefiere darme otro?',
        'Vale, para modificar necesito verificar su identidad. ¿Quiere usar este número o prefiere usar otro?',
        'Perfecto, para proceder con la modificación necesito su número. ¿Usa el mismo número desde el que llama o tiene otro?'
      ],
      en: [
        'Perfect, to modify your reservation I need to verify your identity. Do you want to use the same phone number you are calling from or would you prefer to use another number?',
        'Understood, to find your reservation I need your phone number. Do you want to use this same number or do you have another one?',
        'Very well, to locate your reservation I need your number. Do you use the same number from this call or would you prefer to give me another one?',
        'Perfect, to modify I need to verify your identity. Do you want to use this number or would you prefer to use another one?',
        'Understood, to proceed with the modification I need your number. Do you use the same number you are calling from or do you have another one?'
      ],
      pt: [
        'Perfeito, para modificar sua reserva preciso verificar sua identidade. Quer usar o mesmo número de telefone de onde está ligando ou prefere usar outro número?',
        'Entendido, para buscar sua reserva preciso do seu número de telefone. Quer usar este mesmo número ou tem outro?',
        'Muito bem, para localizar sua reserva preciso do seu número. Usa o mesmo número desta chamada ou prefere me dar outro?',
        'Perfeito, para modificar preciso verificar sua identidade. Quer usar este número ou prefere usar outro?',
        'Entendido, para prosseguir com a modificação preciso do seu número. Usa o mesmo número de onde está ligando ou tem outro?'
      ]
    },
    modify_ask_phone: {
      es: [
        'Vale, para modificar su reserva necesito su número de teléfono. ¿Cuál es su número?',
        'Perfecto, para buscar su reserva necesito su número. ¿Podría darme su número?',
        'Muy bien, para localizar su reserva necesito su número. ¿Cuál es?',
        'Vale, para modificar necesito verificar su identidad. ¿Cuál es su número?',
        'Perfecto, para proceder con la modificación necesito su número. ¿Podría darmelo?'
      ],
      en: [
        'Perfect, to modify your reservation I need your phone number. What is your number?',
        'Understood, to find your reservation I need your phone number. Could you give me your number?',
        'Very well, to locate your reservation I need your phone number. What is it?',
        'Perfect, to modify I need to verify your identity. What is your phone number?',
        'Understood, to proceed with the modification I need your phone number. Could you give it to me?'
      ],
      pt: [
        'Perfeito, para modificar sua reserva preciso do seu número de telefone. Qual é o seu número?',
        'Entendido, para buscar sua reserva preciso do seu número de telefone. Poderia me dar seu número?',
        'Muito bem, para localizar sua reserva preciso do seu número de telefone. Qual é?',
        'Perfeito, para modificar preciso verificar sua identidade. Qual é o seu número de telefone?',
        'Entendido, para prosseguir com a modificação preciso do seu número de telefone. Poderia me dar?'
      ]
    },
    modify_show_multiple: {
      es: [
        'Muy bien, aquí están sus reservas:',
        'Vale, he encontrado sus reservas:',
        'Perfecto, estas son sus reservas:',
        'Aquí tiene sus reservas:',
        'He localizado sus reservas:'
      ],
      en: [
        'Very well, here are your reservations:',
        'Perfect, I found your reservations:',
        'Excellent, these are your reservations:',
        'Here are your reservations:',
        'I located your reservations:'
      ]
    },
    modify_choose_option: {
      es: [
        'Por favor, dígame qué reserva quiere modificar. Diga el número.',
        '¿Cuál de estas reservas quiere modificar? Diga el número.',
        '¿Qué reserva quiere modificar? Diga el número.',
        '¿Qué reserva quiere cambiar? Diga el número.',
        'Dígame qué reserva quiere modificar. Diga el número.'
      ],
      en: [
        'Please choose which reservation to modify. Say the corresponding number.',
        'Which of these reservations do you want to modify? Say the number.',
        'Select the reservation you want to modify. Indicate the number.',
        'What reservation do you want to modify? Say the option number.',
        'Choose the reservation to modify. Mention the corresponding number.'
      ]
    },
    modify_ask_field: {
      es: [
        '¿Qué quiere modificar de su reserva? Puede cambiar el nombre, la fecha, la hora o el número de personas.',
        '¿Qué parte de la reserva quiere cambiar? Puede modificar el nombre, la fecha, la hora o las personas.',
        '¿Qué quiere cambiar? Puede modificar el nombre, la fecha, la hora o las personas.',
        '¿Qué información quiere cambiar? Puede actualizar el nombre, la fecha, la hora o las personas.',
        '¿Qué quiere modificar? Nombre, fecha, hora o personas.'
      ],
      en: [
        'What would you like to modify about your reservation? You can change the name, date, time or number of people.',
        'What part of the reservation do you want to change? You can modify the name, date, time or people.',
        'What field do you want to update? Options: name, date, time or number of people.',
        'What information do you want to change? You can update the name, date, time or people.',
        'What aspect of the reservation do you want to modify? Name, date, time or people.'
      ]
    },
    modify_ask_value: {
      es: [
        'Vale, ¿cuál es el nuevo {field}?',
        'Perfecto, ¿cuál es el nuevo {field}?',
        'Muy bien, ¿cuál es el nuevo {field}?',
        'Vale, indique el nuevo {field}.',
        '¿Cuál es el nuevo {field}?'
      ],
      en: [
        'Perfect, what is the new {field}?',
        'Understood, what is the new {field}?',
        'Very well, what is the new {field}?',
        'Perfect, indicate the new {field}.',
        'What is the new {field}?'
      ]
    },
    modify_confirm: {
      es: [
        'Vale, voy a cambiar el {field} de "{oldValue}" a "{newValue}". ¿Confirma esta modificación?',
        'Perfecto, cambiaré el {field} de "{oldValue}" a "{newValue}". ¿Está de acuerdo?',
        'Muy bien, actualizaré el {field} de "{oldValue}" a "{newValue}". ¿Confirma?',
        'Vale, modificaré el {field} de "{oldValue}" a "{newValue}". ¿Procedo?',
        '¿Confirma cambiar el {field} de "{oldValue}" a "{newValue}"?'
      ],
      en: [
        'Perfect, I will change the {field} from "{oldValue}" to "{newValue}". Do you confirm this modification?',
        'Understood, I will change the {field} from "{oldValue}" to "{newValue}". Do you agree?',
        'Very well, I will update the {field} from "{oldValue}" to "{newValue}". Do you confirm?',
        'Perfect, I will modify the {field} from "{oldValue}" to "{newValue}". Shall I proceed?',
        'Do you confirm changing the {field} from "{oldValue}" to "{newValue}"?'
      ]
    },
    modify_success: {
      es: [
        '¡Vale! Su reserva ha sido modificada exitosamente. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Perfecto! La modificación se ha realizado correctamente. Gracias por contactarnos. ¡Hasta luego!',
        '¡Muy bien! Su reserva ha sido actualizada exitosamente. Gracias por su llamada. ¡Que disfrute!',
        '¡Vale! La modificación se ha completado. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Perfecto! Su reserva ha sido modificada correctamente. Gracias por contactarnos. ¡Hasta pronto!'
      ],
      en: [
        'Perfect! Your reservation has been modified successfully. Thank you for letting us know. Have a great day!',
        'Excellent! The modification has been completed correctly. Thank you for contacting us. Goodbye!',
        'Very well! Your reservation has been updated successfully. Thank you for your call. Enjoy!',
        'Perfect! The modification has been completed. Thank you for letting us know. Have a great day!',
        'Excellent! Your reservation has been modified correctly. Thank you for contacting us. See you soon!'
      ]
    },
    modify_error: {
      es: [
        'Lo siento, ha ocurrido un error al modificar su reserva. Por favor, inténtelo de nuevo más tarde o contacte con nosotros directamente.',
        'Disculpe, no he podido modificar su reserva. Por favor, llame de nuevo o contacte con nosotros por teléfono.',
        'Lo siento, ha habido un problema con la modificación. Por favor, inténtelo de nuevo o contacte con nosotros.',
        'Disculpe las molestias, no he podido actualizar su reserva. Por favor, contacte con nosotros directamente.',
        'Lo siento, ha ocurrido un error. Por favor, inténtelo de nuevo o llame a nuestro número principal.'
      ],
      en: [
        'Sorry, an error occurred while modifying your reservation. Please try again later or contact us directly.',
        'I apologize, I could not modify your reservation. Please call again or contact us by phone.',
        'Sorry, there was a problem with the modification. Please try again or contact us.',
        'Sorry for the inconvenience, I could not update your reservation. Please contact us directly.',
        'Sorry, an error occurred. Please try again or call our main number.'
      ]
    },
    modify_no_reservations: {
      es: [
        'No he encontrado reservas futuras con ese número. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he localizado reservas con ese teléfono. ¿Desea reservar una mesa?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he encontrado reservas para ese teléfono. ¿Desea hacer una reserva?'
      ],
      en: [
        'I have not found future reservations with that phone number. Would you like to make a new reservation?',
        'There are no active reservations for that number. Would you like to make a new reservation?',
        'I have not located reservations with that phone. Would you like to reserve a table?',
        'There are no reservations registered for that number. Would you like to make a new reservation?',
        'I have not found reservations for that phone. Would you like to make a reservation?'
      ]
    },
    modify_offer_new: {
      es: [
        'No hay reservas para modificar. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas. ¿Quiere hacer una nueva reserva?',
        'No hay reservas futuras. ¿Desea reservar una mesa?',
        'No hay reservas para modificar. ¿Quiere hacer una reserva?',
        'No hay reservas. ¿Desea hacer una nueva reserva?'
      ],
      en: [
        'There are no reservations to modify. Would you like to make a new reservation?',
        'There are no active reservations. Would you like to make a new reservation?',
        'There are no future reservations. Would you like to reserve a table?',
        'There are no reservations to modify. Would you like to make a reservation?',
        'There are no reservations. Would you like to make a new reservation?'
      ]
    },
    modify_cancelled: {
      es: [
        'Vale, no se realizará ninguna modificación. ¿En qué más puedo ayudarle?',
        'Perfecto, no modificaremos la reserva. ¿Qué necesita?',
        'Muy bien, no se harán cambios. ¿En qué puedo asistirle?',
        'Vale, no se modificará nada. ¿Qué desea hacer?',
        'Perfecto, no se realizarán cambios. ¿Cómo puedo ayudarle?'
      ],
      en: [
        'Understood, no modification will be made. How else can I help you?',
        'Perfect, we will not modify the reservation. What do you need?',
        'Very well, no changes will be made. How can I assist you?',
        'Understood, nothing will be modified. What would you like to do?',
        'Perfect, no changes will be made. How can I help you?'
      ]
    },
    modify_unclear_option: {
      es: [
        'No he entendido qué opción quiere. Por favor, diga el número de la reserva que desea modificar.',
        'No he podido identificar la opción. Por favor, dígame el número de la reserva.',
        'No he entendido su selección. Por favor, diga el número.',
        'No he podido procesar su elección. Por favor, dígame el número de la opción.',
        'No he entendido. Por favor, diga el número de la reserva que quiere modificar.'
      ],
      en: [
        'I did not understand which option you want to select. Please say the number of the reservation you want to modify.',
        'I could not identify the option. Please mention the number of the reservation.',
        'I did not understand your selection. Please say the corresponding number.',
        'I could not process your choice. Please indicate the option number.',
        'I did not understand. Please say the number of the reservation you want to modify.'
      ]
    },
    modify_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija un número de la lista.',
        'Esa opción no existe. Por favor, seleccione un número válido.',
        'Opción inválida. Por favor, elija un número de las opciones disponibles.',
        'Esa opción no está disponible. Por favor, seleccione otra.',
        'Opción no válida. Por favor, elija un número de la lista.'
      ],
      en: [
        'That option is not valid. Please choose a number from the list.',
        'That option does not exist. Please select a valid number.',
        'Invalid option. Please choose a number from the available options.',
        'That option is not available. Please select another one.',
        'Invalid option. Please choose a number from the list.'
      ]
    },
    modify_unclear_field: {
      es: [
        'No he entendido qué quiere modificar. Por favor, diga si quiere cambiar el nombre, la fecha, la hora o el número de personas.',
        'No he podido identificar qué desea cambiar. Por favor, dígame: nombre, fecha, hora o personas.',
        'No he entendido su elección. Por favor, dígame qué quiere modificar.',
        'No he podido procesar su solicitud. Por favor, dígame qué quiere cambiar.',
        'No he entendido. Por favor, diga qué quiere modificar.'
      ],
      en: [
        'I did not understand which field you want to modify. Please say if you want to change the name, date, time or number of people.',
        'I could not identify what you want to change. Please mention the field: name, date, time or people.',
        'I did not understand your choice. Please specify what you want to modify.',
        'I could not process your request. Please indicate the field to change.',
        'I did not understand. Please say which field you want to modify.'
      ]
    },
    modify_unclear_value: {
      es: [
        'No he entendido el nuevo {field}. Por favor, dígamelo de nuevo.',
        'No he podido procesar el nuevo {field}. Por favor, repítalo.',
        'No he entendido el {field}. Por favor, dígamelo de nuevo.',
        'No he podido identificar el nuevo {field}. Por favor, dígame el valor.',
        'No he entendido. Por favor, diga el nuevo {field} de nuevo.'
      ],
      en: [
        'I did not understand the new {field}. Please tell me again.',
        'I could not process the new {field}. Please repeat it.',
        'I did not understand the value for {field}. Please indicate it again.',
        'I could not identify the new {field}. Please mention the value.',
        'I did not understand. Please say the new {field} again.'
      ]
    },
    modify_unclear_confirmation: {
      es: [
        'No he entendido su respuesta. Por favor, diga "sí" para confirmar o "no" para cancelar.',
        'No he podido procesar su confirmación. Por favor, responda "sí" o "no".',
        'No he entendido. Por favor, confirme con "sí" o cancele con "no".',
        'No he podido identificar su respuesta. Por favor, diga "sí" o "no".',
        'No he entendido. Por favor, responda "sí" para confirmar o "no" para cancelar.'
      ],
      en: [
        'I did not understand your response. Please say "yes" to confirm the modification or "no" to cancel it.',
        'I could not process your confirmation. Please answer "yes" or "no".',
        'I did not understand. Please confirm with "yes" or cancel with "no".',
        'I could not identify your response. Please say "yes" or "no".',
        'I did not understand. Please answer "yes" to confirm or "no" to cancel.'
      ]
    },

    // ===== MENSAJES PARA CANCELACIÓN DE RESERVAS =====
    cancel_ask_phone_choice: {
      es: [
        'Vale, para cancelar su reserva necesito verificar su identidad. ¿Quiere usar el mismo número desde el que está llamando o prefiere usar otro?',
        'Perfecto, para buscar su reserva necesito su número. ¿Desea usar este mismo número o tiene otro?',
        'Muy bien, para localizar su reserva necesito su número. ¿Usa el mismo número de esta llamada o prefiere darme otro?',
        'Vale, para cancelar necesito verificar su identidad. ¿Quiere usar este número o prefiere usar otro?',
        'Perfecto, para proceder con la cancelación necesito su número. ¿Usa el mismo número desde el que llama o tiene otro?'
      ],
      en: [
        'Perfect, to cancel your reservation I need to verify your identity. Do you want to use the same phone number you are calling from or would you prefer to use another number?',
        'Understood, to find your reservation I need your phone number. Do you want to use this same number or do you have another one?',
        'Very well, to locate your reservation I need your number. Do you use the same number from this call or would you prefer to give me another one?',
        'Perfect, to cancel I need to verify your identity. Do you want to use this number or would you prefer to use another one?',
        'Understood, to proceed with the cancellation I need your number. Do you use the same number you are calling from or do you have another one?'
      ],
      de: [
        'Perfekt, um Ihre Reservierung zu stornieren, muss ich Ihre Identität überprüfen. Möchten Sie dieselbe Telefonnummer verwenden oder bevorzugen Sie eine andere?',
        'Verstanden, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Möchten Sie dieselbe Nummer verwenden oder haben Sie eine andere?',
        'Sehr gut, um Ihre Reservierung zu finden, brauche ich Ihre Nummer. Verwenden Sie dieselbe Nummer von diesem Anruf oder bevorzugen Sie es, mir eine andere zu geben?',
        'Perfekt, zum Stornieren muss ich Ihre Identität überprüfen. Möchten Sie diese Nummer verwenden oder bevorzugen Sie eine andere?',
        'Verstanden, um mit der Stornierung fortzufahren, brauche ich Ihre Nummer. Verwenden Sie dieselbe Nummer, von der aus Sie anrufen, oder haben Sie eine andere?'
      ],
      fr: [
        'Parfait, pour annuler votre réservation, je dois vérifier votre identité. Voulez-vous utiliser le même numéro de téléphone ou préférez-vous utiliser un autre numéro?',
        'Compris, pour trouver votre réservation, j\'ai besoin de votre numéro de téléphone. Voulez-vous utiliser ce même numéro ou en avez-vous un autre?',
        'Très bien, pour localiser votre réservation, j\'ai besoin de votre numéro. Utilisez-vous le même numéro de cet appel ou préférez-vous m\'en donner un autre?',
        'Parfait, pour annuler, je dois vérifier votre identité. Voulez-vous utiliser ce numéro ou préférez-vous utiliser un autre?',
        'Compris, pour procéder à l\'annulation, j\'ai besoin de votre numéro. Utilisez-vous le même numéro depuis lequel vous appelez ou en avez-vous un autre?'
      ],
      it: [
        'Perfetto, per cancellare la sua prenotazione devo verificare la sua identità. Vuole usare lo stesso numero di telefono da cui sta chiamando o preferisce usare un altro numero?',
        'Capito, per trovare la sua prenotazione ho bisogno del suo numero di telefono. Vuole usare questo stesso numero o ne ha un altro?',
        'Molto bene, per localizzare la sua prenotazione ho bisogno del suo numero. Usa lo stesso numero di questa chiamata o preferisce darmene un altro?',
        'Perfetto, per cancellare devo verificare la sua identità. Vuole usare questo numero o preferisce usarne un altro?',
        'Capito, per procedere con la cancellazione ho bisogno del suo numero. Usa lo stesso numero da cui sta chiamando o ne ha un altro?'
      ],
      pt: [
        'Perfeito, para cancelar sua reserva preciso verificar sua identidade. Quer usar o mesmo número de telefone de onde está ligando ou prefere usar outro número?',
        'Entendido, para encontrar sua reserva preciso do seu número de telefone. Quer usar este mesmo número ou tem outro?',
        'Muito bem, para localizar sua reserva preciso do seu número. Usa o mesmo número desta chamada ou prefere me dar outro?',
        'Perfeito, para cancelar preciso verificar sua identidade. Quer usar este número ou prefere usar outro?',
        'Entendido, para prosseguir com o cancelamento preciso do seu número. Usa o mesmo número de onde está ligando ou tem outro?'
      ]
    },
    cancel_ask_phone: {
      es: [
        'Vale, para cancelar su reserva necesito su número. ¿Cuál es su número?',
        'Perfecto, para buscar su reserva necesito su número. ¿Podría darme su número?',
        'Muy bien, para localizar su reserva necesito su número. ¿Cuál es?',
        'Vale, para cancelar necesito verificar su identidad. ¿Cuál es su número?',
        'Perfecto, para proceder con la cancelación necesito su número. ¿Podría darmelo?'
      ],
      en: [
        'Perfect, to cancel your reservation I need your phone number. What is your number?',
        'Understood, to find your reservation I need your phone number. Could you give me your number?',
        'Very well, to locate your reservation I need your phone number. What is it?',
        'Perfect, to cancel I need to verify your identity. What is your phone number?',
        'Understood, to proceed with the cancellation I need your phone number. Could you give it to me?'
      ],
      de: [
        'Perfekt, um Ihre Reservierung zu stornieren, brauche ich Ihre Telefonnummer. Wie lautet Ihre Nummer?',
        'Verstanden, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Könnten Sie mir Ihre Nummer geben?',
        'Sehr gut, um Ihre Reservierung zu finden, brauche ich Ihre Telefonnummer. Wie lautet sie?',
        'Perfekt, um zu stornieren, muss ich Ihre Identität überprüfen. Wie lautet Ihre Telefonnummer?',
        'Verstanden, um mit der Stornierung fortzufahren, brauche ich Ihre Telefonnummer. Könnten Sie sie mir geben?'
      ],
      it: [
        'Perfetto, per cancellare la sua prenotazione ho bisogno del suo numero di telefono. Qual è il suo numero?',
        'Capito, per trovare la sua prenotazione ho bisogno del suo numero di telefono. Potrebbe darmi il suo numero?',
        'Molto bene, per localizzare la sua prenotazione ho bisogno del suo numero di telefono. Qual è?',
        'Perfetto, per cancellare devo verificare la sua identità. Qual è il suo numero di telefono?',
        'Capito, per procedere con la cancellazione ho bisogno del suo numero di telefono. Potrebbe darmelo?'
      ],
      fr: [
        'Parfait, pour annuler votre réservation j\'ai besoin de votre numéro de téléphone. Quel est votre numéro?',
        'Compris, pour trouver votre réservation j\'ai besoin de votre numéro de téléphone. Pourriez-vous me donner votre numéro?',
        'Très bien, pour localiser votre réservation j\'ai besoin de votre numéro de téléphone. Quel est-il?',
        'Parfait, pour annuler je dois vérifier votre identité. Quel est votre numéro de téléphone?',
        'Compris, pour procéder à l\'annulation j\'ai besoin de votre numéro de téléphone. Pourriez-vous me le donner?'
      ],
      pt: [
        'Perfeito, para cancelar sua reserva preciso do seu número de telefone. Qual é o seu número?',
        'Entendido, para encontrar sua reserva preciso do seu número de telefone. Poderia me dar o seu número?',
        'Muito bem, para localizar sua reserva preciso do seu número de telefone. Qual é?',
        'Perfeito, para cancelar preciso verificar sua identidade. Qual é o seu número de telefone?',
        'Entendido, para prosseguir com o cancelamento preciso do seu número de telefone. Poderia me dar?'
      ]
    },
    cancel_show_single: {
      es: [
        'He encontrado su reserva:',
        'Vale, he localizado su reserva:',
        'Perfecto, he encontrado su reserva:',
        'Muy bien, aquí está su reserva:',
        'Vale, aquí tiene su reserva:'
      ],
      en: [
        'I found your reservation:',
        'Perfect, I located your reservation:',
        'Excellent, I found your reservation:',
        'Very well, here is your reservation:',
        'Perfect, here is your reservation:'
      ],
      de: [
        'Ich habe Ihre Reservierung gefunden:',
        'Perfekt, ich habe Ihre Reservierung gefunden:',
        'Ausgezeichnet, ich habe Ihre Reservierung gefunden:',
        'Sehr gut, hier ist Ihre Reservierung:',
        'Perfekt, hier ist Ihre Reservierung:'
      ],
      it: [
        'Ho trovato la sua prenotazione:',
        'Perfetto, ho localizzato la sua prenotazione:',
        'Eccellente, ho trovato la sua prenotazione:',
        'Molto bene, ecco la sua prenotazione:',
        'Perfetto, ecco la sua prenotazione:'
      ],
      fr: [
        'J\'ai trouvé votre réservation:',
        'Parfait, j\'ai localisé votre réservation:',
        'Excellent, j\'ai trouvé votre réservation:',
        'Très bien, voici votre réservation:',
        'Parfait, voici votre réservation:'
      ],
      pt: [
        'Encontrei sua reserva:',
        'Perfeito, localizei sua reserva:',
        'Excelente, encontrei sua reserva:',
        'Muito bem, aqui está sua reserva:',
        'Perfeito, aqui está sua reserva:'
      ]
    },
    cancel_show_multiple: {
      es: [
        'He encontrado varias reservas a su nombre:',
        'Vale, he localizado múltiples reservas:',
        'Perfecto, he encontrado varias reservas:',
        'Muy bien, aquí están sus reservas:',
        'Vale, aquí tiene sus reservas:'
      ],
      en: [
        'I found several reservations under your name:',
        'Perfect, I located multiple reservations:',
        'Excellent, I found several reservations:',
        'Very well, here are your reservations:',
        'Perfect, here are your reservations:'
      ],
      de: [
        'Ich habe mehrere Reservierungen unter Ihrem Namen gefunden:',
        'Perfekt, ich habe mehrere Reservierungen gefunden:',
        'Ausgezeichnet, ich habe mehrere Reservierungen gefunden:',
        'Sehr gut, hier sind Ihre Reservierungen:',
        'Perfekt, hier sind Ihre Reservierungen:'
      ],
      it: [
        'Ho trovato diverse prenotazioni a suo nome:',
        'Perfetto, ho localizzato più prenotazioni:',
        'Eccellente, ho trovato diverse prenotazioni:',
        'Molto bene, ecco le sue prenotazioni:',
        'Perfetto, ecco le sue prenotazioni:'
      ],
      fr: [
        'J\'ai trouvé plusieurs réservations à votre nom:',
        'Parfait, j\'ai localisé plusieurs réservations:',
        'Excellent, j\'ai trouvé plusieurs réservations:',
        'Très bien, voici vos réservations:',
        'Parfait, voici vos réservations:'
      ],
      pt: [
        'Encontrei várias reservas em seu nome:',
        'Perfeito, localizei múltiplas reservas:',
        'Excelente, encontrei várias reservas:',
        'Muito bem, aqui estão suas reservas:',
        'Perfeito, aqui estão suas reservas:'
      ]
    },
    cancel_choose_option: {
      es: [
        'Por favor, dígame qué reserva quiere cancelar. Puede decir "opción 1", "opción 2", etc.',
        '¿Cuál de estas reservas quiere cancelar? Diga el número.',
        'Por favor, dígame qué reserva quiere cancelar. Diga "primera", "segunda", etc.',
        '¿Qué reserva quiere cancelar? Diga el número.',
        'Dígame qué reserva quiere cancelar. Diga el número.'
      ],
      en: [
        'Please tell me which option you want to cancel. You can say "option 1", "option 2", etc.',
        'Which of these reservations do you want to cancel? Say the option number.',
        'Please indicate which reservation you want to cancel. Say "first", "second", etc.',
        'Which option do you want to cancel? You can say the option number.',
        'Please choose which reservation to cancel. Say the corresponding number.'
      ],
      de: [
        'Bitte sagen Sie mir, welche Option Sie stornieren möchten. Sie können "Option 1", "Option 2" usw. sagen.',
        'Welche dieser Reservierungen möchten Sie stornieren? Sagen Sie die Optionsnummer.',
        'Bitte geben Sie an, welche Reservierung Sie stornieren möchten. Sagen Sie "erste", "zweite" usw.',
        'Welche Option möchten Sie stornieren? Sie können die Optionsnummer sagen.',
        'Bitte wählen Sie, welche Reservierung storniert werden soll. Sagen Sie die entsprechende Nummer.'
      ],
      it: [
        'Per favore, dimmi quale opzione vuoi cancellare. Puoi dire "opzione 1", "opzione 2", ecc.',
        'Quale di queste prenotazioni vuoi cancellare? Di\' il numero dell\'opzione.',
        'Per favore, indica quale prenotazione vuoi cancellare. Di\' "prima", "seconda", ecc.',
        'Quale opzione vuoi cancellare? Puoi dire il numero dell\'opzione.',
        'Per favore, scegli quale prenotazione cancellare. Di\' il numero corrispondente.'
      ],
      fr: [
        'Veuillez me dire quelle option vous voulez annuler. Vous pouvez dire "option 1", "option 2", etc.',
        'Laquelle de ces réservations voulez-vous annuler? Dites le numéro de l\'option.',
        'Veuillez indiquer quelle réservation vous voulez annuler. Dites "première", "deuxième", etc.',
        'Quelle option voulez-vous annuler? Vous pouvez dire le numéro de l\'option.',
        'Veuillez choisir quelle réservation annuler. Dites le numéro correspondant.'
      ],
      pt: [
        'Por favor, me diga qual opção você quer cancelar. Você pode dizer "opção 1", "opção 2", etc.',
        'Qual dessas reservas você quer cancelar? Diga o número da opção.',
        'Por favor, indique qual reserva você quer cancelar. Diga "primeira", "segunda", etc.',
        'Qual opção você quer cancelar? Você pode dizer o número da opção.',
        'Por favor, escolha qual reserva cancelar. Diga o número correspondente.'
      ]
    },
    cancel_confirm: {
      es: [
        '¿Está seguro de que quiere cancelar esta reserva?',
        '¿Confirma que quiere cancelar esta reserva?',
        '¿Quiere proceder con la cancelación?',
        '¿Está completamente seguro de cancelar?',
        '¿Confirma la cancelación?'
      ],
      en: [
        'Are you sure you want to cancel this reservation?',
        'Do you confirm that you want to cancel this reservation?',
        'Do you want to proceed with the cancellation?',
        'Are you completely sure about canceling?',
        'Do you confirm the cancellation of this reservation?'
      ],
      de: [
        'Sind Sie sicher, dass Sie diese Reservierung stornieren möchten?',
        'Bestätigen Sie, dass Sie diese Reservierung stornieren möchten?',
        'Möchten Sie mit der Stornierung fortfahren?',
        'Sind Sie sich völlig sicher, dass Sie stornieren möchten?',
        'Bestätigen Sie die Stornierung dieser Reservierung?'
      ],
      it: [
        'È sicuro di voler cancellare questa prenotazione?',
        'Conferma di voler cancellare questa prenotazione?',
        'Vuole procedere con la cancellazione?',
        'È completamente sicuro di cancellare?',
        'Conferma la cancellazione di questa prenotazione?'
      ],
      fr: [
        'Êtes-vous sûr de vouloir annuler cette réservation?',
        'Confirmez-vous que vous voulez annuler cette réservation?',
        'Voulez-vous procéder à l\'annulation?',
        'Êtes-vous complètement sûr d\'annuler?',
        'Confirmez-vous l\'annulation de cette réservation?'
      ],
      pt: [
        'Tem certeza de que quer cancelar esta reserva?',
        'Confirma que quer cancelar esta reserva?',
        'Quer prosseguir com o cancelamento?',
        'Tem certeza absoluta de cancelar?',
        'Confirma o cancelamento desta reserva?'
      ]
    },
    cancel_confirm_selected: {
      es: [
        'Vale, ha seleccionado:',
        'Perfecto, ha elegido:',
        'Muy bien, ha escogido:',
        'Vale, su selección es:',
        'Perfecto, ha seleccionado:'
      ],
      en: [
        'Perfect, you selected:',
        'Excellent, you chose:',
        'Very well, you picked:',
        'Perfect, your selection is:',
        'Excellent, you selected:'
      ],
      de: [
        'Perfekt, Sie haben ausgewählt:',
        'Ausgezeichnet, Sie haben gewählt:',
        'Sehr gut, Sie haben ausgewählt:',
        'Perfekt, Ihre Auswahl ist:',
        'Ausgezeichnet, Sie haben ausgewählt:'
      ],
      it: [
        'Perfetto, ha selezionato:',
        'Eccellente, ha scelto:',
        'Molto bene, ha scelto:',
        'Perfetto, la sua selezione è:',
        'Eccellente, ha selezionato:'
      ],
      fr: [
        'Parfait, vous avez sélectionné:',
        'Excellent, vous avez choisi:',
        'Très bien, vous avez choisi:',
        'Parfait, votre sélection est:',
        'Excellent, vous avez sélectionné:'
      ],
      pt: [
        'Perfeito, você selecionou:',
        'Excelente, você escolheu:',
        'Muito bem, você escolheu:',
        'Perfeito, sua seleção é:',
        'Excelente, você selecionou:'
      ]
    },
    cancel_success: {
      es: [
        '¡Vale! Su reserva ha sido cancelada exitosamente. Gracias por avisarnos. ¡Que tenga un buen día!',
        '¡Perfecto! La reserva ha sido cancelada correctamente. Gracias por notificarnos. ¡Hasta pronto!',
        '¡Muy bien! Su reserva se ha cancelado exitosamente. Gracias por contactarnos. ¡Que tenga buen día!',
        '¡Vale! La cancelación se ha procesado correctamente. Gracias por avisarnos. ¡Hasta la próxima!',
        '¡Perfecto! Su reserva ha sido cancelada. Gracias por notificarnos a tiempo. ¡Que tenga buen día!'
      ],
      en: [
        'Perfect! Your reservation has been canceled successfully. Thank you for letting us know. Have a great day!',
        'Excellent! The reservation has been canceled correctly. Thank you for notifying us. See you soon!',
        'Very well! Your reservation has been canceled successfully. Thank you for contacting us. Have a great day!',
        'Perfect! The cancellation has been processed correctly. Thank you for letting us know. Until next time!',
        'Excellent! Your reservation has been canceled. Thank you for notifying us in time. Have a great day!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich storniert. Vielen Dank, dass Sie uns benachrichtigt haben. Haben Sie einen schönen Tag!',
        'Ausgezeichnet! Die Reservierung wurde korrekt storniert. Vielen Dank für die Benachrichtigung. Bis bald!',
        'Sehr gut! Ihre Reservierung wurde erfolgreich storniert. Vielen Dank für den Kontakt. Haben Sie einen schönen Tag!',
        'Perfekt! Die Stornierung wurde korrekt bearbeitet. Vielen Dank, dass Sie uns benachrichtigt haben. Bis zum nächsten Mal!',
        'Ausgezeichnet! Ihre Reservierung wurde storniert. Vielen Dank für die rechtzeitige Benachrichtigung. Haben Sie einen schönen Tag!'
      ],
      it: [
        'Perfetto! La sua prenotazione è stata cancellata con successo. Grazie per averci avvisato. Buona giornata!',
        'Eccellente! La prenotazione è stata cancellata correttamente. Grazie per averci notificato. A presto!',
        'Molto bene! La sua prenotazione è stata cancellata con successo. Grazie per averci contattato. Buona giornata!',
        'Perfetto! La cancellazione è stata elaborata correttamente. Grazie per averci avvisato. Alla prossima!',
        'Eccellente! La sua prenotazione è stata cancellata. Grazie per averci notificato in tempo. Buona giornata!'
      ],
      fr: [
        'Parfait! Votre réservation a été annulée avec succès. Merci de nous avoir prévenus. Passez une bonne journée!',
        'Excellent! La réservation a été annulée correctement. Merci de nous avoir notifiés. À bientôt!',
        'Très bien! Votre réservation a été annulée avec succès. Merci de nous avoir contactés. Passez une bonne journée!',
        'Parfait! L\'annulation a été traitée correctement. Merci de nous avoir prévenus. À la prochaine!',
        'Excellent! Votre réservation a été annulée. Merci de nous avoir notifiés à temps. Passez une bonne journée!'
      ],
      pt: [
        'Perfeito! Sua reserva foi cancelada com sucesso. Obrigado por nos avisar. Tenha um ótimo dia!',
        'Excelente! A reserva foi cancelada corretamente. Obrigado por nos notificar. Até logo!',
        'Muito bem! Sua reserva foi cancelada com sucesso. Obrigado por nos contatar. Tenha um ótimo dia!',
        'Perfeito! O cancelamento foi processado corretamente. Obrigado por nos avisar. Até a próxima!',
        'Excelente! Sua reserva foi cancelada. Obrigado por nos notificar a tempo. Tenha um ótimo dia!'
      ]
    },
    cancel_error: {
      es: [
        'Disculpe, hubo un error al cancelar su reserva. Por favor, contacte directamente al restaurante.',
        'Lo siento, no pude cancelar su reserva. Por favor, llame directamente al restaurante.',
        'Perdón, hubo un problema técnico. Por favor, contacte al restaurante directamente.',
        'Disculpe, no pude procesar la cancelación. Por favor, llame al restaurante.',
        'Lo siento, hubo un error. Por favor, contacte directamente al restaurante.'
      ],
      en: [
        'Sorry, there was an error canceling your reservation. Please contact the restaurant directly.',
        'I\'m sorry, I couldn\'t cancel your reservation. Please call the restaurant directly.',
        'Sorry, there was a technical problem. Please contact the restaurant directly.',
        'Sorry, I couldn\'t process the cancellation. Please call the restaurant.',
        'I\'m sorry, there was an error. Please contact the restaurant directly.'
      ],
      de: [
        'Entschuldigung, es gab einen Fehler beim Stornieren Ihrer Reservierung. Bitte kontaktieren Sie das Restaurant direkt.',
        'Es tut mir leid, ich konnte Ihre Reservierung nicht stornieren. Bitte rufen Sie das Restaurant direkt an.',
        'Entschuldigung, es gab ein technisches Problem. Bitte kontaktieren Sie das Restaurant direkt.',
        'Entschuldigung, ich konnte die Stornierung nicht bearbeiten. Bitte rufen Sie das Restaurant an.',
        'Es tut mir leid, es gab einen Fehler. Bitte kontaktieren Sie das Restaurant direkt.'
      ],
      it: [
        'Scusi, c\'è stato un errore nel cancellare la sua prenotazione. Per favore, contatti direttamente il ristorante.',
        'Mi dispiace, non sono riuscito a cancellare la sua prenotazione. Per favore, chiami direttamente il ristorante.',
        'Scusi, c\'è stato un problema tecnico. Per favore, contatti direttamente il ristorante.',
        'Scusi, non sono riuscito a processare la cancellazione. Per favore, chiami il ristorante.',
        'Mi dispiace, c\'è stato un errore. Per favore, contatti direttamente il ristorante.'
      ],
      fr: [
        'Désolé, il y a eu une erreur lors de l\'annulation de votre réservation. Veuillez contacter directement le restaurant.',
        'Je suis désolé, je n\'ai pas pu annuler votre réservation. Veuillez appeler directement le restaurant.',
        'Désolé, il y a eu un problème technique. Veuillez contacter directement le restaurant.',
        'Désolé, je n\'ai pas pu traiter l\'annulation. Veuillez appeler le restaurant.',
        'Je suis désolé, il y a eu une erreur. Veuillez contacter directement le restaurant.'
      ],
      pt: [
        'Desculpe, houve um erro ao cancelar sua reserva. Por favor, entre em contato diretamente com o restaurante.',
        'Sinto muito, não consegui cancelar sua reserva. Por favor, ligue diretamente para o restaurante.',
        'Desculpe, houve um problema técnico. Por favor, entre em contato diretamente com o restaurante.',
        'Desculpe, não consegui processar o cancelamento. Por favor, ligue para o restaurante.',
        'Sinto muito, houve um erro. Por favor, entre em contato diretamente com o restaurante.'
      ]
    },
    cancel_no_reservations: {
      es: [
        'No he encontrado ninguna reserva activa con ese número. ¿Le gustaría hacer una nueva reserva?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No he localizado reservas con ese teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Le gustaría reservar una mesa?',
        'No encontré reservas con ese teléfono. ¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'I didn\'t find any active reservations with that phone number. Would you like to make a new reservation?',
        'There are no reservations registered for that number. Do you want to make a new reservation?',
        'I didn\'t locate reservations with that phone. Do you want to make a new reservation?',
        'There are no active reservations for that number. Would you like to reserve a table?',
        'I didn\'t find reservations with that phone. Do you want to make a new reservation?'
      ],
      de: [
        'Ich habe keine aktiven Reservierungen mit dieser Telefonnummer gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine Reservierungen für diese Nummer. Möchten Sie eine neue Reservierung vornehmen?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine aktiven Reservierungen für diese Nummer. Möchten Sie einen Tisch reservieren?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Non ho trovato prenotazioni attive con quel numero di telefono. Vorresti fare una nuova prenotazione?',
        'Non ci sono prenotazioni registrate per quel numero. Vuoi fare una nuova prenotazione?',
        'Non ho localizzato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?',
        'Non ci sono prenotazioni attive per quel numero. Vorresti prenotare un tavolo?',
        'Non ho trovato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Je n\'ai trouvé aucune réservation active avec ce numéro de téléphone. Souhaitez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations enregistrées pour ce numéro. Voulez-vous faire une nouvelle réservation?',
        'Je n\'ai pas localisé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations actives pour ce numéro. Souhaitez-vous réserver une table?',
        'Je n\'ai pas trouvé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Não encontrei reservas ativas com esse número de telefone. Gostaria de fazer uma nova reserva?',
        'Não há reservas registradas para esse número. Quer fazer uma nova reserva?',
        'Não localizei reservas com esse telefone. Quer fazer uma nova reserva?',
        'Não há reservas ativas para esse número. Gostaria de reservar uma mesa?',
        'Não encontrei reservas com esse telefone. Quer fazer uma nova reserva?'
      ]
    },
    cancel_offer_new: {
      es: [
        '¿Le gustaría hacer una nueva reserva en su lugar?',
        '¿Quiere hacer una nueva reserva?',
        '¿Desea reservar una mesa?',
        '¿Le gustaría hacer una reserva?',
        '¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'Would you like to make a new reservation instead?',
        'Do you want to make a new reservation?',
        'Do you want to reserve a table?',
        'Would you like to make a reservation?',
        'Do you want to make a new reservation?'
      ],
      de: [
        'Möchten Sie stattdessen eine neue Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?',
        'Möchten Sie einen Tisch reservieren?',
        'Möchten Sie eine Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Vorresti fare una nuova prenotazione invece?',
        'Vuoi fare una nuova prenotazione?',
        'Vuoi prenotare un tavolo?',
        'Vorresti fare una prenotazione?',
        'Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Souhaitez-vous faire une nouvelle réservation à la place?',
        'Voulez-vous faire une nouvelle réservation?',
        'Voulez-vous réserver une table?',
        'Souhaitez-vous faire une réservation?',
        'Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Gostaria de fazer uma nova reserva em vez disso?',
        'Quer fazer uma nova reserva?',
        'Quer reservar uma mesa?',
        'Gostaria de fazer uma reserva?',
        'Quer fazer uma nova reserva?'
      ]
    },
    cancel_cancelled: {
      es: [
        'Perfecto, no cancelaremos la reserva. ¿En qué más puedo ayudarle?',
        'Entendido, mantendremos la reserva. ¿Qué más necesita?',
        'Muy bien, no procederemos con la cancelación. ¿En qué puedo ayudarle?',
        'Perfecto, la reserva se mantiene. ¿Qué más puedo hacer por usted?',
        'Excelente, no cancelaremos. ¿En qué puedo asistirle?'
      ],
      en: [
        'Perfect, we won\'t cancel the reservation. How else can I help you?',
        'Understood, we\'ll keep the reservation. What else do you need?',
        'Very well, we won\'t proceed with the cancellation. How can I help you?',
        'Perfect, the reservation remains. What else can I do for you?',
        'Excellent, we won\'t cancel. How can I assist you?'
      ],
      de: [
        'Perfekt, wir werden die Reservierung nicht stornieren. Wie kann ich Ihnen sonst helfen?',
        'Verstanden, wir behalten die Reservierung. Was brauchen Sie sonst?',
        'Sehr gut, wir werden nicht mit der Stornierung fortfahren. Wie kann ich Ihnen helfen?',
        'Perfekt, die Reservierung bleibt bestehen. Was kann ich sonst für Sie tun?',
        'Ausgezeichnet, wir werden nicht stornieren. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Perfetto, non cancelleremo la prenotazione. Come altro posso aiutarti?',
        'Capito, manterremo la prenotazione. Cos\'altro ti serve?',
        'Molto bene, non procederemo con la cancellazione. Come posso aiutarti?',
        'Perfetto, la prenotazione rimane. Cos\'altro posso fare per te?',
        'Eccellente, non cancelleremo. Come posso assisterti?'
      ],
      fr: [
        'Parfait, nous n\'annulerons pas la réservation. Comment puis-je vous aider d\'autre?',
        'Compris, nous garderons la réservation. De quoi avez-vous besoin d\'autre?',
        'Très bien, nous ne procéderons pas à l\'annulation. Comment puis-je vous aider?',
        'Parfait, la réservation reste. Que puis-je faire d\'autre pour vous?',
        'Excellent, nous n\'annulerons pas. Comment puis-je vous assister?'
      ],
      pt: [
        'Perfeito, não cancelaremos a reserva. Como mais posso ajudá-lo?',
        'Entendido, manteremos a reserva. O que mais você precisa?',
        'Muito bem, não procederemos com o cancelamento. Como posso ajudá-lo?',
        'Perfeito, a reserva permanece. O que mais posso fazer por você?',
        'Excelente, não cancelaremos. Como posso assisti-lo?'
      ]
    },
    cancel_unclear_option: {
      es: [
        'Disculpe, no entendí qué opción quiere. Por favor, diga el número de la opción que quiere cancelar.',
        'No entendí bien. Por favor, dígame el número de la opción.',
        'Perdón, no capté bien. Por favor, diga "opción 1", "opción 2", etc.',
        'No entendí. Por favor, dígame el número de la opción que quiere cancelar.',
        'Disculpe, no entendí. Por favor, diga el número de la opción.'
      ],
      en: [
        'Sorry, I didn\'t understand which option you want. Please say the number of the option you want to cancel.',
        'I didn\'t understand well. Please indicate the number of the option you want to cancel.',
        'Sorry, I didn\'t catch that. Please say "option 1", "option 2", etc.',
        'I didn\'t understand. Please repeat the number of the option you want to cancel.',
        'Sorry, I didn\'t understand. Please say the option number clearly.'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, welche Option Sie möchten. Bitte sagen Sie die Nummer der Option, die Sie stornieren möchten.',
        'Ich verstand nicht gut. Bitte geben Sie die Nummer der Option an, die Sie stornieren möchten.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie "Option 1", "Option 2" usw.',
        'Ich verstand nicht. Bitte wiederholen Sie die Nummer der Option, die Sie stornieren möchten.',
        'Entschuldigung, ich verstand nicht. Bitte sagen Sie die Optionsnummer deutlich.'
      ],
      it: [
        'Scusi, non ho capito quale opzione vuole. Per favore, dica il numero dell\'opzione che vuole cancellare.',
        'Non ho capito bene. Per favore, indichi il numero dell\'opzione che vuole cancellare.',
        'Scusi, non ho capito. Per favore, dica "opzione 1", "opzione 2", ecc.',
        'Non ho capito. Per favore, ripeta il numero dell\'opzione che vuole cancellare.',
        'Scusi, non ho capito. Per favore, dica chiaramente il numero dell\'opzione.'
      ],
      fr: [
        'Désolé, je n\'ai pas compris quelle option vous voulez. Veuillez dire le numéro de l\'option que vous voulez annuler.',
        'Je n\'ai pas bien compris. Veuillez indiquer le numéro de l\'option que vous voulez annuler.',
        'Désolé, je n\'ai pas saisi. Veuillez dire "option 1", "option 2", etc.',
        'Je n\'ai pas compris. Veuillez répéter le numéro de l\'option que vous voulez annuler.',
        'Désolé, je n\'ai pas compris. Veuillez dire clairement le numéro de l\'option.'
      ],
      pt: [
        'Desculpe, não entendi qual opção você quer. Por favor, diga o número da opção que quer cancelar.',
        'Não entendi bem. Por favor, indique o número da opção que quer cancelar.',
        'Desculpe, não entendi. Por favor, diga "opção 1", "opção 2", etc.',
        'Não entendi. Por favor, repita o número da opção que quer cancelar.',
        'Desculpe, não entendi. Por favor, diga claramente o número da opção.'
      ]
    },
    cancel_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija una de las opciones disponibles.',
        'Esa opción no existe. Por favor, seleccione una opción válida.',
        'Opción incorrecta. Por favor, elija entre las opciones mostradas.',
        'Esa opción no está disponible. Por favor, seleccione una opción válida.',
        'Opción no válida. Por favor, elija una de las opciones correctas.'
      ],
      en: [
        'That option is not valid. Please choose one of the available options.',
        'That option doesn\'t exist. Please select a valid option.',
        'Incorrect option. Please choose from the options shown.',
        'That option is not available. Please select a valid option.',
        'Invalid option. Please choose one of the correct options.'
      ],
      de: [
        'Diese Option ist nicht gültig. Bitte wählen Sie eine der verfügbaren Optionen.',
        'Diese Option existiert nicht. Bitte wählen Sie eine gültige Option.',
        'Falsche Option. Bitte wählen Sie aus den gezeigten Optionen.',
        'Diese Option ist nicht verfügbar. Bitte wählen Sie eine gültige Option.',
        'Ungültige Option. Bitte wählen Sie eine der korrekten Optionen.'
      ],
      it: [
        'Quell\'opzione non è valida. Per favore, scegli una delle opzioni disponibili.',
        'Quell\'opzione non esiste. Per favore, seleziona un\'opzione valida.',
        'Opzione incorretta. Per favore, scegli tra le opzioni mostrate.',
        'Quell\'opzione non è disponibile. Per favore, seleziona un\'opzione valida.',
        'Opzione non valida. Per favore, scegli una delle opzioni corrette.'
      ],
      fr: [
        'Cette option n\'est pas valide. Veuillez choisir une des options disponibles.',
        'Cette option n\'existe pas. Veuillez sélectionner une option valide.',
        'Option incorrecte. Veuillez choisir parmi les options affichées.',
        'Cette option n\'est pas disponible. Veuillez sélectionner une option valide.',
        'Option non valide. Veuillez choisir une des options correctes.'
      ],
      pt: [
        'Essa opção não é válida. Por favor, escolha uma das opções disponíveis.',
        'Essa opção não existe. Por favor, selecione uma opção válida.',
        'Opção incorreta. Por favor, escolha entre as opções mostradas.',
        'Essa opção não está disponível. Por favor, selecione uma opção válida.',
        'Opção inválida. Por favor, escolha uma das opções corretas.'
      ]
    },
    cancel_unclear_confirmation: {
      es: [
        'Disculpe, no entendí bien su respuesta. ¿Quiere cancelar la reserva o no?',
        'No entendí claramente. Por favor, diga "sí" para cancelar o "no" para mantener la reserva.',
        'Perdón, no capté bien. ¿Confirma que quiere cancelar esta reserva?',
        'No entendí. Por favor, responda: ¿sí o no?',
        'Disculpe, no entendí. ¿Quiere cancelar la reserva?'
      ],
      en: [
        'Sorry, I didn\'t understand your response well. Do you want to cancel the reservation or not?',
        'I didn\'t understand clearly. Please say "yes" to cancel or "no" to keep the reservation.',
        'Sorry, I didn\'t catch that. Do you confirm you want to cancel this reservation?',
        'I didn\'t understand. Please answer clearly: yes or no?',
        'Sorry, I didn\'t understand. Do you want to cancel the reservation?'
      ],
      de: [
        'Entschuldigung, ich verstand Ihre Antwort nicht gut. Möchten Sie die Reservierung stornieren oder nicht?',
        'Ich verstand nicht klar. Bitte sagen Sie "ja" zum Stornieren oder "nein" zum Behalten der Reservierung.',
        'Entschuldigung, ich habe das nicht verstanden. Bestätigen Sie, dass Sie diese Reservierung stornieren möchten?',
        'Ich verstand nicht. Bitte antworten Sie klar: ja oder nein?',
        'Entschuldigung, ich verstand nicht. Möchten Sie die Reservierung stornieren?'
      ],
      it: [
        'Scusi, non ho capito bene la sua risposta. Vuole cancellare la prenotazione o no?',
        'Non ho capito chiaramente. Per favore, dica "sì" per cancellare o "no" per mantenere la prenotazione.',
        'Scusi, non ho capito. Conferma di voler cancellare questa prenotazione?',
        'Non ho capito. Per favore, risponda chiaramente: sì o no?',
        'Scusi, non ho capito. Vuole cancellare la prenotazione?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre réponse. Voulez-vous annuler la réservation ou non?',
        'Je n\'ai pas compris clairement. Veuillez dire "oui" pour annuler ou "non" pour garder la réservation.',
        'Désolé, je n\'ai pas saisi. Confirmez-vous que vous voulez annuler cette réservation?',
        'Je n\'ai pas compris. Veuillez répondre clairement: oui ou non?',
        'Désolé, je n\'ai pas compris. Voulez-vous annuler la réservation?'
      ],
      pt: [
        'Desculpe, não entendi bem sua resposta. Quer cancelar a reserva ou não?',
        'Não entendi claramente. Por favor, diga "sim" para cancelar ou "não" para manter a reserva.',
        'Desculpe, não entendi. Confirma que quer cancelar esta reserva?',
        'Não entendi. Por favor, responda claramente: sim ou não?',
        'Desculpe, não entendi. Quer cancelar a reserva?'
      ]
    },
    modify_ask_phone_choice: {
      es: [
        'Para modificar su reserva, ¿desea usar el mismo número de teléfono desde el que está llamando?',
        '¿Quiere usar este número de teléfono para buscar su reserva o tiene otro?',
        '¿Desea buscar su reserva con este número o prefiere usar otro?',
        '¿Usamos este teléfono para encontrar su reserva o tiene otro número?',
        '¿Desea buscar la reserva con este número de teléfono?'
      ],
      en: [
        'To modify your reservation, do you want to use the same phone number you are calling from?',
        'Do you want to use this phone number to find your reservation or do you have another one?',
        'Do you want to search for your reservation with this number or would you prefer to use another?',
        'Shall we use this phone to find your reservation or do you have another number?',
        'Do you want to search for the reservation with this phone number?'
      ],
      de: [
        'Um Ihre Reservierung zu ändern, möchten Sie die gleiche Telefonnummer verwenden, von der Sie anrufen?',
        'Möchten Sie diese Telefonnummer verwenden, um Ihre Reservierung zu finden, oder haben Sie eine andere?',
        'Möchten Sie mit dieser Nummer nach Ihrer Reservierung suchen oder bevorzugen Sie eine andere?',
        'Sollen wir dieses Telefon verwenden, um Ihre Reservierung zu finden, oder haben Sie eine andere Nummer?',
        'Möchten Sie mit dieser Telefonnummer nach der Reservierung suchen?'
      ],
      it: [
        'Per modificare la sua prenotazione, vuole usare lo stesso numero di telefono da cui sta chiamando?',
        'Vuole usare questo numero di telefono per trovare la sua prenotazione o ne ha un altro?',
        'Vuole cercare la sua prenotazione con questo numero o preferisce usare un altro?',
        'Usiamo questo telefono per trovare la sua prenotazione o ha un altro numero?',
        'Vuole cercare la prenotazione con questo numero di telefono?'
      ],
      fr: [
        'Pour modifier votre réservation, souhaitez-vous utiliser le même numéro de téléphone depuis lequel vous appelez?',
        'Voulez-vous utiliser ce numéro de téléphone pour trouver votre réservation ou en avez-vous un autre?',
        'Voulez-vous rechercher votre réservation avec ce numéro ou préférez-vous en utiliser un autre?',
        'Utilisons-nous ce téléphone pour trouver votre réservation ou avez-vous un autre numéro?',
        'Voulez-vous rechercher la réservation avec ce numéro de téléphone?'
      ],
      pt: [
        'Para modificar sua reserva, deseja usar o mesmo número de telefone de onde está ligando?',
        'Quer usar este número de telefone para encontrar sua reserva ou tem outro?',
        'Quer buscar sua reserva com este número ou prefere usar outro?',
        'Usamos este telefone para encontrar sua reserva ou você tem outro número?',
        'Quer buscar a reserva com este número de telefone?'
      ]
    },
    modify_ask_phone: {
      es: [
        'Perfecto. ¿Cuál es el número de teléfono con el que hizo la reserva?',
        'Por favor, dígame el número de teléfono de la reserva que desea modificar.',
        '¿Puede indicarme el número de teléfono asociado a su reserva?',
        'Necesito el número de teléfono con el que hizo la reserva. ¿Cuál es?',
        'Por favor, proporcione el número de teléfono de su reserva.'
      ],
      en: [
        'Perfect. What is the phone number you used for the reservation?',
        'Please tell me the phone number of the reservation you want to modify.',
        'Can you give me the phone number associated with your reservation?',
        'I need the phone number you used for the reservation. What is it?',
        'Please provide the phone number of your reservation.'
      ],
      de: [
        'Perfekt. Wie lautet die Telefonnummer, die Sie für die Reservierung verwendet haben?',
        'Bitte sagen Sie mir die Telefonnummer der Reservierung, die Sie ändern möchten.',
        'Können Sie mir die mit Ihrer Reservierung verbundene Telefonnummer geben?',
        'Ich brauche die Telefonnummer, die Sie für die Reservierung verwendet haben. Wie lautet sie?',
        'Bitte geben Sie die Telefonnummer Ihrer Reservierung an.'
      ],
      it: [
        'Perfetto. Qual è il numero di telefono che ha usato per la prenotazione?',
        'Per favore, mi dica il numero di telefono della prenotazione che desidera modificare.',
        'Può darmi il numero di telefono associato alla sua prenotazione?',
        'Ho bisogno del numero di telefono che ha usato per la prenotazione. Qual è?',
        'Per favore, fornisca il numero di telefono della sua prenotazione.'
      ],
      fr: [
        'Parfait. Quel est le numéro de téléphone que vous avez utilisé pour la réservation?',
        'Veuillez me donner le numéro de téléphone de la réservation que vous souhaitez modifier.',
        'Pouvez-vous me donner le numéro de téléphone associé à votre réservation?',
        'J\'ai besoin du numéro de téléphone que vous avez utilisé pour la réservation. Quel est-il?',
        'Veuillez fournir le numéro de téléphone de votre réservation.'
      ],
      pt: [
        'Perfeito. Qual é o número de telefone que você usou para a reserva?',
        'Por favor, me diga o número de telefone da reserva que deseja modificar.',
        'Pode me dar o número de telefone associado à sua reserva?',
        'Preciso do número de telefone que você usou para a reserva. Qual é?',
        'Por favor, forneça o número de telefone da sua reserva.'
      ]
    },
    modify_show_single: {
      es: [
        'He encontrado su reserva:',
        'Perfecto, he localizado su reserva:',
        'Excelente, he encontrado su reserva:',
        'Muy bien, aquí está su reserva:',
        'Perfecto, aquí tiene su reserva:'
      ],
      en: [
        'I found your reservation:',
        'Perfect, I located your reservation:',
        'Excellent, I found your reservation:',
        'Very well, here is your reservation:',
        'Perfect, here is your reservation:'
      ],
      de: [
        'Ich habe Ihre Reservierung gefunden:',
        'Perfekt, ich habe Ihre Reservierung gefunden:',
        'Ausgezeichnet, ich habe Ihre Reservierung gefunden:',
        'Sehr gut, hier ist Ihre Reservierung:',
        'Perfekt, hier ist Ihre Reservierung:'
      ],
      it: [
        'Ho trovato la sua prenotazione:',
        'Perfetto, ho localizzato la sua prenotazione:',
        'Eccellente, ho trovato la sua prenotazione:',
        'Molto bene, ecco la sua prenotazione:',
        'Perfetto, ecco la sua prenotazione:'
      ],
      fr: [
        'J\'ai trouvé votre réservation:',
        'Parfait, j\'ai localisé votre réservation:',
        'Excellent, j\'ai trouvé votre réservation:',
        'Très bien, voici votre réservation:',
        'Parfait, voici votre réservation:'
      ],
      pt: [
        'Encontrei sua reserva:',
        'Perfeito, localizei sua reserva:',
        'Excelente, encontrei sua reserva:',
        'Muito bem, aqui está sua reserva:',
        'Perfeito, aqui está sua reserva:'
      ]
    },
    modify_show_multiple: {
      es: [
        'He encontrado varias reservas a su nombre:',
        'Perfecto, he localizado múltiples reservas:',
        'Excelente, he encontrado varias reservas:',
        'Muy bien, aquí están sus reservas:',
        'Perfecto, aquí tiene sus reservas:'
      ],
      en: [
        'I found several reservations under your name:',
        'Perfect, I located multiple reservations:',
        'Excellent, I found several reservations:',
        'Very well, here are your reservations:',
        'Perfect, here are your reservations:'
      ],
      de: [
        'Ich habe mehrere Reservierungen unter Ihrem Namen gefunden:',
        'Perfekt, ich habe mehrere Reservierungen gefunden:',
        'Ausgezeichnet, ich habe mehrere Reservierungen gefunden:',
        'Sehr gut, hier sind Ihre Reservierungen:',
        'Perfekt, hier sind Ihre Reservierungen:'
      ],
      it: [
        'Ho trovato diverse prenotazioni a suo nome:',
        'Perfetto, ho localizzato più prenotazioni:',
        'Eccellente, ho trovato diverse prenotazioni:',
        'Molto bene, ecco le sue prenotazioni:',
        'Perfetto, ecco le sue prenotazioni:'
      ],
      fr: [
        'J\'ai trouvé plusieurs réservations à votre nom:',
        'Parfait, j\'ai localisé plusieurs réservations:',
        'Excellent, j\'ai trouvé plusieurs réservations:',
        'Très bien, voici vos réservations:',
        'Parfait, voici vos réservations:'
      ],
      pt: [
        'Encontrei várias reservas em seu nome:',
        'Perfeito, localizei múltiplas reservas:',
        'Excelente, encontrei várias reservas:',
        'Muito bem, aqui estão suas reservas:',
        'Perfeito, aqui estão suas reservas:'
      ]
    },
    modify_choose_option: {
      es: [
        'Por favor, dígame qué opción desea modificar. Puede decir "opción 1", "opción 2", etc.',
        '¿Cuál de estas reservas desea modificar? Diga el número de la opción.',
        'Por favor, indique qué reserva quiere modificar. Diga "primera", "segunda", etc.',
        '¿Qué opción desea modificar? Puede decir el número de la opción.',
        'Por favor, elija qué reserva modificar. Diga el número correspondiente.'
      ],
      en: [
        'Please tell me which option you want to modify. You can say "option 1", "option 2", etc.',
        'Which of these reservations do you want to modify? Say the option number.',
        'Please indicate which reservation you want to modify. Say "first", "second", etc.',
        'Which option do you want to modify? You can say the option number.',
        'Please choose which reservation to modify. Say the corresponding number.'
      ],
      de: [
        'Bitte sagen Sie mir, welche Option Sie ändern möchten. Sie können "Option 1", "Option 2" usw. sagen.',
        'Welche dieser Reservierungen möchten Sie ändern? Sagen Sie die Optionsnummer.',
        'Bitte geben Sie an, welche Reservierung Sie ändern möchten. Sagen Sie "erste", "zweite" usw.',
        'Welche Option möchten Sie ändern? Sie können die Optionsnummer sagen.',
        'Bitte wählen Sie, welche Reservierung geändert werden soll. Sagen Sie die entsprechende Nummer.'
      ],
      it: [
        'Per favore, dimmi quale opzione vuoi modificare. Puoi dire "opzione 1", "opzione 2", ecc.',
        'Quale di queste prenotazioni vuoi modificare? Di\' il numero dell\'opzione.',
        'Per favore, indica quale prenotazione vuoi modificare. Di\' "prima", "seconda", ecc.',
        'Quale opzione vuoi modificare? Puoi dire il numero dell\'opzione.',
        'Per favore, scegli quale prenotazione modificare. Di\' il numero corrispondente.'
      ],
      fr: [
        'Veuillez me dire quelle option vous voulez modifier. Vous pouvez dire "option 1", "option 2", etc.',
        'Laquelle de ces réservations voulez-vous modifier? Dites le numéro de l\'option.',
        'Veuillez indiquer quelle réservation vous voulez modifier. Dites "première", "deuxième", etc.',
        'Quelle option voulez-vous modifier? Vous pouvez dire le numéro de l\'option.',
        'Veuillez choisir quelle réservation modifier. Dites le numéro correspondant.'
      ],
      pt: [
        'Por favor, me diga qual opção você quer modificar. Você pode dizer "opção 1", "opção 2", etc.',
        'Qual dessas reservas você quer modificar? Diga o número da opção.',
        'Por favor, indique qual reserva você quer modificar. Diga "primeira", "segunda", etc.',
        'Qual opção você quer modificar? Você pode dizer o número da opção.',
        'Por favor, escolha qual reserva modificar. Diga o número correspondente.'
      ]
    },
    modify_ask_field: {
      es: [
        '¿Qué desea modificar? Puede decir el nombre, la fecha, la hora o el número de personas.',
        '¿Qué campo quiere cambiar? Nombre, fecha, hora o número de personas.',
        'Por favor, indique qué quiere modificar: nombre, fecha, hora o personas.',
        '¿Qué parte de la reserva desea cambiar? Puede elegir nombre, fecha, hora o personas.',
        'Dígame qué quiere modificar: nombre, fecha, hora o número de personas.'
      ],
      en: [
        'What do you want to modify? You can say name, date, time, or number of people.',
        'What field do you want to change? Name, date, time, or number of people.',
        'Please indicate what you want to modify: name, date, time, or people.',
        'What part of the reservation do you want to change? You can choose name, date, time, or people.',
        'Tell me what you want to modify: name, date, time, or number of people.'
      ],
      de: [
        'Was möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Anzahl der Personen sagen.',
        'Welches Feld möchten Sie ändern? Name, Datum, Uhrzeit oder Anzahl der Personen.',
        'Bitte geben Sie an, was Sie ändern möchten: Name, Datum, Uhrzeit oder Personen.',
        'Welchen Teil der Reservierung möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Personen wählen.',
        'Sagen Sie mir, was Sie ändern möchten: Name, Datum, Uhrzeit oder Anzahl der Personen.'
      ],
      it: [
        'Cosa vuole modificare? Può dire nome, data, ora o numero di persone.',
        'Quale campo vuole cambiare? Nome, data, ora o numero di persone.',
        'Per favore, indichi cosa vuole modificare: nome, data, ora o persone.',
        'Quale parte della prenotazione vuole cambiare? Può scegliere nome, data, ora o persone.',
        'Mi dica cosa vuole modificare: nome, data, ora o numero di persone.'
      ],
      fr: [
        'Que souhaitez-vous modifier? Vous pouvez dire nom, date, heure ou nombre de personnes.',
        'Quel champ voulez-vous changer? Nom, date, heure ou nombre de personnes.',
        'Veuillez indiquer ce que vous voulez modifier: nom, date, heure ou personnes.',
        'Quelle partie de la réservation voulez-vous changer? Vous pouvez choisir nom, date, heure ou personnes.',
        'Dites-moi ce que vous voulez modifier: nom, date, heure ou nombre de personnes.'
      ],
      pt: [
        'O que você quer modificar? Pode dizer nome, data, hora ou número de pessoas.',
        'Qual campo você quer mudar? Nome, data, hora ou número de pessoas.',
        'Por favor, indique o que quer modificar: nome, data, hora ou pessoas.',
        'Qual parte da reserva você quer mudar? Pode escolher nome, data, hora ou pessoas.',
        'Me diga o que quer modificar: nome, data, hora ou número de pessoas.'
      ]
    },
    modify_unclear_field: {
      es: [
        'Disculpe, no entendí qué desea modificar. Por favor, diga nombre, fecha, hora o número de personas.',
        'No entendí bien. ¿Qué campo quiere cambiar? Puede decir nombre, fecha, hora o personas.',
        'Perdón, no capté bien. Por favor, indique qué quiere modificar: nombre, fecha, hora o personas.',
        'No entendí. Por favor, diga claramente qué campo desea cambiar.',
        'Disculpe, no entendí. ¿Quiere modificar el nombre, la fecha, la hora o el número de personas?'
      ],
      en: [
        'Sorry, I didn\'t understand what you want to modify. Please say name, date, time, or number of people.',
        'I didn\'t understand well. What field do you want to change? You can say name, date, time, or people.',
        'Sorry, I didn\'t catch that. Please indicate what you want to modify: name, date, time, or people.',
        'I didn\'t understand. Please say clearly what field you want to change.',
        'Sorry, I didn\'t understand. Do you want to modify the name, date, time, or number of people?'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, was Sie ändern möchten. Bitte sagen Sie Name, Datum, Uhrzeit oder Anzahl der Personen.',
        'Ich verstand nicht gut. Welches Feld möchten Sie ändern? Sie können Name, Datum, Uhrzeit oder Personen sagen.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte geben Sie an, was Sie ändern möchten: Name, Datum, Uhrzeit oder Personen.',
        'Ich verstand nicht. Bitte sagen Sie deutlich, welches Feld Sie ändern möchten.',
        'Entschuldigung, ich verstand nicht. Möchten Sie den Namen, das Datum, die Uhrzeit oder die Anzahl der Personen ändern?'
      ],
      it: [
        'Scusi, non ho capito cosa vuole modificare. Per favore, dica nome, data, ora o numero di persone.',
        'Non ho capito bene. Quale campo vuole cambiare? Può dire nome, data, ora o persone.',
        'Scusi, non ho capito. Per favore, indichi cosa vuole modificare: nome, data, ora o persone.',
        'Non ho capito. Per favore, dica chiaramente quale campo desidera cambiare.',
        'Scusi, non ho capito. Vuole modificare il nome, la data, l\'ora o il numero di persone?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris ce que vous voulez modifier. Veuillez dire nom, date, heure ou nombre de personnes.',
        'Je n\'ai pas bien compris. Quel champ voulez-vous changer? Vous pouvez dire nom, date, heure ou personnes.',
        'Désolé, je n\'ai pas saisi. Veuillez indiquer ce que vous voulez modifier: nom, date, heure ou personnes.',
        'Je n\'ai pas compris. Veuillez dire clairement quel champ vous voulez changer.',
        'Désolé, je n\'ai pas compris. Voulez-vous modifier le nom, la date, l\'heure ou le nombre de personnes?'
      ],
      pt: [
        'Desculpe, não entendi o que você quer modificar. Por favor, diga nome, data, hora ou número de pessoas.',
        'Não entendi bem. Qual campo você quer mudar? Pode dizer nome, data, hora ou pessoas.',
        'Desculpe, não entendi. Por favor, indique o que quer modificar: nome, data, hora ou pessoas.',
        'Não entendi. Por favor, diga claramente qual campo deseja mudar.',
        'Desculpe, não entendi. Quer modificar o nome, a data, a hora ou o número de pessoas?'
      ]
    },
    modify_ask_value: {
      es: [
        'Perfecto. ¿Cuál es el nuevo valor que desea?',
        'Excelente. ¿Qué nuevo valor prefiere?',
        'Muy bien. ¿Cuál será el nuevo valor?',
        'Perfecto. Por favor, indique el nuevo valor.',
        'Excelente. ¿Qué valor quiere establecer?'
      ],
      en: [
        'Perfect. What is the new value you want?',
        'Excellent. What new value do you prefer?',
        'Very well. What will be the new value?',
        'Perfect. Please indicate the new value.',
        'Excellent. What value do you want to set?'
      ],
      de: [
        'Perfekt. Wie lautet der neue Wert, den Sie möchten?',
        'Ausgezeichnet. Welchen neuen Wert bevorzugen Sie?',
        'Sehr gut. Wie lautet der neue Wert?',
        'Perfekt. Bitte geben Sie den neuen Wert an.',
        'Ausgezeichnet. Welchen Wert möchten Sie festlegen?'
      ],
      it: [
        'Perfetto. Qual è il nuovo valore che desidera?',
        'Eccellente. Quale nuovo valore preferisce?',
        'Molto bene. Quale sarà il nuovo valore?',
        'Perfetto. Per favore, indichi il nuovo valore.',
        'Eccellente. Quale valore vuole impostare?'
      ],
      fr: [
        'Parfait. Quelle est la nouvelle valeur que vous voulez?',
        'Excellent. Quelle nouvelle valeur préférez-vous?',
        'Très bien. Quelle sera la nouvelle valeur?',
        'Parfait. Veuillez indiquer la nouvelle valeur.',
        'Excellent. Quelle valeur voulez-vous définir?'
      ],
      pt: [
        'Perfeito. Qual é o novo valor que deseja?',
        'Excelente. Qual novo valor você prefere?',
        'Muito bem. Qual será o novo valor?',
        'Perfeito. Por favor, indique o novo valor.',
        'Excelente. Qual valor você quer definir?'
      ]
    },
    modify_unclear_value: {
      es: [
        'Disculpe, no entendí el nuevo valor. Por favor, repítalo.',
        'No entendí bien. ¿Puede indicar el nuevo valor de nuevo?',
        'Perdón, no capté bien. Por favor, diga el nuevo valor claramente.',
        'No entendí. Por favor, proporcione el nuevo valor.',
        'Disculpe, no entendí. ¿Cuál es el nuevo valor que desea?'
      ],
      en: [
        'Sorry, I didn\'t understand the new value. Please repeat it.',
        'I didn\'t understand well. Can you indicate the new value again?',
        'Sorry, I didn\'t catch that. Please say the new value clearly.',
        'I didn\'t understand. Please provide the new value.',
        'Sorry, I didn\'t understand. What is the new value you want?'
      ],
      de: [
        'Entschuldigung, ich verstand den neuen Wert nicht. Bitte wiederholen Sie ihn.',
        'Ich verstand nicht gut. Können Sie den neuen Wert noch einmal angeben?',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie den neuen Wert deutlich.',
        'Ich verstand nicht. Bitte geben Sie den neuen Wert an.',
        'Entschuldigung, ich verstand nicht. Wie lautet der neue Wert, den Sie möchten?'
      ],
      it: [
        'Scusi, non ho capito il nuovo valore. Per favore, lo ripeta.',
        'Non ho capito bene. Può indicare il nuovo valore di nuovo?',
        'Scusi, non ho capito. Per favore, dica il nuovo valore chiaramente.',
        'Non ho capito. Per favore, fornisca il nuovo valore.',
        'Scusi, non ho capito. Qual è il nuovo valore che desidera?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris la nouvelle valeur. Veuillez la répéter.',
        'Je n\'ai pas bien compris. Pouvez-vous indiquer la nouvelle valeur à nouveau?',
        'Désolé, je n\'ai pas saisi. Veuillez dire la nouvelle valeur clairement.',
        'Je n\'ai pas compris. Veuillez fournir la nouvelle valeur.',
        'Désolé, je n\'ai pas compris. Quelle est la nouvelle valeur que vous voulez?'
      ],
      pt: [
        'Desculpe, não entendi o novo valor. Por favor, repita.',
        'Não entendi bem. Pode indicar o novo valor novamente?',
        'Desculpe, não entendi. Por favor, diga o novo valor claramente.',
        'Não entendi. Por favor, forneça o novo valor.',
        'Desculpe, não entendi. Qual é o novo valor que deseja?'
      ]
    },
    modify_confirm: {
      es: [
        'Perfecto. Voy a cambiar el campo. ¿Está de acuerdo?',
        'Excelente. Cambiaré el campo. ¿Confirma?',
        'Muy bien. Modificaré el campo. ¿Le parece bien?',
        'Perfecto. Actualizaré el campo. ¿Está de acuerdo?',
        'Excelente. Cambiaré el campo. ¿Confirma esta modificación?'
      ],
      en: [
        'Perfect. I will change the field. Do you agree?',
        'Excellent. I will change the field. Do you confirm?',
        'Very well. I will modify the field. Does that seem good?',
        'Perfect. I will update the field. Do you agree?',
        'Excellent. I will change the field. Do you confirm this modification?'
      ],
      de: [
        'Perfekt. Ich werde das Feld ändern. Sind Sie einverstanden?',
        'Ausgezeichnet. Ich werde das Feld ändern. Bestätigen Sie?',
        'Sehr gut. Ich werde das Feld ändern. Scheint Ihnen das gut?',
        'Perfekt. Ich werde das Feld aktualisieren. Sind Sie einverstanden?',
        'Ausgezeichnet. Ich werde das Feld ändern. Bestätigen Sie diese Änderung?'
      ],
      it: [
        'Perfetto. Cambierò il campo. È d\'accordo?',
        'Eccellente. Cambierò il campo. Conferma?',
        'Molto bene. Modificherò il campo. Le va bene?',
        'Perfetto. Aggiornerò il campo. È d\'accordo?',
        'Eccellente. Cambierò il campo. Conferma questa modifica?'
      ],
      fr: [
        'Parfait. Je vais changer le champ. Êtes-vous d\'accord?',
        'Excellent. Je vais changer le champ. Confirmez-vous?',
        'Très bien. Je vais modifier le champ. Cela vous semble-t-il bien?',
        'Parfait. Je vais mettre à jour le champ. Êtes-vous d\'accord?',
        'Excellent. Je vais changer le champ. Confirmez-vous cette modification?'
      ],
      pt: [
        'Perfeito. Vou mudar o campo. Está de acordo?',
        'Excelente. Vou mudar o campo. Confirma?',
        'Muito bem. Vou modificar o campo. Parece bom?',
        'Perfeito. Vou atualizar o campo. Está de acordo?',
        'Excelente. Vou mudar o campo. Confirma esta modificação?'
      ]
    },
    modify_unclear_confirmation: {
      es: [
        'Disculpe, no entendí bien su respuesta. ¿Desea confirmar la modificación o no?',
        'No entendí claramente. Por favor, diga "sí" para confirmar o "no" para cancelar la modificación.',
        'Perdón, no capté bien. ¿Confirma que quiere realizar esta modificación?',
        'No entendí. Por favor, responda claramente: ¿sí o no?',
        'Disculpe, no entendí. ¿Quiere confirmar la modificación?'
      ],
      en: [
        'Sorry, I didn\'t understand your response well. Do you want to confirm the modification or not?',
        'I didn\'t understand clearly. Please say "yes" to confirm or "no" to cancel the modification.',
        'Sorry, I didn\'t catch that. Do you confirm you want to make this modification?',
        'I didn\'t understand. Please answer clearly: yes or no?',
        'Sorry, I didn\'t understand. Do you want to confirm the modification?'
      ],
      de: [
        'Entschuldigung, ich verstand Ihre Antwort nicht gut. Möchten Sie die Änderung bestätigen oder nicht?',
        'Ich verstand nicht klar. Bitte sagen Sie "ja" zum Bestätigen oder "nein" zum Abbrechen der Änderung.',
        'Entschuldigung, ich habe das nicht verstanden. Bestätigen Sie, dass Sie diese Änderung vornehmen möchten?',
        'Ich verstand nicht. Bitte antworten Sie klar: ja oder nein?',
        'Entschuldigung, ich verstand nicht. Möchten Sie die Änderung bestätigen?'
      ],
      it: [
        'Scusi, non ho capito bene la sua risposta. Vuole confermare la modifica o no?',
        'Non ho capito chiaramente. Per favore, dica "sì" per confermare o "no" per annullare la modifica.',
        'Scusi, non ho capito. Conferma di voler fare questa modifica?',
        'Non ho capito. Per favore, risponda chiaramente: sì o no?',
        'Scusi, non ho capito. Vuole confermare la modifica?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre réponse. Voulez-vous confirmer la modification ou non?',
        'Je n\'ai pas compris clairement. Veuillez dire "oui" pour confirmer ou "non" pour annuler la modification.',
        'Désolé, je n\'ai pas saisi. Confirmez-vous que vous voulez faire cette modification?',
        'Je n\'ai pas compris. Veuillez répondre clairement: oui ou non?',
        'Désolé, je n\'ai pas compris. Voulez-vous confirmer la modification?'
      ],
      pt: [
        'Desculpe, não entendi bem sua resposta. Quer confirmar a modificação ou não?',
        'Não entendi claramente. Por favor, diga "sim" para confirmar ou "não" para cancelar a modificação.',
        'Desculpe, não entendi. Confirma que quer fazer esta modificação?',
        'Não entendi. Por favor, responda claramente: sim ou não?',
        'Desculpe, não entendi. Quer confirmar a modificação?'
      ]
    },
    modify_success: {
      es: [
        '¡Perfecto! Su reserva ha sido modificada exitosamente. Le esperamos. ¡Buen día!',
        '¡Excelente! La modificación se ha completado. Les esperamos. ¡Que tengan buen día!',
        '¡Muy bien! Reserva actualizada correctamente. Nos vemos pronto. ¡Hasta pronto!',
        '¡Genial! Modificación realizada con éxito. Les esperamos. ¡Buen día!',
        '¡Perfecto! Todo actualizado. Les esperamos. ¡Que disfruten!'
      ],
      en: [
        'Perfect! Your reservation has been successfully modified. We look forward to seeing you. Good day!',
        'Excellent! The modification has been completed. We look forward to seeing you. Have a good day!',
        'Very well! Reservation updated correctly. See you soon. Goodbye!',
        'Great! Modification completed successfully. We look forward to seeing you. Good day!',
        'Perfect! Everything updated. We look forward to seeing you. Enjoy!'
      ],
      de: [
        'Perfekt! Ihre Reservierung wurde erfolgreich geändert. Wir freuen uns auf Sie. Guten Tag!',
        'Ausgezeichnet! Die Änderung wurde abgeschlossen. Wir freuen uns auf Sie. Haben Sie einen schönen Tag!',
        'Sehr gut! Reservierung korrekt aktualisiert. Bis bald. Auf Wiedersehen!',
        'Großartig! Änderung erfolgreich durchgeführt. Wir freuen uns auf Sie. Guten Tag!',
        'Perfekt! Alles aktualisiert. Wir freuen uns auf Sie. Viel Spaß!'
      ],
      it: [
        'Perfetto! La sua prenotazione è stata modificata con successo. La aspettiamo. Buona giornata!',
        'Eccellente! La modifica è stata completata. La aspettiamo. Buona giornata!',
        'Molto bene! Prenotazione aggiornata correttamente. A presto. Arrivederci!',
        'Fantastico! Modifica completata con successo. La aspettiamo. Buona giornata!',
        'Perfetto! Tutto aggiornato. La aspettiamo. Buon divertimento!'
      ],
      fr: [
        'Parfait! Votre réservation a été modifiée avec succès. Nous avons hâte de vous voir. Bonne journée!',
        'Excellent! La modification a été complétée. Nous avons hâte de vous voir. Bonne journée!',
        'Très bien! Réservation mise à jour correctement. À bientôt. Au revoir!',
        'Génial! Modification complétée avec succès. Nous avons hâte de vous voir. Bonne journée!',
        'Parfait! Tout mis à jour. Nous avons hâte de vous voir. Profitez bien!'
      ],
      pt: [
        'Perfeito! Sua reserva foi modificada com sucesso. Esperamos você. Bom dia!',
        'Excelente! A modificação foi concluída. Esperamos você. Tenha um bom dia!',
        'Muito bem! Reserva atualizada corretamente. Até logo. Tchau!',
        'Ótimo! Modificação concluída com sucesso. Esperamos você. Bom dia!',
        'Perfeito! Tudo atualizado. Esperamos você. Aproveite!'
      ]
    },
    modify_error: {
      es: [
        'Disculpe, hubo un error al modificar su reserva. Por favor, intente de nuevo más tarde o contacte directamente al restaurante.',
        'Lo siento, no se pudo completar la modificación. Por favor, intente nuevamente o llame al restaurante.',
        'Perdón, ocurrió un problema al actualizar la reserva. Por favor, contacte directamente al restaurante.',
        'Disculpe, hubo un error técnico. Por favor, intente de nuevo o contacte al restaurante.',
        'Lo siento, no se pudo procesar la modificación. Por favor, contacte al restaurante directamente.'
      ],
      en: [
        'Sorry, there was an error modifying your reservation. Please try again later or contact the restaurant directly.',
        'I\'m sorry, the modification could not be completed. Please try again or call the restaurant.',
        'Sorry, a problem occurred while updating the reservation. Please contact the restaurant directly.',
        'Sorry, there was a technical error. Please try again or contact the restaurant.',
        'I\'m sorry, the modification could not be processed. Please contact the restaurant directly.'
      ],
      de: [
        'Entschuldigung, es gab einen Fehler beim Ändern Ihrer Reservierung. Bitte versuchen Sie es später erneut oder kontaktieren Sie das Restaurant direkt.',
        'Es tut mir leid, die Änderung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut oder rufen Sie das Restaurant an.',
        'Entschuldigung, es trat ein Problem beim Aktualisieren der Reservierung auf. Bitte kontaktieren Sie das Restaurant direkt.',
        'Entschuldigung, es gab einen technischen Fehler. Bitte versuchen Sie es erneut oder kontaktieren Sie das Restaurant.',
        'Es tut mir leid, die Änderung konnte nicht verarbeitet werden. Bitte kontaktieren Sie das Restaurant direkt.'
      ],
      it: [
        'Scusi, c\'è stato un errore nella modifica della sua prenotazione. Per favore, riprovi più tardi o contatti direttamente il ristorante.',
        'Mi dispiace, la modifica non è stata completata. Per favore, riprovi o chiami il ristorante.',
        'Scusi, si è verificato un problema nell\'aggiornamento della prenotazione. Per favore, contatti direttamente il ristorante.',
        'Scusi, c\'è stato un errore tecnico. Per favore, riprovi o contatti il ristorante.',
        'Mi dispiace, la modifica non è stata elaborata. Per favore, contatti direttamente il ristorante.'
      ],
      fr: [
        'Désolé, une erreur s\'est produite lors de la modification de votre réservation. Veuillez réessayer plus tard ou contacter directement le restaurant.',
        'Je suis désolé, la modification n\'a pas pu être complétée. Veuillez réessayer ou appeler le restaurant.',
        'Désolé, un problème s\'est produit lors de la mise à jour de la réservation. Veuillez contacter directement le restaurant.',
        'Désolé, une erreur technique s\'est produite. Veuillez réessayer ou contacter le restaurant.',
        'Je suis désolé, la modification n\'a pas pu être traitée. Veuillez contacter directement le restaurant.'
      ],
      pt: [
        'Desculpe, houve um erro ao modificar sua reserva. Por favor, tente novamente mais tarde ou entre em contato diretamente com o restaurante.',
        'Sinto muito, a modificação não pôde ser concluída. Por favor, tente novamente ou ligue para o restaurante.',
        'Desculpe, ocorreu um problema ao atualizar a reserva. Por favor, entre em contato diretamente com o restaurante.',
        'Desculpe, houve um erro técnico. Por favor, tente novamente ou entre em contato com o restaurante.',
        'Sinto muito, a modificação não pôde ser processada. Por favor, entre em contato diretamente com o restaurante.'
      ]
    },
    modify_cancelled: {
      es: [
        'Perfecto, no modificaremos la reserva. ¿En qué más puedo ayudarle?',
        'Entendido, mantendremos la reserva sin cambios. ¿Qué más necesita?',
        'Muy bien, no procederemos con la modificación. ¿En qué puedo ayudarle?',
        'Perfecto, la reserva se mantiene como está. ¿Qué más puedo hacer por usted?',
        'Excelente, no modificaremos. ¿En qué puedo asistirle?'
      ],
      en: [
        'Perfect, we won\'t modify the reservation. How else can I help you?',
        'Understood, we\'ll keep the reservation unchanged. What else do you need?',
        'Very well, we won\'t proceed with the modification. How can I help you?',
        'Perfect, the reservation remains as is. What else can I do for you?',
        'Excellent, we won\'t modify. How can I assist you?'
      ],
      de: [
        'Perfekt, wir werden die Reservierung nicht ändern. Wie kann ich Ihnen sonst helfen?',
        'Verstanden, wir behalten die Reservierung unverändert. Was brauchen Sie sonst?',
        'Sehr gut, wir werden nicht mit der Änderung fortfahren. Wie kann ich Ihnen helfen?',
        'Perfekt, die Reservierung bleibt wie sie ist. Was kann ich sonst für Sie tun?',
        'Ausgezeichnet, wir werden nicht ändern. Wie kann ich Ihnen helfen?'
      ],
      it: [
        'Perfetto, non modificheremo la prenotazione. Come altro posso aiutarti?',
        'Capito, manterremo la prenotazione invariata. Cos\'altro ti serve?',
        'Molto bene, non procederemo con la modifica. Come posso aiutarti?',
        'Perfetto, la prenotazione rimane così com\'è. Cos\'altro posso fare per te?',
        'Eccellente, non modificheremo. Come posso assisterti?'
      ],
      fr: [
        'Parfait, nous ne modifierons pas la réservation. Comment puis-je vous aider d\'autre?',
        'Compris, nous garderons la réservation inchangée. De quoi avez-vous besoin d\'autre?',
        'Très bien, nous ne procéderons pas à la modification. Comment puis-je vous aider?',
        'Parfait, la réservation reste telle quelle. Que puis-je faire d\'autre pour vous?',
        'Excellent, nous ne modifierons pas. Comment puis-je vous assister?'
      ],
      pt: [
        'Perfeito, não modificaremos a reserva. Como mais posso ajudá-lo?',
        'Entendido, manteremos a reserva inalterada. O que mais você precisa?',
        'Muito bem, não procederemos com a modificação. Como posso ajudá-lo?',
        'Perfeito, a reserva permanece como está. O que mais posso fazer por você?',
        'Excelente, não modificaremos. Como posso assisti-lo?'
      ]
    },
    modify_no_reservations: {
      es: [
        'No encontré reservas activas con ese número de teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas registradas para ese número. ¿Quiere hacer una nueva reserva?',
        'No localicé reservas con ese teléfono. ¿Desea hacer una nueva reserva?',
        'No hay reservas activas para ese número. ¿Le gustaría reservar una mesa?',
        'No encontré reservas con ese teléfono. ¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'I didn\'t find any active reservations with that phone number. Would you like to make a new reservation?',
        'There are no reservations registered for that number. Do you want to make a new reservation?',
        'I didn\'t locate reservations with that phone. Do you want to make a new reservation?',
        'There are no active reservations for that number. Would you like to reserve a table?',
        'I didn\'t find reservations with that phone. Do you want to make a new reservation?'
      ],
      de: [
        'Ich habe keine aktiven Reservierungen mit dieser Telefonnummer gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine Reservierungen für diese Nummer. Möchten Sie eine neue Reservierung vornehmen?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?',
        'Es gibt keine aktiven Reservierungen für diese Nummer. Möchten Sie einen Tisch reservieren?',
        'Ich habe keine Reservierungen mit diesem Telefon gefunden. Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Non ho trovato prenotazioni attive con quel numero di telefono. Vorresti fare una nuova prenotazione?',
        'Non ci sono prenotazioni registrate per quel numero. Vuoi fare una nuova prenotazione?',
        'Non ho localizzato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?',
        'Non ci sono prenotazioni attive per quel numero. Vorresti prenotare un tavolo?',
        'Non ho trovato prenotazioni con quel telefono. Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Je n\'ai trouvé aucune réservation active avec ce numéro de téléphone. Souhaitez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations enregistrées pour ce numéro. Voulez-vous faire une nouvelle réservation?',
        'Je n\'ai pas localisé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?',
        'Il n\'y a pas de réservations actives pour ce numéro. Souhaitez-vous réserver une table?',
        'Je n\'ai pas trouvé de réservations avec ce téléphone. Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Não encontrei reservas ativas com esse número de telefone. Gostaria de fazer uma nova reserva?',
        'Não há reservas registradas para esse número. Quer fazer uma nova reserva?',
        'Não localizei reservas com esse telefone. Quer fazer uma nova reserva?',
        'Não há reservas ativas para esse número. Gostaria de reservar uma mesa?',
        'Não encontrei reservas com esse telefone. Quer fazer uma nova reserva?'
      ]
    },
    modify_offer_new: {
      es: [
        '¿Le gustaría hacer una nueva reserva en su lugar?',
        '¿Quiere hacer una nueva reserva?',
        '¿Desea reservar una mesa?',
        '¿Le gustaría hacer una reserva?',
        '¿Quiere hacer una nueva reserva?'
      ],
      en: [
        'Would you like to make a new reservation instead?',
        'Do you want to make a new reservation?',
        'Do you want to reserve a table?',
        'Would you like to make a reservation?',
        'Do you want to make a new reservation?'
      ],
      de: [
        'Möchten Sie stattdessen eine neue Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?',
        'Möchten Sie einen Tisch reservieren?',
        'Möchten Sie eine Reservierung vornehmen?',
        'Möchten Sie eine neue Reservierung vornehmen?'
      ],
      it: [
        'Vorresti fare una nuova prenotazione invece?',
        'Vuoi fare una nuova prenotazione?',
        'Vuoi prenotare un tavolo?',
        'Vorresti fare una prenotazione?',
        'Vuoi fare una nuova prenotazione?'
      ],
      fr: [
        'Souhaitez-vous faire une nouvelle réservation à la place?',
        'Voulez-vous faire une nouvelle réservation?',
        'Voulez-vous réserver une table?',
        'Souhaitez-vous faire une réservation?',
        'Voulez-vous faire une nouvelle réservation?'
      ],
      pt: [
        'Gostaria de fazer uma nova reserva em vez disso?',
        'Quer fazer uma nova reserva?',
        'Quer reservar uma mesa?',
        'Gostaria de fazer uma reserva?',
        'Quer fazer uma nova reserva?'
      ]
    },
    modify_invalid_option: {
      es: [
        'Esa opción no es válida. Por favor, elija una de las opciones disponibles.',
        'Esa opción no existe. Por favor, seleccione una opción válida.',
        'Opción incorrecta. Por favor, elija entre las opciones mostradas.',
        'Esa opción no está disponible. Por favor, seleccione una opción válida.',
        'Opción no válida. Por favor, elija una de las opciones correctas.'
      ],
      en: [
        'That option is not valid. Please choose one of the available options.',
        'That option doesn\'t exist. Please select a valid option.',
        'Incorrect option. Please choose from the options shown.',
        'That option is not available. Please select a valid option.',
        'Invalid option. Please choose one of the correct options.'
      ],
      de: [
        'Diese Option ist nicht gültig. Bitte wählen Sie eine der verfügbaren Optionen.',
        'Diese Option existiert nicht. Bitte wählen Sie eine gültige Option.',
        'Falsche Option. Bitte wählen Sie aus den gezeigten Optionen.',
        'Diese Option ist nicht verfügbar. Bitte wählen Sie eine gültige Option.',
        'Ungültige Option. Bitte wählen Sie eine der korrekten Optionen.'
      ],
      it: [
        'Quell\'opzione non è valida. Per favore, scegli una delle opzioni disponibili.',
        'Quell\'opzione non esiste. Per favore, seleziona un\'opzione valida.',
        'Opzione incorretta. Per favore, scegli tra le opzioni mostrate.',
        'Quell\'opzione non è disponibile. Per favore, seleziona un\'opzione valida.',
        'Opzione non valida. Per favore, scegli una delle opzioni corrette.'
      ],
      fr: [
        'Cette option n\'est pas valide. Veuillez choisir une des options disponibles.',
        'Cette option n\'existe pas. Veuillez sélectionner une option valide.',
        'Option incorrecte. Veuillez choisir parmi les options affichées.',
        'Cette option n\'est pas disponible. Veuillez sélectionner une option valide.',
        'Option non valide. Veuillez choisir une des options correctes.'
      ],
      pt: [
        'Essa opção não é válida. Por favor, escolha uma das opções disponíveis.',
        'Essa opção não existe. Por favor, selecione uma opção válida.',
        'Opção incorreta. Por favor, escolha entre as opções mostradas.',
        'Essa opção não está disponível. Por favor, selecione uma opção válida.',
        'Opção inválida. Por favor, escolha uma das opções corretas.'
      ]
    },
    modify_unclear_option: {
      es: [
        'Disculpe, no entendí qué opción desea. Por favor, diga el número de la opción que quiere modificar.',
        'No entendí bien. Por favor, indique el número de la opción que desea modificar.',
        'Perdón, no capté bien. Por favor, diga "opción 1", "opción 2", etc.',
        'No entendí. Por favor, repita el número de la opción que quiere modificar.',
        'Disculpe, no entendí. Por favor, diga claramente el número de la opción.'
      ],
      en: [
        'Sorry, I didn\'t understand which option you want. Please say the number of the option you want to modify.',
        'I didn\'t understand well. Please indicate the number of the option you want to modify.',
        'Sorry, I didn\'t catch that. Please say "option 1", "option 2", etc.',
        'I didn\'t understand. Please repeat the number of the option you want to modify.',
        'Sorry, I didn\'t understand. Please say the option number clearly.'
      ],
      de: [
        'Entschuldigung, ich verstand nicht, welche Option Sie möchten. Bitte sagen Sie die Nummer der Option, die Sie ändern möchten.',
        'Ich verstand nicht gut. Bitte geben Sie die Nummer der Option an, die Sie ändern möchten.',
        'Entschuldigung, ich habe das nicht verstanden. Bitte sagen Sie "Option 1", "Option 2" usw.',
        'Ich verstand nicht. Bitte wiederholen Sie die Nummer der Option, die Sie ändern möchten.',
        'Entschuldigung, ich verstand nicht. Bitte sagen Sie die Optionsnummer deutlich.'
      ],
      it: [
        'Scusi, non ho capito quale opzione vuole. Per favore, dica il numero dell\'opzione che vuole modificare.',
        'Non ho capito bene. Per favore, indichi il numero dell\'opzione che vuole modificare.',
        'Scusi, non ho capito. Per favore, dica "opzione 1", "opzione 2", ecc.',
        'Non ho capito. Per favore, ripeta il numero dell\'opzione che vuole modificare.',
        'Scusi, non ho capito. Per favore, dica chiaramente il numero dell\'opzione.'
      ],
      fr: [
        'Désolé, je n\'ai pas compris quelle option vous voulez. Veuillez dire le numéro de l\'option que vous voulez modifier.',
        'Je n\'ai pas bien compris. Veuillez indiquer le numéro de l\'option que vous voulez modifier.',
        'Désolé, je n\'ai pas saisi. Veuillez dire "option 1", "option 2", etc.',
        'Je n\'ai pas compris. Veuillez répéter le numéro de l\'option que vous voulez modifier.',
        'Désolé, je n\'ai pas compris. Veuillez dire clairement le numéro de l\'option.'
      ],
      pt: [
        'Desculpe, não entendi qual opção você quer. Por favor, diga o número da opção que quer modificar.',
        'Não entendi bem. Por favor, indique o número da opção que quer modificar.',
        'Desculpe, não entendi. Por favor, diga "opção 1", "opção 2", etc.',
        'Não entendi. Por favor, repita o número da opção que quer modificar.',
        'Desculpe, não entendi. Por favor, diga claramente o número da opção.'
      ]
    },
    no_availability: {
      es: [
        'Disculpe, no hay disponibilidad para esa fecha y hora. ¿Le gustaría que le sugiera otros horarios?',
        'Lo siento, estamos completos en ese horario. ¿Puedo ofrecerle otras opciones?',
        'No tenemos disponibilidad en ese momento. ¿Quiere que le proponga otros horarios?',
        'Ese horario está completo. ¿Le parece bien otro horario?',
        'No hay mesas disponibles en ese momento. ¿Puedo sugerirle otras horas?'
      ],
      en: [
        'Sorry, there is no availability for that date and time. Would you like me to suggest other available times?',
        'I\'m sorry, we are full at that time. Can I offer you other options?',
        'We don\'t have availability at that time. Would you like me to propose alternative times?',
        'That time slot is full. Would another time work for you?',
        'No tables available at that time. Can I suggest other times?'
      ],
      de: [
        'Entschuldigung, es gibt keine Verfügbarkeit für dieses Datum und diese Uhrzeit. Möchten Sie, dass ich andere verfügbare Zeiten vorschlage?',
        'Es tut mir leid, wir sind zu dieser Zeit voll. Kann ich Ihnen andere Optionen anbieten?',
        'Wir haben zu dieser Zeit keine Verfügbarkeit. Möchten Sie, dass ich alternative Zeiten vorschlage?',
        'Dieser Zeitraum ist voll. Würde eine andere Zeit für Sie funktionieren?',
        'Keine Tische zu dieser Zeit verfügbar. Kann ich andere Zeiten vorschlagen?'
      ],
      it: [
        'Scusi, non c\'è disponibilità per quella data e ora. Vuole che le suggerisca altri orari disponibili?',
        'Mi dispiace, siamo pieni a quell\'ora. Posso offrirle altre opzioni?',
        'Non abbiamo disponibilità a quell\'ora. Vuole che le proponga orari alternativi?',
        'Quell\'orario è completo. Le va bene un altro orario?',
        'Nessun tavolo disponibile a quell\'ora. Posso suggerirle altri orari?'
      ],
      fr: [
        'Désolé, il n\'y a pas de disponibilité pour cette date et cette heure. Souhaitez-vous que je vous suggère d\'autres heures disponibles?',
        'Je suis désolé, nous sommes complets à cette heure. Puis-je vous proposer d\'autres options?',
        'Nous n\'avons pas de disponibilité à cette heure. Souhaitez-vous que je vous propose des heures alternatives?',
        'Ce créneau horaire est complet. Une autre heure vous conviendrait-elle?',
        'Aucune table disponible à cette heure. Puis-je vous suggérer d\'autres heures?'
      ],
      pt: [
        'Desculpe, não há disponibilidade para essa data e hora. Gostaria que eu sugerisse outros horários disponíveis?',
        'Sinto muito, estamos lotados nesse horário. Posso oferecer outras opções?',
        'Não temos disponibilidade nesse horário. Quer que eu proponha horários alternativos?',
        'Esse horário está completo. Outro horário estaria bem?',
        'Nenhuma mesa disponível nesse horário. Posso sugerir outros horários?'
      ]
    },
    suggest_alternative: {
      es: [
        '¿Le parece bien a las {time}?',
        '¿Qué tal a las {time}?',
        'Tenemos disponibilidad a las {time}. ¿Le conviene?',
        'Podemos ofrecerle las {time}. ¿Le va bien?',
        '¿Le funciona a las {time}?',
        '¿A las {time} le viene bien?',
        '¿Qué le parece a las {time}?'
      ],
      en: [
        'Would {time} work for you?',
        'How about {time}?',
        'We have availability at {time}. Does that work for you?',
        'We can offer you {time}. Is that okay?',
        'Does {time} work for you?'
      ],
      de: [
        'Würde {time} für Sie funktionieren?',
        'Wie wäre es mit {time}?',
        'Wir haben Verfügbarkeit um {time}. Funktioniert das für Sie?',
        'Wir können Ihnen {time} anbieten. Ist das in Ordnung?',
        'Funktioniert {time} für Sie?'
      ],
      it: [
        'Le va bene alle {time}?',
        'Che ne dice delle {time}?',
        'Abbiamo disponibilità alle {time}. Le va bene?',
        'Possiamo offrirle le {time}. Le sta bene?',
        'Le funziona alle {time}?'
      ],
      fr: [
        'Est-ce que {time} vous conviendrait?',
        'Que diriez-vous de {time}?',
        'Nous avons de la disponibilité à {time}. Est-ce que cela vous convient?',
        'Nous pouvons vous proposer {time}. Est-ce que cela vous va?',
        'Est-ce que {time} vous convient?'
      ],
      pt: [
        'As {time} estariam bem?',
        'Que tal às {time}?',
        'Temos disponibilidade às {time}. Está bem?',
        'Podemos oferecer às {time}. Está bom?',
        'As {time} funcionam para você?'
      ]
    }
  };

  // Verificar que el tipo de mensaje existe
  if (!messages[type]) {
    console.log(`⚠️ Tipo de mensaje no encontrado: ${type}`);
    return ['Disculpe, no tengo esa respuesta disponible.'];
  }
  
  // Verificar que el idioma existe para este tipo
  if (!messages[type][language]) {
    console.log(`⚠️ Idioma ${language} no encontrado para tipo ${type}, usando español`);
    return messages[type]['es'] || ['Disculpe, no tengo esa respuesta disponible.'];
  }
  
  console.log(`✅ Usando mensajes en ${language} para tipo ${type}`);
  return messages[type][language];
}

// Detección mejorada de idioma
function detectLanguage(text) {
  // Normalizar texto para mejor detección
  const normalizedText = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remover puntuación
    .replace(/\s+/g, ' ') // Normalizar espacios
    .trim();
  
  console.log(`🔍 [DEBUG] Texto normalizado: "${normalizedText}"`);
  
  const languagePatterns = {
    en: [
      'hello', 'hi', 'good morning', 'good afternoon', 'good evening', 'good night',
      'book', 'booking', 'reservation', 'table', 'tables', 'restaurant',
      'want', 'need', 'would like', 'looking for', 'seeking', 'require',
      'book a table', 'make a reservation', 'table reservation', 'reserve a table',
      'for dinner', 'for lunch', 'for breakfast', 'to eat', 'to dine',
      'yes', 'okay', 'ok', 'sure', 'good', 'perfect', 'great', 'fine',
      'continue', 'proceed', 'accept', 'confirm', 'agreed',
      // Expresiones más naturales y comunes en inglés
      'i would like to book', 'i want to book', 'i need to book', 'i would like to make a reservation',
      'i want to make a reservation', 'i need to make a reservation', 'i would like to reserve',
      'i want to reserve', 'i need to reserve', 'i would like to reserve a table',
      'i want to reserve a table', 'i need to reserve a table', 'i would like to book a table',
      'i want to book a table', 'i need to book a table', 'i would like to get a table',
      'i want to get a table', 'i need to get a table', 'i would like to find a table',
      'i want to find a table', 'i need to find a table', 'i would like to have a table',
      'i want to have a table', 'i need to have a table', 'i would like to get a reservation',
      'i want to get a reservation', 'i need to get a reservation', 'i would like to make a booking',
      'i want to make a booking', 'i need to make a booking', 'i would like to book',
      'i want to book', 'i need to book', 'i would like to reserve',
      'i want to reserve', 'i need to reserve', 'i would like to make a reservation',
      'i want to make a reservation', 'i need to make a reservation',
      'for today', 'for tomorrow', 'for the day after tomorrow', 'for this week',
      'for next week', 'for the weekend', 'for saturday', 'for sunday', 'for monday',
      'for tuesday', 'for wednesday', 'for thursday', 'for friday', 'today', 'tomorrow',
      'the day after tomorrow', 'this week', 'next week', 'the weekend', 'saturday',
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'with my family', 'with my friends', 'with my colleagues', 'with my partner',
      'with my kids', 'with my parents', 'with my siblings', 'with my children',
      'family', 'friends', 'colleagues', 'partner', 'kids', 'children', 'parents',
      'siblings', 'relatives', 'guests', 'diners', 'people', 'folks',
      'for dinner', 'for lunch', 'for breakfast', 'for brunch', 'for drinks',
      'for coffee', 'for tea', 'for wine', 'for cocktails', 'for celebration',
      'for party', 'for anniversary', 'for birthday', 'for graduation', 'for promotion',
      'for farewell', 'for welcome', 'for meeting', 'for gathering', 'for date',
      'for appointment', 'for event', 'for celebration', 'for party', 'for family dinner',
      'for business dinner', 'for team dinner', 'for department dinner',
      'for group dinner', 'for friends dinner', 'for family gathering',
      'dining', 'eating', 'having dinner', 'having lunch', 'having breakfast',
      'having brunch', 'having drinks', 'having coffee', 'having tea', 'having wine',
      'having cocktails', 'celebrating', 'partying', 'meeting', 'gathering',
      'enjoying', 'enjoying dinner', 'enjoying lunch', 'enjoying breakfast',
      'enjoying brunch', 'enjoying drinks', 'enjoying coffee', 'enjoying tea',
      'enjoying wine', 'enjoying cocktails', 'enjoying celebration', 'enjoying party',
      'enjoying meeting', 'enjoying gathering', 'enjoying event',
      'tonight', 'this evening', 'this afternoon', 'this morning', 'tomorrow night',
      'tomorrow evening', 'tomorrow afternoon', 'tomorrow morning',
      'the day after tomorrow night', 'the day after tomorrow evening',
      'the day after tomorrow afternoon', 'the day after tomorrow morning',
      'saturday night', 'saturday evening', 'saturday afternoon', 'saturday morning',
      'sunday night', 'sunday evening', 'sunday afternoon', 'sunday morning',
      'monday night', 'monday evening', 'monday afternoon', 'monday morning',
      'tuesday night', 'tuesday evening', 'tuesday afternoon', 'tuesday morning',
      'wednesday night', 'wednesday evening', 'wednesday afternoon', 'wednesday morning',
      'thursday night', 'thursday evening', 'thursday afternoon', 'thursday morning',
      'friday night', 'friday evening', 'friday afternoon', 'friday morning',
      'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'good', 'perfect', 'great', 'fine',
      'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
      'go ahead', 'move forward', 'keep going', 'carry on',
      'approve', 'endorse', 'support', 'back',
      'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
      'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
      'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
      'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
      'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
      'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
      'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
      'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
      'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
      'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
      'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
      'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
      'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
      'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
      'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
      'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
      'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
      'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
      'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
      'i think the idea is brilliant', 'i think the idea is superb'
    ],
    de: [
      'hallo', 'guten tag', 'guten morgen', 'guten abend', 'gute nacht',
      'reservierung', 'reservieren', 'tisch', 'tische', 'restaurant',
      'möchte', 'brauche', 'würde gerne', 'suche', 'benötige', 'verlange',
      'tisch reservieren', 'reservierung machen', 'tisch buchen', 'tisch reservieren für',
      'zum essen', 'zum abendessen', 'zum mittagessen', 'zum frühstück',
      'ja', 'gut', 'perfekt', 'okay', 'klar', 'natürlich', 'gerne',
      'fortfahren', 'fortsetzen', 'akzeptieren', 'bestätigen', 'einverstanden',
      'ich möchte', 'ich brauche', 'ich würde gerne', 'ich suche',
      // Palabras muy específicas del alemán
      'bitte', 'danke', 'entschuldigung', 'verzeihung', 'wie', 'was', 'wo',
      'heute', 'morgen', 'abend', 'nacht', 'zeit', 'uhr', 'stunde',
      'personen', 'leute', 'gäste', 'familie', 'freunde',
      // Expresiones más naturales y comunes en alemán
      'ich hätte gerne', 'ich würde gerne', 'könnte ich', 'darf ich',
      'eine reservierung', 'einen tisch', 'einen platz', 'einen sitzplatz',
      'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
      'zum essen gehen', 'ausgehen', 'restaurant besuchen',
      'mit freunden', 'mit der familie', 'mit kollegen',
      'bestätigen', 'bestätigung', 'korrekt', 'richtig', 'stimmt',
      'ändern', 'korrigieren', 'modifizieren', 'anpassen',
      'abbrechen', 'stornieren', 'löschen', 'entfernen',
      'wiederholen', 'nochmal', 'erneut', 'von vorne',
      'telefonnummer', 'handynummer', 'mobilnummer', 'nummer',
      'diese nummer', 'gleiche nummer', 'selbe nummer', 'dieselbe nummer',
      'andere nummer', 'neue nummer', 'andere telefonnummer',
      'name', 'nachname', 'vorname', 'vollständiger name',
      'mein name ist', 'ich heiße', 'ich bin', 'ich bin der',
      'wie viele', 'wieviele', 'anzahl', 'personenzahl',
      'für wie viele', 'für wieviele', 'für wie viele personen',
      'datum', 'tag', 'wann', 'an welchem tag', 'welcher tag',
      'uhrzeit', 'zeitpunkt', 'um wieviel uhr', 'um welche uhrzeit',
      'früh', 'spät', 'mittag', 'nachmittag', 'abend', 'nacht'
    ],
    it: [
      'ciao', 'buongiorno', 'buonasera', 'buonanotte', 'salve',
      'prenotazione', 'prenotare', 'tavolo', 'tavoli', 'ristorante',
      'vorrei', 'ho bisogno', 'cerco', 'necessito', 'desidero', 'voglio',
      'prenotare tavolo', 'fare prenotazione', 'prenotazione tavolo', 'prenotare un tavolo',
      'per mangiare', 'per cenare', 'per pranzo', 'per colazione',
      'sì', 'va bene', 'perfetto', 'okay', 'chiaro', 'naturalmente', 'volentieri',
      'continuare', 'procedere', 'accettare', 'confermare', 'd\'accordo',
      'mi chiamo', 'come ti chiami', 'il mio nome',
      // Palabras muy específicas del italiano
      'per favore', 'grazie', 'scusi', 'scusa', 'come', 'cosa', 'dove',
      'oggi', 'domani', 'sera', 'notte', 'tempo', 'ora', 'ore',
      'persone', 'gente', 'ospiti', 'famiglia', 'amici',
      // Patrones de transcripción incorrecta comunes
      'chau', 'ciao', 'borrey', 'vorrei', 'pre', 'notar', 'prenotare',
      'tavolo', 'tavoli', 'ristorante', 'mangiare', 'cenare'
    ],
    fr: [
      'bonjour', 'bonsoir', 'bonne nuit', 'salut', 'bonne journée',
      'réservation', 'réserver', 'table', 'tables', 'restaurant',
      'je voudrais', 'j\'ai besoin', 'je cherche', 'je nécessite', 'je désire', 'je veux',
      'réserver table', 'faire réservation', 'réservation table', 'réserver une table',
      'pour manger', 'pour dîner', 'pour déjeuner', 'pour petit-déjeuner',
      'oui', 'd\'accord', 'parfait', 'okay', 'clair', 'naturellement', 'volontiers',
      'continuer', 'procéder', 'accepter', 'confirmer', 'd\'accord',
      'je m\'appelle', 'comment vous appelez-vous', 'mon nom'
    ],
    pt: [
      'olá', 'bom dia', 'boa tarde', 'boa noite', 'oi',
      'reserva', 'reservar', 'mesa', 'mesas', 'restaurante',
      'quero', 'preciso', 'gostaria', 'busco', 'necessito', 'desejo',
      'fazer reserva', 'reservar mesa', 'reserva mesa', 'reservar uma mesa',
      'para comer', 'para jantar', 'para almoçar', 'para café da manhã',
      'sim', 'bom', 'perfeito', 'okay', 'claro', 'naturalmente', 'com prazer',
      'continuar', 'proceder', 'aceitar', 'confirmar', 'concordo',
      'meu nome', 'como você se chama', 'me chamo',
      // Palabras específicas de portugués que NO existen en español
      'você', 'vocês', 'nós', 'a gente', 'gostaria de', 'queria',
      'modificar uma', 'alterar uma', 'mudar uma', 'editar uma',
      'modificar reserva', 'alterar reserva', 'mudar reserva', 'editar reserva'
    ],
    es: [
      'hola', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos',
      'reserva', 'reservar', 'mesa', 'mesas', 'restaurante',
      'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'busco',
      'hacer una reserva', 'reservar mesa', 'reservar una mesa', 'hacer reserva',
      'para comer', 'para cenar', 'para almorzar', 'para desayunar',
      'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto',
      'adelante', 'continúo', 'procedo', 'acepto', 'confirmo',
      'me llamo', 'como te llamas', 'mi nombre',
      // Palabras EXCLUSIVAS de español que NO existen en portugués (prioridad alta)
      'querría', 'querría modificar', 'querría cambiar', 'querría editar',
      'quisiera modificar', 'quisiera cambiar', 'quisiera editar',
      'podría modificar', 'podría cambiar', 'podría editar',
      'me gustaría modificar', 'me gustaría cambiar', 'me gustaría editar',
      'te', 'tú', 'ustedes', 'vosotros', 'vosotras',
      'mi reserva', 'una reserva', 'la reserva', 'las reservas',
      'modificar una reserva', 'cambiar una reserva', 'editar una reserva',
      'modificar mi reserva', 'cambiar mi reserva', 'editar mi reserva',
      'modificar la reserva', 'cambiar la reserva', 'editar la reserva',
      // Patrones específicos de español para evitar confusión con portugués
      'ya debo', 'debo cambiar', 'cambiar la fecha', 'fecha de mi',
      'modificar mi reserva', 'cambiar mi reserva', 'editar mi reserva',
      'actualizar mi reserva', 'quiero modificar', 'necesito cambiar',
      'quiero cambiar', 'necesito modificar', 'quiero editar',
      'necesito editar', 'quiero actualizar', 'necesito actualizar',
      // Expresiones más naturales y comunes en español
      'me gustaría reservar', 'quisiera reservar', 'deseo reservar', 'quiero reservar',
      'necesito reservar', 'busco reservar', 'quiero hacer una reserva',
      'necesito hacer una reserva', 'me gustaría hacer una reserva',
      'quisiera hacer una reserva', 'deseo hacer una reserva',
      'quiero reservar mesa', 'necesito reservar mesa', 'me gustaría reservar mesa',
      'quisiera reservar mesa', 'deseo reservar mesa', 'busco reservar mesa',
      'quiero mesa', 'necesito mesa', 'me gustaría mesa', 'quisiera mesa',
      'deseo mesa', 'busco mesa', 'quiero una mesa', 'necesito una mesa',
      'me gustaría una mesa', 'quisiera una mesa', 'deseo una mesa', 'busco una mesa',
      'para hoy', 'para mañana', 'para pasado mañana', 'para esta semana',
      'para la próxima semana', 'para el fin de semana', 'para el sábado',
      'para el domingo', 'para el lunes', 'para el martes', 'para el miércoles',
      'para el jueves', 'para el viernes', 'hoy', 'mañana', 'pasado mañana',
      'esta semana', 'la próxima semana', 'el fin de semana', 'el sábado',
      'el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes',
      'con mi familia', 'con mis amigos', 'con mis compañeros', 'con mi pareja',
      'con mis hijos', 'con mis padres', 'con mis hermanos', 'con mis hermanas',
      'familia', 'amigos', 'compañeros', 'pareja', 'hijos', 'padres', 'hermanos',
      'hermanas', 'familiares', 'invitados', 'comensales', 'personas', 'gente',
      'para comer', 'para cenar', 'para almorzar', 'para desayunar', 'para merendar',
      'para tomar algo', 'para tomar café', 'para tomar té', 'para tomar vino',
      'para celebrar', 'para festejar', 'para conmemorar', 'para recordar',
      'cumpleaños', 'aniversario', 'boda', 'graduación', 'promoción', 'ascenso',
      'despedida', 'bienvenida', 'reunión', 'encuentro', 'cita', 'compromiso',
      'evento', 'celebración', 'fiesta', 'reunión familiar', 'reunión de trabajo',
      'comida de empresa', 'comida de equipo', 'comida de departamento',
      'comida de grupo', 'comida de amigos', 'comida de familia',
      'cenar', 'almorzar', 'desayunar', 'merendar', 'tomar algo', 'tomar café',
      'tomar té', 'tomar vino', 'comer', 'disfrutar', 'disfrutar de la comida',
      'disfrutar de la cena', 'disfrutar del almuerzo', 'disfrutar del desayuno',
      'disfrutar de la merienda', 'disfrutar de la bebida', 'disfrutar del café',
      'disfrutar del té', 'disfrutar del vino', 'disfrutar de la celebración',
      'disfrutar de la fiesta', 'disfrutar de la reunión', 'disfrutar del evento'
    ]
  };

  // Sistema de pesos: patrones más específicos tienen mayor peso
  const languageScores = {
    es: 0,
    en: 0,
    de: 0,
    it: 0,
    fr: 0,
    pt: 0
  };

  console.log(`🔍 Detectando idioma para: "${text}"`);

  // Palabras de alta prioridad (peso 3) - exclusivas de cada idioma
  const highPriorityPatterns = {
    es: ['querría', 'quisiera', 'podría', 'me gustaría', 'te', 'tú', 'ustedes', 'vosotros', 'vosotras', 'una reserva', 'la reserva', 'mi reserva'],
    pt: ['você', 'vocês', 'nós', 'a gente', 'gostaria de', 'queria', 'uma reserva'],
    en: ['i would like', 'i want to', 'i need to', 'would like to', 'book a table'],
    de: ['ich möchte', 'ich würde', 'ich hätte', 'könnte ich', 'darf ich'],
    it: ['vorrei', 'ho bisogno', 'mi chiamo', 'come ti chiami'],
    fr: ['je voudrais', 'j\'ai besoin', 'je cherche', 'je m\'appelle']
  };

  // Palabras de prioridad media (peso 2)
  const mediumPriorityPatterns = {
    es: ['modificar una reserva', 'cambiar una reserva', 'editar una reserva', 'quiero modificar', 'necesito cambiar'],
    pt: ['modificar uma', 'alterar uma', 'mudar uma', 'quero modificar', 'preciso mudar'],
    en: ['modify reservation', 'change reservation', 'edit reservation'],
    de: ['reservierung ändern', 'reservierung modifizieren'],
    it: ['modificare prenotazione', 'cambiare prenotazione'],
    fr: ['modifier réservation', 'changer réservation']
  };

  // Primero verificar patrones de alta prioridad
  for (const [lang, patterns] of Object.entries(highPriorityPatterns)) {
    for (const pattern of patterns) {
      if (normalizedText.includes(pattern)) {
        languageScores[lang] += 3;
        console.log(`  ⭐ [ALTA PRIORIDAD] ${lang}: "${pattern}" encontrado (+3)`);
      }
    }
  }

  // Luego verificar patrones de prioridad media
  for (const [lang, patterns] of Object.entries(mediumPriorityPatterns)) {
    for (const pattern of patterns) {
      if (normalizedText.includes(pattern)) {
        languageScores[lang] += 2;
        console.log(`  ⚡ [MEDIA PRIORIDAD] ${lang}: "${pattern}" encontrado (+2)`);
      }
    }
  }

  // Finalmente verificar todos los patrones (peso 1)
  for (const [lang, patterns] of Object.entries(languagePatterns)) {
    const matches = patterns.filter(pattern => normalizedText.includes(pattern)).length;
    languageScores[lang] += matches;
    console.log(`  ${lang}: ${matches} coincidencias base (+${matches}), total: ${languageScores[lang]}`);
  }

  // Reglas especiales para evitar falsos positivos entre español y portugués
  if (normalizedText.includes('querría') || normalizedText.includes('quisiera')) {
    languageScores.es += 5; // Bonus muy alto para español
    console.log(`  🔥 [ESPECIAL] Español detectado por "querría/quisiera" (+5)`);
  }
  
  if (normalizedText.includes('você') || normalizedText.includes('gostaria de')) {
    languageScores.pt += 5; // Bonus muy alto para portugués
    console.log(`  🔥 [ESPECIAL] Portugués detectado por "você/gostaria" (+5)`);
  }

  // Detección especial para transcripciones malas de italiano
  if (normalizedText.includes('chau') || normalizedText.includes('borrey') || 
      normalizedText.includes('pre') || normalizedText.includes('notar')) {
    console.log(`🇮🇹 [DEBUG] Detectado patrón de transcripción italiana incorrecta`);
    languageScores.it += 3;
  }

  // Encontrar el idioma con mayor puntuación
  let maxScore = 0;
  let detectedLanguage = 'es'; // Por defecto español

  for (const [lang, score] of Object.entries(languageScores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLanguage = lang;
    }
  }

  // Si hay empate entre español y portugués, priorizar español si tiene palabras exclusivas
  if (languageScores.es === languageScores.pt && languageScores.es > 0) {
    if (normalizedText.includes('querría') || normalizedText.includes('quisiera') || 
        normalizedText.includes('podría') || normalizedText.includes('me gustaría')) {
      detectedLanguage = 'es';
      console.log(`  ⚖️ [DESEMPATE] Español elegido por patrones exclusivos`);
    } else if (normalizedText.includes('você') || normalizedText.includes('gostaria')) {
      detectedLanguage = 'pt';
      console.log(`  ⚖️ [DESEMPATE] Portugués elegido por patrones exclusivos`);
    }
  }

  console.log(`✅ Idioma detectado: ${detectedLanguage} (puntuación: ${languageScores[detectedLanguage]})`);
  return detectedLanguage;
}

function handleConfirmationResponse(text) {
  // Palabras de confirmación positiva - MULTILINGÜE
  const positiveWords = [
    // Español
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo',
    'excelente', 'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico',
    'espléndido', 'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional',
    'espectacular', 'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente',
    'me parece genial', 'me parece fantástico', 'me parece maravilloso', 'me parece estupendo',
    'me parece magnífico', 'me parece espléndido', 'me parece formidable', 'me parece increíble',
    'me parece asombroso', 'me parece fenomenal', 'me parece sensacional', 'me parece espectacular',
    'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea', 'me parece excelente la idea',
    'me parece genial la idea', 'me parece fantástica la idea', 'me parece maravillosa la idea',
    'me parece estupenda la idea', 'me parece magnífica la idea', 'me parece espléndida la idea',
    'me parece formidable la idea', 'me parece increíble la idea', 'me parece asombrosa la idea',
    'me parece fenomenal la idea', 'me parece sensacional la idea', 'me parece espectacular la idea',
    'perfecto', 'excelente', 'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico',
    'espléndido', 'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional', 'espectacular',
    'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente', 'me parece genial',
    'me parece fantástico', 'me parece maravilloso', 'me parece estupendo', 'me parece magnífico',
    'me parece espléndido', 'me parece formidable', 'me parece increíble', 'me parece asombroso',
    'me parece fenomenal', 'me parece sensacional', 'me parece espectacular', 'me encanta la idea',
    'me gusta la idea', 'me parece perfecta la idea', 'me parece excelente la idea', 'me parece genial la idea',
    'me parece fantástica la idea', 'me parece maravillosa la idea', 'me parece estupenda la idea',
    'me parece magnífica la idea', 'me parece espléndida la idea', 'me parece formidable la idea',
    'me parece increíble la idea', 'me parece asombrosa la idea', 'me parece fenomenal la idea',
    'me parece sensacional la idea', 'me parece espectacular la idea',
    // Inglés
    'yes', 'yeah', 'yep', 'correct', 'confirm', 'perfect', 'good', 'okay', 'ok', 'sure',
    'exactly', 'that\'s right', 'that\'s correct', 'sounds good', 'agree',
    'confirmed', 'accept', 'proceed', 'go ahead',
    'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
    'continue', 'proceed', 'go ahead', 'move forward', 'keep going', 'carry on',
    'accept', 'confirm', 'agree', 'approve', 'endorse', 'support', 'back',
    'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'ja', 'richtig', 'bestätigen', 'perfekt', 'gut', 'okay', 'genau',
    'das stimmt', 'einverstanden', 'bestätigt', 'akzeptieren',
    'korrekt', 'stimmt', 'genau richtig', 'absolut richtig', 'völlig richtig',
    'das ist richtig', 'das stimmt', 'das ist korrekt', 'das ist richtig',
    'ja genau', 'ja richtig', 'ja korrekt', 'ja stimmt', 'ja perfekt',
    'ausgezeichnet', 'wunderbar', 'prima', 'super', 'toll', 'fantastisch',
    'einverstanden', 'zustimmen', 'befürworten', 'unterstützen',
    'bestätigen', 'bestätigung', 'bestätigt', 'bestätige ich',
    'ich bestätige', 'ich bestätige das', 'ich bestätige gerne',
    'gerne', 'sehr gerne', 'sehr gern', 'mit freuden', 'mit vergnügen',
    'selbstverständlich', 'natürlich', 'klar', 'logisch', 'verständlich',
    'das passt', 'das gefällt mir', 'das ist gut', 'das ist perfekt',
    'so ist es richtig', 'so stimmt es', 'so ist es korrekt',
    'alles richtig', 'alles korrekt', 'alles stimmt', 'alles perfekt',
    'ich bin einverstanden', 'ich stimme zu', 'ich akzeptiere',
    'ich nehme an', 'ich befürworte', 'ich unterstütze',
    'fortfahren', 'fortsetzen', 'weiter', 'weitergehen', 'procedieren',
    'los gehts', 'los geht es', 'auf gehts', 'auf geht es',
    'machen wir', 'machen wir es', 'lassen wir es so',
    'so bleibt es', 'so lassen wir es', 'so ist es gut',
    'das reicht', 'das genügt', 'das ist ausreichend',
    'mehr brauche ich nicht', 'mehr will ich nicht', 'mehr ist nicht nötig',
    'fertig', 'abgeschlossen', 'erledigt', 'vollständig',
    'komplett', 'ganz', 'total', 'völlig', 'absolut',
    // Italiano
    'sì', 'si', 'corretto', 'confermo', 'perfetto', 'bene', 'okay', 'ok', 'esatto',
    'va bene', 'd\'accordo', 'confermato', 'accetto', 'giusto', 'esatto',
    'perfetto', 'ottimo', 'eccellente', 'fantastico', 'grande', 'bravo',
    'confermo', 'accetto', 'procedo', 'continua', 'avanti', 'procedi',
    'tutto bene', 'tutto ok', 'tutto perfetto', 'va tutto bene',
    'questo numero', 'questo telefono', 'stesso numero', 'stesso telefono',
    'conferma', 'confermare', 'accettare', 'procedere',
    // Francés
    'oui', 'correct', 'confirmer', 'parfait', 'bien', 'd\'accord',
    'exactement', 'c\'est correct', 'confirmé', 'accepter',
    // Portugués
    'sim', 'correto', 'confirmo', 'perfeito', 'bem', 'okay', 'exato',
    'está bem', 'concordo', 'confirmado', 'aceito'
  ];
  
  // Palabras de negación - MULTILINGÜE
  const negativeWords = [
    // Español
    'no', 'incorrecto', 'mal', 'error', 'cambiar', 'modificar', 'corregir',
    'no es', 'no está bien', 'no me parece', 'discrepo', 'no acepto',
    // Inglés
    'no', 'incorrect', 'wrong', 'error', 'change', 'modify', 'correct',
    'not right', 'not correct', 'disagree', 'don\'t accept',
    // Alemán
    'nein', 'falsch', 'fehler', 'ändern', 'korrigieren', 'nicht richtig',
    'das stimmt nicht', 'das ist falsch', 'das ist nicht richtig',
    'das ist nicht korrekt', 'das ist nicht richtig', 'das ist nicht stimmt',
    'nicht korrekt', 'nicht richtig', 'nicht stimmt', 'nicht richtig',
    'falsch', 'fehlerhaft', 'inkorrekt', 'unrichtig', 'unstimmt',
    'ändern', 'korrigieren', 'modifizieren', 'anpassen', 'verbessern',
    'korrektur', 'berichtigung', 'änderung', 'modifikation', 'anpassung',
    'ich möchte ändern', 'ich möchte korrigieren', 'ich möchte modifizieren',
    'ich möchte anpassen', 'ich möchte verbessern', 'ich möchte berichtigen',
    'das muss geändert werden', 'das muss korrigiert werden',
    'das muss modifiziert werden', 'das muss angepasst werden',
    'das ist nicht das was ich wollte', 'das ist nicht was ich wollte',
    'das ist nicht richtig', 'das ist nicht korrekt', 'das ist nicht stimmt',
    'nicht das', 'nicht so', 'nicht richtig', 'nicht korrekt',
    'anders', 'differenz', 'unterschiedlich', 'verschieden', 'abweichend',
    'nicht gewünscht', 'nicht erwünscht', 'nicht gewollt', 'nicht gewünscht',
    'abbrechen', 'stornieren', 'löschen', 'entfernen', 'aufheben',
    'nicht mehr', 'nicht weiter', 'nicht fortfahren', 'nicht fortsetzen',
    'stopp', 'halt', 'aufhören', 'beenden', 'terminieren',
    // Italiano
    'no', 'sbagliato', 'errore', 'cambiare', 'correggere', 'non è giusto',
    'sbagliato', 'errato', 'non corretto', 'non va bene', 'non mi piace',
    'cambiare', 'modificare', 'correggere', 'altro', 'diverso', 'nuovo',
    'non accetto', 'non confermo', 'non va', 'non è corretto',
    'altro numero', 'numero diverso', 'numero nuovo', 'telefono diverso',
    // Francés
    'non', 'incorrect', 'faux', 'erreur', 'changer', 'corriger', 'pas correct',
    // Portugués
    'não', 'incorreto', 'errado', 'erro', 'mudar', 'corrigir', 'não está certo'
  ];
  
  // Palabras para reiniciar - MULTILINGÜE
  const restartWords = [
    // Español
    'empezar de nuevo', 'volver a empezar', 'reiniciar', 'otra vez', 'de nuevo',
    'cambiar todo', 'empezamos otra vez', 'resetear',
    // Inglés
    'start over', 'start again', 'restart', 'again', 'new', 'change everything',
    'begin again', 'reset',
    // Alemán
    'von vorne anfangen', 'neu beginnen', 'nochmal', 'alles ändern',
    'neu starten', 'restart', 'reset', 'zurücksetzen', 'rücksetzen',
    'von vorne', 'noch einmal', 'erneut', 'wieder', 'nochmal',
    'alles neu', 'alles von vorne', 'komplett neu', 'total neu',
    'ganz neu', 'völlig neu', 'absolut neu', 'komplett von vorne',
    'alles ändern', 'alles modifizieren', 'alles korrigieren',
    'alles anpassen', 'alles verbessern', 'alles berichtigen',
    'neu machen', 'nochmal machen', 'wieder machen', 'erneut machen',
    'von vorne machen', 'neu starten', 'nochmal starten',
    'wieder starten', 'erneut starten', 'von vorne starten',
    'neu beginnen', 'nochmal beginnen', 'wieder beginnen',
    'erneut beginnen', 'von vorne beginnen', 'neu anfangen',
    'nochmal anfangen', 'wieder anfangen', 'erneut anfangen',
    'von vorne anfangen', 'neu', 'nochmal', 'wieder', 'erneut',
    'von vorne', 'komplett', 'ganz', 'total', 'völlig', 'absolut',
    'alles', 'komplett alles', 'ganz alles', 'total alles',
    'völlig alles', 'absolut alles', 'alles komplett', 'alles ganz',
    'alles total', 'alles völlig', 'alles absolut',
    // Italiano
    'ricominciare', 'iniziare di nuovo', 'ancora', 'cambiare tutto',
    // Francés
    'recommencer', 'nouveau', 'changer tout', 'encore',
    // Portugués
    'começar de novo', 'novamente', 'mudar tudo', 'reiniciar'
  ];
  
  const lowerText = text.toLowerCase();
  
  // Verificar confirmación positiva
  if (positiveWords.some(word => lowerText.includes(word))) {
    return { action: 'confirm' };
  }
  
  // Verificar negación
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { action: 'clarify', message: 'Entiendo. ¿Qué le gustaría cambiar? Puede decir cambiar personas, cambiar fecha, cambiar hora, cambiar nombre o cambiar teléfono.' };
  }
  
  // Verificar reinicio completo
  if (restartWords.some(word => lowerText.includes(word))) {
    return { action: 'restart' };
  }
  
  // Detectar modificaciones específicas
  const modifications = detectSpecificModifications(lowerText);
  if (modifications.length > 0) {
    return { action: 'modify', modification: modifications[0] };
  }
  
  // Respuesta ambigua
  return { action: 'clarify', message: '¿Es correcto? Puede decir sí para confirmar, no para cambiar algo, o qué específicamente quiere modificar.' };
}

function detectSpecificModifications(text) {
  const modifications = [];
  
  // Detectar cambios específicos
  if (text.includes('personas') || text.includes('gente') || text.includes('comensales') || text.includes('número de personas')) {
    modifications.push('people');
  }
  if (text.includes('fecha') || text.includes('día') || text.includes('día') || text.includes('cuando')) {
    modifications.push('date');
  }
  if (text.includes('hora') || text.includes('tiempo') || text.includes('a qué hora')) {
    modifications.push('time');
  }
  if (text.includes('nombre') || text.includes('como me llamo') || text.includes('mi nombre')) {
    modifications.push('name');
  }
  if (text.includes('teléfono') || text.includes('número') || text.includes('teléfono')) {
    modifications.push('phone');
  }
  
  return modifications;
}

// Función para modificar campos durante la creación de reserva (flujo diferente)
function handleModifyReservationField(state, modification) {
  switch (modification) {
    case 'people':
      state.step = 'ask_people';
      return {
        message: 'Perfecto. ¿Para cuántas personas?',
        gather: true
      };
      
    case 'date':
      state.step = 'ask_date';
      return {
        message: 'Perfecto. ¿Para qué fecha?',
        gather: true
      };
      
    case 'time':
      state.step = 'ask_time';
      return {
        message: 'Perfecto. ¿A qué hora?',
        gather: true
      };
      
    case 'name':
      state.step = 'ask_name';
      return {
        message: 'Perfecto. ¿Su nombre?',
        gather: true
      };
      
    case 'phone':
      state.step = 'ask_phone';
      return {
        message: 'Perfecto. ¿Desea usar este número o prefiere otro?',
        gather: true
      };
      
    default:
      const fieldMessages = getMultilingualMessages('modify_ask_field', state.language);
      return {
        message: getRandomMessage(fieldMessages),
        gather: true
      };
  }
}

function handleIntentionResponse(text) {
  // Palabras de reserva directa - EXPANDIDAS MULTILINGÜE
  const directReservationWords = [
    // Español
    'reservar', 'reserva', 'mesa', 'quiero reservar', 'necesito reservar', 
    'me gustaría reservar', 'quisiera reservar', 'deseo reservar', 
    'hacer una reserva', 'reservar mesa', 'quiero mesa',
    'quiero hacer una reserva', 'necesito hacer una reserva', 'me gustaría hacer una reserva',
    'quisiera hacer una reserva', 'deseo hacer una reserva', 'busco hacer una reserva',
    'quiero reservar mesa', 'necesito reservar mesa', 'me gustaría reservar mesa',
    'quisiera reservar mesa', 'deseo reservar mesa', 'busco reservar mesa',
    'quiero mesa', 'necesito mesa', 'me gustaría mesa', 'quisiera mesa',
    'deseo mesa', 'busco mesa', 'quiero una mesa', 'necesito una mesa',
    'me gustaría una mesa', 'quisiera una mesa', 'deseo una mesa', 'busco una mesa',
    'para comer', 'para cenar', 'para almorzar', 'para desayunar', 'para merendar',
    'para tomar algo', 'para tomar café', 'para tomar té', 'para tomar vino',
    'para celebrar', 'para festejar', 'para conmemorar', 'para recordar',
    'cumpleaños', 'aniversario', 'boda', 'graduación', 'promoción', 'ascenso',
    'despedida', 'bienvenida', 'reunión', 'encuentro', 'cita', 'compromiso',
    'evento', 'celebración', 'fiesta', 'reunión familiar', 'reunión de trabajo',
    'comida de empresa', 'comida de equipo', 'comida de departamento',
    'comida de grupo', 'comida de amigos', 'comida de familia',
    'cenar', 'almorzar', 'desayunar', 'merendar', 'tomar algo', 'tomar café',
    'tomar té', 'tomar vino', 'comer', 'disfrutar', 'disfrutar de la comida',
    'disfrutar de la cena', 'disfrutar del almuerzo', 'disfrutar del desayuno',
    'disfrutar de la merienda', 'disfrutar de la bebida', 'disfrutar del café',
    'disfrutar del té', 'disfrutar del vino', 'disfrutar de la celebración',
    'disfrutar de la fiesta', 'disfrutar de la reunión', 'disfrutar del evento',
    'con mi familia', 'con mis amigos', 'con mis compañeros', 'con mi pareja',
    'con mis hijos', 'con mis padres', 'con mis hermanos', 'con mis hermanas',
    'familia', 'amigos', 'compañeros', 'pareja', 'hijos', 'padres', 'hermanos',
    'hermanas', 'familiares', 'invitados', 'comensales', 'personas', 'gente',
    'para hoy', 'para mañana', 'para pasado mañana', 'para esta semana',
    'para la próxima semana', 'para el fin de semana', 'para el sábado',
    'para el domingo', 'para el lunes', 'para el martes', 'para el miércoles',
    'para el jueves', 'para el viernes', 'hoy', 'mañana', 'pasado mañana',
    'esta semana', 'la próxima semana', 'el fin de semana', 'el sábado',
    'el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes',
    'esta noche', 'esta tarde', 'esta mañana', 'mañana por la noche',
    'mañana por la tarde', 'mañana por la mañana', 'pasado mañana por la noche',
    'pasado mañana por la tarde', 'pasado mañana por la mañana',
    'el sábado por la noche', 'el sábado por la tarde', 'el sábado por la mañana',
    'el domingo por la noche', 'el domingo por la tarde', 'el domingo por la mañana',
    'el lunes por la noche', 'el lunes por la tarde', 'el lunes por la mañana',
    'el martes por la noche', 'el martes por la tarde', 'el martes por la mañana',
    'el miércoles por la noche', 'el miércoles por la tarde', 'el miércoles por la mañana',
    'el jueves por la noche', 'el jueves por la tarde', 'el jueves por la mañana',
    'el viernes por la noche', 'el viernes por la tarde', 'el viernes por la mañana',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto', 'naturalmente',
    'adelante', 'continúo', 'procedo', 'acepto', 'confirmo', 'está bien', 'me parece bien',
    'de acuerdo', 'perfecto', 'excelente', 'genial', 'fantástico', 'maravilloso',
    'estupendo', 'magnífico', 'espléndido', 'formidable', 'increíble', 'asombroso',
    // Inglés
    'book', 'booking', 'table reservation', 'reserve', 'reservation',
    'book a table', 'make a reservation', 'table booking',
    'i would like to book', 'i want to book', 'i need to book', 'i would like to make a reservation',
    'i want to make a reservation', 'i need to make a reservation', 'i would like to reserve',
    'i want to reserve', 'i need to reserve', 'i would like to reserve a table',
    'i want to reserve a table', 'i need to reserve a table', 'i would like to book a table',
    'i want to book a table', 'i need to book a table', 'i would like to get a table',
    'i want to get a table', 'i need to get a table', 'i would like to find a table',
    'i want to find a table', 'i need to find a table', 'i would like to have a table',
    'i want to have a table', 'i need to have a table', 'i would like to get a reservation',
    'i want to get a reservation', 'i need to get a reservation', 'i would like to make a booking',
    'i want to make a booking', 'i need to make a booking', 'i would like to book',
    'i want to book', 'i need to book', 'i would like to reserve',
    'i want to reserve', 'i need to reserve', 'i would like to make a reservation',
    'i want to make a reservation', 'i need to make a reservation',
    'for dinner', 'for lunch', 'for breakfast', 'for brunch', 'for drinks',
    'for coffee', 'for tea', 'for wine', 'for cocktails', 'for celebration',
    'for party', 'for anniversary', 'for birthday', 'for graduation', 'for promotion',
    'for farewell', 'for welcome', 'for meeting', 'for gathering', 'for date',
    'for appointment', 'for event', 'for celebration', 'for party', 'for family dinner',
    'for business dinner', 'for team dinner', 'for department dinner',
    'for group dinner', 'for friends dinner', 'for family gathering',
    'dining', 'eating', 'having dinner', 'having lunch', 'having breakfast',
    'having brunch', 'having drinks', 'having coffee', 'having tea', 'having wine',
    'having cocktails', 'celebrating', 'partying', 'meeting', 'gathering',
    'enjoying', 'enjoying dinner', 'enjoying lunch', 'enjoying breakfast',
    'enjoying brunch', 'enjoying drinks', 'enjoying coffee', 'enjoying tea',
    'enjoying wine', 'enjoying cocktails', 'enjoying celebration', 'enjoying party',
    'enjoying meeting', 'enjoying gathering', 'enjoying event',
    'with my family', 'with my friends', 'with my colleagues', 'with my partner',
    'with my kids', 'with my parents', 'with my siblings', 'with my children',
    'family', 'friends', 'colleagues', 'partner', 'kids', 'children', 'parents',
    'siblings', 'relatives', 'guests', 'diners', 'people', 'folks',
    'for today', 'for tomorrow', 'for the day after tomorrow', 'for this week',
    'for next week', 'for the weekend', 'for saturday', 'for sunday', 'for monday',
    'for tuesday', 'for wednesday', 'for thursday', 'for friday', 'today', 'tomorrow',
    'the day after tomorrow', 'this week', 'next week', 'the weekend', 'saturday',
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'tonight', 'this evening', 'this afternoon', 'this morning', 'tomorrow night',
    'tomorrow evening', 'tomorrow afternoon', 'tomorrow morning',
    'the day after tomorrow night', 'the day after tomorrow evening',
    'the day after tomorrow afternoon', 'the day after tomorrow morning',
    'saturday night', 'saturday evening', 'saturday afternoon', 'saturday morning',
    'sunday night', 'sunday evening', 'sunday afternoon', 'sunday morning',
    'monday night', 'monday evening', 'monday afternoon', 'monday morning',
    'tuesday night', 'tuesday evening', 'tuesday afternoon', 'tuesday morning',
    'wednesday night', 'wednesday evening', 'wednesday afternoon', 'wednesday morning',
    'thursday night', 'thursday evening', 'thursday afternoon', 'thursday morning',
    'friday night', 'friday evening', 'friday afternoon', 'friday morning',
    'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'good', 'perfect', 'great', 'fine',
    'absolutely', 'definitely', 'certainly', 'of course', 'naturally', 'obviously',
    'continue', 'proceed', 'go ahead', 'move forward', 'keep going', 'carry on',
    'accept', 'confirm', 'agree', 'approve', 'endorse', 'support', 'back',
    'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'reservieren', 'reservierung', 'tisch reservieren', 'tisch buchen',
    'eine reservierung', 'einen tisch', 'einen platz reservieren',
    'ich möchte reservieren', 'ich brauche eine reservierung',
    'ich würde gerne reservieren', 'könnte ich reservieren',
    'darf ich reservieren', 'ich hätte gerne eine reservierung',
    'tisch buchen', 'platz reservieren', 'sitzplatz reservieren',
    'zum essen gehen', 'restaurant besuchen', 'ausgehen zum essen',
    'mit freunden essen', 'mit der familie essen', 'mit kollegen essen',
    'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
    'heute abend', 'morgen mittag', 'morgen abend', 'übermorgen',
    'diese woche', 'nächste woche', 'am wochenende',
    'für zwei personen', 'für vier personen', 'für sechs personen',
    'für acht personen', 'für zehn personen', 'für zwölf personen',
    'mit meiner frau', 'mit meinem mann', 'mit meinen kindern',
    'familienreservierung', 'geschäftsessen', 'feier', 'geburtstag',
    'hochzeit', 'jubiläum', 'firmenfeier', 'teamessen',
    // Italiano
    'prenotazione', 'prenotare', 'tavolo', 'prenotare tavolo',
    // Francés
    'réservation', 'réserver', 'table', 'réserver table',
    // Portugués
    'reserva', 'reservar', 'mesa', 'fazer reserva'
  ];
  
  // Palabras de intención general - EXPANDIDAS MULTILINGÜE
  const generalIntentionWords = [
    // Español
    'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'quería', 'busco',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'adelante', 'claro', 'por supuesto',
    'naturalmente', 'desde luego', 'por supuesto que sí', 'por supuesto que no',
    'está bien', 'me parece bien', 'de acuerdo', 'perfecto', 'excelente',
    'genial', 'fantástico', 'maravilloso', 'estupendo', 'magnífico', 'espléndido',
    'formidable', 'increíble', 'asombroso', 'fenomenal', 'sensacional', 'espectacular',
    'me encanta', 'me gusta', 'me parece perfecto', 'me parece excelente',
    'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido',
    'me parece formidable', 'me parece increíble', 'me parece asombroso',
    'me parece fenomenal', 'me parece sensacional', 'me parece espectacular',
    'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea', 'me encanta', 'me gusta', 'me parece perfecto',
    'me parece excelente', 'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido', 'me parece formidable',
    'me parece increíble', 'me parece asombroso', 'me parece fenomenal', 'me parece sensacional',
    'me parece espectacular', 'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea', 'me encanta', 'me gusta', 'me parece perfecto',
    'me parece excelente', 'me parece genial', 'me parece fantástico', 'me parece maravilloso',
    'me parece estupendo', 'me parece magnífico', 'me parece espléndido', 'me parece formidable',
    'me parece increíble', 'me parece asombroso', 'me parece fenomenal', 'me parece sensacional',
    'me parece espectacular', 'me encanta la idea', 'me gusta la idea', 'me parece perfecta la idea',
    'me parece excelente la idea', 'me parece genial la idea', 'me parece fantástica la idea',
    'me parece maravillosa la idea', 'me parece estupenda la idea', 'me parece magnífica la idea',
    'me parece espléndida la idea', 'me parece formidable la idea', 'me parece increíble la idea',
    'me parece asombrosa la idea', 'me parece fenomenal la idea', 'me parece sensacional la idea',
    'me parece espectacular la idea',
    // Inglés
    'want', 'need', 'would like', 'yes', 'yeah', 'yep', 'okay', 'ok', 'sure', 'good',
    'please', 'i want', 'i need', 'i would like', 'absolutely', 'definitely', 'certainly',
    'of course', 'naturally', 'obviously', 'continue', 'proceed', 'go ahead', 'move forward',
    'keep going', 'carry on', 'accept', 'confirm', 'agree', 'approve', 'endorse', 'support',
    'back', 'sounds good', 'sounds great', 'sounds perfect', 'sounds excellent',
    'sounds wonderful', 'sounds fantastic', 'sounds amazing', 'sounds terrific',
    'sounds fabulous', 'sounds marvelous', 'sounds splendid', 'sounds outstanding',
    'sounds incredible', 'sounds awesome', 'sounds brilliant', 'sounds superb',
    'that sounds good', 'that sounds great', 'that sounds perfect', 'that sounds excellent',
    'that sounds wonderful', 'that sounds fantastic', 'that sounds amazing',
    'that sounds terrific', 'that sounds fabulous', 'that sounds marvelous',
    'that sounds splendid', 'that sounds outstanding', 'that sounds incredible',
    'that sounds awesome', 'that sounds brilliant', 'that sounds superb',
    'i love it', 'i like it', 'i think it\'s perfect', 'i think it\'s excellent',
    'i think it\'s great', 'i think it\'s wonderful', 'i think it\'s fantastic',
    'i think it\'s amazing', 'i think it\'s terrific', 'i think it\'s fabulous',
    'i think it\'s marvelous', 'i think it\'s splendid', 'i think it\'s outstanding',
    'i think it\'s incredible', 'i think it\'s awesome', 'i think it\'s brilliant',
    'i think it\'s superb', 'i love the idea', 'i like the idea', 'i think the idea is perfect',
    'i think the idea is excellent', 'i think the idea is great', 'i think the idea is wonderful',
    'i think the idea is fantastic', 'i think the idea is amazing', 'i think the idea is terrific',
    'i think the idea is fabulous', 'i think the idea is marvelous', 'i think the idea is splendid',
    'i think the idea is outstanding', 'i think the idea is incredible', 'i think the idea is awesome',
    'i think the idea is brilliant', 'i think the idea is superb',
    // Alemán
    'möchte', 'brauche', 'würde gerne', 'hätte gerne', 'könnte ich', 'darf ich',
    'ja', 'gut', 'okay', 'klar', 'natürlich', 'gerne', 'bitte', 'danke',
    'perfekt', 'ausgezeichnet', 'wunderbar', 'prima', 'super', 'toll',
    'einverstanden', 'zustimmen', 'akzeptieren', 'annehmen', 'befürworten',
    'fortfahren', 'fortsetzen', 'weiter', 'weitergehen', 'procedieren',
    'bestätigen', 'bestätigung', 'korrekt', 'richtig', 'stimmt', 'genau',
    'ich möchte', 'ich brauche', 'ich würde gerne', 'ich hätte gerne',
    'ich suche', 'ich benötige', 'ich verlange', 'ich wünsche',
    'ich bin interessiert', 'ich bin daran interessiert', 'ich habe interesse',
    'das wäre schön', 'das wäre toll', 'das wäre perfekt', 'das wäre super',
    'gerne', 'sehr gerne', 'sehr gern', 'mit freuden', 'mit vergnügen',
    'selbstverständlich', 'natürlich', 'klar', 'logisch', 'verständlich',
    // Italiano
    'vorrei', 'ho bisogno', 'sì', 'va bene', 'perfetto',
    // Francés
    'j\'ai besoin', 'je voudrais', 'oui', 'd\'accord', 'parfait',
    // Portugués
    'quero', 'preciso', 'sim', 'bom', 'perfeito'
  ];
  
  // Palabras de negación o no reserva - EXPANDIDAS MULTILINGÜE
  const negativeWords = [
    // Español
    'no', 'nada', 'solo llamaba', 'información', 'pregunta', 'duda',
    'cancelar', 'cancelación', 'no reserva',
    // Inglés
    'no', 'nothing', 'just calling', 'information', 'question', 'doubt',
    'cancel', 'cancellation', 'no reservation', 'not interested', 'not looking for',
    'just asking', 'just wondering', 'just checking', 'just inquiring',
    'just wanted to know', 'just wanted to ask', 'just wanted to check',
    'just wanted to inquire', 'just wanted to find out', 'just wanted to learn',
    'just wanted to understand', 'just wanted to clarify', 'just wanted to confirm',
    'just wanted to verify', 'just wanted to double check', 'just wanted to make sure',
    'just wanted to be sure', 'just wanted to be certain', 'just wanted to be clear',
    'just wanted to be positive', 'just wanted to be confident', 'just wanted to be secure',
    'just wanted to be safe', 'just wanted to be certain', 'just wanted to be sure',
    'just wanted to be clear', 'just wanted to be positive', 'just wanted to be confident',
    'just wanted to be secure', 'just wanted to be safe', 'just wanted to be certain',
    'just wanted to be sure', 'just wanted to be clear', 'just wanted to be positive',
    'just wanted to be confident', 'just wanted to be secure', 'just wanted to be safe',
    'wrong number', 'wrong call', 'mistaken call', 'accidental call', 'wrong person',
    'wrong place', 'wrong time', 'wrong day', 'wrong date', 'wrong reservation',
    'wrong booking', 'wrong table', 'wrong restaurant', 'wrong location',
    'wrong address', 'wrong phone number', 'wrong contact', 'wrong information',
    'wrong details', 'wrong specifics', 'wrong particulars', 'wrong data',
    'wrong facts', 'wrong figures', 'wrong numbers', 'wrong amounts',
    'wrong quantities', 'wrong measurements', 'wrong dimensions', 'wrong sizes',
    'wrong lengths', 'wrong widths', 'wrong heights', 'wrong depths',
    'wrong volumes', 'wrong capacities', 'wrong limits', 'wrong boundaries',
    'wrong ranges', 'wrong scopes', 'wrong extents', 'wrong degrees',
    'wrong levels', 'wrong grades', 'wrong classes', 'wrong categories',
    'wrong types', 'wrong kinds', 'wrong sorts', 'wrong varieties',
    'wrong species', 'wrong breeds', 'wrong strains', 'wrong lines',
    'wrong families', 'wrong groups', 'wrong sets', 'wrong collections',
    'wrong batches', 'wrong lots', 'wrong shipments', 'wrong deliveries',
    'wrong orders', 'wrong requests', 'wrong demands', 'wrong requirements',
    'wrong needs', 'wrong wants', 'wrong desires', 'wrong wishes',
    'wrong hopes', 'wrong dreams', 'wrong aspirations', 'wrong ambitions',
    'wrong goals', 'wrong objectives', 'wrong targets', 'wrong aims',
    'wrong purposes', 'wrong intentions', 'wrong plans', 'wrong strategies',
    'wrong approaches', 'wrong methods', 'wrong techniques', 'wrong procedures',
    'wrong processes', 'wrong systems', 'wrong mechanisms', 'wrong operations',
    'wrong functions', 'wrong activities', 'wrong actions', 'wrong behaviors',
    'wrong conduct', 'wrong manners', 'wrong etiquette', 'wrong protocol',
    'wrong customs', 'wrong traditions', 'wrong practices', 'wrong habits',
    'wrong routines', 'wrong patterns', 'wrong cycles', 'wrong rhythms',
    'wrong tempos', 'wrong paces', 'wrong speeds', 'wrong rates',
    'wrong frequencies', 'wrong intervals', 'wrong periods', 'wrong durations',
    'wrong times', 'wrong moments', 'wrong instants', 'wrong seconds',
    'wrong minutes', 'wrong hours', 'wrong days', 'wrong weeks',
    'wrong months', 'wrong years', 'wrong decades', 'wrong centuries',
    'wrong millennia', 'wrong ages', 'wrong eras', 'wrong periods',
    'wrong epochs',
    // Alemán
    'nein', 'nicht', 'keine', 'kein', 'nichts', 'nur anrufen', 'nur fragen',
    'information', 'frage', 'doubt', 'zweifel', 'unsicher', 'nicht sicher',
    'abbrechen', 'stornieren', 'löschen', 'entfernen', 'aufheben',
    'keine reservierung', 'nicht reservieren', 'nicht buchen',
    'nur informieren', 'nur nachfragen', 'nur erkundigen',
    'nur telefonieren', 'nur sprechen', 'nur reden',
    'kein interesse', 'nicht interessiert', 'nicht gewünscht',
    'falsch verbunden', 'verkehrte nummer', 'falsche nummer',
    'nicht gewollt', 'nicht erwünscht', 'nicht gewünscht',
    'entschuldigung', 'verzeihung', 'sorry', 'tut mir leid',
    'falscher anruf', 'versehentlich', 'aus versehen',
    // Italiano
    'no', 'niente', 'solo chiamare', 'informazione', 'domanda',
    // Francés
    'non', 'rien', 'juste appeler', 'information', 'question',
    // Portugués
    'não', 'nada', 'só ligando', 'informação', 'pergunta'
  ];
  
  const lowerText = text.toLowerCase();
  
  // Verificar modificación de reserva existente (PRIORIDAD ALTA - antes de otras verificaciones)
  console.log(`🔍 [DEBUG] handleIntentionResponse - Texto recibido: "${text}"`);
  const isModify = isModificationRequest(text);
  console.log(`🔍 [DEBUG] handleIntentionResponse - isModificationRequest result: ${isModify}`);
  if (isModify) {
    console.log(`✏️ [DEBUG] ✅ Acción MODIFY detectada para: "${text}"`);
    return { action: 'modify' };
  }
  
  // Verificar cancelación de reserva existente
  if (isCancellationRequest(text)) {
    return { action: 'cancel' };
  }
  
  // Verificar reserva directa
  if (directReservationWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Verificar negación
  if (negativeWords.some(word => lowerText.includes(word))) {
    return { 
      action: 'clarify', 
      message: 'Entiendo. Si cambia de opinión y quiere hacer una reserva o cancelar una existente, solo dígamelo.' 
    };
  }
  
  // Verificar intención general (asumir que es para reserva)
  if (generalIntentionWords.some(word => lowerText.includes(word))) {
    return { action: 'reservation' };
  }
  
  // Respuesta ambigua
  return { 
    action: 'clarify', 
    message: '¿Le gustaría hacer una nueva reserva o cancelar una existente?' 
  };
}

function handleUnclearResponse(text, field, language = 'es') {
  const responses = {
    people: {
      es: [
        'Disculpe, no he entendido bien. ¿Cuántas personas serán?',
        '¿Para cuántas personas será la reserva? Dígame un número del 1 al 20, por favor.',
        'Perdón, no lo he captado bien. ¿Cuántas personas van a venir?',
        '¿Podría repetirlo, por favor? ¿Para cuántas personas?',
        'Disculpe, no he entendido. ¿Cuántas personas serán en total?',
        'Lo siento, no he captado bien el número. ¿Para cuántas personas será la reserva?',
        'Perdón, no lo he oído bien. ¿Cuántas personas van a venir?',
        'Disculpe, ¿podría repetirlo? ¿Para cuántas personas será?',
        'No he entendido bien. ¿Me puede decir cuántas personas serán?'
      ],
      en: [
        'Sorry, I didn\'t understand. How many people will it be?',
        'For how many people? Tell me a number from 1 to 20.',
        'I didn\'t catch that well. How many people are coming?',
        'Could you repeat? For how many people?',
        'Sorry, how many people in total?'
      ],
      de: [
        'Entschuldigung, ich habe nicht verstanden. Für wie viele Personen?',
        'Für wie viele Personen? Sagen Sie mir eine Zahl von 1 bis 20.',
        'Ich habe das nicht gut verstanden. Wie viele Personen kommen?',
        'Könnten Sie wiederholen? Für wie viele Personen?',
        'Entschuldigung, wie viele Personen insgesamt?'
      ],
      it: [
        'Scusi, non ho capito. Per quante persone?',
        'Per quante persone? Dimmi un numero da 1 a 20.',
        'Non ho capito bene. Quante persone vengono?',
        'Potresti ripetere? Per quante persone?',
        'Scusi, quante persone in totale?'
      ],
      fr: [
        'Désolé, je n\'ai pas compris. Pour combien de personnes?',
        'Pour combien de personnes? Dites-moi un nombre de 1 à 20.',
        'Je n\'ai pas bien saisi. Combien de personnes viennent?',
        'Pourriez-vous répéter? Pour combien de personnes?',
        'Désolé, combien de personnes au total?'
      ],
      pt: [
        'Desculpe, não entendi. Para quantas pessoas?',
        'Para quantas pessoas? Diga-me um número de 1 a 20.',
        'Não entendi bem. Quantas pessoas estão vindo?',
        'Poderia repetir? Para quantas pessoas?',
        'Desculpe, quantas pessoas no total?'
      ]
    },
    date: {
      es: [
        'Perdón, no he entendido bien la fecha. ¿Qué día prefieren?',
        '¿Para qué día les gustaría venir? Pueden decir mañana, pasado mañana, o un día específico.',
        'Disculpe, no he captado bien la fecha. ¿Qué día les conviene más?',
        '¿Podrían repetirlo, por favor? ¿Para qué día desean la reserva?',
        'No lo he entendido bien. ¿Qué día quieren venir?',
        'Lo siento, no he oído bien la fecha. ¿Para qué día les gustaría venir?',
        'Perdón, no lo he captado. ¿Qué día les viene mejor?',
        'Disculpe, ¿podría repetir la fecha? ¿Para qué día desean la reserva?',
        'No he entendido bien. ¿Me puede decir para qué día les gustaría venir?'
      ],
      en: [
        'I didn\'t understand the date well. What day do you prefer?',
        'For what day? You can say tomorrow, the day after tomorrow, or a specific day.',
        'Sorry, I didn\'t catch the date. What day suits you?',
        'Could you repeat? For what date?',
        'I didn\'t understand. What day do you want to come?'
      ],
      de: [
        'Ich habe das Datum nicht gut verstanden. Welchen Tag bevorzugen Sie?',
        'Für welchen Tag? Sie können morgen, übermorgen oder einen bestimmten Tag sagen.',
        'Entschuldigung, ich habe das Datum nicht verstanden. Welcher Tag passt Ihnen?',
        'Könnten Sie wiederholen? Für welches Datum?',
        'Ich habe nicht verstanden. An welchem Tag möchten Sie kommen?'
      ],
      it: [
        'Non ho capito bene la data. Che giorno preferisci?',
        'Per che giorno? Puoi dire domani, dopodomani, o un giorno specifico.',
        'Scusi, non ho capito la data. Che giorno ti conviene?',
        'Potresti ripetere? Per che data?',
        'Non ho capito. Che giorno vuoi venire?'
      ],
      fr: [
        'Je n\'ai pas bien compris la date. Quel jour préférez-vous?',
        'Pour quel jour? Vous pouvez dire demain, après-demain, ou un jour spécifique.',
        'Désolé, je n\'ai pas saisi la date. Quel jour vous convient?',
        'Pourriez-vous répéter? Pour quelle date?',
        'Je n\'ai pas compris. Quel jour voulez-vous venir?'
      ],
      pt: [
        'Não entendi bem a data. Que dia você prefere?',
        'Para que dia? Você pode dizer amanhã, depois de amanhã, ou um dia específico.',
        'Desculpe, não entendi a data. Que dia te convém?',
        'Poderia repetir? Para que data?',
        'Não entendi. Que dia você quer vir?'
      ]
    },
    time: {
      es: [
        'Perdón, no he entendido bien la hora. ¿A qué hora prefieren?',
        '¿A qué hora les gustaría venir? Pueden decir, por ejemplo: las ocho, las ocho y media...',
        'Disculpe, no he captado bien la hora. ¿A qué hora les vendría mejor?',
        '¿Podrían repetirlo, por favor? ¿A qué hora desean hacer la reserva?',
        'No lo he entendido bien. ¿A qué hora quieren la reserva?',
        'Lo siento, no he oído bien la hora. ¿A qué hora les gustaría venir?',
        'Perdón, no lo he captado. ¿Qué hora les viene mejor?',
        'Disculpe, ¿podría repetir la hora? ¿A qué hora desean la reserva?',
        'No he entendido bien. ¿Me puede decir a qué hora les gustaría venir?'
      ],
      en: [
        'I didn\'t understand the time well. What time do you prefer?',
        'What time? You can say for example: eight o\'clock, eight thirty...',
        'Sorry, I didn\'t catch the time. What time would you like to come?',
        'Could you repeat? What time?',
        'I didn\'t understand. What time do you want the reservation?'
      ],
      de: [
        'Ich habe die Uhrzeit nicht gut verstanden. Zu welcher Uhrzeit bevorzugen Sie?',
        'Zu welcher Uhrzeit? Sie können zum Beispiel sagen: acht Uhr, halb neun...',
        'Entschuldigung, ich habe die Uhrzeit nicht verstanden. Zu welcher Uhrzeit möchten Sie kommen?',
        'Könnten Sie wiederholen? Zu welcher Uhrzeit?',
        'Ich habe nicht verstanden. Zu welcher Uhrzeit möchten Sie die Reservierung?'
      ],
      it: [
        'Non ho capito bene l\'ora. A che ora preferisci?',
        'A che ora? Puoi dire per esempio: le otto, le otto e mezza...',
        'Scusi, non ho capito l\'ora. A che ora vorresti venire?',
        'Potresti ripetere? A che ora?',
        'Non ho capito. A che ora vuoi la prenotazione?'
      ],
      fr: [
        'Je n\'ai pas bien compris l\'heure. À quelle heure préférez-vous?',
        'À quelle heure? Vous pouvez dire par exemple: huit heures, huit heures et demie...',
        'Désolé, je n\'ai pas saisi l\'heure. À quelle heure aimeriez-vous venir?',
        'Pourriez-vous répéter? À quelle heure?',
        'Je n\'ai pas compris. À quelle heure voulez-vous la réservation?'
      ],
      pt: [
        'Não entendi bem a hora. Que horas você prefere?',
        'Que horas? Você pode dizer por exemplo: oito horas, oito e meia...',
        'Desculpe, não entendi a hora. Que horas gostaria de vir?',
        'Poderia repetir? Que horas?',
        'Não entendi. Que horas você quer a reserva?'
      ]
    },
    name: {
      es: [
        'Disculpe, no he entendido bien su nombre. ¿Cómo se llama, por favor?',
        '¿Me puede decir su nombre? Por favor, dígamelo despacio.',
        'Perdón, no he captado bien su nombre. ¿Podría repetirlo?',
        'Disculpe, ¿cómo se llama para la reserva?',
        '¿Podría decirme su nombre otra vez, por favor?',
        'Lo siento, no he oído bien su nombre. ¿Cómo se llama?',
        'Perdón, no lo he captado. ¿Me puede decir su nombre otra vez?',
        'Disculpe, ¿podría repetir su nombre? No lo he entendido bien.',
        'No he entendido bien. ¿Me puede decir su nombre, por favor?'
      ],
      en: [
        'Sorry, I didn\'t understand your name well. What\'s your name?',
        'Your name? Please tell me slowly.',
        'I didn\'t catch your name. Could you repeat it?',
        'Sorry, what\'s your name?',
        'Could you tell me your name again?'
      ],
      de: [
        'Entschuldigung, ich habe Ihren Namen nicht gut verstanden. Wie heißen Sie?',
        'Ihr Name? Bitte sagen Sie es mir langsam.',
        'Ich habe Ihren Namen nicht verstanden. Könnten Sie ihn wiederholen?',
        'Entschuldigung, wie heißen Sie?',
        'Könnten Sie mir Ihren Namen noch einmal sagen?'
      ],
      it: [
        'Scusi, non ho capito bene il tuo nome. Come ti chiami?',
        'Il tuo nome? Per favore, dimmelo lentamente.',
        'Non ho capito il tuo nome. Potresti ripeterlo?',
        'Scusi, come ti chiami?',
        'Potresti dirmi il tuo nome di nuovo?'
      ],
      fr: [
        'Désolé, je n\'ai pas bien compris votre nom. Comment vous appelez-vous?',
        'Votre nom? S\'il vous plaît, dites-le moi lentement.',
        'Je n\'ai pas saisi votre nom. Pourriez-vous le répéter?',
        'Désolé, comment vous appelez-vous?',
        'Pourriez-vous me dire votre nom encore une fois?'
      ],
      pt: [
        'Desculpe, não entendi bem o seu nome. Como você se chama?',
        'Seu nome? Por favor, diga-me devagar.',
        'Não entendi o seu nome. Poderia repetir?',
        'Desculpe, como você se chama?',
        'Poderia me dizer o seu nome novamente?'
      ]
    },
    phone: {
      es: [
        'Perdón, no he entendido bien el número. ¿Podría decirlo dígito por dígito, por favor?',
        '¿Me puede dar su número de teléfono? Dígalo despacio, número por número.',
        'Disculpe, no he captado bien el teléfono. ¿Puede repetirlo, por favor?',
        '¿Podría repetir el número? Dígito por dígito, si es posible.',
        'No lo he entendido bien. ¿Cuál es su número de teléfono?'
      ],
      en: [
        'I didn\'t understand the number well. Could you say it digit by digit?',
        'The phone number? Say it slowly, number by number.',
        'Sorry, I didn\'t catch the phone. Can you repeat it?',
        'Could you repeat the number? Digit by digit.',
        'I didn\'t understand. Your phone number?'
      ],
      de: [
        'Ich habe die Nummer nicht gut verstanden. Könnten Sie sie Ziffer für Ziffer sagen?',
        'Die Telefonnummer? Sagen Sie sie langsam, Ziffer für Ziffer.',
        'Entschuldigung, ich habe das Telefon nicht verstanden. Können Sie es wiederholen?',
        'Könnten Sie die Nummer wiederholen? Ziffer für Ziffer.',
        'Ich habe nicht verstanden. Ihre Telefonnummer?'
      ],
      it: [
        'Non ho capito bene il numero. Potresti dirlo cifra per cifra?',
        'Il numero di telefono? Dillo lentamente, cifra per cifra.',
        'Scusi, non ho capito il telefono. Puoi ripeterlo?',
        'Potresti ripetere il numero? Cifra per cifra.',
        'Non ho capito. Il tuo numero di telefono?'
      ],
      fr: [
        'Je n\'ai pas bien compris le numéro. Pourriez-vous le dire chiffre par chiffre?',
        'Le numéro de téléphone? Dites-le lentement, chiffre par chiffre.',
        'Désolé, je n\'ai pas saisi le téléphone. Pouvez-vous le répéter?',
        'Pourriez-vous répéter le numéro? Chiffre par chiffre.',
        'Je n\'ai pas compris. Votre numéro de téléphone?'
      ],
      pt: [
        'Não entendi bem o número. Poderia dizê-lo dígito por dígito?',
        'O número de telefone? Diga devagar, número por número.',
        'Desculpe, não entendi o telefone. Pode repetir?',
        'Poderia repetir o número? Dígito por dígito.',
        'Não entendi. O seu número de telefone?'
      ]
    }
  };
  
  // Seleccionar respuesta aleatoria para evitar monotonía
  const fieldResponses = responses[field] && responses[field][language] ? responses[field][language] : responses[field]['es'];
  return getRandomMessage(fieldResponses);
}

function isReservationRequest(text) {
  const reservationWords = [
    // ESPAÑOL - Expresiones completas y naturales
    'reservar', 'reserva', 'mesa', 'mesas', 'comer', 'cenar', 'almorzar',
    'quiero', 'necesito', 'me gustaría', 'quisiera', 'deseo', 'quería',
    'hacer una reserva', 'reservar mesa', 'reservar una mesa', 'reservar mesa para',
    'hacer reserva', 'necesito mesa', 'quiero mesa', 'busco mesa',
    'tengo reserva', 'tengo una reserva', 'mi reserva', 'la reserva',
    'para comer', 'para cenar', 'para almorzar', 'para desayunar',
    'restaurante', 'cenar en', 'comer en', 'vamos a comer',
    'si', 'sí', 'vale', 'bueno', 'perfecto', 'claro', 'por supuesto',
    'adelante', 'continúo', 'procedo', 'acepto', 'confirmo',
    
    // INGLÉS - Expresiones completas y naturales
    'book', 'booking', 'table', 'tables', 'eat', 'dine', 'lunch', 'dinner',
    'want', 'need', 'would like', 'looking for', 'seeking', 'require',
    'book a table', 'make a reservation', 'table reservation', 'reserve a table',
    'book table', 'reserve table', 'get a table', 'find a table',
    'have a reservation', 'my reservation', 'the reservation',
    'for dinner', 'for lunch', 'for breakfast', 'to eat', 'to dine',
    'restaurant', 'dining', 'eating out', 'going out to eat',
    'yes', 'okay', 'ok', 'sure', 'good', 'perfect', 'great', 'fine',
    'continue', 'proceed', 'accept', 'confirm', 'agreed',
    
    // ALEMÁN - Expresiones completas y naturales
    'reservieren', 'reservierung', 'tisch', 'tische', 'essen', 'dinner', 'mittagessen',
    'möchte', 'brauche', 'würde gerne', 'hätte gerne', 'könnte ich', 'darf ich', 'suche', 'benötige', 'verlange',
    'tisch reservieren', 'reservierung machen', 'tisch buchen', 'tisch reservieren für',
    'tisch buchen', 'tisch bekommen', 'tisch finden', 'tisch suchen',
    'habe reservierung', 'meine reservierung', 'die reservierung',
    'zum essen', 'zum abendessen', 'zum mittagessen', 'zum frühstück',
    'restaurant', 'essen gehen', 'ausgehen zum essen',
    'ja', 'gut', 'perfekt', 'okay', 'klar', 'natürlich', 'gerne',
    'fortfahren', 'fortsetzen', 'akzeptieren', 'bestätigen', 'einverstanden',
    'ich möchte', 'ich brauche', 'ich würde gerne', 'ich hätte gerne', 'ich suche',
    'ich benötige', 'ich verlange', 'ich wünsche', 'ich bin interessiert',
    'eine reservierung', 'einen tisch', 'einen platz', 'einen sitzplatz',
    'für heute', 'für morgen', 'für übermorgen', 'für diese woche',
    'mit freunden', 'mit der familie', 'mit kollegen', 'mit meiner frau',
    'mit meinem mann', 'mit meinen kindern', 'familienreservierung',
    'geschäftsessen', 'feier', 'geburtstag', 'hochzeit', 'jubiläum',
    'firmenfeier', 'teamessen', 'heute abend', 'morgen mittag', 'morgen abend',
    'übermorgen', 'diese woche', 'nächste woche', 'am wochenende',
    'für zwei personen', 'für vier personen', 'für sechs personen',
    'für acht personen', 'für zehn personen', 'für zwölf personen',
    
    // ITALIANO - Expresiones completas y naturales
    'prenotazione', 'prenotare', 'tavolo', 'tavoli', 'mangiare', 'cenare', 'pranzo',
    'vorrei', 'ho bisogno', 'cerco', 'necessito', 'desidero', 'voglio',
    'prenotare tavolo', 'fare prenotazione', 'prenotazione tavolo', 'prenotare un tavolo',
    'prenotare tavolo', 'ottenere tavolo', 'trovare tavolo', 'cercare tavolo',
    'ho prenotazione', 'la mia prenotazione', 'la prenotazione',
    'per mangiare', 'per cenare', 'per pranzo', 'per colazione',
    'ristorante', 'andare a mangiare', 'uscire a mangiare',
    'sì', 'va bene', 'perfetto', 'okay', 'chiaro', 'naturalmente', 'volentieri',
    'continuare', 'procedere', 'accettare', 'confermare', 'd\'accordo',
    
    // FRANCÉS - Expresiones completas y naturales
    'réservation', 'réserver', 'table', 'tables', 'manger', 'dîner', 'déjeuner',
    'je voudrais', 'j\'ai besoin', 'je cherche', 'je nécessite', 'je désire', 'je veux',
    'réserver table', 'faire réservation', 'réservation table', 'réserver une table',
    'réserver table', 'obtenir table', 'trouver table', 'chercher table',
    'j\'ai réservation', 'ma réservation', 'la réservation',
    'pour manger', 'pour dîner', 'pour déjeuner', 'pour petit-déjeuner',
    'restaurant', 'sortir manger', 'aller manger',
    'oui', 'd\'accord', 'parfait', 'okay', 'clair', 'naturellement', 'volontiers',
    'continuer', 'procéder', 'accepter', 'confirmer', 'd\'accord',
    
    // PORTUGUÉS - Expresiones completas y naturales
    'reserva', 'reservar', 'mesa', 'mesas', 'comer', 'jantar', 'almoçar',
    'quero', 'preciso', 'gostaria', 'busco', 'necessito', 'desejo', 'quero',
    'fazer reserva', 'reservar mesa', 'reserva mesa', 'reservar uma mesa',
    'reservar mesa', 'conseguir mesa', 'encontrar mesa', 'procurar mesa',
    'tenho reserva', 'minha reserva', 'a reserva',
    'para comer', 'para jantar', 'para almoçar', 'para café da manhã',
    'restaurante', 'sair para comer', 'ir comer',
    'sim', 'bom', 'perfeito', 'okay', 'claro', 'naturalmente', 'com prazer',
    'continuar', 'proceder', 'aceitar', 'confirmar', 'concordo',
    
    // EXPRESIONES COMUNES MULTILINGÜES
    'this evening', 'tonight', 'this afternoon', 'tomorrow', 'next week',
    'esta noche', 'esta tarde', 'mañana', 'la próxima semana',
    'heute abend', 'heute nacht', 'morgen', 'nächste woche', 'übermorgen',
    'diese woche', 'am wochenende', 'morgen mittag', 'morgen abend',
    'heute mittag', 'heute nachmittag', 'heute abend', 'heute nacht',
    'diese nacht', 'diese nacht', 'diese nacht', 'diese nacht',
    'stasera', 'domani', 'la prossima settimana',
    'ce soir', 'demain', 'la semaine prochaine',
    'esta noite', 'amanhã', 'próxima semana',
    
    // NÚMEROS Y CANTIDADES
    'for two', 'for four', 'for six', 'for eight', 'for ten',
    'para dos', 'para cuatro', 'para seis', 'para ocho', 'para diez',
    'für zwei', 'für vier', 'für sechs', 'für acht', 'für zehn', 'für zwölf',
    'für zwei personen', 'für vier personen', 'für sechs personen', 'für acht personen',
    'für zehn personen', 'für zwölf personen', 'für zwei leute', 'für vier leute',
    'für sechs leute', 'für acht leute', 'für zehn leute', 'für zwölf leute',
    'für zwei gäste', 'für vier gäste', 'für sechs gäste', 'für acht gäste',
    'für zehn gäste', 'für zwölf gäste', 'mit zwei', 'mit vier', 'mit sechs',
    'mit acht', 'mit zehn', 'mit zwölf', 'mit zwei personen', 'mit vier personen',
    'mit sechs personen', 'mit acht personen', 'mit zehn personen', 'mit zwölf personen',
    'mit zwei leute', 'mit vier leute', 'mit sechs leute', 'mit acht leute',
    'mit zehn leute', 'mit zwölf leute', 'mit zwei gäste', 'mit vier gäste',
    'mit sechs gäste', 'mit acht gäste', 'mit zehn gäste', 'mit zwölf gäste',
    'zwei personen', 'vier personen', 'sechs personen', 'acht personen',
    'zehn personen', 'zwölf personen', 'zwei leute', 'vier leute', 'sechs leute',
    'acht leute', 'zehn leute', 'zwölf leute', 'zwei gäste', 'vier gäste',
    'sechs gäste', 'acht gäste', 'zehn gäste', 'zwölf gäste',
    'per due', 'per quattro', 'per sei', 'per otto', 'per dieci',
    'pour deux', 'pour quatre', 'pour six', 'pour huit', 'pour dix',
    'para dois', 'para quatro', 'para seis', 'para oito', 'para dez'
  ];
  
  const lowerText = text.toLowerCase();
  
  console.log(`🔍 [DEBUG] isReservationRequest - Analizando: "${text}"`);
  console.log(`🔍 [DEBUG] Texto en minúsculas: "${lowerText}"`);
  
  // Buscar coincidencias exactas de palabras
  const hasReservationWords = reservationWords.some(word => lowerText.includes(word));
  console.log(`🔍 [DEBUG] Palabras de reserva encontradas: ${hasReservationWords}`);
  
  // Debug específico para italiano
  if (lowerText.includes('ciao') || lowerText.includes('vorrei') || lowerText.includes('prenotare')) {
    console.log(`🇮🇹 [DEBUG] Detectadas palabras italianas en: "${lowerText}"`);
    const italianWords = ['ciao', 'vorrei', 'prenotare', 'tavolo', 'prenotazione', 'ho bisogno'];
    const foundItalian = italianWords.filter(word => lowerText.includes(word));
    console.log(`🇮🇹 [DEBUG] Palabras italianas encontradas:`, foundItalian);
  }
  
  // Buscar patrones de frases comunes
  const commonPatterns = [
    // Patrones en español
    /quiero\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /necesito\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /me\s+gustaría\s+(?:hacer\s+)?(?:una\s+)?reserva/i,
    /quiero\s+(?:reservar\s+)?(?:una\s+)?mesa/i,
    /necesito\s+(?:reservar\s+)?(?:una\s+)?mesa/i,
    /para\s+\d+\s+(?:personas?|gente|comensales?)/i,
    
    // Patrones en inglés
    /i\s+want\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+need\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+would\s+like\s+to\s+(?:book|make\s+a\s+reservation)/i,
    /i\s+want\s+(?:to\s+)?book\s+a\s+table/i,
    /i\s+need\s+(?:to\s+)?book\s+a\s+table/i,
    /for\s+\d+\s+(?:people|persons?)/i,
    
    // Patrones en alemán
    /ich\s+möchte\s+(?:eine\s+)?reservierung/i,
    /ich\s+brauche\s+(?:eine\s+)?reservierung/i,
    /ich\s+würde\s+gerne\s+(?:eine\s+)?reservierung/i,
    /ich\s+hätte\s+gerne\s+(?:eine\s+)?reservierung/i,
    /könnte\s+ich\s+(?:eine\s+)?reservierung/i,
    /darf\s+ich\s+(?:eine\s+)?reservierung/i,
    /ich\s+möchte\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?tisch\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?tisch\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?tisch\s+reservieren/i,
    /ich\s+möchte\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+brauche\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?tisch\s+buchen/i,
    /könnte\s+ich\s+(?:einen\s+)?tisch\s+buchen/i,
    /darf\s+ich\s+(?:einen\s+)?tisch\s+buchen/i,
    /ich\s+möchte\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?platz\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?platz\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?platz\s+reservieren/i,
    /ich\s+möchte\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+brauche\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+würde\s+gerne\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /ich\s+hätte\s+gerne\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /könnte\s+ich\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /darf\s+ich\s+(?:einen\s+)?sitzplatz\s+reservieren/i,
    /für\s+\d+\s+(?:personen?|leute|gäste)/i,
    /mit\s+(?:freunden|der\s+familie|kollegen|meiner\s+frau|meinem\s+mann|meinen\s+kindern)/i,
    /für\s+(?:heute|morgen|übermorgen|diese\s+woche|nächste\s+woche|am\s+wochenende)/i,
    /heute\s+(?:abend|mittag|nachmittag)/i,
    /morgen\s+(?:abend|mittag|nachmittag)/i,
    /übermorgen/i,
    /diese\s+woche/i,
    /nächste\s+woche/i,
    /am\s+wochenende/i,
    /zum\s+(?:essen|abendessen|mittagessen|frühstück)/i,
    /ausgehen\s+zum\s+essen/i,
    /essen\s+gehen/i,
    /restaurant\s+besuchen/i,
    /familienreservierung/i,
    /geschäftsessen/i,
    /firmenfeier/i,
    /teamessen/i,
    /geburtstag/i,
    /hochzeit/i,
    /jubiläum/i,
    /feier/i,
    
    // Patrones en italiano
    /vorrei\s+(?:fare\s+)?(?:una\s+)?prenotazione/i,
    /ho\s+bisogno\s+di\s+(?:una\s+)?prenotazione/i,
    /vorrei\s+(?:prenotare\s+)?(?:un\s+)?tavolo/i,
    /per\s+\d+\s+(?:persone?|gente)/i,
    
    // Patrones en francés
    /je\s+voudrais\s+(?:faire\s+)?(?:une\s+)?réservation/i,
    /j\'ai\s+besoin\s+d\'(?:une\s+)?réservation/i,
    /je\s+voudrais\s+(?:réserver\s+)?(?:une\s+)?table/i,
    /pour\s+\d+\s+(?:personnes?|gens)/i,
    
    // Patrones en portugués
    /quero\s+(?:fazer\s+)?(?:uma\s+)?reserva/i,
    /preciso\s+de\s+(?:uma\s+)?reserva/i,
    /quero\s+(?:reservar\s+)?(?:uma\s+)?mesa/i,
    /para\s+\d+\s+(?:pessoas?|gente)/i
  ];
  
  const hasPatterns = commonPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones regex encontrados: ${hasPatterns}`);
  
  const result = hasReservationWords || hasPatterns;
  console.log(`🔍 [DEBUG] Resultado final isReservationRequest: ${result}`);
  
  return result;
}

// Función simple para detectar confirmación de cancelación
function detectCancellationConfirmation(text) {
  const lowerText = text.toLowerCase();
  
  // Palabras de confirmación positiva (SÍ quiero cancelar)
  const yesWords = [
    // Español
    'si', 'sí', 'correcto', 'confirmo', 'perfecto', 'bien', 'vale', 'ok', 'okay',
    'exacto', 'eso es', 'así es', 'está bien', 'me parece bien', 'de acuerdo',
    'confirmado', 'acepto', 'procedo', 'adelante', 'continúo',
    'quiero cancelar', 'necesito cancelar', 'deseo cancelar', 'mejor cancelo',
    'al final no', 'mejor no', 'ya no quiero', 'ya no necesito', 'ya no voy',
    'cambié de opinión', 'cambie de opinion', 'cambié de idea', 'cambie de idea',
    'no me interesa', 'no me convence', 'no me gusta', 'no me conviene',
    'no me sirve', 'no me funciona', 'no me parece bien',
    'mejor paro', 'mejor termino', 'mejor cuelgo', 'mejor me voy',
    'mejor me despido', 'mejor me retiro', 'mejor no hago', 'mejor no reservo',
    
    // Inglés
    'yes', 'yeah', 'yep', 'correct', 'confirm', 'perfect', 'good', 'okay', 'ok', 'sure',
    'exactly', 'that\'s right', 'that\'s correct', 'sounds good', 'agree',
    'confirmed', 'accept', 'proceed', 'go ahead', 'absolutely', 'definitely',
    'want to cancel', 'need to cancel', 'wish to cancel', 'better cancel',
    'actually no', 'better not', 'changed my mind', 'change my mind',
    'not interested', 'not convinced', 'don\'t want to continue',
    'better stop', 'better end', 'better hang up', 'better leave',
    
    // Alemán
    'ja', 'richtig', 'bestätigen', 'perfekt', 'gut', 'okay', 'genau',
    'das stimmt', 'einverstanden', 'bestätigt', 'akzeptieren',
    'will stornieren', 'möchte stornieren', 'besser stornieren',
    'eigentlich nicht', 'besser nicht', 'meinung geändert',
    'nicht interessiert', 'nicht überzeugt', 'besser aufhören',
    
    // Italiano
    'sì', 'si', 'corretto', 'confermo', 'perfetto', 'bene', 'okay', 'ok',
    'va bene', 'd\'accordo', 'confermato', 'accetto',
    'vuole cancellare', 'meglio cancellare', 'cambiato idea',
    'non interessato', 'meglio fermare',
    
    // Francés
    'oui', 'correct', 'confirmer', 'parfait', 'bien', 'd\'accord',
    'veut annuler', 'mieux annuler', 'changé d\'avis',
    'pas intéressé', 'mieux arrêter',
    
    // Portugués
    'sim', 'correto', 'confirmo', 'perfeito', 'bem', 'okay',
    'quer cancelar', 'melhor cancelar', 'mudou de ideia',
    'não interessado', 'melhor parar'
  ];
  
  // Palabras de negación (NO quiero cancelar)
  const noWords = [
    // Español
    'no', 'incorrecto', 'mal', 'error', 'no es', 'no está bien', 'no me parece',
    'discrepo', 'no acepto', 'no quiero cancelar', 'no necesito cancelar',
    'mejor continúo', 'mejor sigo', 'mejor procedo', 'mejor adelante',
    'quiero continuar', 'necesito continuar', 'deseo continuar',
    'mejor sigo adelante', 'mejor continúo adelante', 'mejor procedo adelante',
    'no cancelo', 'no cancelar', 'no quiero cancelar', 'no necesito cancelar',
    'mejor no cancelo', 'mejor no cancelar', 'mejor no quiero cancelar',
    
    // Inglés
    'no', 'incorrect', 'wrong', 'error', 'not right', 'not correct',
    'disagree', 'don\'t accept', 'don\'t want to cancel', 'don\'t need to cancel',
    'better continue', 'better proceed', 'better go ahead',
    'want to continue', 'need to continue', 'wish to continue',
    'don\'t cancel', 'don\'t want to cancel', 'don\'t need to cancel',
    
    // Alemán
    'nein', 'falsch', 'fehler', 'nicht richtig', 'nicht korrekt',
    'nicht einverstanden', 'nicht akzeptieren', 'nicht stornieren',
    'besser fortfahren', 'besser fortgesetzt', 'besser weiter',
    'will fortfahren', 'möchte fortfahren', 'nicht stornieren',
    
    // Italiano
    'no', 'sbagliato', 'errore', 'non è giusto', 'non va bene',
    'non accetto', 'non vuole cancellare', 'meglio continuare',
    'vuole continuare', 'non cancellare',
    
    // Francés
    'non', 'incorrect', 'faux', 'erreur', 'pas correct',
    'pas d\'accord', 'ne veut pas annuler', 'mieux continuer',
    'veut continuer', 'ne pas annuler',
    
    // Portugués
    'não', 'incorreto', 'errado', 'erro', 'não está certo',
    'não concordo', 'não quer cancelar', 'melhor continuar',
    'quer continuar', 'não cancelar'
  ];
  
  // Verificar confirmación positiva
  const hasYesWords = yesWords.some(word => lowerText.includes(word));
  const hasNoWords = noWords.some(word => lowerText.includes(word));
  
  console.log(`🔍 [DEBUG] detectCancellationConfirmation - Texto: "${text}"`);
  console.log(`🔍 [DEBUG] - Palabras SÍ encontradas: ${hasYesWords}`);
  console.log(`🔍 [DEBUG] - Palabras NO encontradas: ${hasNoWords}`);
  
  if (hasYesWords && !hasNoWords) {
    return 'yes';
  } else if (hasNoWords && !hasYesWords) {
    return 'no';
  } else {
    return 'unclear';
  }
}
function isCancellationRequest(text) {
  if (!text || text.trim().length < 3) {
    return false; // Inputs muy cortos no son cancelaciones
  }
  
  // CRÍTICO: Definir lowerText al inicio para que esté disponible en toda la función
  const lowerText = text.toLowerCase().trim();
  
  // Excluir frases que contienen "no" pero no son cancelaciones
  // MEJORADO: Agregar patrones para TODOS los idiomas para evitar falsos positivos
  const falsePositivePatterns = [
    // ===== ESPAÑOL - Patrones relacionados con nombres =====
    /a nombre de/i,
    /nombre de/i,
    /a nombre/i,
    /el nombre/i,
    /los nombres/i,
    /los nombres de/i,
    /un nombre/i,
    /una nombre/i,
    /mi nombre/i,
    /su nombre/i,
    /sus nombres/i,
    /cual.*nombre/i,
    /que nombre/i,
    /que nombres/i,
    /nombre.*es/i,
    /nombres.*son/i,
    /nombre.*ser/i,
    /nombres.*ser/i,
    /nombre.*llama/i,
    /nombres.*llaman/i,
    /me llamo/i,
    /se llama/i,
    /se llaman/i,
    /llamarse/i,
    /llamarnos/i,
    /^a nombre de\s*$/i,
    /^nombre de\s*$/i,
    /^los nombres de\s*$/i,
    /^el nombre de\s*$/i,
    /^un nombre de\s*$/i,
    /^una nombre de\s*$/i,
    /^mi nombre de\s*$/i,
    /^su nombre de\s*$/i,
    /^sus nombres de\s*$/i,
    
    // ===== INGLÉS - Patrones relacionados con nombres =====
    /under.*name/i,
    /name.*of/i,
    /my name/i,
    /your name/i,
    /his name/i,
    /her name/i,
    /their name/i,
    /their names/i,
    /what.*name/i,
    /which.*name/i,
    /name.*is/i,
    /names.*are/i,
    /name.*to/i,
    /call.*me/i,
    /i am/i,
    /i'm/i,
    /my name is/i,
    /call me/i,
    /named/i,
    /^under name\s*$/i,
    /^name of\s*$/i,
    /^my name\s*$/i,
    /^your name\s*$/i,
    /^the name\s*$/i,
    /^a name\s*$/i,
    /^the name of\s*$/i,
    /^a name of\s*$/i,
    
    // ===== ALEMÁN - Patrones relacionados con nombres =====
    /unter.*namen/i,
    /name.*von/i,
    /mein name/i,
    /dein name/i,
    /sein name/i,
    /ihr name/i,
    /ihre name/i,
    /welcher.*name/i,
    /was.*name/i,
    /name.*ist/i,
    /namen.*sind/i,
    /ich heiße/i,
    /ich heisse/i,
    /heiße/i,
    /heisse/i,
    /^unter namen\s*$/i,
    /^name von\s*$/i,
    /^mein name\s*$/i,
    /^dein name\s*$/i,
    /^der name\s*$/i,
    /^ein name\s*$/i,
    /^der name von\s*$/i,
    /^ein name von\s*$/i,
    
    // ===== ITALIANO - Patrones relacionados con nombres =====
    /sotto.*nome/i,
    /nome.*di/i,
    /il nome/i,
    /i nomi/i,
    /un nome/i,
    /una nome/i,
    /mio nome/i,
    /tuo nome/i,
    /suo nome/i,
    /loro nome/i,
    /loro nomi/i,
    /qual.*nome/i,
    /che nome/i,
    /nome.*è/i,
    /nomi.*sono/i,
    /mi chiamo/i,
    /si chiama/i,
    /si chiamano/i,
    /chiamarsi/i,
    /chiamarci/i,
    /^sotto nome\s*$/i,
    /^nome di\s*$/i,
    /^il nome\s*$/i,
    /^i nomi\s*$/i,
    /^un nome\s*$/i,
    /^una nome\s*$/i,
    /^mio nome\s*$/i,
    /^tuo nome\s*$/i,
    /^suo nome\s*$/i,
    /^loro nome\s*$/i,
    /^loro nomi\s*$/i,
    
    // ===== FRANCÉS - Patrones relacionados con nombres =====
    /sous.*nom/i,
    /nom.*de/i,
    /le nom/i,
    /les noms/i,
    /un nom/i,
    /une nom/i,
    /mon nom/i,
    /ton nom/i,
    /son nom/i,
    /leur nom/i,
    /leurs noms/i,
    /quel.*nom/i,
    /que nom/i,
    /nom.*est/i,
    /noms.*sont/i,
    /je m'appelle/i,
    /je m'appelle/i,
    /s'appelle/i,
    /s'appellent/i,
    /^sous nom\s*$/i,
    /^nom de\s*$/i,
    /^le nom\s*$/i,
    /^les noms\s*$/i,
    /^un nom\s*$/i,
    /^une nom\s*$/i,
    /^mon nom\s*$/i,
    /^ton nom\s*$/i,
    /^son nom\s*$/i,
    /^leur nom\s*$/i,
    /^leurs noms\s*$/i,
    
    // ===== PORTUGUÉS - Patrones relacionados con nombres =====
    /sob.*nome/i,
    /nome.*de/i,
    /o nome/i,
    /os nomes/i,
    /um nome/i,
    /uma nome/i,
    /meu nome/i,
    /seu nome/i,
    /nosso nome/i,
    /nossos nomes/i,
    /qual.*nome/i,
    /que nome/i,
    /nome.*é/i,
    /nomes.*são/i,
    /me chamo/i,
    /se chama/i,
    /se chamam/i,
    /chamar-se/i,
    /chamar-nos/i,
    /^sob nome\s*$/i,
    /^nome de\s*$/i,
    /^o nome\s*$/i,
    /^os nomes\s*$/i,
    /^um nome\s*$/i,
    /^uma nome\s*$/i,
    /^meu nome\s*$/i,
    /^seu nome\s*$/i,
    /^nosso nome\s*$/i,
    /^nossos nomes\s*$/i,
    
    // ===== PATRONES DE "NO PUEDO" / "CAN'T" / "CANNOT" - TODOS LOS IDIOMAS =====
    // Español
    /no puedo definir/i, /no puedo decir/i, /no puedo especificar/i, /no puedo indicar/i,
    /no puedo determinar/i, /no puedo precisar/i, /no puedo confirmar/i, /no puedo recordar/i,
    /no puedo pensar/i, /no puedo decidir/i, /no puedo elegir/i, /no puedo seleccionar/i,
    /no puedo encontrar/i, /no puedo localizar/i, /no puedo ver/i, /no puedo escuchar/i,
    /no puedo oír/i, /no puedo entender/i, /no puedo comprender/i, /no puedo procesar/i,
    /no puedo calcular/i, /no puedo resolver/i, /no puedo solucionar/i, /no puedo hacer/i,
    /no puedo realizar/i, /no puedo ejecutar/i, /no puedo completar/i, /no puedo terminar/i,
    /no puedo finalizar/i, /no puedo acabar/i, /no puedo concluir/i, /no puedo cerrar/i,
    /no puedo abrir/i, /no puedo iniciar/i, /no puedo comenzar/i, /no puedo empezar/i,
    /no puedo continuar/i, /no puedo seguir/i, /no puedo avanzar/i, /no puedo proseguir/i,
    /no puedo proceder/i,
    
    // Inglés
    /can't define/i, /can't say/i, /can't specify/i, /can't indicate/i,
    /can't determine/i, /can't confirm/i, /can't remember/i, /can't think/i,
    /can't decide/i, /can't choose/i, /can't select/i, /can't find/i,
    /can't locate/i, /can't see/i, /can't hear/i, /can't understand/i,
    /can't comprehend/i, /can't process/i, /can't calculate/i, /can't solve/i,
    /can't do/i, /can't perform/i, /can't execute/i, /can't complete/i,
    /can't finish/i, /can't conclude/i, /can't close/i, /can't open/i,
    /can't start/i, /can't begin/i, /can't continue/i, /can't proceed/i,
    /cannot define/i, /cannot say/i, /cannot specify/i, /cannot indicate/i,
    /cannot determine/i, /cannot confirm/i, /cannot remember/i, /cannot think/i,
    /cannot decide/i, /cannot choose/i, /cannot select/i, /cannot find/i,
    /cannot locate/i, /cannot see/i, /cannot hear/i, /cannot understand/i,
    /cannot comprehend/i, /cannot process/i, /cannot calculate/i, /cannot solve/i,
    /cannot do/i, /cannot perform/i, /cannot execute/i, /cannot complete/i,
    /cannot finish/i, /cannot conclude/i, /cannot close/i, /cannot open/i,
    /cannot start/i, /cannot begin/i, /cannot continue/i, /cannot proceed/i,
    
    // Alemán
    /kann nicht definieren/i, /kann nicht sagen/i, /kann nicht angeben/i, /kann nicht bestimmen/i,
    /kann nicht bestätigen/i, /kann nicht denken/i, /kann nicht entscheiden/i, /kann nicht wählen/i,
    /kann nicht finden/i, /kann nicht sehen/i, /kann nicht hören/i, /kann nicht verstehen/i,
    /kann nicht verarbeiten/i, /kann nicht berechnen/i, /kann nicht lösen/i, /kann nicht tun/i,
    /kann nicht ausführen/i, /kann nicht abschließen/i, /kann nicht beenden/i, /kann nicht öffnen/i,
    /kann nicht schließen/i, /kann nicht starten/i, /kann nicht beginnen/i, /kann nicht fortfahren/i,
    
    // Italiano
    /non posso definire/i, /non posso dire/i, /non posso specificare/i, /non posso indicare/i,
    /non posso determinare/i, /non posso confermare/i, /non posso ricordare/i, /non posso pensare/i,
    /non posso decidere/i, /non posso scegliere/i, /non posso selezionare/i, /non posso trovare/i,
    /non posso localizzare/i, /non posso vedere/i, /non posso sentire/i, /non posso capire/i,
    /non posso comprendere/i, /non posso elaborare/i, /non posso calcolare/i, /non posso risolvere/i,
    /non posso fare/i, /non posso eseguire/i, /non posso completare/i, /non posso terminare/i,
    /non posso concludere/i, /non posso chiudere/i, /non posso aprire/i, /non posso iniziare/i,
    /non posso cominciare/i, /non posso continuare/i, /non posso procedere/i,
    
    // Francés
    /ne peux pas définir/i, /ne peux pas dire/i, /ne peux pas spécifier/i, /ne peux pas indiquer/i,
    /ne peux pas déterminer/i, /ne peux pas confirmer/i, /ne peux pas me souvenir/i, /ne peux pas penser/i,
    /ne peux pas décider/i, /ne peux pas choisir/i, /ne peux pas sélectionner/i, /ne peux pas trouver/i,
    /ne peux pas localiser/i, /ne peux pas voir/i, /ne peux pas entendre/i, /ne peux pas comprendre/i,
    /ne peux pas traiter/i, /ne peux pas calculer/i, /ne peux pas résoudre/i, /ne peux pas faire/i,
    /ne peux pas exécuter/i, /ne peux pas compléter/i, /ne peux pas terminer/i, /ne peux pas conclure/i,
    /ne peux pas fermer/i, /ne peux pas ouvrir/i, /ne peux pas commencer/i, /ne peux pas continuer/i,
    /ne peux pas procéder/i,
    
    // Portugués
    /não posso definir/i, /não posso dizer/i, /não posso especificar/i, /não posso indicar/i,
    /não posso determinar/i, /não posso confirmar/i, /não posso lembrar/i, /não posso pensar/i,
    /não posso decidir/i, /não posso escolher/i, /não posso selecionar/i, /não posso encontrar/i,
    /não posso localizar/i, /não posso ver/i, /não posso ouvir/i, /não posso entender/i,
    /não posso compreender/i, /não posso processar/i, /não posso calcular/i, /não posso resolver/i,
    /não posso fazer/i, /não posso executar/i, /não posso completar/i, /não posso terminar/i,
    /não posso concluir/i, /não posso fechar/i, /não posso abrir/i, /não posso iniciar/i,
    /não posso começar/i, /não posso continuar/i, /não posso proceder/i,
  ];
  
  // Si coincide con un patrón de falso positivo, NO es cancelación
  // MEJORADO: Verificar primero los patrones más específicos (frases completas)
  const isFalsePositive = falsePositivePatterns.some(pattern => {
    const match = pattern.test(text);
    if (match) {
      console.log(`🔍 [DEBUG] Patrón de falso positivo detectado: ${pattern}, NO es cancelación`);
    }
    return match;
  });
  
  if (isFalsePositive) {
    console.log(`🔍 [DEBUG] Patrón de falso positivo detectado, NO es cancelación`);
    return false;
  }
  
  // MEJORADO: Verificar también si el texto contiene palabras relacionadas con nombres
  // pero NO contiene palabras explícitas de cancelación
  // Esto evita falsos positivos con "nombres", "nombre", "name", "nome", "nom", etc.
  // EN TODOS LOS IDIOMAS
  const nameRelatedWords = [
    // Español
    'nombre', 'nombres', 'llamo', 'llama', 'llamamos', 'llaman', 'llamarse', 'llamarnos',
    // Inglés
    'name', 'names', 'named', 'calling', 'call me', 'i am', 'i\'m',
    // Alemán
    'name', 'namen', 'heiße', 'heisse', 'heissen', 'heißt', 'heisst',
    // Italiano
    'nome', 'nomi', 'chiamo', 'chiama', 'chiamano', 'chiamarsi', 'chiamarci',
    // Francés
    'nom', 'noms', 'appelle', 'appelles', 'appellent', 's\'appelle', 's\'appellent',
    // Portugués
    'nome', 'nomes', 'chamo', 'chama', 'chamam', 'chamar-se', 'chamar-nos'
  ];
  
  const hasNameRelatedWord = nameRelatedWords.some(word => {
    // Para palabras compuestas (como "call me", "i am"), buscar la frase completa
    if (word.includes(' ') || word.includes('\'')) {
      // Frase compuesta, buscar como substring pero con contexto
      return lowerText.includes(word.toLowerCase());
    } else {
      // Palabra simple, buscar como palabra completa (no substring)
      // Esto evita que "nombres" detecte "no" dentro de "nombres"
      const wordRegex = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[.,!?;:])`, 'i');
      return wordRegex.test(lowerText);
    }
  });
  
  // Si contiene palabras relacionadas con nombres Y NO contiene palabras explícitas de cancelación,
  // NO es cancelación
  if (hasNameRelatedWord) {
    // Palabras explícitas de cancelación en TODOS los idiomas
    const explicitCancellationWords = [
      // Español
      'cancelar', 'cancelación', 'cancelar reserva', 'cancelar mesa',
      // Inglés
      'cancel', 'cancellation', 'cancel reservation', 'cancel table',
      // Alemán
      'stornieren', 'stornierung', 'storniere', 'reservierung stornieren',
      // Italiano
      'cancellare', 'cancellazione', 'cancellare prenotazione', 'cancellare tavolo',
      // Francés
      'annuler', 'annulation', 'annuler réservation', 'annuler table',
      // Portugués
      'cancelar', 'cancelamento', 'cancelar reserva', 'cancelar mesa'
    ];
    
    const hasExplicitCancellation = explicitCancellationWords.some(word => 
      lowerText.includes(word.toLowerCase())
    );
    
    if (!hasExplicitCancellation) {
      console.log(`🔍 [DEBUG] Texto contiene palabras relacionadas con nombres ("${text}"), pero NO contiene palabras explícitas de cancelación. NO es cancelación.`);
      return false;
    }
  }
  
  const cancellationWords = [
    // ESPAÑOL - Expresiones de cancelación (palabras simples y comunes)
    'cancelar', 'cancelación', 'no quiero', 'no necesito', 'no voy a', 'no voy',
    'al final no', 'mejor no', 'no gracias', 'no quiero reservar', 'no necesito reservar',
    'no voy a reservar', 'no voy a hacer', 'no voy a hacer reserva', 'no voy a reservar mesa',
    'mejor cancelo', 'quiero cancelar', 'necesito cancelar', 'deseo cancelar',
    'no me interesa', 'no me convence', 'cambié de opinión', 'cambie de opinion',
    'ya no quiero', 'ya no necesito', 'ya no voy', 'ya no voy a', 'ya no voy a reservar',
    'mejor otro día', 'mejor después', 'mejor más tarde', 'mejor en otro momento',
    'no está bien', 'no esta bien', 'no me parece bien', 'no me gusta',
    'no me conviene', 'no me sirve', 'no me funciona', 'no me interesa',
    'mejor no hago', 'mejor no reservo', 'mejor no hago reserva', 'mejor no reservo mesa',
    'no gracias', 'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'no quiero continuar', 'no quiero seguir', 'no quiero proceder', 'no quiero seguir adelante',
    'mejor paro', 'mejor paro aquí', 'mejor paro acá', 'mejor paro ahora',
    'mejor termino', 'mejor termino aquí', 'mejor termino acá', 'mejor termino ahora',
    'mejor cuelgo', 'mejor cuelgo aquí', 'mejor cuelgo acá', 'mejor cuelgo ahora',
    'mejor me voy', 'mejor me voy ahora', 'mejor me voy aquí', 'mejor me voy acá',
    'mejor me despido', 'mejor me despido ahora', 'mejor me despido aquí', 'mejor me despido acá',
    'mejor me retiro', 'mejor me retiro ahora', 'mejor me retiro aquí', 'mejor me retiro acá',
    'mejor me voy a ir', 'mejor me voy a ir ahora', 'mejor me voy a ir aquí', 'mejor me voy a ir acá',
    'mejor me voy a despedir', 'mejor me voy a despedir ahora', 'mejor me voy a despedir aquí', 'mejor me voy a despedir acá',
    'mejor me voy a retirar', 'mejor me voy a retirar ahora', 'mejor me voy a retirar aquí', 'mejor me voy a retirar acá',
    
    // PALABRAS SIMPLES Y COMUNES QUE LA GENTE USA
    // NOTA: 'no' está removido de la lista para evitar falsos positivos con "nombres", "nombre", etc.
    // Solo se buscan patrones con contexto como "no quiero", "no necesito", etc.
    'no quiero', 'no necesito', 'no voy', 'no voy a', 'no voy a hacer',
    'mejor no', 'mejor no hago', 'mejor no reservo', 'mejor no hago reserva',
    'al final no', 'al final no quiero', 'al final no necesito', 'al final no voy',
    'ya no', 'ya no quiero', 'ya no necesito', 'ya no voy', 'ya no voy a',
    'cambié de opinión', 'cambie de opinion', 'cambié de idea', 'cambie de idea',
    'mejor cancelo', 'quiero cancelar', 'necesito cancelar', 'deseo cancelar',
    'no me interesa', 'no me convence', 'no me gusta', 'no me conviene',
    'no me sirve', 'no me funciona', 'no me interesa', 'no me parece bien',
    'no está bien', 'no esta bien', 'no me parece bien', 'no me gusta',
    'mejor otro día', 'mejor después', 'mejor más tarde', 'mejor en otro momento',
    'mejor no hago', 'mejor no reservo', 'mejor no hago reserva', 'mejor no reservo mesa',
    'no gracias', 'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'no quiero continuar', 'no quiero seguir', 'no quiero proceder', 'no quiero seguir adelante',
    'mejor paro', 'mejor paro aquí', 'mejor paro acá', 'mejor paro ahora',
    'mejor termino', 'mejor termino aquí', 'mejor termino acá', 'mejor termino ahora',
    'mejor cuelgo', 'mejor cuelgo aquí', 'mejor cuelgo acá', 'mejor cuelgo ahora',
    'mejor me voy', 'mejor me voy ahora', 'mejor me voy aquí', 'mejor me voy acá',
    'mejor me despido', 'mejor me despido ahora', 'mejor me despido aquí', 'mejor me despido acá',
    'mejor me retiro', 'mejor me retiro ahora', 'mejor me retiro aquí', 'mejor me retiro acá',
    
    // INGLÉS - Expresiones de cancelación
    'cancel', 'cancellation', 'don\'t want', 'don\'t need', 'not going to', 'not going',
    'actually no', 'better not', 'no thanks', 'don\'t want to book', 'don\'t need to book',
    'not going to book', 'not going to make', 'not going to make reservation', 'not going to book table',
    'better cancel', 'want to cancel', 'need to cancel', 'wish to cancel',
    'not interested', 'not convinced', 'changed my mind', 'change my mind',
    'don\'t want anymore', 'don\'t need anymore', 'not going anymore', 'not going to anymore',
    'better another day', 'better later', 'better another time', 'better some other time',
    'not good', 'not right', 'not suitable', 'not convenient', 'not working', 'not interested',
    'better not do', 'better not book', 'better not make reservation', 'better not book table',
    'no thank you', 'no thanks', 'no thank', 'no thank you very much',
    'don\'t want to continue', 'don\'t want to proceed', 'don\'t want to go ahead',
    'better stop', 'better stop here', 'better stop now',
    'better end', 'better end here', 'better end now',
    'better hang up', 'better hang up now',
    'better go', 'better go now', 'better leave', 'better leave now',
    'better say goodbye', 'better say goodbye now',
    'better withdraw', 'better withdraw now',
    
    // ALEMÁN - Expresiones de cancelación
    'stornieren', 'stornierung', 'nicht wollen', 'nicht brauchen', 'nicht gehen', 'nicht gehen zu',
    'eigentlich nicht', 'besser nicht', 'nein danke', 'nicht reservieren wollen', 'nicht reservieren brauchen',
    'nicht reservieren gehen', 'nicht machen gehen', 'nicht reservierung machen gehen', 'nicht tisch reservieren gehen',
    'besser stornieren', 'stornieren wollen', 'stornieren brauchen', 'stornieren wünschen',
    'nicht interessiert', 'nicht überzeugt', 'meinung geändert', 'meinung ändern',
    'nicht mehr wollen', 'nicht mehr brauchen', 'nicht mehr gehen', 'nicht mehr gehen zu',
    'besser anderen tag', 'besser später', 'besser andere zeit', 'besser andere zeit',
    'nicht gut', 'nicht richtig', 'nicht geeignet', 'nicht bequem', 'nicht funktioniert', 'nicht interessiert',
    'besser nicht machen', 'besser nicht buchen', 'besser nicht reservierung machen', 'besser nicht tisch buchen',
    'nein danke', 'nein danke sehr',
    'nicht weiter machen wollen', 'nicht fortfahren wollen', 'nicht vorwärts gehen wollen',
    'besser aufhören', 'besser hier aufhören', 'besser jetzt aufhören',
    'besser beenden', 'besser hier beenden', 'besser jetzt beenden',
    'besser auflegen', 'besser jetzt auflegen',
    'besser gehen', 'besser jetzt gehen', 'besser verlassen', 'besser jetzt verlassen',
    'besser verabschieden', 'besser jetzt verabschieden',
    'besser zurückziehen', 'besser jetzt zurückziehen',
    
    // ITALIANO - Expresiones de cancelación
    'cancellare', 'cancellazione', 'non voglio', 'non ho bisogno', 'non vado', 'non vado a',
    'in realtà no', 'meglio no', 'no grazie', 'non voglio prenotare', 'non ho bisogno di prenotare',
    'non vado a prenotare', 'non vado a fare', 'non vado a fare prenotazione', 'non vado a prenotare tavolo',
    'meglio cancellare', 'voglio cancellare', 'ho bisogno di cancellare', 'desidero cancellare',
    'non interessato', 'non convinto', 'cambiato idea', 'cambiare idea',
    'non voglio più', 'non ho più bisogno', 'non vado più', 'non vado più a',
    'meglio un altro giorno', 'meglio dopo', 'meglio un\'altra volta', 'meglio un altro momento',
    'non va bene', 'non è giusto', 'non è adatto', 'non è conveniente', 'non funziona', 'non interessato',
    'meglio non fare', 'meglio non prenotare', 'meglio non fare prenotazione', 'meglio non prenotare tavolo',
    'no grazie', 'no grazie molto',
    'non voglio continuare', 'non voglio procedere', 'non voglio andare avanti',
    'meglio fermarsi', 'meglio fermarsi qui', 'meglio fermarsi ora',
    'meglio finire', 'meglio finire qui', 'meglio finire ora',
    'meglio riattaccare', 'meglio riattaccare ora',
    'meglio andare', 'meglio andare ora', 'meglio lasciare', 'meglio lasciare ora',
    'meglio salutare', 'meglio salutare ora',
    'meglio ritirarsi', 'meglio ritirarsi ora'
  ];
  
  // lowerText ya está definido al inicio de la función
  
  console.log(`🔍 [DEBUG] isCancellationRequest - Analizando: "${text}"`);
  console.log(`🔍 [DEBUG] Texto en minúsculas: "${lowerText}"`);
  
  // CRÍTICO: Verificar que "no" no esté dentro de palabras relacionadas con nombres
  // Esta verificación debe hacerse ANTES de buscar palabras de cancelación
  // Por ejemplo, "nombres" contiene "no", pero "no" no es una palabra completa aquí
  // EN TODOS LOS IDIOMAS - Solo palabras que REALMENTE contienen "no" o "nom"
  // NOTA: "name" NO contiene "no", así que NO se incluye aquí
  const nameWordsContainingNoPattern = /(^|\s)(nombres?|nomi|noms|nomes|nom)(\s|$|[.,!?;:])/i;
  const hasNameWordContainingNo = nameWordsContainingNoPattern.test(text);
  
  if (hasNameWordContainingNo) {
    // Si el texto contiene palabras de nombres que incluyen "no" o "nom", 
    // pero NO contiene palabras explícitas de cancelación, NO es cancelación
    const explicitCancellationWords = [
      // Español
      'cancelar', 'cancelación', 'cancelar reserva', 'cancelar mesa',
      // Inglés
      'cancel', 'cancellation', 'cancel reservation', 'cancel table',
      // Alemán
      'stornieren', 'stornierung', 'storniere', 'reservierung stornieren',
      // Italiano
      'cancellare', 'cancellazione', 'cancellare prenotazione', 'cancellare tavolo',
      // Francés
      'annuler', 'annulation', 'annuler réservation', 'annuler table',
      // Portugués
      'cancelar', 'cancelamento', 'cancelar reserva', 'cancelar mesa'
    ];
    const hasExplicitCancellation = explicitCancellationWords.some(word => 
      lowerText.includes(word.toLowerCase())
    );
    
    if (!hasExplicitCancellation) {
      console.log(`🔍 [DEBUG] Texto contiene palabras de nombres que incluyen "no" o "nom" ("${text}"), pero NO contiene palabras explícitas de cancelación. NO es cancelación.`);
      return false;
    }
  }
  
  // MEJORADO: Buscar palabras completas, no substrings, para evitar falsos positivos
  // Por ejemplo, "nombres" contiene "no", pero "no" no es una palabra completa en "nombres"
  // Crear regex para buscar palabras completas (separadas por espacios o al inicio/final)
  const hasCancellationWords = cancellationWords.some(word => {
    // Si la palabra es muy corta (1-2 caracteres), usar búsqueda más estricta
    // CRÍTICO: Si la palabra es "no" o contiene "no", verificar que NO esté dentro de una palabra de nombre
    if (word.length <= 2) {
      // Para palabras cortas como "no", "non", "nein", "não", buscar solo si está al inicio o después de un espacio
      // y seguida de un espacio o al final, PERO verificar que NO esté dentro de una palabra de nombre
      const wordRegex = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[.,!?;:])`, 'i');
      const matches = wordRegex.test(lowerText);
      
      // Si coincide con "no", "non", "nein", "não", verificar que NO esté dentro de una palabra de nombre
      // EN TODOS LOS IDIOMAS
      if (matches && (word === 'no' || word === 'non' || word === 'nein' || word === 'não')) {
        // Verificar si hay palabras de nombres en el texto (solo las que contienen "no" o "nom")
        // NOTA: "name" NO contiene "no", así que NO se incluye aquí
        const nameWordsPattern = /(^|\s)(nombres?|nomi|noms|nomes|nom)(\s|$|[.,!?;:])/i;
        if (nameWordsPattern.test(text)) {
          // Si hay palabras de nombres, verificar que "no" no esté cerca de ellas
          const words = text.toLowerCase().split(/\s+/);
          const nameWordIndices = words
            .map((w, i) => /^(nombres?|nomi|noms|nomes|nom)$/.test(w) ? i : -1)
            .filter(i => i !== -1);
          const noWordIndex = words.findIndex(w => w === word.toLowerCase());
          
          // Si "no" está cerca de una palabra de nombre (dentro de 2 palabras), probablemente es parte del nombre
          if (noWordIndex !== -1 && nameWordIndices.some(idx => Math.abs(idx - noWordIndex) <= 2)) {
            // Verificar si hay palabras explícitas de cancelación
            const explicitCancellationWords = [
              // Español
              'cancelar', 'cancelación', 'cancelar reserva', 'cancelar mesa',
              // Inglés
              'cancel', 'cancellation', 'cancel reservation', 'cancel table',
              // Alemán
              'stornieren', 'stornierung', 'storniere', 'reservierung stornieren',
              // Italiano
              'cancellare', 'cancellazione', 'cancellare prenotazione', 'cancellare tavolo',
              // Francés
              'annuler', 'annulation', 'annuler réservation', 'annuler table',
              // Portugués
              'cancelar', 'cancelamento', 'cancelar reserva', 'cancelar mesa'
            ];
            const hasExplicitCancellation = explicitCancellationWords.some(cancelWord => 
              lowerText.includes(cancelWord.toLowerCase())
            );
            if (!hasExplicitCancellation) {
              console.log(`🔍 [DEBUG] "${word}" está cerca de palabras de nombres ("${text}"), pero NO contiene palabras explícitas de cancelación. NO es cancelación.`);
              return false; // No es cancelación
            }
          }
        }
      }
      
      return matches;
    } else {
      // Para palabras más largas, buscar como palabra completa o como substring solo si es explícito
      // Primero intentar como palabra completa
      const wordRegex = new RegExp(`(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|[.,!?;:])`, 'i');
      if (wordRegex.test(lowerText)) {
        return true;
      }
      // Si no se encuentra como palabra completa, buscar como substring solo si la palabra es larga (>4 caracteres)
      // Esto evita falsos positivos con palabras cortas
      if (word.length > 4) {
        return lowerText.includes(word);
      }
      return false;
    }
  });
  console.log(`🔍 [DEBUG] Palabras de cancelación encontradas: ${hasCancellationWords}`);
  
  // Buscar patrones simples de cancelación (más flexibles)
  const simpleCancellationPatterns = [
    // Patrones simples en español
    /quiero\s+cancelar/i,
    /necesito\s+cancelar/i,
    /deseo\s+cancelar/i,
    /mejor\s+cancelo/i,
    /mejor\s+no/i,
    /al\s+final\s+no/i,
    /ya\s+no\s+quiero/i,
    /ya\s+no\s+necesito/i,
    /ya\s+no\s+voy/i,
    /cambié\s+de\s+opinión/i,
    /cambie\s+de\s+opinion/i,
    /cambié\s+de\s+idea/i,
    /cambie\s+de\s+idea/i,
    /no\s+me\s+interesa/i,
    /no\s+me\s+convence/i,
    /no\s+me\s+gusta/i,
    /no\s+me\s+conviene/i,
    /no\s+quiero\s+continuar/i,
    /no\s+quiero\s+seguir/i,
    /mejor\s+paro/i,
    /mejor\s+termino/i,
    /mejor\s+cuelgo/i,
    /mejor\s+me\s+voy/i,
    /mejor\s+me\s+despido/i,
    /mejor\s+me\s+retiro/i,
    
    // Patrones simples en inglés
    /want\s+to\s+cancel/i,
    /need\s+to\s+cancel/i,
    /wish\s+to\s+cancel/i,
    /better\s+cancel/i,
    /better\s+not/i,
    /actually\s+no/i,
    /changed\s+my\s+mind/i,
    /change\s+my\s+mind/i,
    /not\s+interested/i,
    /not\s+convinced/i,
    /don\'t\s+want\s+to\s+continue/i,
    /don\'t\s+want\s+to\s+proceed/i,
    /better\s+stop/i,
    /better\s+end/i,
    /better\s+hang\s+up/i,
    /better\s+leave/i,
    /better\s+go/i
  ];
  
  const hasSimplePatterns = simpleCancellationPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones simples de cancelación encontrados: ${hasSimplePatterns}`);
  
  // Buscar patrones de frases comunes de cancelación
  const cancellationPatterns = [
    // Patrones en español
    /no\s+quiero\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /no\s+necesito\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /no\s+voy\s+a\s+(?:hacer\s+)?(?:la\s+)?reserva/i,
    /al\s+final\s+no/i,
    /mejor\s+no/i,
    /cambié\s+de\s+opinión/i,
    /ya\s+no\s+quiero/i,
    /mejor\s+cancelo/i,
    /quiero\s+cancelar/i,
    /necesito\s+cancelar/i,
    /deseo\s+cancelar/i,
    /no\s+me\s+interesa/i,
    /no\s+me\s+convence/i,
    /no\s+me\s+gusta/i,
    /no\s+me\s+conviene/i,
    /no\s+me\s+sirve/i,
    /no\s+me\s+funciona/i,
    /mejor\s+no\s+hago/i,
    /mejor\s+no\s+reservo/i,
    /mejor\s+no\s+hago\s+reserva/i,
    /mejor\s+no\s+reservo\s+mesa/i,
    /no\s+quiero\s+continuar/i,
    /no\s+quiero\s+seguir/i,
    /no\s+quiero\s+proceder/i,
    /no\s+quiero\s+seguir\s+adelante/i,
    /mejor\s+paro/i,
    /mejor\s+termino/i,
    /mejor\s+cuelgo/i,
    /mejor\s+me\s+voy/i,
    /mejor\s+me\s+despido/i,
    /mejor\s+me\s+retiro/i,
    
    // Patrones en inglés
    /don\'t\s+want\s+to\s+(?:book|make\s+reservation)/i,
    /don\'t\s+need\s+to\s+(?:book|make\s+reservation)/i,
    /not\s+going\s+to\s+(?:book|make\s+reservation)/i,
    /actually\s+no/i,
    /better\s+not/i,
    /changed\s+my\s+mind/i,
    /don\'t\s+want\s+anymore/i,
    /don\'t\s+need\s+anymore/i,
    /not\s+going\s+anymore/i,
    /better\s+cancel/i,
    /want\s+to\s+cancel/i,
    /need\s+to\s+cancel/i,
    /wish\s+to\s+cancel/i,
    /not\s+interested/i,
    /not\s+convinced/i,
    /not\s+good/i,
    /not\s+right/i,
    /not\s+suitable/i,
    /not\s+convenient/i,
    /not\s+working/i,
    /better\s+not\s+do/i,
    /better\s+not\s+book/i,
    /better\s+not\s+make\s+reservation/i,
    /better\s+not\s+book\s+table/i,
    /don\'t\s+want\s+to\s+continue/i,
    /don\'t\s+want\s+to\s+proceed/i,
    /don\'t\s+want\s+to\s+go\s+ahead/i,
    /better\s+stop/i,
    /better\s+end/i,
    /better\s+hang\s+up/i,
    /better\s+go/i,
    /better\s+leave/i,
    /better\s+say\s+goodbye/i,
    /better\s+withdraw/i,
    
    // Patrones en alemán
    /nicht\s+reservieren\s+wollen/i,
    /nicht\s+reservieren\s+brauchen/i,
    /nicht\s+reservieren\s+gehen/i,
    /nicht\s+machen\s+gehen/i,
    /nicht\s+reservierung\s+machen\s+gehen/i,
    /nicht\s+tisch\s+reservieren\s+gehen/i,
    /eigentlich\s+nicht/i,
    /besser\s+nicht/i,
    /meinung\s+geändert/i,
    /meinung\s+ändern/i,
    /nicht\s+mehr\s+wollen/i,
    /nicht\s+mehr\s+brauchen/i,
    /nicht\s+mehr\s+gehen/i,
    /nicht\s+mehr\s+gehen\s+zu/i,
    /besser\s+stornieren/i,
    /stornieren\s+wollen/i,
    /stornieren\s+brauchen/i,
    /stornieren\s+wünschen/i,
    /nicht\s+interessiert/i,
    /nicht\s+überzeugt/i,
    /nicht\s+gut/i,
    /nicht\s+richtig/i,
    /nicht\s+geeignet/i,
    /nicht\s+bequem/i,
    /nicht\s+funktioniert/i,
    /besser\s+nicht\s+machen/i,
    /besser\s+nicht\s+buchen/i,
    /besser\s+nicht\s+reservierung\s+machen/i,
    /besser\s+nicht\s+tisch\s+buchen/i,
    /nicht\s+weiter\s+machen\s+wollen/i,
    /nicht\s+fortfahren\s+wollen/i,
    /nicht\s+vorwärts\s+gehen\s+wollen/i,
    /besser\s+aufhören/i,
    /besser\s+beenden/i,
    /besser\s+auflegen/i,
    /besser\s+gehen/i,
    /besser\s+verlassen/i,
    /besser\s+verabschieden/i,
    /besser\s+zurückziehen/i,
    
    // Patrones en italiano
    /non\s+vuoi\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /non\s+ho\s+bisogno\s+di\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /non\s+vado\s+a\s+(?:fare\s+)?(?:la\s+)?prenotazione/i,
    /in\s+realtà\s+no/i,
    /meglio\s+no/i,
    /cambiato\s+idea/i,
    /cambiare\s+idea/i,
    /non\s+vuoi\s+più/i,
    /non\s+ho\s+più\s+bisogno/i,
    /non\s+vado\s+più/i,
    /non\s+vado\s+più\s+a/i,
    /meglio\s+cancellare/i,
    /vuoi\s+cancellare/i,
    /ho\s+bisogno\s+di\s+cancellare/i,
    /desidero\s+cancellare/i,
    /non\s+interessato/i,
    /non\s+convinto/i,
    /non\s+va\s+bene/i,
    /non\s+è\s+giusto/i,
    /non\s+è\s+adatto/i,
    /non\s+è\s+conveniente/i,
    /non\s+funziona/i,
    /meglio\s+non\s+fare/i,
    /meglio\s+non\s+prenotare/i,
    /meglio\s+non\s+fare\s+prenotazione/i,
    /meglio\s+non\s+prenotare\s+tavolo/i,
    /non\s+vuoi\s+continuare/i,
    /non\s+vuoi\s+procedere/i,
    /non\s+vuoi\s+andare\s+avanti/i,
    /meglio\s+fermarsi/i,
    /meglio\s+finire/i,
    /meglio\s+riattaccare/i,
    /meglio\s+andare/i,
    /meglio\s+lasciare/i,
    /meglio\s+salutare/i,
    /meglio\s+ritirarsi/i
  ];
  
  const hasPatterns = cancellationPatterns.some(pattern => pattern.test(lowerText));
  console.log(`🔍 [DEBUG] Patrones de cancelación encontrados: ${hasPatterns}`);
  
  // Verificar si hay alguna indicación de cancelación
  const hasAnyCancellationIndication = hasCancellationWords || hasSimplePatterns || hasPatterns;
  
  // CRÍTICO: Verificación final antes de retornar
  // Si hay palabras de nombres o frases relacionadas con nombres, 
  // y NO hay palabras explícitas de cancelación, NO es cancelación
  // Esta verificación final asegura que no hay falsos positivos
  if (hasAnyCancellationIndication) {
    // Verificar si hay palabras de nombres en el texto (TODOS LOS IDIOMAS)
    const nameWordsPattern = /(^|\s)(nombres?|nomi|noms|nomes|nom|name|names|nome|nomes|nombre|llamo|llama|llamamos|llaman|me llamo|se llama|se llaman|mi nombre|su nombre|sus nombres|a nombre|nombre de|los nombres|el nombre|under name|name of|my name|your name|ich heiße|ich heisse|mi chiamo|si chiama|je m'appelle|s'appelle|me chamo|se chama)(\s|$|[.,!?;:])/i;
    const hasNameWords = nameWordsPattern.test(text);
    
    if (hasNameWords) {
      // Si hay palabras de nombres, verificar que haya palabras explícitas de cancelación
      const explicitCancellationWords = [
        // Español
        'cancelar', 'cancelación', 'cancelar reserva', 'cancelar mesa',
        // Inglés
        'cancel', 'cancellation', 'cancel reservation', 'cancel table',
        // Alemán
        'stornieren', 'stornierung', 'storniere', 'reservierung stornieren',
        // Italiano
        'cancellare', 'cancellazione', 'cancellare prenotazione', 'cancellare tavolo',
        // Francés
        'annuler', 'annulation', 'annuler réservation', 'annuler table',
        // Portugués
        'cancelar', 'cancelamento', 'cancelar reserva', 'cancelar mesa'
      ];
      const hasExplicitCancellation = explicitCancellationWords.some(word => 
        lowerText.includes(word.toLowerCase())
      );
      
      if (!hasExplicitCancellation) {
        console.log(`🔍 [DEBUG] VERIFICACIÓN FINAL: Texto contiene palabras de nombres ("${text}"), y aunque hay indicaciones de cancelación, NO contiene palabras explícitas de cancelación. NO es cancelación.`);
        return false;
      }
    }
  }
  
  const result = hasAnyCancellationIndication;
  console.log(`🔍 [DEBUG] Resultado final isCancellationRequest: ${result}`);
  console.log(`🔍 [DEBUG] - Palabras: ${hasCancellationWords}`);
  console.log(`🔍 [DEBUG] - Patrones simples: ${hasSimplePatterns}`);
  console.log(`🔍 [DEBUG] - Patrones complejos: ${hasPatterns}`);
  
  return result;
}

function extractPeopleCount(text) {
  const wordToNumber = {
    // Español
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    // Italiano
    'uno': 1, 'una': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'undici': 11, 'dodici': 12, 'tredici': 13, 'quattordici': 14, 'quindici': 15,
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'elf': 11, 'zwölf': 12, 'dreizehn': 13, 'vierzehn': 14, 'fünfzehn': 15,
    'sechzehn': 16, 'siebzehn': 17, 'achtzehn': 18, 'neunzehn': 19, 'zwanzig': 20
  };

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different',
    'nein', 'besser', 'warte', 'entschuldigung', 'verzeihung', 'korrigieren',
    'ändern', 'verschieden', 'anders', 'nicht', 'falsch', 'fehler',
    'no', 'meglio', 'aspetta', 'scusa', 'correggere', 'cambiare', 'diverso',
    'non', 'mieux', 'attendre', 'excuse', 'corriger', 'changer', 'différent',
    'não', 'melhor', 'espera', 'desculpa', 'corrigir', 'mudar', 'diferente'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundNumbers = [];

  // Buscar números en palabras
  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      foundNumbers.push({ number, position: match.index });
    }
  }

  // Buscar números digitales
  const digitMatches = text.matchAll(/\b(\d+)\b/g);
  for (const match of digitMatches) {
    const count = parseInt(match[1]);
    if (count >= 1 && count <= 20) {
      foundNumbers.push({ number: count, position: match.index });
    }
  }

  if (foundNumbers.length === 0) return null;

  // Si hay corrección o múltiples números, tomar el último
  if (hasCorrection || foundNumbers.length > 1) {
    foundNumbers.sort((a, b) => b.position - a.position);
    return foundNumbers[0].number;
  }

  // Si solo hay un número, devolverlo
  return foundNumbers[0].number;
}

function extractDate(text) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('🔍 extractDate recibió:', text);

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundDates = [];

  // Si hay corrección, buscar la última fecha mencionada
  let textToAnalyze = text;
  if (hasCorrection) {
    let lastCorrectionIndex = -1;
    correctionWords.forEach(word => {
      const index = text.lastIndexOf(word);
      if (index > lastCorrectionIndex) {
        lastCorrectionIndex = index;
      }
    });
    if (lastCorrectionIndex !== -1) {
      textToAnalyze = text.substring(lastCorrectionIndex);
    }
  }

  // Manejar "pasado mañana" antes que "mañana"
  if (textToAnalyze.includes('pasado mañana') || (textToAnalyze.includes('pasado') && textToAnalyze.includes('mañana'))) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    console.log('✅ Detectado: pasado mañana');
    return formatDateISO(date);
  }
  
  // Manejar "mañana" pero no "pasado mañana"
  if (textToAnalyze.includes('mañana') && !textToAnalyze.includes('pasado')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: mañana');
    return formatDateISO(date);
  }
  
  // Manejar "tomorrow" en inglés
  if (textToAnalyze.includes('tomorrow')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: tomorrow');
    return formatDateISO(date);
  }
  
  // Manejar "today" en inglés
  if (textToAnalyze.includes('today')) {
    console.log('✅ Detectado: today');
    return formatDateISO(today);
  }
  
  if (textToAnalyze.includes('hoy')) {
    console.log('✅ Detectado: hoy');
    return formatDateISO(today);
  }
  
  // Manejar fechas en italiano
  if (textToAnalyze.includes('oggi')) {
    console.log('✅ Detectado: oggi (hoy en italiano)');
    return formatDateISO(today);
  }
  
  if (textToAnalyze.includes('domani')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 1);
    console.log('✅ Detectado: domani (mañana en italiano)');
    return formatDateISO(date);
  }
  
  if (textToAnalyze.includes('dopodomani')) {
    const date = new Date(today);
    date.setDate(date.getDate() + 2);
    console.log('✅ Detectado: dopodomani (pasado mañana en italiano)');
    return formatDateISO(date);
  }

  // Mapeo de nombres de meses en español, inglés e italiano (ANTES de días de la semana para priorizar)
  const monthNames = {
    // Español
    'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
    'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
    'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12,
    // Inglés
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12,
    // Italiano
    'gennaio': 1, 'febbraio': 2, 'marzo': 3, 'aprile': 4,
    'maggio': 5, 'giugno': 6, 'luglio': 7, 'agosto': 8,
    'settembre': 9, 'ottobre': 10, 'novembre': 11, 'dicembre': 12
  };

  // Intentar extraer fecha con nombre de mes: "10 de octubre", "15 de enero"
  for (const [monthName, monthNumber] of Object.entries(monthNames)) {
    if (textToAnalyze.includes(monthName)) {
      console.log(`✅ Detectado mes: ${monthName}`);
      
      // Buscar el número antes del mes (más preciso)
      const patterns = [
        new RegExp(`(\\d{1,2})\\s*de\\s*${monthName}`, 'i'),  // "10 de octubre"
        new RegExp(`(\\d{1,2})\\s*${monthName}`, 'i'),         // "10 octubre" o "25 october"
        new RegExp(`${monthName}\\s*(\\d{1,2})`, 'i'),         // "octubre 10" o "october 25"
        new RegExp(`(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*${monthName}`, 'i'), // "25th october"
        new RegExp(`${monthName}\\s*(\\d{1,2})\\s*(?:st|nd|rd|th)?`, 'i'), // "october 25th"
      ];
      
      for (const pattern of patterns) {
        const match = textToAnalyze.match(pattern);
        if (match) {
          const day = parseInt(match[1]);
          console.log(`✅ Detectado día: ${day}`);
          
          if (day >= 1 && day <= 31) {
            const year = today.getFullYear();
            try {
              const date = new Date(year, monthNumber - 1, day);
              // Si la fecha es anterior a hoy, asumir que es el año siguiente
              if (date < today) {
                date.setFullYear(year + 1);
              }
              console.log(`✅ Fecha procesada: ${formatDateISO(date)}`);
              return formatDateISO(date);
            } catch (e) {
              console.log('❌ Error creando fecha:', e);
              return null;
            }
          }
        }
      }
      
      // Si no encontró patrón específico, buscar cualquier número
      const dayMatches = [...textToAnalyze.matchAll(/\b(\d{1,2})\b/g)];
      if (dayMatches.length > 0) {
        const day = parseInt(dayMatches[0][1]);
        if (day >= 1 && day <= 31) {
          const year = today.getFullYear();
          try {
            const date = new Date(year, monthNumber - 1, day);
            if (date < today) {
              date.setFullYear(year + 1);
            }
            console.log(`✅ Fecha procesada (fallback): ${formatDateISO(date)}`);
            return formatDateISO(date);
          } catch (e) {
            return null;
          }
        }
      }
    }
  }

  // Detectar días de la semana (DESPUÉS de los meses)
  const daysOfWeek = {
    // Español
    'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
    'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0,
    // Inglés
    'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4,
    'friday': 5, 'saturday': 6, 'sunday': 0,
    // Italiano
    'lunedì': 1, 'martedì': 2, 'mercoledì': 3, 'giovedì': 4,
    'venerdì': 5, 'sabato': 6, 'domenica': 0,
    'lunedi': 1, 'martedi': 2, 'mercoledi': 3, 'giovedi': 4,
    'venerdi': 5
  };

  for (const [dayName, dayNumber] of Object.entries(daysOfWeek)) {
    if (textToAnalyze.includes(dayName)) {
      console.log(`✅ Detectado día de la semana: ${dayName}`);
      const currentDay = today.getDay(); // 0=domingo, 1=lunes, etc.
      let daysUntil = dayNumber - currentDay;
      
      // Si el día ya pasó esta semana, ir a la próxima semana
      if (daysUntil <= 0) {
        daysUntil += 7;
      }
      
      // Si dice "que viene" o "próximo", asegurar que es la próxima semana
      if (textToAnalyze.includes('que viene') || textToAnalyze.includes('próximo') || textToAnalyze.includes('proximo')) {
        if (daysUntil < 7) {
          daysUntil += 7;
        }
      }
      
      const date = new Date(today);
      date.setDate(date.getDate() + daysUntil);
      return formatDateISO(date);
    }
  }

  // Intentar extraer fecha numérica: "10/10", "10-10", "10/25", "25/10"
  const dateMatch = textToAnalyze.match(/(\d{1,2})[\/\-\s](?:de\s)?(\d{1,2})/);
  if (dateMatch) {
    const first = parseInt(dateMatch[1]);
    const second = parseInt(dateMatch[2]);
    const year = today.getFullYear();
    
    try {
      // Intentar ambos formatos: DD/MM y MM/DD
      let date1 = new Date(year, first - 1, second);
      let date2 = new Date(year, second - 1, first);
      
      // Si la primera fecha es válida y no es pasada, usarla
      if (date1 >= today && date1.getMonth() === first - 1) {
        console.log(`✅ Fecha numérica detectada: ${first}/${second}`);
        return formatDateISO(date1);
      }
      
      // Si la segunda fecha es válida y no es pasada, usarla
      if (date2 >= today && date2.getMonth() === second - 1) {
        console.log(`✅ Fecha numérica detectada: ${second}/${first}`);
        return formatDateISO(date2);
      }
      
      // Si ambas son pasadas, usar la del año siguiente
      if (date1 < today) {
        date1.setFullYear(year + 1);
        console.log(`✅ Fecha numérica detectada (año siguiente): ${first}/${second}`);
        return formatDateISO(date1);
      }
      
    } catch (e) {
      return null;
    }
  }

  return null;
}

function extractTime(text) {
  const wordToNumber = {
    'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12
  };

  // Detectar palabras de corrección - EXPANDIDAS
  const correctionWords = [
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo',
    'wait', 'sorry', 'excuse me', 'correction', 'change', 'different'
  ];
  const hasCorrection = correctionWords.some(word => text.includes(word));

  let foundTimes = [];

  // Buscar horas en palabras
  for (const [word, number] of Object.entries(wordToNumber)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      let hours = number;
      let minutes = 0;

      // MEJORADO: Manejar "y media", "y cuarto", "menos cuarto"
      if (text.includes('media') || text.includes('treinta')) {
        minutes = 30;
      } else if (text.includes('cuarto') || text.includes('quince')) {
        minutes = 15;
      } else if (text.includes('menos cuarto')) {
        hours = (hours + 23) % 24; // Restar 1 hora
        minutes = 45;
      }

      // Detectar AM/PM o indicadores de tiempo
      const afterWord = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
      const beforeWord = text.substring(Math.max(0, match.index - 50), match.index);
      const context = (beforeWord + ' ' + afterWord).toLowerCase();
      
      if (context.includes('noche') || context.includes('tarde') || context.includes('pm') || 
          context.includes('de la tarde') || context.includes('de la noche') || 
          context.includes('p.m.') || context.includes('p m')) {
        if (hours < 12) hours += 12;
      } else if (context.includes('mañana') || context.includes('am') || context.includes('a.m.') || 
                 context.includes('a m') || context.includes('de la mañana')) {
        if (hours === 12) hours = 0; // 12 AM = 00:00
      }

      if (hours >= 0 && hours <= 23) {
        foundTimes.push({
          time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
          position: match.index
        });
      }
    }
  }

  // Buscar horas en formato digital
  const timeMatches = text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\b/g);
  for (const match of timeMatches) {
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;

    // Detectar AM/PM o indicadores de tiempo en el contexto alrededor del número
    const afterNumber = text.substring(match.index + match[0].length, match.index + match[0].length + 50);
    const beforeNumber = text.substring(Math.max(0, match.index - 50), match.index);
    const context = (beforeNumber + ' ' + afterNumber).toLowerCase();
    
    if (context.includes('noche') || context.includes('tarde') || context.includes('pm') || 
        context.includes('de la tarde') || context.includes('de la noche') || 
        context.includes('p.m.') || context.includes('p m')) {
      if (hours < 12) hours += 12;
    } else if (context.includes('mañana') || context.includes('am') || context.includes('a.m.') || 
               context.includes('a m') || context.includes('de la mañana')) {
      if (hours === 12) hours = 0; // 12 AM = 00:00
    }

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      foundTimes.push({
        time: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        position: match.index
      });
    }
  }

  if (foundTimes.length === 0) return null;

  // Si hay corrección o múltiples horas, tomar la última
  if (hasCorrection || foundTimes.length > 1) {
    foundTimes.sort((a, b) => b.position - a.position);
    return foundTimes[0].time;
  }

  // Si solo hay una hora, devolverla
  return foundTimes[0].time;
}

function extractName(text) {
  if (!text || typeof text !== 'string') return null;
  
  // Limpiar el texto - MEJORADO: incluir más patrones comunes
  const cleaned = text
    .replace(/a nombre de/gi, '')
    .replace(/nombre de/gi, '')
    .replace(/los nombres de/gi, '')
    .replace(/el nombre de/gi, '')
    .replace(/mi nombre es/gi, '')
    .replace(/me llamo/gi, '')
    .replace(/soy/gi, '')
    .replace(/my name is/gi, '')
    .replace(/i am/gi, '')
    .replace(/ich heiße/gi, '')
    .replace(/mi chiamo/gi, '')
    .replace(/je m\'appelle/gi, '')
    .replace(/meu nome é/gi, '')
    .replace(/^por favor[.,]?\s*/gi, '')
    .replace(/^porfavor[.,]?\s*/gi, '')
    .trim();
  
  if (cleaned.length > 1) {
    // Capitalizar cada palabra
    return cleaned
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return null;
}

function extractPhoneNumber(text) {
  // Primero intentar extraer números directamente
  const directMatch = text.match(/\d{9,}/);
  if (directMatch) {
    return directMatch[0];
  }

  // Mapeo de palabras a dígitos - EXPANDIDO
  const wordToDigit = {
    'cero': '0', 'uno': '1', 'una': '1', 'dos': '2', 'tres': '3', 
    'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 
    'ocho': '8', 'nueve': '9', 'zero': '0', 'one': '1', 'two': '2',
    'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7',
    'eight': '8', 'nine': '9'
  };

  // Convertir palabras a dígitos
  let phoneNumber = '';
  const words = text.split(/\s+/);
  
  for (const word of words) {
    const cleanWord = word.toLowerCase().replace(/[,\.]/g, '');
    if (wordToDigit[cleanWord]) {
      phoneNumber += wordToDigit[cleanWord];
    } else if (/^\d$/.test(cleanWord)) {
      // Si ya es un dígito, agregarlo
      phoneNumber += cleanWord;
    }
  }

  // Si tenemos al menos 9 dígitos, retornar
  if (phoneNumber.length >= 9) {
    return phoneNumber;
  }

  return null;
}

function getConfirmationMessage(data, language = 'es') {
  // OPTIMIZACIÓN: Acortar formato de teléfono para reducir latencia TTS
  // Solo mostrar últimos 4 dígitos en lugar del número completo
  let phoneFormatted = '';
  if (data.TelefonReserva) {
    const cleanPhone = data.TelefonReserva.replace(/\D/g, '');
    if (cleanPhone.length >= 4) {
      // Solo últimos 4 dígitos
      const last4 = cleanPhone.slice(-4);
      const digitWords = {
        es: { '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro', '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve' },
        en: { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' },
        de: { '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier', '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun' },
        it: { '0': 'zero', '1': 'uno', '2': 'due', '3': 'tre', '4': 'quattro', '5': 'cinque', '6': 'sei', '7': 'sette', '8': 'otto', '9': 'nove' },
        fr: { '0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre', '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf' },
        pt: { '0': 'zero', '1': 'um', '2': 'dois', '3': 'três', '4': 'quatro', '5': 'cinco', '6': 'seis', '7': 'sete', '8': 'oito', '9': 'nove' }
      };
      const words = digitWords[language] || digitWords['es'];
      phoneFormatted = last4.split('').map(d => words[d]).join(' ');
    } else {
      phoneFormatted = formatPhoneForSpeech(data.TelefonReserva, language);
    }
  }
  
  const confirmations = {
    es: `Muy bien, ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'personas'}, el día ${formatDateSpanish(data.FechaReserva)} a las ${data.HoraReserva}, a nombre de ${data.NomReserva}${phoneFormatted ? `, teléfono ${phoneFormatted}` : ''}. ¿Les parece correcto?`,
    en: `I confirm: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'person' : 'people'}, ${formatDateEnglish(data.FechaReserva)} at ${data.HoraReserva}, under the name of ${data.NomReserva}${phoneFormatted ? `, phone ${phoneFormatted}` : ''}. Is it correct?`,
    de: `Ich bestätige: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'Person' : 'Personen'}, ${formatDateGerman(data.FechaReserva)} um ${data.HoraReserva}, unter dem Namen ${data.NomReserva}${phoneFormatted ? `, Telefon ${phoneFormatted}` : ''}. Ist es richtig?`,
    it: `Confermo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'persona' : 'persone'}, ${formatDateItalian(data.FechaReserva)} alle ${data.HoraReserva}, a nome di ${data.NomReserva}${phoneFormatted ? `, telefono ${phoneFormatted}` : ''}. È corretto?`,
    fr: `Je confirme: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'personne' : 'personnes'}, ${formatDateFrench(data.FechaReserva)} à ${data.HoraReserva}, au nom de ${data.NomReserva}${phoneFormatted ? `, téléphone ${phoneFormatted}` : ''}. Est-ce correct?`,
    pt: `Confirmo: ${data.NumeroReserva} ${data.NumeroReserva === 1 ? 'pessoa' : 'pessoas'}, ${formatDatePortuguese(data.FechaReserva)} às ${data.HoraReserva}, em nome de ${data.NomReserva}${phoneFormatted ? `, telefone ${phoneFormatted}` : ''}. Está correto?`
  };
  
  return confirmations[language] || confirmations['es'];
}

/**
 * Genera un mensaje de confirmación parcial que muestra lo que se capturó y pregunta por lo que falta
 * Ejemplo: "Perfecto, mesa para 4 el día 7 de noviembre. ¿A qué hora desean la reserva?"
 */
function getPartialConfirmationMessage(data, missingField, language = 'es') {
  // Validar que data existe y es un objeto
  if (!data || typeof data !== 'object') {
    console.error('❌ [ERROR] getPartialConfirmationMessage: data no es válido', data);
    data = {};
  }
  
  const parts = [];
  
  // Formatear según el idioma
  const formatFunctions = {
    es: {
      date: (dateStr) => formatDateSpanish(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'es'),
      people: (num) => `mesa para ${num} ${num === 1 ? 'persona' : 'personas'}`,
      name: (name) => `a nombre de ${name}`
    },
    en: {
      date: (dateStr) => formatDateEnglish(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'en'),
      people: (num) => `table for ${num} ${num === 1 ? 'person' : 'people'}`,
      name: (name) => `under the name of ${name}`
    },
    de: {
      date: (dateStr) => formatDateGerman(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'de'),
      people: (num) => `Tisch für ${num} ${num === 1 ? 'Person' : 'Personen'}`,
      name: (name) => `unter dem Namen ${name}`
    },
    it: {
      date: (dateStr) => formatDateItalian(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'it'),
      people: (num) => `tavolo per ${num} ${num === 1 ? 'persona' : 'persone'}`,
      name: (name) => `a nome di ${name}`
    },
    fr: {
      date: (dateStr) => formatDateFrench(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'fr'),
      people: (num) => `table pour ${num} ${num === 1 ? 'personne' : 'personnes'}`,
      name: (name) => `au nom de ${name}`
    },
    pt: {
      date: (dateStr) => formatDatePortuguese(dateStr),
      time: (timeStr) => formatTimeForSpeech(timeStr, 'pt'),
      people: (num) => `mesa para ${num} ${num === 1 ? 'pessoa' : 'pessoas'}`,
      name: (name) => `em nome de ${name}`
    }
  };
  
  const formatter = formatFunctions[language] || formatFunctions['es'];
  
  // Construir la parte de confirmación con lo que tenemos
  try {
    if (data.NumeroReserva && typeof data.NumeroReserva === 'number') {
      parts.push(formatter.people(data.NumeroReserva));
    }
    if (data.FechaReserva && typeof data.FechaReserva === 'string') {
      try {
        const dateStr = formatter.date(data.FechaReserva);
        if (dateStr) {
          const datePrefix = {
            es: 'el día',
            en: 'on',
            de: 'am',
            it: 'il',
            fr: 'le',
            pt: 'no dia'
          };
          parts.push(`${datePrefix[language] || datePrefix['es']} ${dateStr}`);
        }
      } catch (error) {
        console.error('❌ [ERROR] Error formateando fecha:', error, data.FechaReserva);
      }
    }
    if (data.HoraReserva && typeof data.HoraReserva === 'string') {
      try {
        const timeStr = formatter.time(data.HoraReserva);
        if (timeStr) {
          // Para español, formatTimeForSpeech ya incluye "las", solo agregar "a"
          // Para otros idiomas, usar el prefijo completo
          if (language === 'es' && timeStr.startsWith('las ')) {
            parts.push(`a ${timeStr}`);
          } else {
            const timePrefix = {
              es: 'a las',
              en: 'at',
              de: 'um',
              it: 'alle',
              fr: 'à',
              pt: 'às'
            };
            parts.push(`${timePrefix[language] || timePrefix['es']} ${timeStr}`);
          }
        }
      } catch (error) {
        console.error('❌ [ERROR] Error formateando hora:', error, data.HoraReserva);
      }
    }
    if (data.NomReserva && typeof data.NomReserva === 'string' && data.NomReserva.trim()) {
      parts.push(formatter.name(data.NomReserva.trim()));
    }
  } catch (error) {
    console.error('❌ [ERROR] Error en getPartialConfirmationMessage al construir partes:', error);
    console.error('❌ [ERROR] Data recibida:', JSON.stringify(data));
  }
  
  // Mensajes según el idioma
  const messages = {
    es: {
      prefix: parts.length > 0 ? `Perfecto, ${parts.join(', ')}.` : 'Perfecto.',
      time: '¿A qué hora les gustaría venir?',
      date: '¿Para qué día desean hacer la reserva?',
      people: '¿Para cuántas personas será la reserva?',
      name: '¿A nombre de quién será la reserva?'
    },
    en: {
      prefix: parts.length > 0 ? `Perfect, ${parts.join(', ')}.` : 'Perfect.',
      time: 'What time would you like the reservation?',
      date: 'What day would you like the reservation?',
      people: 'How many people will the reservation be for?',
      name: 'Under whose name will the reservation be?'
    },
    de: {
      prefix: parts.length > 0 ? `Perfekt, ${parts.join(', ')}.` : 'Perfekt.',
      time: 'Zu welcher Uhrzeit möchten Sie die Reservierung?',
      date: 'Für welchen Tag möchten Sie die Reservierung?',
      people: 'Für wie viele Personen ist die Reservierung?',
      name: 'Unter welchem Namen soll die Reservierung sein?'
    },
    it: {
      prefix: parts.length > 0 ? `Perfetto, ${parts.join(', ')}.` : 'Perfetto.',
      time: 'A che ora desiderate la prenotazione?',
      date: 'Per quale giorno desiderate la prenotazione?',
      people: 'Per quante persone è la prenotazione?',
      name: 'A nome di chi sarà la prenotazione?'
    },
    fr: {
      prefix: parts.length > 0 ? `Parfait, ${parts.join(', ')}.` : 'Parfait.',
      time: 'À quelle heure souhaitez-vous la réservation?',
      date: 'Pour quel jour souhaitez-vous la réservation?',
      people: 'Pour combien de personnes est la réservation?',
      name: 'Au nom de qui sera la réservation?'
    },
    pt: {
      prefix: parts.length > 0 ? `Perfeito, ${parts.join(', ')}.` : 'Perfeito.',
      time: 'A que horas desejam a reserva?',
      date: 'Para que dia desejam a reserva?',
      people: 'Para quantas pessoas é a reserva?',
      name: 'Em nome de quem será a reserva?'
    }
  };
  
  const msg = messages[language] || messages['es'];
  const questionMap = {
    'time': msg.time,
    'date': msg.date,
    'people': msg.people,
    'name': msg.name
  };
  
  return `${msg.prefix} ${questionMap[missingField] || ''}`;
}

/**
 * Formatea la hora en formato amigable para el habla
 * Ejemplo: "20:00" -> "8 de la noche" o "las 8 de la noche"
 */
function formatTimeForSpeech(timeStr, language = 'es') {
  if (!timeStr) return '';
  
  // Parsear hora (formato HH:MM)
  const [hours, minutes] = timeStr.split(':').map(Number);
  const hour24 = hours;
  
  const formats = {
    es: () => {
      if (hour24 >= 13 && hour24 < 20) {
        // Tarde: 13:00 - 19:59
        return `las ${hour24 === 13 ? '1' : hour24 - 12}${minutes > 0 ? ` y ${minutes}` : ''} de la tarde`;
      } else if (hour24 >= 20 || hour24 < 6) {
        // Noche: 20:00 - 05:59
        const nightHour = hour24 >= 20 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        return `las ${nightHour}${minutes > 0 ? ` y ${minutes}` : ''} de la noche`;
      } else {
        // Mañana: 06:00 - 12:59
        return `las ${hour24}${minutes > 0 ? ` y ${minutes}` : ''} de la mañana`;
      }
    },
    en: () => {
      const period = hour24 >= 12 ? 'PM' : 'AM';
      const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;
      return `${hour12}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''} ${period}`;
    },
    de: () => {
      return `${hour24}${minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : ''} Uhr`;
    },
    it: () => {
      return `le ${hour24}${minutes > 0 ? ` e ${minutes}` : ''}`;
    },
    fr: () => {
      return `${hour24}h${minutes > 0 ? minutes.toString().padStart(2, '0') : ''}`;
    },
    pt: () => {
      if (hour24 >= 13 && hour24 < 20) {
        return `às ${hour24 === 13 ? '1' : hour24 - 12}${minutes > 0 ? ` e ${minutes}` : ''} da tarde`;
      } else if (hour24 >= 20 || hour24 < 6) {
        const nightHour = hour24 >= 20 ? hour24 - 12 : hour24 === 0 ? 12 : hour24;
        return `às ${nightHour}${minutes > 0 ? ` e ${minutes}` : ''} da noite`;
      } else {
        return `às ${hour24}${minutes > 0 ? ` e ${minutes}` : ''} da manhã`;
      }
    }
  };
  
  const formatter = formats[language] || formats['es'];
  return formatter();
}

function formatPhoneForSpeech(phone, language = 'es') {
  // Manejar valores undefined/null
  if (!phone) {
    console.warn('⚠️ [WARN] formatPhoneForSpeech recibió valor vacío/undefined');
    return '';
  }
  
  // Limpiar el teléfono de caracteres no numéricos
  const cleanPhone = phone.replace(/\D/g, '');
  
  // Convertir cada dígito en su palabra según el idioma
  const digitWords = {
    es: {
      '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
      '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
    },
    en: {
      '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
      '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'
    },
    de: {
      '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
      '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun'
    },
    it: {
      '0': 'zero', '1': 'uno', '2': 'due', '3': 'tre', '4': 'quattro',
      '5': 'cinque', '6': 'sei', '7': 'sette', '8': 'otto', '9': 'nove'
    },
    fr: {
      '0': 'zéro', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre',
      '5': 'cinq', '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf'
    },
    pt: {
      '0': 'zero', '1': 'um', '2': 'dois', '3': 'três', '4': 'quatro',
      '5': 'cinco', '6': 'seis', '7': 'sete', '8': 'oito', '9': 'nove'
    }
  };
  
  const words = digitWords[language] || digitWords['es'];
  
  // Convertir cada dígito y añadir comas para pausas naturales cada 3 dígitos
  let result = '';
  for (let i = 0; i < cleanPhone.length; i++) {
    result += words[cleanPhone[i]];
    // Añadir una pausa después de cada 3 dígitos (excepto al final)
    if ((i + 1) % 3 === 0 && i !== cleanPhone.length - 1) {
      result += ', ';
    } else if (i !== cleanPhone.length - 1) {
      result += ' ';
    }
  }
  
  return result;
}

function formatDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateSpanish(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${parseInt(day)} de ${months[parseInt(month) - 1]}`;
}

function formatDateEnglish(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[parseInt(month) - 1]} ${parseInt(day)}`;
}

function formatDateGerman(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return `${parseInt(day)}. ${months[parseInt(month) - 1]}`;
}

function formatDateItalian(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  return `${parseInt(day)} ${months[parseInt(month) - 1]}`;
}

function formatDateFrench(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${parseInt(day)} ${months[parseInt(month) - 1]}`;
}

function formatDatePortuguese(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = dateStr.split('-');
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${parseInt(day)} de ${months[parseInt(month) - 1]}`;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===== FUNCIONES PARA CANCELACIÓN DE RESERVAS =====

// Buscar reservas por número de teléfono
async function findReservationsByPhone(phoneNumber) {
  try {
      console.log(`🔍 [DEBUG] Buscando reservas para el teléfono: "${phoneNumber}" (versión actualizada)`);
      console.log(`🔍 [DEBUG] Tipo de dato del teléfono:`, typeof phoneNumber);
      console.log(`🔍 [DEBUG] Longitud del teléfono:`, phoneNumber ? phoneNumber.length : 'undefined');
    
    const connection = await createConnection();
    
    try {
      // Normalizar el teléfono: extraer solo dígitos para búsqueda flexible
      const normalizedPhone = phoneNumber.replace(/\D/g, ''); // Solo dígitos
      console.log(`🔍 [DEBUG] Teléfono normalizado (solo dígitos): "${normalizedPhone}"`);
      
      // Buscar reservas futuras (no canceladas) por teléfono
      // Buscar tanto con el número completo como solo con los últimos dígitos (sin prefijo)
      // Esto maneja casos donde el teléfono está guardado como "+3463254378" pero se busca como "63254378"
      // Verificación de sincronización: commit 2024-12-19
      const searchPattern1 = `%${normalizedPhone}%`; // Buscar número completo
      const searchPattern2 = normalizedPhone.length >= 8 ? `%${normalizedPhone.slice(-8)}%` : null; // Últimos 8 dígitos
      
      console.log(`🔍 [DEBUG] Patrón de búsqueda 1 (completo): "${searchPattern1}"`);
      if (searchPattern2) {
        console.log(`🔍 [DEBUG] Patrón de búsqueda 2 (últimos 8 dígitos): "${searchPattern2}"`);
      }
      
      // Buscar con ambos patrones usando OR
      let query;
      let params;
      
      if (searchPattern2) {
        query = `
          SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon
          FROM RESERVA 
          WHERE (telefon LIKE ? OR telefon LIKE ?)
          AND data_reserva >= NOW() 
          AND observacions NOT LIKE '%CANCELADA%'
          ORDER BY data_reserva ASC
        `;
        params = [searchPattern1, searchPattern2];
      } else {
        query = `
          SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon
          FROM RESERVA 
          WHERE telefon LIKE ? 
          AND data_reserva >= NOW() 
          AND observacions NOT LIKE '%CANCELADA%'
          ORDER BY data_reserva ASC
        `;
        params = [searchPattern1];
      }
      
      console.log(`🔍 [DEBUG] Ejecutando consulta SQL:`, query);
      console.log(`🔍 [DEBUG] Parámetros:`, params);
      
      const [rows] = await connection.execute(query, params);
      console.log(`📋 [DEBUG] Resultado de la consulta:`, rows);
      console.log(`📋 [DEBUG] Número de filas encontradas: ${rows.length}`);
      
      // Log adicional: buscar TODAS las reservas para este teléfono (sin filtros de fecha)
      let debugQuery;
      let debugParams;
      
      if (searchPattern2) {
        debugQuery = `SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon FROM RESERVA WHERE telefon LIKE ? OR telefon LIKE ?`;
        debugParams = [searchPattern1, searchPattern2];
      } else {
        debugQuery = `SELECT id_reserva, data_reserva, num_persones, nom_persona_reserva, observacions, telefon FROM RESERVA WHERE telefon LIKE ?`;
        debugParams = [searchPattern1];
      }
      
      const [debugRows] = await connection.execute(debugQuery, debugParams);
      console.log(`🔍 [DEBUG] TODAS las reservas (incluyendo pasadas):`, debugRows);
      
      return rows;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error buscando reservas:', error);
    return [];
  }
}

// Cancelar una reserva específica (BORRAR de la base de datos)
async function cancelReservation(reservationId, phoneNumber) {
  try {
    console.log(`🗑️ Borrando reserva ID: ${reservationId} para teléfono: ${phoneNumber}`);
    
    const connection = await createConnection();
    
    try {
      await connection.beginTransaction();
      
      // BORRAR la reserva directamente de la base de datos
      const deleteQuery = `
        DELETE FROM RESERVA 
        WHERE id_reserva = ? AND telefon = ?
      `;
      
      const [result] = await connection.execute(deleteQuery, [reservationId, phoneNumber]);
      
      if (result.affectedRows === 0) {
        throw new Error('No se encontró la reserva para cancelar');
      }
      
      await connection.commit();
      console.log(`✅ Reserva ${reservationId} borrada exitosamente`);
      return true;
      
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error('❌ Error cancelando reserva:', error);
    return false;
  }
}

// Formatear reserva para mostrar al usuario
function formatReservationForDisplay(reservation, index, language = 'es', reservations = []) {
  // REFACTORIZADO: Usar función helper para formatear fecha/hora (elimina duplicación)
  const { formattedDate, formattedTime } = formatReservationDateTime(reservation.data_reserva, language);
  
  const messages = {
    es: {
      option: `Tiene una reserva el día ${formattedDate} a las ${formattedTime} a nombre de ${reservation.nom_persona_reserva} para ${reservation.num_persones} persona${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Tiene una reserva el día ${formattedDate} a las ${formattedTime} a nombre de ${reservation.nom_persona_reserva} para ${reservation.num_persones} persona${reservation.num_persones > 1 ? 's' : ''}`
    },
    en: {
      option: `You have a reservation on ${formattedDate} at ${formattedTime} under ${reservation.nom_persona_reserva} for ${reservation.num_persones} person${reservation.num_persones > 1 ? 's' : ''}`,
      single: `You have a reservation on ${formattedDate} at ${formattedTime} under ${reservation.nom_persona_reserva} for ${reservation.num_persones} person${reservation.num_persones > 1 ? 's' : ''}`
    },
    de: {
      option: `Sie haben eine Reservierung am ${formattedDate} um ${formattedTime} unter ${reservation.nom_persona_reserva} für ${reservation.num_persones} Person${reservation.num_persones > 1 ? 'en' : ''}`,
      single: `Sie haben eine Reservierung am ${formattedDate} um ${formattedTime} unter ${reservation.nom_persona_reserva} für ${reservation.num_persones} Person${reservation.num_persones > 1 ? 'en' : ''}`
    },
    fr: {
      option: `Vous avez une réservation le ${formattedDate} à ${formattedTime} au nom de ${reservation.nom_persona_reserva} pour ${reservation.num_persones} personne${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Vous avez une réservation le ${formattedDate} à ${formattedTime} au nom de ${reservation.nom_persona_reserva} pour ${reservation.num_persones} personne${reservation.num_persones > 1 ? 's' : ''}`
    },
    it: {
      option: `Hai una prenotazione il ${formattedDate} alle ${formattedTime} a nome di ${reservation.nom_persona_reserva} per ${reservation.num_persones} persona${reservation.num_persones > 1 ? 'e' : ''}`,
      single: `Hai una prenotazione il ${formattedDate} alle ${formattedTime} a nome di ${reservation.nom_persona_reserva} per ${reservation.num_persones} persona${reservation.num_persones > 1 ? 'e' : ''}`
    },
    pt: {
      option: `Você tem uma reserva no dia ${formattedDate} às ${formattedTime} em nome de ${reservation.nom_persona_reserva} para ${reservation.num_persones} pessoa${reservation.num_persones > 1 ? 's' : ''}`,
      single: `Você tem uma reserva no dia ${formattedDate} às ${formattedTime} em nome de ${reservation.nom_persona_reserva} para ${reservation.num_persones} pessoa${reservation.num_persones > 1 ? 's' : ''}`
    }
  };
  
  return messages[language] || messages.es;
}

// Detectar si el usuario quiere modificar una reserva existente
function isModificationRequest(text) {
  console.log(`🔍 [DEBUG] isModificationRequest - Analizando: "${text}"`);
  const modificationPatterns = [
    // Español - Patrones mejorados y más específicos
    /modificar.*reserva|editar.*reserva|cambiar.*reserva|actualizar.*reserva/i,
    /reserva.*modificar|reserva.*editar|reserva.*cambiar|reserva.*actualizar/i,
    /quiero.*modificar.*reserva|quiero.*editar.*reserva|quiero.*cambiar.*reserva/i,
    /quiero.*modificar|quiero.*editar|quiero.*cambiar/i,
    /necesito.*modificar.*reserva|necesito.*editar.*reserva|necesito.*cambiar.*reserva/i,
    /necesito.*modificar|necesito.*editar|necesito.*cambiar/i,
    /puedo.*modificar.*reserva|puedo.*editar.*reserva|puedo.*cambiar.*reserva/i,
    /puedo.*modificar|puedo.*editar|puedo.*cambiar/i,
    // Patrones con "una reserva"
    /modificar.*una.*reserva|editar.*una.*reserva|cambiar.*una.*reserva/i,
    
    // Inglés
    /modify|edit|change|update.*reservation/i,
    /reservation.*modify|reservation.*edit|reservation.*change/i,
    /want.*to.*modify|want.*to.*edit|want.*to.*change/i,
    /need.*to.*modify|need.*to.*edit|need.*to.*change/i,
    /can.*modify|can.*edit|can.*change/i,
    
    // Alemán
    /modifizieren|bearbeiten|ändern|aktualisieren.*reservierung/i,
    /reservierung.*modifizieren|reservierung.*bearbeiten|reservierung.*ändern/i,
    /möchte.*modifizieren|möchte.*bearbeiten|möchte.*ändern/i,
    
    // Francés
    /modifier|éditer|changer|mettre.*à.*jour.*réservation/i,
    /réservation.*modifier|réservation.*éditer|réservation.*changer/i,
    /vouloir.*modifier|vouloir.*éditer|vouloir.*changer/i,
    
    // Italiano
    /modificare|editare|cambiare|aggiornare.*prenotazione/i,
    /prenotazione.*modificare|prenotazione.*editare|prenotazione.*cambiare/i,
    /volere.*modificare|volere.*editare|volere.*cambiare/i,
    
    // Português
    /modificar|editar|alterar|atualizar.*reserva/i,
    /reserva.*modificar|reserva.*editar|reserva.*alterar/i,
    /querer.*modificar|querer.*editar|querer.*alterar/i
  ];
  
  const result = modificationPatterns.some(pattern => {
    const match = pattern.test(text);
    if (match) {
      console.log(`✅ [DEBUG] isModificationRequest - Patrón coincidió: ${pattern}`);
    }
    return match;
  });
  console.log(`🔍 [DEBUG] isModificationRequest result para "${text}": ${result}`);
  return result;
}

// Extraer número de opción del texto (mejorado)
function extractOptionFromText(text) {
  console.log(`🔢 [DEBUG] Extrayendo opción del texto: "${text}"`);
  
  const lowerText = text.toLowerCase().trim();
  
  // Patrones para detectar selección de opciones
  const optionPatterns = [
    // Números directos: "1", "2", "3"
    /^(\d+)$/,
    
    // Con artículo: "la 1", "la 2", "el 1", "el 2"
    /^(?:la|el|lo)\s*(\d+)$/,
    
    // Con "opción": "opción 1", "opción número 1", "opción uno"
    /^opci[oó]n\s*(?:n[úu]mero\s*)?(\d+)$/,
    /^opci[oó]n\s*(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Con "primera", "segunda", etc.
    /^(primera?|segunda?|tercera?|cuarta?|quinta?|sexta?|séptima?|octava?|novena?|décima?)$/,
    
    // Con "número": "número 1", "número uno"
    /^n[úu]mero\s*(\d+)$/,
    /^n[úu]mero\s*(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Patrones más específicos para selección
    /^(?:quiero\s+)?(?:cancelar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:quiero\s+)?(?:borrar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:selecciono\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:escojo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    /^(?:elijo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(\d+)$/,
    
    // Patrones con palabras
    /^(?:quiero\s+)?(?:cancelar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:quiero\s+)?(?:borrar\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:selecciono\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:escojo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    /^(?:elijo\s+)?(?:la\s+)?(?:opci[oó]n\s+)?(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)$/,
    
    // Inglés
    /^(?:the\s*)?(\d+)$/,
    /^(?:the\s*)?(?:option\s*)?(\d+)$/,
    /^(?:the\s*)?(?:option\s*)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)$/,
    
    // Patrones específicos en inglés
    /^(?:i\s+want\s+to\s+)?(?:cancel\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+want\s+to\s+)?(?:delete\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+select\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+choose\s+)?(?:option\s+)?(\d+)$/,
    /^(?:i\s+pick\s+)?(?:option\s+)?(\d+)$/,
    
    /^(?:i\s+want\s+to\s+)?(?:cancel\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+want\s+to\s+)?(?:delete\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+select\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+choose\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    /^(?:i\s+pick\s+)?(?:option\s+)?(one|two|three|four|five|six|seven|eight|nine|ten)$/,
    
    // Alemán
    /^(?:die\s*)?(\d+)$/,
    /^(?:die\s*)?(?:option\s*)?(\d+)$/,
    /^(?:die\s*)?(?:option\s*)?(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn)$/,
    /^(erste?|zweite?|dritte?|vierte?|fünfte?|sechste?|siebte?|achte?|neunte?|zehnte?)$/,
    
    // Francés
    /^(?:la\s*)?(\d+)$/,
    /^(?:la\s*)?(?:option\s*)?(\d+)$/,
    /^(?:la\s*)?(?:option\s*)?(un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)$/,
    /^(première?|deuxième?|troisième?|quatrième?|cinquième?|sixième?|septième?|huitième?|neuvième?|dixième?)$/,
    
    // Italiano
    /^(?:la\s*)?(\d+)$/,
    /^(?:la\s*)?(?:opzione\s*)?(\d+)$/,
    /^(?:la\s*)?(?:opzione\s*)?(uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)$/,
    /^(prima?|seconda?|terza?|quarta?|quinta?|sesta?|settima?|ottava?|nona?|decima?)$/,
    
    // Português
    /^(?:a\s*)?(\d+)$/,
    /^(?:a\s*)?(?:opção\s*)?(\d+)$/,
    /^(?:a\s*)?(?:opção\s*)?(um|dois|três|quatro|cinco|seis|sete|oito|nove|dez)$/,
    /^(primeira?|segunda?|terceira?|quarta?|quinta?|sexta?|sétima?|oitava?|nona?|décima?)$/
  ];
  
  // Diccionarios para convertir palabras a números
  const wordToNumber = {
    // Español
    'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'primera': 1, 'primero': 1, 'segunda': 2, 'segundo': 2,
    'tercera': 3, 'tercero': 3, 'cuarta': 4, 'cuarto': 4,
    'quinta': 5, 'quinto': 5, 'sexta': 6, 'sexto': 6,
    'séptima': 7, 'séptimo': 7, 'octava': 8, 'octavo': 8,
    'novena': 9, 'noveno': 9, 'décima': 10, 'décimo': 10,
    
    // Inglés
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
    'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10,
    
    // Alemán
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'erste': 1, 'erster': 1, 'zweite': 2, 'zweiter': 2,
    'dritte': 3, 'dritter': 3, 'vierte': 4, 'vierter': 4,
    'fünfte': 5, 'fünfter': 5, 'sechste': 6, 'sechster': 6,
    'siebte': 7, 'siebter': 7, 'achte': 8, 'achter': 8,
    'neunte': 9, 'neunter': 9, 'zehnte': 10, 'zehnter': 10,
    
    // Francés
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    'première': 1, 'premier': 1, 'deuxième': 2, 'troisième': 3,
    'quatrième': 4, 'cinquième': 5, 'sixième': 6, 'septième': 7,
    'huitième': 8, 'neuvième': 9, 'dixième': 10,
    
    // Italiano
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'prima': 1, 'primo': 1, 'seconda': 2, 'secondo': 2,
    'terza': 3, 'terzo': 3, 'quarta': 4, 'quarto': 4,
    'quinta': 5, 'quinto': 5, 'sesta': 6, 'sesto': 6,
    'settima': 7, 'settimo': 7, 'ottava': 8, 'ottavo': 8,
    'nona': 9, 'nono': 9, 'decima': 10, 'decimo': 10,
    
    // Português
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
    'primeira': 1, 'primeiro': 1, 'segunda': 2, 'segundo': 2,
    'terceira': 3, 'terceiro': 3, 'quarta': 4, 'quarto': 4,
    'quinta': 5, 'quinto': 5, 'sexta': 6, 'sexto': 6,
    'sétima': 7, 'sétimo': 7, 'oitava': 8, 'oitavo': 8,
    'nona': 9, 'nono': 9, 'décima': 10, 'décimo': 10
  };
  
  // Probar cada patrón
  for (const pattern of optionPatterns) {
    const match = lowerText.match(pattern);
    if (match) {
      let optionNumber;
      
      if (match[1]) {
        // Patrón con grupo de captura (número o palabra)
        const captured = match[1];
        optionNumber = wordToNumber[captured] || parseInt(captured);
      } else {
        // Patrón sin grupo de captura (palabras ordinales)
        const captured = match[0];
        optionNumber = wordToNumber[captured];
      }
      
      if (optionNumber && optionNumber > 0) {
        console.log(`🔢 [DEBUG] Opción detectada: "${text}" -> ${optionNumber}`);
        return optionNumber;
      }
    }
  }
  
  console.log(`🔢 [DEBUG] No se pudo detectar opción en: "${text}"`);
  return null;
}

// Extraer número de teléfono del texto
function extractPhoneFromText(text) {
  console.log(`📞 [DEBUG] Extrayendo teléfono del texto: "${text}"`);
  
  // Primero, intentar extraer cualquier secuencia de dígitos (mínimo 7 dígitos para ser un teléfono válido)
  // Esto captura números simples como "63254378", "632543787", etc.
  const allDigits = text.replace(/\D/g, ''); // Extraer solo dígitos
  console.log(`📞 [DEBUG] Dígitos extraídos del texto: "${allDigits}"`);
  
  // Si hay 7 o más dígitos consecutivos, usarlos como teléfono
  if (allDigits.length >= 7 && allDigits.length <= 15) {
    let phoneNumber = allDigits;
    
    // Si empieza por 34 y no tiene +, agregarlo (números españoles)
    if (phoneNumber.startsWith('34') && phoneNumber.length >= 9) {
      phoneNumber = '+' + phoneNumber;
      console.log(`📞 [DEBUG] Agregando prefijo +34: "${phoneNumber}"`);
    } else if (phoneNumber.length === 9 && !phoneNumber.startsWith('+')) {
      // Número español de 9 dígitos sin prefijo, agregar +34
      phoneNumber = '+34' + phoneNumber;
      console.log(`📞 [DEBUG] Agregando prefijo +34 a número de 9 dígitos: "${phoneNumber}"`);
    }
    
    console.log(`📞 [DEBUG] Teléfono final extraído (método dígitos): "${phoneNumber}"`);
    return phoneNumber;
  }
  
  // Patrones específicos para formatos con espacios o guiones (fallback)
  const phonePatterns = [
    /(\+?[0-9]{9,15})/g,  // Números con 9-15 dígitos
    /(\d{3}[\s\-]?\d{3}[\s\-]?\d{3})/g,  // Formato español: 123 456 789
    /(\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato español: 12 345 67 89
    /(\d{3}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato: 611 67 01 89
    /(\d{3}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2}[\s\-]?\d{2})/g,  // Formato: 611 67 01 89 12
  ];
  
  const matches = [];
  phonePatterns.forEach((pattern, index) => {
    const found = text.match(pattern);
    console.log(`📞 [DEBUG] Patrón ${index + 1} (${pattern}):`, found);
    if (found) {
      // Limpiar el número pero mantener el + si existe
      const cleanedMatches = found.map(match => {
        const cleaned = match.replace(/[\s\-]/g, '');
        console.log(`📞 [DEBUG] Match original: "${match}" -> Limpiado: "${cleaned}"`);
        // Si no tiene + y empieza por 34, agregarlo
        if (!cleaned.startsWith('+') && cleaned.startsWith('34') && cleaned.length >= 9) {
          const withPlus = '+' + cleaned;
          console.log(`📞 [DEBUG] Agregando +34: "${cleaned}" -> "${withPlus}"`);
          return withPlus;
        }
        return cleaned;
      });
      matches.push(...cleanedMatches);
    }
  });
  
  console.log(`📞 [DEBUG] Todos los matches encontrados:`, matches);
  const result = matches.length > 0 ? matches[0] : null;
  console.log(`📞 [DEBUG] Teléfono final extraído: "${result}"`);
  
  // Devolver el primer número encontrado
  return result;
}

function generateMarkdownConversation(state) {
  const { conversationHistory, phone, data } = state;
  const timestamp = new Date().toISOString();
  
  let markdown = `# 📞 Conversación de Reserva\n\n`;
  
  // Información de la llamada
  markdown += `## 📋 Información de la Llamada\n`;
  markdown += `- **Teléfono**: ${phone}\n`;
  markdown += `- **Fecha**: ${new Date().toLocaleDateString('es-ES')}\n`;
  markdown += `- **Hora**: ${new Date().toLocaleTimeString('es-ES')}\n`;
  markdown += `- **Sistema**: Twilio (Hard-coded Mejorado)\n`;
  markdown += `- **Idioma**: ${state.language || 'es'}\n`;
  markdown += `- **Estado**: ${state.step === 'complete' ? '✅ Completada' : '⚠️ Incompleta'}\n\n`;
  
  // Datos de la reserva (si están disponibles)
  if (data && Object.keys(data).length > 0) {
    markdown += `## 🍽️ Datos de la Reserva\n`;
    if (data.NumeroReserva) markdown += `- **Personas**: ${data.NumeroReserva}\n`;
    if (data.FechaReserva) markdown += `- **Fecha**: ${formatDateSpanish(data.FechaReserva)}\n`;
    if (data.HoraReserva) markdown += `- **Hora**: ${data.HoraReserva}\n`;
    if (data.NomReserva) markdown += `- **Nombre**: ${data.NomReserva}\n`;
    if (data.TelefonReserva) markdown += `- **Teléfono Reserva**: ${data.TelefonReserva}\n`;
    markdown += `\n`;
  }
  
  // Conversación paso a paso
  markdown += `## 💬 Transcripción de la Conversación\n\n`;
  
  conversationHistory.forEach((entry, index) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('es-ES');
    const step = index + 1;
    
    if (entry.role === 'user') {
      markdown += `### ${step}. 👤 Cliente (${time})\n`;
      markdown += `> ${entry.message}\n\n`;
    } else {
      markdown += `### ${step}. 🤖 Bot (${time})\n`;
      markdown += `${entry.message}\n\n`;
    }
  });
  
  // Análisis de la conversación
  markdown += `## 📊 Análisis de la Conversación\n\n`;
  markdown += `- **Total de intercambios**: ${conversationHistory.length}\n`;
  markdown += `- **Duración estimada**: ${Math.ceil(conversationHistory.length * 15)} segundos\n`;
  
  // Contar pasos completados
  const stepsCompleted = ['ask_people', 'ask_date', 'ask_time', 'ask_name', 'ask_phone'].filter(step => {
    return state.data[step === 'ask_people' ? 'NumeroReserva' : 
                      step === 'ask_date' ? 'FechaReserva' :
                      step === 'ask_time' ? 'HoraReserva' :
                      step === 'ask_name' ? 'NomReserva' :
                      'TelefonReserva'];
  }).length;
  
  markdown += `- **Pasos completados**: ${stepsCompleted}/5\n`;
  
  // Detectar si fue exitosa
  const wasSuccessful = state.step === 'complete';
  markdown += `- **Resultado**: ${wasSuccessful ? '✅ Reserva completada exitosamente' : '❌ Conversación incompleta'}\n\n`;
  
  // Detectar problemas comunes y sugerir mejoras
  markdown += `## 🔍 Análisis de Problemas y Mejoras\n\n`;
  
  const issues = [];
  const suggestions = [];
  const history = conversationHistory.map(h => h.message.toLowerCase());
  
  // 1. DETECTAR REPETICIONES
  const repeatedMessages = history.filter((msg, index) => 
    history.indexOf(msg) !== index
  );
  if (repeatedMessages.length > 0) {
    issues.push(`⚠️ Mensajes repetidos detectados (${repeatedMessages.length})`);
    suggestions.push(`💡 **Solución**: Implementar más variaciones de respuestas para evitar repetición`);
    suggestions.push(`💡 **Técnica**: Usar arrays de 10-15 frases diferentes por cada paso`);
  }
  
  // 2. DETECTAR ERRORES DE COMPRENSIÓN
  const errorMessages = history.filter(msg => 
    msg.includes('no entendí') || msg.includes('disculpe') || msg.includes('perdón')
  );
  if (errorMessages.length > 0) {
    issues.push(`⚠️ Errores de comprensión: ${errorMessages.length}`);
    
    // Analizar QUÉ no entendió
    const unclearResponses = conversationHistory.filter(entry => 
      entry.role === 'bot' && (
        entry.message.includes('no entendí') || 
        entry.message.includes('Disculpe') || 
        entry.message.includes('Perdón')
      )
    );
    
    if (unclearResponses.length > 0) {
      suggestions.push(`💡 **Problema específico**: El bot no entendió ${unclearResponses.length} respuestas del cliente`);
      suggestions.push(`💡 **Solución**: Mejorar patrones regex o implementar Gemini para comprensión contextual`);
    }
  }
  
  // 3. DETECTAR CONVERSACIÓN MUY LARGA
  if (conversationHistory.length > 15) {
    issues.push(`⚠️ Conversación muy larga (${conversationHistory.length} intercambios)`);
    suggestions.push(`💡 **Problema**: Conversación excede el promedio ideal de 10-12 intercambios`);
    suggestions.push(`💡 **Causa posible**: Múltiples errores de comprensión o cliente indeciso`);
    suggestions.push(`💡 **Solución**: Reducir timeouts y mejorar comprensión para conversaciones más eficientes`);
  }
  
  // 4. DETECTAR CONVERSACIONES MUY CORTAS (posible problema)
  if (conversationHistory.length < 5 && state.step !== 'complete') {
    issues.push(`⚠️ Conversación muy corta (${conversationHistory.length} intercambios)`);
    suggestions.push(`💡 **Problema**: Conversación terminó prematuramente`);
    suggestions.push(`💡 **Posibles causas**: Cliente colgó, error técnico, o bot muy agresivo`);
  }
  
  // 5. DETECTAR PATRONES DE TIMEOUT
  const timeoutMessages = history.filter(msg => 
    msg.includes('no escuché') || msg.includes('¿sigue ahí?')
  );
  if (timeoutMessages.length > 0) {
    issues.push(`⚠️ Timeouts detectados (${timeoutMessages.length})`);
    suggestions.push(`💡 **Problema**: El bot cortó al cliente ${timeoutMessages.length} vez(es)`);
    suggestions.push(`💡 **Solución**: Aumentar speechTimeout de 1s a 2s o ajustar según el cliente`);
  }
  
  // 6. DETECTAR CORRECCIONES EXCESIVAS
  const correctionWords = history.filter(msg => 
    msg.includes('no, mejor') || msg.includes('espera') || msg.includes('cambiar')
  );
  if (correctionWords.length > 2) {
    issues.push(`⚠️ Múltiples correcciones detectadas (${correctionWords.length})`);
    suggestions.push(`💡 **Problema**: Cliente cambió de opinión muchas veces`);
    suggestions.push(`💡 **Solución**: Mejorar extracción para capturar la corrección final automáticamente`);
  }
  
  // 7. ANÁLISIS DE FLUJO
  const userResponses = conversationHistory.filter(h => h.role === 'user');
  const avgResponseLength = userResponses.reduce((sum, r) => sum + r.message.length, 0) / userResponses.length;
  
  if (avgResponseLength > 50) {
    issues.push(`⚠️ Respuestas del cliente muy largas (promedio: ${Math.round(avgResponseLength)} chars)`);
    suggestions.push(`💡 **Problema**: Cliente dice demasiado en cada respuesta`);
    suggestions.push(`💡 **Solución**: Preguntas más específicas para obtener respuestas más cortas`);
  }
  
  // MOSTRAR RESULTADOS
  if (issues.length === 0) {
    markdown += `✅ **Conversación óptima** - No se detectaron problemas significativos\n\n`;
    markdown += `🎯 **Métricas excelentes**:\n`;
    markdown += `- Conversación fluida y eficiente\n`;
    markdown += `- Sin errores de comprensión\n`;
    markdown += `- Duración apropiada\n`;
    markdown += `- Cliente satisfecho\n\n`;
  } else {
    markdown += `## 📋 Problemas Detectados\n\n`;
    issues.forEach((issue, index) => {
      markdown += `${index + 1}. ${issue}\n`;
    });
    
    markdown += `\n## 💡 Sugerencias de Mejora\n\n`;
    suggestions.forEach((suggestion, index) => {
      markdown += `${index + 1}. ${suggestion}\n`;
    });
    
    // Calcular puntuación de calidad
    const qualityScore = Math.max(0, 100 - (issues.length * 15) - (conversationHistory.length - 10) * 2);
    markdown += `\n## 📊 Puntuación de Calidad\n`;
    markdown += `- **Score**: ${qualityScore}/100\n`;
    markdown += `- **Estado**: ${qualityScore >= 80 ? '🟢 Excelente' : qualityScore >= 60 ? '🟡 Aceptable' : '🔴 Necesita Mejoras'}\n\n`;
  }
  
  markdown += `\n---\n`;
  markdown += `*Generado automáticamente el ${new Date().toLocaleString('es-ES')}*\n`;
  
  return markdown;
}
