const mysql = require('mysql2/promise');

// Configuración específica para tu base de datos
const dbConfig = {
  host: process.env.DB_HOST || 'db1.bwai.cc',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'cronosdev',
  password: process.env.DB_PASS || ')CDJ6gwpCO9rg-W/',
  database: process.env.DB_NAME || 'cronosai',
  acquireTimeout: 10000,
  timeout: 10000,
  reconnect: true
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