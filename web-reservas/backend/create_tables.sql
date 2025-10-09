-- Script para crear las tablas necesarias en tu base de datos
-- Ejecutar este script en phpMyAdmin

-- Crear tabla de reservas
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

-- Insertar datos de disponibilidad para los próximos 30 días
INSERT IGNORE INTO disponibilidad_mesas (fecha, hora, mesas_disponibles, capacidad_maxima)
SELECT 
    DATE_ADD(CURDATE(), INTERVAL n DAY) as fecha,
    TIME_ADD('18:00:00', INTERVAL (m * 30) MINUTE) as hora,
    10 as mesas_disponibles,
    10 as capacidad_maxima
FROM 
    (SELECT 0 as n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION 
     SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION 
     SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION 
     SELECT 15 UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 UNION 
     SELECT 20 UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24 UNION 
     SELECT 25 UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29) days
CROSS JOIN 
    (SELECT 0 as m UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION 
     SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) hours
WHERE 
    TIME_ADD('18:00:00', INTERVAL (m * 30) MINUTE) <= '22:30:00';

-- Verificar que las tablas se crearon
SELECT 'Tablas creadas exitosamente' as status;
SELECT COUNT(*) as total_disponibilidad FROM disponibilidad_mesas;

