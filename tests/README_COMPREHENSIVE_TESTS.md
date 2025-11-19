# Script de Tests Exhaustivos

Este script prueba el sistema de reservas al límite con múltiples escenarios reales y casos edge.

## Características

- **40+ casos de test** cubriendo todos los flujos principales
- **8 grupos de tests** organizados por funcionalidad
- **Validación automática** de respuestas
- **Estadísticas detalladas** de ejecución
- **Modo verbose** para debugging

## Grupos de Tests

### Grupo 1: Creación de Reservas - Casos Normales
- Flujo normal completo paso a paso
- Toda la información proporcionada de una vez
- Información parcial proporcionada gradualmente

### Grupo 2: Creación de Reservas - Casos Límite
- Máximo y mínimo de personas
- Fechas inválidas o pasadas
- Horarios fuera del rango permitido
- Reservas muy próximas (menos de 2 horas)
- Inputs vacíos o ambiguos

### Grupo 3: Modificación de Reservas
- Modificar fecha, hora, número de personas
- Casos sin reservas existentes
- Flujos completos de modificación

### Grupo 4: Cancelación de Reservas
- Cancelación de reserva única
- Selección entre múltiples reservas
- Cancelar la cancelación (cambio de opinión)

### Grupo 5: Pedidos
- Flujo completo de pedido
- Múltiples items
- Modificación de items durante el pedido

### Grupo 6: Diferentes Idiomas
- Español (por defecto)
- Inglés
- Alemán

### Grupo 7: Casos de Error y Límites
- Sin CallSid
- Teléfonos inválidos
- Inputs muy largos
- Caracteres especiales
- Números escritos en texto
- Inputs muy rápidos
- Flujos interrumpidos

### Grupo 8: Casos Mixtos y Complejos
- Reserva seguida de cancelación
- Múltiples conversaciones simultáneas

## Uso

### Ejecución Básica
```bash
node tests/test_comprehensive_scenarios.js
```

### Modo Verbose (más detalles)
```bash
node tests/test_comprehensive_scenarios.js --verbose
```

### Ejecución Directa
```bash
./tests/test_comprehensive_scenarios.js
```

## Salida

El script muestra:
- ✅ Tests pasados (verde)
- ❌ Tests fallidos (rojo)
- 💥 Errores (rojo)
- 📊 Resumen final con estadísticas

### Ejemplo de Salida
```
🚀 INICIANDO TESTS EXHAUSTIVOS DEL SISTEMA
================================================================================

📋 GRUPO 1: Creación de Reservas - Casos Normales
🧪 [12:34:56] TEST: Reserva - Flujo Normal Completo
✅ [12:34:57] PASSED: Reserva - Flujo Normal Completo
...

📊 RESUMEN DE TESTS
================================================================================
Total de tests: 40
Pasados: 38
Fallidos: 2
Errores: 0
Tiempo total: 45.23s
Promedio por test: 1.13s
Tasa de éxito: 95.0%
```

## Requisitos

- Node.js 20.x o superior
- Variables de entorno configuradas (GOOGLE_APPLICATION_CREDENTIALS_JSON, etc.)
- Base de datos accesible
- El handler debe estar en `api/twilio-call-gemini.js`

## Notas

- Los tests usan CallSids únicos generados con timestamp
- Cada test simula una conversación completa
- Los tests no afectan datos reales (usa CallSids de test)
- Algunos tests pueden fallar si no hay datos de prueba en la BD

## Troubleshooting

### Error: "Cannot find module"
Asegúrate de estar en el directorio raíz del proyecto.

### Tests fallan por falta de datos
Algunos tests (modificación, cancelación) requieren reservas existentes en la BD. 
Puedes crear datos de prueba o modificar los tests para usar teléfonos con reservas.

### Timeout en tests
Si los tests tardan mucho, puede ser por:
- Latencia de la BD
- Llamadas a Gemini API
- Configuración de timeouts

Aumenta los timeouts o revisa la configuración de la BD.

