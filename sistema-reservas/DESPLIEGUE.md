# 🚀 Guía de Despliegue Rápido

## Opción 1: Despliegue Automático con Vercel (Recomendado)

### Paso 1: Instalar Vercel CLI
```bash
npm install -g vercel
```

### Paso 2: Login en Vercel
```bash
vercel login
```
Te pedirá que te autentiques por email.

### Paso 3: Desplegar
```bash
cd sistema-reservas
vercel
```

Responde a las preguntas:
- Set up and deploy? → **Y (Yes)**
- Which scope? → Selecciona tu cuenta
- Link to existing project? → **N (No)**
- What's your project's name? → **sistema-reservas** (o el nombre que prefieras)
- In which directory is your code located? → **./** (presiona Enter)

### Paso 4: ¡Listo!
Vercel te dará una URL como: `https://sistema-reservas-xxx.vercel.app`

---

## Opción 2: Despliegue desde GitHub

### Paso 1: Subir a GitHub
```bash
cd sistema-reservas
git init
git add .
git commit -m "Sistema de reservas inicial"
git remote add origin https://github.com/tu-usuario/sistema-reservas.git
git push -u origin main
```

### Paso 2: Importar en Vercel
1. Ve a https://vercel.com
2. Click en "New Project"
3. Importa tu repositorio de GitHub
4. Click en "Deploy"

---

## ⚙️ Configuración de Variables de Entorno

Una vez desplegado, configura las variables de entorno en Vercel:

1. Ve a tu proyecto en Vercel Dashboard
2. Settings → Environment Variables
3. Añade las siguientes variables:

```
DB_HOST=tu-servidor-mysql.com
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=sistema_reservas
DB_PORT=3306
```

4. Click en "Save"
5. Redeploy el proyecto para aplicar los cambios

---

## 🗄️ Configurar Base de Datos

### Si usas MySQL/MariaDB:

```bash
mysql -u tu_usuario -p tu_base_datos < database-setup.sql
```

O importa el archivo `database-setup.sql` desde phpMyAdmin.

---

## ✅ Verificar Funcionamiento

1. Abre tu URL de Vercel
2. Completa el formulario
3. Verifica que se muestre el modal de confirmación
4. Revisa tu base de datos para confirmar que se guardó

---

## 🔧 Actualizar el Sitio

Para actualizar después de hacer cambios:

```bash
cd sistema-reservas
vercel --prod
```

---

## 📱 Dominio Personalizado

Para usar tu propio dominio:

1. Ve a Vercel Dashboard → Tu Proyecto → Settings → Domains
2. Añade tu dominio (ej: reservas.turestaurante.com)
3. Configura los DNS según las instrucciones de Vercel
4. ¡Listo!

---

## 🆘 Problemas Comunes

### Error: "Command failed"
- Asegúrate de estar en la carpeta `sistema-reservas`
- Verifica que tengas Node.js instalado: `node --version`

### Error: "Database connection failed"
- Verifica las variables de entorno en Vercel
- Asegúrate de que tu base de datos esté accesible

### El formulario no envía
- Verifica la consola del navegador (F12)
- Asegúrate de que el API endpoint esté funcionando

---

## 📞 Comandos Útiles

```bash
# Ver logs
vercel logs

# Ver el estado del proyecto
vercel inspect

# Eliminar un deployment
vercel remove [deployment-url]

# Ver lista de proyectos
vercel ls
```

---

## 🎯 Siguiente Nivel

Una vez que todo funcione:

1. **Conecta con Base de Datos Real**
   - Edita `api/reservations.js`
   - Descomenta el código de conexión MySQL
   - Configura las variables de entorno

2. **Añade Notificaciones**
   - Email al cliente
   - SMS con Twilio
   - Notificación al restaurante

3. **Panel de Administración**
   - Ver todas las reservas
   - Confirmar/Cancelar reservas
   - Gestionar disponibilidad

---

**¿Necesitas ayuda?** Revisa `README.md` para más detalles técnicos.
