const { executeQuery } = require('./database');

let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) {
    return;
  }

  try {
    await executeQuery(
      `CREATE TABLE IF NOT EXISTS call_states (
        call_sid VARCHAR(64) PRIMARY KEY,
        state_json LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`
    );
    tableEnsured = true;
  } catch (error) {
    console.error('❌ [STATE] Error ensuring call_states table:', error);
    throw error;
  }
}

async function loadCallState(callSid) {
  if (!callSid) {
    return null;
  }

  await ensureTable();

  try {
    const rows = await executeQuery(
      'SELECT state_json FROM call_states WHERE call_sid = ? LIMIT 1',
      [callSid]
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const rawState = rows[0].state_json;

    if (!rawState) {
      return null;
    }

    try {
      return JSON.parse(rawState);
    } catch (parseError) {
      console.error('❌ [STATE] Error parsing state JSON for CallSid:', callSid, parseError);
      return null;
    }
  } catch (error) {
    // Log compacto de error
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: 'STATE_LOAD_ERROR',
      callSid: callSid ? callSid.substring(0, 20) : 'unknown',
      error: error.code || error.message,
      timeout: error.message === 'DB_CONNECTION_TIMEOUT' || error.code === 'ETIMEDOUT'
    }));
    return null;
  }
}

async function saveCallState(callSid, state) {
  if (!callSid) {
    return; // Silenciosamente retornar si no hay CallSid
  }

  try {
    await ensureTable();

    // Convertir el estado completo a JSON
    const stateJson = JSON.stringify(state || {});

    // INSERT simple con ON DUPLICATE KEY UPDATE para actualizar el mismo registro
    // Esto evita crear múltiples registros para el mismo CallSid
    await executeQuery(
      `INSERT INTO call_states (call_sid, state_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         updated_at = CURRENT_TIMESTAMP`,
      [callSid, stateJson]
    );
    
    // No loggear - guardado silencioso para evitar ruido en logs
  } catch (error) {
    // Error silencioso - no lanzar excepción para no bloquear el flujo
    // El estado está en memoria y se intentará guardar en la próxima request
    // Solo loggear si es un error crítico (no timeout)
    if (error.code !== 'ETIMEDOUT' && error.message !== 'DB_CONNECTION_TIMEOUT') {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'ERROR',
        msg: 'STATE_SAVE_ERROR',
        callSid: callSid ? callSid.substring(0, 20) : 'unknown',
        error: error.code || error.message
      }));
    }
  }
}

async function deleteCallState(callSid) {
  if (!callSid) {
    return;
  }

  await ensureTable();

  try {
    await executeQuery('DELETE FROM call_states WHERE call_sid = ?', [callSid]);
  } catch (error) {
    console.error('❌ [STATE] Error deleting call state:', error);
  }
}

/**
 * Actualiza el estado de la llamada con una transcripción de Google STT
 * @param {string} callSid - CallSid de Twilio
 * @param {Object} transcriptData - Datos de transcripción
 * @param {string} transcriptData.transcript - Texto transcrito
 * @param {string} transcriptData.language - Idioma detectado
 * @param {number} transcriptData.confidence - Nivel de confianza
 * @param {string} transcriptData.source - Fuente de transcripción ('google-stt' o 'twilio')
 */
async function updateCallStateWithTranscript(callSid, transcriptData) {
  if (!callSid || !transcriptData) {
    return;
  }

  try {
    // Cargar estado actual
    const currentState = await loadCallState(callSid);
    
    if (!currentState) {
      // Si no hay estado, crear uno básico
      const newState = {
        step: 'greeting',
        data: {},
        phone: null,
        conversationHistory: [],
        language: transcriptData.language || 'es',
        lastTranscript: transcriptData
      };
      await saveCallState(callSid, newState);
      return;
    }

    // Actualizar estado con nueva transcripción
    currentState.lastTranscript = transcriptData;
    
    // Si el idioma detectado es diferente y tiene alta confianza, actualizarlo
    if (transcriptData.language && transcriptData.confidence > 0.7) {
      currentState.language = transcriptData.language;
    }

    // Guardar estado actualizado
    await saveCallState(callSid, currentState);
  } catch (error) {
    console.error('❌ [STATE] Error updating call state with transcript:', error);
  }
}

/**
 * Obtiene la última transcripción de Google STT para un CallSid
 * @param {string} callSid - CallSid de Twilio
 * @returns {Object|null} - Datos de transcripción o null
 */
async function getLastTranscript(callSid) {
  if (!callSid) {
    return null;
  }

  try {
    const state = await loadCallState(callSid);
    return state?.lastTranscript || null;
  } catch (error) {
    console.error('❌ [STATE] Error getting last transcript:', error);
    return null;
  }
}

module.exports = {
  loadCallState,
  saveCallState,
  deleteCallState,
  updateCallStateWithTranscript,
  getLastTranscript
};

