const mysql = require('mysql2/promise');

async function testConnection() {
    try {
        console.log('🔍 Probando conexión a la base de datos...');
        
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'db1.bwai.cc',
            port: process.env.DB_PORT || 3306,
            user: process.env.DB_USER || 'cronosdev',
            password: process.env.DB_PASS || ')CDJ6gwpCO9rg-W/',
            database: process.env.DB_NAME || 'cronosai',
            charset: 'utf8mb4'
        });

        console.log('✅ Conexión exitosa a la base de datos');
        
        // Verificar que las tablas existen
        const [tables] = await connection.execute('SHOW TABLES');
        console.log('📋 Tablas encontradas:', tables.map(table => Object.values(table)[0]));
        
        // Verificar tabla reservas
        const [reservasColumns] = await connection.execute('DESCRIBE reservas');
        console.log('📊 Columnas de la tabla reservas:', reservasColumns.map(col => col.Field));
        
        // Verificar tabla disponibilidad_mesas
        const [disponibilidadColumns] = await connection.execute('DESCRIBE disponibilidad_mesas');
        console.log('📊 Columnas de la tabla disponibilidad_mesas:', disponibilidadColumns.map(col => col.Field));
        
        await connection.end();
        console.log('🎉 Prueba de conexión completada exitosamente');
        
    } catch (error) {
        console.error('❌ Error en la conexión:', error.message);
        console.error('🔧 Detalles del error:', error);
    }
}

testConnection();