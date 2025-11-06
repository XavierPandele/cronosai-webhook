/**
 * Script para ejecutar create-restaurant-table.sql
 * Uso: node database/run-restaurant-table.js
 */

const fs = require('fs');
const path = require('path');
const { createConnection } = require('../lib/database');

async function runScript() {
  const connection = await createConnection();
  
  try {
    console.log('📖 Leyendo script SQL...');
    const sqlFile = path.join(__dirname, 'create-restaurant-table.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Dividir el script en statements (separados por ;)
    // Filtrar comentarios y líneas vacías
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));
    
    console.log(`📝 Ejecutando ${statements.length} statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Saltar SELECT statements (solo para verificación)
      if (statement.toUpperCase().startsWith('SELECT')) {
        console.log(`\n📊 Resultado de verificación:`);
        try {
          const [rows] = await connection.execute(statement);
          console.table(rows);
        } catch (error) {
          console.log('  (Este SELECT es solo informativo)');
        }
        continue;
      }
      
      // Ejecutar statement
      if (statement.length > 10) { // Solo ejecutar si tiene contenido real
        try {
          await connection.execute(statement);
          console.log(`✅ Statement ${i + 1}/${statements.length} ejecutado`);
        } catch (error) {
          // Ignorar errores de "ya existe" para CREATE TABLE IF NOT EXISTS
          if (error.message.includes('already exists') || 
              error.message.includes('Duplicate entry') ||
              error.code === 'ER_DUP_ENTRY') {
            console.log(`⚠️  Statement ${i + 1}: ${error.message.split('\n')[0]}`);
          } else {
            console.error(`❌ Error en statement ${i + 1}:`, error.message);
            throw error;
          }
        }
      }
    }
    
    console.log('\n✅ Script ejecutado correctamente!');
    console.log('\n📋 Verificando tabla RESTAURANT...');
    
    // Verificar que la tabla existe
    const [tables] = await connection.execute(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'RESTAURANT'"
    );
    
    if (tables[0].count > 0) {
      console.log('✅ Tabla RESTAURANT creada correctamente');
      
      // Mostrar datos insertados
      const [restaurants] = await connection.execute('SELECT * FROM RESTAURANT WHERE id_restaurante = 1');
      if (restaurants.length > 0) {
        console.log('\n📊 Restaurante por defecto:');
        console.table(restaurants);
      }
    } else {
      console.log('⚠️  La tabla RESTAURANT no se encontró');
    }
    
  } catch (error) {
    console.error('❌ Error ejecutando script:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

// Ejecutar
runScript()
  .then(() => {
    console.log('\n✨ Proceso completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

