/**
 * Script de prueba para comparar diferentes modelos de Gemini
 * Prueba velocidad y calidad de extracción de información
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Modelos a probar (solo los disponibles en v1beta)
const MODELS_TO_TEST = [
  'gemini-2.0-flash-lite',
  'gemini-2.5-flash'
];

// Textos de prueba (simulando diferentes casos reales)
const TEST_TEXTS = [
  "Me gustaría reservar una mesa para mañana a las 5 de la tarde para tres personas, por favor.",
  "Quiero reservar para el 15 de diciembre a las 2 de la tarde para 4 personas a nombre de Juan Pérez",
  "Reserva para mañana a las 8 de la noche para dos personas",
  "Quiero hacer una reserva para 5 personas para pasado mañana a las 14:30",
  "Reservar mesa para hoy a las 13:00 para una persona"
];

// Configuración del restaurante (simulada)
const restaurantConfig = {
  maxPersonasMesa: 20,
  minPersonas: 1,
  horario1Inicio: null,
  horario1Fin: null,
  horario2Inicio: '13:00',
  horario2Fin: '15:00',
  horario3Inicio: '19:00',
  horario3Fin: '23:00',
  minAntelacionHoras: 2
};

// Funciones auxiliares
function getTomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getDayAfterTomorrowDate() {
  const dayAfter = new Date();
  dayAfter.setDate(dayAfter.getDate() + 2);
  return dayAfter.toISOString().split('T')[0];
}

function formatMenuForPrompt(menuItems) {
  if (!menuItems || menuItems.length === 0) {
    return 'No hay menú disponible.';
  }
  return menuItems.map(item => `  - ${item.nombre}: ${item.precio}€`).join('\n');
}

// Función para construir el prompt (igual que en el código real)
function buildPrompt(userInput, restaurantConfig) {
  const now = new Date();
  const currentDateTime = now.toISOString().replace('T', ' ').substring(0, 19);
  const tomorrow = getTomorrowDate();
  const dayAfterTomorrow = getDayAfterTomorrowDate();
  
  const horariosInfo = [];
  if (restaurantConfig.horario1Inicio && restaurantConfig.horario1Fin) {
    horariosInfo.push(`  - Desayuno: ${restaurantConfig.horario1Inicio} - ${restaurantConfig.horario1Fin}`);
  }
  if (restaurantConfig.horario2Inicio && restaurantConfig.horario2Fin) {
    horariosInfo.push(`  - Comida: ${restaurantConfig.horario2Inicio} - ${restaurantConfig.horario2Fin}`);
  }
  if (restaurantConfig.horario3Inicio && restaurantConfig.horario3Fin) {
    horariosInfo.push(`  - Cena: ${restaurantConfig.horario3Inicio} - ${restaurantConfig.horario3Fin}`);
  }
  const horariosStr = horariosInfo.length > 0 ? horariosInfo.join('\n') : '  - Comida: 13:00 - 15:00\n  - Cena: 19:00 - 23:00';
  const menuStr = formatMenuForPrompt([]); // Sin menú para simplificar
  
  return `## MISIÓN
Eres un experto analizador de texto especializado en extraer información de reservas de restaurante.
Tu objetivo es analizar UNA SOLA frase del cliente y extraer TODO lo que puedas de ella, VALIDANDO contra las restricciones del restaurante.

## CONTEXTO ACTUAL
- Fecha y hora actual: ${currentDateTime}
- Fecha de mañana: ${tomorrow}
- Fecha de pasado mañana: ${dayAfterTomorrow}

## CONFIGURACIÓN DEL RESTAURANTE
- Máximo de personas por reserva: ${restaurantConfig.maxPersonasMesa}
- Mínimo de personas por reserva: ${restaurantConfig.minPersonas}
- Horarios de servicio:
${horariosStr}
- Antelación mínima requerida: ${restaurantConfig.minAntelacionHoras} horas

## MENÚ DISPONIBLE (PEDIDOS A DOMICILIO)
${menuStr}

## TEXTO A ANALIZAR
"${userInput}"

## REGLAS CRÍTICAS
1. NO INVENTES información. Si no está en el texto, devuelve null.
2. Si NO estás seguro, usa porcentaje de credibilidad bajo (0% o 50%).
3. Si estás muy seguro, usa 100%.
4. VALIDA contra las restricciones del restaurante:
   - Si el número de comensales es mayor a ${restaurantConfig.maxPersonasMesa}, marca "comensales_validos": "false" y "comensales_error": "max_exceeded"
   - Si el número de comensales es menor a ${restaurantConfig.minPersonas}, marca "comensales_validos": "false" y "comensales_error": "min_not_met"
   - VALIDACIÓN DE HORA (MUY IMPORTANTE): 
     * Si la hora extraída está DENTRO de alguno de los horarios de servicio listados arriba, marca "hora_disponible": "true"
     * Si la hora extraída está FUERA de todos los horarios de servicio, marca "hora_disponible": "false" y "hora_error": "fuera_horario"
     * Ejemplos:
       - Si la hora es 14:00 y hay horario de comida 13:00-15:00, entonces está DENTRO → "hora_disponible": "true"
       - Si la hora es 16:00 y los horarios son 08:00-11:00, 13:00-15:00, 19:00-23:00, entonces está FUERA → "hora_disponible": "false", "hora_error": "fuera_horario"
       - Si la hora es 10:00 y hay horario de desayuno 08:00-11:00, entonces está DENTRO → "hora_disponible": "true"
       - Si la hora es 12:00 y los horarios son 08:00-11:00, 13:00-15:00, 19:00-23:00, entonces está FUERA → "hora_disponible": "false", "hora_error": "fuera_horario"
     * SIEMPRE valida la hora contra los horarios listados arriba antes de marcar "hora_disponible"
5. Convierte todo a formato estándar:
   - Comensales: SIEMPRE extrae el número mencionado en el texto, incluso si es mayor a ${restaurantConfig.maxPersonasMesa}. Si el texto dice "30 personas", devuelve "30" con credibilidad 100%. Si no hay número, devuelve null con credibilidad 0%.
   - Fecha: YYYY-MM-DD
   - Hora: HH:MM (formato 24h)
   - Intolerancias: "true" o "false"
   - Movilidad: "true" o "false"
   - Nombre: texto o null

## FORMATO DE SALIDA (SOLO JSON, sin explicaciones)
{
  "intencion": "reservation" | "modify" | "cancel" | "order" | "clarify",
  "comensales": null o "número",
  "comensales_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "comensales_validos": "true" | "false" | null,
  "comensales_error": null | "max_exceeded" | "min_not_met",
  "fecha": null o "YYYY-MM-DD",
  "fecha_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "hora": null o "HH:MM",
  "hora_disponible": "true" | "false" | null,
  "hora_error": null | "fuera_horario",
  "hora_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "intolerancias": "true" | "false",
  "intolerancias_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "movilidad": "true" | "false",
  "movilidad_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "nombre": null o "texto",
  "nombre_porcentaje_credivilidad": "0%" | "50%" | "100%",
  "idioma_detectado": "es" | "en" | "de" | "fr" | "it" | "pt",
  "pedido_items": [
    {
      "nombre_detectado": null,
      "cantidad_detectada": null,
      "comentarios": null
    }
  ],
  "direccion_entrega": null,
  "nombre_cliente": null,
  "telefono_cliente": null,
  "notas_pedido": null
}

NOTA SOBRE INTENCIÓN:
- "reservation": El usuario quiere hacer una nueva reserva
- "modify": El usuario quiere modificar una reserva existente
- "cancel": El usuario quiere cancelar una reserva existente
- "order": El usuario quiere hacer un pedido a domicilio usando la carta
- "clarify": El texto es ambiguo o no indica una intención clara

NOTA SOBRE VALIDACIONES:
- "comensales_validos": "false" si el número excede el máximo o es menor al mínimo
- "hora_disponible": "false" si la hora está fuera de los horarios del restaurante
- Si hay errores de validación, aún devuelve los valores extraídos pero marca los errores para que el sistema pueda informar al cliente

  IMPORTANTE: Responde SOLO con el JSON, sin texto adicional.`;
}

// Función para probar un modelo con un texto (con retry para errores 429)
async function testModel(modelName, userInput, restaurantConfig, maxRetries = 3) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY no está configurado en .env');
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: modelName });
  
  const prompt = buildPrompt(userInput, restaurantConfig);
  
  const startTime = Date.now();
  let lastError = null;
  
  // Intentar con retry exponencial para errores 429
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Esperar antes de reintentar (backoff exponencial: 2s, 4s, 8s)
        const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
        console.log(`      ⏳ Reintentando en ${waitTime/1000}s... (intento ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      const apiResult = await model.generateContent(prompt);
      const response = await apiResult.response;
      const responseText = response.text();
      const apiTime = Date.now() - startTime;
      
      // Intentar extraer JSON
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          return {
            model: modelName,
            userInput,
            success: true,
            error: null,
            parseError: false,
            timeMs: Date.now() - startTime,
            apiTimeMs: apiTime,
            result,
            responseText: responseText.substring(0, 200),
            retries: attempt
          };
        } catch (parseErr) {
          return {
            model: modelName,
            userInput,
            success: false,
            error: `Error parseando JSON: ${parseErr.message}`,
            parseError: true,
            timeMs: Date.now() - startTime,
            apiTimeMs: apiTime,
            result: null,
            responseText: responseText.substring(0, 200),
            retries: attempt
          };
        }
      } else {
        return {
          model: modelName,
          userInput,
          success: false,
          error: 'No se encontró JSON en la respuesta',
          parseError: false,
          timeMs: Date.now() - startTime,
          apiTimeMs: apiTime,
          result: null,
          responseText: responseText.substring(0, 200),
          retries: attempt
        };
      }
    } catch (err) {
      lastError = err.message;
      
      // Si es error 429 y quedan reintentos, continuar
      if (err.message.includes('429') && attempt < maxRetries - 1) {
        continue;
      }
      
      // Si no es 429 o no quedan reintentos, retornar error
      return {
        model: modelName,
        userInput,
        success: false,
        error: lastError,
        parseError: false,
        timeMs: Date.now() - startTime,
        apiTimeMs: 0,
        result: null,
        responseText: '',
        retries: attempt
      };
    }
  }
  
  // Si llegamos aquí, todos los reintentos fallaron
  return {
    model: modelName,
    userInput,
    success: false,
    error: lastError || 'Todos los reintentos fallaron',
    parseError: false,
    timeMs: Date.now() - startTime,
    apiTimeMs: 0,
    result: null,
    responseText: '',
    retries: maxRetries
  };
}

// Función para evaluar calidad del resultado
function evaluateQuality(result, expectedFields = ['comensales', 'fecha', 'hora']) {
  if (!result) return { score: 0, issues: ['Resultado es null'] };
  
  let score = 0;
  const issues = [];
  const maxScore = expectedFields.length * 2; // 2 puntos por campo (existencia + credibilidad)
  
  for (const field of expectedFields) {
    if (result[field] !== null && result[field] !== undefined) {
      score += 1; // Campo extraído
      
      // Verificar credibilidad
      const credField = `${field}_porcentaje_credivilidad`;
      if (result[credField] === '100%') {
        score += 1; // Alta credibilidad
      } else if (result[credField] === '50%') {
        score += 0.5; // Credibilidad media
      } else {
        issues.push(`${field} tiene credibilidad baja: ${result[credField]}`);
      }
    } else {
      issues.push(`${field} no fue extraído`);
    }
  }
  
  // Verificar formato JSON válido
  if (result.intencion) {
    score += 0.5;
  } else {
    issues.push('Intención no detectada');
  }
  
  return {
    score: (score / maxScore) * 100,
    issues
  };
}

// Función principal
async function runTests() {
  console.log('🚀 Iniciando pruebas de modelos Gemini...\n');
  console.log(`📝 Textos de prueba: ${TEST_TEXTS.length}`);
  console.log(`🤖 Modelos a probar: ${MODELS_TO_TEST.length}\n`);
  console.log('='.repeat(80));
  
  const results = [];
  
  for (const modelName of MODELS_TO_TEST) {
    console.log(`\n📊 Probando modelo: ${modelName}`);
    console.log('-'.repeat(80));
    
    // Esperar un poco antes de empezar con un nuevo modelo
    if (results.length > 0) {
      console.log('⏳ Esperando 5 segundos antes de cambiar de modelo...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    const modelResults = [];
    
    for (let i = 0; i < TEST_TEXTS.length; i++) {
      const testText = TEST_TEXTS[i];
      console.log(`\n  Test ${i + 1}/${TEST_TEXTS.length}: "${testText.substring(0, 50)}..."`);
      
      try {
        const result = await testModel(modelName, testText, restaurantConfig);
        modelResults.push(result);
        
        if (result.success) {
          const quality = evaluateQuality(result.result);
          console.log(`    ✅ Éxito - Tiempo: ${result.timeMs}ms - Calidad: ${quality.score.toFixed(1)}%`);
          if (quality.issues.length > 0) {
            console.log(`    ⚠️  Issues: ${quality.issues.join(', ')}`);
          }
        } else {
          console.log(`    ❌ Error: ${result.error}`);
        }
        
        // Esperar más tiempo entre requests para evitar rate limiting
        // Esperar más tiempo entre modelos diferentes
        const waitTime = 3000; // 3 segundos entre tests
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } catch (error) {
        console.log(`    ❌ Excepción: ${error.message}`);
        modelResults.push({
          model: modelName,
          userInput: testText,
          success: false,
          error: error.message,
          timeMs: 0
        });
      }
    }
    
    results.push({
      model: modelName,
      tests: modelResults
    });
  }
  
  // Resumen final
  console.log('\n\n' + '='.repeat(80));
  console.log('📈 RESUMEN DE RESULTADOS');
  console.log('='.repeat(80));
  
  const summary = [];
  
  for (const modelResult of results) {
    const successful = modelResult.tests.filter(t => t.success).length;
    const total = modelResult.tests.length;
    const avgTime = modelResult.tests
      .filter(t => t.success)
      .reduce((sum, t) => sum + t.timeMs, 0) / successful || 0;
    
    const qualityScores = modelResult.tests
      .filter(t => t.success)
      .map(t => evaluateQuality(t.result).score);
    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
      : 0;
    
    summary.push({
      model: modelResult.model,
      successRate: (successful / total) * 100,
      avgTimeMs: avgTime,
      avgQuality: avgQuality,
      totalTests: total,
      successfulTests: successful
    });
    
    console.log(`\n🤖 ${modelResult.model}:`);
    console.log(`   Tasa de éxito: ${(successful / total) * 100}% (${successful}/${total})`);
    console.log(`   Tiempo promedio: ${avgTime.toFixed(0)}ms`);
    console.log(`   Calidad promedio: ${avgQuality.toFixed(1)}%`);
  }
  
  // Recomendación
  console.log('\n' + '='.repeat(80));
  console.log('💡 RECOMENDACIÓN');
  console.log('='.repeat(80));
  
  // Filtrar solo modelos exitosos (con al menos 1 test exitoso)
  const successfulModels = summary.filter(s => s.successfulTests > 0);
  
  if (successfulModels.length === 0) {
    console.log('\n❌ Ningún modelo completó las pruebas exitosamente');
    return;
  }
  
  // Ordenar por score combinado (calidad * 0.6 + velocidad * 0.4, donde velocidad es inversa)
  // Score de velocidad: más rápido = mejor (normalizado a 0-100)
  const maxTime = Math.max(...successfulModels.map(s => s.avgTimeMs));
  const scored = successfulModels.map(s => {
    // Normalizar velocidad: 0ms = 100 puntos, maxTime = 0 puntos
    const speedScore = maxTime > 0 ? ((maxTime - s.avgTimeMs) / maxTime) * 100 : 100;
    // Score combinado: calidad (60%) + velocidad (40%)
    const combinedScore = (s.avgQuality * 0.6) + (speedScore * 0.4);
    return {
      ...s,
      speedScore,
      combinedScore
    };
  }).sort((a, b) => b.combinedScore - a.combinedScore);
  
  console.log(`\n🏆 Mejor modelo: ${scored[0].model}`);
  console.log(`   - Calidad: ${scored[0].avgQuality.toFixed(1)}%`);
  console.log(`   - Velocidad: ${scored[0].avgTimeMs.toFixed(0)}ms (${scored[0].speedScore.toFixed(1)} puntos)`);
  console.log(`   - Tasa de éxito: ${scored[0].successRate.toFixed(1)}%`);
  console.log(`   - Score combinado: ${scored[0].combinedScore.toFixed(2)}`);
  
  console.log('\n📊 Ranking completo (solo modelos exitosos):');
  scored.forEach((s, i) => {
    const speedImprovement = i > 0 
      ? `(${((scored[0].avgTimeMs / s.avgTimeMs) * 100).toFixed(0)}% más rápido que el mejor)`
      : '(más rápido)';
    console.log(`   ${i + 1}. ${s.model}`);
    console.log(`      - Calidad: ${s.avgQuality.toFixed(1)}%`);
    console.log(`      - Velocidad: ${s.avgTimeMs.toFixed(0)}ms ${i > 0 ? speedImprovement : ''}`);
    console.log(`      - Tasa de éxito: ${s.successRate.toFixed(1)}%`);
    console.log(`      - Score: ${s.combinedScore.toFixed(2)}`);
  });
  
  // Mostrar modelos que fallaron
  const failedModels = summary.filter(s => s.successfulTests === 0);
  if (failedModels.length > 0) {
    console.log('\n❌ Modelos no disponibles o con errores:');
    failedModels.forEach(s => {
      console.log(`   - ${s.model} (0% éxito)`);
    });
  }
  
  // Guardar resultados en archivo
  const fs = require('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `gemini-test-results-${timestamp}.json`;
  fs.writeFileSync(filename, JSON.stringify({ summary, detailed: results }, null, 2));
  console.log(`\n💾 Resultados guardados en: ${filename}`);
}

// Ejecutar
runTests().catch(console.error);

