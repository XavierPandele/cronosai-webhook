# 🚀 Instalación Rápida - CronosAI Reservas Web

## ⚡ Instalación en 5 minutos

### 1. Instalar Backend
```bash
cd web-reservas/backend
npm install
```

### 2. Iniciar Servidor
```bash
npm start
```

### 3. Abrir Página Web
Abrir `web-reservas/index.html` en tu navegador.

## ✅ ¡Listo!

Tu sistema de reservas web está funcionando.

## 🔧 Configuración Avanzada

### Variables de Entorno
```bash
# Copiar archivo de configuración
cp env.example .env

# Editar configuración si es necesario
nano .env
```

### Base de Datos
El sistema usa automáticamente las credenciales existentes:
- Host: `db1.bwai.cc`
- Usuario: `cronosai`
- Base de datos: `cronosai`

## 🌐 URLs Importantes

- **Frontend:** `web-reservas/index.html`
- **Backend API:** `http://localhost:3000/api/reservas`
- **Health Check:** `http://localhost:3000/api/reservas/health`

## 🧪 Probar el Sistema

1. **Abrir la página web**
2. **Completar el formulario de reserva**
3. **Verificar que se guarde en la base de datos**

## 📞 Soporte

Si tienes problemas:
1. Verificar que el backend esté ejecutándose
2. Revisar los logs en `backend/logs/`
3. Comprobar la conexión a la base de datos

---

**¡Disfruta de tu nuevo sistema de reservas! 🎉**
