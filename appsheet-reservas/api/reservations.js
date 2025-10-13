// API REST para AppSheet - Gestión de Reservas
// Compatible con Vercel Serverless Functions

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

// Función para crear conexión a base de datos
async function createConnection() {
  try {
    const connection = await mysql.createConnection(dbConfig);
    return connection;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error);
    throw error;
  }
}

// Handler principal
export default async function handler(req, res) {
  // Configurar CORS para permitir acceso desde AppSheet
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');

  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validar API Key (opcional pero recomendado)
  const apiKey = req.headers['x-api-key'];
  const validApiKey = process.env.API_KEY || 'appsheet-cronos-2024';
  
  if (apiKey !== validApiKey) {
    return res.status(401).json({
      success: false,
      error: 'API Key inválida o faltante'
    });
  }

  try {
    // Enrutamiento según método HTTP
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'PUT':
        return await handlePut(req, res);
      case 'DELETE':
        return await handleDelete(req, res);
      default:
        return res.status(405).json({
          success: false,
          error: 'Método no permitido'
        });
    }
  } catch (error) {
    console.error('❌ Error en la API:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  }
}

// GET - Obtener reservas
async function handleGet(req, res) {
  const connection = await createConnection();
  
  try {
    const { id, status, fecha_inicio, fecha_fin, telefon } = req.query;

    // Obtener una reserva específica por ID
    if (id) {
      const [rows] = await connection.execute(
        'SELECT * FROM reservas WHERE id_reserva = ?',
        [id]
      );
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Reserva no encontrada'
        });
      }
      
      return res.status(200).json({
        success: true,
        data: formatReservation(rows[0])
      });
    }

    // Construir query dinámica con filtros
    let query = 'SELECT * FROM reservas WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (telefon) {
      query += ' AND telefon = ?';
      params.push(telefon);
    }

    if (fecha_inicio && fecha_fin) {
      query += ' AND data_reserva BETWEEN ? AND ?';
      params.push(fecha_inicio, fecha_fin);
    } else if (fecha_inicio) {
      query += ' AND DATE(data_reserva) >= ?';
      params.push(fecha_inicio);
    } else if (fecha_fin) {
      query += ' AND DATE(data_reserva) <= ?';
      params.push(fecha_fin);
    }

    query += ' ORDER BY data_reserva ASC';

    const [rows] = await connection.execute(query, params);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows.map(formatReservation)
    });

  } finally {
    await connection.end();
  }
}

// POST - Crear nueva reserva
async function handlePost(req, res) {
  const connection = await createConnection();
  
  try {
    const {
      nom_persona_reserva,
      telefon,
      data_reserva,
      num_persones,
      observacions,
      conversa_completa,
      status
    } = req.body;

    // Validar campos obligatorios
    if (!nom_persona_reserva || !telefon || !data_reserva || !num_persones) {
      return res.status(400).json({
        success: false,
        error: 'Campos obligatorios faltantes',
        required: ['nom_persona_reserva', 'telefon', 'data_reserva', 'num_persones']
      });
    }

    // Validar formato de fecha
    if (!isValidDate(data_reserva)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de fecha inválido. Use: YYYY-MM-DD HH:MM:SS'
      });
    }

    // Validar número de personas
    if (num_persones < 1 || num_persones > 20) {
      return res.status(400).json({
        success: false,
        error: 'El número de personas debe estar entre 1 y 20'
      });
    }

    // Validar estado si se proporciona
    const validStatuses = ['confirmed', 'pending', 'cancelled', 'completed'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Estado inválido. Estados válidos: confirmed, pending, cancelled, completed'
      });
    }

    // Insertar reserva
    const query = `
      INSERT INTO reservas 
      (nom_persona_reserva, telefon, data_reserva, num_persones, observacions, conversa_completa, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.execute(query, [
      nom_persona_reserva,
      telefon,
      data_reserva,
      num_persones,
      observacions || null,
      conversa_completa || null,
      status || 'pending'
    ]);

    // Obtener la reserva creada
    const [newReservation] = await connection.execute(
      'SELECT * FROM reservas WHERE id_reserva = ?',
      [result.insertId]
    );

    return res.status(201).json({
      success: true,
      message: 'Reserva creada exitosamente',
      data: formatReservation(newReservation[0])
    });

  } finally {
    await connection.end();
  }
}

// PUT - Actualizar reserva
async function handlePut(req, res) {
  const connection = await createConnection();
  
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'ID de reserva es requerido'
      });
    }

    // Verificar que la reserva existe
    const [existing] = await connection.execute(
      'SELECT * FROM reservas WHERE id_reserva = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reserva no encontrada'
      });
    }

    // Construir query de actualización dinámicamente
    const updates = [];
    const params = [];

    const allowedFields = [
      'nom_persona_reserva',
      'telefon',
      'data_reserva',
      'num_persones',
      'observacions',
      'conversa_completa',
      'status'
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay campos para actualizar'
      });
    }

    params.push(id);

    const query = `UPDATE reservas SET ${updates.join(', ')} WHERE id_reserva = ?`;
    await connection.execute(query, params);

    // Obtener la reserva actualizada
    const [updated] = await connection.execute(
      'SELECT * FROM reservas WHERE id_reserva = ?',
      [id]
    );

    return res.status(200).json({
      success: true,
      message: 'Reserva actualizada exitosamente',
      data: formatReservation(updated[0])
    });

  } finally {
    await connection.end();
  }
}

// DELETE - Eliminar reserva
async function handleDelete(req, res) {
  const connection = await createConnection();
  
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'ID de reserva es requerido'
      });
    }

    // Verificar que la reserva existe
    const [existing] = await connection.execute(
      'SELECT * FROM reservas WHERE id_reserva = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Reserva no encontrada'
      });
    }

    // Eliminar la reserva
    await connection.execute(
      'DELETE FROM reservas WHERE id_reserva = ?',
      [id]
    );

    return res.status(200).json({
      success: true,
      message: 'Reserva eliminada exitosamente',
      data: formatReservation(existing[0])
    });

  } finally {
    await connection.end();
  }
}

// Funciones auxiliares

function formatReservation(reservation) {
  return {
    id_reserva: reservation.id_reserva,
    nom_persona_reserva: reservation.nom_persona_reserva,
    telefon: reservation.telefon,
    data_reserva: reservation.data_reserva,
    num_persones: reservation.num_persones,
    observacions: reservation.observacions,
    conversa_completa: reservation.conversa_completa,
    status: reservation.status,
    status_display: getStatusDisplay(reservation.status),
    status_color: getStatusColor(reservation.status),
    created_at: reservation.created_at,
    updated_at: reservation.updated_at
  };
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

function getStatusColor(status) {
  const colorMap = {
    'confirmed': '#4CAF50',    // Verde
    'pending': '#FFA500',      // Naranja
    'cancelled': '#F44336',    // Rojo
    'completed': '#2196F3'     // Azul
  };
  return colorMap[status] || '#808080'; // Gris por defecto
}

function isValidDate(dateString) {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

