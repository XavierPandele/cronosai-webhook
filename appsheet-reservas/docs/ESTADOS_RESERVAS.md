# 🎨 Configuración de Estados de Reservas en AppSheet

Esta guía te ayudará a configurar los estados de reservas con colores en AppSheet para una mejor gestión visual.

## 📋 Estados Disponibles

| Estado | Emoji | Color | Descripción |
|--------|-------|-------|-------------|
| `confirmed` | 🟢 Confirmada | Verde | Reserva confirmada por el cliente |
| `pending` | 🟡 Pendiente | Naranja | Reserva pendiente de confirmación |
| `cancelled` | 🔴 Cancelada | Rojo | Reserva cancelada |
| `completed` | 🔵 Completada | Azul | Reserva completada (cliente ya vino) |

## 🔧 Configuración en AppSheet

### Paso 1: Configurar Columna Virtual para Estado Visual

1. Ve a **Data > Columns** para la tabla Reservas
2. Click en **"+ Add Virtual Column"**

```
Column name: estado_visual
Type: Text
App formula:
SWITCH(
  [status],
  "confirmed", "🟢 Confirmada",
  "pending", "🟡 Pendiente", 
  "cancelled", "🔴 Cancelada",
  "completed", "🔵 Completada",
  "⚪ Desconocido"
)
```

### Paso 2: Configurar Columna de Color

```
Column name: color_estado
Type: Text
App formula:
SWITCH(
  [status],
  "confirmed", "#4CAF50",
  "pending", "#FFA500",
  "cancelled", "#F44336",
  "completed", "#2196F3",
  "#808080"
)
```

### Paso 3: Configurar Vista de Calendario con Colores

1. Ve a **UX > Views**
2. Selecciona la vista **"Calendario de Reservas"**
3. En **Color Expression**, usa:

```
SWITCH(
  [status],
  "confirmed", "#4CAF50",
  "pending", "#FFA500",
  "cancelled", "#F44336",
  "completed", "#2196F3",
  "#808080"
)
```

### Paso 4: Configurar Lista de Reservas con Estados

1. Ve a **UX > Views**
2. Selecciona la vista de lista de **Reservas**
3. Añade las columnas:
   - `estado_visual` (para mostrar el emoji y texto)
   - `status` (para filtros)
   - `color_estado` (para colores de fondo)

### Paso 5: Crear Filtros por Estado

1. En la vista de lista, ve a **Filters**
2. Añade filtros para cada estado:

```
Filter 1: Reservas Pendientes
Condition: [status] = "pending"

Filter 2: Reservas Confirmadas  
Condition: [status] = "confirmed"

Filter 3: Reservas Canceladas
Condition: [status] = "cancelled"

Filter 4: Reservas Completadas
Condition: [status] = "completed"
```

## 🎨 Personalización Visual Avanzada

### Configurar Colores de Fondo en Lista

1. Ve a **UX > Views > Reservas List**
2. En **Row Style**, configura:

```
Background Color Expression:
SWITCH(
  [status],
  "confirmed", "#E8F5E9",
  "pending", "#FFF3E0", 
  "cancelled", "#FFEBEE",
  "completed", "#E3F2FD",
  "#F5F5F5"
)
```

### Configurar Iconos por Estado

1. Añade columna virtual:

```
Column name: icono_estado
Type: Text
App formula:
SWITCH(
  [status],
  "confirmed", "✅",
  "pending", "⏳",
  "cancelled", "❌",
  "completed", "🎉",
  "❓"
)
```

## 📊 Dashboard con Estados

### Widget: Resumen por Estado

```
Widget type: Chart
Chart type: Pie
Group by: status
Aggregate: COUNT
Title: Reservas por Estado
Colors:
  - confirmed: #4CAF50
  - pending: #FFA500
  - cancelled: #F44336
  - completed: #2196F3
```

### Widget: Tarjetas por Estado

#### Tarjeta Pendientes
```
Widget type: Card
Title: Pendientes
Value: COUNT(SELECT(Reservas[id_reserva], [status] = "pending"))
Icon: pending
Color: #FFA500
```

#### Tarjeta Confirmadas
```
Widget type: Card
Title: Confirmadas
Value: COUNT(SELECT(Reservas[id_reserva], [status] = "confirmed"))
Icon: check_circle
Color: #4CAF50
```

#### Tarjeta Canceladas
```
Widget type: Card
Title: Canceladas
Value: COUNT(SELECT(Reservas[id_reserva], [status] = "cancelled"))
Icon: cancel
Color: #F44336
```

#### Tarjeta Completadas
```
Widget type: Card
Title: Completadas
Value: COUNT(SELECT(Reservas[id_reserva], [status] = "completed"))
Icon: done_all
Color: #2196F3
```

## 🔄 Automatización de Estados

### Bot: Cambiar Estado Automáticamente

1. Ve a **Automation > Bots**
2. Click en **"+ New Bot"**

```
Bot name: Auto-completar Reservas Pasadas
Event: Schedule (Daily at 23:00)
Condition: [data_reserva] < NOW() AND [status] = "confirmed"
Task: Update record
Field: status
Value: "completed"
```

### Bot: Recordatorio de Reservas Pendientes

```
Bot name: Recordatorio Reservas Pendientes
Event: Schedule (Daily at 10:00)
Condition: [data_reserva] = TODAY() AND [status] = "pending"
Task: Send notification
Message: "Tienes reservas pendientes de confirmar para hoy"
```

## 📱 Configuración Mobile

### Vista Móvil Optimizada

1. Crea una nueva vista: **"Reservas Mobile"**
2. Configuración:

```
View type: List
Show: Reservas
Sort by: data_reserva (Ascending)
Group by: status
Show group headers: Yes
```

### Botones de Acción Rápida

1. Añade columna virtual:

```
Column name: acciones_rapidas
Type: Action
Actions:
  - Confirmar: Update [status] = "confirmed"
  - Cancelar: Update [status] = "cancelled"  
  - Completar: Update [status] = "completed"
```

## 🎯 Mejores Prácticas

### 1. Flujo de Estados Recomendado

```
Nueva Reserva → pending → confirmed → completed
                ↓
            cancelled
```

### 2. Permisos por Estado

- **Admin**: Puede cambiar cualquier estado
- **Manager**: Puede confirmar y completar
- **Staff**: Solo puede ver estados

### 3. Notificaciones por Estado

```
Estado: pending → Notificar al manager
Estado: confirmed → Notificar al cliente
Estado: cancelled → Notificar al manager
Estado: completed → Registrar estadísticas
```

## 🔍 Filtros Útiles

### Filtro: Reservas de Hoy por Estado

```
Filter name: Hoy Pendientes
Condition: DATE([data_reserva]) = TODAY() AND [status] = "pending"

Filter name: Hoy Confirmadas
Condition: DATE([data_reserva]) = TODAY() AND [status] = "confirmed"
```

### Filtro: Reservas por Rango de Fechas

```
Filter name: Esta Semana
Condition: [data_reserva] >= START_OF_WEEK(TODAY()) AND [data_reserva] <= END_OF_WEEK(TODAY())
```

## 📈 Reportes por Estado

### Reporte Semanal

1. Ve a **UX > Views**
2. Crea vista **"Reporte Semanal"**

```
View type: Dashboard
Widgets:
  - Total reservas esta semana
  - Pendientes esta semana
  - Confirmadas esta semana
  - Canceladas esta semana
  - Completadas esta semana
  - Gráfico de tendencia por día
```

## 🆘 Troubleshooting

### Problema: Los colores no se muestran en el calendario

**Solución:**
1. Verifica que la expresión de color esté correcta
2. Asegúrate de que el campo `status` tenga valores válidos
3. Refresca la app con el botón de sincronización

### Problema: Los emojis no se muestran

**Solución:**
1. Verifica que el dispositivo soporte emojis
2. Usa la versión web de AppSheet si hay problemas en móvil
3. Considera usar iconos de texto alternativos

### Problema: Los estados no se actualizan

**Solución:**
1. Verifica que la API esté funcionando correctamente
2. Comprueba los permisos de escritura en AppSheet
3. Revisa los logs de la API en Vercel

---

## ✅ Checklist de Configuración

- [ ] Estados configurados en la API
- [ ] Columna virtual `estado_visual` creada
- [ ] Columna virtual `color_estado` creada
- [ ] Vista de calendario con colores configurada
- [ ] Filtros por estado creados
- [ ] Dashboard con widgets por estado
- [ ] Botones de acción rápida configurados
- [ ] Automatizaciones configuradas
- [ ] Pruebas realizadas en móvil y web
- [ ] Permisos configurados correctamente

---

¡Perfecto! 🎉 Ahora tienes un sistema completo de gestión de estados de reservas con colores visuales en AppSheet.
