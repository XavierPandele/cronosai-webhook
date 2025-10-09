# 🚀 Guía Rápida - Implementación de Correcciones

## ⏱️ 5 Minutos para Implementar

---

## 📋 Pasos para Aplicar los Cambios

### 1️⃣ Actualizar Base de Datos (2 min)

Accede a phpMyAdmin y ejecuta:

```sql
-- Eliminar tablas antiguas
DROP TABLE IF EXISTS reservas;
DROP TABLE IF EXISTS disponibilidad_mesas;

-- Luego ejecuta todo el contenido de:
-- web-reservas/backend/create_tables.sql
```

O copia este SQL directamente:

```sql
CREATE TABLE IF NOT EXISTS RESERVA (
    id_reserva INT AUTO_INCREMENT PRIMARY KEY,
    nom_persona_reserva VARCHAR(100) NOT NULL,
    telefon VARCHAR(20) NOT NULL,
    data_reserva DATETIME NOT NULL,
    num_persones INT NOT NULL,
    observacions TEXT,
    conversa_completa TEXT DEFAULT 'Reserva via página web',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_data_reserva (data_reserva),
    INDEX idx_telefon (telefon),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2️⃣ Actualizar Dependencias Backend (1 min)

```bash
cd web-reservas/backend
npm install
```

### 3️⃣ Iniciar Servidor (1 min)

```bash
npm start
```

Deberías ver:
```
✅ Conexión a MySQL establecida correctamente
🚀 Servidor iniciado en puerto 3000
✅ Sistema listo para recibir reservas
```

### 4️⃣ Verificar Funcionamiento (1 min)

**Test 1: Health Check**
```bash
# En navegador o curl:
http://localhost:3000/api/reservas/health
```

Respuesta esperada:
```json
{
  "status": "OK",
  "timestamp": "2025-10-09T...",
  "service": "CronosAI Web Reservas Backend"
}
```

**Test 2: Crear Reserva de Prueba**

Abre el frontend (`web-reservas/index.html`) en tu navegador y:
1. Completa el formulario
2. Click en "Confirmar Reserva"
3. Verifica que aparece el modal de confirmación

---

## 🔧 Solución de Problemas

### Error: "Cannot connect to database"
```bash
# Verifica credenciales en:
web-reservas/backend/config/database.js

# Debe tener:
host: 'db1.bwai.cc'
user: 'cronosdev'
password: ')CDJ6gwpCO9rg-W/'
database: 'cronosai'
```

### Error: "Table RESERVA doesn't exist"
```bash
# Ejecuta el SQL de create_tables.sql en phpMyAdmin
```

### Error: "Cannot find module uuid"
```bash
# Normal - ya no se usa uuid
# Simplemente ejecuta:
cd web-reservas/backend
npm install
```

---

## ✅ Checklist de Verificación

Marca cada item después de verificarlo:

- [ ] Tabla RESERVA existe en MySQL
- [ ] Backend inicia sin errores
- [ ] Health check responde OK
- [ ] Frontend carga correctamente
- [ ] Puedes crear una reserva de prueba
- [ ] Modal de confirmación muestra el ID correcto
- [ ] La reserva aparece en la tabla RESERVA

---

## 📊 Endpoints Disponibles

```
POST   /api/reservas/disponibilidad     - Consultar disponibilidad
POST   /api/reservas/crear-reserva      - Crear nueva reserva
POST   /api/reservas/cancelar-reserva   - Cancelar reserva
POST   /api/reservas/buscar-reservas    - Buscar por teléfono
GET    /api/reservas/reserva/:id        - Obtener detalles
GET    /api/reservas/estadisticas       - Estadísticas
GET    /api/reservas/health             - Estado del servidor
GET    /api/reservas/test               - Test simple

-- Endpoints de prueba (sin DB):
POST   /api/reservas/test-disponibilidad
POST   /api/reservas/test-crear-reserva
```

---

## 🎯 Ejemplo de Uso

### Crear Reserva (cURL)

```bash
curl -X POST http://localhost:3000/api/reservas/crear-reserva \
  -H "Content-Type: application/json" \
  -d '{
    "nom_persona_reserva": "Juan Pérez",
    "telefon": "+34666777888",
    "data_reserva": "2025-10-15",
    "num_persones": 4,
    "observacions": "Mesa cerca de la ventana"
  }'
```

Respuesta esperada:
```json
{
  "success": true,
  "id_reserva": 1,
  "message": "¡Excelente! Su reserva ha sido confirmada...",
  "reserva": {
    "id_reserva": 1,
    "nom_persona_reserva": "Juan Pérez",
    "telefon": "+34666777888",
    "data_reserva": "2025-10-15",
    "num_persones": 4,
    "observacions": "Mesa cerca de la ventana"
  }
}
```

---

## 📱 Probar desde el Frontend

1. Abre `web-reservas/index.html` en tu navegador
2. Si el backend está en otro puerto, actualiza:

```javascript
// En web-reservas/script.js línea 3:
const CONFIG = {
    API_BASE_URL: 'http://localhost:3000/api/reservas',
    // Cambia si es necesario
};
```

---

## 🎉 ¡Listo!

Tu sistema de reservas está completamente funcional con:

✅ Base de datos consistente  
✅ IDs simples y predecibles  
✅ Endpoints de producción activos  
✅ Frontend conectado correctamente  
✅ Código limpio y mantenible  

---

## 📞 Soporte

Si encuentras algún problema:

1. Revisa los logs del backend en consola
2. Verifica los logs de MySQL
3. Comprueba el archivo `CAMBIOS_REALIZADOS.md` para más detalles

---

**Última actualización:** 9 de octubre de 2025  
**Versión:** 1.0.0  
**Estado:** ✅ Producción Ready

