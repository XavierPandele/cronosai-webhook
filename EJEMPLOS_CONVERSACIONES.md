# 💬 Ejemplos de Conversaciones - Sistema Twilio

Este documento muestra ejemplos reales de cómo será la conversación entre el bot y los clientes.

---

## 📞 Ejemplo 1: Reserva Exitosa Estándar

```
🔵 CLIENTE LLAMA AL NÚMERO DE TWILIO

🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Para cuatro personas

🤖 Bot: Excelente, mesa para 4 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Para mañana

🤖 Bot: Perfecto, reserva para el 9 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las ocho de la noche

🤖 Bot: Excelente, a las 20:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: Juan García

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 4 
        personas, fecha 9 de octubre, hora 20:00, a nombre de Juan García, 
        teléfono +34600123456. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Sí

🤖 Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá 
        una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.

🔴 LLAMADA TERMINA

✅ RESERVA GUARDADA EN BASE DE DATOS:
   - ID: 1234
   - Personas: 4
   - Fecha: 2025-10-09 20:00:00
   - Nombre: Juan García
   - Teléfono: +34600123456
```

**Duración**: ~90 segundos  
**Costo**: ~$0.02 USD

---

## 📞 Ejemplo 2: Cliente con Correcciones

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Ehh... bueno, queremos venir a cenar

🤖 Bot: ¿Le gustaría hacer una reserva? Diga sí para continuar.

👤 Cliente: Sí

🤖 Bot: ¡Perfecto! Me alegra ayudarle con su reserva. ¿Para cuántas 
        personas sería la mesa?

👤 Cliente: Somos dos

🤖 Bot: Excelente, mesa para 2 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: El sábado

🤖 Bot: Disculpe, no entendí la fecha. ¿Podría especificar la fecha? 
        Por ejemplo: mañana, pasado mañana o quince de enero.

👤 Cliente: Pasado mañana

🤖 Bot: Perfecto, reserva para el 10 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las nueve

🤖 Bot: Excelente, a las 09:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: María López

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 2 
        personas, fecha 10 de octubre, hora 09:00, a nombre de María López, 
        teléfono +34600987654. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: No, la hora está mal

🤖 Bot: Está bien, empecemos de nuevo. ¿Para cuántas personas sería la 
        reserva?

👤 Cliente: Dos personas

🤖 Bot: Excelente, mesa para 2 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Pasado mañana

🤖 Bot: Perfecto, reserva para el 10 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las nueve de la noche

🤖 Bot: Excelente, a las 21:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: María López

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 2 
        personas, fecha 10 de octubre, hora 21:00, a nombre de María López, 
        teléfono +34600987654. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Sí, perfecto

🤖 Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá 
        una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.

🔴 LLAMADA TERMINA
```

**Duración**: ~150 segundos  
**Costo**: ~$0.03 USD

---

## 📞 Ejemplo 3: Números en Palabras

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Quiero reservar para cinco personas

🤖 Bot: Excelente, mesa para 5 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Mañana por favor

🤖 Bot: Perfecto, reserva para el 9 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las siete y media de la tarde

🤖 Bot: Excelente, a las 19:30. ¿Cuál es su nombre para la reserva?

👤 Cliente: Pedro Martínez

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 5 
        personas, fecha 9 de octubre, hora 19:30, a nombre de Pedro Martínez, 
        teléfono +34600111222. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Sí

🤖 Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá 
        una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.

🔴 LLAMADA TERMINA
```

**Duración**: ~85 segundos  
**Costo**: ~$0.02 USD

---

## 📞 Ejemplo 4: Fecha Específica

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Para tres

🤖 Bot: Excelente, mesa para 3 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Para el quince de octubre

🤖 Bot: Perfecto, reserva para el 15 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las ocho

🤖 Bot: Excelente, a las 20:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: Ana Rodríguez

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 3 
        personas, fecha 15 de octubre, hora 20:00, a nombre de Ana Rodríguez, 
        teléfono +34600333444. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Correcto

🤖 Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá 
        una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.

🔴 LLAMADA TERMINA
```

**Duración**: ~80 segundos  
**Costo**: ~$0.02 USD

---

## 📞 Ejemplo 5: Cliente Rápido (Respuestas Cortas)

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Cuatro

🤖 Bot: Excelente, mesa para 4 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Mañana

🤖 Bot: Perfecto, reserva para el 9 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: Ocho

🤖 Bot: Excelente, a las 20:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: Carlos

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 4 
        personas, fecha 9 de octubre, hora 20:00, a nombre de Carlos, 
        teléfono +34600555666. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Sí

🤖 Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. Recibirá 
        una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.

🔴 LLAMADA TERMINA
```

**Duración**: ~70 segundos  
**Costo**: ~$0.015 USD

---

## ❌ Ejemplo 6: Error de Conexión a Base de Datos

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
        reserva? ¿Para cuántas personas?

👤 Cliente: Para seis

🤖 Bot: Excelente, mesa para 6 personas. ¿Para qué fecha le gustaría la 
        reserva? Puede decir mañana, pasado mañana o una fecha específica.

👤 Cliente: Hoy

🤖 Bot: Perfecto, reserva para el 8 de octubre. ¿A qué hora le gustaría 
        venir? Por ejemplo: a las ocho o a las siete y media.

👤 Cliente: A las diez de la noche

🤖 Bot: Excelente, a las 22:00. ¿Cuál es su nombre para la reserva?

👤 Cliente: Laura Fernández

🤖 Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 6 
        personas, fecha 8 de octubre, hora 22:00, a nombre de Laura Fernández, 
        teléfono +34600777888. ¿Está todo correcto? Diga sí para confirmar 
        o no para modificar.

👤 Cliente: Sí

🤖 Bot: Disculpe, hubo un error técnico. Por favor, intente de nuevo más 
        tarde o contacte directamente al restaurante.

🔴 LLAMADA TERMINA

❌ ERROR EN LOGS:
   Error conectando a base de datos: ECONNREFUSED
```

**Nota**: En este caso, el sistema maneja el error gracefully y no deja al cliente sin respuesta.

---

## 📊 Casos de Uso Avanzados

### Caso 1: Cliente Interrumpe

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante...

👤 Cliente: [cuelga]

📝 En logs: CallStatus = "completed", duración = 2s
💰 Costo: ~$0.001 USD
```

### Caso 2: Cliente No Responde

```
🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Para cuántas personas?

👤 Cliente: [silencio]

🤖 Bot: No escuché respuesta. ¿Sigue ahí?

👤 Cliente: [silencio]

🤖 Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Para cuántas personas?

[Después de 3 intentos sin respuesta, la llamada se termina automáticamente]
```

### Caso 3: Ruido de Fondo

```
🤖 Bot: ¿Para cuántas personas?

👤 Cliente: [ruido de fondo, ininteligible]

🤖 Bot: Disculpe, no entendí cuántas personas. Por favor, dígame el 
        número de personas.

👤 Cliente: [más claro] Cuatro personas

🤖 Bot: Excelente, mesa para 4 personas...
```

---

## 🔍 Anatomía de una Petición Twilio

### Petición Inicial (Saludo)

```http
POST /api/twilio-call HTTP/1.1
Host: cronosai-webhook.vercel.app
Content-Type: application/x-www-form-urlencoded

CallSid=CA1234567890abcdef
From=%2B34600123456
To=%2B34900888777
CallStatus=in-progress
SpeechResult=
```

### Respuesta del Webhook

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather 
    input="speech" 
    action="/api/twilio-call" 
    method="POST"
    language="es-ES"
    speechTimeout="3"
    timeout="5">
    <Say voice="Polly.Lucia" language="es-ES">
      ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una 
      reserva? ¿Para cuántas personas?
    </Say>
  </Gather>
  <Say voice="Polly.Lucia" language="es-ES">
    No escuché respuesta. ¿Sigue ahí?
  </Say>
  <Redirect>/api/twilio-call</Redirect>
</Response>
```

### Petición con Respuesta del Usuario

```http
POST /api/twilio-call HTTP/1.1
Host: cronosai-webhook.vercel.app
Content-Type: application/x-www-form-urlencoded

CallSid=CA1234567890abcdef
From=%2B34600123456
To=%2B34900888777
CallStatus=in-progress
SpeechResult=para+cuatro+personas
```

---

## 📈 Estadísticas de Conversaciones Típicas

| Métrica | Valor Promedio |
|---------|----------------|
| Duración total | 90-120 segundos |
| Número de preguntas | 5 preguntas |
| Tasa de éxito | ~85% |
| Tasa de abandono | ~10% |
| Tasa de error | ~5% |
| Costo por llamada | $0.02-0.03 USD |

---

## 💡 Consejos para Clientes

### ✅ Buenas Prácticas

- Habla **claro y despacio**
- Evita **ruido de fondo** (TV, música, conversaciones)
- Usa **frases simples**: "cuatro personas", "mañana", "ocho de la noche"
- **Confirma** bien los datos al final
- Ten **papel y lápiz** para anotar el número de confirmación (si se implementa)

### ❌ Evitar

- Hablar muy rápido
- Dar información adicional no solicitada
- Interrumpir al bot mientras habla
- Usar jerga o abreviaturas
- Dar respuestas ambiguas ("el fin de semana", "por la tarde")

---

## 🎯 Frases Clave que el Bot Reconoce

### Números de Personas

- "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"
- "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"
- "para X personas"
- "somos X"
- "mesa para X"

### Fechas

- "hoy"
- "mañana"
- "pasado mañana"
- "15 de octubre"
- "15/10"
- "15-10"

### Horas

- "una", "dos", ... "doce" (y derivados)
- "1", "2", ... "23"
- "ocho de la noche" → 20:00
- "dos de la tarde" → 14:00
- "ocho y media" → 20:30
- "ocho y cuarto" → 20:15

### Confirmación

- "sí", "si"
- "confirmo"
- "correcto"
- "está bien"
- "de acuerdo"

### Rechazo

- "no"
- "cambiar"
- "modificar"
- "mal"
- "incorrecto"

---

## 🔄 Flujo de Estado

```
greeting (inicial)
    ↓
ask_people (pregunta personas)
    ↓
ask_date (pregunta fecha)
    ↓
ask_time (pregunta hora)
    ↓
ask_name (pregunta nombre)
    ↓
confirm (confirma todo)
    ↓
complete (guarda y termina)
```

Si en `confirm` el cliente dice "no":
```
confirm
    ↓
vuelve a ask_people (reinicia el flujo)
```

---

## 📝 Registro en Base de Datos

### Tabla RESERVA

```sql
INSERT INTO RESERVA (
  data_reserva,           -- 2025-10-09 20:00:00
  num_persones,           -- 4
  telefon,                -- +34600123456
  nom_persona_reserva,    -- Juan García
  observacions,           -- "Reserva realizada por teléfono (Twilio)"
  conversa_completa       -- JSON con historial
) VALUES (?, ?, ?, ?, ?, ?);
```

### Ejemplo de `conversa_completa`

```json
{
  "phone": "+34600123456",
  "history": [
    {
      "role": "user",
      "message": "para cuatro personas",
      "timestamp": "2025-10-08T10:15:23Z"
    },
    {
      "role": "bot",
      "message": "Excelente, mesa para 4 personas. ¿Para qué fecha...?",
      "timestamp": "2025-10-08T10:15:24Z"
    },
    {
      "role": "user",
      "message": "para mañana",
      "timestamp": "2025-10-08T10:15:30Z"
    },
    ...
  ],
  "timestamp": "2025-10-08T10:15:23Z"
}
```

---

## 🎤 Personalización de Voces

### Voces Disponibles

```javascript
// Voces femeninas
voice="Polly.Lucia"      // España (actual)
voice="Polly.Conchita"   // España (alternativa)
voice="Polly.Penelope"   // LATAM (México)
voice="Polly.Lupe"       // LATAM (Estados Unidos)

// Voces masculinas
voice="Polly.Enrique"    // España
voice="Polly.Miguel"     // LATAM (Estados Unidos)
```

### Comparación de Voces

| Voz | Género | Región | Tono | Velocidad |
|-----|--------|--------|------|-----------|
| Lucia | F | España | Cálido | Media |
| Conchita | F | España | Profesional | Rápida |
| Enrique | M | España | Serio | Media |
| Miguel | M | LATAM | Amigable | Media |
| Penelope | F | LATAM | Dulce | Lenta |

---

## 🎬 Escenario Completo Paso a Paso

### Fase 1: Inicio de Llamada

```
1. Cliente marca: +34 900 XXX XXX
2. Twilio recibe la llamada
3. Twilio busca configuración del número
4. Encuentra webhook: https://cronosai-webhook.vercel.app/api/twilio-call
5. Twilio hace POST al webhook (sin SpeechResult)
6. Webhook responde con TwiML de saludo
7. Twilio ejecuta TwiML: reproduce mensaje y escucha
```

### Fase 2: Primera Interacción

```
8. Cliente dice: "para cuatro personas"
9. Twilio transcribe: "para cuatro personas"
10. Twilio hace POST al webhook con SpeechResult="para cuatro personas"
11. Webhook procesa: extrae número 4
12. Webhook guarda en estado: {NumeroReserva: 4, step: 'ask_date'}
13. Webhook responde TwiML con pregunta de fecha
14. Twilio reproduce y escucha
```

### Fase 3: Continuación

```
15-21. [Repite proceso para fecha]
22-28. [Repite proceso para hora]
29-35. [Repite proceso para nombre]
36-42. [Repite proceso para confirmación]
```

### Fase 4: Finalización

```
43. Cliente confirma: "sí"
44. Webhook detecta confirmación
45. Webhook cambia estado a 'complete'
46. Webhook conecta a MySQL
47. Webhook inserta en tabla CLIENT
48. Webhook inserta en tabla RESERVA
49. Webhook commit de transacción
50. Webhook responde TwiML final (sin Gather)
51. Twilio reproduce mensaje de despedida
52. Twilio ejecuta <Hangup/>
53. Llamada termina
54. Twilio envía callback de estado final (opcional)
```

---

## 📊 Análisis de Datos Guardados

### Consulta: Últimas 5 Reservas por Twilio

```sql
SELECT 
  id_reserva,
  nom_persona_reserva,
  telefon,
  DATE_FORMAT(data_reserva, '%d/%m/%Y %H:%i') as fecha_hora,
  num_persones,
  created_at
FROM RESERVA
WHERE observacions LIKE '%Twilio%'
ORDER BY created_at DESC
LIMIT 5;
```

### Resultado Ejemplo

```
+-------------+-------------------+---------------+------------------+-------------+---------------------+
| id_reserva  | nom_persona_reser | telefon       | fecha_hora       | num_persones| created_at          |
+-------------+-------------------+---------------+------------------+-------------+---------------------+
| 1234        | Juan García       | +34600123456  | 09/10/2025 20:00 | 4           | 2025-10-08 10:15:45 |
| 1233        | María López       | +34600987654  | 10/10/2025 21:00 | 2           | 2025-10-08 09:23:12 |
| 1232        | Pedro Martínez    | +34600111222  | 09/10/2025 19:30 | 5           | 2025-10-08 08:45:33 |
| 1231        | Ana Rodríguez     | +34600333444  | 15/10/2025 20:00 | 3           | 2025-10-07 22:18:56 |
| 1230        | Carlos            | +34600555666  | 09/10/2025 20:00 | 4           | 2025-10-07 20:05:21 |
+-------------+-------------------+---------------+------------------+-------------+---------------------+
```

---

## ✅ Checklist de Prueba Completa

Antes de considerar el sistema en producción, verifica cada uno:

- [ ] Llamada se conecta (bot saluda)
- [ ] Bot reconoce números en palabras ("cuatro" → 4)
- [ ] Bot reconoce números en dígitos ("4" → 4)
- [ ] Bot reconoce "mañana" correctamente
- [ ] Bot reconoce "pasado mañana" correctamente
- [ ] Bot reconoce horas en palabras ("ocho de la noche" → 20:00)
- [ ] Bot reconoce horas con minutos ("ocho y media" → 20:30)
- [ ] Bot reconoce nombres y los capitaliza
- [ ] Bot detecta teléfono automáticamente del caller ID
- [ ] Bot confirma todos los datos antes de guardar
- [ ] Bot acepta "sí" para confirmación
- [ ] Bot reinicia si cliente dice "no"
- [ ] Bot guarda en tabla RESERVA correctamente
- [ ] Bot guarda en tabla CLIENT correctamente
- [ ] Bot guarda conversación completa en JSON
- [ ] Bot se despide y cuelga correctamente
- [ ] Llamada aparece en Twilio Console
- [ ] No hay errores en logs de Vercel
- [ ] Costo de llamada es razonable

---

**Documento creado**: 2025-10-08  
**Última actualización**: 2025-10-08  
**Versión**: 1.0.0

---

¿Tienes dudas sobre cómo funcionará una conversación específica? Consulta estos ejemplos o prueba el sistema tú mismo llamando al número de Twilio. 📞

