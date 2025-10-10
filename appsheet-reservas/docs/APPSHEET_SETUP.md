# 📱 Guía Completa de Configuración de AppSheet

Esta guía te llevará paso a paso para crear tu aplicación de reservas en AppSheet con vista de calendario.

## 📋 Índice

1. [Requisitos Previos](#requisitos-previos)
2. [Crear la App en AppSheet](#crear-la-app)
3. [Configurar Fuente de Datos](#configurar-fuente-de-datos)
4. [Configurar Tabla de Reservas](#configurar-tabla)
5. [Crear Vista de Calendario](#crear-vista-calendario)
6. [Configurar Formularios](#configurar-formularios)
7. [Añadir Dashboard](#añadir-dashboard)
8. [Personalización Avanzada](#personalización-avanzada)
9. [Publicar la App](#publicar-app)

---

## 🔧 Requisitos Previos

Antes de comenzar, asegúrate de tener:

- ✅ Cuenta en [AppSheet](https://www.appsheet.com) (puede ser gratuita)
- ✅ API desplegada en Vercel (ver README principal)
- ✅ URL de tu API (ej: `https://tu-proyecto.vercel.app`)
- ✅ API Key configurada

---

## 1️⃣ Crear la App en AppSheet

### Paso 1.1: Acceder a AppSheet

1. Ve a [https://www.appsheet.com](https://www.appsheet.com)
2. Inicia sesión con tu cuenta de Google
3. Click en **"My Apps"** en el menú superior

### Paso 1.2: Crear Nueva App

1. Click en **"Make a new app"** (botón azul grande)
2. Selecciona **"Start with your own data"**
3. Dale un nombre a tu app: `Reservas Restaurante`
4. Categoría: `Business`
5. Click en **"Choose your data"**

---

## 2️⃣ Configurar Fuente de Datos

### Paso 2.1: Seleccionar API como Fuente

1. En la ventana de selección de datos, click en **"API"**
2. Selecciona **"REST API"**

### Paso 2.2: Configurar API Connection

```
Connection Name: ReservasAPI
Base URL: https://tu-proyecto.vercel.app
Authentication Type: Custom Headers
```

### Paso 2.3: Añadir Header de Autenticación

```
Header Name: X-Api-Key
Header Value: appsheet-cronos-2024
```

**⚠️ IMPORTANTE:** Cambia `appsheet-cronos-2024` por tu API Key real si la has modificado.

### Paso 2.4: Test Connection

1. Click en **"Test Connection"**
2. Deberías ver un mensaje de éxito ✅
3. Click en **"Save"**

---

## 3️⃣ Configurar Tabla de Reservas

### Paso 3.1: Crear Tabla desde API

1. En el editor, ve a **Data > Tables**
2. Click en **"+ New Table"**
3. Selecciona la conexión **"ReservasAPI"** que acabas de crear

### Paso 3.2: Configurar Endpoint

```
Table Name: Reservas
Endpoint: /api/reservations
Method: GET
```

### Paso 3.3: Mapear Respuesta JSON

AppSheet detectará automáticamente la estructura de tu API. Confirma que los campos sean:

| Campo AppSheet | Tipo | Key |
|----------------|------|-----|
| id_reserva | Number | Yes |
| nom_persona_reserva | Text | No |
| telefon | Phone | No |
| data_reserva | DateTime | No |
| num_persones | Number | No |
| observacions | LongText | No |
| status | Text | No |
| created_at | DateTime | No |
| updated_at | DateTime | No |

### Paso 3.4: Configurar Operaciones CRUD

#### READ (GET)
```
Endpoint: /api/reservations
Method: GET
```

#### CREATE (POST)
```
Endpoint: /api/reservations
Method: POST
Request Body Type: JSON
Body Template:
{
  "nom_persona_reserva": "<<[nom_persona_reserva]>>",
  "telefon": "<<[telefon]>>",
  "data_reserva": "<<[data_reserva]>>",
  "num_persones": <<[num_persones]>>,
  "observacions": "<<[observacions]>>",
  "status": "pending"
}
```

#### UPDATE (PUT)
```
Endpoint: /api/reservations?id=<<[id_reserva]>>
Method: PUT
Request Body Type: JSON
Body Template:
{
  "nom_persona_reserva": "<<[nom_persona_reserva]>>",
  "telefon": "<<[telefon]>>",
  "data_reserva": "<<[data_reserva]>>",
  "num_persones": <<[num_persones]>>,
  "observacions": "<<[observacions]>>",
  "status": "<<[status]>>"
}
```

#### DELETE
```
Endpoint: /api/reservations?id=<<[id_reserva]>>
Method: DELETE
```

---

## 4️⃣ Crear Vista de Calendario

### Paso 4.1: Añadir Nueva Vista

1. Ve a **UX > Views** en el panel izquierdo
2. Click en **"+ New View"**

### Paso 4.2: Configurar Vista de Calendario

```
View name: Calendario de Reservas
View type: calendar
Primary view: Yes (marca como vista principal)
For this data: Reservas
```

### Paso 4.3: Configurar Campos del Calendario

#### Start Expression
```
[data_reserva]
```

#### End Expression (duración de 2 horas)
```
[data_reserva] + "02:00:00"
```

#### Label Expression
```
[nom_persona_reserva] & " (" & TEXT([num_persones]) & " personas)"
```

#### Color Expression
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

### Paso 4.4: Configurar Opciones del Calendario

```
☑ Show today
☑ Allow week view
☑ Allow month view
☑ Allow day view
☑ Enable swipe to change date
```

---

## 5️⃣ Configurar Formularios

### Paso 5.1: Formulario de Nueva Reserva

1. Ve a **UX > Views**
2. Busca la vista **"Reservas_Form"** (creada automáticamente)
3. Personaliza el orden de los campos:

```
1. nom_persona_reserva (Nombre del Cliente)
2. telefon (Teléfono)
3. data_reserva (Fecha y Hora)
4. num_persones (Número de Personas)
5. observacions (Observaciones)
```

### Paso 5.2: Configurar Validaciones

#### Campo: nom_persona_reserva
```
Display name: Nombre del Cliente
Required: Yes
Input mode: Text
```

#### Campo: telefon
```
Display name: Teléfono
Required: Yes
Input mode: Phone
Format: +34 XXX XXX XXX
```

#### Campo: data_reserva
```
Display name: Fecha y Hora de Reserva
Required: Yes
Input mode: DateTime
Initial value: NOW() + "02:00:00"
Min value: NOW() + "02:00:00"
```

#### Campo: num_persones
```
Display name: Número de Personas
Required: Yes
Input mode: Number
Min value: 1
Max value: 20
Initial value: 2
```

#### Campo: observacions
```
Display name: Observaciones Especiales
Required: No
Input mode: LongText
Placeholder: Ej: Mesa cerca de la ventana, cumpleaños, etc.
```

### Paso 5.3: Añadir Columna Virtual para Estado

1. Ve a **Data > Columns** para la tabla Reservas
2. Click en **"+ Add Virtual Column"**

```
Column name: estado_color
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

---

## 6️⃣ Añadir Dashboard

### Paso 6.1: Crear Vista de Dashboard

1. Ve a **UX > Views**
2. Click en **"+ New View"**

```
View name: Dashboard
View type: dashboard
Primary view: No
For this data: Reservas
```

### Paso 6.2: Añadir Widgets

#### Widget 1: Total Reservas Hoy
```
Widget type: Card
Title: Reservas Hoy
Value: COUNT(SELECT(Reservas[id_reserva], 
  DATE([data_reserva]) = TODAY()))
Icon: calendar_today
Color: Blue
```

#### Widget 2: Reservas Pendientes
```
Widget type: Card
Title: Pendientes
Value: COUNT(SELECT(Reservas[id_reserva], 
  [status] = "pending"))
Icon: pending
Color: Orange
```

#### Widget 3: Reservas Confirmadas
```
Widget type: Card
Title: Confirmadas
Value: COUNT(SELECT(Reservas[id_reserva], 
  [status] = "confirmed"))
Icon: check_circle
Color: Green
```

#### Widget 4: Total Personas Hoy
```
Widget type: Card
Title: Personas Hoy
Value: SUM(SELECT(Reservas[num_persones], 
  DATE([data_reserva]) = TODAY()))
Icon: people
Color: Purple
```

#### Widget 5: Gráfico de Reservas por Estado
```
Widget type: Chart
Chart type: Pie
Group by: status
Aggregate: COUNT
Title: Reservas por Estado
```

#### Widget 6: Próximas Reservas
```
Widget type: List
Show: Reservas
Filter: [data_reserva] >= NOW()
Sort by: data_reserva (Ascending)
Limit: 10
Title: Próximas Reservas
```

---

## 7️⃣ Personalización Avanzada

### Agregar Botón de Llamada Rápida

1. Ve a **Data > Columns** para Reservas
2. Añade columna virtual:

```
Column name: boton_llamar
Type: Action
Action:
  Type: External link
  URL: "tel:" & [telefon]
  Icon: phone
  Label: "Llamar"
```

### Añadir Notificaciones

1. Ve a **Automation > Bots**
2. Click en **"+ New Bot"**

```
Bot name: Notificar Nueva Reserva
Event: Reservas Add
Task: Send an email
Recipients: tu-email@example.com
Subject: Nueva Reserva - <<[nom_persona_reserva]>>
Body:
  Se ha creado una nueva reserva:
  
  Cliente: <<[nom_persona_reserva]>>
  Teléfono: <<[telefon]>>
  Fecha: <<[data_reserva]>>
  Personas: <<[num_persones]>>
  Observaciones: <<[observacions]>>
```

### Añadir Búsqueda Rápida

1. Ve a **UX > Views**
2. Selecciona la vista de lista de Reservas
3. Habilita:

```
☑ Enable search
☑ Show search box
Search fields: nom_persona_reserva, telefon
```

---

## 8️⃣ Publicar la App

### Paso 8.1: Revisar App

1. Click en el botón **"Live"** (esquina superior derecha) para probar la app
2. Verifica:
   - ✅ El calendario muestra las reservas correctamente
   - ✅ Puedes crear nuevas reservas
   - ✅ Los colores según estado funcionan
   - ✅ El formulario valida correctamente

### Paso 8.2: Deployment

1. Click en **"Manage" > "Deploy"**
2. Selecciona el tipo de deployment:
   - **Prototype**: Para pruebas (gratis)
   - **Production**: Para uso real (requiere plan de pago)

### Paso 8.3: Compartir la App

1. Ve a **"Users"**
2. Añade usuarios:
   - Por email
   - Por dominio completo (si tienes Google Workspace)
3. Asigna permisos:
   - **Admin**: Control total
   - **User**: Uso normal
   - **View Only**: Solo lectura

---

## 9️⃣ Tips y Mejores Prácticas

### 🎨 Personalización Visual

```
App colors:
  Primary: #2196F3 (Azul)
  Accent: #4CAF50 (Verde)
  Background: #FAFAFA (Gris claro)
```

### 🔒 Seguridad

- Cambia la API Key regularmente
- No compartas la API Key públicamente
- Usa permisos adecuados en AppSheet
- Activa logs en Vercel para auditoría

### ⚡ Performance

- Usa filtros para limitar datos cargados
- Habilita caché en AppSheet
- Considera paginar resultados si tienes muchas reservas

### 📱 Mobile First

- Prueba la app en dispositivos móviles
- Usa iconos claros y grandes
- Simplifica formularios para pantallas pequeñas

---

## 🆘 Troubleshooting

### Problema: "No se cargan los datos"

**Solución:**
1. Verifica que la API esté activa en Vercel
2. Comprueba el API Key en los headers
3. Revisa los logs en Vercel Dashboard
4. Verifica la conexión en AppSheet > Data > Tables

### Problema: "Error al crear reserva"

**Solución:**
1. Verifica que todos los campos obligatorios estén llenos
2. Comprueba el formato de la fecha (YYYY-MM-DD HH:MM:SS)
3. Revisa que el número de personas esté entre 1 y 20
4. Verifica los logs de la API en Vercel

### Problema: "El calendario no muestra colores"

**Solución:**
1. Verifica la expresión de color en la vista de calendario
2. Asegúrate de que el campo `status` tiene valores válidos
3. Refresca la app con el botón de sincronización

---

## 📚 Recursos Adicionales

- [Documentación oficial de AppSheet](https://help.appsheet.com/)
- [AppSheet Community](https://community.appsheet.com/)
- [Video tutoriales de AppSheet](https://www.youtube.com/appsheet)

---

## ✅ Checklist de Configuración

Usa este checklist para asegurarte de que todo está configurado:

- [ ] API desplegada en Vercel
- [ ] Variables de entorno configuradas
- [ ] App creada en AppSheet
- [ ] Conexión API configurada
- [ ] Tabla de Reservas configurada
- [ ] Operaciones CRUD funcionando
- [ ] Vista de Calendario creada
- [ ] Colores por estado configurados
- [ ] Formulario de nueva reserva personalizado
- [ ] Validaciones añadidas
- [ ] Dashboard con widgets creado
- [ ] Pruebas realizadas
- [ ] App publicada
- [ ] Usuarios añadidos

---

¡Felicidades! 🎉 Ahora tienes tu app de reservas completamente funcional con AppSheet.

