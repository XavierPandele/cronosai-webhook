# 🔧 Solución de Problemas

Guía completa para resolver los problemas más comunes.

---

## 📋 Índice

1. [Problemas de Conexión](#problemas-de-conexión)
2. [Errores de API](#errores-de-api)
3. [Problemas en AppSheet](#problemas-en-appsheet)
4. [Problemas de Despliegue](#problemas-de-despliegue)
5. [Errores de Base de Datos](#errores-de-base-de-datos)

---

## 🌐 Problemas de Conexión

### ❌ "API Key inválida o faltante"

**Síntomas:**
- Respuesta 401 Unauthorized
- Mensaje: "API Key inválida o faltante"

**Causas:**
1. Header `X-Api-Key` no está presente
2. El valor del API Key es incorrecto
3. El API Key en Vercel no coincide con el cliente

**Soluciones:**

#### Verificar en cURL:
```bash
# Incorrecto ❌
curl https://tu-proyecto.vercel.app/api/reservations

# Correcto ✅
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations
```

#### Verificar en AppSheet:
1. Ve a **Data → Tables → [Tu tabla]**
2. Click en **Settings**
3. Ve a **Headers**
4. Verifica que existe:
   - **Name:** `X-Api-Key`
   - **Value:** `appsheet-cronos-2024`

#### Verificar en Vercel:
1. Ve a tu proyecto en Vercel
2. **Settings → Environment Variables**
3. Busca `API_KEY`
4. Debe ser: `appsheet-cronos-2024`
5. Si la cambias, haz **Redeploy**

---

### ❌ "Cannot reach API endpoint"

**Síntomas:**
- Timeout en las peticiones
- "ERR_CONNECTION_REFUSED"
- No se cargan datos en AppSheet

**Causas:**
1. URL incorrecta
2. API no desplegada
3. Problema de red/firewall

**Soluciones:**

#### 1. Verificar que la API está activa:
```bash
curl https://tu-proyecto.vercel.app/api/reservations
```

Respuesta esperada:
```json
{
  "success": false,
  "error": "API Key inválida o faltante"
}
```

Si no recibes respuesta:
- La API no está desplegada
- La URL es incorrecta

#### 2. Verificar URL en AppSheet:
1. **Data → Tables → Settings**
2. **Base URL** debe ser: `https://tu-proyecto.vercel.app`
3. **Sin** `/api/reservations` al final (eso va en el endpoint)

#### 3. Verificar despliegue en Vercel:
```bash
vercel ls
```

Deberías ver tu proyecto listado y activo.

#### 4. Ver logs de Vercel:
```bash
vercel logs
```

---

### ❌ "CORS Error"

**Síntomas:**
- Error en consola del navegador
- "Access-Control-Allow-Origin" error
- Funciona en Postman pero no en web

**Causas:**
- Headers CORS mal configurados

**Solución:**

Verifica que en cada archivo de API (`api/*.js`) tienes:

```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Key');

if (req.method === 'OPTIONS') {
  return res.status(200).end();
}
```

---

## 🔴 Errores de API

### ❌ "Campos obligatorios faltantes"

**Síntomas:**
- Error 400 al crear reserva
- Mensaje: "Campos obligatorios faltantes"

**Causa:**
- Faltan campos requeridos en el POST

**Solución:**

Verifica que envías todos los campos obligatorios:

```javascript
{
  "nom_persona_reserva": "Juan Pérez",     // ✅ Requerido
  "telefon": "+34 612 345 678",            // ✅ Requerido
  "data_reserva": "2024-10-25 20:00:00",   // ✅ Requerido
  "num_persones": 4,                        // ✅ Requerido
  "observacions": "...",                    // ❌ Opcional
  "status": "pending"                       // ❌ Opcional (default: pending)
}
```

---

### ❌ "Formato de fecha inválido"

**Síntomas:**
- Error 400 al crear/actualizar reserva
- "Formato de fecha inválido"

**Causa:**
- Fecha no está en formato correcto

**Solución:**

Formato correcto: `YYYY-MM-DD HH:MM:SS`

```javascript
// ❌ Incorrecto
"data_reserva": "25/10/2024 20:00"
"data_reserva": "2024-10-25T20:00:00.000Z"
"data_reserva": "Oct 25 2024 8:00 PM"

// ✅ Correcto
"data_reserva": "2024-10-25 20:00:00"
```

En JavaScript:
```javascript
const fecha = new Date('2024-10-25T20:00:00');
const formatoAPI = fecha.toISOString()
  .slice(0, 19)
  .replace('T', ' ');
// Resultado: "2024-10-25 20:00:00"
```

---

### ❌ "Reserva no encontrada"

**Síntomas:**
- Error 404 al actualizar/eliminar
- "Reserva no encontrada"

**Causas:**
1. ID incorrecto
2. Reserva ya fue eliminada
3. Error en la query string

**Solución:**

Verifica el ID:
```bash
# ✅ Correcto
curl -X PUT \
  -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"

# ❌ Incorrecto (falta el ?)
curl -X PUT \
  -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations/id=15"
```

Lista todas las reservas para verificar IDs:
```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations
```

---

## 📱 Problemas en AppSheet

### ❌ "No se cargan los datos"

**Síntomas:**
- AppSheet muestra "No data"
- Tabla vacía
- Loading infinito

**Diagnóstico:**

#### 1. Verificar conexión en AppSheet:
1. **Data → Tables → [Tu tabla]**
2. Click en **Refresh**
3. Si falla, revisa el error

#### 2. Verificar la API directamente:
```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations
```

#### 3. Verificar respuesta de la API:

AppSheet espera un array en `data`:
```json
{
  "success": true,
  "count": 5,
  "data": [...]  // ✅ Array aquí
}
```

#### 4. Verificar mapping en AppSheet:

1. **Data → Tables → [Tu tabla] → Settings**
2. **Response Path:** `data`
3. Verifica que los nombres de columna coincidan

---

### ❌ "Error al crear reserva desde AppSheet"

**Síntomas:**
- Click en "+" no funciona
- Error al guardar
- Datos no se envían

**Diagnóstico:**

#### 1. Verificar operación POST:

1. **Data → Tables → [Tu tabla] → Settings**
2. Ve a **CREATE** tab
3. Verifica:
   - **Enabled:** ✅
   - **Endpoint:** `/api/reservations`
   - **Method:** `POST`

#### 2. Verificar body template:

```json
{
  "nom_persona_reserva": "<<[nom_persona_reserva]>>",
  "telefon": "<<[telefon]>>",
  "data_reserva": "<<[data_reserva]>>",
  "num_persones": <<[num_persones]>>,
  "observacions": "<<[observacions]>>",
  "status": "pending"
}
```

**⚠️ Importante:**
- Campos de texto van entre comillas: `"<<[campo]>>"`
- Campos numéricos SIN comillas: `<<[campo]>>`

#### 3. Test manual:

Prueba crear una reserva manualmente:
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "nom_persona_reserva": "Test",
    "telefon": "+34 600 000 000",
    "data_reserva": "2024-10-30 20:00:00",
    "num_persones": 2
  }' \
  https://tu-proyecto.vercel.app/api/reservations
```

---

### ❌ "El calendario no muestra colores"

**Síntomas:**
- Eventos aparecen todos del mismo color
- Los colores no cambian según el estado

**Solución:**

1. Ve a **UX → Views → Calendario**
2. Encuentra **Color expression**
3. Copia exactamente:

```
SWITCH([status],"confirmed","#4CAF50","pending","#FFA500","cancelled","#F44336","completed","#2196F3","#808080")
```

**Sin espacios ni saltos de línea**

Si no funciona, prueba con IF:
```
IF([status]="confirmed","#4CAF50",IF([status]="pending","#FFA500",IF([status]="cancelled","#F44336","#2196F3")))
```

---

### ❌ "Fechas no se muestran correctamente"

**Síntomas:**
- Fechas muestran zona horaria incorrecta
- Hora diferente a la guardada

**Causa:**
- Conversión de zona horaria

**Solución:**

1. Ve a **Data → Columns → data_reserva**
2. Verifica:
   - **Type:** `DateTime`
   - **Time zone:** `Europe/Madrid` (para España)

En la API, asegúrate de usar formato sin 'Z':
```javascript
// ❌ Con 'Z' (UTC)
"2024-10-25T20:00:00.000Z"

// ✅ Sin 'Z' (local)
"2024-10-25 20:00:00"
```

---

## 🚀 Problemas de Despliegue

### ❌ "Vercel deployment failed"

**Síntomas:**
- `vercel --prod` falla
- Build error en Vercel

**Diagnóstico:**

#### 1. Ver logs:
```bash
vercel logs --follow
```

#### 2. Verificar vercel.json:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.js",
      "use": "@vercel/node"
    }
  ]
}
```

#### 3. Verificar Node version:
```bash
node --version  # Debe ser >= 18
```

En package.json:
```json
{
  "engines": {
    "node": ">=18.x"
  }
}
```

#### 4. Reinstalar dependencias:
```bash
rm -rf node_modules package-lock.json
npm install
vercel --prod
```

---

### ❌ "Environment variables not loaded"

**Síntomas:**
- API responde pero no conecta con base de datos
- Error: "Cannot read property of undefined"

**Solución:**

#### 1. Listar variables:
```bash
vercel env ls
```

#### 2. Añadir variables faltantes:
```bash
vercel env add DB_HOST
vercel env add DB_USER
vercel env add DB_PASS
vercel env add DB_NAME
vercel env add API_KEY
```

Para cada una, elige: `Production`, `Preview`, y `Development`

#### 3. Redesplegar:
```bash
vercel --prod
```

---

## 💾 Errores de Base de Datos

### ❌ "Error conectando a MySQL"

**Síntomas:**
- Error 500 en todas las peticiones
- "Error conectando a MySQL" en logs

**Diagnóstico:**

#### 1. Verificar credenciales:

Prueba conectar manualmente:
```bash
mysql -h db1.bwai.cc -u cronosdev -p cronosai
```

Si no funciona, el problema es la base de datos, no la API.

#### 2. Verificar que la tabla existe:
```sql
USE cronosai;
SHOW TABLES;
DESCRIBE reservas;
```

#### 3. Verificar variables en Vercel:
- `DB_HOST` = `db1.bwai.cc`
- `DB_PORT` = `3306`
- `DB_USER` = `cronosdev`
- `DB_PASS` = `)CDJ6gwpCO9rg-W/`
- `DB_NAME` = `cronosai`

#### 4. Ver logs de Vercel:
```bash
vercel logs --follow
```

Busca el error específico de MySQL.

---

### ❌ "Query timeout"

**Síntomas:**
- Peticiones muy lentas
- Timeout después de 10 segundos

**Causas:**
1. Tabla muy grande sin índices
2. Conexión lenta a la base de datos
3. Query ineficiente

**Soluciones:**

#### 1. Verificar índices:
```sql
SHOW INDEX FROM reservas;
```

Deberías ver índices en:
- `id_reserva` (PRIMARY)
- `data_reserva`
- `status`
- `created_at`

#### 2. Añadir índices faltantes:
```sql
CREATE INDEX idx_data_reserva ON reservas(data_reserva);
CREATE INDEX idx_status ON reservas(status);
```

#### 3. Aumentar timeout en la conexión:

En `api/reservations.js`:
```javascript
const dbConfig = {
  // ... otros campos
  acquireTimeout: 20000,  // 20 segundos
  timeout: 20000
};
```

---

## 🧪 Herramientas de Diagnóstico

### Test Completo de la API

```bash
cd appsheet-reservas
npm test
```

### Test Manual con cURL

```bash
# Test 1: Verificar que la API responde
curl https://tu-proyecto.vercel.app/api/reservations

# Test 2: Con API Key
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations

# Test 3: Crear reserva
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{"nom_persona_reserva":"Test","telefon":"+34600000000","data_reserva":"2024-10-30 20:00:00","num_persones":2}' \
  https://tu-proyecto.vercel.app/api/reservations
```

### Ver Logs en Tiempo Real

```bash
vercel logs --follow
```

### Verificar Estado del Servidor

```bash
curl -I https://tu-proyecto.vercel.app/api/reservations
```

---

## 📞 Obtener Ayuda

Si ninguna de estas soluciones funciona:

1. **Revisa los logs:**
   ```bash
   vercel logs --follow
   ```

2. **Busca en la documentación:**
   - [Documentación de Vercel](https://vercel.com/docs)
   - [Documentación de AppSheet](https://help.appsheet.com)

3. **Comunidades:**
   - [AppSheet Community](https://community.appsheet.com)
   - [Vercel Discord](https://vercel.com/discord)

4. **Abre un issue:**
   - Incluye el error completo
   - Incluye los logs
   - Menciona qué ya intentaste

---

**Última actualización:** Octubre 2024

