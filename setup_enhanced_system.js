#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🚀 Configurando Sistema de Comprensión Mejorado con Gemini 2.0-flash\n');

// Verificar configuración
function checkConfiguration() {
  console.log('📋 Verificando configuración...');
  
  const requiredEnvVars = [
    'GOOGLE_API_KEY',
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME'
  ];
  
  const missingVars = [];
  
  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });
  
  if (missingVars.length > 0) {
    console.log('❌ Variables de entorno faltantes:');
    missingVars.forEach(varName => {
      console.log(`   - ${varName}`);
    });
    console.log('\n💡 Configurar en archivo .env o variables de entorno del sistema');
    return false;
  }
  
  console.log('✅ Configuración verificada');
  return true;
}

// Crear archivo de configuración de ejemplo
function createEnvExample() {
  const envExample = `# Configuración del Sistema de Comprensión Mejorado
# Copiar este archivo como .env y configurar las variables

# Google Gemini 2.0-flash API
GOOGLE_API_KEY=tu_api_key_aqui

# Base de datos MySQL
DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_password
DB_NAME=tu_base_datos
DB_PORT=3306

# Twilio (opcional para pruebas)
TWILIO_ACCOUNT_SID=tu_account_sid
TWILIO_AUTH_TOKEN=tu_auth_token
TWILIO_PHONE_NUMBER=tu_numero_twilio

# Configuración del sistema
NODE_ENV=production
LOG_LEVEL=info
MAX_CONVERSATION_HISTORY=10
GEMINI_TEMPERATURE=0.3
GEMINI_MAX_TOKENS=1024
`;

  fs.writeFileSync('.env.example', envExample);
  console.log('📄 Archivo .env.example creado');
}

// Crear script de migración
function createMigrationScript() {
  const migrationScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔄 Migrando a Sistema de Comprensión Mejorado...\\n');

// Función para hacer backup del archivo actual
function backupCurrentFile(filePath) {
  if (fs.existsSync(filePath)) {
    const backupPath = filePath + '.backup.' + Date.now();
    fs.copyFileSync(filePath, backupPath);
    console.log(\`📦 Backup creado: \${backupPath}\`);
    return true;
  }
  return false;
}

// Función para actualizar vercel.json
function updateVercelConfig() {
  const vercelPath = 'vercel.json';
  
  if (fs.existsSync(vercelPath)) {
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
    
    // Actualizar rutas para usar el sistema mejorado
    if (vercelConfig.rewrites) {
      vercelConfig.rewrites = vercelConfig.rewrites.map(rewrite => {
        if (rewrite.source === '/api/twilio-call' && rewrite.destination === '/api/twilio-call-final') {
          return {
            ...rewrite,
            destination: '/api/twilio-call-gemini-enhanced'
          };
        }
        return rewrite;
      });
    }
    
    // Agregar nueva ruta si no existe
    const hasEnhancedRoute = vercelConfig.rewrites?.some(rewrite => 
      rewrite.destination === '/api/twilio-call-gemini-enhanced'
    );
    
    if (!hasEnhancedRoute) {
      vercelConfig.rewrites = vercelConfig.rewrites || [];
      vercelConfig.rewrites.push({
        source: '/api/twilio-call-enhanced',
        destination: '/api/twilio-call-gemini-enhanced'
      });
    }
    
    fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2));
    console.log('✅ vercel.json actualizado');
  }
}

// Función para crear script de rollback
function createRollbackScript() {
  const rollbackScript = \`#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('↩️ Ejecutando rollback del Sistema de Comprensión Mejorado...\\n');

// Función para restaurar desde backup
function restoreFromBackup(pattern) {
  const files = fs.readdirSync('.').filter(file => file.includes(pattern));
  
  if (files.length > 0) {
    const latestBackup = files.sort().pop();
    const originalFile = latestBackup.replace(/\\\\.backup\\\\.\\\\d+$/, '');
    
    fs.copyFileSync(latestBackup, originalFile);
    console.log(\`✅ Restaurado: \${originalFile} desde \${latestBackup}\`);
    return true;
  }
  
  return false;
}

// Restaurar archivos
console.log('🔄 Restaurando archivos desde backup...');
restoreFromBackup('twilio-call-final.js.backup');
restoreFromBackup('vercel.json.backup');

console.log('✅ Rollback completado');
\`;

  fs.writeFileSync('rollback_enhanced_system.js', rollbackScript);
  fs.chmodSync('rollback_enhanced_system.js', '755');
  console.log('📄 Script de rollback creado: rollback_enhanced_system.js');
}

// Ejecutar migración
function runMigration() {
  console.log('🔄 Iniciando migración...');
  
  // Hacer backup de archivos actuales
  backupCurrentFile('api/twilio-call-final.js');
  backupCurrentFile('vercel.json');
  
  // Actualizar configuración
  updateVercelConfig();
  
  // Crear script de rollback
  createRollbackScript();
  
  console.log('✅ Migración completada');
  console.log('\\n📋 Próximos pasos:');
  console.log('1. Configurar GOOGLE_API_KEY en variables de entorno');
  console.log('2. Probar el sistema: node test_enhanced_comprehension.js');
  console.log('3. Desplegar cambios');
  console.log('4. Si hay problemas, ejecutar: node rollback_enhanced_system.js');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration, backupCurrentFile, updateVercelConfig };
`;

  fs.writeFileSync('migrate_to_enhanced.js', migrationScript);
  fs.chmodSync('migrate_to_enhanced.js', '755');
  console.log('📄 Script de migración creado: migrate_to_enhanced.js');
}

// Crear script de monitoreo
function createMonitoringScript() {
  const monitoringScript = `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('📊 Monitoreando Sistema de Comprensión Mejorado...\\n');

// Función para analizar logs
function analyzeLogs() {
  const logFiles = [
    'logs/gemini-enhanced.log',
    'logs/comprehension.log',
    'logs/errors.log'
  ];
  
  logFiles.forEach(logFile => {
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\\n').filter(line => line.trim());
      
      console.log(\`📄 Analizando \${logFile}:\`);
      console.log(\`   - Total de líneas: \${lines.length}\`);
      
      // Contar errores
      const errors = lines.filter(line => line.includes('[ERROR]'));
      console.log(\`   - Errores: \${errors.length}\`);
      
      // Contar análisis exitosos
      const successful = lines.filter(line => line.includes('[GEMINI-ENHANCED]'));
      console.log(\`   - Análisis exitosos: \${successful.length}\`);
      
      // Contar respuestas generadas
      const responses = lines.filter(line => line.includes('Respuesta generada'));
      console.log(\`   - Respuestas generadas: \${responses.length}\`);
      
      console.log('');
    }
  });
}

// Función para generar reporte
function generateReport() {
  const report = \`# Reporte del Sistema de Comprensión Mejorado
## Fecha: \${new Date().toISOString()}

### Métricas Generales
- Sistema: Gemini 2.0-flash Enhanced
- Estado: Activo
- Última actualización: \${new Date().toISOString()}

### Configuración
- API Key configurada: \${process.env.GOOGLE_API_KEY ? 'Sí' : 'No'}
- Base de datos: \${process.env.DB_HOST || 'No configurada'}
- Entorno: \${process.env.NODE_ENV || 'development'}

### Recomendaciones
1. Monitorear logs de errores regularmente
2. Verificar configuración de API Key
3. Revisar métricas de comprensión
4. Actualizar sistema según sea necesario

---
Generado automáticamente por el sistema de monitoreo
\`;

  fs.writeFileSync('comprehension_report.md', report);
  console.log('📄 Reporte generado: comprehension_report.md');
}

// Función para limpiar logs antiguos
function cleanOldLogs() {
  const logDir = 'logs';
  
  if (fs.existsSync(logDir)) {
    const files = fs.readdirSync(logDir);
    const oldFiles = files.filter(file => {
      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      const daysOld = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
      return daysOld > 7; // Archivos más antiguos que 7 días
    });
    
    oldFiles.forEach(file => {
      const filePath = path.join(logDir, file);
      fs.unlinkSync(filePath);
      console.log(\`🗑️ Archivo antiguo eliminado: \${file}\`);
    });
  }
}

// Ejecutar monitoreo
function runMonitoring() {
  console.log('📊 Iniciando monitoreo...');
  
  analyzeLogs();
  generateReport();
  cleanOldLogs();
  
  console.log('✅ Monitoreo completado');
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  runMonitoring();
}

module.exports = { runMonitoring, analyzeLogs, generateReport, cleanOldLogs };
`;

  fs.writeFileSync('monitor_enhanced_system.js', monitoringScript);
  fs.chmodSync('monitor_enhanced_system.js', '755');
  console.log('📄 Script de monitoreo creado: monitor_enhanced_system.js');
}

// Función principal
function setupEnhancedSystem() {
  console.log('🔧 Configurando Sistema de Comprensión Mejorado...\n');
  
  // Verificar configuración
  if (!checkConfiguration()) {
    console.log('\n⚠️ Configuración incompleta. Revisar variables de entorno.');
    return false;
  }
  
  // Crear archivos de configuración
  createEnvExample();
  createMigrationScript();
  createMonitoringScript();
  
  console.log('\n✅ Sistema de Comprensión Mejorado configurado exitosamente!');
  console.log('\n📋 Próximos pasos:');
  console.log('1. Ejecutar migración: node migrate_to_enhanced.js');
  console.log('2. Probar sistema: node test_enhanced_comprehension.js');
  console.log('3. Monitorear: node monitor_enhanced_system.js');
  console.log('4. Desplegar cambios');
  
  return true;
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  setupEnhancedSystem();
}

module.exports = { setupEnhancedSystem, checkConfiguration };
