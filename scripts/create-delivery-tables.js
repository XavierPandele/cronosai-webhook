const { executeQuery } = require('../lib/database');

async function createTables() {
  try {
    console.log('🍽️ Creando tabla MENU...');
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS menu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        precio DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        descripcion TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    console.log('🧾 Creando tabla PEDIDOS_REALIZADOS...');
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS pedidos_realizados (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_nombre VARCHAR(150) NOT NULL,
        cliente_telefono VARCHAR(25),
        direccion_entrega VARCHAR(255),
        observaciones TEXT,
        total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        estado ENUM('pendiente','preparacion','en_camino','entregado','cancelado') DEFAULT 'pendiente',
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Tablas creadas correctamente.');
  } catch (error) {
    console.error('❌ Error creando tablas de pedidos:', error.message);
    process.exit(1);
  }
}

createTables()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
  });

