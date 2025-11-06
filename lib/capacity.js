/**
 * Control de capacidad del restaurante
 * Verifica disponibilidad antes de confirmar reservas
 */

const { createConnection } = require('./database');
const { getRestaurantConfig } = require('../config/restaurant-config');
const logger = require('./logging');

/**
 * Verifica la disponibilidad para una fecha/hora y número de personas
 * @param {string} fechaHora - Fecha y hora en formato 'YYYY-MM-DD HH:MM:SS'
 * @param {number} numPersonas - Número de personas para la reserva
 * @returns {Promise<{disponible: boolean, personasOcupadas: number, capacidad: number, mensaje?: string}>}
 */
async function checkAvailability(fechaHora, numPersonas) {
  try {
    const config = await getRestaurantConfig();
    const connection = await createConnection();

    try {
      // Calcular ventana de tiempo (duración de reserva + solapamiento)
      const fechaReserva = new Date(fechaHora);
      const inicioVentana = new Date(fechaReserva);
      inicioVentana.setMinutes(inicioVentana.getMinutes() - config.ventanaSolapamiento);
      
      const finVentana = new Date(fechaReserva);
      finVentana.setMinutes(finVentana.getMinutes() + config.duracionReservaMinutos + config.ventanaSolapamiento);

      // Consultar reservas activas en esa ventana de tiempo
      // Solo contar reservas confirmadas o pendientes (no canceladas)
      const query = `
        SELECT SUM(num_persones) as total_personas
        FROM RESERVA
        WHERE data_reserva >= ? 
          AND data_reserva < ?
          AND status IN ('pending', 'confirmed')
      `;

      const [rows] = await connection.execute(query, [
        inicioVentana.toISOString().slice(0, 19).replace('T', ' '),
        finVentana.toISOString().slice(0, 19).replace('T', ' ')
      ]);

      const personasOcupadas = rows[0]?.total_personas || 0;
      const capacidadDisponible = config.capacidadMaxima - personasOcupadas;
      const capacidadConBuffer = config.capacidadMaxima - Math.floor(config.capacidadMaxima * config.bufferCapacidad / 100);

      logger.capacity('Verificando disponibilidad', {
        fechaHora,
        numPersonas,
        personasOcupadas,
        capacidadMaxima: config.capacidadMaxima,
        capacidadDisponible,
        capacidadConBuffer
      });

      // Verificar si hay espacio suficiente
      const disponible = capacidadDisponible >= numPersonas;

      return {
        disponible,
        personasOcupadas: parseInt(personasOcupadas),
        capacidad: config.capacidadMaxima,
        capacidadDisponible,
        capacidadConBuffer,
        mensaje: disponible 
          ? null 
          : `No hay disponibilidad. Ocupadas: ${personasOcupadas}/${config.capacidadMaxima} personas`
      };

    } finally {
      await connection.end();
    }

  } catch (error) {
    logger.error('Error verificando disponibilidad', { error: error.message, stack: error.stack });
    // En caso de error, permitir la reserva pero loguear
    return {
      disponible: true, // Fallback: permitir si hay error
      personasOcupadas: 0,
      capacidad: 100,
      capacidadDisponible: 100,
      error: error.message
    };
  }
}

/**
 * Obtiene horarios alternativos disponibles cerca de la fecha/hora solicitada
 * @param {string} fechaHora - Fecha y hora solicitada
 * @param {number} numPersonas - Número de personas
 * @param {number} opciones - Número de opciones a retornar (default: 3)
 * @returns {Promise<Array<{fechaHora: string, disponible: boolean}>>}
 */
async function getAlternativeTimeSlots(fechaHora, numPersonas, opciones = 3) {
  try {
    const config = await getRestaurantConfig();
    const fechaBase = new Date(fechaHora);
    const alternativas = [];

    // Generar opciones: -1h, -30min, +30min, +1h, +2h
    const offsets = [-60, -30, 30, 60, 120]; // en minutos

    for (const offset of offsets) {
      if (alternativas.length >= opciones) break;

      const fechaAlternativa = new Date(fechaBase);
      fechaAlternativa.setMinutes(fechaAlternativa.getMinutes() + offset);

      // Verificar que esté dentro del horario del restaurante
      const hora = fechaAlternativa.getHours() * 100 + fechaAlternativa.getMinutes();
      const horaApertura = parseInt(config.horarioApertura.replace(':', ''));
      const horaCierre = parseInt(config.horarioCierre.replace(':', ''));

      if (hora >= horaApertura && hora <= horaCierre) {
        const disponibilidad = await checkAvailability(
          fechaAlternativa.toISOString().slice(0, 19).replace('T', ' '),
          numPersonas
        );

        if (disponibilidad.disponible) {
          alternativas.push({
            fechaHora: fechaAlternativa.toISOString().slice(0, 19).replace('T', ' '),
            disponible: true,
            offset: offset
          });
        }
      }
    }

    return alternativas.slice(0, opciones);

  } catch (error) {
    logger.error('Error obteniendo horarios alternativos', { error: error.message });
    return [];
  }
}

/**
 * Verifica si una reserva excede la capacidad máxima por mesa
 * @param {number} numPersonas - Número de personas
 * @returns {Promise<{valido: boolean, mensaje?: string}>}
 */
async function validateMaxPeoplePerReservation(numPersonas) {
  try {
    const config = await getRestaurantConfig();

    if (numPersonas > config.maxPersonasMesa) {
      return {
        valido: false,
        mensaje: `El máximo de personas por reserva es ${config.maxPersonasMesa}`
      };
    }

    if (numPersonas < config.minPersonas) {
      return {
        valido: false,
        mensaje: `El mínimo de personas por reserva es ${config.minPersonas}`
      };
    }

    return { valido: true };

  } catch (error) {
    logger.error('Error validando número de personas', { error: error.message });
    return { valido: true }; // Fallback: permitir si hay error
  }
}

module.exports = {
  checkAvailability,
  getAlternativeTimeSlots,
  validateMaxPeoplePerReservation
};

