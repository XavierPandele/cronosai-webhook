/**
 * Validaciones mejoradas para reservas
 * Incluye validación de horarios, antelación, y capacidad
 */

const moment = require('moment');
const { getRestaurantConfig } = require('../config/restaurant-config');
const { checkAvailability, getAlternativeTimeSlots, validateMaxPeoplePerReservation } = require('./capacity');
const logger = require('./logging');

/**
 * Valida los datos de una reserva de forma completa
 * @param {Object} data - Datos de la reserva
 * @returns {Promise<{valido: boolean, errores: Array<string>, advertencias?: Array<string>}>}
 */
async function validarReservaCompleta(data) {
  const errores = [];
  const advertencias = [];

  try {
    const config = await getRestaurantConfig();
    const { NumeroReserva, FechaReserva, HoraReserva, NomReserva, TelefonReserva } = data;

    // 1. Validar nombre
    if (!NomReserva || (typeof NomReserva === 'object' && !NomReserva.name) || (typeof NomReserva === 'string' && NomReserva.trim().length < 2)) {
      errores.push('Nombre debe tener al menos 2 caracteres');
    }

    // 2. Validar teléfono
    if (!TelefonReserva || !/^[\d\s\-\+\(\)]+$/.test(TelefonReserva)) {
      errores.push('Teléfono debe ser válido');
    }

    // 3. Validar fecha
    if (!FechaReserva) {
      errores.push('Fecha es requerida');
    } else {
      const fecha = moment(FechaReserva);
      if (!fecha.isValid()) {
        errores.push('Fecha inválida');
      } else if (fecha.isBefore(moment(), 'day')) {
        errores.push('La fecha no puede ser en el pasado');
      }
    }

    // 4. Validar hora
    if (!HoraReserva) {
      errores.push('Hora es requerida');
    } else {
      const hora = moment(HoraReserva, ['HH:mm', 'HH:mm:ss', 'h:mm A']);
      if (!hora.isValid()) {
        errores.push('Hora inválida');
      }
    }

    // 5. Validar número de personas
    if (!NumeroReserva || NumeroReserva < 1) {
      errores.push('Número de personas debe ser válido');
    } else {
      const validacionPersonas = await validateMaxPeoplePerReservation(NumeroReserva);
      if (!validacionPersonas.valido) {
        errores.push(validacionPersonas.mensaje);
      }
    }

    // 6. Validar antelación mínima (si tenemos fecha y hora)
    if (FechaReserva && HoraReserva && errores.length === 0) {
      const fechaHora = moment(`${FechaReserva} ${HoraReserva}`, 'YYYY-MM-DD HH:mm');
      const ahora = moment();
      const diferenciaHoras = fechaHora.diff(ahora, 'hours', true);

      if (diferenciaHoras < config.minAntelacionHoras) {
        errores.push(`La reserva debe hacerse con al menos ${config.minAntelacionHoras} horas de antelación`);
      }
    }

    // 7. Validar horario del restaurante
    if (HoraReserva && errores.length === 0) {
      const hora = moment(HoraReserva, ['HH:mm', 'HH:mm:ss', 'h:mm A']);
      const horaNum = hora.hours() * 100 + hora.minutes();
      const horaApertura = parseInt(config.horarioApertura.replace(':', ''));
      const horaCierre = parseInt(config.horarioCierre.replace(':', ''));

      if (horaNum < horaApertura || horaNum > horaCierre) {
        errores.push(`El restaurante está abierto de ${config.horarioApertura} a ${config.horarioCierre}`);
      }
    }

    return {
      valido: errores.length === 0,
      errores,
      advertencias
    };

  } catch (error) {
    logger.error('Error en validación completa', { error: error.message, data });
    return {
      valido: false,
      errores: ['Error en la validación. Por favor, intente de nuevo.']
    };
  }
}

/**
 * Valida la disponibilidad antes de confirmar una reserva
 * @param {string} fechaHora - Fecha y hora combinada
 * @param {number} numPersonas - Número de personas
 * @returns {Promise<{disponible: boolean, mensaje?: string, alternativas?: Array}>}
 */
async function validarDisponibilidad(fechaHora, numPersonas) {
  try {
    const disponibilidad = await checkAvailability(fechaHora, numPersonas);

    if (!disponibilidad.disponible) {
      // Obtener alternativas
      const alternativas = await getAlternativeTimeSlots(fechaHora, numPersonas, 3);
      
      return {
        disponible: false,
        mensaje: disponibilidad.mensaje,
        alternativas: alternativas.map(alt => alt.fechaHora),
        detalles: {
          personasOcupadas: disponibilidad.personasOcupadas,
          capacidad: disponibilidad.capacidad,
          capacidadDisponible: disponibilidad.capacidadDisponible
        }
      };
    }

    return {
      disponible: true,
      detalles: {
        personasOcupadas: disponibilidad.personasOcupadas,
        capacidad: disponibilidad.capacidad,
        capacidadDisponible: disponibilidad.capacidadDisponible
      }
    };

  } catch (error) {
    logger.error('Error validando disponibilidad', { error: error.message });
    // En caso de error, permitir la reserva
    return { disponible: true, error: error.message };
  }
}

/**
 * Valida que la fecha/hora esté en el futuro
 * @param {string} fechaHora - Fecha y hora
 * @returns {boolean}
 */
function validarFechaFutura(fechaHora) {
  const fecha = moment(fechaHora);
  return fecha.isValid() && fecha.isAfter(moment());
}

module.exports = {
  validarReservaCompleta,
  validarDisponibilidad,
  validarFechaFutura
};

