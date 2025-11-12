# Guía de Migración a Vertex AI

## 📋 Índice

1. [Introducción](#introducción)
2. [Ventajas de usar Vertex AI](#ventajas-de-usar-vertex-ai)
3. [Requisitos Previos](#requisitos-previos)
4. [Paso 1: Habilitar Vertex AI API](#paso-1-habilitar-vertex-ai-api)
5. [Paso 2: Configurar Service Account](#paso-2-configurar-service-account)
6. [Paso 3: Instalar Dependencias](#paso-3-instalar-dependencias)
7. [Paso 4: Migrar Text-to-Speech (TTS) a Vertex AI](#paso-4-migrar-text-to-speech-tts-a-vertex-ai)
8. [Paso 5: Migrar Gemini a Vertex AI](#paso-5-migrar-gemini-a-vertex-ai)
9. [Paso 6: Actualizar Variables de Entorno](#paso-6-actualizar-variables-de-entorno)
10. [Paso 7: Probar la Migración](#paso-7-probar-la-migración)
11. [Troubleshooting](#troubleshooting)
12. [Referencias](#referencias)

---

## Introducción

Esta guía explica cómo migrar tu aplicación de la API estándar de Google (Gemini API y Text-to-Speech API) a **Vertex AI**, la plataforma unificada de Google Cloud para servicios de IA.

### ¿Por qué migrar a Vertex AI?

- ✅ **Unificación**: Un solo proyecto y credenciales para Gemini y TTS
- ✅ **Voz Algieba**: Permite usar `gemini-2.5-pro-tts` (requiere Vertex AI)
- ✅ **Mejor rendimiento**: Latencia optimizada y mejor throughput
- ✅ **Mayor control**: Configuraciones avanzadas y versiones de modelos
- ✅ **Facturación unificada**: Todo en una sola plataforma
- ✅ **Service Account**: Ya estás usando Service Account, perfecto para Vertex AI

---

## Ventajas de usar Vertex AI

### Comparación: API Estándar vs Vertex AI

| Característica | API Estándar | Vertex AI |
|----------------|--------------|-----------|
| **Autenticación** | API Key | Service Account (más seguro) |
| **Voz Algieba** | ❌ No disponible | ✅ Disponible con `gemini-2.5-pro-tts` |
| **Modelos Gemini** | Limitados | Todos los modelos disponibles |
| **Control** | Básico | Avanzado (versiones, configuraciones) |
| **Facturación** | Separada | Unificada |
| **Regiones** | Limitadas | Múltiples regiones |

---

## Requisitos Previos

Antes de comenzar, asegúrate de tener:

1. ✅ **Cuenta de Google Cloud** activa
2. ✅ **Proyecto de Google Cloud** creado (ej: `cronosai-473114`)
3. ✅ **Service Account** creado con credenciales JSON
4. ✅ **Facturación activada** en el proyecto
5. ✅ **Permisos de administrador** en el proyecto

---

## Paso 1: Habilitar Vertex AI API

### 1.1 Acceder a Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto (ej: `cronosai-473114`)
3. Asegúrate de que la facturación esté activada

### 1.2 Habilitar Vertex AI API

1. Ve a **APIs & Services** > **Library**
2. Busca **"Vertex AI API"** o **"AI Platform API"**
3. Haz clic en **"Enable"** (Habilitar)
4. Espera 2-3 minutos para que se propague

**URL directa:**
```
https://console.cloud.google.com/apis/library/aiplatform.googleapis.com?project=TU_PROJECT_ID
```

### 1.3 Verificar habilitación

1. Ve a **APIs & Services** > **Enabled APIs**
2. Verifica que **"Vertex AI API"** esté en la lista
3. Verifica que **"Cloud Text-to-Speech API"** también esté habilitada

### 1.4 Verificar región

Vertex AI requiere especificar una región. Las regiones disponibles incluyen:

- `us-central1` (Iowa, USA) - **Recomendada**
- `us-east1` (South Carolina, USA)
- `europe-west1` (Belgium)
- `asia-southeast1` (Singapore)

**Nota:** Algunos modelos pueden no estar disponibles en todas las regiones. `us-central1` suele tener la mejor disponibilidad.

---

## Paso 2: Configurar Service Account

### 2.1 Verificar Service Account existente

Si ya tienes un Service Account configurado (como `tts-service-account@cronosai-473114.iam.gserviceaccount.com`), puedes usarlo. Si no, créalo:

1. Ve a **IAM & Admin** > **Service Accounts**
2. Haz clic en **"Create Service Account"**
3. Nombre: `vertex-ai-service-account`
4. Descripción: `Service Account para Vertex AI (Gemini y TTS)`
5. Haz clic en **"Create and Continue"**

### 2.2 Asignar roles necesarios

Asigna los siguientes roles al Service Account:

1. **Vertex AI User** (`roles/aiplatform.user`)
   - Necesario para usar Gemini en Vertex AI

2. **Cloud Text-to-Speech API User** (`roles/cloudtts.user`)
   - Necesario para usar Text-to-Speech

3. **Service Account User** (`roles/iam.serviceAccountUser`)
   - Necesario para que el Service Account se use a sí mismo

**Pasos:**
1. En la página del Service Account, ve a **"Permissions"** (Permisos)
2. Haz clic en **"Grant Access"** (Conceder acceso)
3. Añade los roles mencionados arriba
4. Haz clic en **"Save"**

### 2.3 Crear y descargar credenciales JSON

1. En la página del Service Account, ve a **"Keys"** (Claves)
2. Haz clic en **"Add Key"** > **"Create new key"**
3. Selecciona **JSON**
4. Haz clic en **"Create"**
5. Se descargará un archivo JSON con las credenciales

**⚠️ Importante:** Guarda este archivo de forma segura. No lo subas a Git.

### 2.4 Verificar credenciales

El archivo JSON debe contener:
```json
{
  "type": "service_account",
  "project_id": "cronosai-473114",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "vertex-ai-service-account@cronosai-473114.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

---

## Paso 3: Instalar Dependencias

### 3.1 Instalar SDK de Vertex AI

```bash
npm install @google-cloud/aiplatform
```

### 3.2 Verificar dependencias existentes

Ya deberías tener instaladas:
- `google-auth-library` (para autenticación)
- `@google-cloud/text-to-speech` (opcional, ya no lo usaremos directamente)

### 3.3 Actualizar package.json

Verifica que `package.json` incluya:

```json
{
  "dependencies": {
    "@google-cloud/aiplatform": "^1.0.0",
    "google-auth-library": "^9.0.0",
    "@google/generative-ai": "^0.24.1"
  }
}
```

**Nota:** Puedes mantener `@google/generative-ai` durante la migración, pero eventualmente puedes eliminarlo.

---

## Paso 4: Migrar Text-to-Speech (TTS) a Vertex AI

### 4.1 Actualizar `api/tts.js`

Cambia el código para usar Vertex AI en lugar de la API estándar:

#### Antes (API Estándar):
```javascript
const url = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify(requestBody)
});
```

#### Después (Vertex AI):
```javascript
const { VertexAI } = require('@google-cloud/aiplatform');
const { GoogleAuth } = require('google-auth-library');

// Configurar Vertex AI
const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'cronosai-473114';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Usar Vertex AI endpoint para TTS
const url = `https://${LOCATION}-texttospeech.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}:synthesizeSpeech`;
```

### 4.2 Cambiar modelo a `gemini-2.5-pro-tts`

Actualiza la configuración de la voz:

```javascript
const VOICE_NAME = 'Algieba';
const MODEL_NAME = 'gemini-2.5-pro-tts'; // Requiere Vertex AI
```

### 4.3 Código completo actualizado

```javascript
/**
 * API endpoint para generar audio usando Vertex AI Text-to-Speech
 * Usa la voz Algieba con el modelo gemini-2.5-pro-tts
 * REQUIERE: Vertex AI API habilitada
 */

const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();

// Configuración de Vertex AI
const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'cronosai-473114';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

// Mapeo de idiomas
const languageCodes = {
  es: 'es-es',
  en: 'en-us',
  de: 'de-de',
  it: 'it-it',
  fr: 'fr-fr',
  pt: 'pt-br'
};

// Configuración de la voz Algieba
const VOICE_NAME = 'Algieba';
const MODEL_NAME = 'gemini-2.5-pro-tts'; // Requiere Vertex AI

// Cache
const audioCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

// Cliente de autenticación
let authClient = null;

async function getAccessToken() {
  if (!authClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        throw new Error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurada.');
      }

      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;

      authClient = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      
      console.log(`✅ [TTS] Cliente de autenticación inicializado: ${credentials.client_email}`);
    } catch (error) {
      console.error('❌ [TTS] Error inicializando cliente:', error);
      throw error;
    }
  }
  
  const client = await authClient.getClient();
  const accessTokenResponse = await client.getAccessToken();
  
  if (!accessTokenResponse.token) {
    throw new Error('❌ No se pudo obtener el token de acceso');
  }
  
  return accessTokenResponse.token;
}

async function generateAudioWithVertexAI(text, language = 'es') {
  const languageCode = languageCodes[language] || languageCodes.es;
  const hash = crypto.createHash('md5').update(`${text}-${languageCode}`).digest('hex');
  
  // Verificar cache
  const cached = audioCache.get(hash);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    console.log(`✅ [TTS] Cache hit para hash: ${hash.substring(0, 8)}...`);
    return { audio: cached.audio, hash };
  }

  try {
    const accessToken = await getAccessToken();
    
    console.log(`🎤 [TTS] Generando audio con Vertex AI: "${text.substring(0, 50)}..." (${languageCode})`);

    // Endpoint de Vertex AI para TTS
    const url = `https://${LOCATION}-texttospeech.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}:synthesizeSpeech`;

    const requestBody = {
      audioConfig: {
        audioEncoding: 'MP3',
        pitch: 0,
        speakingRate: 1,
        sampleRateHertz: 24000
      },
      input: {
        text: text
      },
      voice: {
        languageCode: languageCode,
        name: VOICE_NAME,
        modelName: MODEL_NAME // gemini-2.5-pro-tts (requiere Vertex AI)
      }
    };

    console.log(`🔍 [TTS] Vertex AI Request:`, {
      projectId: PROJECT_ID,
      location: LOCATION,
      languageCode: languageCode,
      voiceName: VOICE_NAME,
      modelName: MODEL_NAME,
      url: url
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [TTS] Error en Vertex AI: ${response.status} - ${errorText}`);
      throw new Error(`Error en Vertex AI TTS: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.audioContent) {
      throw new Error('No se recibió audioContent en la respuesta');
    }

    const audioBuffer = Buffer.from(data.audioContent, 'base64');

    // Guardar en cache
    audioCache.set(hash, {
      audio: audioBuffer,
      timestamp: Date.now(),
      language: languageCode,
      text: text.substring(0, 100)
    });

    console.log(`✅ [TTS] Audio generado exitosamente con Vertex AI (${audioBuffer.length} bytes)`);

    return { audio: audioBuffer, hash };
  } catch (error) {
    console.error('❌ [TTS] Error generando audio con Vertex AI:', error);
    throw error;
  }
}

module.exports = async function handler(req, res) {
  const { method, query, body } = req;
  
  if (method === 'GET') {
    try {
      const { hash, text, language = 'es' } = query;
      
      if (!hash && !text) {
        return res.status(400).json({ error: 'Hash or text is required' });
      }
      
      let audioData;
      
      if (hash) {
        const cached = audioCache.get(hash);
        if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
          audioData = { audio: cached.audio, hash };
        } else {
          return res.status(404).json({ error: 'Audio not found in cache' });
        }
      } else if (text) {
        audioData = await generateAudioWithVertexAI(decodeURIComponent(text), language);
      }
      
      if (!audioData || !audioData.audio) {
        return res.status(500).json({ error: 'Failed to generate audio' });
      }
      
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);
      res.setHeader('X-Vertex-AI', 'true');
      
      return res.status(200).send(audioData.audio);
    } catch (error) {
      console.error('❌ [TTS] Error en GET endpoint:', error);
      return res.status(500).json({ 
        error: 'Error retrieving audio',
        message: error.message 
      });
    }
  }
  
  if (method === 'POST') {
    try {
      const { text, language = 'es' } = body;

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text is required' });
      }

      if (text.length > 5000) {
        return res.status(400).json({ error: 'Text too long (max 5000 characters)' });
      }

      const audioData = await generateAudioWithVertexAI(text, language);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioData.audio.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Audio-Hash', audioData.hash);
      res.setHeader('X-Audio-Language', language);
      res.setHeader('X-Voice-Name', VOICE_NAME);
      res.setHeader('X-Model-Name', MODEL_NAME);
      res.setHeader('X-Vertex-AI', 'true');

      return res.status(200).send(audioData.audio);
    } catch (error) {
      console.error('❌ [TTS] Error en POST endpoint:', error);
      return res.status(500).json({ 
        error: 'Error generating audio',
        message: error.message 
      });
    }
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
};
```

---

## Paso 5: Migrar Gemini a Vertex AI

### 5.1 Actualizar `api/twilio-call-gemini.js`

Cambia el código para usar Vertex AI en lugar de la API estándar de Gemini:

#### Antes (API Estándar):
```javascript
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiClient() {
  if (!geminiClient) {
    const apiKey = process.env.GOOGLE_API_KEY;
    geminiClient = new GoogleGenerativeAI(apiKey);
  }
  return geminiClient;
}

const model = client.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
```

#### Después (Vertex AI):
```javascript
const { VertexAI } = require('@google-cloud/aiplatform');
const { GoogleAuth } = require('google-auth-library');

// Configuración de Vertex AI
const PROJECT_ID = process.env.VERTEX_AI_PROJECT_ID || 'cronosai-473114';
const LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';

let geminiClient = null;

function getGeminiClient() {
  if (!geminiClient) {
    try {
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      
      if (!credentialsJson) {
        throw new Error('❌ GOOGLE_APPLICATION_CREDENTIALS_JSON no está configurada.');
      }

      const credentials = typeof credentialsJson === 'string' 
        ? JSON.parse(credentialsJson) 
        : credentialsJson;

      const auth = new GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });

      geminiClient = new VertexAI({
        project: PROJECT_ID,
        location: LOCATION,
        googleAuthOptions: {
          credentials: credentials
        }
      });
      
      console.log(`✅ [Gemini] Cliente de Vertex AI inicializado: ${PROJECT_ID}/${LOCATION}`);
    } catch (error) {
      console.error('❌ [Gemini] Error inicializando cliente de Vertex AI:', error);
      throw error;
    }
  }
  return geminiClient;
}

// Usar Vertex AI para Gemini
const model = geminiClient.preview.getGenerativeModel({
  model: 'gemini-2.5-flash-lite'
});
```

### 5.2 Actualizar función `callGeminiWithRetry`

```javascript
async function callGeminiWithRetry(model, prompt, retries = 5, logger = null) {
  let lastError = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      // Vertex AI usa un formato diferente
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
      });
      
      if (i > 0 && logger) {
        logger.debug('GEMINI_RETRY_SUCCESS', {
          attempt: i + 1,
          totalAttempts: i + 1,
          reasoning: `Llamada exitosa después de ${i} reintentos.`
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      const errorMessage = error.message || String(error);
      const isRateLimit = errorMessage.includes('429') ||
                         errorMessage.includes('Resource exhausted') ||
                         errorMessage.includes('overloaded');
      const isTemporary = errorMessage.includes('503') ||
                         errorMessage.includes('Service Unavailable') ||
                         errorMessage.includes('temporarily unavailable');
      
      if (isRateLimit || isTemporary) {
        const baseDelay = 1000;
        const wait = Math.min(baseDelay * Math.pow(2, i), 10000);
        
        if (logger) {
          logger.warn('GEMINI_RETRY_ATTEMPT', {
            attempt: i + 1,
            maxRetries: retries,
            waitMs: wait,
            error: errorMessage.substring(0, 100),
            reasoning: `Rate limit detectado en Vertex AI. Esperando ${wait}ms antes del reintento.`
          });
        }
        
        await new Promise(resolve => setTimeout(resolve, wait));
        continue;
      } else {
        if (logger) {
          logger.error('GEMINI_NON_RETRYABLE_ERROR', {
            error: errorMessage,
            stack: error.stack,
            reasoning: 'Error no relacionado con rate limiting. No se reintentará.'
          });
        }
        throw error;
      }
    }
  }
  
  const errorMsg = `Vertex AI Gemini overloaded after ${retries} retries. Last error: ${lastError?.message || 'Unknown error'}.`;
  if (logger) {
    logger.error('GEMINI_RETRY_EXHAUSTED', {
      retries,
      lastError: lastError?.message,
      reasoning: `Todos los reintentos fallaron en Vertex AI. Verificar que Vertex AI API esté habilitada.`
    });
  }
  throw new Error(errorMsg);
}
```

### 5.3 Actualizar función `analyzeReservationWithGemini`

```javascript
async function analyzeReservationWithGemini(userInput, context = {}) {
  const geminiLogger = logger.child({ 
    function: 'analyzeReservationWithGemini',
    callSid: context.callSid || 'unknown'
  });

  try {
    const client = getGeminiClient();
    if (!client) {
      geminiLogger.warn('⚠️ GEMINI_CLIENT_NOT_AVAILABLE', {
        reasoning: 'Cliente de Vertex AI no disponible. Verificar GOOGLE_APPLICATION_CREDENTIALS_JSON.'
      });
      return null;
    }

    // Usar Vertex AI para Gemini
    const model = client.preview.getGenerativeModel({
      model: 'gemini-2.5-flash-lite'
    });

    geminiLogger.debug('🤖 GEMINI_MODEL_INITIALIZED', { 
      model: 'gemini-2.5-flash-lite',
      platform: 'Vertex AI',
      projectId: PROJECT_ID,
      location: LOCATION,
      reasoning: 'Modelo de Gemini 2.5 Flash Lite inicializado en Vertex AI.'
    });
    
    // ... resto del código de construcción del prompt ...
    
    // Llamar a Vertex AI
    const result = await callGeminiWithRetry(model, prompt, 5, geminiLogger);
    
    // Procesar respuesta (formato puede ser ligeramente diferente)
    const response = await result.response;
    const responseText = response.text();
    
    // ... resto del código de procesamiento ...
    
  } catch (error) {
    geminiLogger.error('GEMINI_ANALYSIS_ERROR', {
      error: error.message,
      stack: error.stack,
      reasoning: 'Error en análisis de reserva con Vertex AI Gemini.'
    });
    return null;
  }
}
```

### 5.4 Notas importantes sobre Vertex AI

1. **Formato de request**: Vertex AI puede usar un formato ligeramente diferente para las requests
2. **Respuestas**: Las respuestas pueden tener una estructura diferente
3. **Modelos disponibles**: Verifica qué modelos están disponibles en tu región
4. **Límites**: Los límites de rate limiting pueden ser diferentes

---

## Paso 6: Actualizar Variables de Entorno

### 6.1 Actualizar `.env` local

```bash
# Vertex AI Configuration
VERTEX_AI_PROJECT_ID=cronosai-473114
VERTEX_AI_LOCATION=us-central1

# Service Account (ya configurado)
GOOGLE_APPLICATION_CREDENTIALS_JSON={"type":"service_account",...}

# Opcional: Eliminar GOOGLE_API_KEY (ya no necesario)
# GOOGLE_API_KEY=... (puedes eliminarlo)
```

### 6.2 Actualizar variables en Vercel

1. Ve a tu proyecto en Vercel
2. Ve a **Settings** > **Environment Variables**
3. Añade las siguientes variables:

```
VERTEX_AI_PROJECT_ID=cronosai-473114
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS_JSON=<contenido completo del JSON>
```

4. **Opcional**: Elimina `GOOGLE_API_KEY` si ya no la necesitas

### 6.3 Verificar variables

Asegúrate de que todas las variables estén configuradas correctamente:

```javascript
// Verificar en el código
console.log('Vertex AI Config:', {
  projectId: process.env.VERTEX_AI_PROJECT_ID,
  location: process.env.VERTEX_AI_LOCATION,
  hasCredentials: !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
});
```

---

## Paso 7: Probar la Migración

### 7.1 Probar TTS con Vertex AI

```bash
# Probar endpoint TTS
curl -X GET "http://localhost:3000/api/tts?text=Hola%20mundo&language=es"
```

**Verifica:**
- ✅ Respuesta 200 OK
- ✅ Header `X-Vertex-AI: true`
- ✅ Header `X-Model-Name: gemini-2.5-pro-tts`
- ✅ Audio MP3 válido

### 7.2 Probar Gemini con Vertex AI

```bash
# Probar endpoint de Gemini
curl -X POST "http://localhost:3000/api/twilio-call-gemini" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=test123&From=+34602643862&CallStatus=ringing"
```

**Verifica:**
- ✅ Respuesta TwiML válida
- ✅ Logs muestran "Vertex AI" en lugar de "API estándar"
- ✅ Respuestas de Gemini funcionan correctamente

### 7.3 Probar llamada completa

1. Haz una llamada real a tu número de Twilio
2. Verifica que:
   - ✅ La voz Algieba funciona correctamente
   - ✅ Gemini procesa las respuestas correctamente
   - ✅ No hay errores en los logs

### 7.4 Verificar logs

Busca en los logs:
- ✅ `✅ [TTS] Cliente de autenticación inicializado`
- ✅ `✅ [Gemini] Cliente de Vertex AI inicializado`
- ✅ `🔍 [TTS] Vertex AI Request`
- ✅ `🤖 GEMINI_MODEL_INITIALIZED` con `platform: 'Vertex AI'`

---

## Troubleshooting

### Error: "Vertex AI API has not been used in project"

**Solución:**
1. Ve a Google Cloud Console
2. Habilita **Vertex AI API**
3. Espera 2-3 minutos para que se propague
4. Vuelve a intentar

### Error: "PERMISSION_DENIED"

**Solución:**
1. Verifica que el Service Account tenga los roles necesarios:
   - `roles/aiplatform.user`
   - `roles/cloudtts.user`
2. Verifica que las credenciales JSON sean correctas
3. Verifica que el proyecto ID sea correcto

### Error: "Model not found"

**Solución:**
1. Verifica que el modelo esté disponible en tu región
2. Algunos modelos pueden no estar disponibles en todas las regiones
3. Prueba con `us-central1` que suele tener la mejor disponibilidad

### Error: "INVALID_ARGUMENT: This voice requires a model name to be specified"

**Solución:**
1. Verifica que estés usando `gemini-2.5-pro-tts` (no `gemini-2.5-flash-tts`)
2. Verifica que Vertex AI API esté habilitada
3. Verifica que estés usando el endpoint correcto de Vertex AI

### Error: "UNAUTHENTICATED"

**Solución:**
1. Verifica que `GOOGLE_APPLICATION_CREDENTIALS_JSON` esté configurada
2. Verifica que el JSON sea válido
3. Verifica que el Service Account exista y esté activo

### Error: "Resource exhausted" o "429 Too Many Requests"

**Solución:**
1. Vertex AI puede tener límites diferentes que la API estándar
2. El código de retry debería manejar esto automáticamente
3. Si persiste, verifica los límites de cuota en Google Cloud Console

### La voz Algieba no suena bien

**Solución:**
1. Verifica que estés usando `gemini-2.5-pro-tts` (no otro modelo)
2. Verifica que el código de idioma sea correcto (ej: `es-es`, no `es-ES`)
3. Prueba con diferentes textos para verificar la calidad

---

## Referencias

### Documentación Oficial

- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Vertex AI Text-to-Speech](https://cloud.google.com/vertex-ai/docs/generative-ai/text-to-speech)
- [Vertex AI Gemini](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
- [Service Accounts](https://cloud.google.com/iam/docs/service-accounts)

### SDKs y Librerías

- [@google-cloud/aiplatform Node.js SDK](https://www.npmjs.com/package/@google-cloud/aiplatform)
- [google-auth-library](https://www.npmjs.com/package/google-auth-library)

### Guías de Migración

- [Migrating from Generative AI API to Vertex AI](https://cloud.google.com/vertex-ai/docs/generative-ai/migrate-from-ga)
- [Vertex AI Authentication](https://cloud.google.com/vertex-ai/docs/generative-ai/authentication)

### Recursos Adicionales

- [Vertex AI Pricing](https://cloud.google.com/vertex-ai/pricing)
- [Vertex AI Regions](https://cloud.google.com/vertex-ai/docs/general/locations)
- [Vertex AI Quotas](https://cloud.google.com/vertex-ai/docs/generative-ai/quotas)

---

## Resumen

### ✅ Checklist de Migración

- [ ] Vertex AI API habilitada
- [ ] Service Account configurado con roles necesarios
- [ ] Credenciales JSON descargadas y configuradas
- [ ] Dependencias instaladas (`@google-cloud/aiplatform`)
- [ ] Código de TTS actualizado para Vertex AI
- [ ] Código de Gemini actualizado para Vertex AI
- [ ] Variables de entorno actualizadas
- [ ] Pruebas realizadas y funcionando
- [ ] Logs verificados
- [ ] Despliegue en Vercel realizado

### 🎯 Resultado Esperado

Después de completar esta migración:

- ✅ **Voz Algieba** funcionando con `gemini-2.5-pro-tts`
- ✅ **Gemini** funcionando con Vertex AI
- ✅ **Service Account** para autenticación (más seguro)
- ✅ **Unificación** de servicios en Vertex AI
- ✅ **Mejor rendimiento** y control
- ✅ **Facturación unificada**

### 📞 Soporte

Si encuentras problemas durante la migración:

1. Revisa la sección [Troubleshooting](#troubleshooting)
2. Verifica los logs en Vercel
3. Consulta la documentación oficial de Vertex AI
4. Verifica los permisos del Service Account en Google Cloud Console

---

**¡Feliz migración a Vertex AI! 🚀**

