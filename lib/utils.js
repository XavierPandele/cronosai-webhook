const moment = require('moment');

// Combinar fecha y hora para la tabla RESERVA
function combinarFechaHora(fecha, hora) {
  // Manejar objeto de fecha de Dialogflow CX
  if (fecha && typeof fecha === 'object') {
    const fechaFormateada = `${fecha.year}-${String(fecha.month).padStart(2, '0')}-${String(fecha.day).padStart(2, '0')}`;
    const horaFormateada = `${String(hora.hours).padStart(2, '0')}:${String(hora.minutes).padStart(2, '0')}:${String(hora.seconds).padStart(2, '0')}`;
    return `${fechaFormateada} ${horaFormateada}`;
  }
  
  // Manejar fecha como string
  const fechaFormateada = moment(fecha).format('YYYY-MM-DD');
  const horaFormateada = moment(hora, ['HH:mm', 'HH:mm:ss', 'h:mm A']).format('HH:mm:ss');
  return `${fechaFormateada} ${horaFormateada}`;
}

// Formatear fecha para mostrar al usuario
function formatearFecha(fecha) {
  if (fecha && typeof fecha === 'object') {
    return `${String(fecha.day).padStart(2, '0')}/${String(fecha.month).padStart(2, '0')}/${fecha.year}`;
  }
  return moment(fecha).format('DD/MM/YYYY');
}

// Formatear hora para mostrar al usuario
function formatearHora(hora) {
  if (hora && typeof hora === 'object') {
    return `${String(hora.hours).padStart(2, '0')}:${String(hora.minutes).padStart(2, '0')}`;
  }
  return moment(hora, ['HH:mm', 'HH:mm:ss', 'h:mm A']).format('HH:mm');
}

// Validar datos de reserva
function validarReserva(params) {
  const { NumeroReserva, FechaReserva, HoraReserva, NomReserva, TelefonReserva } = params;
  const errores = [];

  if (!NomReserva || (typeof NomReserva === 'object' && !NomReserva.name) || (typeof NomReserva === 'string' && NomReserva.length < 2)) {
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
  conversacion.push(`• Nombre: ${typeof params.NomReserva === 'object' ? params.NomReserva.name : params.NomReserva}`);
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
  conversacion.push(`• Page: ${requestBody.pageInfo?.displayName || 'N/A'}`);
  conversacion.push(`• Language: ${requestBody.languageCode || 'N/A'}`);
  
  return conversacion.join('\n');
}

module.exports = {
  combinarFechaHora,
  formatearFecha,
  formatearHora,
  validarReserva,
  generarConversacionCompleta
};