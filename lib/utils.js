const moment = require('moment');

// Combinar fecha y hora para la tabla RESERVA
function combinarFechaHora(fecha, hora) {
  const fechaFormateada = moment(fecha).format('YYYY-MM-DD');
  const horaFormateada = moment(hora, ['HH:mm', 'HH:mm:ss', 'h:mm A']).format('HH:mm:ss');
  return `${fechaFormateada} ${horaFormateada}`;
}

// Formatear fecha para mostrar al usuario
function formatearFecha(fecha) {
  return moment(fecha).format('DD/MM/YYYY');
}

// Formatear hora para mostrar al usuario
function formatearHora(hora) {
  return moment(hora, ['HH:mm', 'HH:mm:ss', 'h:mm A']).format('HH:mm');
}

// Validar datos de reserva
function validarReserva(params) {
  const { NumeroReserva, FechaReserva, HoraReserva, NomReserva, TelefonReserva } = params;
  const errores = [];

  if (!NomReserva || NomReserva.length < 2) {
    errores.push('Nombre debe tener al menos 2 caracteres');
  }

  if (!TelefonReserva || !/^[\d\s\-\+\(\)]+$/.test(TelefonReserva)) {
    errores.push('Teléfono debe ser válido');
  }

  if (!FechaReserva) {
    errores.push('Fecha es requerida');
  }

  if (!HoraReserva) {
    errores.push('Hora es requerida');
  }

  if (!NumeroReserva || NumeroReserva < 1) {
    errores.push('Número de personas debe ser válido');
  }

  return {
    valido: errores.length === 0,
    errores
  };
}

// Generar la conversación completa para guardar en la DB
function generarConversacionCompleta(params, requestBody, chatCompleto = '') {
  const conversacion = [];
  
  // Agregar timestamp
  conversacion.push(`=== RESERVA GENERADA ===`);
  conversacion.push(`Timestamp: ${new Date().toISOString()}`);
  conversacion.push('');
  
  // Agregar datos de la reserva
  conversacion.push(`DATOS DE LA RESERVA:`);
  conversacion.push(`• Nombre: ${params.NomReserva}`);
  conversacion.push(`• Teléfono: ${params.TelefonReserva}`);
  conversacion.push(`• Personas: ${params.NumeroReserva}`);
  conversacion.push(`• Fecha: ${formatearFecha(params.FechaReserva)}`);
  conversacion.push(`• Hora: ${formatearHora(params.HoraReserva)}`);
  conversacion.push('');
  
  // Agregar chat completo si está disponible
  if (chatCompleto) {
    conversacion.push(`CHAT COMPLETO:`);
    conversacion.push(chatCompleto);
    conversacion.push('');
  }
  
  // Agregar información técnica
  conversacion.push(`INFORMACIÓN TÉCNICA:`);
  conversacion.push(`• Session ID: ${requestBody.sessionInfo?.session || 'N/A'}`);
  conversacion.push(`• Intent: ${requestBody.queryResult?.intent?.displayName || 'N/A'}`);
  conversacion.push(`• Confidence: ${requestBody.queryResult?.intentDetectionConfidence || 'N/A'}`);
  
  return conversacion.join('\n');
}

module.exports = {
  combinarFechaHora,
  formatearFecha,
  formatearHora,
  validarReserva,
  generarConversacionCompleta
};