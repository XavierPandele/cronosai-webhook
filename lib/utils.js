const moment = require('moment');

// Combinar fecha y hora para la tabla RESERVA
function combinarFechaHora(fecha, hora) {
  const fechaFormateada = moment(fecha).format('YYYY-MM-DD');
  const horaFormateada = moment(hora, ['HH:mm', 'HH:mm:ss', 'h:mm A']).format('HH:mm:ss');
  
  return moment(`${fechaFormateada} ${horaFormateada}`).format('YYYY-MM-DD HH:mm:ss');
}

// Formatear fecha para MySQL
function formatearFecha(fechaInput) {
  const formatos = [
    'YYYY-MM-DD',
    'DD/MM/YYYY',
    'MM/DD/YYYY',
    'DD-MM-YYYY',
    'YYYY-MM-DDTHH:mm:ss.sssZ'
  ];
  
  return moment(fechaInput, formatos, true).format('YYYY-MM-DD');
}

// Formatear hora para MySQL
function formatearHora(horaInput) {
  const formatos = ['HH:mm', 'HH:mm:ss', 'h:mm A', 'h:mm'];
  return moment(horaInput, formatos, true).format('HH:mm:ss');
}

// Validar datos de reserva según tu estructura
function validarReserva(datos) {
  const errores = [];
  
  if (!datos.NomReserva || datos.NomReserva.length < 2) {
    errores.push('Nombre debe tener al menos 2 caracteres');
  }
  
  if (!datos.TelefonReserva || datos.TelefonReserva.length < 8) {
    errores.push('Teléfono debe ser válido');
  }
  
  if (!datos.FechaReserva) {
    errores.push('Fecha es requerida');
  }
  
  if (!datos.HoraReserva) {
    errores.push('Hora es requerida');
  }
  
  if (!datos.NumeroReserva || datos.NumeroReserva < 1 || datos.NumeroReserva > 20) {
    errores.push('Número de personas debe estar entre 1 y 20');
  }
  
  return {
    valido: errores.length === 0,
    errores: errores
  };
}

// Generar conversación completa para TOTA_LA_CONVERSA
function generarConversacionCompleta(datos, webhookRequest) {
  const conversacion = [];
  
  // Agregar parámetros de la conversación
  conversacion.push(`Parámetros recibidos:`);
  conversacion.push(`- Número de personas: ${datos.NumeroReserva}`);
  conversacion.push(`- Fecha: ${datos.FechaReserva}`);
  conversacion.push(`- Hora: ${datos.HoraReserva}`);
  conversacion.push(`- Nombre: ${datos.NomReserva}`);
  conversacion.push(`- Teléfono: ${datos.TelefonReserva}`);
  
  // Agregar timestamp
  conversacion.push(`- Timestamp: ${new Date().toISOString()}`);
  
  return conversacion.join('\n');
}

module.exports = {
  combinarFechaHora,
  formatearFecha,
  formatearHora,
  validarReserva,
  generarConversacionCompleta
};