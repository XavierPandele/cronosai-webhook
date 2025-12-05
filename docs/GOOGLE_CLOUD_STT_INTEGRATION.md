# 🎤 Integración de Google Cloud Speech-to-Text

Este documento describe cómo usar Google Cloud Speech-to-Text directamente para mejorar la detección multi-idioma y la precisión de transcripción.

---

## ✅ Implementación Completada

### 1. **Módulo de Google Cloud Speech-to-Text**
- **Archivo**: `lib/google-speech.js`
- **Funcionalidades**:
  - Detección automática de idioma desde audio
  - Soporte para múltiples idiomas (español, inglés, alemán, francés, italiano, portugués)
  - Frases contextuales para mejorar precisión
  - Modelo optimizado para telefonía (`phone_call`)
  - Procesamiento desde Buffer, base64 o URL

### 2. **Endpoint de API**
- **Archivo**: `api/speech-to-text.js`
- **Endpoint**: `/api/speech-to-text`
- **Método**: POST
- **Uso**: Procesar audio directamente con Google Cloud STT

### 3. **Función Helper de Mejora**
- **Archivo**: `api/twilio-call-gemini.js`
- **Función**: `enhanceTranscriptionWithGoogleSTT()`
- **Uso**: Mejorar transcripciones cuando hay audio disponible

---

## 🚀 Uso Básico

### Opción 1: Endpoint Directo

```javascript
// POST /api/speech-to-text
{
  "audioUrl": "https://api.twilio.com/.../Recordings/...",
  "encoding": "MULAW",
  "sampleRateHertz": 8000,
  "hints": ["reservar mesa", "fecha", "hora"]
}

// Respuesta:
{
  "success": true,
  "transcript": "Quisiera reservar una mesa para cuatro personas",
  "language": "es",
  "googleLanguageCode": "es-ES",
  "confidence": 0.95,
  "alternatives": [...],
  "processingTime": 1234
}
```

### Opción 2: Función Helper en el Flujo

```javascript
// En api/twilio-call-gemini.js
const enhanced = await enhanceTranscriptionWithGoogleSTT(
  audioUrl,
  currentTwilioTranscript,
  { step: 'ask_people', language: 'es' }
);

if (enhanced.improved) {
  userInput = enhanced.transcript;
  state.language = enhanced.language;
}
```

---

## 📋 Configuración Requerida

### 1. Variables de Entorno

Asegúrate de tener configurado en `.env`:

```bash
# Credenciales de Google Cloud (una de estas opciones)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}
# O
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

### 2. Instalar Dependencias

```bash
npm install @google-cloud/speech
```

### 3. Habilitar API en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto
3. Ve a **APIs & Services** > **Library**
4. Busca "Cloud Speech-to-Text API"
5. Haz clic en **Enable**

---

## 🔧 Integración Completa con Twilio Media Streams

Para usar Google Cloud STT directamente desde el audio en tiempo real, necesitas implementar Twilio Media Streams:

### Paso 1: Crear Endpoint de Media Streams

```javascript
// api/twilio-media-stream.js
const WebSocket = require('ws');
const { transcribeAudioWithLanguageDetection } = require('../lib/google-speech');

module.exports = async function handler(req, res) {
  // Twilio Media Streams usa WebSocket
  // Ver documentación: https://www.twilio.com/docs/voice/twiml/stream
};
```

### Paso 2: Configurar TwiML con Media Streams

```xml
<Response>
  <Start>
    <Stream url="wss://tu-dominio.com/api/twilio-media-stream" />
  </Start>
  <Say>Hola, bienvenido...</Say>
  <Gather input="speech" ... />
</Response>
```

### Paso 3: Procesar Audio en Tiempo Real

El WebSocket recibirá chunks de audio que puedes enviar a Google Cloud STT usando streaming recognition.

---

## 💡 Ventajas de Google Cloud STT

### Comparado con Twilio Gather:

| Característica | Twilio Gather | Google Cloud STT |
|----------------|---------------|-------------------|
| **Detección de idioma** | Limitada | Automática y precisa |
| **Precisión** | Buena | Excelente |
| **Multi-idioma** | Requiere configuración | Automático |
| **Modelos** | Genérico | Optimizado para telefonía |
| **Costo** | Incluido | ~$0.006 por 15 segundos |
| **Latencia** | Baja | Media |

### Mejoras Esperadas:

- ✅ **+30-40% precisión** en transcripción
- ✅ **Detección automática de idioma** desde audio (no texto)
- ✅ **Mejor manejo de acentos** y dialectos
- ✅ **Menos falsos positivos** entre idiomas similares (español/portugués)

---

## 🎯 Casos de Uso Recomendados

### Usar Google Cloud STT cuando:

1. **Detección inicial de idioma**: En los primeros segundos de la llamada
2. **Baja confianza de Twilio**: Cuando `SpeechResult` parece incorrecto
3. **Idiomas similares**: Para distinguir español/portugués, alemán/holandés
4. **Audio de alta calidad**: Cuando tienes acceso a grabaciones completas
5. **Análisis post-llamada**: Para mejorar transcripciones guardadas

### Usar Twilio Gather cuando:

1. **Latencia crítica**: Necesitas respuesta inmediata
2. **Costo es prioridad**: Quieres evitar costos adicionales
3. **Transcripción básica**: El contexto es suficiente para entender

---

## 📊 Monitoreo y Métricas

### Logs Disponibles:

```javascript
// Inicialización
GOOGLE_SPEECH_INIT

// Procesamiento
GOOGLE_SPEECH_RECOGNIZE_START
GOOGLE_SPEECH_RECOGNIZE_SUCCESS
GOOGLE_SPEECH_RECOGNIZE_FAILED

// Comparación con Twilio
GOOGLE_STT_COMPARISON
GOOGLE_STT_ENHANCE_FAILED
```

### Métricas a Monitorear:

1. **Tasa de éxito**: % de transcripciones exitosas
2. **Confianza promedio**: Nivel de confianza de las transcripciones
3. **Detección de idioma**: Precisión de detección automática
4. **Tiempo de procesamiento**: Latencia agregada
5. **Costo**: Uso de la API de Google Cloud

---

## 🔍 Troubleshooting

### Error: "Credentials not found"

**Solución**: Verifica que `GOOGLE_APPLICATION_CREDENTIALS_JSON` esté configurado correctamente en `.env`

### Error: "API not enabled"

**Solución**: Habilita Cloud Speech-to-Text API en Google Cloud Console

### Baja confianza en transcripciones

**Solución**: 
- Verifica el formato de audio (encoding, sample rate)
- Añade más hints contextuales
- Usa modelo `phone_call` para telefonía

### Latencia alta

**Solución**:
- Usa Google Cloud STT solo cuando sea necesario
- Considera usar streaming recognition para tiempo real
- Cachea resultados cuando sea posible

---

## 💰 Estimación de Costos

### Precios de Google Cloud Speech-to-Text:

- **Standard**: $0.006 por 15 segundos
- **Enhanced**: $0.009 por 15 segundos (modelo mejorado)

### Ejemplo de Costo Mensual:

- 1000 llamadas/mes
- Promedio 2 minutos de audio por llamada
- = 8000 minutos = 32,000 segmentos de 15 segundos
- Costo: 32,000 × $0.006 = **$192/mes**

### Optimización:

- Usar solo para detección inicial de idioma (primeros 15-30 segundos)
- Reducir costo a ~$24-48/mes

---

## 📚 Referencias

- [Google Cloud Speech-to-Text Docs](https://cloud.google.com/speech-to-text/docs)
- [Twilio Media Streams](https://www.twilio.com/docs/voice/twiml/stream)
- [Multi-language Detection](https://cloud.google.com/speech-to-text/docs/multiple-languages)

---

**Última actualización**: Enero 2025

