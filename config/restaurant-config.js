/**
 * Configuración centralizada del restaurante
 * Se puede obtener desde variables de entorno o base de datos
 */

const { executeQuery } = require('../lib/database');

// Cache de configuración (se actualiza cada 5 minutos)
let configCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

/**
 * Obtiene la configuración del restaurante
 * Prioridad: Variables de entorno > Base de datos > Valores por defecto
 */
async function getRestaurantConfig() {
  // Si el cache es válido, retornarlo
  if (configCache && cacheTimestamp && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
    return configCache;
  }

  let dbConfig = {};

  // Intentar obtener desde base de datos (tabla RESTAURANT)
  // Usar id_restaurante = 1 para restaurante por defecto
  try {
    const restaurantRows = await executeQuery(
      'SELECT * FROM RESTAURANT WHERE id_restaurante = ? AND activo = TRUE LIMIT 1',
      [parseInt(process.env.RESTAURANT_ID || '1')]
    );

    // Si hay resultados, parsear la información del restaurante
    if (restaurantRows && restaurantRows.length > 0) {
      const row = restaurantRows[0];
      
      // Función auxiliar para convertir TIME a formato HH:MM
      const timeToHHMM = (timeValue) => {
        if (!timeValue) return null;
        // Si es un objeto Time, convertir a string y tomar HH:MM
        const timeStr = timeValue.toString();
        return timeStr.slice(0, 5); // "HH:MM:SS" -> "HH:MM"
      };

      // horario1: desayuno, horario2: comida, horario3: cena
      dbConfig = {
        capacidad_maxima: row.capacidad_maxima_restaurante,
        duracion_reserva_minutos: row.duracion_reserva_minutos,
        // Horario 1 (desayuno)
        horario1_inicio: timeToHHMM(row.horario1_inicio),
        horario1_fin: timeToHHMM(row.horario1_fin),
        // Horario 2 (comida)
        horario2_inicio: timeToHHMM(row.horario2_inicio),
        horario2_fin: timeToHHMM(row.horario2_fin),
        // Horario 3 (cena)
        horario3_inicio: timeToHHMM(row.horario3_inicio),
        horario3_fin: timeToHHMM(row.horario3_fin),
        min_antelacion_horas: row.min_antelacion_horas_reserva,
        max_personas_mesa: row.max_personas_mesa,
        min_personas: row.min_personas_mesa,
        buffer_capacidad: row.buffer_capacidad_restaurante,
        ventana_solapamiento: row.ventana_solapamiento
      };
    }
  } catch (error) {
    // Si la tabla no existe o hay error, simplemente usar valores por defecto
    // No logueamos error para no llenar los logs si la tabla no existe
    dbConfig = {};
  }

  // Configuración con valores por defecto y override desde BD o ENV
  // Prioridad: ENV > BD > Default
  configCache = {
    // Capacidad
    capacidadMaxima: parseInt(
      process.env.RESTAURANT_CAPACITY || 
      dbConfig.capacidad_maxima || 
      '100'
    ),
    bufferCapacidad: parseInt(process.env.RESTAURANT_BUFFER || dbConfig.buffer_capacidad || '10'), // 10% de buffer
    
    // Duración de reservas
    duracionReservaMinutos: parseInt(
      process.env.RESERVATION_DURATION || 
      dbConfig.duracion_reserva_minutos || 
      '120'
    ),
    
    // Horarios (horario1: desayuno, horario2: comida, horario3: cena)
    // Para compatibilidad, mapeamos horario2 y horario3 a lunch/dinner
    horario1Inicio: process.env.RESTAURANT_HORARIO1_INICIO || dbConfig.horario1_inicio,
    horario1Fin: process.env.RESTAURANT_HORARIO1_FIN || dbConfig.horario1_fin,
    horario2Inicio: process.env.RESTAURANT_HORARIO2_INICIO || dbConfig.horario2_inicio || '13:00',
    horario2Fin: process.env.RESTAURANT_HORARIO2_FIN || dbConfig.horario2_fin || '15:00',
    horario3Inicio: process.env.RESTAURANT_HORARIO3_INICIO || dbConfig.horario3_inicio || '19:00',
    horario3Fin: process.env.RESTAURANT_HORARIO3_FIN || dbConfig.horario3_fin || '23:00',
    
    // Compatibilidad con código existente (mapea horario2 y horario3)
    horarioApertura: process.env.RESTAURANT_OPEN || dbConfig.horario2_inicio || '13:00', // Usa horario2 como referencia
    horarioCierre: process.env.RESTAURANT_CLOSE || dbConfig.horario3_fin || '23:00', // Usa horario3 como referencia
    lunchStart: process.env.RESTAURANT_LUNCH_START || dbConfig.horario2_inicio || '13:00',
    lunchEnd: process.env.RESTAURANT_LUNCH_END || dbConfig.horario2_fin || '15:00',
    dinnerStart: process.env.RESTAURANT_DINNER_START || dbConfig.horario3_inicio || '19:00',
    dinnerEnd: process.env.RESTAURANT_DINNER_END || dbConfig.horario3_fin || '23:00',
    
    // Validaciones
    minAntelacionHoras: parseInt(
      process.env.MIN_ADVANCE_HOURS || 
      dbConfig.min_antelacion_horas || 
      '2'
    ),
    maxPersonasMesa: parseInt(
      process.env.MAX_PEOPLE_PER_RESERVATION || 
      dbConfig.max_personas_mesa || 
      '20'
    ),
    minPersonas: parseInt(process.env.MIN_PEOPLE || dbConfig.min_personas || '1'),
    
    // Ventana de solapamiento (en minutos)
    ventanaSolapamiento: parseInt(process.env.OVERLAP_WINDOW || dbConfig.ventana_solapamiento || '30'), // 30 minutos antes y después
  };

  cacheTimestamp = Date.now();
  return configCache;
}

/**
 * Limpia el cache de configuración (útil para testing o actualizaciones)
 */
function clearConfigCache() {
  configCache = null;
  cacheTimestamp = null;
}

/**
 * Obtiene los horarios del restaurante (compatibilidad con función existente)
 * Intenta obtener desde BD, si no desde ENV, si no valores por defecto
 */
async function getRestaurantHours() {
  try {
    const config = await getRestaurantConfig();
    return {
      lunch: [config.lunchStart, config.lunchEnd],
      dinner: [config.dinnerStart, config.dinnerEnd]
    };
  } catch (error) {
    // Fallback a valores por defecto
    return {
      lunch: [process.env.RESTAURANT_LUNCH_START || '13:00', process.env.RESTAURANT_LUNCH_END || '15:00'],
      dinner: [process.env.RESTAURANT_DINNER_START || '19:00', process.env.RESTAURANT_DINNER_END || '23:00']
    };
  }
}

module.exports = {
  getRestaurantConfig,
  clearConfigCache,
  getRestaurantHours
};

