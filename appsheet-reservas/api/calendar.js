// API especializada para vista de calendario
// Optimizada para AppSheet Calendar View

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

// Función para crear conexión
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
    const { mes, anio, fecha_inicio, fecha_fin } = req.query;

    let query = `
      SELECT 
        id_reserva,
        nom_persona_reserva,
        telefon,
        data_reserva,
        num_persones,
        observacions,
        status,
        DATE(data_reserva) as fecha,
        TIME(data_reserva) as hora,
        DAYNAME(data_reserva) as dia_semana,
        DAY(data_reserva) as dia,
        MONTH(data_reserva) as mes,
        YEAR(data_reserva) as anio,
        created_at
      FROM reservas
      WHERE 1=1
    `;
    
    const params = [];

    // Filtrar por mes y año específicos
    if (mes && anio) {
      query += ' AND MONTH(data_reserva) = ? AND YEAR(data_reserva) = ?';
      params.push(mes, anio);
    }
    // Filtrar por rango de fechas
    else if (fecha_inicio && fecha_fin) {
      query += ' AND data_reserva BETWEEN ? AND ?';
      params.push(fecha_inicio, fecha_fin);
    }
    // Por defecto, mostrar del mes actual
    else {
      query += ' AND MONTH(data_reserva) = MONTH(CURDATE()) AND YEAR(data_reserva) = YEAR(CURDATE())';
    }

    query += ' ORDER BY data_reserva ASC';

    const [rows] = await connection.execute(query, params);

    // Formatear datos para vista de calendario
    const calendarEvents = rows.map(row => ({
      // Campos para AppSheet
      id: row.id_reserva,
      title: `${row.nom_persona_reserva} (${row.num_persones} personas)`,
      start: row.data_reserva,
      end: calculateEndTime(row.data_reserva, 120), // 2 horas por defecto
      description: row.observacions || 'Sin observaciones',
      location: 'Restaurante',
      
      // Campos adicionales
      cliente: row.nom_persona_reserva,
      telefono: row.telefon,
      num_personas: row.num_persones,
      estado: row.status,
      estado_display: getStatusDisplay(row.status),
      fecha: row.fecha,
      hora: row.hora,
      dia_semana: row.dia_semana,
      
      // Color según estado
      color: getColorByStatus(row.status),
      backgroundColor: getBackgroundColorByStatus(row.status),
      borderColor: getBorderColorByStatus(row.status)
    }));

    // Estadísticas del periodo
    const stats = {
      total_reservas: rows.length,
      total_personas: rows.reduce((sum, row) => sum + row.num_persones, 0),
      por_estado: {
        pending: rows.filter(r => r.status === 'pending').length,
        confirmed: rows.filter(r => r.status === 'confirmed').length,
        cancelled: rows.filter(r => r.status === 'cancelled').length,
        completed: rows.filter(r => r.status === 'completed').length
      }
    };

    return res.status(200).json({
      success: true,
      count: calendarEvents.length,
      stats: stats,
      events: calendarEvents
    });

  } catch (error) {
    console.error('❌ Error en calendar API:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  } finally {
    await connection.end();
  }
}

// Funciones auxiliares

function calculateEndTime(startTime, durationMinutes) {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return end.toISOString().slice(0, 19).replace('T', ' ');
}

function getStatusDisplay(status) {
  const statusMap = {
    'confirmed': '🟢 Confirmada',
    'pending': '🟡 Pendiente',
    'cancelled': '🔴 Cancelada',
    'completed': '🔵 Completada'
  };
  return statusMap[status] || '⚪ Desconocido';
}

function getColorByStatus(status) {
  const colors = {
    'confirmed': '#4CAF50',  // Verde
    'pending': '#FFA500',    // Naranja
    'cancelled': '#F44336',  // Rojo
    'completed': '#2196F3'   // Azul
  };
  return colors[status] || '#808080';
}

function getBackgroundColorByStatus(status) {
  const colors = {
    'confirmed': '#E8F5E9',  // Verde claro
    'pending': '#FFF3E0',    // Naranja claro
    'cancelled': '#FFEBEE',  // Rojo claro
    'completed': '#E3F2FD'   // Azul claro
  };
  return colors[status] || '#F5F5F5';
}

function getBorderColorByStatus(status) {
  const colors = {
    'confirmed': '#2E7D32',  // Verde oscuro
    'pending': '#F57C00',    // Naranja oscuro
    'cancelled': '#C62828',  // Rojo oscuro
    'completed': '#1565C0'   // Azul oscuro
  };
  return colors[status] || '#616161';
}

