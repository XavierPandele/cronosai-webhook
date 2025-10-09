const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: 'db1.bwai.cc',
  port: 3306,
  user: 'cronosdev',
  password: ')CDJ6gwpCO9rg-W/',
  database: 'cronosai',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4'
};

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Función para probar conexión
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conexión a MySQL establecida correctamente');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error.message);
    return false;
  }
}

// Función para ejecutar consultas con manejo de errores
async function executeQuery(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return { success: true, data: rows };
  } catch (error) {
    console.error('Error ejecutando consulta:', error);
    return { success: false, error: error.message };
  }
}

// Función para obtener una conexión del pool
async function getConnection() {
  try {
    return await pool.getConnection();
  } catch (error) {
    console.error('Error obteniendo conexión:', error);
    throw error;
  }
}

module.exports = {
  pool,
  testConnection,
  executeQuery,
  getConnection
};
