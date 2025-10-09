# 🍽️ CronosAI Restaurant - Sistema de Reservas Web

Sistema completo de reservas online para restaurantes con integración a base de datos MySQL y interfaz moderna.

## 📋 Características

- ✅ **Formulario de reservas intuitivo** con validación en tiempo real
- ✅ **Consulta de disponibilidad** en tiempo real
- ✅ **Integración con MySQL** usando las credenciales existentes
- ✅ **Diseño responsivo** y moderno
- ✅ **Validaciones robustas** de datos
- ✅ **Confirmación de reservas** con modal elegante
- ✅ **Backend seguro** con rate limiting y logging
- ✅ **Manejo de errores** completo

## 🚀 Instalación y Configuración

### Prerrequisitos

- Node.js 18+ 
- MySQL 8.0+
- Navegador web moderno

### 1. Instalar Dependencias del Backend

```bash
cd web-reservas/backend
npm install
```

### 2. Configurar Variables de Entorno

```bash
# Copiar archivo de ejemplo
cp env.example .env

# Editar configuración
nano .env
```

### 3. Iniciar el Backend

```bash
# Desarrollo
npm run dev

# Producción
npm start
```

### 4. Abrir la Página Web

Abrir `web-reservas/index.html` en tu navegador o servir con un servidor web.

## 🏗️ Estructura del Proyecto

```
web-reservas/
├── index.html              # Página principal
├── styles.css              # Estilos CSS
├── script.js               # JavaScript del frontend
├── backend/                # Servidor Node.js
│   ├── server.js           # Servidor principal
│   ├── package.json        # Dependencias
│   ├── config/
│   │   └── database.js     # Configuración de BD
│   ├── models/
│   │   └── Reserva.js      # Modelo de datos
│   ├── routes/
│   │   └── reservas.js     # Rutas de API
│   └── logs/               # Archivos de log
└── README.md               # Este archivo
```

## 🔧 Configuración de Base de Datos

El sistema utiliza la base de datos MySQL existente con las siguientes tablas:

### Tabla `reservas`
```sql
CREATE TABLE reservas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_reserva VARCHAR(20) UNIQUE NOT NULL,
    nombre_cliente VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    fecha_reserva DATE NOT NULL,
    hora_reserva TIME NOT NULL,
    numero_personas INT NOT NULL,
    estado ENUM('pendiente', 'confirmada', 'cancelada', 'completada') DEFAULT 'pendiente',
    observaciones TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Tabla `disponibilidad_mesas`
```sql
CREATE TABLE disponibilidad_mesas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    mesas_disponibles INT NOT NULL DEFAULT 10,
    mesas_reservadas INT NOT NULL DEFAULT 0,
    capacidad_maxima INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_fecha_hora (fecha, hora)
);
```

## 🌐 API Endpoints

### Consultar Disponibilidad
```http
POST /api/reservas/disponibilidad
Content-Type: application/json

{
  "fecha": "2024-03-20",
  "personas": 4
}
```

### Crear Reserva
```http
POST /api/reservas/crear-reserva
Content-Type: application/json

{
  "nombre": "Juan Pérez",
  "telefono": "+49123456789",
  "email": "juan@ejemplo.com",
  "fecha": "2024-03-20",
  "hora": "20:00",
  "personas": 4,
  "observaciones": "Mesa cerca de la ventana"
}
```

### Cancelar Reserva
```http
POST /api/reservas/cancelar-reserva
Content-Type: application/json

{
  "numero_reserva": "RES-20240320-ABCD",
  "telefono": "+49123456789"
}
```

### Buscar Reservas
```http
POST /api/reservas/buscar-reservas
Content-Type: application/json

{
  "telefono": "+49123456789"
}
```

## 🎨 Características del Frontend

### Formulario de Reservas
- **Validación en tiempo real** de todos los campos
- **Consulta automática** de disponibilidad al cambiar fecha/personas
- **Diseño responsivo** que funciona en móviles y desktop
- **Animaciones suaves** y transiciones elegantes

### Validaciones Implementadas
- ✅ Nombre: mínimo 2 caracteres
- ✅ Teléfono: formato válido (7-20 caracteres)
- ✅ Email: formato válido (opcional)
- ✅ Fecha: no puede ser en el pasado, máximo 30 días adelante
- ✅ Hora: formato HH:MM válido
- ✅ Personas: entre 1 y 20
- ✅ Términos y condiciones: obligatorio

### Modal de Confirmación
- **Detalles completos** de la reserva
- **Número de reserva** único generado
- **Información de contacto** del restaurante
- **Diseño elegante** con animaciones

## 🔒 Seguridad

### Backend
- **Helmet.js** para headers de seguridad
- **Rate limiting** para prevenir abuso
- **Validación de entrada** con express-validator
- **CORS configurado** para dominios permitidos
- **Logging completo** de todas las operaciones

### Base de Datos
- **Transacciones** para operaciones críticas
- **Validación de disponibilidad** antes de crear reservas
- **Rollback automático** en caso de errores
- **Índices optimizados** para consultas rápidas

## 📊 Monitoreo y Logs

### Logs Automáticos
- **Requests HTTP** con detalles completos
- **Errores de base de datos** con stack traces
- **Operaciones de reservas** con timestamps
- **Métricas de rendimiento** y uso

### Archivos de Log
- `logs/error.log` - Solo errores
- `logs/combined.log` - Todos los logs
- Console - Logs en tiempo real

## 🚀 Despliegue

### Desarrollo Local
```bash
# Terminal 1: Backend
cd web-reservas/backend
npm run dev

# Terminal 2: Servidor web (opcional)
cd web-reservas
python -m http.server 8000
# O usar cualquier servidor web estático
```

### Producción
```bash
# Instalar PM2 para gestión de procesos
npm install -g pm2

# Iniciar aplicación
cd web-reservas/backend
pm2 start server.js --name "cronosai-reservas"

# Configurar auto-restart
pm2 startup
pm2 save
```

## 🧪 Testing

### Probar Endpoints
```bash
# Salud del servidor
curl http://localhost:3000/api/reservas/health

# Consultar disponibilidad
curl -X POST http://localhost:3000/api/reservas/disponibilidad \
  -H "Content-Type: application/json" \
  -d '{"fecha": "2024-03-20", "personas": 4}'

# Crear reserva
curl -X POST http://localhost:3000/api/reservas/crear-reserva \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Juan Pérez",
    "telefono": "+49123456789",
    "fecha": "2024-03-20",
    "hora": "20:00",
    "personas": 4
  }'
```

### Probar Frontend
1. Abrir `index.html` en el navegador
2. Completar el formulario de reserva
3. Verificar validaciones en tiempo real
4. Probar creación de reserva
5. Verificar modal de confirmación

## 🔧 Personalización

### Cambiar Horarios del Restaurante
Editar en `script.js`:
```javascript
const CONFIG = {
    RESTAURANT_HOURS: {
        open: '18:00',
        close: '23:00'
    }
};
```

### Modificar Validaciones
Editar en `backend/routes/reservas.js`:
```javascript
const validateReserva = [
  body('nombre').trim().isLength({ min: 2, max: 100 }),
  // ... más validaciones
];
```

### Cambiar Estilos
Editar `styles.css` para personalizar colores, fuentes y diseño.

## 📱 Responsive Design

El sistema está optimizado para:
- 📱 **Móviles** (320px+)
- 📱 **Tablets** (768px+)
- 💻 **Desktop** (1024px+)
- 🖥️ **Pantallas grandes** (1440px+)

## 🐛 Troubleshooting

### Error de Conexión a BD
```bash
# Verificar credenciales en config/database.js
# Probar conexión manual
mysql -h db1.bwai.cc -u cronosai -p cronosai
```

### Error CORS
```bash
# Verificar ALLOWED_ORIGINS en .env
# Asegurar que el frontend esté en un dominio permitido
```

### Error de Puerto
```bash
# Cambiar puerto en .env
PORT=3001
# O usar un puerto diferente
```

## 📞 Soporte

Para soporte técnico:
- 📧 Email: soporte@cronosai.com
- 📱 Teléfono: +49 30 12345678
- 🌐 Web: https://cronosai.com

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT.

---

**Desarrollado con ❤️ para CronosAI Restaurant**

*Sistema de reservas web moderno, seguro y fácil de usar*
