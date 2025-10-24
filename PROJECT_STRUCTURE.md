# Estructura del Proyecto - Sistema de Reservas

## 📁 Estructura Principal

```
cronosai-webhook/
├── 📁 api/                          # Endpoints de la API
│   ├── twilio-call-final.js         # Script original de Twilio
│   ├── twilio-call-gemini-2.0.js    # Script con Gemini 2.0
│   ├── twilio-call-gemini-enhanced.js # Script mejorado con logging
│   ├── twilio-call.js               # Script básico
│   └── webhook.js                   # Webhook principal
│
├── 📁 lib/                          # Librerías del sistema
│   ├── database.js                  # Conexión a base de datos
│   ├── logger.js                    # Sistema de logging
│   └── utils.js                     # Utilidades
│
├── 📁 scripts/                      # Scripts organizados
│   ├── 📁 setup/                    # Scripts de configuración
│   │   ├── configure_api_key.js     # Configuración de API
│   │   ├── verify_config.js         # Verificación de config
│   │   ├── setup_enhanced_system.js # Setup del sistema mejorado
│   │   └── setup_gemini_2.0.js      # Setup de Gemini 2.0
│   │
│   ├── 📁 logging/                  # Scripts de logging
│   │   ├── view_logs.js             # Visor de logs
│   │   ├── analyze_logs.js          # Analizador de logs
│   │   └── test_logging_system.js   # Generador de logs de prueba
│   │
│   ├── 📁 monitoring/               # Scripts de monitoreo
│   │   └── monitor_system.js        # Monitoreo general
│   │
│   └── README.md                    # Documentación de scripts
│
├── 📁 tests/                        # Pruebas del sistema
│   ├── test_enhanced_comprehension.js # Prueba del sistema mejorado
│   ├── test_gemini_2.0_system.js    # Prueba de Gemini 2.0
│   ├── test_simple_comprehension.js  # Prueba simple
│   ├── test_twilio_enhanced.js      # Prueba de Twilio mejorado
│   └── [otros archivos de prueba...]
│
├── 📁 docs/                         # Documentación
│   ├── ENHANCED_COMPREHENSION_SYSTEM.md # Sistema de comprensión
│   ├── LOGGING_SYSTEM.md            # Sistema de logging
│   ├── GEMINI_2.0_SYSTEM.md         # Sistema Gemini 2.0
│   └── [otra documentación...]
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
# 1. Configurar API Key
node scripts/setup/configure_api_key.js

# 2. Verificar configuración
node scripts/setup/verify_config.js

# 3. Configurar sistema mejorado
node scripts/setup/setup_enhanced_system.js
```

### Monitoreo y Análisis
```bash
# Ver logs en tiempo real
node scripts/logging/view_logs.js watch

# Analizar problemas
node scripts/logging/analyze_logs.js

# Ver resumen de llamada
node scripts/logging/view_logs.js summary +1234567890
```

### Pruebas
```bash
# Probar sistema mejorado
node tests/test_enhanced_comprehension.js

# Generar logs de prueba
node scripts/logging/test_logging_system.js
```

## 📋 Archivos Principales

### **API Endpoints**
- `api/twilio-call-gemini-enhanced.js` - **Script principal mejorado**
- `api/twilio-call-final.js` - Script original
- `api/twilio-call-gemini-2.0.js` - Script con Gemini 2.0

### **Sistema de Logging**
- `lib/logger.js` - Sistema de logging principal
- `scripts/logging/view_logs.js` - Visor de logs
- `scripts/logging/analyze_logs.js` - Analizador de logs

### **Configuración**
- `scripts/setup/configure_api_key.js` - Configuración de API
- `scripts/setup/verify_config.js` - Verificación de config

## 🔧 Configuración

### Variables de Entorno (`.env`)
```bash
GOOGLE_API_KEY=tu_api_key_aqui
DB_HOST=localhost
DB_USER=usuario
DB_PASSWORD=password
DB_NAME=reservas
```

### Dependencias
```bash
npm install
```

## 📊 Monitoreo

### Logs Disponibles
- **CALL_START**: Inicio de llamadas
- **LANGUAGE_DETECTION**: Detección de idioma
- **GEMINI_REQUEST**: Solicitudes a Gemini
- **GEMINI_RESPONSE**: Respuestas de Gemini
- **INTENT_ANALYSIS**: Análisis de intenciones
- **STEP_TRANSITION**: Cambios de paso
- **FALLBACK_USAGE**: Uso de fallbacks
- **METRICS**: Métricas de rendimiento

### Comandos de Monitoreo
```bash
# Ver archivos de log
node scripts/logging/view_logs.js files

# Monitorear llamada específica
node scripts/logging/view_logs.js watch +1234567890

# Generar reporte completo
node scripts/logging/analyze_logs.js
```

## 🚨 Solución de Problemas

### Problemas Comunes
1. **Errores de Gemini**: Revisar configuración de API
2. **Fallbacks excesivos**: Optimizar prompts
3. **Cambios de idioma**: Mejorar detección
4. **Respuestas lentas**: Ajustar configuración

### Diagnóstico
```bash
# Verificar configuración
node scripts/setup/verify_config.js

# Analizar logs
node scripts/logging/analyze_logs.js

# Generar logs de prueba
node scripts/logging/test_logging_system.js
```

## 📞 Soporte

Para problemas:
1. Revisar logs en `./logs/`
2. Usar `analyze_logs.js` para diagnóstico
3. Verificar configuración con `verify_config.js`
4. Contactar soporte técnico

---

**Sistema de Reservas v2.0** - Estructura organizada y sistema de logging completo
