const { Redis } = require('@upstash/redis');

// Inicializar cliente Redis
let redis = null;

function getRedis() {
  if (!redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      console.warn('⚠️ Redis no configurado. Usando fallback en memoria.');
      return null;
    }
    
    try {
      redis = new Redis({
        url,
        token
      });
    } catch (error) {
      console.error('❌ Error inicializando Redis:', error.message);
      return null;
    }
  }
  return redis;
}

// ===== 1. ESTADO DE CONVERSACIÓN (CRÍTICO) =====
// TTL: 600 segundos (10 minutos) - suficiente para conversaciones de 1-2 minutos
async function getCallState(callSid) {
  const client = getRedis();
  if (!client) return null;
  
  try {
    const data = await client.get(`call_state:${callSid}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Redis getCallState error:', error.message);
    return null; // Fallback silencioso
  }
}

async function setCallState(callSid, state, ttl = 600) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.setex(`call_state:${callSid}`, ttl, JSON.stringify(state));
  } catch (error) {
    console.error('Redis setCallState error:', error.message);
    // No lanzar error - fallback silencioso
  }
}

async function deleteCallState(callSid) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.del(`call_state:${callSid}`);
  } catch (error) {
    console.error('Redis deleteCallState error:', error.message);
  }
}

// ===== 2. CACHE DE ANÁLISIS GEMINI =====
// TTL: 30 segundos - suficiente para reutilizar análisis durante la conversación
async function getGeminiCache(key) {
  const client = getRedis();
  if (!client) return null;
  
  try {
    const data = await client.get(`gemini:${key}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null; // Fallback silencioso
  }
}

async function setGeminiCache(key, value, ttl = 30) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.setex(`gemini:${key}`, ttl, JSON.stringify(value));
  } catch (error) {
    // Fallback silencioso
  }
}

// ===== 3. CACHE DE DISPONIBILIDAD =====
// TTL: 300 segundos (5 minutos) - puede reutilizarse entre conversaciones
async function getAvailabilityCache(fechaHora, numPersonas) {
  const client = getRedis();
  if (!client) return null;
  
  try {
    const data = await client.get(`availability:${fechaHora}:${numPersonas}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

async function setAvailabilityCache(fechaHora, numPersonas, result, ttl = 300) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.setex(
      `availability:${fechaHora}:${numPersonas}`,
      ttl,
      JSON.stringify(result)
    );
  } catch (error) {
    // Fallback silencioso
  }
}

// ===== 4. CACHE DE MENÚ =====
// TTL: 300 segundos (5 minutos) - compartido entre todas las conversaciones
async function getMenuCache() {
  const client = getRedis();
  if (!client) return null;
  
  try {
    const data = await client.get('menu:items');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

async function setMenuCache(items, ttl = 300) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.setex('menu:items', ttl, JSON.stringify(items));
  } catch (error) {
    // Fallback silencioso
  }
}

// ===== 5. CACHE DE CONFIGURACIÓN =====
// TTL: 300 segundos (5 minutos) - compartido entre todas las conversaciones
async function getConfigCache() {
  const client = getRedis();
  if (!client) return null;
  
  try {
    const data = await client.get('restaurant:config');
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
}

async function setConfigCache(config, ttl = 300) {
  const client = getRedis();
  if (!client) return;
  
  try {
    await client.setex('restaurant:config', ttl, JSON.stringify(config));
  } catch (error) {
    // Fallback silencioso
  }
}

// ===== 6. DEBOUNCE DE WEBHOOKS =====
// TTL: 2 segundos - solo necesario durante la llamada activa
async function checkWebhookDebounce(callSid, debounceMs = 100) {
  const client = getRedis();
  if (!client) return false;
  
  try {
    const lastTime = await client.get(`webhook_time:${callSid}`);
    const now = Date.now();
    
    if (lastTime && (now - parseInt(lastTime)) < debounceMs) {
      return true; // Es duplicado
    }
    
    // TTL de solo 2 segundos (suficiente para debounce)
    await client.setex(`webhook_time:${callSid}`, 2, now.toString());
    return false; // No es duplicado
  } catch (error) {
    return false; // En caso de error, no bloquear
  }
}

module.exports = {
  getCallState,
  setCallState,
  deleteCallState,
  getGeminiCache,
  setGeminiCache,
  getAvailabilityCache,
  setAvailabilityCache,
  getMenuCache,
  setMenuCache,
  getConfigCache,
  setConfigCache,
  checkWebhookDebounce
};

