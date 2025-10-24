# Scripts del Sistema

## 📁 Estructura de Scripts

### 🔧 **Setup** (`scripts/setup/`)
Scripts de configuración inicial del sistema:

- `configure_api_key.js` - Configuración automática de API Key
- `verify_config.js` - Verificación de configuración
- `setup_enhanced_system.js` - Configuración del sistema mejorado
- `setup_gemini_2.0.js` - Configuración de Gemini 2.0

### 📊 **Logging** (`scripts/logging/`)
Scripts para análisis y monitoreo de logs:

- `view_logs.js` - Visor de logs en tiempo real
- `analyze_logs.js` - Analizador de logs y generador de reportes
- `test_logging_system.js` - Generador de logs de prueba

### 📈 **Monitoring** (`scripts/monitoring/`)
Scripts de monitoreo del sistema:

- `monitor_system.js` - Monitoreo general del sistema

## 🚀 Uso Rápido

### Configuración Inicial
```bash
# Configurar API Key
node scripts/setup/configure_api_key.js

# Verificar configuración
node scripts/setup/verify_config.js

# Configurar sistema mejorado
node scripts/setup/setup_enhanced_system.js
```

### Análisis de Logs
```bash
# Ver resumen de llamada
node scripts/logging/view_logs.js summary +1234567890

# Monitorear en tiempo real
node scripts/logging/view_logs.js watch

# Analizar problemas
node scripts/logging/analyze_logs.js
```

### Pruebas
```bash
# Generar logs de prueba
node scripts/logging/test_logging_system.js

# Probar sistema mejorado
node tests/test_enhanced_comprehension.js
```

## 📋 Comandos Útiles

### Ver Archivos de Log
```bash
node scripts/logging/view_logs.js files
```

### Monitorear Llamada Específica
```bash
node scripts/logging/view_logs.js watch +1234567890
```

### Generar Reporte Completo
```bash
node scripts/logging/analyze_logs.js
```

## 🔧 Configuración

Todos los scripts requieren las variables de entorno configuradas en `.env`:

```bash
GOOGLE_API_KEY=tu_api_key
DB_HOST=localhost
DB_USER=usuario
DB_PASSWORD=password
DB_NAME=reservas
```

## 📞 Soporte

Para problemas con los scripts:
1. Verificar configuración con `verify_config.js`
2. Revisar logs en `./logs/`
3. Usar `analyze_logs.js` para diagnóstico
4. Contactar soporte técnico
