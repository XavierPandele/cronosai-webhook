# 📚 Documentación Completa de la API

API REST para el sistema de gestión de reservas, optimizada para integración con AppSheet.

---

## 🌐 Base URL

```
https://tu-proyecto.vercel.app
```

Reemplaza `tu-proyecto` con tu nombre de proyecto en Vercel.

---

## 🔐 Autenticación

Todas las peticiones requieren un API Key en los headers:

```http
X-Api-Key: appsheet-cronos-2024
```

### Códigos de Error de Autenticación

| Código | Descripción |
|--------|-------------|
| `401` | API Key inválida o faltante |
| `403` | Acceso denegado |

---

## 📡 Endpoints

### 1. Gestión de Reservas

#### 🟢 GET `/api/reservations`

Obtiene lista de reservas con filtros opcionales.

**Headers:**
```http
X-Api-Key: appsheet-cronos-2024
```

**Query Parameters:**

| Parámetro | Tipo | Requerido | Descripción | Ejemplo |
|-----------|------|-----------|-------------|---------|
| `id` | Number | No | ID específico de reserva | `?id=123` |
| `status` | String | No | Estado de la reserva | `?status=confirmed` |
| `fecha_inicio` | Date | No | Fecha inicio (YYYY-MM-DD) | `?fecha_inicio=2024-10-01` |
| `fecha_fin` | Date | No | Fecha fin (YYYY-MM-DD) | `?fecha_fin=2024-10-31` |
| `telefon` | String | No | Filtrar por teléfono | `?telefon=+34612345678` |

**Valores válidos para `status`:**
- `pending` - Pendiente de confirmación
- `confirmed` - Confirmada
- `cancelled` - Cancelada
- `completed` - Completada

**Ejemplo de Request:**

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?status=confirmed&fecha_inicio=2024-10-01&fecha_fin=2024-10-31"
```

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "id_reserva": 1,
      "nom_persona_reserva": "Juan Pérez García",
      "telefon": "+34 612 345 678",
      "data_reserva": "2024-10-15 20:00:00",
      "num_persones": 4,
      "observacions": "Mesa cerca de la ventana, cumpleaños",
      "conversa_completa": null,
      "status": "confirmed",
      "created_at": "2024-10-10 10:30:00",
      "updated_at": "2024-10-10 11:00:00"
    },
    {
      "id_reserva": 2,
      "nom_persona_reserva": "María López Martínez",
      "telefon": "+34 623 456 789",
      "data_reserva": "2024-10-16 19:30:00",
      "num_persones": 2,
      "observacions": "Cena romántica",
      "conversa_completa": null,
      "status": "confirmed",
      "created_at": "2024-10-10 12:00:00",
      "updated_at": "2024-10-10 12:00:00"
    }
  ]
}
```

**Respuesta de Error (404):**

```json
{
  "success": false,
  "error": "Reserva no encontrada"
}
```

---

#### 🟢 POST `/api/reservations`

Crea una nueva reserva.

**Headers:**
```http
Content-Type: application/json
X-Api-Key: appsheet-cronos-2024
```

**Request Body:**

```json
{
  "nom_persona_reserva": "Carlos Rodríguez",
  "telefon": "+34 634 567 890",
  "data_reserva": "2024-10-20 21:00:00",
  "num_persones": 6,
  "observacions": "Reunión de trabajo, mesa grande",
  "conversa_completa": "Conversación completa aquí...",
  "status": "pending"
}
```

**Campos:**

| Campo | Tipo | Requerido | Validación | Descripción |
|-------|------|-----------|------------|-------------|
| `nom_persona_reserva` | String | ✅ Sí | Min 2 caracteres | Nombre completo del cliente |
| `telefon` | String | ✅ Sí | Formato válido | Número de teléfono con formato +34... |
| `data_reserva` | DateTime | ✅ Sí | Formato válido, futuro | Fecha y hora en formato YYYY-MM-DD HH:MM:SS |
| `num_persones` | Number | ✅ Sí | 1-20 | Número de personas para la reserva |
| `observacions` | String | No | Max 1000 caracteres | Observaciones especiales |
| `conversa_completa` | String | No | Max 2000 caracteres | Historial de conversación completo |
| `status` | String | No | pending/confirmed/cancelled/completed | Estado inicial (default: pending) |

**Ejemplo de Request:**

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "nom_persona_reserva": "Ana García",
    "telefon": "+34 645 678 901",
    "data_reserva": "2024-10-22 20:30:00",
    "num_persones": 3,
    "observacions": "Sin gluten",
    "status": "pending"
  }' \
  https://tu-proyecto.vercel.app/api/reservations
```

**Respuesta Exitosa (201):**

```json
{
  "success": true,
  "message": "Reserva creada exitosamente",
  "data": {
    "id_reserva": 15,
    "nom_persona_reserva": "Ana García",
    "telefon": "+34 645 678 901",
    "data_reserva": "2024-10-22 20:30:00",
    "num_persones": 3,
    "observacions": "Sin gluten",
    "conversa_completa": null,
    "status": "pending",
    "created_at": "2024-10-10 14:30:00",
    "updated_at": "2024-10-10 14:30:00"
  }
}
```

**Respuesta de Error (400):**

```json
{
  "success": false,
  "error": "Campos obligatorios faltantes",
  "required": [
    "nom_persona_reserva",
    "telefon",
    "data_reserva",
    "num_persones"
  ]
}
```

---

#### 🟡 PUT `/api/reservations?id={id}`

Actualiza una reserva existente.

**Headers:**
```http
Content-Type: application/json
X-Api-Key: appsheet-cronos-2024
```

**Query Parameters:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `id` | Number | ✅ Sí | ID de la reserva a actualizar |

**Request Body:**

Envía solo los campos que deseas actualizar:

```json
{
  "status": "confirmed",
  "observacions": "Mesa confirmada en terraza",
  "num_persones": 5
}
```

**Ejemplo de Request:**

```bash
curl -X PUT \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: appsheet-cronos-2024" \
  -d '{
    "status": "confirmed",
    "observacions": "Confirmada y asignada mesa 5"
  }' \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "message": "Reserva actualizada exitosamente",
  "data": {
    "id_reserva": 15,
    "nom_persona_reserva": "Ana García",
    "telefon": "+34 645 678 901",
    "data_reserva": "2024-10-22 20:30:00",
    "num_persones": 5,
    "observacions": "Confirmada y asignada mesa 5",
    "conversa_completa": null,
    "status": "confirmed",
    "created_at": "2024-10-10 14:30:00",
    "updated_at": "2024-10-10 15:00:00"
  }
}
```

**Respuesta de Error (404):**

```json
{
  "success": false,
  "error": "Reserva no encontrada"
}
```

---

#### 🔴 DELETE `/api/reservations?id={id}`

Elimina una reserva.

**Headers:**
```http
X-Api-Key: appsheet-cronos-2024
```

**Query Parameters:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `id` | Number | ✅ Sí | ID de la reserva a eliminar |

**Ejemplo de Request:**

```bash
curl -X DELETE \
  -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/reservations?id=15"
```

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "message": "Reserva eliminada exitosamente",
  "data": {
    "id_reserva": 15,
    "nom_persona_reserva": "Ana García",
    "telefon": "+34 645 678 901",
    "data_reserva": "2024-10-22 20:30:00",
    "num_persones": 5,
    "observacions": "Confirmada y asignada mesa 5",
    "conversa_completa": null,
    "status": "confirmed",
    "created_at": "2024-10-10 14:30:00",
    "updated_at": "2024-10-10 15:00:00"
  }
}
```

---

### 2. Vista de Calendario

#### 🟢 GET `/api/calendar`

Obtiene reservas formateadas para vista de calendario con estadísticas.

**Headers:**
```http
X-Api-Key: appsheet-cronos-2024
```

**Query Parameters:**

| Parámetro | Tipo | Requerido | Descripción | Ejemplo |
|-----------|------|-----------|-------------|---------|
| `mes` | Number | No | Mes específico (1-12) | `?mes=10` |
| `anio` | Number | No | Año específico | `?anio=2024` |
| `fecha_inicio` | Date | No | Fecha inicio | `?fecha_inicio=2024-10-01` |
| `fecha_fin` | Date | No | Fecha fin | `?fecha_fin=2024-10-31` |

**Ejemplo de Request:**

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  "https://tu-proyecto.vercel.app/api/calendar?mes=10&anio=2024"
```

**Respuesta Exitosa (200):**

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
      "title": "Juan Pérez García (4 personas)",
      "start": "2024-10-15 20:00:00",
      "end": "2024-10-15 22:00:00",
      "description": "Mesa cerca de la ventana, cumpleaños",
      "location": "Restaurante",
      "cliente": "Juan Pérez García",
      "telefono": "+34 612 345 678",
      "num_personas": 4,
      "estado": "confirmed",
      "fecha": "2024-10-15",
      "hora": "20:00:00",
      "dia_semana": "Tuesday",
      "color": "#4CAF50",
      "backgroundColor": "#E8F5E9"
    }
  ]
}
```

**Colores por Estado:**

| Estado | Color | Background | Significado |
|--------|-------|------------|-------------|
| `pending` | `#FFA500` | `#FFF3E0` | 🟡 Pendiente |
| `confirmed` | `#4CAF50` | `#E8F5E9` | 🟢 Confirmada |
| `cancelled` | `#F44336` | `#FFEBEE` | 🔴 Cancelada |
| `completed` | `#2196F3` | `#E3F2FD` | 🔵 Completada |

---

### 3. Estadísticas

#### 🟢 GET `/api/stats`

Obtiene estadísticas completas y análisis de reservas.

**Headers:**
```http
X-Api-Key: appsheet-cronos-2024
```

**Ejemplo de Request:**

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/stats
```

**Respuesta Exitosa (200):**

```json
{
  "success": true,
  "timestamp": "2024-10-10T14:30:00.000Z",
  "estadisticas_generales": {
    "total_reservas": 150,
    "total_personas": 450,
    "promedio_personas": "3.00",
    "tasa_cancelacion": "5.50%"
  },
  "por_estado": [
    {
      "status": "pending",
      "cantidad": 20,
      "total_personas": 60
    },
    {
      "status": "confirmed",
      "cantidad": 100,
      "total_personas": 300
    },
    {
      "status": "cancelled",
      "cantidad": 15,
      "total_personas": 45
    },
    {
      "status": "completed",
      "cantidad": 15,
      "total_personas": 45
    }
  ],
  "por_dia_semana": [
    {
      "dia_semana": "Monday",
      "cantidad": 15,
      "promedio_personas": "2.80"
    },
    {
      "dia_semana": "Tuesday",
      "cantidad": 18,
      "promedio_personas": "3.10"
    }
  ],
  "por_hora": [
    {
      "hora": 19,
      "cantidad": 25,
      "total_personas": 70
    },
    {
      "hora": 20,
      "cantidad": 40,
      "total_personas": 120
    },
    {
      "hora": 21,
      "cantidad": 30,
      "total_personas": 90
    }
  ],
  "top_clientes": [
    {
      "nom_persona_reserva": "Juan Pérez",
      "telefon": "+34 612 345 678",
      "total_reservas": 10,
      "total_personas": 35,
      "ultima_reserva": "2024-10-10 20:00:00"
    }
  ],
  "mes_actual": [
    {
      "total": 5,
      "total_personas": 15,
      "fecha": "2024-10-15",
      "confirmadas": 3
    }
  ],
  "proximas_reservas": [
    {
      "id_reserva": 45,
      "nom_persona_reserva": "María López",
      "telefon": "+34 623 456 789",
      "data_reserva": "2024-10-11 20:00:00",
      "num_persones": 4,
      "status": "confirmed"
    }
  ]
}
```

---

## 🚨 Códigos de Estado HTTP

| Código | Significado | Descripción |
|--------|-------------|-------------|
| `200` | OK | Solicitud exitosa |
| `201` | Created | Recurso creado exitosamente |
| `400` | Bad Request | Datos inválidos o faltantes |
| `401` | Unauthorized | API Key inválida o faltante |
| `404` | Not Found | Recurso no encontrado |
| `405` | Method Not Allowed | Método HTTP no permitido |
| `500` | Internal Server Error | Error interno del servidor |

---

## 🔄 Rate Limiting

La API no tiene límite de peticiones actualmente, pero se recomienda:

- Máximo 100 peticiones por minuto
- Usar caché cuando sea posible
- Implementar retry con exponential backoff

---

## 📝 Ejemplos de Uso con JavaScript

### Fetch API

```javascript
// GET - Obtener reservas
async function getReservations() {
  const response = await fetch('https://tu-proyecto.vercel.app/api/reservations', {
    headers: {
      'X-Api-Key': 'appsheet-cronos-2024'
    }
  });
  const data = await response.json();
  return data;
}

// POST - Crear reserva
async function createReservation(reserva) {
  const response = await fetch('https://tu-proyecto.vercel.app/api/reservations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': 'appsheet-cronos-2024'
    },
    body: JSON.stringify(reserva)
  });
  const data = await response.json();
  return data;
}

// PUT - Actualizar reserva
async function updateReservation(id, cambios) {
  const response = await fetch(`https://tu-proyecto.vercel.app/api/reservations?id=${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': 'appsheet-cronos-2024'
    },
    body: JSON.stringify(cambios)
  });
  const data = await response.json();
  return data;
}

// DELETE - Eliminar reserva
async function deleteReservation(id) {
  const response = await fetch(`https://tu-proyecto.vercel.app/api/reservations?id=${id}`, {
    method: 'DELETE',
    headers: {
      'X-Api-Key': 'appsheet-cronos-2024'
    }
  });
  const data = await response.json();
  return data;
}
```

---

## 🐛 Debugging

### Habilitar Logs en Vercel

1. Ve a tu proyecto en Vercel Dashboard
2. Click en "Logs"
3. Filtra por endpoint específico
4. Revisa errores y tiempos de respuesta

### Headers de Debug

Puedes añadir estos headers para obtener más información:

```http
X-Debug-Mode: true
```

---

## 📚 Recursos

- [Documentación de Vercel](https://vercel.com/docs)
- [MySQL2 Documentation](https://github.com/sidorares/node-mysql2)
- [REST API Best Practices](https://restfulapi.net/)

---

**Última actualización:** Octubre 2024  
**Versión de la API:** 1.0.0

