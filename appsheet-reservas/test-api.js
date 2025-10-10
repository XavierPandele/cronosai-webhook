// Script para probar los endpoints de la API
// Ejecutar con: node test-api.js

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'appsheet-cronos-2024';

const headers = {
  'Content-Type': 'application/json',
  'X-Api-Key': API_KEY
};

// Función helper para hacer peticiones
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const config = {
    ...options,
    headers: {
      ...headers,
      ...options.headers
    }
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${options.method || 'GET'} ${endpoint}`);
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`${'='.repeat(60)}`);
    
    if (!response.ok) {
      console.log('❌ ERROR:', data.error);
      return null;
    }
    
    console.log('✅ SUCCESS');
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('❌ Error en petición:', error.message);
    return null;
  }
}

// Tests
async function runTests() {
  console.log('\n🧪 INICIANDO TESTS DE LA API');
  console.log(`📍 URL Base: ${API_BASE_URL}`);
  console.log(`🔑 API Key: ${API_KEY}\n`);

  try {
    // Test 1: GET todas las reservas
    console.log('\n📋 TEST 1: Listar todas las reservas');
    await apiRequest('/api/reservations');

    // Test 2: GET reservas confirmadas
    console.log('\n📋 TEST 2: Listar reservas confirmadas');
    await apiRequest('/api/reservations?status=confirmed');

    // Test 3: POST crear nueva reserva
    console.log('\n📋 TEST 3: Crear nueva reserva');
    const nuevaReserva = {
      nom_persona_reserva: 'Test Usuario',
      telefon: '+34 600 000 000',
      data_reserva: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
      num_persones: 2,
      observacions: 'Reserva de prueba - Test automático',
      status: 'pending'
    };

    const resultado = await apiRequest('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(nuevaReserva)
    });

    let idCreado = null;
    if (resultado && resultado.data) {
      idCreado = resultado.data.id_reserva;
      console.log(`\n✅ Reserva creada con ID: ${idCreado}`);
    }

    // Test 4: PUT actualizar reserva (solo si se creó correctamente)
    if (idCreado) {
      console.log('\n📋 TEST 4: Actualizar reserva');
      await apiRequest(`/api/reservations?id=${idCreado}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: 'confirmed',
          observacions: 'Actualizada por test automático'
        })
      });

      // Test 5: GET reserva específica
      console.log('\n📋 TEST 5: Obtener reserva específica');
      await apiRequest(`/api/reservations?id=${idCreado}`);

      // Test 6: DELETE eliminar reserva
      console.log('\n📋 TEST 6: Eliminar reserva de prueba');
      await apiRequest(`/api/reservations?id=${idCreado}`, {
        method: 'DELETE'
      });
    }

    // Test 7: GET calendario
    console.log('\n📋 TEST 7: Obtener vista de calendario');
    const now = new Date();
    await apiRequest(`/api/calendar?mes=${now.getMonth() + 1}&anio=${now.getFullYear()}`);

    // Test 8: GET estadísticas
    console.log('\n📋 TEST 8: Obtener estadísticas');
    await apiRequest('/api/stats');

    console.log('\n' + '='.repeat(60));
    console.log('✅ TESTS COMPLETADOS');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ ERROR GENERAL EN TESTS:', error);
  }
}

// Verificar que fetch esté disponible
if (typeof fetch === 'undefined') {
  console.log('⚠️  Node.js < 18 detectado. Instalando node-fetch...');
  import('node-fetch').then(module => {
    global.fetch = module.default;
    runTests();
  }).catch(() => {
    console.error('❌ Error: Por favor instala node-fetch o usa Node.js >= 18');
    console.log('npm install node-fetch');
  });
} else {
  runTests();
}

