const fs = require('fs');
const path = require('path');

class LanguageAnalyzer {
  constructor() {
    this.logDir = path.join(__dirname, '..', '..', 'logs');
  }

  // Analizar problemas por idioma
  analyzeLanguageProblems() {
    const files = this.getLogFiles();
    let allLogs = [];
    
    files.forEach(file => {
      const logs = this.readLogFile(file);
      allLogs = allLogs.concat(logs);
    });
    
    const languageStats = {};
    const problems = {};
    
    allLogs.forEach(log => {
      if (log.data && log.data.phoneNumber) {
        const phoneNumber = log.data.phoneNumber;
        const language = this.detectLanguageFromPhone(phoneNumber);
        
        if (!languageStats[language]) {
          languageStats[language] = {
            totalCalls: 0,
            totalLogs: 0,
            errors: 0,
            fallbacks: 0,
            avgConfidence: 0,
            avgResponseTime: 0,
            languageDetections: 0,
            problems: []
          };
        }
        
        languageStats[language].totalLogs++;
        
        // Contar errores
        if (log.level === 'ERROR' || log.category === 'GEMINI_ERROR') {
          languageStats[language].errors++;
          if (!problems[language]) problems[language] = [];
          problems[language].push({
            type: 'ERROR',
            message: log.message,
            timestamp: log.timestamp
          });
        }
        
        // Contar fallbacks
        if (log.category === 'FALLBACK_USAGE') {
          languageStats[language].fallbacks++;
          if (!problems[language]) problems[language] = [];
          problems[language].push({
            type: 'FALLBACK',
            reason: log.data?.reason,
            timestamp: log.timestamp
          });
        }
        
        // Detección de idioma
        if (log.category === 'LANGUAGE_DETECTION') {
          languageStats[language].languageDetections++;
          if (log.data?.confidence) {
            languageStats[language].avgConfidence += log.data.confidence;
          }
        }
        
        // Tiempo de respuesta
        if (log.category === 'METRICS' && log.data?.metrics?.totalTime) {
          languageStats[language].avgResponseTime += log.data.metrics.totalTime;
        }
        
        // Llamadas únicas
        if (log.category === 'CALL_START') {
          languageStats[language].totalCalls++;
        }
      }
    });
    
    // Calcular promedios
    Object.keys(languageStats).forEach(lang => {
      const stats = languageStats[lang];
      if (stats.languageDetections > 0) {
        stats.avgConfidence = stats.avgConfidence / stats.languageDetections;
      }
      if (stats.totalLogs > 0) {
        stats.avgResponseTime = stats.avgResponseTime / stats.totalLogs;
      }
    });
    
    return { languageStats, problems };
  }

  // Detectar idioma basado en número de teléfono
  detectLanguageFromPhone(phoneNumber) {
    if (phoneNumber.startsWith('+34')) return 'es';
    if (phoneNumber.startsWith('+1')) return 'en';
    if (phoneNumber.startsWith('+49')) return 'de';
    if (phoneNumber.startsWith('+39')) return 'it';
    if (phoneNumber.startsWith('+33')) return 'fr';
    if (phoneNumber.startsWith('+55')) return 'pt';
    return 'unknown';
  }

  // Analizar patrones problemáticos
  analyzeProblemPatterns() {
    const { languageStats, problems } = this.analyzeLanguageProblems();
    
    const patterns = {};
    
    Object.keys(problems).forEach(language => {
      patterns[language] = {
        errorTypes: {},
        fallbackReasons: {},
        commonIssues: []
      };
      
      problems[language].forEach(problem => {
        if (problem.type === 'ERROR') {
          const errorType = this.categorizeError(problem.message);
          patterns[language].errorTypes[errorType] = (patterns[language].errorTypes[errorType] || 0) + 1;
        }
        
        if (problem.type === 'FALLBACK') {
          const reason = problem.reason || 'Unknown';
          patterns[language].fallbackReasons[reason] = (patterns[language].fallbackReasons[reason] || 0) + 1;
        }
      });
      
      // Identificar problemas comunes
      if (patterns[language].errorTypes['GEMINI_OVERLOAD'] > 0) {
        patterns[language].commonIssues.push('Gemini sobrecargado');
      }
      if (patterns[language].errorTypes['RATE_LIMIT'] > 0) {
        patterns[language].commonIssues.push('Límite de cuota excedido');
      }
      if (patterns[language].fallbackReasons['Gemini timeout'] > 0) {
        patterns[language].commonIssues.push('Timeouts de Gemini');
      }
    });
    
    return { languageStats, patterns };
  }

  // Categorizar errores
  categorizeError(message) {
    if (message.includes('overloaded')) return 'GEMINI_OVERLOAD';
    if (message.includes('Rate limit')) return 'RATE_LIMIT';
    if (message.includes('Database')) return 'DATABASE_ERROR';
    if (message.includes('JSON')) return 'JSON_ERROR';
    return 'OTHER_ERROR';
  }

  // Generar reporte por idioma
  generateLanguageReport() {
    console.log('🌍 ANÁLISIS DE PROBLEMAS POR IDIOMA');
    console.log('=====================================');
    
    const { languageStats, patterns } = this.analyzeProblemPatterns();
    
    Object.keys(languageStats).forEach(language => {
      const stats = languageStats[language];
      const pattern = patterns[language] || { errorTypes: {}, fallbackReasons: {}, commonIssues: [] };
      
      console.log(`\n📊 ${language.toUpperCase()} (${this.getLanguageName(language)})`);
      console.log('-'.repeat(40));
      console.log(`📞 Llamadas: ${stats.totalCalls}`);
      console.log(`📝 Logs: ${stats.totalLogs}`);
      console.log(`❌ Errores: ${stats.errors}`);
      console.log(`⚠️ Fallbacks: ${stats.fallbacks}`);
      console.log(`🎯 Confianza promedio: ${stats.avgConfidence.toFixed(2)}`);
      console.log(`⏱️ Tiempo promedio: ${stats.avgResponseTime.toFixed(0)}ms`);
      
      if (stats.errors > 0) {
        console.log('\n🚨 TIPOS DE ERRORES:');
        Object.keys(pattern.errorTypes).forEach(errorType => {
          console.log(`  ${errorType}: ${pattern.errorTypes[errorType]}`);
        });
      }
      
      if (stats.fallbacks > 0) {
        console.log('\n⚠️ RAZONES DE FALLBACK:');
        Object.keys(pattern.fallbackReasons).forEach(reason => {
          console.log(`  ${reason}: ${pattern.fallbackReasons[reason]}`);
        });
      }
      
      if (pattern.commonIssues.length > 0) {
        console.log('\n🔍 PROBLEMAS IDENTIFICADOS:');
        pattern.commonIssues.forEach(issue => {
          console.log(`  • ${issue}`);
        });
      }
      
      // Calcular score de salud
      const healthScore = this.calculateHealthScore(stats, pattern);
      console.log(`\n💚 SCORE DE SALUD: ${healthScore}/100`);
      
      if (healthScore < 70) {
        console.log('  ⚠️ REQUIERE ATENCIÓN');
      } else if (healthScore < 85) {
        console.log('  ✅ BUENO');
      } else {
        console.log('  🎉 EXCELENTE');
      }
    });
    
    // Recomendaciones generales
    console.log('\n💡 RECOMENDACIONES GENERALES:');
    this.generateRecommendations(languageStats, patterns);
  }

  // Calcular score de salud
  calculateHealthScore(stats, pattern) {
    let score = 100;
    
    // Penalizar por errores
    if (stats.errors > 0) {
      score -= Math.min(stats.errors * 10, 50);
    }
    
    // Penalizar por fallbacks
    if (stats.fallbacks > 0) {
      score -= Math.min(stats.fallbacks * 5, 30);
    }
    
    // Penalizar por baja confianza
    if (stats.avgConfidence < 0.7) {
      score -= 20;
    } else if (stats.avgConfidence < 0.8) {
      score -= 10;
    }
    
    // Penalizar por tiempo lento
    if (stats.avgResponseTime > 3000) {
      score -= 15;
    } else if (stats.avgResponseTime > 2000) {
      score -= 10;
    }
    
    return Math.max(score, 0);
  }

  // Generar recomendaciones
  generateRecommendations(languageStats, patterns) {
    const recommendations = [];
    
    Object.keys(languageStats).forEach(language => {
      const stats = languageStats[language];
      const pattern = patterns[language] || { errorTypes: {}, fallbackReasons: {}, commonIssues: [] };
      
      if (stats.avgConfidence < 0.7) {
        recommendations.push(`🔧 ${language.toUpperCase()}: Mejorar prompts de detección de idioma`);
      }
      
      if (pattern.errorTypes['GEMINI_OVERLOAD'] > 0) {
        recommendations.push(`🔧 ${language.toUpperCase()}: Implementar reintentos más agresivos para Gemini`);
      }
      
      if (pattern.errorTypes['RATE_LIMIT'] > 0) {
        recommendations.push(`🔧 ${language.toUpperCase()}: Optimizar uso de API para evitar límites`);
      }
      
      if (stats.avgResponseTime > 3000) {
        recommendations.push(`🔧 ${language.toUpperCase()}: Optimizar configuración de Gemini para respuestas más rápidas`);
      }
      
      if (stats.fallbacks > stats.totalCalls * 0.3) {
        recommendations.push(`🔧 ${language.toUpperCase()}: Mejorar prompts para reducir uso de fallbacks`);
      }
    });
    
    if (recommendations.length === 0) {
      console.log('  ✅ No se detectaron problemas críticos');
    } else {
      recommendations.forEach(rec => console.log(`  ${rec}`));
    }
  }

  // Obtener nombre del idioma
  getLanguageName(code) {
    const names = {
      es: 'Español',
      en: 'Inglés',
      de: 'Alemán',
      it: 'Italiano',
      fr: 'Francés',
      pt: 'Portugués'
    };
    return names[code] || code;
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

// Ejecutar si es llamado directamente
if (require.main === module) {
  const analyzer = new LanguageAnalyzer();
  analyzer.generateLanguageReport();
}

module.exports = LanguageAnalyzer;
