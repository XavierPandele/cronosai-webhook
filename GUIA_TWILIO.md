# 🎯 Guía Completa: Configuración de Twilio para Llamadas de Reserva

Esta guía te ayudará a configurar tu sistema de reservas para recibir llamadas telefónicas reales a través de Twilio.

## 📋 Índice

1. [Requisitos Previos](#requisitos-previos)
2. [Paso 1: Crear Cuenta en Twilio](#paso-1-crear-cuenta-en-twilio)
3. [Paso 2: Obtener un Número de Teléfono](#paso-2-obtener-un-número-de-teléfono)
4. [Paso 3: Configurar el Proyecto](#paso-3-configurar-el-proyecto)
5. [Paso 4: Desplegar en Vercel](#paso-4-desplegar-en-vercel)
6. [Paso 5: Configurar Twilio con tu URL](#paso-5-configurar-twilio-con-tu-url)
7. [Paso 6: Probar el Sistema](#paso-6-probar-el-sistema)
8. [Solución de Problemas](#solución-de-problemas)

---

## ✅ Requisitos Previos

Antes de comenzar, asegúrate de tener:

- ✓ Cuenta de Vercel (donde está desplegado tu webhook)
- ✓ Base de datos MySQL funcionando (db1.bwai.cc)
- ✓ Proyecto actual funcionando (webhook de Dialogflow)
- ✓ Tarjeta de crédito para Twilio (necesaria para verificar cuenta, aunque hay créditos gratuitos)

---

## 🚀 Paso 1: Crear Cuenta en Twilio

### 1.1 Registrarse en Twilio

1. Ve a [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Haz clic en **"Sign up"** (Registrarse)
3. Completa el formulario con tus datos:
   - Email
   - Contraseña
   - Nombre
4. Verifica tu email
5. Verifica tu número de teléfono personal (recibirás un SMS con código)

### 1.2 Completar el Cuestionario Inicial

Twilio te hará algunas preguntas:
- **What do you plan to build?** → Voice (Voz)
- **How do you want to build?** → With code (Con código)
- **What is your goal?** → Automate customer support / Reservations
- **Choose your language** → JavaScript

### 1.3 Obtener Créditos Gratuitos

Twilio te dará **$15 USD en créditos gratuitos** para empezar a probar.

---

## 📞 Paso 2: Obtener un Número de Teléfono

### 2.1 Comprar/Obtener un Número

1. Una vez dentro de tu cuenta Twilio, ve a:
   - **Phone Numbers** → **Manage** → **Buy a number**
   
2. Selecciona tu país (o el país donde quieres recibir llamadas):
   - Para España: Selecciona **Spain (+34)**
   - Para otros países: Selecciona según tu ubicación

3. Configura los filtros:
   - ✓ **Voice** (Voz) - Debe estar marcado
   - ✓ **SMS** (opcional, pero recomendado para confirmaciones)
   
4. Haz clic en **"Search"** (Buscar)

5. Selecciona un número que te guste y haz clic en **"Buy"** (Comprar)
   - Con los créditos gratuitos puedes obtener un número sin cargo inicial
   - El costo mensual se descontará de tus créditos ($1-2 USD/mes aproximadamente)

6. Confirma la compra

### 2.2 Guardar tus Credenciales

1. Ve a tu **Dashboard** de Twilio
2. En la sección **Account Info**, guarda:
   - **Account SID**: Ejemplo: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - **Auth Token**: Ejemplo: `your_auth_token_here`
   - **Your Twilio phone number**: El número que acabas de comprar

---

## 🔧 Paso 3: Configurar el Proyecto

### 3.1 Verificar que el Endpoint Está Creado

El archivo `api/twilio-call.js` ya está creado en tu proyecto. Este archivo maneja:
- Llamadas entrantes de Twilio
- Conversación interactiva para reservas
- Guardar reservas en la base de datos

### 3.2 Actualizar Dependencias (si es necesario)

Tu `package.json` ya tiene las dependencias necesarias (`mysql2` y `moment`), pero si quieres añadir funcionalidades de Twilio adicionales:

```bash
npm install twilio
```

---

## 🌐 Paso 4: Desplegar en Vercel

### 4.1 Verificar Archivos

Asegúrate de que tienes estos archivos en tu proyecto:

```
cronosai-webhook/
├── api/
│   ├── webhook.js          (ya existe)
│   └── twilio-call.js      (nuevo - ya creado)
├── lib/
│   ├── database.js         (ya existe)
│   └── utils.js            (ya existe)
├── package.json            (ya existe)
└── vercel.json             (ya existe)
```

### 4.2 Hacer Commit y Push

```bash
# En tu terminal, dentro de la carpeta del proyecto

# Ver cambios
git status

# Añadir todos los archivos nuevos
git add api/twilio-call.js
git add GUIA_TWILIO.md

# Hacer commit
git commit -m "feat: añadir endpoint de Twilio para llamadas telefónicas"

# Push a GitHub
git push origin main
```

### 4.3 Desplegar en Vercel

Vercel detectará automáticamente los cambios y desplegará el nuevo endpoint:

1. Ve a [https://vercel.com](https://vercel.com)
2. Busca tu proyecto `cronosai-webhook`
3. Verifica que el deployment se complete exitosamente
4. Tu nuevo endpoint estará disponible en:
   ```
   https://cronosai-webhook.vercel.app/api/twilio-call
   ```

### 4.4 Probar el Endpoint

Prueba que el endpoint está funcionando:

```bash
curl https://cronosai-webhook.vercel.app/api/twilio-call
```

---

## ⚙️ Paso 5: Configurar Twilio con tu URL

### 5.1 Configurar el Webhook en Twilio

1. Ve a tu **Twilio Console**: [https://console.twilio.com](https://console.twilio.com)

2. Navega a:
   - **Phone Numbers** → **Manage** → **Active numbers**

3. Haz clic en tu número de teléfono

4. En la sección **Voice Configuration** (Configuración de Voz):

   **A CALL COMES IN** (Cuando llega una llamada):
   - Selecciona: **Webhook**
   - URL: `https://cronosai-webhook.vercel.app/api/twilio-call`
   - Método HTTP: **POST**

5. Haz clic en **"Save"** (Guardar)

### 5.2 Configurar Opciones Adicionales (Opcional)

En la misma página, puedes configurar:

- **Primary Handler Fails**: URL alternativa si falla la principal
- **Call Status Changes**: URL para recibir actualizaciones del estado de la llamada

---

## 🧪 Paso 6: Probar el Sistema

### 6.1 Realizar una Llamada de Prueba

1. **Llama al número de Twilio** que obtuviste en el Paso 2

2. **Flujo esperado de la conversación**:

   ```
   Bot: ¡Hola! Bienvenido a nuestro restaurante. ¿Le gustaría hacer una reserva? ¿Para cuántas personas?
   
   Tú: Para cuatro personas
   
   Bot: Excelente, mesa para 4 personas. ¿Para qué fecha le gustaría la reserva? 
        Puede decir mañana, pasado mañana o una fecha específica.
   
   Tú: Para mañana
   
   Bot: Perfecto, reserva para el [fecha]. ¿A qué hora le gustaría venir? 
        Por ejemplo: a las ocho o a las siete y media.
   
   Tú: A las ocho de la noche
   
   Bot: Excelente, a las 20:00. ¿Cuál es su nombre para la reserva?
   
   Tú: Juan García
   
   Bot: Perfecto, déjeme confirmar los datos de su reserva. Mesa para 4 personas, 
        fecha [fecha], hora 20:00, a nombre de Juan García, teléfono [tu número]. 
        ¿Está todo correcto? Diga sí para confirmar o no para modificar.
   
   Tú: Sí
   
   Bot: ¡Perfecto! Su reserva ha sido confirmada exitosamente. 
        Recibirá una confirmación por mensaje. ¡Esperamos darle la bienvenida! 
        Que tenga un buen día.
   
   [La llamada termina]
   ```

### 6.2 Verificar en la Base de Datos

Después de completar la llamada, verifica que la reserva se guardó:

1. Accede a tu base de datos MySQL
2. Ejecuta esta consulta:

```sql
SELECT * FROM RESERVA ORDER BY id_reserva DESC LIMIT 5;
```

Deberías ver tu reserva con:
- `nom_persona_reserva`: Tu nombre
- `telefon`: Tu número de teléfono
- `num_persones`: 4
- `data_reserva`: Fecha y hora combinadas
- `observacions`: "Reserva realizada por teléfono (Twilio)"
- `conversa_completa`: JSON con el historial de la conversación

### 6.3 Verificar en Twilio Console

1. Ve a **Monitor** → **Logs** → **Calls** en Twilio Console
2. Verás tu llamada listada con:
   - Estado: Completed
   - Duración
   - Costo (descontado de tus créditos)

---

## 🎛️ Configuraciones Adicionales (Opcional)

### Cambiar la Voz del Bot

En el archivo `api/twilio-call.js`, puedes cambiar la voz:

```javascript
// Voces disponibles en español:
// - Polly.Lucia (Mujer, España)
// - Polly.Conchita (Mujer, España)
// - Polly.Enrique (Hombre, España)
// - Polly.Miguel (Hombre, LATAM)
// - Polly.Penelope (Mujer, LATAM)
// - Polly.Lupe (Mujer, LATAM)

<Say voice="Polly.Lucia" language="es-ES">Mensaje aquí</Say>
```

### Configurar Timeout de Respuesta

En el Gather, puedes ajustar:

```javascript
<Gather 
  input="speech" 
  action="/api/twilio-call" 
  method="POST"
  language="es-ES"
  speechTimeout="3"      // Segundos de silencio antes de procesar
  timeout="5"            // Tiempo máximo de espera total
>
```

### Añadir Música de Espera

Si quieres añadir música mientras procesas algo:

```javascript
<Say>Un momento por favor, estoy procesando su solicitud.</Say>
<Play>https://tu-dominio.com/musica-espera.mp3</Play>
```

---

## ❗ Solución de Problemas

### Problema 1: El bot no responde cuando llamo

**Posibles causas y soluciones:**

1. **URL mal configurada en Twilio**
   - Verifica que la URL sea exactamente: `https://cronosai-webhook.vercel.app/api/twilio-call`
   - Verifica que el método sea POST

2. **Endpoint no desplegado correctamente**
   ```bash
   # Probar el endpoint
   curl -X POST https://cronosai-webhook.vercel.app/api/twilio-call \
     -d "CallSid=test123" \
     -d "From=%2B34600000000"
   ```

3. **Error en el código**
   - Ve a **Vercel Dashboard** → **Deployments** → **Functions**
   - Revisa los logs para ver errores

### Problema 2: El bot no entiende lo que digo

**Posibles causas y soluciones:**

1. **Idioma mal configurado**
   - Verifica que `language="es-ES"` esté en el Gather
   - Si llamas desde LATAM, prueba con `es-MX` o `es-AR`

2. **Hablar más claro**
   - Habla despacio y claro
   - Evita ruido de fondo
   - Usa frases simples

3. **Ajustar el timeout**
   - Aumenta `speechTimeout="5"` si necesitas más tiempo para hablar

### Problema 3: La reserva no se guarda en la base de datos

**Posibles causas y soluciones:**

1. **Error de conexión a base de datos**
   - Verifica las credenciales en `lib/database.js`
   - Verifica que la base de datos esté accesible

2. **Revisar logs de Vercel**
   ```bash
   vercel logs cronosai-webhook --follow
   ```

3. **Probar conexión manualmente**
   - Ejecuta: `node -e "require('./lib/database').test_connection()"`

### Problema 4: Errores de créditos insuficientes

**Solución:**

1. Ve a **Twilio Console** → **Balance**
2. Añade más créditos o actualiza a plan de pago
3. Costos aproximados:
   - Llamada entrante: $0.013/min (España)
   - Número de teléfono: $1-2/mes

### Problema 5: La llamada se corta inesperadamente

**Posibles causas y soluciones:**

1. **Timeout demasiado corto**
   - En Twilio Settings, aumenta el timeout máximo de llamada

2. **Error en el flujo de conversación**
   - Revisa los logs en Twilio Console → Monitor → Logs
   - Busca errores HTTP (500, 404, etc.)

---

## 📊 Monitoreo y Análisis

### Ver Estadísticas de Llamadas

1. Ve a **Monitor** → **Logs** → **Calls**
2. Filtra por:
   - Fecha
   - Estado (completed, busy, no-answer, etc.)
   - Duración

### Ver Costos

1. Ve a **Monitor** → **Usage**
2. Revisa:
   - Llamadas por día
   - Costo por llamada
   - Créditos restantes

### Exportar Datos

Puedes exportar estadísticas desde Twilio Console para análisis:
- CSV de llamadas
- Logs detallados
- Transcripciones

---

## 🔐 Seguridad

### Validar Peticiones de Twilio

Para mayor seguridad, puedes validar que las peticiones realmente vienen de Twilio:

```javascript
const twilio = require('twilio');

// En tu handler
const twilioSignature = req.headers['x-twilio-signature'];
const url = 'https://cronosai-webhook.vercel.app/api/twilio-call';

if (!twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, twilioSignature, url, req.body)) {
  return res.status(403).send('Forbidden');
}
```

### Variables de Entorno en Vercel

Si decides añadir validación, configura en Vercel:

1. Ve a **Settings** → **Environment Variables**
2. Añade:
   - `TWILIO_ACCOUNT_SID`: Tu Account SID
   - `TWILIO_AUTH_TOKEN`: Tu Auth Token

---

## 🚀 Siguientes Pasos

### Funcionalidades Adicionales que Puedes Implementar

1. **Enviar SMS de Confirmación**
   - Después de confirmar la reserva, enviar SMS al cliente

2. **Recordatorios Automáticos**
   - SMS/llamada 24h antes de la reserva

3. **Cancelación por Teléfono**
   - Permitir cancelar reservas llamando al mismo número

4. **Múltiples Idiomas**
   - Detectar idioma automáticamente o preguntar al inicio

5. **Integración con Calendario**
   - Verificar disponibilidad en tiempo real

6. **Análisis de Sentimiento**
   - Usar IA para detectar insatisfacción del cliente

---

## 📞 Soporte

Si tienes problemas:

1. **Documentación de Twilio**: [https://www.twilio.com/docs/voice](https://www.twilio.com/docs/voice)
2. **Twilio Support**: [https://support.twilio.com](https://support.twilio.com)
3. **Revisar logs en Vercel**: `vercel logs`
4. **Revisar logs en Twilio Console**: Monitor → Logs

---

## ✅ Checklist Final

Antes de considerar el sistema completo, verifica:

- [ ] Cuenta de Twilio creada y verificada
- [ ] Número de teléfono obtenido
- [ ] Endpoint `api/twilio-call.js` desplegado en Vercel
- [ ] Webhook configurado en Twilio con tu URL
- [ ] Llamada de prueba realizada exitosamente
- [ ] Reserva guardada correctamente en la base de datos
- [ ] Conversación fluida y natural
- [ ] Bot entiende respuestas en español
- [ ] Logs revisados sin errores

---

## 🎉 ¡Felicidades!

Tu sistema de reservas por teléfono está funcionando. Los clientes ahora pueden:

1. ✅ Llamar a tu número de Twilio
2. ✅ Hablar con el bot de forma natural
3. ✅ Hacer reservas completas por teléfono
4. ✅ Recibir confirmación inmediata
5. ✅ Sus datos se guardan automáticamente en la base de datos

---

## 📝 Notas Importantes

- **Créditos gratuitos**: Los $15 USD te dan aproximadamente 1000 minutos de llamadas
- **Costos**: Después de agotar créditos, necesitarás añadir pago
- **Números de prueba**: En modo trial, solo puedes llamar desde números verificados
- **Upgrade a producción**: Para recibir llamadas de cualquier número, necesitas actualizar tu cuenta

---

**¿Necesitas ayuda adicional?** Revisa la sección de [Solución de Problemas](#solución-de-problemas) o consulta los logs de Vercel y Twilio Console.

