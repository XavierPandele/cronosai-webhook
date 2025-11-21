#!/usr/bin/env node

/**
 * Script para validar y formatear GOOGLE_APPLICATION_CREDENTIALS_JSON
 * Ayuda a diagnosticar problemas de formato en el .env
 */

require('dotenv').config();

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, icon, message) {
  console.log(`${color}${icon}${COLORS.reset} ${message}`);
}

function validateCredentials() {
  log(COLORS.cyan, '🔍', 'Validando GOOGLE_APPLICATION_CREDENTIALS_JSON...\n');

  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (!credentialsJson) {
    log(COLORS.red, '❌', 'GOOGLE_APPLICATION_CREDENTIALS_JSON no está definido en .env');
    log(COLORS.yellow, '💡', 'Añade la variable al archivo .env con el JSON completo');
    return false;
  }

  log(COLORS.blue, '📋', `Tipo: ${typeof credentialsJson}`);
  log(COLORS.blue, '📏', `Longitud: ${credentialsJson.length} caracteres`);
  log(COLORS.blue, '👀', `Preview (primeros 100 chars): ${credentialsJson.substring(0, 100)}...\n`);

  // Intentar parsear
  let credentials;
  try {
    credentials = JSON.parse(credentialsJson);
    log(COLORS.green, '✅', 'JSON parseado correctamente');
  } catch (error) {
    log(COLORS.red, '❌', `Error parseando JSON: ${error.message}`);
    log(COLORS.yellow, '📍', `Posición del error: ${error.message.match(/position (\d+)/)?.[1] || 'desconocida'}`);
    
    // Mostrar el área problemática
    const position = parseInt(error.message.match(/position (\d+)/)?.[1] || '0');
    if (position > 0) {
      const start = Math.max(0, position - 50);
      const end = Math.min(credentialsJson.length, position + 50);
      log(COLORS.yellow, '🔍', `Área problemática (posición ${position}):`);
      console.log(`   ...${credentialsJson.substring(start, end)}...`);
    }

    // Intentar sugerencias de corrección
    log(COLORS.cyan, '\n💡', 'Intentando correcciones automáticas...\n');
    
    try {
      // Corrección 1: Comillas simples
      let cleaned = credentialsJson
        .replace(/([{,]\s*)'([^']+)'(\s*:)/g, '$1"$2"$3')
        .replace(/(:\s*)'([^']*)'(\s*[,}])/g, '$1"$2"$3');
      
      credentials = JSON.parse(cleaned);
      log(COLORS.green, '✅', 'Corregido: Comillas simples convertidas a dobles');
      log(COLORS.yellow, '⚠️', 'Actualiza tu .env con el JSON corregido');
    } catch (cleanError) {
      log(COLORS.red, '❌', `Corrección automática falló: ${cleanError.message}`);
      return false;
    }
  }

  // Validar campos requeridos
  log(COLORS.cyan, '\n🔍', 'Validando campos requeridos...\n');

  const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
  let allValid = true;

  for (const field of requiredFields) {
    if (credentials[field]) {
      log(COLORS.green, '✅', `${field}: Presente`);
      if (field === 'private_key') {
        const keyPreview = credentials[field].substring(0, 50);
        log(COLORS.blue, '   ', `Preview: ${keyPreview}...`);
      } else if (field === 'client_email') {
        log(COLORS.blue, '   ', `Valor: ${credentials[field]}`);
      }
    } else {
      log(COLORS.red, '❌', `${field}: FALTANTE`);
      allValid = false;
    }
  }

  if (allValid) {
    log(COLORS.green, '\n✅', 'Todas las validaciones pasaron. Las credenciales están correctas.');
    log(COLORS.blue, '📝', `Project ID: ${credentials.project_id}`);
    log(COLORS.blue, '📧', `Client Email: ${credentials.client_email}`);
    return true;
  } else {
    log(COLORS.red, '\n❌', 'Faltan campos requeridos en las credenciales');
    return false;
  }
}

// Ejecutar validación
if (require.main === module) {
  const isValid = validateCredentials();
  process.exit(isValid ? 0 : 1);
}

module.exports = { validateCredentials };
