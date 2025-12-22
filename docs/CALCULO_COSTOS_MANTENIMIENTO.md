# 💰 Cálculo Total de Costos de Mantenimiento
## Restaurante con 1,000 Reservas Mensuales

---

## 📊 Resumen Ejecutivo

**Costo Total Mensual Estimado: $45 - $75 USD/mes**

Este cálculo incluye todos los servicios necesarios para operar el sistema de reservas telefónicas con IA.

---

## 🔢 Desglose Detallado de Costos

### 1. 📞 **Twilio (Llamadas Telefónicas)**

#### Costos Fijos:
- **Número de teléfono**: $1.50 USD/mes
  - Número español (+34) con capacidad de voz

#### Costos Variables (Llamadas):
- **Precio por minuto**: $0.013 USD/minuto (España, llamadas entrantes)
- **Duración promedio por llamada**: 1.75 minutos (105 segundos)
  - Basado en estadísticas: 90-120 segundos promedio
  - Incluye conversaciones exitosas y con correcciones

**Cálculo para 1,000 reservas/mes:**
```
1,000 reservas × 1.75 minutos = 1,750 minutos/mes
1,750 minutos × $0.013/minuto = $22.75 USD/mes
```

**Subtotal Twilio: $24.25 USD/mes**
- Fijo: $1.50 USD
- Variable: $22.75 USD

---

### 2. 🤖 **Google Vertex AI / Gemini 2.5 Flash Lite**

#### Modelo Utilizado:
- **Gemini 2.5 Flash Lite** (modelo optimizado para velocidad y costo)

#### Estimación de Uso:
- **Requests por reserva**: ~3-5 llamadas a Gemini
  - Análisis inicial de intención
  - Extracción de datos de la reserva (personas, fecha, hora, nombre)
  - Validación y confirmación
  - Detección de idioma (si aplica)

- **Promedio conservador**: 4 requests por reserva

#### Precios Estimados (Vertex AI):
- **Gemini 2.5 Flash Lite**: ~$0.075 por 1M tokens de entrada
- **Tokens promedio por request**: ~2,000 tokens (prompt + contexto)
- **Tokens promedio por reserva**: 4 requests × 2,000 tokens = 8,000 tokens

**Cálculo para 1,000 reservas/mes:**
```
1,000 reservas × 8,000 tokens = 8,000,000 tokens/mes
8,000,000 tokens ÷ 1,000,000 × $0.075 = $0.60 USD/mes
```

**Nota**: Los precios de Vertex AI pueden variar, pero Gemini Flash Lite es uno de los modelos más económicos.

**Subtotal Gemini/Vertex AI: $0.60 - $2.00 USD/mes**
- Estimación conservadora: $0.60 USD
- Estimación con margen: $2.00 USD

---

### 3. ☁️ **Vercel (Hosting/Serverless)**

#### Plan Necesario:
Con 1,000 reservas/mes, probablemente necesitarás el **Plan Pro**:

**Plan Hobby (Gratuito):**
- 100 GB-hours de compute
- 100 GB de bandwidth
- Puede ser insuficiente para 1,000 reservas/mes

**Plan Pro:**
- $20 USD/mes
- 1,000 GB-hours de compute
- 1,000 GB de bandwidth
- Incluye funciones serverless ilimitadas

**Estimación de uso:**
- Cada llamada genera ~5-10 webhooks (requests)
- 1,000 reservas × 7 webhooks promedio = 7,000 invocaciones/mes
- Duración promedio: 2-4 segundos por invocación
- Compute: 7,000 × 3s = 21,000 segundos = ~5.8 horas/mes
- Bandwidth: ~50 MB/mes (muy bajo)

**Subtotal Vercel: $0 - $20 USD/mes**
- Plan Hobby (si cabe): $0 USD
- Plan Pro (recomendado): $20 USD

---

### 4. 🗄️ **Base de Datos**

Según la documentación, la base de datos ya está funcionando sin costo adicional.

**Subtotal Base de Datos: $0 USD/mes**

---

### 5. 📧 **Servicios Adicionales (Opcionales)**

#### RCS (Rich Communication Services):
- Si se usa para confirmaciones: ~$0.01-0.02 por mensaje
- 1,000 confirmaciones/mes = $10-20 USD/mes
- **Opcional**: No incluido en el cálculo base

#### Email (SendGrid/Mailgun):
- Si se usa para confirmaciones: ~$0.0001 por email
- 1,000 emails/mes = $0.10 USD/mes
- **Opcional**: Incluido como mínimo

**Subtotal Servicios Adicionales: $0.10 - $20 USD/mes**
- Email básico: $0.10 USD
- RCS: $20 USD (opcional)

---

## 📈 **Cálculo Total Mensual**

### Escenario Conservador (Mínimo):
```
Twilio:              $24.25 USD
Gemini/Vertex AI:    $0.60 USD
Vercel (Hobby):      $0.00 USD
Base de Datos:       $0.00 USD
Email:               $0.10 USD
─────────────────────────────
TOTAL:               $24.95 USD/mes
```

### Escenario Realista (Recomendado):
```
Twilio:              $24.25 USD
Gemini/Vertex AI:    $2.00 USD
Vercel (Pro):        $20.00 USD
Base de Datos:       $0.00 USD
Email:               $0.10 USD
─────────────────────────────
TOTAL:               $46.35 USD/mes
```

### Escenario Completo (Con RCS):
```
Twilio:              $24.25 USD
Gemini/Vertex AI:    $2.00 USD
Vercel (Pro):        $20.00 USD
Base de Datos:       $0.00 USD
RCS Confirmaciones:  $20.00 USD
─────────────────────────────
TOTAL:               $66.25 USD/mes
```

---

## 💡 **Factores que Afectan el Costo**

### Variables que Aumentan Costos:
1. **Duración de llamadas más largas**
   - Si el promedio sube a 3 minutos: +$13 USD/mes
   
2. **Más requests a Gemini**
   - Si hay más correcciones/validaciones: +$1-2 USD/mes

3. **Tráfico adicional en Vercel**
   - Si se superan límites del plan gratuito: +$20 USD/mes

4. **Confirmaciones por RCS**
   - Si se activa: +$20 USD/mes

### Variables que Reducen Costos:
1. **Optimización de llamadas**
   - Reducir duración promedio: -$5-10 USD/mes
   
2. **Cache más efectivo**
   - Reducir requests a Gemini: -$0.50-1 USD/mes

3. **Plan Hobby de Vercel**
   - Si cabe en el plan gratuito: -$20 USD/mes

---

## 📊 **Proyección Anual**

### Escenario Realista:
```
Costo mensual: $46.35 USD
Costo anual:   $556.20 USD
```

### Escenario Completo (con RCS):
```
Costo mensual: $66.25 USD
Costo anual:   $795.00 USD
```

---

## 🎯 **Recomendaciones**

### Para Optimizar Costos:

1. **Monitorear duración de llamadas**
   - Objetivo: mantener promedio < 2 minutos
   - Ahorro potencial: $5-10 USD/mes

2. **Optimizar cache de Gemini**
   - Reducir requests duplicados
   - Ahorro potencial: $0.50-1 USD/mes

3. **Evaluar necesidad de Vercel Pro**
   - Si el plan Hobby es suficiente: ahorro de $20 USD/mes

4. **Considerar RCS solo si es necesario**
   - Email es más económico para confirmaciones
   - Ahorro potencial: $20 USD/mes

### Para Escalar:

Si el restaurante crece a **2,000 reservas/mes**:
- Twilio: ~$48 USD/mes
- Gemini: ~$4 USD/mes
- Vercel: $20 USD/mes
- **Total: ~$72 USD/mes**

Si el restaurante crece a **5,000 reservas/mes**:
- Twilio: ~$120 USD/mes
- Gemini: ~$10 USD/mes
- Vercel: $20 USD/mes
- **Total: ~$150 USD/mes**

---

## ✅ **Conclusión**

Para un restaurante con **1,000 reservas mensuales**, el costo total de mantenimiento del sistema de reservas telefónicas con IA es aproximadamente:

**$45 - $75 USD/mes** (dependiendo de configuración)

Esto representa un costo de **$0.045 - $0.075 USD por reserva**, lo cual es extremadamente competitivo comparado con:
- Personal de recepción: $15-25 USD/hora
- Sistemas tradicionales: $100-300 USD/mes
- Costo de oportunidad de reservas perdidas: incalculable

---

## 📝 **Notas Importantes**

1. **Precios en USD**: Todos los precios están en dólares estadounidenses
2. **Precios variables**: Los precios de Twilio y Vertex AI pueden variar según región y volumen
3. **Factores externos**: No incluye costos de desarrollo, mantenimiento de código, o soporte técnico
4. **Actualización**: Este cálculo está basado en precios de 2024 y puede cambiar

---

**Última actualización**: Diciembre 2024

