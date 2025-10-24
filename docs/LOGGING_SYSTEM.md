# Sistema de Logging Detallado

## 📋 Descripción

Sistema completo de logging para diagnosticar problemas en el sistema de reservas con Gemini 2.0-flash. Registra cada paso del proceso para identificar exactamente dónde y por qué falla el sistema.

## 🚀 Características

### ✅ **Logging Completo**
- **Inicio de llamadas**: Registra cada llamada entrante
- **Detección de idioma**: Rastrea cambios de idioma y confianza
- **Solicitudes a Gemini**: Registra prompts enviados
- **Respuestas de Gemini**: Almacena respuestas completas y tiempos
- **Análisis de intenciones**: Registra intenciones detectadas y confianza
- **Extracción de datos**: Rastrea datos extraídos del input
- **Transiciones de paso**: Registra cambios en el flujo
- **Generación de respuestas**: Rastrea método usado (inteligente/fallback)
- **Historial de conversación**: Almacena toda la conversación
- **Métricas de rendimiento**: Tiempos y estadísticas

### 🔍 **Detección de Problemas**
- **Errores de Gemini**: 503, 429, JSON inválido
- **Cambios de idioma**: Inestabilidad en detección
- **Fallbacks excesivos**: Uso excesivo del sistema de respaldo
- **Respuestas lentas**: Tiempos de procesamiento altos
- **Errores del sistema**: Fallos en base de datos, etc.

## 📁 Estructura de Archivos

```
├── lib/
│   └── logger.js              # Sistema de logging principal
├── logs/
│   └── detailed-YYYY-MM-DD.log # Archivos de log diarios
├── view_logs.js               # Visor de logs
├── analyze_logs.js            # Analizador de logs
└── test_logging_system.js     # Generador de logs de prueba
```

## 🛠️ Uso del Sistema

### 1. **Ver Resumen de Llamada**
```bash
node view_logs.js summary +1234567890
```
Muestra resumen completo de una llamada específica.

### 2. **Monitorear en Tiempo Real**
```bash
# Monitorear todas las llamadas
node view_logs.js watch

# Monitorear llamada específica
node view_logs.js watch +1234567890
```

### 3. **Listar Archivos de Log**
```bash
node view_logs.js files
```

### 4. **Analizar Problemas**
```bash
node analyze_logs.js
```
Genera reporte completo con estadísticas y recomendaciones.

### 5. **Generar Logs de Prueba**
```bash
node test_logging_system.js
```

## 📊 Tipos de Logs

### **CALL_START**
Registra inicio de llamada
```json
{
  "timestamp": "2025-10-24T14:13:07.620Z",
  "level": "INFO",
  "category": "CALL_START",
  "message": "Llamada iniciada desde +1234567890",
  "data": {
    "phoneNumber": "+1234567890",
    "userInput": "Hola, quiero hacer una reserva"
  }
}
```

### **LANGUAGE_DETECTION**
Registra detección de idioma
```json
{
  "timestamp": "2025-10-24T14:13:07.626Z",
  "level": "INFO",
  "category": "LANGUAGE_DETECTION",
  "message": "Idioma detectado: es (0.9)",
  "data": {
    "phoneNumber": "+1234567890",
    "detectedLang": "es",
    "confidence": 0.9,
    "method": "gemini"
  }
}
```

### **GEMINI_REQUEST**
Registra solicitudes a Gemini
```json
{
  "timestamp": "2025-10-24T14:13:07.627Z",
  "level": "INFO",
  "category": "GEMINI_REQUEST",
  "message": "Solicitud a Gemini gemini-2.0-flash-exp",
  "data": {
    "phoneNumber": "+1234567890",
    "model": "gemini-2.0-flash-exp",
    "promptLength": 1250,
    "promptPreview": "Eres un experto en análisis de intenciones..."
  }
}
```

### **GEMINI_RESPONSE**
Registra respuestas de Gemini
```json
{
  "timestamp": "2025-10-24T14:13:07.628Z",
  "level": "INFO",
  "category": "GEMINI_RESPONSE",
  "message": "Respuesta de Gemini recibida",
  "data": {
    "phoneNumber": "+1234567890",
    "responseLength": 450,
    "processingTime": 1200,
    "responsePreview": "{\"intent\": \"reservation\"...",
    "fullResponse": "{\"intent\": \"reservation\", \"confidence\": 0.85...}"
  }
}
```

### **INTENT_ANALYSIS**
Registra análisis de intenciones
```json
{
  "timestamp": "2025-10-24T14:13:07.629Z",
  "level": "INFO",
  "category": "INTENT_ANALYSIS",
  "message": "Análisis de intención completado",
  "data": {
    "phoneNumber": "+1234567890",
    "step": "greeting",
    "analysis": {
      "intent": "reservation",
      "confidence": 0.85,
      "sentiment": "positive",
      "urgency": "normal",
      "extracted_data": {"people": 4},
      "needs_clarification": false
    }
  }
}
```

### **STEP_TRANSITION**
Registra cambios de paso
```json
{
  "timestamp": "2025-10-24T14:13:07.630Z",
  "level": "INFO",
  "category": "STEP_TRANSITION",
  "message": "Transición de paso: greeting → ask_date",
  "data": {
    "phoneNumber": "+1234567890",
    "fromStep": "greeting",
    "toStep": "ask_date",
    "reason": "Datos de personas extraídos"
  }
}
```

### **FALLBACK_USAGE**
Registra uso de fallbacks
```json
{
  "timestamp": "2025-10-24T14:13:07.631Z",
  "level": "WARN",
  "category": "FALLBACK_USAGE",
  "message": "Usando fallback: Modelo sobrecargado (503)",
  "data": {
    "phoneNumber": "+1234567890",
    "reason": "Modelo sobrecargado (503)",
    "fallbackType": "getFallbackIntent"
  }
}
```

### **METRICS**
Registra métricas de rendimiento
```json
{
  "timestamp": "2025-10-24T14:13:07.632Z",
  "level": "INFO",
  "category": "METRICS",
  "message": "Métricas de la llamada",
  "data": {
    "phoneNumber": "+1234567890",
    "metrics": {
      "totalTime": 1500,
      "geminiTime": 1200,
      "intent": "reservation",
      "confidence": 0.85,
      "sentiment": "positive",
      "language": "es",
      "fallbackUsed": false
    }
  }
}
```

## 🔧 Configuración

### **Variables de Entorno**
```bash
# .env
GOOGLE_API_KEY=tu_api_key_aqui
DB_HOST=localhost
DB_USER=usuario
DB_PASSWORD=password
DB_NAME=reservas
```

### **Limpieza Automática**
Los logs se limpian automáticamente después de 7 días para evitar acumulación.

## 📈 Análisis de Problemas

### **Problemas Comunes Detectados**

1. **Errores de Gemini (503/429)**
   - Causa: API sobrecargada o límite de cuota
   - Solución: Implementar reintentos y fallbacks

2. **Cambios de Idioma Frecuentes**
   - Causa: Detección inestable
   - Solución: Mejorar prompts de detección

3. **Fallbacks Excesivos**
   - Causa: Gemini no responde correctamente
   - Solución: Optimizar prompts y configuración

4. **Respuestas Lentas**
   - Causa: Configuración subóptima de Gemini
   - Solución: Ajustar parámetros de generación

### **Indicadores de Salud**

- ✅ **Bueno**: < 5% de fallbacks, < 2s tiempo promedio
- ⚠️ **Atención**: 5-15% de fallbacks, 2-5s tiempo promedio
- ❌ **Crítico**: > 15% de fallbacks, > 5s tiempo promedio

## 🚀 Próximos Pasos

1. **Monitorear logs en producción**
2. **Identificar patrones problemáticos**
3. **Optimizar configuración según datos**
4. **Implementar alertas automáticas**
5. **Crear dashboard de monitoreo**

## 📞 Soporte

Para problemas con el sistema de logging:
1. Revisar logs en `./logs/`
2. Usar `node analyze_logs.js` para diagnóstico
3. Verificar configuración de API
4. Contactar soporte técnico

---

**Sistema de Logging v1.0** - Diagnóstico completo para sistema de reservas
