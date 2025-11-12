# 🎤 Habilitar Google Cloud Text-to-Speech API

## ⚠️ IMPORTANTE

El código actual usa la API de **Google Cloud Text-to-Speech** que **NO está habilitada** en tu proyecto de Google Cloud Console.

Para que funcione correctamente, necesitas:

1. **Habilitar la API** en Google Cloud Console
2. **Configurar facturación** (si es necesario)
3. **Verificar que la API key tiene permisos** para Text-to-Speech

---

## 📋 Pasos para Habilitar la API

### Paso 1: Habilitar Text-to-Speech API en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Selecciona tu proyecto: **CronosAI** (ID: 1053536347405)
3. Ve a **APIs & Services** → **Library** (o directamente: https://console.cloud.google.com/apis/library)
4. Busca **"Cloud Text-to-Speech API"**
5. Haz clic en **"Enable"** (Habilitar)

### Paso 2: Verificar Facturación

La API de Text-to-Speech requiere facturación activada:

1. Ve a **Billing** → **Account management**
2. Verifica que tienes una cuenta de facturación activa
3. Si no la tienes, créala y vincúlala al proyecto

### Paso 3: Verificar Permisos de la API Key

1. Ve a **APIs & Services** → **Credentials**
2. Busca tu API key (la que estás usando: `GOOGLE_API_KEY`)
3. Haz clic en la API key para editarla
4. Verifica que en **"API restrictions"** esté configurada para:
   - **Cloud Text-to-Speech API** ✓
   - **Generative Language API** (para Gemini) ✓
   
   O configúrala como **"Don't restrict key"** (no recomendado para producción)

### Paso 4: Verificar que la API Key Funciona

La API key de Gemini (`GOOGLE_API_KEY`) **debería funcionar** para Text-to-Speech si:
- Está configurada sin restricciones de API
- O tiene permisos explícitos para Text-to-Speech API

**Si no funciona**, necesitarás:
1. Crear una nueva API key específica para Text-to-Speech
2. O usar credenciales de servicio (Service Account)

---

## 🔧 Configuración en el Código

### Opción 1: Usar la misma API Key (Recomendado)

Si tu `GOOGLE_API_KEY` tiene permisos para Text-to-Speech, no necesitas cambiar nada en el código.

**Verificar en Vercel:**
1. Ve a tu proyecto en Vercel
2. Ve a **Settings** → **Environment Variables**
3. Verifica que `GOOGLE_API_KEY` esté configurada
4. Redesplegar el proyecto después de habilitar la API

### Opción 2: Usar Credenciales de Servicio (Más Seguro)

Si prefieres usar credenciales de servicio:

1. **Crear Service Account:**
   - Ve a **IAM & Admin** → **Service Accounts**
   - Crea una nueva cuenta de servicio
   - Asigna el rol **"Cloud Text-to-Speech API User"**
   - Descarga el archivo JSON de credenciales

2. **Configurar en Vercel:**
   - Ve a **Settings** → **Environment Variables**
   - Añade `GOOGLE_APPLICATION_CREDENTIALS` con el contenido del archivo JSON (como string)
   - O almacena el JSON en un servicio seguro (como Vercel Blob) y referencia la URL

3. **Modificar el código:**
   - El código necesitaría usar `@google-cloud/text-to-speech` SDK en lugar de REST API
   - Esto requiere cambiar `api/tts.js` para usar credenciales de servicio

---

## 🧪 Probar la API

### Test 1: Verificar que la API está Habilitada

```bash
curl -X POST \
  'https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=TU_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {
      "text": "Hola, esto es una prueba"
    },
    "voice": {
      "languageCode": "es-ES",
      "name": "Algieba",
      "modelName": "gemini-2.5-pro-tts"
    },
    "audioConfig": {
      "audioEncoding": "MP3"
    }
  }'
```

### Test 2: Probar desde el Código

```bash
# Hacer una llamada de prueba a tu endpoint TTS
curl -X GET "https://tu-proyecto.vercel.app/api/tts?text=Hola&language=es"
```

---

## 💰 Costos

Según la imagen que compartiste, los precios son:
- **Cloud TTS API audio output token count for Gemini 2.5 Pro**: USD 20.00 / 1M tokens
- **Cloud TTS API text input token count for Gemini 2.5 Flash TTS**: USD 20.00 / 1M tokens

**Estimación de costos:**
- Una frase de ~50 palabras ≈ 50 tokens
- 1M tokens ≈ 20,000 frases
- Costo por frase: ~$0.001 (muy bajo)

---

## ❗ Solución de Problemas

### Error: "API not enabled"
**Solución:** Habilita la API en Google Cloud Console (Paso 1)

### Error: "Permission denied"
**Solución:** Verifica que la API key tiene permisos para Text-to-Speech (Paso 3)

### Error: "Billing required"
**Solución:** Activa la facturación en tu proyecto (Paso 2)

### Error: "Invalid API key"
**Solución:** Verifica que `GOOGLE_API_KEY` está correctamente configurada en Vercel

---

## 📚 Referencias

- [Google Cloud Text-to-Speech API Documentation](https://cloud.google.com/text-to-speech/docs)
- [Text-to-Speech API Pricing](https://cloud.google.com/text-to-speech/pricing)
- [Enabling APIs](https://cloud.google.com/apis/docs/getting-started)

---

## ✅ Checklist

- [ ] API habilitada en Google Cloud Console
- [ ] Facturación activada
- [ ] API key tiene permisos para Text-to-Speech
- [ ] Variable `GOOGLE_API_KEY` configurada en Vercel
- [ ] Proyecto redesplegado en Vercel
- [ ] Prueba realizada y funcionando

---

## 🔄 Próximos Pasos

1. **Habilitar la API** en Google Cloud Console
2. **Verificar permisos** de la API key
3. **Probar el endpoint** `/api/tts`
4. **Hacer una llamada real** para verificar que funciona
5. **Monitorear costos** en Google Cloud Console

---

## 🆘 ¿Necesitas Ayuda?

Si después de seguir estos pasos sigue sin funcionar:

1. Verifica los logs en Vercel para ver el error exacto
2. Verifica que la API key es correcta
3. Verifica que la API está habilitada en el proyecto correcto
4. Contacta con soporte de Google Cloud si es necesario

