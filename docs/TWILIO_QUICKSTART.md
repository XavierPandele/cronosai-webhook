# 🚀 Inicio Rápido - Twilio para Reservas Telefónicas

## ⚡ Pasos Rápidos (15 minutos)

### 1. Crear Cuenta en Twilio
- Ve a [twilio.com/try-twilio](https://www.twilio.com/try-twilio)
- Regístrate (obtendrás $15 USD gratis)
- Verifica tu email y teléfono

### 2. Obtener Número de Teléfono
- En Twilio Console: **Phone Numbers** → **Buy a number**
- Selecciona tu país (España: +34)
- Marca la opción **Voice**
- Compra el número (gratis con créditos)

### 3. Desplegar el Código
```bash
# Ya tienes el código creado, solo haz push
git add api/twilio-call.js GUIA_TWILIO.md TWILIO_QUICKSTART.md
git commit -m "feat: añadir sistema de llamadas Twilio"
git push origin main
```

Vercel desplegará automáticamente.

### 4. Configurar Webhook en Twilio
1. Ve a tu número en Twilio Console
2. En **Voice Configuration** → **A CALL COMES IN**:
   - Webhook: `https://cronosai-webhook.vercel.app/api/twilio-call`
   - Método: **POST**
3. Guarda

### 5. ¡Probar!
**Llama a tu número de Twilio** y sigue la conversación:

```
Bot: ¿Para cuántas personas?
Tú: Para cuatro

Bot: ¿Para qué fecha?
Tú: Para mañana

Bot: ¿A qué hora?
Tú: A las ocho de la noche

Bot: ¿Su nombre?
Tú: Juan García

Bot: [Confirma datos]
Tú: Sí

Bot: ¡Reserva confirmada!
```

**¡La reserva se guarda automáticamente en tu base de datos!** ✅

---

## 🔍 Verificar que Funciona

### Check 1: Endpoint activo
```bash
curl https://cronosai-webhook.vercel.app/api/twilio-call
```
Debe devolver TwiML XML.

### Check 2: Reserva en base de datos
```sql
SELECT * FROM RESERVA ORDER BY id_reserva DESC LIMIT 1;
```
Debe mostrar tu reserva con todos los datos.

### Check 3: Logs en Twilio
- Ve a **Monitor** → **Logs** → **Calls**
- Verás tu llamada con estado "completed"

---

## 📊 Costos

Con los **$15 USD gratuitos**:
- ~1000 minutos de llamadas
- ~12 meses de número telefónico
- ¡Más que suficiente para probar!

---

## 🆘 Problemas Comunes

| Problema | Solución Rápida |
|----------|----------------|
| El bot no contesta | Verifica la URL en Twilio: debe ser `/api/twilio-call` |
| No entiende mi voz | Habla claro y despacio, evita ruido de fondo |
| Error 500 | Revisa logs en Vercel Dashboard |
| No se guarda en BD | Verifica credenciales en `lib/database.js` |

---

## 📖 Guía Completa

Para configuración detallada, troubleshooting avanzado y funcionalidades adicionales, consulta:

👉 **[GUIA_TWILIO.md](./GUIA_TWILIO.md)** - Guía completa paso a paso

---

## ✅ Checklist

- [ ] Cuenta Twilio creada
- [ ] Número telefónico obtenido
- [ ] Código desplegado en Vercel
- [ ] Webhook configurado en Twilio
- [ ] Llamada de prueba exitosa
- [ ] Reserva guardada en BD

---

## 🎯 ¿Qué hace el sistema?

1. **Cliente llama** → Número de Twilio
2. **Bot contesta** → Saluda y pregunta datos
3. **Conversación** → Recopila: personas, fecha, hora, nombre
4. **Confirma** → Repite todos los datos
5. **Guarda** → Automáticamente en tu base de datos MySQL
6. **Finaliza** → Mensaje de confirmación y cuelga

**Todo automático, sin intervención humana.** 🤖

---

## 🚀 Próximos Pasos

Una vez que funcione básicamente:

1. **Personaliza mensajes** en `api/twilio-call.js`
2. **Cambia la voz** (Polly.Lucia, Polly.Conchita, etc.)
3. **Añade SMS** de confirmación
4. **Implementa recordatorios** automáticos
5. **Agrega múltiples idiomas**

---

## 📞 Tu Número de Twilio

Después de configurar, anota tu número aquí:

```
Mi número de Twilio: +34 ___ ___ ___
Mi Account SID: AC________________
```

---

**¿Listo para empezar?** Sigue los 5 pasos rápidos arriba. ⬆️

**¿Necesitas más detalles?** Lee la [guía completa](./GUIA_TWILIO.md). 📖

