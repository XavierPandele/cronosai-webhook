# 🔑 Instrucciones para Actualizar GOOGLE_API_KEY en Vercel

## ⚠️ IMPORTANTE

El archivo `.env` solo funciona **localmente**. Si tu código está desplegado en **Vercel**, necesitas actualizar la variable de entorno en el **dashboard de Vercel**.

## 📋 Pasos para Actualizar la API Key en Vercel

### Opción 1: Desde el Dashboard de Vercel (Recomendado)

1. **Ve a tu proyecto en Vercel:**
   - Abre https://vercel.com
   - Selecciona tu proyecto `cronosai-webhook`

2. **Ve a Settings:**
   - Click en **"Settings"** (en el menú superior)
   - Click en **"Environment Variables"** (en el menú lateral)

3. **Busca la variable `GOOGLE_API_KEY`:**
   - Si existe, haz click en el lápiz (✏️) para editarla
   - Si no existe, click en **"Add New"**

4. **Actualiza el valor:**
   - **Key:** `GOOGLE_API_KEY`
   - **Value:** `AIzaSyCEbBYa3tnUJRRvAfkYEFDBWjvF7BCCKk0`
   - **Environments:** Selecciona todas (Production, Preview, Development)

5. **Guarda los cambios:**
   - Click en **"Save"**

6. **REDESPLEGA el proyecto:**
   - Ve a **"Deployments"**
   - Click en los **3 puntos** del último deployment
   - Click en **"Redeploy"**
   - ⚠️ **CRÍTICO:** Sin redesplegar, los cambios NO se aplicarán

### Opción 2: Desde la CLI de Vercel

```bash
# 1. Instalar Vercel CLI (si no lo tienes)
npm install -g vercel

# 2. Login en Vercel
vercel login

# 3. Ir al directorio del proyecto
cd d:\cronosai-webhook

# 4. Eliminar la variable antigua (si existe)
vercel env rm GOOGLE_API_KEY production
vercel env rm GOOGLE_API_KEY preview
vercel env rm GOOGLE_API_KEY development

# 5. Agregar la nueva variable
vercel env add GOOGLE_API_KEY
# Cuando te pregunte el valor, pega: AIzaSyCEbBYa3tnUJRRvAfkYEFDBWjvF7BCCKk0
# Selecciona: Production, Preview, Development (todas)

# 6. Verificar que se agregó correctamente
vercel env ls

# 7. Redesplegar
vercel --prod
```

## ✅ Verificar que la Nueva API Key está Configurada

### 1. Verificar en Vercel Dashboard:
- Ve a **Settings → Environment Variables**
- Verifica que `GOOGLE_API_KEY` tiene el valor: `AIzaSy...CKk0` (debe empezar con `AIzaSy`)

### 2. Verificar en los logs:
Después de redesplegar, los logs deberían mostrar:
```
[INFO] 🔑 GEMINI_CLIENT_INITIALIZED {
  "apiKeyPreview": "AIzaSy...CKk0",
  "apiKeyStartsWith": "AIzaSy",
  "reasoning": "Cliente de Gemini inicializado con API key del proyecto. Verificar que esta sea la nueva API key del proyecto CronosRestaurants (1053536347405)."
}
```

## 🔍 Verificar qué API Key está usando actualmente

### Desde los logs de Vercel:
1. Ve a **Deployments**
2. Click en el último deployment
3. Click en **"Functions"**
4. Click en **"twilio-call-gemini"**
5. Busca en los logs: `GEMINI_CLIENT_INITIALIZED`
6. Verifica el `apiKeyStartsWith` - debe ser `AIzaSy` (la nueva key)

## ⚠️ Posibles Causas de los Errores 429

1. **El nuevo proyecto tiene límites más bajos:**
   - Los proyectos nuevos de Google AI Studio tienen límites más restrictivos
   - **Solución:** Activar facturación en Google Cloud Console

2. **Facturación no activada:**
   - Sin facturación activada, los límites son muy bajos
   - **Solución:** Activar facturación en el proyecto `CronosRestaurants` (1053536347405)

3. **Demasiadas llamadas simultáneas:**
   - El código puede estar haciendo múltiples llamadas a Gemini en paralelo
   - **Solución:** El retry que implementamos debería ayudar, pero también puedes reducir las llamadas

4. **API Key aún no actualizada en Vercel:**
   - Si no actualizaste la variable en Vercel, sigue usando la API key antigua
   - **Solución:** Seguir los pasos arriba

## 🚀 Activar Facturación en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Selecciona el proyecto **CronosRestaurants** (1053536347405)
3. Ve a **Billing** (Facturación)
4. Click en **"Link a billing account"**
5. Sigue las instrucciones para activar facturación
6. ⚠️ **Nota:** Google tiene un tier gratuito generoso, pero activar facturación aumenta los límites

## 📊 Verificar Límites del Proyecto

1. Ve a [Google AI Studio](https://aistudio.google.com)
2. Selecciona el proyecto **CronosRestaurants**
3. Ve a **Settings → API Key**
4. Verifica los límites y quotas
5. Si están muy bajos, activa facturación

## 🔧 Comandos Útiles

```bash
# Ver todas las variables de entorno en Vercel
vercel env ls

# Ver el valor de una variable específica
vercel env pull .env.vercel

# Ver logs en tiempo real
vercel logs --follow

# Redesplegar después de cambiar variables
vercel --prod
```

## ✅ Checklist Final

- [ ] Variable `GOOGLE_API_KEY` actualizada en Vercel Dashboard
- [ ] Valor correcto: `AIzaSyCEbBYa3tnUJRRvAfkYEFDBWjvF7BCCKk0`
- [ ] Variable configurada para Production, Preview y Development
- [ ] Proyecto redesplegado después de cambiar la variable
- [ ] Logs muestran `apiKeyStartsWith: "AIzaSy"`
- [ ] Facturación activada en Google Cloud (recomendado)
- [ ] Verificar que los errores 429 han disminuido

