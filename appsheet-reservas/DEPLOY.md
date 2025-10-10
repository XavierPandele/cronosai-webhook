# 🚀 Guía de Despliegue en Vercel

Guía completa para desplegar tu API de reservas en Vercel.

---

## 📋 Pre-requisitos

Antes de comenzar, asegúrate de tener:

- ✅ Cuenta en [Vercel](https://vercel.com) (gratis)
- ✅ Node.js >= 18 instalado
- ✅ Git instalado
- ✅ Acceso a tu base de datos MySQL
- ✅ Código del proyecto

---

## 🎯 Método 1: Despliegue con Vercel CLI (Recomendado)

### Paso 1: Instalar Vercel CLI

```bash
npm install -g vercel
```

Verifica la instalación:
```bash
vercel --version
```

### Paso 2: Login en Vercel

```bash
vercel login
```

Selecciona tu método de autenticación (GitHub, GitLab, Bitbucket o Email).

### Paso 3: Preparar el Proyecto

```bash
cd appsheet-reservas
npm install
```

### Paso 4: Desplegar

```bash
vercel
```

**Primera vez:**
- ¿Setup and deploy? → `Y`
- ¿Scope? → Selecciona tu cuenta
- ¿Link to project? → `N`
- ¿Project name? → `appsheet-reservas` (o el que prefieras)
- ¿Directory? → `./` (Enter)
- ¿Override settings? → `N`

Vercel desplegará tu proyecto y te dará una URL de preview:
```
https://appsheet-reservas-xyz.vercel.app
```

### Paso 5: Desplegar a Producción

```bash
vercel --prod
```

Obtendrás la URL de producción:
```
https://appsheet-reservas.vercel.app
```

**¡Guarda esta URL!** La necesitarás para configurar AppSheet.

---

## 🎯 Método 2: Despliegue desde GitHub

### Paso 1: Subir a GitHub

```bash
cd appsheet-reservas
git init
git add .
git commit -m "Initial commit: AppSheet Reservas API"
git branch -M main
git remote add origin https://github.com/tu-usuario/appsheet-reservas.git
git push -u origin main
```

### Paso 2: Conectar con Vercel

1. Ve a [vercel.com/new](https://vercel.com/new)
2. Click en **"Import Git Repository"**
3. Selecciona tu repositorio `appsheet-reservas`
4. Click en **"Import"**

### Paso 3: Configurar Proyecto

**Framework Preset:** Other  
**Root Directory:** `./`  
**Build Command:** (dejar en blanco)  
**Output Directory:** (dejar en blanco)  
**Install Command:** `npm install`

Click en **"Deploy"**

### Paso 4: Esperar el Despliegue

Vercel construirá y desplegará tu proyecto automáticamente.

Una vez completado, obtendrás tu URL:
```
https://appsheet-reservas.vercel.app
```

---

## ⚙️ Configurar Variables de Entorno

Las variables de entorno son **críticas** para que la API funcione.

### Desde CLI:

```bash
# Añadir variables una por una
vercel env add DB_HOST
# Ingresa el valor cuando te lo pida: db1.bwai.cc
# Selecciona: Production, Preview, Development (todas)

vercel env add DB_PORT
# Valor: 3306

vercel env add DB_USER
# Valor: cronosdev

vercel env add DB_PASS
# Valor: )CDJ6gwpCO9rg-W/

vercel env add DB_NAME
# Valor: cronosai

vercel env add API_KEY
# Valor: appsheet-cronos-2024
```

### Desde Dashboard:

1. Ve a tu proyecto en [vercel.com](https://vercel.com)
2. Click en **"Settings"**
3. Click en **"Environment Variables"**
4. Añade cada variable:

| Key | Value | Environments |
|-----|-------|--------------|
| `DB_HOST` | `db1.bwai.cc` | Production, Preview, Development |
| `DB_PORT` | `3306` | Production, Preview, Development |
| `DB_USER` | `cronosdev` | Production, Preview, Development |
| `DB_PASS` | `)CDJ6gwpCO9rg-W/` | Production, Preview, Development |
| `DB_NAME` | `cronosai` | Production, Preview, Development |
| `API_KEY` | `appsheet-cronos-2024` | Production, Preview, Development |

5. Click en **"Save"**

### Paso Crítico: Redesplegar

Después de añadir las variables:

**Desde CLI:**
```bash
vercel --prod
```

**Desde Dashboard:**
1. Ve a **"Deployments"**
2. Click en los 3 puntos del último deployment
3. Click en **"Redeploy"**

---

## ✅ Verificar el Despliegue

### Test 1: Verificar que la API responde

```bash
curl https://tu-proyecto.vercel.app/api/reservations
```

**Respuesta esperada:**
```json
{
  "success": false,
  "error": "API Key inválida o faltante"
}
```

✅ Si ves este mensaje, ¡la API está funcionando!

### Test 2: Verificar con API Key

```bash
curl -H "X-Api-Key: appsheet-cronos-2024" \
  https://tu-proyecto.vercel.app/api/reservations
```

**Respuesta esperada:**
```json
{
  "success": true,
  "count": 0,
  "data": []
}
```

✅ Si ves este mensaje, ¡la API está conectada a la base de datos!

### Test 3: Test Completo Automatizado

```bash
cd appsheet-reservas
API_URL=https://tu-proyecto.vercel.app npm test
```

---

## 🔍 Monitoreo y Logs

### Ver Logs en Tiempo Real

```bash
vercel logs --follow
```

### Ver Logs de un Deployment Específico

```bash
vercel logs [deployment-url]
```

### Desde Dashboard

1. Ve a tu proyecto en Vercel
2. Click en **"Deployments"**
3. Click en un deployment
4. Ve a la pestaña **"Logs"**

---

## 🔄 Actualizar el Proyecto

### Desde CLI:

```bash
# Hacer cambios en tu código
# ...

# Commit cambios
git add .
git commit -m "Descripción de cambios"
git push

# Desplegar
vercel --prod
```

### Desde GitHub (automático):

Si conectaste con GitHub, cada `git push` a `main` desplegará automáticamente.

```bash
git add .
git commit -m "Update API"
git push origin main
```

Vercel detectará el push y desplegará automáticamente.

---

## 🌍 Dominios Personalizados

### Añadir Dominio Personalizado

1. Ve a tu proyecto en Vercel
2. Click en **"Settings" → "Domains"**
3. Ingresa tu dominio: `api.turestaurante.com`
4. Click en **"Add"**
5. Configura DNS según las instrucciones de Vercel

### Configurar DNS

Añade estos registros en tu proveedor de DNS:

**Para apex domain (turestaurante.com):**
```
Type: A
Name: @
Value: 76.76.21.21
```

**Para subdomain (api.turestaurante.com):**
```
Type: CNAME
Name: api
Value: cname.vercel-dns.com
```

---

## 🔒 Configuración de Seguridad

### Cambiar API Key

1. Genera un API Key seguro:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. Actualiza en Vercel:
```bash
vercel env rm API_KEY production
vercel env add API_KEY
# Ingresa el nuevo valor
```

3. Redesplegar:
```bash
vercel --prod
```

4. Actualiza en AppSheet con el nuevo API Key

### Restringir CORS (Opcional)

En cada archivo de API, cambia:

```javascript
// Antes (permite todos los orígenes)
res.setHeader('Access-Control-Allow-Origin', '*');

// Después (solo tu dominio de AppSheet)
res.setHeader('Access-Control-Allow-Origin', 'https://tuapp.appsheet.com');
```

Redesplegar después del cambio.

---

## 🐛 Solución de Problemas

### Error: "Module not found"

**Causa:** Falta instalar dependencias

**Solución:**
```bash
cd appsheet-reservas
rm -rf node_modules package-lock.json
npm install
vercel --prod
```

### Error: "Database connection failed"

**Causa:** Variables de entorno incorrectas

**Solución:**
1. Verifica variables en Vercel Dashboard
2. Asegúrate de que están en "Production"
3. Redesplegar después de corregir

### Error: "Deployment failed"

**Solución:**
```bash
# Ver logs detallados
vercel logs

# Verificar vercel.json
cat vercel.json

# Verificar package.json
cat package.json

# Intentar deployment local
vercel dev
```

### API responde 404

**Causa:** Rutas mal configuradas en `vercel.json`

**Solución:**

Verifica que `vercel.json` tenga:
```json
{
  "routes": [
    {
      "src": "/api/reservations",
      "dest": "/api/reservations.js"
    },
    {
      "src": "/api/calendar",
      "dest": "/api/calendar.js"
    },
    {
      "src": "/api/stats",
      "dest": "/api/stats.js"
    }
  ]
}
```

---

## 📊 Optimización

### Habilitar Caché

En cada archivo de API, añade:

```javascript
// Cachear respuestas por 60 segundos
res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
```

### Limitar Regiones (Opcional)

En `vercel.json`:

```json
{
  "regions": ["cdg1", "iad1"]
}
```

Regiones recomendadas:
- `cdg1` - Paris (Europa)
- `iad1` - Washington DC (USA)
- `sfo1` - San Francisco (USA)

---

## 📈 Analytics y Monitoreo

### Habilitar Analytics

1. Ve a tu proyecto en Vercel
2. Click en **"Analytics"**
3. Click en **"Enable Analytics"**

Verás:
- Número de requests
- Tiempo de respuesta
- Errores
- Distribución geográfica

### Configurar Alertas

1. **Settings → Integrations**
2. Añade integración (Slack, Discord, Email)
3. Configura alertas para:
   - Deployment failed
   - Error rate > 5%
   - Response time > 2s

---

## 🔄 Rollback

Si algo sale mal, puedes volver a un deployment anterior:

### Desde CLI:

```bash
# Listar deployments
vercel ls

# Promover un deployment anterior a producción
vercel promote [deployment-url]
```

### Desde Dashboard:

1. Ve a **"Deployments"**
2. Encuentra el deployment que funcionaba
3. Click en los 3 puntos
4. Click en **"Promote to Production"**

---

## ✅ Checklist Post-Despliegue

- [ ] API desplegada y accesible
- [ ] Variables de entorno configuradas
- [ ] Test básico con cURL funciona
- [ ] Test con API Key funciona
- [ ] Conexión a base de datos funciona
- [ ] URL guardada para AppSheet
- [ ] (Opcional) Dominio personalizado configurado
- [ ] (Opcional) Analytics habilitado
- [ ] (Opcional) Alertas configuradas

---

## 📞 Recursos

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel CLI Reference](https://vercel.com/docs/cli)
- [Node.js on Vercel](https://vercel.com/docs/runtimes#official-runtimes/node-js)
- [Environment Variables](https://vercel.com/docs/environment-variables)

---

## 🎉 ¡Listo!

Tu API está desplegada y lista para usar con AppSheet.

**Próximo paso:** Configurar AppSheet siguiendo [INICIO_RAPIDO.md](./docs/INICIO_RAPIDO.md)

---

**Última actualización:** Octubre 2024  
**Versión:** 1.0.0

