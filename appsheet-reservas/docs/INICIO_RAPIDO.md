# ⚡ Inicio Rápido - AppSheet Reservas

Guía ultra-rápida para tener tu sistema funcionando en 15 minutos.

---

## ✅ Checklist de 15 Minutos

- [ ] **3 min** - Desplegar API en Vercel
- [ ] **5 min** - Crear app en AppSheet
- [ ] **4 min** - Configurar tabla de datos
- [ ] **3 min** - Crear vista de calendario
- [ ] ✨ **¡Listo!** - App funcionando

---

## 🚀 Paso 1: Desplegar API (3 minutos)

### Opción A: Usando Vercel CLI (Recomendado)

```bash
# 1. Instalar Vercel CLI
npm install -g vercel

# 2. Ir a la carpeta
cd appsheet-reservas

# 3. Desplegar
vercel --prod
```

**Sigue las instrucciones en pantalla:**
- ¿Setup and deploy? → `Y`
- ¿Scope? → Tu cuenta
- ¿Link to project? → `N`
- ¿Project name? → `appsheet-reservas` (o el que prefieras)
- ¿Directory? → `./`
- ¿Override settings? → `N`

**Resultado:** Obtendrás una URL como:
```
https://appsheet-reservas-xyz.vercel.app
```

**¡Guarda esta URL!** La necesitarás para AppSheet.

### Opción B: Usando Vercel Dashboard

1. Ve a [vercel.com](https://vercel.com)
2. Click en **"Add New Project"**
3. Importa tu carpeta `appsheet-reservas`
4. Click en **"Deploy"**

### Configurar Variables de Entorno

En Vercel Dashboard:
1. Ve a tu proyecto → **Settings** → **Environment Variables**
2. Añade estas variables:

```
DB_HOST = db1.bwai.cc
DB_PORT = 3306
DB_USER = cronosdev
DB_PASS = )CDJ6gwpCO9rg-W/
DB_NAME = cronosai
API_KEY = appsheet-cronos-2024
```

3. Click en **"Redeploy"** para aplicar cambios

---

## 📱 Paso 2: Crear App en AppSheet (5 minutos)

### 2.1 Crear Cuenta (si no tienes)

1. Ve a [appsheet.com](https://www.appsheet.com)
2. Click en **"Get Started"**
3. Inicia sesión con Google

### 2.2 Crear Nueva App

1. Click en **"Create" → "App" → "Start with your own data"**
2. Nombre: `Reservas Restaurante`
3. Categoría: `Business`
4. Click en **"Choose your data"**

### 2.3 Conectar con tu API

1. Selecciona **"Other" → "REST API"**
2. Llena los datos:

```
Connection Name: ReservasAPI
Base URL: https://tu-proyecto.vercel.app
Authentication: Custom Headers
```

3. Añade el header:

```
Header Name: X-Api-Key
Header Value: appsheet-cronos-2024
```

4. Click en **"Test Connection"** → Debe aparecer ✅
5. Click en **"Save"**

---

## 📊 Paso 3: Configurar Tabla (4 minutos)

### 3.1 Crear Tabla desde API

1. En el editor, ve a **Data → Tables**
2. Click en **"+ New Table"**
3. Selecciona **"ReservasAPI"**
4. Configura:

```
Table Name: Reservas
Endpoint: /api/reservations
Method: GET
Key Column: id_reserva
```

5. Click en **"Add"**

### 3.2 Configurar Tipos de Columna

AppSheet detectará automáticamente la mayoría. Verifica:

| Columna | Tipo | ¿Key? |
|---------|------|-------|
| id_reserva | Number | ✅ |
| nom_persona_reserva | Text | |
| telefon | Phone | |
| data_reserva | DateTime | |
| num_persones | Number | |
| observacions | LongText | |
| status | Text | |

### 3.3 Configurar Operaciones CRUD

#### CREATE (POST)
```
Endpoint: /api/reservations
Method: POST
Body:
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
Body:
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

## 📅 Paso 4: Vista de Calendario (3 minutos)

### 4.1 Crear Vista

1. Ve a **UX → Views**
2. Click en **"+ New View"**
3. Configura:

```
View name: Calendario
View type: calendar
Primary view: Yes
For this data: Reservas
```

### 4.2 Configurar Campos del Calendario

**Start:**
```
[data_reserva]
```

**End:**
```
[data_reserva] + "02:00:00"
```

**Label:**
```
[nom_persona_reserva] & " (" & TEXT([num_persones]) & " personas)"
```

**Color:**
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

### 4.3 Guardar y Probar

1. Click en **"Save"**
2. Click en **"Live"** (arriba a la derecha)
3. ¡Deberías ver tu calendario! 🎉

---

## ✨ Paso 5: ¡Listo!

Tu app está funcionando. Ahora puedes:

### Probar la App

1. Click en el botón **"+"** para crear una reserva
2. Llena los campos:
   - **Nombre:** Tu nombre
   - **Teléfono:** +34 600 000 000
   - **Fecha y Hora:** Mañana a las 20:00
   - **Personas:** 2
3. Click en **"Save"**
4. ¡Verás tu reserva en el calendario! 📅

### Compartir la App

1. Click en **"Users"** en el menú
2. Añade usuarios por email
3. Envía el link de la app

---

## 🎨 Personalización Rápida (Opcional)

### Cambiar Colores

1. Ve a **UX → Brand**
2. Cambia:
   - **Primary Color:** `#2196F3` (Azul)
   - **Accent Color:** `#4CAF50` (Verde)

### Cambiar Ícono

1. Ve a **UX → Brand**
2. Click en **"App Icon"**
3. Sube tu logo (512x512 px)

### Añadir Logo

1. Ve a **UX → Brand**
2. Click en **"App Logo"**
3. Sube tu logo (formato PNG transparente)

---

## 🧪 Verificar que Todo Funciona

### Test 1: Crear Reserva

- [ ] Puedo crear una nueva reserva
- [ ] La reserva aparece en el calendario
- [ ] El color es correcto según el estado

### Test 2: Editar Reserva

- [ ] Puedo abrir una reserva existente
- [ ] Puedo cambiar el número de personas
- [ ] Los cambios se guardan correctamente

### Test 3: Eliminar Reserva

- [ ] Puedo eliminar una reserva
- [ ] La reserva desaparece del calendario

### Test 4: Filtros

- [ ] Puedo cambiar de mes en el calendario
- [ ] Puedo ver diferentes vistas (día/semana/mes)
- [ ] Los filtros funcionan correctamente

---

## 🐛 Problemas Comunes

### "No se cargan los datos"

**Solución:**
```bash
# Verifica que la API está activa
curl -H "X-Api-Key: appsheet-cronos-2024" https://tu-proyecto.vercel.app/api/reservations
```

Si no responde:
1. Ve a Vercel Dashboard
2. Revisa los logs
3. Verifica las variables de entorno

### "API Key inválida"

**Solución:**
1. En AppSheet: **Data → Tables → ReservasAPI**
2. Verifica el header: `X-Api-Key: appsheet-cronos-2024`
3. En Vercel: Verifica la variable `API_KEY`

### "Error al crear reserva"

**Solución:**
1. Verifica que todos los campos obligatorios estén llenos
2. El formato de fecha debe ser: `YYYY-MM-DD HH:MM:SS`
3. Número de personas debe ser entre 1 y 20

### "El calendario no muestra colores"

**Solución:**
1. Ve a **UX → Views → Calendario**
2. Verifica la expresión de **Color**
3. Copia exactamente:
```
SWITCH([status],"confirmed","#4CAF50","pending","#FFA500","cancelled","#F44336","completed","#2196F3","#808080")
```

---

## 📱 Instalar en Móvil

### iOS

1. Abre la app en Safari
2. Click en compartir (ícono de compartir)
3. "Añadir a la pantalla de inicio"
4. ¡Listo! Funciona como app nativa

### Android

1. Abre la app en Chrome
2. Click en menú (tres puntos)
3. "Añadir a la pantalla de inicio"
4. ¡Listo! Funciona como app nativa

---

## 🎓 Siguiente Nivel

Ahora que tienes lo básico funcionando, explora:

- 📚 [Guía Completa de Configuración](./APPSHEET_SETUP.md)
- 📖 [Documentación de la API](./API_DOCUMENTATION.md)
- 💡 [Ejemplos Avanzados](./EJEMPLOS.md)

---

## 🆘 ¿Necesitas Ayuda?

### Recursos

- **Documentación AppSheet:** [help.appsheet.com](https://help.appsheet.com)
- **Comunidad AppSheet:** [community.appsheet.com](https://community.appsheet.com)
- **Vercel Docs:** [vercel.com/docs](https://vercel.com/docs)

### Comandos Útiles

```bash
# Ver logs de Vercel
vercel logs

# Redesplegar
vercel --prod

# Ver información del proyecto
vercel project ls
```

---

## ✅ Checklist Final

- [ ] API desplegada en Vercel
- [ ] Variables de entorno configuradas
- [ ] App creada en AppSheet
- [ ] Conexión API funcionando
- [ ] Tabla configurada con CRUD
- [ ] Vista de calendario creada
- [ ] Colores funcionando
- [ ] Probado crear/editar/eliminar
- [ ] App compartida con usuario(s)
- [ ] Instalada en móvil (opcional)

---

## 🎉 ¡Felicitaciones!

Ya tienes tu sistema de reservas funcionando con AppSheet y calendario.

**Tiempo total:** ~15 minutos  
**Costo:** $0 (usando planes gratuitos)  
**Resultado:** Sistema profesional y funcional ✨

---

**Pro Tip:** Marca esta página para referencia rápida. 🔖

