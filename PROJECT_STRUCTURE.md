# Estructura del Proyecto - Sistema de Reservas

## 📁 Estructura Principal

```
cronosai-webhook/
├── 📁 api/                          # Endpoints de la API
│   ├── twilio-call-improved.js      # 🚀 Script principal mejorado
│   ├── twilio-call.js               # Script básico
│   └── webhook.js                   # Webhook secundario
│
├── 📁 lib/                          # Librerías del sistema
│   ├── database.js                  # Conexión a base de datos MySQL
│   └── utils.js                     # Utilidades generales
│
├── 📁 scripts/                      # Scripts organizados
│   ├── create_reservation_intent.py # Scripts Python
│   ├── list_intents.py              # Listar intents
│   ├── monitoring/                  # Scripts de monitoreo
│   │   ├── monitor_system.js        # Monitoreo general
│   │   └── phone_test_monitor.js    # Monitor de pruebas
│   └── README.md                    # Documentación de scripts
│
├── 📁 tests/                        # Pruebas del sistema
│   ├── test_*.js                    # Tests JavaScript
│   └── test_*.py                    # Tests Python
│
├── 📁 docs/                         # Documentación completa
│   ├── 📁 ventas/                   # Material de ventas
│   ├── 📁 codigo/                   # Análisis de código
│   ├── 📁 deploy/                   # Guías de despliegue
│   ├── ARQUITECTURA_VISUAL.md
│   ├── EJEMPLOS_CONVERSACIONES.md
│   ├── GUIA_TWILIO.md
│   └── [más documentación...]
│
├── 📁 logs/                         # Logs del sistema
│   └── detailed-YYYY-MM-DD.log      # Logs diarios
│
├── 📁 appsheet-reservas/            # Sistema AppSheet
├── 📁 sistema-reservas/             # Sistema de reservas
├── 📁 src/                          # Código Python
├── 📁 tests/                        # Pruebas adicionales
├── 📁 voice_samples/                # Muestras de voz
├── 📁 temp/                         # Archivos temporales
│
├── 📄 package.json                  # Dependencias Node.js
├── 📄 .env                          # Variables de entorno
├── 📄 vercel.json                   # Configuración Vercel
└── 📄 README.md                     # Documentación principal
```

## 🚀 Uso Rápido

### Configuración Inicial
```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp env.example .env
# Editar .env con tus credenciales

# 3. Verificar estado del sistema
node scripts/monitoring/monitor_system.js
```

### Monitoreo y Análisis
```bash
# Monitorear estado del sistema
node scripts/monitoring/monitor_system.js

# Monitor de pruebas telefónicas en tiempo real
node scripts/monitoring/phone_test_monitor.js

# Ver logs del sistema
tail -f logs/detailed-*.log
```

### Pruebas
```bash
# Ejecutar tests
npm test

# Test específico de Twilio
node tests/test_twilio_endpoint.js
```

## 📋 Archivos Principales

### **API Endpoints**
- `api/twilio-call-improved.js` - **Script principal mejorado**
- `api/twilio-call.js` - Script básico
- `api/webhook.js` - Webhook secundario

### **Utilidades**
- `lib/database.js` - Gestión de base de datos MySQL
- `lib/utils.js` - Funciones de utilidad generales
- Scripts de monitoreo en `scripts/monitoring/`

## 🔧 Configuración

### Variables de Entorno (`.env`)
```bash
# Base de datos
DB_HOST=tu_host
DB_PORT=3306
DB_USER=tu_usuario
DB_PASS=tu_contraseña
DB_NAME=tu_base_datos

# Twilio (opcional)
TWILIO_ACCOUNT_SID=tu_sid
TWILIO_AUTH_TOKEN=tu_token
```

### Dependencias
```bash
npm install
```

## 📊 Monitoreo

Los logs se guardan automáticamente en `logs/` con el formato `detailed-YYYY-MM-DD.log`

### Comandos de Monitoreo
```bash
# Monitorear sistema
node scripts/monitoring/monitor_system.js

# Ver logs en tiempo real
tail -f logs/detailed-*.log

# Monitor de pruebas
node scripts/monitoring/phone_test_monitor.js
```

## 🚨 Solución de Problemas

### Problemas Comunes
1. **Errores de Gemini**: Revisar configuración de API
2. **Fallbacks excesivos**: Optimizar prompts
3. **Cambios de idioma**: Mejorar detección
4. **Respuestas lentas**: Ajustar configuración

### Diagnóstico
```bash
# Verificar estado del sistema
node scripts/monitoring/monitor_system.js

# Ver logs recientes
ls -lh logs/

# Monitor en tiempo real
node scripts/monitoring/phone_test_monitor.js
```

## 📞 Soporte

Para problemas:
1. Revisar logs en `logs/`
2. Ejecutar `node scripts/monitoring/monitor_system.js`
3. Ver documentación en `docs/`
4. Consultar `docs/codigo/INCONGRUENCIAS_CODIGO.md` para bugs conocidos

---

**Sistema de Reservas v2.0** - Estructura organizada y sistema de logging completo
