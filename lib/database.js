const mysql = require('mysql2/promise');

// Configuración específica para tu base de datos
// Nota: Para createConnection(), solo connectTimeout es válido
// timeout y acquireTimeout son solo para connection pools
const dbConfig = {
  host: process.env.DB_HOST || 'db1.bwai.cc',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'cronosdev',
  password: process.env.DB_PASS || ')CDJ6gwpCO9rg-W/',
  database: process.env.DB_NAME || 'cronosai',
  // Timeout para establecer la conexión (válido para createConnection)
  // Alineado con Promise.race timeout de 3s para consistencia
  connectTimeout: 3000, // OPTIMIZACIÓN: Reducido a 3 segundos para fallar rápido en serverless
  // Configuración adicional para mejorar estabilidad
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Función para crear conexión con timeout mejorado
async function createConnection() {
  const startTime = Date.now();
  try {
    // OPTIMIZACIÓN: Usar Promise.race para timeout más estricto
    // Reducido a 3 segundos para fallar rápido en serverless
    const connectionPromise = mysql.createConnection(dbConfig);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('DB_CONNECTION_TIMEOUT')), 3000);
    });
    
    const connection = await Promise.race([connectionPromise, timeoutPromise]);
    const connectTime = Date.now() - startTime;
    if (connectTime > 1000) {
      console.warn(JSON.stringify({ts: new Date().toISOString(), level: 'WARN', msg: 'DB_SLOW_CONNECTION', timeMs: connectTime}));
    }
    return connection;
  } catch (error) {
    const connectTime = Date.now() - startTime;
    // Log compacto de una línea
    const errorLog = {
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: 'DB_CONNECTION_ERROR',
      error: error.code || error.message,
      timeMs: connectTime,
      timeout: error.message === 'DB_CONNECTION_TIMEOUT'
    };
    console.error(JSON.stringify(errorLog));
    throw error;
  }
}

// Función para ejecutar queries
async function executeQuery(query, params = []) {
  const queryStart = Date.now();
  let connection = null;
  try {
    connection = await createConnection();
    const [rows] = await connection.execute(query, params);
    const queryTime = Date.now() - queryStart;
    // Log solo si la query es lenta (>500ms)
    if (queryTime > 500) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'WARN',
        msg: 'DB_SLOW_QUERY',
        timeMs: queryTime,
        query: query.substring(0, 100)
      }));
    }
    return rows;
  } catch (error) {
    const queryTime = Date.now() - queryStart;
    // Log compacto de error
    const errorLog = {
      ts: new Date().toISOString(),
      level: 'ERROR',
      msg: 'DB_QUERY_ERROR',
      error: error.code || error.message,
      timeMs: queryTime,
      query: query.substring(0, 100)
    };
    console.error(JSON.stringify(errorLog));
    throw error;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (endError) {
        // Ignorar errores al cerrar conexión
      }
    }
  }
}

module.exports = {
  createConnection,
  executeQuery
};