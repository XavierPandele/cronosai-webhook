# 🤖 Sistema de Reservas por Teléfono con Twilio

Sistema automatizado de reservas telefónicas que permite a los clientes llamar y hacer reservas de forma completamente automática, sin intervención humana.

## 📋 ¿Qué hace este sistema?

Cuando un cliente llama a tu número de Twilio:

1. 🤖 **El bot contesta automáticamente** con un saludo
2. 💬 **Mantiene una conversación natural** para recopilar datos:
   - Número de personas
   - Fecha de la reserva
   - Hora de la reserva
   - Nombre del cliente
   - Teléfono (detectado automáticamente)
3. ✅ **Confirma todos los datos** con el cliente
4. 💾 **Guarda la reserva** automáticamente en la base de datos MySQL
5. 👋 **Se despide** y termina la llamada

**Todo esto sin que ningún humano tenga que atender la llamada.**

---

## 🏗️ Arquitectura del Sistema

```
Cliente llama al número
        ↓
    Twilio recibe la llamada
        ↓
    Llama a tu webhook en Vercel
    (api/twilio-call.js)
        ↓
    Procesa la conversación
    (Extrae datos, valida, pregunta)
        ↓
    Genera respuesta TwiML
    (XML con instrucciones para Twilio)
        ↓
    Twilio ejecuta las instrucciones
    (Reproduce audio, escucha respuesta)
        ↓
    [Repite hasta completar reserva]
        ↓
    Guarda en Base de Datos MySQL
    (Tabla RESERVA y CLIENT)
        ↓
    Confirmación y fin de llamada
```

---

## 📂 Estructura de Archivos

```
cronosai-webhook/
├── api/
│   ├── webhook.js           # Webhook para Dialogflow (ya existente)
│   └── twilio-call.js       # 🆕 Endpoint para llamadas de Twilio
│
├── lib/
│   ├── database.js          # Conexión a MySQL
│   └── utils.js             # Utilidades (validación, formateo)
│
├── GUIA_TWILIO.md           # 🆕 Guía completa paso a paso
├── TWILIO_QUICKSTART.md     # 🆕 Inicio rápido (15 min)
├── test_twilio_endpoint.js  # 🆕 Script de prueba
│
├── package.json             # Actualizado con dependencia de twilio
├── vercel.json              # Actualizado con timeout para twilio-call
└── README_TWILIO.md         # 🆕 Este archivo
```

---

## 🚀 Inicio Rápido

### Opción 1: Guía Rápida (15 minutos)
Lee: **[TWILIO_QUICKSTART.md](./TWILIO_QUICKSTART.md)**

### Opción 2: Guía Completa (con detalles)
Lee: **[GUIA_TWILIO.md](./GUIA_TWILIO.md)**

---

## 🎯 Características Principales

### ✅ Funcionalidades Implementadas

- ✓ **Conversación natural** en español
- ✓ **Reconocimiento de voz** automático (Google Cloud Speech)
- ✓ **Validación de datos** en tiempo real
- ✓ **Extracción inteligente** de fechas, horas y números
- ✓ **Confirmación** antes de guardar
- ✓ **Almacenamiento automático** en MySQL
- ✓ **Historial de conversación** guardado en JSON
- ✓ **Manejo de errores** robusto
- ✓ **Voces naturales** de Amazon Polly

### 🔮 Próximas Funcionalidades (Opcionales)

- [ ] Envío de SMS de confirmación
- [ ] Recordatorios automáticos 24h antes
- [ ] Cancelación de reservas por teléfono
- [ ] Soporte multi-idioma (inglés, alemán)
- [ ] Verificación de disponibilidad en tiempo real
- [ ] Integración con Google Calendar
- [ ] Análisis de sentimiento del cliente

---

## 🛠️ Tecnologías Utilizadas

| Componente | Tecnología |
|------------|------------|
| **Telefonía** | Twilio Voice API |
| **Speech-to-Text** | Twilio Speech Recognition |
| **Text-to-Speech** | Amazon Polly (integrado en Twilio) |
| **Backend** | Node.js 20 + Vercel Serverless |
| **Base de Datos** | MySQL 8.0 |
| **Hosting** | Vercel |

---

## 📊 Flujo de Conversación

```
Bot: ¡Hola! Bienvenido a nuestro restaurante. 
     ¿Le gustaría hacer una reserva? ¿Para cuántas personas?

Cliente: Para cuatro personas

Bot: Excelente, mesa para 4 personas. 
     ¿Para qué fecha le gustaría la reserva? 
     Puede decir mañana, pasado mañana o una fecha específica.

Cliente: Para mañana

Bot: Perfecto, reserva para el [fecha]. 
     ¿A qué hora le gustaría venir? 
     Por ejemplo: a las ocho o a las siete y media.

Cliente: A las ocho de la noche

Bot: Excelente, a las 20:00. 
     ¿Cuál es su nombre para la reserva?

Cliente: Juan García

Bot: Perfecto, déjeme confirmar los datos de su reserva. 
     Mesa para 4 personas, fecha [fecha], hora 20:00, 
     a nombre de Juan García, teléfono [número detectado]. 
     ¿Está todo correcto? Diga sí para confirmar o no para modificar.

Cliente: Sí

Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. 
     Recibirá una confirmación por mensaje. 
     ¡Esperamos darle la bienvenida! Que tenga un buen día.

[Llamada termina]
```

---

## 🗄️ Estructura de Base de Datos

### Tabla RESERVA

```sql
CREATE TABLE RESERVA (
  id_reserva INT AUTO_INCREMENT PRIMARY KEY,
  data_reserva DATETIME NOT NULL,           -- Fecha y hora de la reserva
  num_persones INT NOT NULL,                -- Número de personas
  telefon VARCHAR(20) NOT NULL,             -- Teléfono del cliente
  nom_persona_reserva VARCHAR(100),         -- Nombre del cliente
  observacions TEXT,                        -- Observaciones
  conversa_completa TEXT,                   -- JSON con historial completo
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla CLIENT

```sql
CREATE TABLE CLIENT (
  TELEFON VARCHAR(20) PRIMARY KEY,
  NOM_COMPLET VARCHAR(100),
  DATA_ULTIMA_RESERVA DATETIME
);
```

---

## 🧪 Pruebas

### Prueba Automática (sin llamar)

Ejecuta el script de prueba para verificar que el endpoint funciona:

```bash
node test_twilio_endpoint.js
```

Este script simula peticiones de Twilio y verifica las respuestas.

### Prueba Manual (llamada real)

1. Configura tu número de Twilio (ver guías)
2. Llama al número desde tu teléfono
3. Sigue la conversación con el bot
4. Verifica que la reserva se guardó en la BD:

```sql
SELECT * FROM RESERVA ORDER BY id_reserva DESC LIMIT 1;
```

---

## 📈 Costos

### Twilio

- **Créditos iniciales**: $15 USD gratis
- **Número de teléfono**: ~$1-2 USD/mes
- **Llamadas entrantes**: ~$0.013/minuto (España)
- **Ejemplo**: Con $15 USD → ~1000 minutos de llamadas

### Vercel

- **Plan gratuito**: Suficiente para empezar
- **Límites**: 
  - 100 GB-hours de compute
  - 100 GB de bandwidth

### Base de Datos

- Ya está funcionando (sin costo adicional)

---

## 🔐 Seguridad

### Implementado

- ✓ Validación de datos antes de guardar en BD
- ✓ Escape de caracteres especiales en TwiML
- ✓ Transacciones en BD para consistencia
- ✓ Límites en datos de entrada (1-20 personas, fechas válidas, etc.)

### Recomendado (Opcional)

- Validar que las peticiones vienen de Twilio (firma de seguridad)
- Rate limiting para evitar abuso
- Logging detallado para auditoría

---

## 🐛 Troubleshooting

### El bot no contesta

1. Verifica que la URL en Twilio sea correcta:
   ```
   https://cronosai-webhook.vercel.app/api/twilio-call
   ```

2. Verifica que el método sea **POST**

3. Revisa logs en Vercel:
   ```bash
   vercel logs cronosai-webhook --follow
   ```

### El bot no entiende lo que digo

1. Habla **claro y despacio**
2. Evita ruido de fondo
3. Si estás en LATAM, considera cambiar el idioma a `es-MX`

### La reserva no se guarda

1. Verifica conexión a BD en logs
2. Verifica que las tablas existan
3. Verifica permisos de usuario de BD

### Ver más soluciones

Consulta la sección **Solución de Problemas** en [GUIA_TWILIO.md](./GUIA_TWILIO.md)

---

## 📝 Logs y Monitoreo

### Ver logs en Vercel

```bash
# Ver logs en tiempo real
vercel logs cronosai-webhook --follow

# Ver últimos 100 logs
vercel logs cronosai-webhook --limit 100
```

### Ver logs en Twilio

1. Ve a Twilio Console
2. **Monitor** → **Logs** → **Calls**
3. Filtra por fecha, estado, etc.

---

## 🎨 Personalización

### Cambiar la Voz

En `api/twilio-call.js`, línea del `<Say>`:

```javascript
// Voces disponibles en español:
<Say voice="Polly.Lucia" language="es-ES">   // Mujer, España (actual)
<Say voice="Polly.Conchita" language="es-ES"> // Mujer, España
<Say voice="Polly.Enrique" language="es-ES">  // Hombre, España
<Say voice="Polly.Miguel" language="es-ES">   // Hombre, LATAM
<Say voice="Polly.Penelope" language="es-ES"> // Mujer, LATAM
```

### Cambiar Mensajes

Edita las funciones en `api/twilio-call.js`:

```javascript
function processConversationStep(state, userInput) {
  // Aquí están todos los mensajes del bot
  // Puedes personalizarlos según tu restaurante
}
```

### Añadir Campos Adicionales

1. Añade nuevo paso en `processConversationStep()`
2. Crea función de extracción (ej: `extractEmail()`)
3. Actualiza consulta SQL para incluir nuevo campo

---

## 📞 Soporte y Documentación

### Documentación Oficial

- **Twilio Voice**: [https://www.twilio.com/docs/voice](https://www.twilio.com/docs/voice)
- **TwiML**: [https://www.twilio.com/docs/voice/twiml](https://www.twilio.com/docs/voice/twiml)
- **Vercel**: [https://vercel.com/docs](https://vercel.com/docs)

### Guías de Este Proyecto

- **Inicio Rápido**: [TWILIO_QUICKSTART.md](./TWILIO_QUICKSTART.md)
- **Guía Completa**: [GUIA_TWILIO.md](./GUIA_TWILIO.md)

---

## 🤝 Contribuciones

Si mejoras el sistema, considera:

1. Documentar los cambios
2. Actualizar las guías si es necesario
3. Probar en entorno de desarrollo primero

---

## 📄 Licencia

Este proyecto es parte del sistema CronosAI.

---

## ✅ Checklist de Implementación

- [ ] Leí la guía de inicio rápido
- [ ] Creé cuenta en Twilio
- [ ] Obtuve número de teléfono
- [ ] Desplegué el código en Vercel
- [ ] Configuré webhook en Twilio
- [ ] Probé con llamada real
- [ ] Verifiqué reserva en BD
- [ ] Personalicé mensajes (opcional)
- [ ] Cambié voz del bot (opcional)
- [ ] Documenté número de Twilio para el equipo

---

## 🎉 ¡Listo para Producción!

Una vez completado el checklist, tu sistema está listo para recibir llamadas reales de clientes y procesar reservas automáticamente.

**¿Preguntas?** Consulta las guías o revisa los logs.

**¿Problemas?** Ve a la sección de Troubleshooting.

**¡Éxito con tu sistema automatizado de reservas!** 🚀

