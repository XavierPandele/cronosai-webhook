-- Script para crear las tablas necesarias en tu base de datos
-- Ejecutar este script en phpMyAdmin

-- Crear tabla de reservas (nombre en mayúsculas para consistencia con el código)
CREATE TABLE IF NOT EXISTS RESERVA (
    id_reserva INT AUTO_INCREMENT PRIMARY KEY,
    nom_persona_reserva VARCHAR(100) NOT NULL,
    telefon VARCHAR(20) NOT NULL,
    data_reserva DATETIME NOT NULL,
    num_persones INT NOT NULL,
    observacions TEXT,
    conversa_completa TEXT DEFAULT 'Reserva via página web',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_data_reserva (data_reserva),
    INDEX idx_telefon (telefon),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verificar que la tabla se creó
SELECT 'Tabla RESERVA creada exitosamente' as status;

