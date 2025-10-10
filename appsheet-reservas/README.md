# 📱 AppSheet - Sistema de Reservas

Integración completa de AppSheet con base de datos MySQL para gestionar reservas con vista de calendario.

## 🚀 Características

- ✅ **API REST completa** con endpoints CRUD
- 📅 **Endpoint especializado para calendario** con formato optimizado
- 📊 **Estadísticas y análisis** de reservas
- 🔒 **Autenticación con API Key**
- 🌐 **CORS habilitado** para acceso desde AppSheet
- ⚡ **Desplegado en Vercel** (serverless)

## 📁 Estructura del Proyecto

```
appsheet-reservas/
├── api/
│   ├── reservations.js    # CRUD completo de reservas
│   ├── calendar.js         # Vista de calendario optimizada
│   └── stats.js            # Estadísticas y análisis
├── docs/
│   ├── APPSHEET_SETUP.md   # Guía de configuración AppSheet
│   ├── API_DOCUMENTATION.md # Documentación de la API
│   └── EJEMPLOS.md         # Ejemplos de uso
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

## 🔧 Instalación y Despliegue

### 1. Instalar Dependencias

```bash
cd appsheet-reservas
npm install
```

### 2. Configurar Variables de Entorno

Crea un archivo `.env` basado en `.env.example`:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
DB_HOST=db1.bwai.cc
DB_PORT=3306
DB_USER=cronosdev
DB_PASS=)CDJ6gwpCO9rg-W/
DB_NAME=cronosai
API_KEY=tu-api-key-segura
```

### 3. Desplegar en Vercel

```bash
# Instalar Vercel CLI
npm install -g vercel

# Desplegar
vercel --prod
```

Después del despliegue, obtendrás una URL como:
```
https://appsheet-reservas-api.vercel.app
```

### 4. Configurar Variables en Vercel

Ve a tu dashboard de Vercel y agrega las variables de entorno:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`
- `API_KEY`

## 📡 Endpoints de la API

### Base URL
```
https://tu-proyecto.vercel.app
```

### 🔑 Autenticación

Todas las peticiones requieren el header:
```
X-Api-Key: appsheet-cronos-2024
```

### 📋 Endpoints Principales

#### 1. **GET /api/reservations** - Listar reservas

**Query Parameters:**
- `id` (opcional): ID específico de reserva
- `status` (opcional): pending, confirmed, cancelled, completed
- `fecha_inicio` (opcional): Fecha inicio (YYYY-MM-DD)
- `fecha_fin` (opcional): Fecha fin (YYYY-MM-DD)
- `telefon` (opcional): Filtrar por teléfono

**Ejemplo:**
```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?status=confirmed"
```

**Respuesta:**
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "id_reserva": 1,
      "nom_persona_reserva": "Juan Pérez",
      "telefon": "+34 612 345 678",
      "data_reserva": "2024-10-15 20:00:00",
      "num_persones": 4,
      "observacions": "Mesa cerca de la ventana",
      "status": "confirmed",
      "created_at": "2024-10-10 10:30:00",
      "updated_at": "2024-10-10 10:30:00"
    }
  ]
}
```

#### 2. **POST /api/reservations** - Crear reserva

**Body:**
```json
{
  "nom_persona_reserva": "María García",
  "telefon": "+34 623 456 789",
  "data_reserva": "2024-10-20 19:30:00",
  "num_persones": 2,
  "observacions": "Cumpleaños",
  "status": "pending"
}
```

#### 3. **PUT /api/reservations?id=1** - Actualizar reserva

**Body:**
```json
{
  "status": "confirmed",
  "observacions": "Mesa confirmada en terraza"
}
```

#### 4. **DELETE /api/reservations?id=1** - Eliminar reserva

#### 5. **GET /api/calendar** - Vista de calendario

**Query Parameters:**
- `mes` (opcional): Número del mes (1-12)
- `anio` (opcional): Año (YYYY)
- `fecha_inicio` (opcional): Fecha inicio
- `fecha_fin` (opcional): Fecha fin

**Respuesta:**
```json
{
  "success": true,
  "count": 15,
  "stats": {
    "total_reservas": 15,
    "total_personas": 45,
    "por_estado": {
      "pending": 5,
      "confirmed": 8,
      "cancelled": 2,
      "completed": 0
    }
  },
  "events": [
    {
      "id": 1,
      "title": "Juan Pérez (4 personas)",
      "start": "2024-10-15 20:00:00",
      "end": "2024-10-15 22:00:00",
      "description": "Mesa cerca de la ventana",
      "cliente": "Juan Pérez",
      "telefono": "+34 612 345 678",
      "num_personas": 4,
      "estado": "confirmed",
      "color": "#4CAF50",
      "backgroundColor": "#E8F5E9"
    }
  ]
}
```

#### 6. **GET /api/stats** - Estadísticas

**Respuesta:**
```json
{
  "success": true,
  "timestamp": "2024-10-10T10:30:00.000Z",
  "estadisticas_generales": {
    "total_reservas": 150,
    "total_personas": 450,
    "promedio_personas": "3.00",
    "tasa_cancelacion": "5.50%"
  },
  "por_estado": [...],
  "por_dia_semana": [...],
  "por_hora": [...],
  "top_clientes": [...],
  "proximas_reservas": [...]
}
```

## 📱 Configuración en AppSheet

### Paso 1: Crear Nueva App

1. Ve a [AppSheet](https://www.appsheet.com)
2. Click en **"Create" > "App" > "Start with your own data"**
3. Selecciona **"Cloud Database"** como fuente de datos

### Paso 2: Configurar Data Source

1. En el editor de AppSheet, ve a **Data > Tables**
2. Click en **"+ New Table"**
3. Selecciona **"API"** como fuente
4. Configura:
   - **Name:** Reservas
   - **API Type:** REST API
   - **Base URL:** `https://tu-proyecto.vercel.app/api/reservations`
   - **Authentication:** Custom Header
   - **Header Name:** `X-Api-Key`
   - **Header Value:** `appsheet-cronos-2024`

### Paso 3: Configurar Operaciones CRUD

#### GET (Read)
- **Endpoint:** `/api/reservations`
- **Method:** GET

#### POST (Create)
- **Endpoint:** `/api/reservations`
- **Method:** POST
- **Body:** Mapear campos de la tabla

#### PUT (Update)
- **Endpoint:** `/api/reservations?id={{id_reserva}}`
- **Method:** PUT
- **Body:** Mapear campos modificados

#### DELETE
- **Endpoint:** `/api/reservations?id={{id_reserva}}`
- **Method:** DELETE

### Paso 4: Crear Vista de Calendario

1. Ve a **UX > Views**
2. Click en **"+ New View"**
3. Configura:
   - **View Name:** Calendario
   - **View Type:** Calendar
   - **For this data:** Reservas
   - **Position type:** Fixed
   - **Start:** `data_reserva`
   - **End:** `data_reserva + 2 hours`
   - **Label:** `nom_persona_reserva`

### Paso 5: Personalizar Colores

En las propiedades de la vista, agrega:

```
Color = SWITCH([status],
  "confirmed", "#4CAF50",
  "pending", "#FFA500",
  "cancelled", "#F44336",
  "completed", "#2196F3",
  "#808080"
)
```

## 🎨 Vistas Recomendadas para AppSheet

### 1. Vista de Calendario (Principal)
- Muestra todas las reservas en formato calendario
- Colores según estado
- Click para ver detalles

### 2. Vista de Lista
- Listado de reservas
- Filtros por estado, fecha, cliente
- Búsqueda rápida

### 3. Vista de Detalles
- Información completa de la reserva
- Opciones para editar/eliminar
- Botón para llamar al cliente

### 4. Dashboard de Estadísticas
- Tarjetas con métricas clave
- Gráficos de reservas por estado
- Top clientes
- Tendencias

### 5. Formulario de Nueva Reserva
- Campos validados
- Selector de fecha/hora
- Autocompletado de cliente

## 🔒 Seguridad

### API Key

Cambia el API Key en producción:

1. En Vercel: `Environment Variables > API_KEY`
2. En AppSheet: Actualiza el header `X-Api-Key`

### CORS

La API permite acceso desde cualquier origen (`*`). Para mayor seguridad, modifica en los archivos de API:

```javascript
res.setHeader('Access-Control-Allow-Origin', 'https://tuapp.appsheet.com');
```

## 🧪 Pruebas

### Probar endpoint con curl:

```bash
# GET - Listar reservas
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations

# POST - Crear reserva
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "nom_persona_reserva": "Test User",
    "telefon": "+34 600000000",
    "data_reserva": "2024-10-25 20:00:00",
    "num_persones": 2,
    "status": "pending"
  }' \
  https://tu-proyecto.vercel.app/api/reservations

# GET - Vista calendario
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/calendar?mes=10&anio=2024"

# GET - Estadísticas
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/stats
```

## 📊 Esquema de Base de Datos

```sql
CREATE TABLE reservas (
    id_reserva INT(11) AUTO_INCREMENT PRIMARY KEY,
    nom_persona_reserva VARCHAR(100) NOT NULL,
    telefon VARCHAR(16) NOT NULL,
    data_reserva DATETIME NOT NULL,
    num_persones INT(11) NOT NULL,
    observacions TEXT NULL,
    conversa_completa TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('pending', 'confirmed', 'cancelled', 'completed') DEFAULT 'pending'
);
```

## 🐛 Troubleshooting

### Error: "API Key inválida"
- Verifica que el header `X-Api-Key` esté presente
- Confirma que el valor coincide con el configurado en Vercel

### Error de conexión a base de datos
- Verifica las variables de entorno en Vercel
- Asegúrate de que la base de datos esté accesible
- Revisa los logs en Vercel Dashboard

### Datos no se muestran en AppSheet
- Verifica el formato de respuesta de la API
- Confirma que los campos mapeados coincidan
- Revisa los logs en AppSheet Monitor

## 📞 Soporte

Para más información, consulta:
- [Documentación de AppSheet](https://help.appsheet.com/)
- [Documentación de Vercel](https://vercel.com/docs)

## 📝 Licencia

MIT License - CronosAI 2024

