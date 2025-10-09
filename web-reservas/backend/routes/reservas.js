const express = require('express');
const { body, validationResult } = require('express-validator');
const Reserva = require('../models/Reserva');
const moment = require('moment');

const router = express.Router();

// Middleware para validar errores
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Datos de entrada inválidos',
      details: errors.array()
    });
  }
  next();
};

// Validaciones para crear reserva
const validateReserva = [
  body('nom_persona_reserva')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('El nombre debe tener entre 2 y 100 caracteres'),
  body('telefon')
    .trim()
    .isLength({ min: 7, max: 20 })
    .withMessage('El teléfono debe tener entre 7 y 20 caracteres'),
  body('data_reserva')
    .isISO8601()
    .withMessage('La fecha debe ser válida'),
  body('num_persones')
    .isInt({ min: 1, max: 20 })
    .withMessage('El número de personas debe estar entre 1 y 20'),
  body('observacions')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Las observaciones no pueden exceder 500 caracteres')
];

// Endpoint para consultar disponibilidad
router.post('/disponibilidad', async (req, res) => {
  try {
    console.log('📞 Consulta de disponibilidad recibida:', JSON.stringify(req.body, null, 2));

    const { data_reserva, num_persones } = req.body;
    
    if (!data_reserva) {
      return res.status(400).json({
        success: false,
        error: 'Fecha es requerida'
      });
    }

    const num_persones_int = parseInt(num_persones) || 1;
    
    // Formatear fecha
    const fechaFormateada = moment(data_reserva).format('YYYY-MM-DD');
    
    // Validar que la fecha no sea en el pasado
    const hoy = moment().startOf('day');
    const fechaReserva = moment(fechaFormateada);
    
    if (fechaReserva.isBefore(hoy)) {
      return res.status(400).json({
        success: false,
        error: 'No se pueden hacer reservas para fechas pasadas'
      });
    }

    const resultado = await Reserva.consultarDisponibilidad(fechaFormateada, num_persones_int);
    
    if (!resultado.success) {
      return res.status(500).json(resultado);
    }

    // Preparar respuesta
    const respuesta = {
      success: true,
      disponible: resultado.disponible,
      horarios_disponibles: resultado.horarios_disponibles,
      data_reserva: fechaFormateada,
      num_persones: num_persones_int,
      message: resultado.disponible 
        ? `Tenemos disponibilidad para ${num_persones_int} personas el ${fechaFormateada} en los siguientes horarios: ${resultado.horarios_disponibles.join(', ')}`
        : `Disculpe, no tenemos disponibilidad para ${num_persones_int} personas el ${fechaFormateada}. ¿Le gustaría consultar otra fecha?`
    };

    console.log('✅ Respuesta disponibilidad:', JSON.stringify(respuesta, null, 2));
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error en consulta de disponibilidad:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para crear reserva - SIMPLIFICADO
router.post('/crear-reserva', async (req, res) => {
  try {
    console.log('📞 Creación de reserva recibida:', JSON.stringify(req.body, null, 2));

    const { nom_persona_reserva, telefon, data_reserva, num_persones, observacions } = req.body;
    
    // Validaciones básicas
    if (!nom_persona_reserva || !telefon || !data_reserva || !num_persones) {
      return res.status(400).json({
        success: false,
        error: 'Todos los campos son obligatorios'
      });
    }
    
    // Formatear fecha
    const fechaFormateada = moment(data_reserva).format('YYYY-MM-DD');
    
    const datosReserva = {
      nom_persona_reserva: nom_persona_reserva.trim(),
      telefon: telefon.trim(),
      data_reserva: fechaFormateada,
      num_persones: parseInt(num_persones),
      observacions: observacions ? observacions.trim() : null,
      conversa_completa: 'Reserva via página web'
    };

    const resultado = await Reserva.crear(datosReserva);
    
    if (!resultado.success) {
      return res.status(500).json(resultado);
    }

    // Preparar respuesta de confirmación
    const respuesta = {
      success: true,
      id_reserva: resultado.id_reserva,
      message: `¡Excelente! Su reserva ha sido confirmada exitosamente.\n\n` +
               `📋 Detalles de la reserva:\n` +
               `• ID de reserva: ${resultado.id_reserva}\n` +
               `• Nombre: ${datosReserva.nom_persona_reserva}\n` +
               `• Fecha: ${fechaFormateada}\n` +
               `• Personas: ${datosReserva.num_persones}\n` +
               `• Teléfono: ${datosReserva.telefon}\n\n` +
               `¡Esperamos darle la bienvenida!`,
      reserva: {
        id_reserva: resultado.id_reserva,
        nom_persona_reserva: datosReserva.nom_persona_reserva,
        telefon: datosReserva.telefon,
        data_reserva: fechaFormateada,
        num_persones: datosReserva.num_persones,
        observacions: datosReserva.observacions,
        conversa_completa: datosReserva.conversa_completa
      }
    };

    console.log('✅ Reserva creada exitosamente:', resultado.id_reserva);
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error creando reserva:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para cancelar reserva
router.post('/cancelar-reserva', async (req, res) => {
  try {
    console.log('📞 Cancelación de reserva recibida:', JSON.stringify(req.body, null, 2));

    const { id_reserva, telefono } = req.body;
    
    if (!id_reserva || !telefono) {
      return res.status(400).json({
        success: false,
        error: 'ID de reserva y teléfono son requeridos'
      });
    }

    const resultado = await Reserva.cancelar(id_reserva, telefono);
    
    const respuesta = {
      success: resultado.success,
      message: resultado.success 
        ? `Su reserva ${id_reserva} ha sido cancelada exitosamente. Esperamos poder servirle en otra ocasión.`
        : "Disculpe, no pude encontrar su reserva. Verifique el ID de reserva y teléfono, o contacte directamente al restaurante.",
      error: resultado.error
    };

    console.log(resultado.success ? '✅ Reserva cancelada:' : '❌ Error cancelando reserva:', id_reserva);
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error cancelando reserva:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para buscar reservas por teléfono
router.post('/buscar-reservas', async (req, res) => {
  try {
    console.log('📞 Búsqueda de reservas recibida:', JSON.stringify(req.body, null, 2));

    const { telefono } = req.body;
    
    if (!telefono) {
      return res.status(400).json({
        success: false,
        error: 'Teléfono es requerido'
      });
    }

    const resultado = await Reserva.buscarPorTelefono(telefono);
    
    if (!resultado.success) {
      return res.status(500).json(resultado);
    }

    let message = '';
    if (resultado.reservas.length === 0) {
      message = "No encontré reservas activas para este número de teléfono.";
    } else {
      message = "Encontré las siguientes reservas activas:\n\n";
      resultado.reservas.forEach(reserva => {
        const fecha = moment(reserva.data_reserva).format('YYYY-MM-DD HH:mm');
        message += `📋 ID: ${reserva.id_reserva}\n`;
        message += `• Nombre: ${reserva.nom_persona_reserva}\n`;
        message += `• Fecha: ${fecha}\n`;
        message += `• Personas: ${reserva.num_persones}\n\n`;
      });
    }

    const respuesta = {
      success: true,
      message: message,
      reservas: resultado.reservas
    };

    console.log(`✅ Búsqueda completada: ${resultado.reservas.length} reservas encontradas`);
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error buscando reservas:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para obtener detalles de una reserva
router.get('/reserva/:id_reserva', async (req, res) => {
  try {
    const { id_reserva } = req.params;
    
    const resultado = await Reserva.obtenerPorNumero(id_reserva);
    
    if (!resultado.success) {
      return res.status(500).json(resultado);
    }

    if (!resultado.reserva) {
      return res.status(404).json({
        success: false,
        error: 'Reserva no encontrada'
      });
    }

    res.json({
      success: true,
      reserva: resultado.reserva
    });

  } catch (error) {
    console.error('❌ Error obteniendo reserva:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint para obtener estadísticas
router.get('/estadisticas', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin } = req.query;
    
    if (!fecha_inicio || !fecha_fin) {
      return res.status(400).json({
        success: false,
        error: 'Fechas de inicio y fin son requeridas'
      });
    }

    const resultado = await Reserva.obtenerEstadisticas(fecha_inicio, fecha_fin);
    
    if (!resultado.success) {
      return res.status(500).json(resultado);
    }

    res.json({
      success: true,
      estadisticas: resultado.estadisticas
    });

  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

// Endpoint de salud del servidor
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'CronosAI Web Reservas Backend',
    version: '1.0.0'
  });
});

// Endpoint de prueba simple
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Backend funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// Endpoint de prueba para disponibilidad (sin base de datos)
router.post('/test-disponibilidad', (req, res) => {
  try {
    const { data_reserva, num_persones } = req.body;
    
    // Generar horarios disponibles (18:00 a 22:30 cada 30 minutos)
    const horarios_disponibles = [];
    for (let hora = 18; hora <= 22; hora++) {
      for (let minuto = 0; minuto < 60; minuto += 30) {
        if (hora === 22 && minuto > 30) break;
        const horaStr = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`;
        horarios_disponibles.push(horaStr);
      }
    }

    res.json({
      success: true,
      disponible: true,
      horarios_disponibles: horarios_disponibles,
      data_reserva: data_reserva,
      num_persones: num_persones,
      message: 'Prueba de disponibilidad exitosa'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error en prueba de disponibilidad'
    });
  }
});

// Endpoint de prueba para crear reserva (SIN BASE DE DATOS)
router.post('/test-crear-reserva', (req, res) => {
  try {
    console.log('📞 Prueba de creación de reserva recibida:', JSON.stringify(req.body, null, 2));

    const { nom_persona_reserva, telefon, data_reserva, num_persones, observacions } = req.body;
    
    // Validaciones básicas
    if (!nom_persona_reserva || !telefon || !data_reserva || !num_persones) {
      return res.status(400).json({
        success: false,
        error: 'Todos los campos son obligatorios'
      });
    }
    
    // Simular ID de reserva
    const id_reserva = Math.floor(Math.random() * 1000000);
    
    // Preparar respuesta de confirmación
    const respuesta = {
      success: true,
      id_reserva: id_reserva,
      message: `¡Excelente! Su reserva ha sido confirmada exitosamente.\n\n` +
               `📋 Detalles de la reserva:\n` +
               `• ID de reserva: ${id_reserva}\n` +
               `• Nombre: ${nom_persona_reserva}\n` +
               `• Fecha: ${data_reserva}\n` +
               `• Personas: ${num_persones}\n` +
               `• Teléfono: ${telefon}\n\n` +
               `¡Esperamos darle la bienvenida!`,
      reserva: {
        id_reserva: id_reserva,
        nom_persona_reserva: nom_persona_reserva,
        telefon: telefon,
        data_reserva: data_reserva,
        num_persones: num_persones,
        observacions: observacions,
        conversa_completa: 'Reserva via página web'
      }
    };

    console.log('✅ Prueba de reserva creada exitosamente:', id_reserva);
    res.json(respuesta);

  } catch (error) {
    console.error('❌ Error en prueba de reserva:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor'
    });
  }
});

module.exports = router;
