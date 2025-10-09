const { executeQuery, getConnection } = require('../config/database');
const moment = require('moment');

class Reserva {
  // Crear nueva reserva
  static async crear(datosReserva) {
    const {
      nom_persona_reserva,
      telefon,
      data_reserva,
      num_persones,
      observacions = null,
      conversa_completa = 'Reserva via página web'
    } = datosReserva;

    try {
      // Iniciar transacción
      const connection = await getConnection();
      await connection.beginTransaction();

      try {
        // Insertar reserva con los campos correctos
        const [result] = await connection.execute(
          `INSERT INTO RESERVA 
           (nom_persona_reserva, telefon, data_reserva, num_persones, observacions, conversa_completa) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [nom_persona_reserva, telefon, data_reserva, num_persones, observacions, conversa_completa]
        );

        // Confirmar transacción
        await connection.commit();
        connection.release();

        return {
          success: true,
          id: result.insertId,
          id_reserva: result.insertId, // Usar el ID auto-incrementado
          message: 'Reserva creada exitosamente'
        };
      } catch (error) {
        // Rollback en caso de error
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      console.error('Error creando reserva:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Consultar disponibilidad - SIMPLIFICADO
  static async consultarDisponibilidad(data_reserva, num_persones = 1) {
    try {
      // Generar horarios disponibles (18:00 a 22:30 cada 30 minutos)
      const horarios_disponibles = [];
      for (let hora = 18; hora <= 22; hora++) {
        for (let minuto = 0; minuto < 60; minuto += 30) {
          if (hora === 22 && minuto > 30) break; // No más allá de 22:30
          const horaStr = `${hora.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`;
          horarios_disponibles.push(horaStr);
        }
      }

      return {
        success: true,
        disponible: true,
        horarios_disponibles: horarios_disponibles,
        data_reserva: data_reserva,
        num_persones: num_persones
      };
    } catch (error) {
      console.error('Error consultando disponibilidad:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Cancelar reserva
  static async cancelar(id_reserva, telefon) {
    try {
      const connection = await getConnection();
      await connection.beginTransaction();

      try {
        // Obtener datos de la reserva antes de cancelar
        const [reservaData] = await connection.execute(
          `SELECT data_reserva, num_persones 
           FROM RESERVA 
           WHERE id_reserva = ? AND telefon = ?`,
          [id_reserva, telefon]
        );

        if (reservaData.length === 0) {
          await connection.rollback();
          connection.release();
          return {
            success: false,
            error: 'Reserva no encontrada o datos incorrectos'
          };
        }

        const reserva = reservaData[0];

        // Eliminar la reserva
        const [result] = await connection.execute(
          `DELETE FROM RESERVA 
           WHERE id_reserva = ? AND telefon = ?`,
          [id_reserva, telefon]
        );

        await connection.commit();
        connection.release();

        return {
          success: true,
          message: 'Reserva cancelada exitosamente'
        };
      } catch (error) {
        await connection.rollback();
        connection.release();
        throw error;
      }
    } catch (error) {
      console.error('Error cancelando reserva:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Buscar reserva por teléfono
  static async buscarPorTelefono(telefon) {
    try {
      const result = await executeQuery(
        `SELECT id_reserva, nom_persona_reserva, data_reserva, num_persones 
         FROM RESERVA 
         WHERE telefon = ? 
         ORDER BY data_reserva DESC`,
        [telefon]
      );

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        reservas: result.data
      };
    } catch (error) {
      console.error('Error buscando reservas:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Obtener reserva por número
  static async obtenerPorNumero(id_reserva) {
    try {
      const result = await executeQuery(
        `SELECT * FROM RESERVA WHERE id_reserva = ?`,
        [id_reserva]
      );

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        reserva: result.data[0] || null
      };
    } catch (error) {
      console.error('Error obteniendo reserva:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Obtener estadísticas de reservas
  static async obtenerEstadisticas(fecha_inicio, fecha_fin) {
    try {
      const result = await executeQuery(
        `SELECT 
           COUNT(*) as total_reservas,
           SUM(num_persones) as total_personas,
           AVG(num_persones) as promedio_personas
         FROM RESERVA 
         WHERE DATE(data_reserva) BETWEEN ? AND ?`,
        [fecha_inicio, fecha_fin]
      );

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        estadisticas: result.data[0]
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Validar disponibilidad antes de crear reserva - SIMPLIFICADO
  static async validarDisponibilidad(data_reserva, num_persones) {
    try {
      // Siempre permitir la reserva por ahora
      return {
        success: true,
        disponible: true,
        reservas_existentes: 0,
        capacidad_maxima: 20
      };
    } catch (error) {
      console.error('Error validando disponibilidad:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = Reserva;
