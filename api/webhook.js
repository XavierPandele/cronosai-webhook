const { executeQuery } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta, formatearFecha, formatearHora } = require('../lib/utils');

module.exports = async function handler(req, res) {
  // Manejar peticiones GET para testing
  if (req.method === 'GET') {
    return res.status(200).json({ 
      message: 'Webhook funcionando correctamente',
      method: req.method,
      timestamp: new Date().toISOString(),
      service: 'CronosAI Webhook Backend'
    });
  }

  // Solo permitir POST para procesar reservas
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    console.log('📞 Webhook CronosAgent recibido:', JSON.stringify(req.body, null, 2));

    // Extraer parámetros de la ubicación CORRECTA
    const sessionInfo = req.body.sessionInfo || {};
    const parameters = sessionInfo.parameters || {};
    
    console.log('📋 Parameters:', JSON.stringify(parameters, null, 2));

    // Extraer datos según la estructura real que está llegando
    const datosReserva = {
      NumeroReserva: parameters.numeroreserva,
      FechaReserva: parameters.fechareserva,
      HoraReserva: parameters.horareserva,
      NomReserva: parameters.nomreserva,
      TelefonReserva: parameters.telefonreserva,
      Observacions: parameters.observacions || null
    };

    console.log('📋 Datos extraídos:', datosReserva);

    // Validar datos
    console.log('🔍 Iniciando validación...');
    const validacion = validarReserva(datosReserva);
    console.log('🔍 Validación completada:', validacion);
    
    if (!validacion.valido) {
      console.log('❌ Validación fallida:', validacion.errores);
      return res.status(400).json({
        fulfillment_response: {
          messages: [{
            text: {
              text: `Disculpe, hay errores en los datos: ${validacion.errores.join(', ')}`
            }
          }]
        }
      });
    }

    console.log('✅ Validación exitosa');

    // Generar conversación completa
    console.log('🔍 Generando conversación completa...');
    const conversacionCompleta = generarConversacionCompleta(datosReserva, req.body);
    console.log('✅ Conversación generada');
    
    // Combinar fecha y hora para la tabla RESERVA
    console.log('🔍 Combinando fecha y hora...');
    const dataCombinada = combinarFechaHora(datosReserva.FechaReserva, datosReserva.HoraReserva);
    console.log('📅 Fecha y hora combinadas:', dataCombinada);

    // Comenzar transacción
    console.log('🔍 Conectando a la base de datos...');
    const connection = await require('../lib/database').createConnection();
    console.log('✅ Conexión establecida');
    
    try {
      console.log('🔍 Iniciando transacción...');
      await connection.beginTransaction();
      console.log('✅ Transacción iniciada');

      // 1. Insertar o actualizar cliente en tabla CLIENT
      console.log('🔍 Insertando/actualizando cliente...');
      const clienteQuery = `
        INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          NOM_COMPLET = VALUES(NOM_COMPLET), 
          DATA_ULTIMA_RESERVA = NOW()
      `;
      
      await connection.execute(clienteQuery, [
        datosReserva.NomReserva,
        datosReserva.TelefonReserva
      ]);

      console.log('✅ Cliente insertado/actualizado en tabla CLIENT');

      // 2. Insertar reserva en tabla RESERVA con nombres CORRECTOS de columnas
      console.log('🔍 Insertando reserva...');
      const reservaQuery = `
        INSERT INTO RESERVA 
        (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const [result] = await connection.execute(reservaQuery, [
        dataCombinada,
        datosReserva.NumeroReserva,
        datosReserva.TelefonReserva,
        datosReserva.NomReserva,
        datosReserva.Observacions,
        conversacionCompleta
      ]);

      const idReserva = result.insertId;
      console.log('✅ Reserva insertada con ID:', idReserva);

      // Confirmar transacción
      console.log('🔍 Confirmando transacción...');
      await connection.commit();
      console.log('✅ Transacción confirmada');
      
      // Preparar respuesta de confirmación con valores formateados
      const nombreFormateado = typeof datosReserva.NomReserva === 'object' ? datosReserva.NomReserva.name : datosReserva.NomReserva;
      const fechaFormateada = formatearFecha(datosReserva.FechaReserva);
      const horaFormateada = formatearHora(datosReserva.HoraReserva);
      
      const respuesta = {
        fulfillment_response: {
          messages: [{
            text: {
              text: `¡Excelente! Su reserva ha sido confirmada exitosamente.\n\n` +
                    `📋 Detalles de la reserva:\n` +
                    `• ID de reserva: ${idReserva}\n` +
                    `• Nombre: ${nombreFormateado}\n` +
                    `• Fecha: ${fechaFormateada}\n` +
                    `• Hora: ${horaFormateada}\n` +
                    `• Personas: ${datosReserva.NumeroReserva}\n` +
                    `• Teléfono: ${datosReserva.TelefonReserva}\n\n` +
                    `¡Esperamos darle la bienvenida! ¿Hay algo más en lo que pueda ayudarle?`
            }
          }]
        },
        session_info: {
          parameters: {
            id_reserva: idReserva,
            reserva_confirmada: true,
            fecha_reserva: fechaFormateada,
            hora_reserva: horaFormateada
          }
        }
      };

      console.log('✅ Respuesta enviada:', JSON.stringify(respuesta, null, 2));
      res.status(200).json(respuesta);

    } catch (error) {
      // Revertir transacción en caso de error
      console.error('❌ Error en transacción:', error);
      await connection.rollback();
      throw error;
    } finally {
      console.log('🔍 Cerrando conexión...');
      await connection.end();
      console.log('✅ Conexión cerrada');
    }

  } catch (error) {
    console.error('❌ Error en webhook:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({
      fulfillment_response: {
        messages: [{
          text: {
            text: "Disculpe, hubo un error procesando su reserva. Por favor, intente de nuevo o contacte directamente al restaurante."
          }
        }]
      }
    });
  }
}