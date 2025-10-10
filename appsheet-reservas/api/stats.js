// API para estadísticas y análisis de reservas
// Para dashboards en AppSheet

const mysql = require('mysql2/promise');

// Configuración de base de datos
const dbConfig = {
  host: process.env.DB_HOST || 'db1.bwai.cc',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'cronosdev',
  password: process.env.DB_PASS || ')CDJ6gwpCO9rg-W/',
  database: process.env.DB_NAME || 'cronosai',
  acquireTimeout: 10000,
  timeout: 10000
};

async function createConnection() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    return connection;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error);
    throw error;
  }
}

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Solo se permite método GET'
    });
  }

  // Validar API Key
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY || 'appsheet-cronos-2024';
  
  if (apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: 'API Key inválida o faltante'
    });
  }

  const connection = await createConnection();
  
  try {
    const { periodo = 'mes' } = req.query;

    // Estadísticas generales
    const [totalReservas] = await connection.execute(
      'SELECT COUNT(*) as total FROM reservas'
    );

    const [totalPersonas] = await connection.execute(
      'SELECT SUM(num_persones) as total FROM reservas'
    );

    const [promedioPersonas] = await connection.execute(
      'SELECT AVG(num_persones) as promedio FROM reservas'
    );

    // Reservas por estado
    const [porEstado] = await connection.execute(`
      SELECT 
        status,
        COUNT(*) as cantidad,
        SUM(num_persones) as total_personas
      FROM reservas
      GROUP BY status
    `);

    // Reservas por día de la semana
    const [porDiaSemana] = await connection.execute(`
      SELECT 
        DAYNAME(data_reserva) as dia_semana,
        COUNT(*) as cantidad,
        AVG(num_persones) as promedio_personas
      FROM reservas
      GROUP BY DAYNAME(data_reserva), DAYOFWEEK(data_reserva)
      ORDER BY DAYOFWEEK(data_reserva)
    `);

    // Reservas por hora
    const [porHora] = await connection.execute(`
      SELECT 
        HOUR(data_reserva) as hora,
        COUNT(*) as cantidad,
        SUM(num_persones) as total_personas
      FROM reservas
      GROUP BY HOUR(data_reserva)
      ORDER BY hora
    `);

    // Top clientes
    const [topClientes] = await connection.execute(`
      SELECT 
        nom_persona_reserva,
        telefon,
        COUNT(*) as total_reservas,
        SUM(num_persones) as total_personas,
        MAX(data_reserva) as ultima_reserva
      FROM reservas
      GROUP BY nom_persona_reserva, telefon
      ORDER BY total_reservas DESC
      LIMIT 10
    `);

    // Reservas del mes actual
    const [mesActual] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(num_persones) as total_personas,
        DATE(data_reserva) as fecha,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmadas
      FROM reservas
      WHERE MONTH(data_reserva) = MONTH(CURDATE())
        AND YEAR(data_reserva) = YEAR(CURDATE())
      GROUP BY DATE(data_reserva)
      ORDER BY fecha
    `);

    // Próximas reservas (siguientes 7 días)
    const [proximasReservas] = await connection.execute(`
      SELECT 
        id_reserva,
        nom_persona_reserva,
        telefon,
        data_reserva,
        num_persones,
        status
      FROM reservas
      WHERE data_reserva BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
      ORDER BY data_reserva ASC
      LIMIT 20
    `);

    // Tasa de cancelación
    const [tasaCancelacion] = await connection.execute(`
      SELECT 
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) * 100.0 / COUNT(*) as tasa_cancelacion
      FROM reservas
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      estadisticas_generales: {
        total_reservas: totalReservas[0].total,
        total_personas: totalPersonas[0].total || 0,
        promedio_personas: parseFloat(promedioPersonas[0].promedio || 0).toFixed(2),
        tasa_cancelacion: parseFloat(tasaCancelacion[0].tasa_cancelacion || 0).toFixed(2) + '%'
      },
      por_estado: porEstado,
      por_dia_semana: porDiaSemana,
      por_hora: porHora,
      top_clientes: topClientes,
      mes_actual: mesActual,
      proximas_reservas: proximasReservas
    });

  } catch (error) {
    console.error('❌ Error en stats API:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  } finally {
    await connection.end();
  }
}

