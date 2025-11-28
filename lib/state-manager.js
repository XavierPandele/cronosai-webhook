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
    throw new Error('CallSid is required to save call state');
  }

  const saveStart = Date.now();
  try {
    await ensureTable();

    const stateJson = JSON.stringify(state || {});
    const stateSize = stateJson.length;

    await executeQuery(
      `INSERT INTO call_states (call_sid, state_json)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE
         state_json = VALUES(state_json),
         updated_at = CURRENT_TIMESTAMP`,
      [callSid, stateJson]
    );
    
    const saveTime = Date.now() - saveStart;
    // Log solo si es lento
    if (saveTime > 500) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'WARN',
        msg: 'STATE_SAVE_SLOW',
        callSid: callSid.substring(0, 20),
        timeMs: saveTime,
        sizeBytes: stateSize
      }));
    }
  } catch (error) {
    const saveTime = Date.now() - saveStart;
    // Log compacto de error
    const errorLog = {
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: 'STATE_SAVE_ERROR',
      callSid: callSid ? callSid.substring(0, 20) : 'unknown',
      error: error.code || error.message,
      timeMs: saveTime,
      timeout: error.message === 'DB_CONNECTION_TIMEOUT' || error.code === 'ETIMEDOUT'
    };
    console.error(JSON.stringify(errorLog));
    throw error;
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

module.exports = {
  loadCallState,
  saveCallState,
  deleteCallState
};

