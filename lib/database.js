const mysql = require('mysql2/promise');

// Configuración específica para tu base de datos
const dbConfig = {
  host: process.env.DB_HOST || 'db1.bwai.cc',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'cronosdev',
  password: process.env.DB_PASS || ')CDJ6gwpCO9rg-W/',
  database: process.env.DB_NAME || 'cronosai',
  connectionLimit: 10,
  queueLimit: 0,
  // Timeouts para evitar conexiones colgadas
  connectTimeout: 5000, // 5 segundos para conectar
  timeout: 10000, // 10 segundos para queries
  acquireTimeout: 10000 // 10 segundos para adquirir conexión del pool
};

// Función para crear conexión
async function createConnection() {
  try {
    const connection = await mysql.createConnection(dbConfig);
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