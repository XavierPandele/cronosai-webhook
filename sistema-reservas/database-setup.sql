-- Script de configuración de base de datos para el Sistema de Reservas
-- Compatible con MySQL/MariaDB

-- Crear base de datos (opcional, si no existe)
-- CREATE DATABASE IF NOT EXISTS sistema_reservas CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
-- USE sistema_reservas;

-- Crear tabla de reservas
CREATE TABLE IF NOT EXISTS reservas (
    id_reserva INT(11) AUTO_INCREMENT PRIMARY KEY,
    nom_persona_reserva VARCHAR(100) NOT NULL COMMENT 'Nombre completo de la persona que hace la reserva',
    telefon VARCHAR(16) NOT NULL COMMENT 'Número de teléfono de contacto',
    data_reserva DATETIME NOT NULL COMMENT 'Fecha y hora de la reserva',
    num_persones INT(11) NOT NULL COMMENT 'Número de personas para la reserva',
    observacions TEXT NULL COMMENT 'Observaciones especiales de la reserva',
    conversa_completa TEXT NULL COMMENT 'Conversación completa o detalles adicionales',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación del registro',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de última actualización',
    status ENUM('pending', 'confirmed', 'cancelled', 'completed') DEFAULT 'pending' COMMENT 'Estado de la reserva',
    INDEX idx_data_reserva (data_reserva),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Tabla principal de reservas';

-- Crear tabla de configuración (opcional)
CREATE TABLE IF NOT EXISTS configuracion (
    id INT(11) AUTO_INCREMENT PRIMARY KEY,
    clave VARCHAR(100) NOT NULL UNIQUE,
    valor TEXT NOT NULL,
    descripcion TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Insertar configuraciones por defecto
INSERT INTO configuracion (clave, valor, descripcion) VALUES
('horario_apertura', '12:00', 'Hora de apertura del restaurante'),
('horario_cierre', '23:00', 'Hora de cierre del restaurante'),
('max_personas_mesa', '20', 'Máximo número de personas por mesa'),
('min_antelacion_horas', '2', 'Mínimo de horas de antelación para reservas'),
('capacidad_maxima', '100', 'Capacidad máxima del restaurante'),
('duracion_reserva_minutos', '120', 'Duración estimada de una reserva en minutos')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

-- Crear tabla de logs (opcional, para auditoría)
CREATE TABLE IF NOT EXISTS logs_reservas (
    id INT(11) AUTO_INCREMENT PRIMARY KEY,
    reserva_id INT(11) NULL,
    accion VARCHAR(50) NOT NULL,
    detalles TEXT NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reserva_id) REFERENCES reservas(id_reserva) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Crear vistas útiles
CREATE OR REPLACE VIEW vista_reservas_hoy AS
SELECT 
    id_reserva,
    nom_persona_reserva,
    telefon,
    data_reserva,
    num_persones,
    observacions,
    status,
    created_at
FROM reservas 
WHERE DATE(data_reserva) = CURDATE()
ORDER BY data_reserva;

CREATE OR REPLACE VIEW vista_reservas_pendientes AS
SELECT 
    id_reserva,
    nom_persona_reserva,
    telefon,
    data_reserva,
    num_persones,
    observacions,
    created_at
FROM reservas 
WHERE status = 'pending'
ORDER BY data_reserva;

-- Crear procedimientos almacenados útiles
DELIMITER //

-- Procedimiento para obtener estadísticas de reservas
CREATE PROCEDURE IF NOT EXISTS sp_estadisticas_reservas(
    IN fecha_inicio DATE,
    IN fecha_fin DATE
)
BEGIN
    SELECT 
        COUNT(*) as total_reservas,
        SUM(num_persones) as total_personas,
        AVG(num_persones) as promedio_personas,
        COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as reservas_confirmadas,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as reservas_pendientes,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as reservas_canceladas
    FROM reservas 
    WHERE DATE(data_reserva) BETWEEN fecha_inicio AND fecha_fin;
END //

-- Procedimiento para limpiar reservas antiguas
CREATE PROCEDURE IF NOT EXISTS sp_limpiar_reservas_antiguas(
    IN dias_antiguedad INT
)
BEGIN
    DELETE FROM reservas 
    WHERE created_at < DATE_SUB(NOW(), INTERVAL dias_antiguedad DAY)
    AND status IN ('cancelled', 'completed');
    
    SELECT ROW_COUNT() as registros_eliminados;
END //

DELIMITER ;

-- Crear índices adicionales para optimización
CREATE INDEX IF NOT EXISTS idx_reservas_fecha_status ON reservas(data_reserva, status);
CREATE INDEX IF NOT EXISTS idx_reservas_telefon ON reservas(telefon);
CREATE INDEX IF NOT EXISTS idx_logs_fecha ON logs_reservas(created_at);

-- Insertar datos de ejemplo (opcional, solo para desarrollo)
INSERT INTO reservas (
    nom_persona_reserva, 
    telefon, 
    data_reserva, 
    num_persones, 
    observacions, 
    status
) VALUES 
(
    'María García López',
    '+34 612 345 678',
    '2024-01-15 20:00:00',
    4,
    'Mesa cerca de la ventana, cumpleaños',
    'pending'
),
(
    'Carlos Rodríguez Martín',
    '+34 623 456 789',
    '2024-01-16 19:30:00',
    2,
    'Cena romántica',
    'confirmed'
),
(
    'Ana Fernández Silva',
    '+34 634 567 890',
    '2024-01-17 21:00:00',
    6,
    'Reunión de trabajo, mesa grande',
    'pending'
);

-- Mostrar información de la configuración
SELECT 'Base de datos configurada correctamente' as mensaje;
SELECT COUNT(*) as total_reservas FROM reservas;
SELECT COUNT(*) as configuraciones FROM configuracion;
