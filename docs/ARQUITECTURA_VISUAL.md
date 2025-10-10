# 🏗️ Arquitectura Visual del Sistema Twilio

Este documento presenta diagramas y visualizaciones de la arquitectura del sistema.

---

## 📊 Diagrama de Arquitectura General

```
┌─────────────────┐
│                 │
│     CLIENTE     │
│   (Teléfono)    │
│                 │
└────────┬────────┘
         │ Llama al número
         │ +34 XXX XXX XXX
         ↓
┌─────────────────────────────────────────────┐
│                                             │
│              TWILIO CLOUD                   │
│                                             │
│  • Recibe llamada                          │
│  • Speech-to-Text (voz → texto)           │
│  • Text-to-Speech (texto → voz)           │
│  • Gestión de llamada                      │
│                                             │
└────────┬────────────────────────────────────┘
         │ HTTP POST
         │ /api/twilio-call
         ↓
┌─────────────────────────────────────────────┐
│                                             │
│           VERCEL SERVERLESS                 │
│        (api/twilio-call.js)                │
│                                             │
│  • Procesa conversación                    │
│  • Valida datos                            │
│  • Extrae información                      │
│  • Genera respuestas TwiML                 │
│                                             │
└────────┬────────────────────────────────────┘
         │ SQL Queries
         │ INSERT/UPDATE
         ↓
┌─────────────────────────────────────────────┐
│                                             │
│          BASE DE DATOS MySQL                │
│            (db1.bwai.cc)                   │
│                                             │
│  • Tabla RESERVA (datos de reservas)      │
│  • Tabla CLIENT (datos de clientes)       │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🔄 Diagrama de Flujo de Conversación

```
        START
          ↓
    ┌─────────────┐
    │  GREETING   │ → "¡Hola! ¿Para cuántas personas?"
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │ ASK_PEOPLE  │ → "Excelente, mesa para X. ¿Qué fecha?"
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │  ASK_DATE   │ → "Perfecto, fecha X. ¿Qué hora?"
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │  ASK_TIME   │ → "Excelente, hora X. ¿Su nombre?"
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │  ASK_NAME   │ → "Perfecto. Confirmo: [datos]?"
    └──────┬──────┘
           ↓
    ┌─────────────┐
    │   CONFIRM   │ → ¿Sí o No?
    └──────┬──────┘
           │
      ┌────┴────┐
      │         │
     Sí        No
      │         │
      ↓         └──→ Volver a ASK_PEOPLE
    ┌─────────────┐
    │  COMPLETE   │ → Guardar en BD + Despedida
    └──────┬──────┘
           ↓
         END
```

---

## 🔁 Diagrama de Ciclo Petición-Respuesta

```
┌────────────┐                           ┌──────────────┐
│            │    1. Llamada entrante    │              │
│  CLIENTE   │ ────────────────────────→ │    TWILIO    │
│            │                           │              │
└────────────┘                           └──────┬───────┘
                                                │
                                                │ 2. POST con CallSid
                                                ↓
                                         ┌──────────────┐
                                         │              │
                                         │    VERCEL    │
                                         │              │
                                         └──────┬───────┘
                                                │
                                                │ 3. Respuesta TwiML
                                                ↓
┌────────────┐                           ┌──────────────┐
│            │    4. Reproduce audio     │              │
│  CLIENTE   │ ←──────────────────────── │    TWILIO    │
│            │                           │              │
└──────┬─────┘                           └──────────────┘
       │
       │ 5. Cliente habla
       ↓
┌────────────┐                           ┌──────────────┐
│            │    6. Audio capturado     │              │
│  CLIENTE   │ ────────────────────────→ │    TWILIO    │
│            │                           │  (Speech-to- │
└────────────┘                           │    Text)     │
                                         └──────┬───────┘
                                                │
                                                │ 7. POST con SpeechResult
                                                ↓
                                         ┌──────────────┐
                                         │              │
                                         │    VERCEL    │
                                         │   (procesa)  │
                                         └──────┬───────┘
                                                │
       [Repite ciclo hasta COMPLETE]            │ 8. Respuesta TwiML
                                                ↓
```

---

## 🗄️ Diagrama de Base de Datos

```
┌─────────────────────────────────────────┐
│             Tabla: CLIENT               │
├─────────────────────────────────────────┤
│ TELEFON (PK)           VARCHAR(20)      │
│ NOM_COMPLET            VARCHAR(100)     │
│ DATA_ULTIMA_RESERVA    DATETIME         │
└─────────────────────────────────────────┘
                   │
                   │ Relación: TELEFON
                   │
┌─────────────────────────────────────────┐
│            Tabla: RESERVA               │
├─────────────────────────────────────────┤
│ id_reserva (PK)        INT AUTO_INC     │
│ data_reserva           DATETIME         │
│ num_persones           INT              │
│ telefon (FK)           VARCHAR(20) ────┘
│ nom_persona_reserva    VARCHAR(100)     │
│ observacions           TEXT             │
│ conversa_completa      TEXT (JSON)      │
│ created_at             TIMESTAMP        │
└─────────────────────────────────────────┘
```

---

## 📦 Diagrama de Componentes

```
┌───────────────────────────────────────────────────────┐
│                   SISTEMA COMPLETO                    │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │         Capa de Comunicación                │    │
│  ├─────────────────────────────────────────────┤    │
│  │  • Twilio Voice API                         │    │
│  │  • Amazon Polly (Text-to-Speech)            │    │
│  │  • Google Speech (Speech-to-Text)           │    │
│  └─────────────────────────────────────────────┘    │
│                        ↕                             │
│  ┌─────────────────────────────────────────────┐    │
│  │         Capa de Aplicación                  │    │
│  ├─────────────────────────────────────────────┤    │
│  │  • api/twilio-call.js (Endpoint)            │    │
│  │  • Gestión de estado conversacional         │    │
│  │  • Validación de datos                      │    │
│  │  • Extracción de información                │    │
│  │  • Generación de TwiML                      │    │
│  └─────────────────────────────────────────────┘    │
│                        ↕                             │
│  ┌─────────────────────────────────────────────┐    │
│  │         Capa de Utilidades                  │    │
│  ├─────────────────────────────────────────────┤    │
│  │  • lib/database.js (Conexión MySQL)         │    │
│  │  • lib/utils.js (Validación y formato)      │    │
│  └─────────────────────────────────────────────┘    │
│                        ↕                             │
│  ┌─────────────────────────────────────────────┐    │
│  │         Capa de Datos                       │    │
│  ├─────────────────────────────────────────────┤    │
│  │  • MySQL 8.0 (db1.bwai.cc)                  │    │
│  │  • Tabla RESERVA                            │    │
│  │  • Tabla CLIENT                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 🎯 Diagrama de Casos de Uso

```
          ┌─────────────────┐
          │     CLIENTE     │
          └────────┬────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ↓          ↓          ↓
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Hacer   │ │ Modificar│ │ Cancelar │
│  Reserva │ │  Datos   │ │ Llamada  │
└──────────┘ └──────────┘ └──────────┘
        │          │          │
        └──────────┼──────────┘
                   ↓
          ┌─────────────────┐
          │   SISTEMA BOT   │
          └────────┬────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ↓          ↓          ↓
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Validar  │ │ Guardar  │ │ Confirmar│
│  Datos   │ │   en BD  │ │  Cliente │
└──────────┘ └──────────┘ └──────────┘
```

---

## 🔐 Diagrama de Seguridad

```
┌─────────────┐
│   CLIENTE   │
└──────┬──────┘
       │
       │ HTTPS (TLS 1.3)
       ↓
┌─────────────┐
│   TWILIO    │ ← [Auth: Firma HMAC]
└──────┬──────┘
       │
       │ HTTPS (TLS 1.3)
       ↓
┌─────────────┐
│   VERCEL    │ ← [Variables de Entorno Cifradas]
└──────┬──────┘
       │
       │ MySQL SSL
       ↓
┌─────────────┐
│    MySQL    │ ← [Credenciales Seguras]
└─────────────┘

Capas de Seguridad:
1. ✓ Comunicación cifrada end-to-end
2. ✓ Validación de entrada de datos
3. ✓ Escape de caracteres en SQL
4. ✓ Transacciones para integridad
5. ○ Validación de firma Twilio (opcional, no implementada)
```

---

## 📊 Diagrama de Estados de Conversación

```
       ┌──────────────────┐
       │     INICIO       │
       │   (CallSid)      │
       └────────┬─────────┘
                ↓
       ┌──────────────────┐
       │    state = {     │
       │  step: 'greeting'│
       │  data: {}        │
       │  phone: '+34...' │
       │  history: []     │
       │    }             │
       └────────┬─────────┘
                │
    [Para cada interacción]
                │
                ↓
       ┌──────────────────┐
       │ Actualizar step  │
       │ Añadir a data    │
       │ Guardar en       │
       │ history          │
       └────────┬─────────┘
                │
                ↓
       ┌──────────────────┐
       │ step='complete'  │
       │ data={...todos}  │
       └────────┬─────────┘
                │
                ↓
       ┌──────────────────┐
       │   GUARDAR EN BD  │
       └────────┬─────────┘
                │
                ↓
       ┌──────────────────┐
       │   LIMPIAR STATE  │
       │  (después 60s)   │
       └──────────────────┘
```

---

## 🧩 Diagrama de Módulos

```
┌─────────────────────────────────────────────────────┐
│                api/twilio-call.js                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  handler(req, res)                                  │
│    ↓                                                │
│  processConversationStep(state, input)              │
│    ├─→ isReservationRequest()                       │
│    ├─→ extractPeopleCount()                         │
│    ├─→ extractDate()                                │
│    ├─→ extractTime()                                │
│    ├─→ extractName()                                │
│    └─→ getConfirmationMessage()                     │
│    ↓                                                │
│  generateTwiML(response)                            │
│    └─→ escapeXml()                                  │
│    ↓                                                │
│  saveReservation(state)                             │
│    ├─→ validarReserva()      [lib/utils.js]        │
│    ├─→ combinarFechaHora()   [lib/utils.js]        │
│    └─→ createConnection()    [lib/database.js]     │
│                                                     │
└─────────────────────────────────────────────────────┘
           ↓                           ↓
┌──────────────────┐      ┌───────────────────────┐
│  lib/utils.js    │      │  lib/database.js      │
├──────────────────┤      ├───────────────────────┤
│                  │      │                       │
│ validarReserva() │      │ createConnection()    │
│ combinarFechaHora│      │ executeQuery()        │
│ formatearFecha() │      │ beginTransaction()    │
│ formatearHora()  │      │ commit()              │
│                  │      │ rollback()            │
└──────────────────┘      └───────────────────────┘
```

---

## 📈 Diagrama de Escalabilidad

```
       Llamadas Concurrentes
              ↓
┌─────────────────────────────────┐
│      TWILIO (ilimitado)         │
└────────┬────────────────────────┘
         │
         ↓ Distribuye carga
┌─────────────────────────────────┐
│   VERCEL SERVERLESS FUNCTIONS   │
│                                 │
│  ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ λ1   │ │ λ2   │ │ λN   │   │ ← Escala automáticamente
│  └───┬──┘ └───┬──┘ └───┬──┘   │
└──────┼────────┼────────┼────────┘
       │        │        │
       └────────┼────────┘
                ↓
┌─────────────────────────────────┐
│      MySQL Connection Pool      │
│                                 │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│  │conn│ │conn│ │conn│ │conn│  │
│  └────┘ └────┘ └────┘ └────┘  │
└────────┬────────────────────────┘
         │
         ↓
┌─────────────────────────────────┐
│         MySQL Database          │
│         (db1.bwai.cc)           │
└─────────────────────────────────┘

Capacidad estimada:
• Twilio: 1000+ llamadas simultáneas
• Vercel: Auto-escala según demanda
• MySQL: ~100 conexiones concurrentes
```

---

## 🔄 Diagrama de Ciclo de Vida de Llamada

```
┌────────────┐
│   START    │
│ (incoming) │
└──────┬─────┘
       │
       ↓
┌────────────┐
│   RINGING  │ ← Twilio recibe llamada
└──────┬─────┘
       │
       ↓
┌────────────┐
│IN-PROGRESS │ ← Cliente conectado
└──────┬─────┘
       │
       ├─→ [Loop de conversación]
       │     1. POST al webhook
       │     2. Recibe TwiML
       │     3. Reproduce audio
       │     4. Captura speech
       │     5. Transcribe
       │     6. Repite...
       │
       ↓
┌────────────┐
│ COMPLETED  │ ← Llamada exitosa
└──────┬─────┘
       │
       ↓
┌────────────┐
│    END     │
└────────────┘

Otros estados posibles:
• BUSY       (línea ocupada)
• NO-ANSWER  (no contestó)
• FAILED     (error técnico)
• CANCELED   (cancelado por cliente)
```

---

## 💾 Diagrama de Persistencia de Datos

```
┌─────────────────┐
│  Conversación   │
│    En Curso     │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  Memoria (Map)  │ ← Estado temporal durante llamada
│  CallSid: {...} │
└────────┬────────┘
         │
         │ Cuando step='complete'
         ↓
┌─────────────────┐
│  Base de Datos  │ ← Persistencia permanente
├─────────────────┤
│ • RESERVA       │
│ • CLIENT        │
└─────────────────┘
         │
         │ Limpieza después de 60s
         ↓
┌─────────────────┐
│  Memoria vacía  │ ← Libera recursos
└─────────────────┘

Nota: El estado en memoria se usa solo durante la llamada.
Una vez guardado en BD, se puede limpiar.
```

---

## 🎨 Diagrama de Experiencia de Usuario

```
Cliente                                   Bot

  📞 Marca número
       │
       └─────────────────────────→
                                   🔔 Recibe llamada
       ←─────────────────────────┘
  🔊 Escucha saludo              🤖 "¡Hola! ¿Para cuántas..."
       │
  🗣️ "Cuatro"
       │
       └─────────────────────────→
                                   📝 Procesa
       ←─────────────────────────┘
  🔊 Escucha pregunta            🤖 "¿Qué fecha?"
       │
  🗣️ "Mañana"
       │
       └─────────────────────────→
                                   📝 Procesa
       ←─────────────────────────┘
  🔊 Escucha pregunta            🤖 "¿Qué hora?"
       │
  🗣️ "Ocho"
       │
       └─────────────────────────→
                                   📝 Procesa
       ←─────────────────────────┘
  🔊 Escucha pregunta            🤖 "¿Su nombre?"
       │
  🗣️ "Juan"
       │
       └─────────────────────────→
                                   📝 Procesa
       ←─────────────────────────┘
  🔊 Escucha confirmación        🤖 "Confirmo: [datos]?"
       │
  🗣️ "Sí"
       │
       └─────────────────────────→
                                   💾 Guarda en BD
       ←─────────────────────────┘
  🔊 Escucha despedida           🤖 "¡Confirmado! Adiós"
       │
  📴 Cuelga automático           🔚 Termina llamada
```

---

## 🔧 Diagrama de Configuración

```
┌─────────────────────────────────────────────────┐
│              CONFIGURACIÓN INICIAL              │
└─────────────────────────────────────────────────┘
                        ↓
        ┌───────────────┼───────────────┐
        │               │               │
        ↓               ↓               ↓
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│    TWILIO    │ │    VERCEL    │ │    CÓDIGO    │
├──────────────┤ ├──────────────┤ ├──────────────┤
│              │ │              │ │              │
│ 1. Crear     │ │ 1. Conectar  │ │ 1. Commit y  │
│    cuenta    │ │    GitHub    │ │    push      │
│              │ │              │ │              │
│ 2. Obtener   │ │ 2. Importar  │ │ 2. Vercel    │
│    número    │ │    proyecto  │ │    despliega │
│              │ │              │ │              │
│ 3. Configurar│ │ 3. Variables │ │ 3. Obtener   │
│    webhook   │ │    de entorno│ │    URL       │
│              │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
        │               │               │
        └───────────────┼───────────────┘
                        ↓
        ┌───────────────────────────────┐
        │    SISTEMA FUNCIONANDO        │
        └───────────────────────────────┘
```

---

## 🧪 Diagrama de Flujo de Pruebas

```
                ┌──────────┐
                │  INICIO  │
                └────┬─────┘
                     │
          ┌──────────┴──────────┐
          │                     │
          ↓                     ↓
    ┌──────────┐          ┌──────────┐
    │ Prueba   │          │ Prueba   │
    │Automática│          │  Manual  │
    └────┬─────┘          └────┬─────┘
         │                     │
         ↓                     ↓
    ┌──────────┐          ┌──────────┐
    │  Script  │          │ Llamada  │
    │  Node.js │          │   Real   │
    └────┬─────┘          └────┬─────┘
         │                     │
         ↓                     ↓
    ┌──────────┐          ┌──────────┐
    │ Simula   │          │ Hablar   │
    │peticiones│          │  con bot │
    └────┬─────┘          └────┬─────┘
         │                     │
         ↓                     ↓
    ┌──────────┐          ┌──────────┐
    │ Verifica │          │ Verificar│
    │respuestas│          │   en BD  │
    └────┬─────┘          └────┬─────┘
         │                     │
         └──────────┬──────────┘
                    ↓
              ┌──────────┐
              │   LOGS   │
              │          │
              │ • Vercel │
              │ • Twilio │
              │ • MySQL  │
              └────┬─────┘
                   ↓
              ┌──────────┐
              │   ÉXITO  │
              └──────────┘
```

---

## 📋 Checklist Visual de Implementación

```
┌───────────────────────────────────────────┐
│         ESTADO DE IMPLEMENTACIÓN         │
├───────────────────────────────────────────┤
│                                           │
│  [✅] Endpoint API creado                │
│  [✅] Lógica de conversación             │
│  [✅] Extracción de datos                │
│  [✅] Validación de entrada              │
│  [✅] Generación de TwiML                │
│  [✅] Integración con BD                 │
│  [✅] Manejo de errores                  │
│  [✅] Documentación completa             │
│  [✅] Script de pruebas                  │
│  [✅] Ejemplos de conversaciones         │
│                                           │
│  [⏳] Configuración de Twilio (usuario)  │
│  [⏳] Despliegue en Vercel (usuario)     │
│  [⏳] Pruebas de llamada real (usuario)  │
│                                           │
└───────────────────────────────────────────┘

Leyenda:
  ✅ Completado
  ⏳ Pendiente (usuario)
  ❌ No realizado
```

---

**Documento creado**: 2025-10-08  
**Última actualización**: 2025-10-08  
**Versión**: 1.0.0

---

Este documento proporciona una visión visual completa de cómo funciona el sistema de reservas telefónicas con Twilio. Usa estos diagramas para comprender mejor la arquitectura y explicarla a tu equipo. 🎯

