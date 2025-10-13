# 🎤 Simulador de Voz - Guía de Uso

Este simulador te permite probar el sistema de reservas **sin gastar créditos de Twilio**, usando exactamente la misma voz y flujo que en producción.

## 🎯 Características

✅ **Misma voz que Twilio**: Google Neural2-A (femenina, natural)
✅ **Mismo flujo de conversación**: Idéntico a las llamadas reales
✅ **Sin costos**: No usa créditos de Twilio ni minutos telefónicos
✅ **Graba y transcribe**: Usa tu micrófono para respuestas reales
✅ **Reproduce voz**: Escuchas las respuestas del bot

## 📋 Requisitos Previos

### 1. Instalar Dependencias Python

```bash
pip install -r requirements.txt
pip install pygame  # Para reproducir audio
```

### 2. Configurar Credenciales de Google Cloud

Necesitas un archivo de credenciales de Google Cloud para Speech-to-Text y Text-to-Speech:

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un proyecto (o usa uno existente)
3. Habilita las APIs:
   - Cloud Speech-to-Text API
   - Cloud Text-to-Speech API
4. Crea una cuenta de servicio y descarga el JSON
5. Guarda el archivo en `credentials/service-account.json`

### 3. Configurar Variables de Entorno

Crea o actualiza tu archivo `.env`:

```env
GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
WEBHOOK_URL=https://tu-proyecto.vercel.app/api/webhook
```

## 🚀 Cómo Usar el Simulador

### Iniciar el Simulador

```bash
cd d:\cronosai-webhook
python src/voice_conversational_simulator.py
```

### Flujo de Uso

1. **El simulador inicia** y muestra las instrucciones
2. **El bot habla primero**: "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?"
3. **Presiona ENTER** cuando quieras responder
4. **Habla tu respuesta** (tienes 5 segundos)
5. **El bot procesa** tu respuesta y responde
6. **Repite** hasta completar la reserva

### Comandos

- **ENTER**: Grabar tu respuesta por voz
- **'salir'**: Terminar la simulación

## 💬 Ejemplo de Conversación

```
🤖 Sistema: ¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?
👤 Tú: Me gustaría reservar una mesa

🤖 Sistema: ¡Perfecto! Encantado de ayudarle con su reserva. ¿Para cuántas personas?
👤 Tú: Para 4

🤖 Sistema: Perfecto, 4 personas. ¿Para qué fecha?
👤 Tú: El 15 de noviembre

🤖 Sistema: Perfecto, 15 de noviembre. ¿A qué hora?
👤 Tú: A las nueve de la noche

🤖 Sistema: Perfecto, a las 21:00. ¿Su nombre?
👤 Tú: Juan García

🤖 Sistema: Perfecto, Juan García. ¿Desea usar este número de teléfono para la reserva, o prefiere indicar otro?
👤 Tú: Este mismo

🤖 Sistema: Confirmo: 4 personas, 15 de noviembre a las 21:00, a nombre de Juan García, 
            teléfono seis cero cero cero cero cero cero cero cero cero. ¿Es correcto?
👤 Tú: Sí

🤖 Sistema: ¡Perfecto! Su reserva está confirmada. Le esperamos. ¡Buen día!
```

## 🎭 Funcionalidades Avanzadas

### Reconocimiento de Fechas

El simulador entiende:

**Fechas relativas:**
- "hoy"
- "mañana"
- "pasado mañana"

**Días de la semana:**
- "el viernes"
- "el viernes que viene"
- "el próximo martes"

**Fechas con mes:**
- "10 de octubre"
- "15 de noviembre"
- "25 de diciembre"

**Fechas numéricas:**
- "10/10"
- "15-11"

### Reconocimiento de Correcciones

Si te equivocas, puedes corregirte:

```
👤 Tú: Para 3... no, mejor para 4
🤖 Bot: Detecta "4" correctamente

👤 Tú: A las 8... espera, mejor a las 9
🤖 Bot: Detecta "9" correctamente
```

### Opción de Teléfono

```
🤖 Bot: ¿Desea usar este número de teléfono para la reserva, o prefiere indicar otro?

Opciones válidas:
👤 "Este" / "Este mismo" / "Sí" / "Vale" / "Ok"
   → Usa el teléfono simulado (+34600000000)

👤 "Otro" / "Diferente" / "No"
   → Bot pregunta: "¿Qué número de teléfono prefiere?"
   
👤 Dices el número directamente: "600123456"
   → Lo registra automáticamente
```

## 🔧 Solución de Problemas

### Error: "Credenciales de Google Cloud no encontradas"

**Solución:**
1. Verifica que existe `credentials/service-account.json`
2. Verifica que `.env` tiene `GOOGLE_APPLICATION_CREDENTIALS`
3. Verifica que las APIs están habilitadas en Google Cloud

### Error: "No se pudo transcribir el audio"

**Posibles causas:**
- Micrófono no configurado
- Hablas muy bajo
- Ruido de fondo excesivo

**Solución:**
- Verifica tu micrófono en configuración de Windows
- Habla más cerca del micrófono
- Reduce el ruido de fondo

### Error: "Error reproduciendo audio"

**Solución:**
```bash
pip install pygame
```

### El bot no entiende los meses

**Asegúrate de decir:**
- "diez de octubre" (no "10 octubre")
- "quince de noviembre" (no "15 11")

## 📊 Comparación con Twilio

| Característica | Simulador | Twilio Real |
|----------------|-----------|-------------|
| **Voz** | Google Neural2-A | Google Neural2-A |
| **Flujo** | Idéntico | Idéntico |
| **Reconocimiento** | Idéntico | Idéntico |
| **Costo** | ❌ Gratis | 💰 $0.005/min |
| **Requiere llamada** | ❌ No | ✅ Sí |
| **Pruebas ilimitadas** | ✅ Sí | ❌ No |

## 💡 Consejos para Mejores Resultados

1. **Habla claro y despacio** - El reconocimiento de voz es mejor
2. **Ambiente silencioso** - Reduce el ruido de fondo
3. **Micrófono cerca** - Mejor captación de voz
4. **Usa frases naturales** - Como si hablaras por teléfono

## 🎯 Casos de Uso

### Para Desarrolladores
- Probar cambios sin costo
- Debugear flujos de conversación
- Validar reconocimiento de fechas/horas

### Para QA/Testing
- Probar todos los escenarios
- Verificar manejo de errores
- Validar experiencia de usuario

### Para Demo
- Mostrar el sistema sin hacer llamadas
- Presentaciones a clientes
- Capacitación de personal

## 📞 Diferencias con Llamada Real

El simulador es **casi idéntico** a una llamada real, excepto:

1. **Teléfono fijo**: El simulador usa un teléfono simulado (+34600000000)
2. **Grabación manual**: Presionas ENTER para grabar (en Twilio es automático)
3. **Sin latencia de red**: El simulador es más rápido

## 🔄 Próximos Pasos

Una vez que el sistema funciona bien en el simulador:

1. ✅ Todos los tests pasan en simulador
2. 📞 Hacer una llamada de prueba a Twilio
3. 🎯 Ajustar si hay diferencias
4. 🚀 Lanzar a producción

---

**¿Problemas?** Abre un issue en GitHub o consulta la documentación completa.

