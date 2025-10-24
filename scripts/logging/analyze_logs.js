const fs = require('fs');
const path = require('path');

class LogAnalyzer {
  constructor() {
    this.logDir = path.join(__dirname, '..', '..', 'logs');
  }

  // Obtener estadísticas generales
  getGeneralStats() {
    const files = this.getLogFiles();
    let totalLogs = 0;
    let totalCalls = 0;
    const phoneNumbers = new Set();
    const categories = {};
    const errors = [];
    const fallbacks = [];

    files.forEach(file => {
      const logs = this.readLogFile(file);
      totalLogs += logs.length;
      
      logs.forEach(log => {
        if (log.data && log.data.phoneNumber) {
          phoneNumbers.add(log.data.phoneNumber);
        }
        
        if (log.category) {
          categories[log.category] = (categories[log.category] || 0) + 1;
        }
        
        if (log.level === 'ERROR') {
          errors.push(log);
        }
        
        if (log.category === 'FALLBACK_USAGE') {
          fallbacks.push(log);
        }
      });
    });

    totalCalls = phoneNumbers.size;

    return {
      totalLogs,
      totalCalls,
      uniquePhoneNumbers: phoneNumbers.size,
      categories,
      errors: errors.length,
      fallbacks: fallbacks.length,
      files: files.length
    };
  }

  // Analizar problemas por categoría
  analyzeProblems() {
    const files = this.getLogFiles();
    const problems = {
      geminiErrors: 0,
      languageInstability: 0,
      excessiveFallbacks: 0,
      systemErrors: 0,
      slowResponses: 0
    };

    files.forEach(file => {
      const logs = this.readLogFile(file);
      
      logs.forEach(log => {
        // Errores de Gemini
        if (log.category === 'GEMINI_ERROR') {
          problems.geminiErrors++;
        }
        
        // Errores del sistema
        if (log.category === 'SYSTEM_ERROR') {
          problems.systemErrors++;
        }
        
        // Fallbacks excesivos
        if (log.category === 'FALLBACK_USAGE') {
          problems.excessiveFallbacks++;
        }
        
        // Respuestas lentas
        if (log.category === 'METRICS' && log.data?.totalTime > 3000) {
          problems.slowResponses++;
        }
      });
    });

    return problems;
  }

  // Analizar rendimiento por idioma
  analyzeLanguagePerformance() {
    const files = this.getLogFiles();
    const languageStats = {};

    files.forEach(file => {
      const logs = this.readLogFile(file);
      
      logs.forEach(log => {
        if (log.category === 'LANGUAGE_DETECTION') {
          const lang = log.data?.detectedLang || 'unknown';
          if (!languageStats[lang]) {
            languageStats[lang] = {
              detections: 0,
              confidence: [],
              methods: {}
            };
          }
          
          languageStats[lang].detections++;
          languageStats[lang].confidence.push(log.data?.confidence || 0);
          
          const method = log.data?.method || 'unknown';
          languageStats[lang].methods[method] = (languageStats[lang].methods[method] || 0) + 1;
        }
      });
    });

    // Calcular promedios
    Object.keys(languageStats).forEach(lang => {
      const stats = languageStats[lang];
      const avgConfidence = stats.confidence.reduce((a, b) => a + b, 0) / stats.confidence.length;
      stats.averageConfidence = avgConfidence;
    });

    return languageStats;
  }

  // Generar reporte completo
  generateReport() {
    console.log('📊 REPORTE DE ANÁLISIS DE LOGS');
    console.log('==============================');
    
    const stats = this.getGeneralStats();
    const problems = this.analyzeProblems();
    const languageStats = this.analyzeLanguagePerformance();
    
    console.log('\n📈 ESTADÍSTICAS GENERALES:');
    console.log(`  Total de logs: ${stats.totalLogs}`);
    console.log(`  Total de llamadas: ${stats.totalCalls}`);
    console.log(`  Números únicos: ${stats.uniquePhoneNumbers}`);
    console.log(`  Archivos de log: ${stats.files}`);
    
    console.log('\n📋 CATEGORÍAS DE LOGS:');
    Object.keys(stats.categories).forEach(category => {
      console.log(`  ${category}: ${stats.categories[category]}`);
    });
    
    console.log('\n🚨 PROBLEMAS DETECTADOS:');
    console.log(`  Errores de Gemini: ${problems.geminiErrors}`);
    console.log(`  Errores del sistema: ${problems.systemErrors}`);
    console.log(`  Fallbacks excesivos: ${problems.excessiveFallbacks}`);
    console.log(`  Respuestas lentas: ${problems.slowResponses}`);
    
    console.log('\n🌍 RENDIMIENTO POR IDIOMA:');
    Object.keys(languageStats).forEach(lang => {
      const stats = languageStats[lang];
      console.log(`  ${lang}:`);
      console.log(`    Detecciones: ${stats.detections}`);
      console.log(`    Confianza promedio: ${stats.averageConfidence.toFixed(2)}`);
      console.log(`    Métodos: ${JSON.stringify(stats.methods)}`);
    });
    
    // Recomendaciones
    console.log('\n💡 RECOMENDACIONES:');
    if (problems.geminiErrors > 10) {
      console.log('  ⚠️ Muchos errores de Gemini - revisar configuración de API');
    }
    if (problems.excessiveFallbacks > 20) {
      console.log('  ⚠️ Uso excesivo de fallbacks - mejorar prompts de Gemini');
    }
    if (problems.slowResponses > 5) {
      console.log('  ⚠️ Respuestas lentas - optimizar configuración de Gemini');
    }
    if (Object.keys(languageStats).length > 3) {
      console.log('  ⚠️ Muchos idiomas detectados - revisar detección de idioma');
    }
    
    console.log('\n✅ Análisis completado');
  }

  // Métodos auxiliares
  getLogFiles() {
    try {
      if (!fs.existsSync(this.logDir)) {
        return [];
      }
      
      return fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('detailed-') && file.endsWith('.log'))
        .sort();
    } catch (error) {
      console.error('Error leyendo archivos de log:', error);
      return [];
    }
  }

  readLogFile(filename) {
    try {
      const filePath = path.join(this.logDir, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      
      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      }).filter(log => log !== null);
    } catch (error) {
      console.error('Error leyendo archivo de log:', error);
      return [];
    }
  }
}

// Ejecutar análisis si es llamado directamente
if (require.main === module) {
  const analyzer = new LogAnalyzer();
  analyzer.generateReport();
}

module.exports = LogAnalyzer;
