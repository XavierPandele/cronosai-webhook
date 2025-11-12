/**
 * Script para analizar los resultados de las pruebas de modelos Gemini
 * Analiza métricas clave y recomienda el mejor modelo según diferentes criterios
 */

const fs = require('fs');
const path = require('path');

// Colores para consola (si está disponible)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// Función para evaluar calidad del resultado (igual que en test-gemini-models.js)
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

// Función para analizar un modelo
function analyzeModel(modelData) {
  const tests = modelData.tests || [];
  const successful = tests.filter(t => t.success);
  const failed = tests.filter(t => !t.success);
  const total = tests.length;
  
  // Métricas básicas
  const successRate = total > 0 ? (successful.length / total) * 100 : 0;
  const avgTime = successful.length > 0
    ? successful.reduce((sum, t) => sum + t.timeMs, 0) / successful.length
    : 0;
  const avgApiTime = successful.length > 0
    ? successful.reduce((sum, t) => sum + (t.apiTimeMs || t.timeMs), 0) / successful.length
    : 0;
  
  // Calidad promedio
  const qualityScores = successful.map(t => evaluateQuality(t.result).score);
  const avgQuality = qualityScores.length > 0
    ? qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length
    : 0;
  
  // Tasa de reintentos
  const totalRetries = successful.reduce((sum, t) => sum + (t.retries || 0), 0);
  const avgRetries = successful.length > 0 ? totalRetries / successful.length : 0;
  
  // Errores
  const errors = failed.map(t => t.error).filter(e => e);
  const errorTypes = {};
  errors.forEach(e => {
    const type = e.includes('429') ? 'rate_limit' :
                 e.includes('404') || e.includes('not found') ? 'not_found' :
                 e.includes('JSON') || e.includes('parse') ? 'parse_error' :
                 'other';
    errorTypes[type] = (errorTypes[type] || 0) + 1;
  });
  
  // Precisión de extracción (campos correctamente extraídos)
  const extractionAccuracy = successful.length > 0 ? 
    successful.reduce((sum, t) => {
      if (!t.result) return sum;
      const quality = evaluateQuality(t.result);
      return sum + quality.score;
    }, 0) / successful.length : 0;
  
  // Consistencia (desviación estándar de tiempos)
  const times = successful.map(t => t.timeMs);
  const timeStdDev = times.length > 1
    ? Math.sqrt(times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length)
    : 0;
  const consistency = avgTime > 0 ? (1 - (timeStdDev / avgTime)) * 100 : 0;
  
  return {
    model: modelData.model,
    totalTests: total,
    successfulTests: successful.length,
    failedTests: failed.length,
    successRate,
    avgTime,
    avgApiTime,
    avgQuality,
    avgRetries,
    extractionAccuracy,
    consistency,
    errorTypes,
    minTime: times.length > 0 ? Math.min(...times) : 0,
    maxTime: times.length > 0 ? Math.max(...times) : 0,
    medianTime: times.length > 0 ? times.sort((a, b) => a - b)[Math.floor(times.length / 2)] : 0
  };
}

// Función para calcular scores combinados
function calculateCombinedScores(analysis) {
  // Score de velocidad (más rápido = mejor, normalizado 0-100)
  const maxTime = Math.max(...analysis.map(a => a.avgTime).filter(t => t > 0));
  const minTime = Math.min(...analysis.map(a => a.avgTime).filter(t => t > 0));
  const speedScore = maxTime > minTime
    ? analysis.map(a => a.avgTime > 0 ? ((maxTime - a.avgTime) / (maxTime - minTime)) * 100 : 0)
    : analysis.map(() => 100);
  
  // Score combinado: calidad (60%) + velocidad (30%) + estabilidad (10%)
  const combinedScores = analysis.map((a, i) => ({
    ...a,
    speedScore: speedScore[i],
    stabilityScore: a.successRate * 0.7 + a.consistency * 0.3,
    combinedScore: (a.avgQuality * 0.6) + (speedScore[i] * 0.3) + (a.successRate * 0.1),
    // Score para estabilidad (prioriza estabilidad sobre velocidad)
    stabilityPriorityScore: (a.avgQuality * 0.7) + (a.successRate * 0.2) + (a.consistency * 0.1),
    // Score para velocidad (prioriza velocidad sobre estabilidad)
    speedPriorityScore: (a.avgQuality * 0.4) + (speedScore[i] * 0.5) + (a.successRate * 0.1)
  }));
  
  return combinedScores;
}

// Función para generar recomendaciones
function generateRecommendations(analysis) {
  const recommendations = {
    bestOverall: null,
    bestStability: null,
    bestSpeed: null,
    bestQuality: null,
    bestBalanced: null
  };
  
  if (analysis.length === 0) return recommendations;
  
  // Mejor general (score combinado)
  recommendations.bestOverall = analysis.reduce((best, current) => 
    current.combinedScore > best.combinedScore ? current : best
  );
  
  // Mejor estabilidad (prioriza estabilidad)
  recommendations.bestStability = analysis.reduce((best, current) => 
    current.stabilityPriorityScore > best.stabilityPriorityScore ? current : best
  );
  
  // Mejor velocidad (prioriza velocidad)
  recommendations.bestSpeed = analysis.reduce((best, current) => 
    current.speedPriorityScore > best.speedPriorityScore ? current : best
  );
  
  // Mejor calidad (prioriza calidad de extracción)
  recommendations.bestQuality = analysis.reduce((best, current) => 
    current.avgQuality > best.avgQuality ? current : best
  );
  
  // Mejor balanceado (equilibrio entre calidad, velocidad y estabilidad)
  recommendations.bestBalanced = analysis.reduce((best, current) => {
    const balanceScore = (current.avgQuality * 0.5) + (current.speedScore * 0.3) + (current.stabilityScore * 0.2);
    const bestBalanceScore = (best.avgQuality * 0.5) + (best.speedScore * 0.3) + (best.stabilityScore * 0.2);
    return balanceScore > bestBalanceScore ? current : best;
  });
  
  return recommendations;
}

// Función para imprimir tabla
function printTable(headers, rows) {
  if (rows.length === 0) {
    console.log('No hay datos para mostrar');
    return;
  }
  
  // Calcular anchos de columna
  const widths = headers.map((h, i) => {
    const headerWidth = h.length;
    const dataWidth = Math.max(...rows.map(r => String(r[i] || '').length));
    return Math.max(headerWidth, dataWidth) + 2;
  });
  
  // Imprimir header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i])).join(' | ');
  const separator = '='.repeat(headerRow.length);
  console.log(separator);
  console.log(headerRow);
  console.log(separator);
  
  // Imprimir filas
  rows.forEach(row => {
    const dataRow = row.map((cell, i) => String(cell || '').padEnd(widths[i])).join(' | ');
    console.log(dataRow);
  });
  
  console.log(separator);
}

// Función principal
function analyzeResults(resultsFile) {
  console.log(`\n${colors.cyan}${colors.bright}📊 ANÁLISIS DE RESULTADOS DE GEMINI${colors.reset}\n`);
  console.log(`Archivo: ${resultsFile}\n`);
  
  // Leer archivo
  let results;
  try {
    const fileContent = fs.readFileSync(resultsFile, 'utf8');
    results = JSON.parse(fileContent);
  } catch (error) {
    console.error(`❌ Error leyendo archivo: ${error.message}`);
    process.exit(1);
  }
  
  // Información general
  console.log(`${colors.bright}📋 INFORMACIÓN GENERAL${colors.reset}`);
  console.log(`Timestamp: ${results.timestamp || 'N/A'}`);
  console.log(`Modelos disponibles: ${results.availableModels?.length || 0}`);
  console.log(`Modelos no disponibles: ${results.unavailableModels?.length || 0}`);
  console.log(`Modelos probados: ${results.testConfig?.modelsTested || 0}`);
  console.log(`Tests por modelo: ${results.testConfig?.testTextsCount || 0}\n`);
  
  // Analizar cada modelo
  const analysis = (results.detailed || []).map(analyzeModel);
  
  if (analysis.length === 0) {
    console.log('❌ No hay datos para analizar');
    return;
  }
  
  // Calcular scores combinados
  const scoredAnalysis = calculateCombinedScores(analysis);
  
  // Ordenar por score combinado
  scoredAnalysis.sort((a, b) => b.combinedScore - a.combinedScore);
  
  // Mostrar tabla de resultados
  console.log(`${colors.bright}📈 RESULTADOS POR MODELO${colors.reset}\n`);
  const headers = ['Modelo', 'Éxito %', 'Tiempo (ms)', 'Calidad %', 'Reintentos', 'Score'];
  const rows = scoredAnalysis.map(a => [
    a.model,
    `${a.successRate.toFixed(1)}%`,
    `${a.avgTime.toFixed(0)}`,
    `${a.avgQuality.toFixed(1)}%`,
    `${a.avgRetries.toFixed(1)}`,
    `${a.combinedScore.toFixed(2)}`
  ]);
  printTable(headers, rows);
  
  // Métricas detalladas
  console.log(`\n${colors.bright}📊 MÉTRICAS DETALLADAS${colors.reset}\n`);
  scoredAnalysis.forEach(a => {
    console.log(`${colors.cyan}${a.model}${colors.reset}`);
    console.log(`  ✅ Tasa de éxito: ${a.successRate.toFixed(1)}% (${a.successfulTests}/${a.totalTests})`);
    console.log(`  ⏱️  Tiempo promedio: ${a.avgTime.toFixed(0)}ms (min: ${a.minTime}ms, max: ${a.maxTime}ms, mediana: ${a.medianTime}ms)`);
    console.log(`  📊 Calidad promedio: ${a.avgQuality.toFixed(1)}%`);
    console.log(`  🎯 Precisión de extracción: ${a.extractionAccuracy.toFixed(1)}%`);
    console.log(`  🔄 Reintentos promedio: ${a.avgRetries.toFixed(1)}`);
    console.log(`  📈 Consistencia: ${a.consistency.toFixed(1)}%`);
    console.log(`  🏆 Score combinado: ${a.combinedScore.toFixed(2)}`);
    if (Object.keys(a.errorTypes).length > 0) {
      console.log(`  ⚠️  Errores: ${JSON.stringify(a.errorTypes)}`);
    }
    console.log('');
  });
  
  // Recomendaciones
  const recommendations = generateRecommendations(scoredAnalysis);
  
  console.log(`${colors.bright}💡 RECOMENDACIONES${colors.reset}\n`);
  
  console.log(`${colors.green}🏆 Mejor Modelo General:${colors.reset} ${recommendations.bestOverall.model}`);
  console.log(`   - Score combinado: ${recommendations.bestOverall.combinedScore.toFixed(2)}`);
  console.log(`   - Calidad: ${recommendations.bestOverall.avgQuality.toFixed(1)}%`);
  console.log(`   - Velocidad: ${recommendations.bestOverall.avgTime.toFixed(0)}ms`);
  console.log(`   - Tasa de éxito: ${recommendations.bestOverall.successRate.toFixed(1)}%`);
  
  console.log(`\n${colors.yellow}🛡️  Mejor para Estabilidad:${colors.reset} ${recommendations.bestStability.model}`);
  console.log(`   - Score de estabilidad: ${recommendations.bestStability.stabilityPriorityScore.toFixed(2)}`);
  console.log(`   - Tasa de éxito: ${recommendations.bestStability.successRate.toFixed(1)}%`);
  console.log(`   - Consistencia: ${recommendations.bestStability.consistency.toFixed(1)}%`);
  console.log(`   - Calidad: ${recommendations.bestStability.avgQuality.toFixed(1)}%`);
  
  console.log(`\n${colors.blue}⚡ Mejor para Velocidad:${colors.reset} ${recommendations.bestSpeed.model}`);
  console.log(`   - Tiempo promedio: ${recommendations.bestSpeed.avgTime.toFixed(0)}ms`);
  console.log(`   - Score de velocidad: ${recommendations.bestSpeed.speedScore.toFixed(1)}`);
  console.log(`   - Calidad: ${recommendations.bestSpeed.avgQuality.toFixed(1)}%`);
  
  console.log(`\n${colors.magenta}🎯 Mejor para Calidad:${colors.reset} ${recommendations.bestQuality.model}`);
  console.log(`   - Calidad promedio: ${recommendations.bestQuality.avgQuality.toFixed(1)}%`);
  console.log(`   - Precisión de extracción: ${recommendations.bestQuality.extractionAccuracy.toFixed(1)}%`);
  console.log(`   - Tiempo promedio: ${recommendations.bestQuality.avgTime.toFixed(0)}ms`);
  
  console.log(`\n${colors.cyan}⚖️  Mejor Balanceado:${colors.reset} ${recommendations.bestBalanced.model}`);
  console.log(`   - Calidad: ${recommendations.bestBalanced.avgQuality.toFixed(1)}%`);
  console.log(`   - Velocidad: ${recommendations.bestBalanced.avgTime.toFixed(0)}ms`);
  console.log(`   - Estabilidad: ${recommendations.bestBalanced.stabilityScore.toFixed(1)}%`);
  
  // Comparación
  console.log(`\n${colors.bright}📊 COMPARACIÓN DETALLADA${colors.reset}\n`);
  console.log('Ranking por diferentes criterios:\n');
  
  console.log('1. Por Score Combinado:');
  scoredAnalysis.slice(0, 5).forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.model} (${a.combinedScore.toFixed(2)})`);
  });
  
  console.log('\n2. Por Estabilidad:');
  [...scoredAnalysis].sort((a, b) => b.stabilityPriorityScore - a.stabilityPriorityScore).slice(0, 5).forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.model} (${a.stabilityPriorityScore.toFixed(2)})`);
  });
  
  console.log('\n3. Por Velocidad:');
  [...scoredAnalysis].sort((a, b) => b.speedScore - a.speedScore).slice(0, 5).forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.model} (${a.avgTime.toFixed(0)}ms, score: ${a.speedScore.toFixed(1)})`);
  });
  
  console.log('\n4. Por Calidad:');
  [...scoredAnalysis].sort((a, b) => b.avgQuality - a.avgQuality).slice(0, 5).forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.model} (${a.avgQuality.toFixed(1)}%)`);
  });
  
  // Recomendación final
  console.log(`\n${colors.bright}✅ RECOMENDACIÓN FINAL${colors.reset}\n`);
  
  // Basado en los logs del usuario, sabemos que gemini-2.5-flash funciona bien
  // Priorizamos estabilidad sobre velocidad
  const bestForProduction = recommendations.bestStability;
  
  console.log(`Para producción (priorizando estabilidad y precisión):`);
  console.log(`   Modelo recomendado: ${colors.green}${bestForProduction.model}${colors.reset}`);
  console.log(`   Razones:`);
  console.log(`   - Tasa de éxito: ${bestForProduction.successRate.toFixed(1)}%`);
  console.log(`   - Calidad: ${bestForProduction.avgQuality.toFixed(1)}%`);
  console.log(`   - Consistencia: ${bestForProduction.consistency.toFixed(1)}%`);
  console.log(`   - Tiempo promedio: ${bestForProduction.avgTime.toFixed(0)}ms`);
  console.log(`   - Reintentos promedio: ${bestForProduction.avgRetries.toFixed(1)}`);
  
  // Guardar análisis en archivo
  const analysisFile = resultsFile.replace('.json', '-analysis.json');
  const analysisData = {
    timestamp: new Date().toISOString(),
    sourceFile: resultsFile,
    analysis: scoredAnalysis,
    recommendations: {
      bestOverall: recommendations.bestOverall.model,
      bestStability: recommendations.bestStability.model,
      bestSpeed: recommendations.bestSpeed.model,
      bestQuality: recommendations.bestQuality.model,
      bestBalanced: recommendations.bestBalanced.model,
      recommendedForProduction: bestForProduction.model
    },
    summary: {
      totalModels: scoredAnalysis.length,
      avgSuccessRate: scoredAnalysis.reduce((sum, a) => sum + a.successRate, 0) / scoredAnalysis.length,
      avgTime: scoredAnalysis.reduce((sum, a) => sum + a.avgTime, 0) / scoredAnalysis.length,
      avgQuality: scoredAnalysis.reduce((sum, a) => sum + a.avgQuality, 0) / scoredAnalysis.length
    }
  };
  
  fs.writeFileSync(analysisFile, JSON.stringify(analysisData, null, 2));
  console.log(`\n💾 Análisis guardado en: ${analysisFile}`);
}

// Ejecutar
const resultsFile = process.argv[2];
if (!resultsFile) {
  console.error('❌ Uso: node analyze-gemini-results.js <archivo-resultados.json>');
  console.error('   Ejemplo: node analyze-gemini-results.js gemini-test-results-2025-11-12_17-30-00.json');
  process.exit(1);
}

analyzeResults(resultsFile);

