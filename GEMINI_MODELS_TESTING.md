# 🧪 Testing de Modelos Gemini

Este directorio contiene scripts para probar y analizar diferentes modelos de Gemini para determinar cuál es el mejor para nuestro caso de uso (reservas de restaurante).

## 📋 Scripts Disponibles

### 1. `test-gemini-models.js`
Script principal para probar todos los modelos de Gemini disponibles.

**Características:**
- ✅ Verifica automáticamente qué modelos están disponibles
- ✅ Prueba cada modelo con casos de prueba reales
- ✅ Maneja errores de rate limiting (429, 503) con reintentos
- ✅ Guarda resultados detallados en archivo JSON
- ✅ Incluye todos los modelos de Gemini hasta 2026

**Modelos incluidos:**
- Gemini 1.5: `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-1.5-pro-latest`, `gemini-1.5-flash-latest`
- Gemini 2.0: `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.0-flash-exp`, `gemini-2.0-flash-thinking-exp`
- Gemini 2.5: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`
- Modelos experimentales: `gemini-pro`, `gemini-pro-vision`

### 2. `analyze-gemini-results.js`
Script para analizar los resultados de las pruebas y recomendar el mejor modelo.

**Características:**
- ✅ Analiza métricas clave (velocidad, calidad, estabilidad)
- ✅ Compara modelos según diferentes criterios
- ✅ Genera recomendaciones personalizadas
- ✅ Guarda análisis detallado en archivo JSON

## 🚀 Uso

### Paso 1: Ejecutar las pruebas

```bash
node test-gemini-models.js
```

Este script:
1. Verificará qué modelos están disponibles
2. Probará cada modelo con casos de prueba reales
3. Guardará los resultados en `gemini-test-results-YYYY-MM-DD_HH-MM-SS.json`

**Nota:** El script puede tardar varios minutos ya que prueba múltiples modelos con múltiples casos de prueba.

### Paso 2: Analizar los resultados

```bash
node analyze-gemini-results.js gemini-test-results-YYYY-MM-DD_HH-MM-SS.json
```

Este script:
1. Analizará los resultados de las pruebas
2. Comparará modelos según diferentes criterios
3. Generará recomendaciones:
   - Mejor modelo general
   - Mejor para estabilidad
   - Mejor para velocidad
   - Mejor para calidad
   - Mejor balanceado
4. Guardará el análisis en `gemini-test-results-YYYY-MM-DD_HH-MM-SS-analysis.json`

## 📊 Métricas Analizadas

### 1. Tasa de Éxito
Porcentaje de pruebas exitosas vs fallidas.

### 2. Tiempo de Respuesta
- Tiempo promedio
- Tiempo mínimo
- Tiempo máximo
- Mediana
- Desviación estándar (consistencia)

### 3. Calidad de Extracción
- Precisión en la extracción de campos (personas, fecha, hora, nombre)
- Credibilidad de los datos extraídos
- Validación de restricciones del restaurante

### 4. Estabilidad
- Tasa de reintentos
- Consistencia en tiempos de respuesta
- Manejo de errores

### 5. Scores Combinados
- **Score General**: Calidad (60%) + Velocidad (30%) + Estabilidad (10%)
- **Score de Estabilidad**: Calidad (70%) + Estabilidad (20%) + Consistencia (10%)
- **Score de Velocidad**: Calidad (40%) + Velocidad (50%) + Estabilidad (10%)

## 🎯 Recomendaciones

El script de análisis genera recomendaciones basadas en diferentes criterios:

### Para Producción (Priorizando Estabilidad)
- **Modelo recomendado**: El modelo con mejor score de estabilidad
- **Razones**: Alta tasa de éxito, consistencia, calidad de extracción

### Para Desarrollo (Priorizando Velocidad)
- **Modelo recomendado**: El modelo con mejor score de velocidad
- **Razones**: Tiempos de respuesta rápidos, buena calidad

### Para Calidad (Priorizando Precisión)
- **Modelo recomendado**: El modelo con mejor calidad de extracción
- **Razones**: Alta precisión, credibilidad de datos, validación correcta

## 📝 Casos de Prueba

Los casos de prueba incluyen:
1. Reserva completa con fecha, hora y personas
2. Reserva con fecha específica y nombre
3. Reserva con fecha relativa (mañana)
4. Reserva con hora específica
5. Reserva con fecha y hora específicas

## ⚙️ Configuración

### Variables de Entorno
Asegúrate de tener configurado `GOOGLE_API_KEY` en tu archivo `.env`:

```env
GOOGLE_API_KEY=tu_api_key_aqui
```

### Configuración del Restaurante
El script usa la configuración del restaurante definida en `restaurantConfig`:
- Máximo de personas por reserva: 20
- Mínimo de personas por reserva: 1
- Horarios de servicio: 13:00-15:00 (comida), 19:00-23:00 (cena)
- Antelación mínima: 2 horas

## 📈 Interpretación de Resultados

### Tasa de Éxito
- **> 90%**: Excelente
- **70-90%**: Bueno
- **50-70%**: Aceptable
- **< 50%**: Malo

### Tiempo de Respuesta
- **< 2s**: Muy rápido
- **2-5s**: Rápido
- **5-10s**: Aceptable
- **> 10s**: Lento

### Calidad de Extracción
- **> 90%**: Excelente
- **70-90%**: Bueno
- **50-70%**: Aceptable
- **< 50%**: Malo

### Estabilidad
- **> 95%**: Muy estable
- **80-95%**: Estable
- **60-80%**: Aceptable
- **< 60%**: Inestable

## 🔍 Ejemplo de Uso

```bash
# 1. Ejecutar pruebas
node test-gemini-models.js

# Esperar a que termine (puede tardar 10-30 minutos dependiendo de los modelos disponibles)

# 2. Analizar resultados
node analyze-gemini-results.js gemini-test-results-2025-11-12_17-30-00.json

# 3. Revisar recomendaciones
# El script mostrará:
# - Mejor modelo general
# - Mejor para estabilidad
# - Mejor para velocidad
# - Mejor para calidad
# - Mejor balanceado
```

## 📊 Resultados Esperados

Basado en las pruebas anteriores, esperamos que:
- **gemini-2.5-flash** tenga la mejor estabilidad y precisión
- **gemini-2.0-flash-lite** tenga la mejor velocidad
- **gemini-1.5-pro** tenga la mejor calidad general

## 🐛 Solución de Problemas

### Error: "GOOGLE_API_KEY no está configurado"
- Verifica que el archivo `.env` existe y contiene `GOOGLE_API_KEY`
- Asegúrate de que el archivo `.env` está en el directorio raíz del proyecto

### Error: "Modelo no encontrado"
- Algunos modelos pueden no estar disponibles en tu región o proyecto
- El script continuará con los modelos disponibles

### Error: "Rate limit exceeded"
- El script maneja automáticamente los rate limits con reintentos
- Si persiste, espera unos minutos y vuelve a ejecutar

### Error: "Timeout al verificar disponibilidad"
- Algunos modelos pueden tardar más en responder
- El script continuará con los modelos disponibles

## 📚 Referencias

- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [Gemini Models Overview](https://ai.google.dev/models/gemini)
- [Gemini API Best Practices](https://ai.google.dev/docs/best_practices)

## 🎯 Próximos Pasos

1. Ejecutar las pruebas con todos los modelos
2. Analizar los resultados
3. Seleccionar el mejor modelo según nuestras necesidades
4. Actualizar el código de producción con el modelo seleccionado
5. Monitorear el rendimiento en producción

## 📝 Notas

- Los resultados pueden variar según la región, proyecto y configuración de la API
- Los tiempos de respuesta pueden variar según la carga del servidor
- Algunos modelos pueden no estar disponibles en todas las regiones
- Los modelos experimentales pueden tener limitaciones adicionales

