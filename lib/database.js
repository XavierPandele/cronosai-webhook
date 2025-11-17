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
  connectTimeout: 5000, // OPTIMIZACIÓN: Reducido a 5 segundos para fallar rápido en operaciones asíncronas
  // Configuración adicional para mejorar estabilidad
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// Función para crear conexión con timeout mejorado
async function createConnection() {
  try {
    // OPTIMIZACIÓN: Usar Promise.race para timeout más estricto
    const connectionPromise = mysql.createConnection(dbConfig);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout after 5s')), 5000);
    });
    
    const connection = await Promise.race([connectionPromise, timeoutPromise]);
    return connection;
  } catch (error) {
    console.error('Error conectando a MySQL:', error);
    throw error;
  }
}

// Función para ejecutar queries
async function executeQuery(query, params = []) {
  const connection = await createConnection();
  try {
    const [rows] = await connection.execute(query, params);
    return rows;
  } catch (error) {
    console.error('Error ejecutando query:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

module.exports = {
  createConnection,
  executeQuery
};