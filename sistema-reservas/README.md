# Sistema de Reservas Web 🍽️

Una aplicación web moderna para gestionar reservas de restaurante con formulario intuitivo y API REST.

## 📁 Estructura del Proyecto

```
sistema-reservas/
├── index.html              # Página principal con formulario
├── styles.css              # Estilos CSS modernos
├── script.js               # JavaScript con validación
├── api/
│   └── reservations.js     # API REST para procesar reservas
├── vercel.json            # Configuración de Vercel
├── package.json           # Dependencias
├── database-setup.sql     # Script SQL para configurar BD
├── env.example            # Variables de entorno
└── README.md              # Este archivo
```

## 🚀 Despliegue Rápido

### Opción 1: Desplegar directamente desde esta carpeta

```bash
cd sistema-reservas
vercel
```

### Opción 2: Desplegar desde GitHub

1. Sube el contenido de esta carpeta a GitHub
2. Conecta con Vercel desde https://vercel.com
3. ¡Listo! Tu sitio estará disponible 24/7

## 📋 Campos del Formulario

Los campos corresponden exactamente a tu base de datos:

| Campo | Tipo | Obligatorio |
|-------|------|-------------|
| `nom_persona_reserva` | varchar(100) | ✅ |
| `telefon` | varchar(16) | ✅ |
| `data_reserva` | datetime | ✅ |
| `num_persones` | int(11) | ✅ |
| `observacions` | text | ❌ |
| `conversa_completa` | text | ❌ |

## 🗄️ Configuración de Base de Datos

1. Ejecuta el script SQL:
   ```bash
   mysql -u usuario -p database_name < database-setup.sql
   ```

2. Configura las variables de entorno en Vercel:
   - `DB_HOST`: Host de tu base de datos
   - `DB_USER`: Usuario de la BD
   - `DB_PASSWORD`: Contraseña
   - `DB_NAME`: Nombre de la BD

## 🎨 Características

- ✅ Diseño moderno y responsivo
- ✅ Validación en tiempo real
- ✅ API REST integrada
- ✅ Compatible con móviles
- ✅ Disponibilidad 24/7 en Vercel
- ✅ SSL/HTTPS automático

## 📱 Preview

El formulario incluye:
- Validación de teléfono
- Selector de fecha con restricción mínima de 2 horas
- Dropdown para número de personas (1-20)
- Campos opcionales para observaciones
- Modal de confirmación con detalles

## 🔧 Desarrollo Local

```bash
# Instalar Vercel CLI
npm i -g vercel

# Ejecutar localmente
cd sistema-reservas
vercel dev
```

Abre http://localhost:3000 en tu navegador.

## 📞 API Endpoint

**POST** `/api/reservations`

Request:
```json
{
  "nom_persona_reserva": "Juan Pérez",
  "telefon": "+34 123 456 789",
  "data_reserva": "2024-01-15T20:00",
  "num_persones": "4",
  "observacions": "Mesa cerca de la ventana"
}
```

Response:
```json
{
  "success": true,
  "message": "Reserva creada exitosamente",
  "reservation": {
    "id": "RES-1A2B3C4D5E",
    ...
  }
}
```

## 🎯 Próximos Pasos

Después de desplegar, puedes:
1. Conectar tu base de datos MySQL/MariaDB
2. Configurar notificaciones por email
3. Añadir integración con calendario
4. Implementar panel de administración

## 💡 Soporte

Para más información, consulta `database-setup.sql` para la estructura completa de la BD.

---

**Desarrollado con ❤️ - Listo para producción en Vercel**
