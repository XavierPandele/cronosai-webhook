# 🧪 Test de la API de Text-to-Speech

## Prueba Rápida

### 1. Verificar que la API está Habilitada

```bash
# Reemplaza TU_API_KEY con tu API key real
curl -X POST \
  'https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "text": "Hola, esto es una prueba de la voz Algieba"
    },
    "voice": {
      "languageCode": "es-ES",
      "name": "Algieba",
      "modelName": "gemini-2.5-pro-tts"
    },
    "audioConfig": {
      "audioEncoding": "MP3",
      "sampleRateHertz": 24000
    }
  }'
```

### 2. Respuesta Esperada

Si la API está habilitada correctamente, deberías recibir:

```json
{
  "audioContent": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQAAAAA..."
}
```

Si recibes un error:

```json
{
  "error": {
    "code": 403,
    "message": "Cloud Text-to-Speech API has not been used in project 1053536347405 before or it is disabled. Enable it by visiting https://console.cloud.google.com/apis/library/texttospeech.googleapis.com?project=1053536347405 then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.",
    "status": "PERMISSION_DENIED"
  }
}
```

**Esto significa que la API no está habilitada.** Sigue los pasos en `HABILITAR_TEXT_TO_SPEECH_API.md`.

### 3. Probar el Endpoint Local

```bash
# Desde el directorio del proyecto
node -e "
const fetch = require('node-fetch');
require('dotenv').config();

async function test() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('❌ GOOGLE_API_KEY no está configurada');
    return;
  }

  try {
    const response = await fetch('https://texttospeech.googleapis.com/v1beta1/text:synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey
      },
      body: JSON.stringify({
        input: { text: 'Hola, esto es una prueba' },
        voice: {
          languageCode: 'es-ES',
          name: 'Algieba',
          modelName: 'gemini-2.5-pro-tts'
        },
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 24000
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Error:', response.status, error);
    } else {
      const data = await response.json();
      console.log('✅ Éxito! Audio generado:', data.audioContent ? 'Sí' : 'No');
      console.log('Longitud del audio:', data.audioContent ? data.audioContent.length : 0);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
"
```

### 4. Probar el Endpoint en Vercel

```bash
# Reemplaza TU_PROYECTO con tu URL de Vercel
curl -X GET "https://TU_PROYECTO.vercel.app/api/tts?text=Hola&language=es"
```

### 5. Verificar Logs en Vercel

1. Ve a tu proyecto en Vercel
2. Ve a **Deployments** → Selecciona el último deployment
3. Ve a **Functions** → **api/tts**
4. Revisa los logs para ver si hay errores

---

## 🔍 Errores Comunes

### Error 403: PERMISSION_DENIED
**Causa:** API no habilitada o sin permisos
**Solución:** Habilita la API en Google Cloud Console

### Error 401: UNAUTHENTICATED
**Causa:** API key inválida o sin permisos
**Solución:** Verifica que la API key es correcta y tiene permisos

### Error 400: INVALID_ARGUMENT
**Causa:** Parámetros inválidos (voz no disponible, idioma incorrecto, etc.)
**Solución:** Verifica que la voz "Algieba" está disponible para el idioma seleccionado

### Error: "Voz no encontrada"
**Causa:** La voz "Algieba" puede no estar disponible para todos los idiomas
**Solución:** Verifica qué voces están disponibles para cada idioma

---

## 📋 Checklist de Verificación

- [ ] API habilitada en Google Cloud Console
- [ ] Facturación activada
- [ ] API key tiene permisos para Text-to-Speech
- [ ] Variable `GOOGLE_API_KEY` configurada en Vercel
- [ ] Proyecto redesplegado en Vercel
- [ ] Test realizado y funcionando
- [ ] Logs verificados en Vercel

---

## 🆘 Si No Funciona

1. **Verifica los logs en Vercel** para ver el error exacto
2. **Verifica que la API está habilitada** en Google Cloud Console
3. **Verifica que la API key es correcta** y tiene permisos
4. **Verifica que la facturación está activada**
5. **Espera unos minutos** después de habilitar la API (puede tardar en propagarse)

