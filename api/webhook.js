const { executeQuery } = require('../lib/database');
const { combinarFechaHora, validarReserva, generarConversacionCompleta } = require('../lib/utils');

export default async function handler(req, res) {
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

    // Extraer parámetros según la estructura estándar de Dialogflow CX
    const sessionInfo = req.body.sessionInfo || {};
    const sessionParams = sessionInfo.session?.params || {};
    
    // También buscar en otras ubicaciones comunes
    const queryResult = req.body.queryResult || {};
    const queryParams = queryResult.parameters || {};
    
    // Combinar parámetros de todas las fuentes posibles
    const allParams = {
      ...sessionParams,
      ...queryParams,
      ...(req.body.parameters || {})
    };
    
    console.log('📋 Session Params:', JSON.stringify(sessionParams, null, 2));
    console.log('📋 Query Params:', JSON.stringify(queryParams, null, 2));
    console.log('📋 All Params:', JSON.stringify(allParams, null, 2));

    // Extraer datos del chat del usuario según tu configuración
    const datosReserva = {
      NumeroReserva: allParams.NumeroReserva || allParams.numeroReserva || allParams.NumeroReserva,
      FechaReserva: allParams.FechaReserva || allParams.fechaReserva || allParams.FechaReserva,
      HoraReserva: allParams.HoraReserva || allParams.horaReserva || allParams.HoraReserva,
      NomReserva: allParams.NomReserva || allParams.nomReserva || allParams.NomReserva,
      TelefonReserva: allParams.TelefonReserva || allParams.telefonReserva || allParams.TelefonReserva,
      Observacions: allParams.Observacions || allParams.observacions || allParams.Observacions || null
    };

    // Capturar el texto completo del chat
    const chatCompleto = req.body.queryResult?.queryText || req.body.text || '';
    const mensajeUsuario = req.body.queryResult?.queryText || req.body.text || '';
    
    console.log('💬 Chat completo:', chatCompleto);
    console.log('💬 Mensaje del usuario:', mensajeUsuario);
    console.log('📋 Datos extraídos:', datosReserva);

    // Validar datos
    const validacion = validarReserva(datosReserva);
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

    // Generar conversación completa para guardar en la base de datos
    const conversacionCompleta = generarConversacionCompleta(datosReserva, req.body, chatCompleto);
    
    // Combinar fecha y hora para la tabla RESERVA
    const dataCombinada = combinarFechaHora(datosReserva.FechaReserva, datosReserva.HoraReserva);

    console.log('📅 Fecha y hora combinadas:', dataCombinada);

    // Comenzar transacción de base de datos
    const connection = await require('../lib/database').createConnection();
    
    try {
      await connection.beginTransaction();

      // 1. Insertar o actualizar cliente en tabla CLIENT
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

      // 2. Insertar reserva en tabla RESERVA
      const reservaQuery = `
        INSERT INTO RESERVA 
        (DATA, NUMERO_PERSONAS, TELEFON, NOM_PERSONA_RESERVA, OBSERVACIONS, TOTA_LA_CONVERSA) 
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

      // Confirmar transacción
      await connection.commit();
      
      console.log('✅ Reserva insertada en tabla RESERVA con ID:', idReserva);

      // Preparar respuesta de confirmación
      const respuesta = {
        fulfillment_response: {
          messages: [{
            text: {
              text: `¡Excelente! Su reserva ha sido confirmada exitosamente.\n\n` +
                    `📋 Detalles de la reserva:\n` +
                    `• ID de reserva: ${idReserva}\n` +
                    `• Nombre: ${datosReserva.NomReserva}\n` +
                    `• Fecha: ${datosReserva.FechaReserva}\n` +
                    `• Hora: ${datosReserva.HoraReserva}\n` +
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
            fecha_reserva: datosReserva.FechaReserva,
            hora_reserva: datosReserva.HoraReserva
          }
        }
      };

      console.log('✅ Respuesta enviada:', JSON.stringify(respuesta, null, 2));
      res.status(200).json(respuesta);

    } catch (error) {
      // Revertir transacción en caso de error
      await connection.rollback();
      console.error('❌ Error en transacción:', error);
      throw error;
    } finally {
      await connection.end();
    }

  } catch (error) {
    console.error('❌ Error en webhook:', error);
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