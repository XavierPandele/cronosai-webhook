/**
 * Script de prueba para verificar que la configuración del restaurante se lee correctamente
 * Uso: node database/test-restaurant-config.js
 */

const { getRestaurantConfig, getRestaurantHours } = require('../config/restaurant-config');

async function testConfig() {
  try {
    console.log('🧪 Probando lectura de configuración del restaurante...\n');
    
    // Obtener configuración
    const config = await getRestaurantConfig();
    
    console.log('✅ Configuración obtenida:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 CAPACIDAD:');
    console.log(`   Capacidad máxima: ${config.capacidadMaxima} personas`);
    console.log(`   Buffer: ${config.bufferCapacidad}%`);
    console.log(`   Ventana solapamiento: ${config.ventanaSolapamiento} minutos`);
    
    console.log('\n⏰ HORARIOS:');
    console.log(`   Horario 1 (desayuno): ${config.horario1Inicio || 'No configurado'} - ${config.horario1Fin || 'No configurado'}`);
    console.log(`   Horario 2 (comida): ${config.horario2Inicio || 'No configurado'} - ${config.horario2Fin || 'No configurado'}`);
    console.log(`   Horario 3 (cena): ${config.horario3Inicio || 'No configurado'} - ${config.horario3Fin || 'No configurado'}`);
    
    console.log('\n📋 RESERVAS:');
    console.log(`   Duración: ${config.duracionReservaMinutos} minutos`);
    console.log(`   Antelación mínima: ${config.minAntelacionHoras} horas`);
    console.log(`   Personas: ${config.minPersonas} - ${config.maxPersonasMesa}`);
    
    console.log('\n🔄 COMPATIBILIDAD:');
    console.log(`   lunchStart: ${config.lunchStart}`);
    console.log(`   lunchEnd: ${config.lunchEnd}`);
    console.log(`   dinnerStart: ${config.dinnerStart}`);
    console.log(`   dinnerEnd: ${config.dinnerEnd}`);
    
    // Probar getRestaurantHours
    console.log('\n📞 Probando getRestaurantHours()...');
    const hours = await getRestaurantHours();
    console.log('✅ Horarios obtenidos:');
    console.log(`   Comida: ${hours.lunch[0]} - ${hours.lunch[1]}`);
    console.log(`   Cena: ${hours.dinner[0]} - ${hours.dinner[1]}`);
    
    console.log('\n✨ ¡Todo funcionando correctamente!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testConfig();

