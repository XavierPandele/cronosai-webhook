# 🎤 Integración de Google Speech-to-Text en Tiempo Real

Este documento describe la implementación de Google Cloud Speech-to-Text para mejorar la detección de idiomas y precisión de transcripción en llamadas telefónicas.

---

## ✅ Implementación Completada

### 1. **Módulo de Google Speech-to-Text Streaming**
- **Archivo**: `lib/google-speech-streaming.js`
- **Funcionalidades**:
  - Streaming recognition para procesamiento en tiempo real
  - Detección automática de idioma
  - Soporte para múltiples idiomas (español, inglés, alemán, francés, italiano, portugués)
  - Modelo optimizado para telefonía (`phone_call`)
  - Configuración para audio MULAW 8kHz (formato de Twilio)

### 2. **Endpoint de Media Streams**
- **Archivo**: `api/twilio-media-stream.js`
- **Endpoint**: `/api/twilio-media-stream`
- **Nota**: Requiere WebSocket, no funciona en Vercel serverless directamente
- **Uso**: Para implementaciones con servidor dedicado o servicios que soporten WebSocket

### 3. **Integración Híbrida en twilio-call-gemini.js**
- **Archivo**: `api/twilio-call-gemini.js`
- **Funcionalidad**: 
  - Intenta usar Google STT primero cuando está disponible
  - Fallback automático a Twilio SpeechResult
  - Mejora transcripciones con Google STT cuando hay audio disponible

### 4. **State Manager Mejorado**
- **Archivo**: `lib/state-manager.js`
- **Nuevas funciones**:
  - `updateCallStateWithTranscript()`: Actualiza estado con transcripciones de Google STT
  - `getLastTranscript()`: Obtiene la última transcripción de Google STT

---

## 🚀 Cómo Funciona

### Flujo Actual (Híbrido)

1. **Twilio Gather** captura el audio del usuario
2. **Twilio** devuelve `SpeechResult` (transcripción básica)
3. **Sistema intenta mejorar** con Google STT si está disponible:
   - Busca transcripción de Google STT en el estado
   - Si existe y tiene alta confianza, la usa
   - Si no, usa `SpeechResult` de Twilio como fallback

### Código de Integración

```javascript
// En api/twilio-call-gemini.js (línea ~908)
// Intentar obtener transcripción de Google STT primero
let userInput = '';

try {
  const { getLastTranscript } = require('../lib/state-manager');
  const googleTranscript = await getLastTranscript(CallSid);
  
  if (googleTranscript && googleTranscript.transcript) {
    userInput = googleTranscript.transcript;
    // Actualizar idioma si Google lo detectó con alta confianza
    if (googleTranscript.language && googleTranscript.confidence > 0.7) {
      state.language = googleTranscript.language;
    }
  }
} catch (error) {
  // Fallback a Twilio SpeechResult
}

// Fallback a Twilio si Google STT no está disponible
if (!userInput) {
  userInput = SpeechResult || Digits || '';
}
```

---

## 📋 Configuración

### 1. Variables de Entorno

Asegúrate de tener configurado en `.env` o en Vercel:

```bash
# Credenciales de Google Cloud
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

# Opcional: Habilitar Google STT (por defecto: usa cuando está disponible)
USE_GOOGLE_STT=true
```

### 2. Habilitar API en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto
3. Ve a **APIs & Services** > **Library**
4. Busca "Cloud Speech-to-Text API"
5. Haz clic en **Enable**

### 3. Instalar Dependencias

```bash
npm install @google-cloud/speech
# Nota: 'ws' no es necesario para el enfoque híbrido actual
```

---

## 🔧 Opciones de Implementación

### Opción 1: Enfoque Híbrido (Actual - Recomendado)

**Ventajas**:
- ✅ Funciona en Vercel serverless
- ✅ No requiere WebSocket
- ✅ Fallback automático a Twilio
- ✅ Mejora transcripciones cuando Google STT está disponible

**Cómo funciona**:
- Twilio Gather captura audio y devuelve `SpeechResult`
- Si hay RecordingUrl disponible, se puede mejorar con Google STT
- El sistema prioriza Google STT cuando está disponible

### Opción 2: Media Streams con WebSocket (Requiere Servidor Dedicado)

**Ventajas**:
- ✅ Transcripción en tiempo real
- ✅ Mejor detección de idioma
- ✅ Resultados parciales mientras el usuario habla

**Requisitos**:
- ❌ No funciona en Vercel serverless
- ✅ Requiere servidor con soporte WebSocket (Node.js, Python, etc.)
- ✅ Requiere mantener conexión WebSocket activa

**Implementación**:
1. Desplegar `api/twilio-media-stream.js` en servidor con WebSocket
2. Configurar TwiML con `<Start><Stream>` en lugar de `<Gather>`
3. El WebSocket recibirá audio en tiempo real y lo procesará con Google STT

---

## 💡 Ventajas de Google STT vs Twilio Gather

| Característica | Twilio Gather | Google Cloud STT |
|----------------|---------------|-------------------|
| **Detección de idioma** | Limitada | Automática y precisa |
| **Precisión** | Buena | Excelente |
| **Multi-idioma** | Requiere configuración | Automático |
| **Modelos** | Genérico | Optimizado para telefonía |
| **Costo** | Incluido en Twilio | ~$0.006/minuto |
| **Latencia** | Baja | Media (200-500ms) |
| **Serverless** | ✅ Sí | ⚠️ Requiere servidor para streaming |

---

## 📊 Monitoreo y Métricas

### Logs Importantes

```javascript
// Cuando se usa Google STT
logger.info('GOOGLE_STT_USED', {
  callSid,
  transcript: userInput.substring(0, 50),
  language: googleTranscript.language,
  confidence: googleTranscript.confidence
});

// Cuando falla y usa fallback
logger.warn('GOOGLE_STT_FALLBACK', {
  callSid,
  error: error.message
});
```

### Métricas a Monitorear

1. **Tasa de uso de Google STT**: ¿Cuántas llamadas usan Google STT vs Twilio?
2. **Confianza promedio**: ¿Qué nivel de confianza tiene Google STT?
3. **Detección de idioma**: ¿Qué idiomas detecta Google STT?
4. **Mejora de precisión**: ¿Google STT mejora las transcripciones?

---

## 🐛 Troubleshooting

### Google STT no se está usando

1. **Verificar credenciales**:
   ```bash
   echo $GOOGLE_APPLICATION_CREDENTIALS_JSON
   ```

2. **Verificar logs**:
   - Buscar `GOOGLE_STT_FALLBACK` en logs
   - Verificar errores de inicialización

3. **Verificar estado**:
   - Asegurarse de que `getLastTranscript()` retorna datos
   - Verificar que `updateCallStateWithTranscript()` se llama correctamente

### Transcripciones incorrectas

1. **Ajustar hints contextuales**:
   - Editar `SPEECH_CONTEXT_PHRASES` en `lib/google-speech-streaming.js`
   - Añadir palabras específicas del dominio

2. **Ajustar confianza mínima**:
   - Cambiar umbral de confianza en el código (actualmente 0.7)

3. **Verificar formato de audio**:
   - Asegurarse de que es MULAW 8kHz (formato de Twilio)

---

## 🎯 Próximos Pasos

### Mejoras Futuras

1. **Implementar Media Streams con servidor dedicado**:
   - Desplegar en servidor con WebSocket (Railway, Render, etc.)
   - Usar para transcripción en tiempo real

2. **Mejorar detección de idioma**:
   - Usar resultados parciales de Google STT para detectar idioma más rápido
   - Actualizar idioma dinámicamente durante la conversación

3. **Análisis de transcripciones**:
   - Comparar Google STT vs Twilio para medir mejora
   - Ajustar configuración según resultados

---

## 📚 Referencias

- [Google Cloud Speech-to-Text Documentation](https://cloud.google.com/speech-to-text/docs)
- [Twilio Media Streams Documentation](https://www.twilio.com/docs/voice/twiml/stream)
- [Twilio Gather Documentation](https://www.twilio.com/docs/voice/twiml/gather)

---

## ✅ Checklist de Implementación

- [x] Módulo de Google Speech-to-Text streaming creado
- [x] Endpoint de Media Streams creado (para uso futuro)
- [x] Integración híbrida en twilio-call-gemini.js
- [x] State manager actualizado
- [x] Documentación creada
- [ ] Pruebas en producción
- [ ] Monitoreo de métricas
- [ ] Ajustes según resultados

---

*Última actualización: 2025-01-XX*

