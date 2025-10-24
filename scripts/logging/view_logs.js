const fs = require('fs');
const path = require('path');

class LogViewer {
  constructor() {
    this.logDir = path.join(__dirname, '..', '..', 'logs');
  }

  // Obtener archivos de log disponibles
  getLogFiles() {
    try {
      if (!fs.existsSync(this.logDir)) {
        return [];
      }
      
      const files = fs.readdirSync(this.logDir)
        .filter(file => file.startsWith('detailed-') && file.endsWith('.log'))
        .sort()
        .reverse(); // Más recientes primero
      
      return files;
    } catch (error) {
      console.error('Error leyendo archivos de log:', error);
      return [];
    }
  }

  // Leer logs de un archivo específico
  readLogFile(filename, limit = 100) {
    try {
      const filePath = path.join(this.logDir, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      
      // Parsear las últimas N líneas
      const recentLines = lines.slice(-limit);
      const logs = recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return { error: 'Invalid JSON', raw: line };
        }
      });
      
      return logs;
    } catch (error) {
      console.error('Error leyendo archivo de log:', error);
      return [];
    }
  }

  // Filtrar logs por categoría
  filterLogsByCategory(logs, category) {
    return logs.filter(log => log.category === category);
  }

  // Filtrar logs por número de teléfono
  filterLogsByPhone(logs, phoneNumber) {
    return logs.filter(log => 
      log.data && 
      (log.data.phoneNumber === phoneNumber || log.data.From === phoneNumber)
    );
  }

  // Obtener resumen de una llamada específica
  getCallSummary(phoneNumber, filename = null) {
    const files = filename ? [filename] : this.getLogFiles();
    let allLogs = [];
    
    files.forEach(file => {
      const logs = this.readLogFile(file, 1000);
      allLogs = allLogs.concat(logs);
    });
    
    const callLogs = this.filterLogsByPhone(allLogs, phoneNumber);
    
    if (callLogs.length === 0) {
      return { error: 'No se encontraron logs para este número' };
    }
    
    // Agrupar por categoría
    const summary = {
      phoneNumber,
      totalLogs: callLogs.length,
      startTime: callLogs[0]?.timestamp,
      endTime: callLogs[callLogs.length - 1]?.timestamp,
      categories: {},
      issues: [],
      languageChanges: [],
      fallbacks: [],
      errors: []
    };
    
    callLogs.forEach(log => {
      const category = log.category;
      if (!summary.categories[category]) {
        summary.categories[category] = [];
      }
      summary.categories[category].push(log);
      
      // Detectar problemas
      if (log.level === 'ERROR') {
        summary.errors.push(log);
      }
      
      if (log.category === 'FALLBACK_USAGE') {
        summary.fallbacks.push(log);
      }
      
      if (log.category === 'LANGUAGE_DETECTION') {
        summary.languageChanges.push(log);
      }
    });
    
    return summary;
  }

  // Analizar problemas comunes
  analyzeIssues(logs) {
    const issues = [];
    
    // Problemas de Gemini
    const geminiErrors = logs.filter(log => 
      log.category === 'GEMINI_ERROR' || 
      (log.category === 'FALLBACK_USAGE' && log.data?.reason?.includes('Gemini'))
    );
    
    if (geminiErrors.length > 0) {
      issues.push({
        type: 'GEMINI_ERRORS',
        count: geminiErrors.length,
        description: 'Errores en las llamadas a Gemini',
        logs: geminiErrors
      });
    }
    
    // Cambios de idioma frecuentes
    const languageChanges = logs.filter(log => log.category === 'LANGUAGE_DETECTION');
    const languageCounts = {};
    languageChanges.forEach(log => {
      const lang = log.data?.detectedLang || 'unknown';
      languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    });
    
    if (Object.keys(languageCounts).length > 2) {
      issues.push({
        type: 'LANGUAGE_INSTABILITY',
        description: 'Cambios frecuentes de idioma',
        languages: languageCounts
      });
    }
    
    // Uso excesivo de fallbacks
    const fallbacks = logs.filter(log => log.category === 'FALLBACK_USAGE');
    if (fallbacks.length > 5) {
      issues.push({
        type: 'EXCESSIVE_FALLBACKS',
        count: fallbacks.length,
        description: 'Uso excesivo del sistema de fallback'
      });
    }
    
    return issues;
  }

  // Mostrar resumen en consola
  displayCallSummary(phoneNumber) {
    console.log(`\n📞 RESUMEN DE LLAMADA: ${phoneNumber}`);
    console.log('='.repeat(50));
    
    const summary = this.getCallSummary(phoneNumber);
    
    if (summary.error) {
      console.log(`❌ ${summary.error}`);
      return;
    }
    
    console.log(`📊 Total de logs: ${summary.totalLogs}`);
    console.log(`⏰ Inicio: ${summary.startTime}`);
    console.log(`⏰ Fin: ${summary.endTime}`);
    
    console.log('\n📋 CATEGORÍAS:');
    Object.keys(summary.categories).forEach(category => {
      const count = summary.categories[category].length;
      console.log(`  ${category}: ${count} logs`);
    });
    
    if (summary.errors.length > 0) {
      console.log('\n❌ ERRORES:');
      summary.errors.forEach(error => {
        console.log(`  ${error.timestamp}: ${error.message}`);
      });
    }
    
    if (summary.fallbacks.length > 0) {
      console.log('\n⚠️ FALLBACKS USADOS:');
      summary.fallbacks.forEach(fallback => {
        console.log(`  ${fallback.timestamp}: ${fallback.data?.reason}`);
      });
    }
    
    if (summary.languageChanges.length > 0) {
      console.log('\n🌍 CAMBIOS DE IDIOMA:');
      summary.languageChanges.forEach(lang => {
        console.log(`  ${lang.timestamp}: ${lang.data?.detectedLang} (${lang.data?.method})`);
      });
    }
    
    // Analizar problemas
    const issues = this.analyzeIssues(Object.values(summary.categories).flat());
    if (issues.length > 0) {
      console.log('\n🚨 PROBLEMAS DETECTADOS:');
      issues.forEach(issue => {
        console.log(`  ${issue.type}: ${issue.description}`);
        if (issue.count) console.log(`    Cantidad: ${issue.count}`);
      });
    }
  }

  // Mostrar logs en tiempo real
  watchLogs(phoneNumber = null) {
    console.log('👀 Monitoreando logs en tiempo real...');
    console.log('Presiona Ctrl+C para salir\n');
    
    const files = this.getLogFiles();
    if (files.length === 0) {
      console.log('❌ No hay archivos de log disponibles');
      return;
    }
    
    const latestFile = files[0];
    const filePath = path.join(this.logDir, latestFile);
    
    // Leer archivo inicial
    let lastSize = 0;
    try {
      const stats = fs.statSync(filePath);
      lastSize = stats.size;
    } catch (error) {
      console.log('❌ Error accediendo al archivo de log');
      return;
    }
    
    // Monitorear cambios
    const interval = setInterval(() => {
      try {
        const stats = fs.statSync(filePath);
        if (stats.size > lastSize) {
          // Leer nuevas líneas
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          const newLines = lines.slice(-10); // Últimas 10 líneas
          
          newLines.forEach(line => {
            if (line.trim()) {
              try {
                const log = JSON.parse(line);
                if (!phoneNumber || (log.data && log.data.phoneNumber === phoneNumber)) {
                  const timestamp = new Date(log.timestamp).toLocaleTimeString();
                  console.log(`[${timestamp}] ${log.category}: ${log.message}`);
                  if (log.data && log.data.phoneNumber) {
                    console.log(`  📞 ${log.data.phoneNumber}`);
                  }
                }
              } catch (error) {
                // Ignorar líneas que no son JSON válido
              }
            }
          });
          
          lastSize = stats.size;
        }
      } catch (error) {
        console.log('❌ Error monitoreando logs:', error.message);
      }
    }, 1000);
    
    // Manejar salida
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n👋 Monitoreo detenido');
      process.exit(0);
    });
  }
}

// CLI para usar el visor
if (require.main === module) {
  const viewer = new LogViewer();
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('📋 VISOR DE LOGS - Sistema de Reservas');
    console.log('=====================================');
    console.log('');
    console.log('Uso:');
    console.log('  node view_logs.js summary <número_teléfono>  - Ver resumen de llamada');
    console.log('  node view_logs.js watch [número_teléfono]    - Monitorear en tiempo real');
    console.log('  node view_logs.js files                      - Listar archivos disponibles');
    console.log('');
    console.log('Ejemplos:');
    console.log('  node view_logs.js summary +1234567890');
    console.log('  node view_logs.js watch');
    console.log('  node view_logs.js watch +1234567890');
  } else if (args[0] === 'summary' && args[1]) {
    viewer.displayCallSummary(args[1]);
  } else if (args[0] === 'watch') {
    viewer.watchLogs(args[1]);
  } else if (args[0] === 'files') {
    const files = viewer.getLogFiles();
    console.log('📁 Archivos de log disponibles:');
    files.forEach(file => {
      const filePath = path.join(viewer.logDir, file);
      try {
        const stats = fs.statSync(filePath);
        const size = (stats.size / 1024).toFixed(2);
        console.log(`  ${file} (${size} KB)`);
      } catch (error) {
        console.log(`  ${file} (error leyendo tamaño)`);
      }
    });
  } else {
    console.log('❌ Comando no reconocido');
  }
}

module.exports = LogViewer;
