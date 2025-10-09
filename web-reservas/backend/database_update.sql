-- Script para actualizar la estructura de la base de datos
-- Ejecutar este script en tu base de datos MySQL

-- Crear tabla de reservas con los campos correctos
CREATE TABLE IF NOT EXISTS reservas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ID_reserva VARCHAR(20) UNIQUE NOT NULL,
    nom_persona_reserva VARCHAR(100) NOT NULL,
    telefon VARCHAR(20) NOT NULL,
    data_reserva DATE NOT NULL,
    num_persones INT NOT NULL,
    observacions TEXT,
    conversa_completa TEXT DEFAULT 'Reserva via página web',
    estado ENUM('pendiente', 'confirmada', 'cancelada', 'completada') DEFAULT 'pendiente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_data_reserva (data_reserva),
    INDEX idx_telefon (telefon),
    INDEX idx_ID_reserva (ID_reserva),
    INDEX idx_estado (estado)
);

-- Crear tabla de disponibilidad de mesas
CREATE TABLE IF NOT EXISTS disponibilidad_mesas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    mesas_disponibles INT NOT NULL DEFAULT 10,
    mesas_reservadas INT NOT NULL DEFAULT 0,
    capacidad_maxima INT NOT NULL DEFAULT 10,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_fecha_hora (fecha, hora),
    INDEX idx_fecha (fecha)
);

-- Insertar datos de disponibilidad inicial para los próximos 30 días
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS CrearDisponibilidadInicial()
BEGIN
    DECLARE fecha_actual DATE DEFAULT CURDATE();
    DECLARE fecha_limite DATE DEFAULT DATE_ADD(CURDATE(), INTERVAL 30 DAY);
    DECLARE fecha_iter DATE;
    DECLARE hora_iter TIME;
    
    SET fecha_iter = fecha_actual;
    
    WHILE fecha_iter <= fecha_limite DO
        -- Horarios de cena: 18:00 a 22:30 cada 30 minutos
        SET hora_iter = '18:00:00';
        
        WHILE hora_iter <= '22:30:00' DO
            INSERT IGNORE INTO disponibilidad_mesas (fecha, hora, mesas_disponibles, capacidad_maxima)
            VALUES (fecha_iter, hora_iter, 10, 10);
            
            SET hora_iter = ADDTIME(hora_iter, '00:30:00');
        END WHILE;
        
        SET fecha_iter = DATE_ADD(fecha_iter, INTERVAL 1 DAY);
    END WHILE;
END //
DELIMITER ;

-- Ejecutar el procedimiento para crear disponibilidad inicial
CALL CrearDisponibilidadInicial();

-- Eliminar el procedimiento después de usarlo
DROP PROCEDURE IF EXISTS CrearDisponibilidadInicial;

-- Crear tabla de configuración del restaurante
CREATE TABLE IF NOT EXISTS configuracion_restaurante (
    id INT AUTO_INCREMENT PRIMARY KEY,
    clave VARCHAR(50) UNIQUE NOT NULL,
    valor TEXT NOT NULL,
    descripcion VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insertar configuración inicial
INSERT IGNORE INTO configuracion_restaurante (clave, valor, descripcion) VALUES
('nombre_restaurante', 'CronosAI Restaurant', 'Nombre del restaurante'),
('telefono_restaurante', '+49 30 12345678', 'Teléfono del restaurante'),
('direccion_restaurante', 'Berlin, Germany', 'Dirección del restaurante'),
('horario_apertura', '18:00', 'Hora de apertura'),
('horario_cierre', '23:00', 'Hora de cierre'),
('capacidad_maxima', '10', 'Número máximo de mesas'),
('anticipacion_minima', '2', 'Horas mínimas de anticipación para reservas'),
('anticipacion_maxima', '30', 'Días máximos de anticipación para reservas');

-- Verificar que las tablas se crearon correctamente
SELECT 'Tablas creadas exitosamente' as status;
SELECT COUNT(*) as total_reservas FROM reservas;
SELECT COUNT(*) as total_disponibilidad FROM disponibilidad_mesas;
SELECT COUNT(*) as total_configuracion FROM configuracion_restaurante;
