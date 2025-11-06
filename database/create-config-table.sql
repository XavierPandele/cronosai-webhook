-- Script para crear la tabla de configuración (OPCIONAL)
-- Esta tabla permite almacenar la configuración del restaurante en la base de datos
-- Si no la creas, el sistema funcionará perfectamente usando solo variables de entorno
-- 
-- DISEÑO: Columnas específicas para facilitar filtrado y consultas directas
-- Preparado para múltiples restaurantes con restaurant_id

-- Crear tabla de configuración con columnas específicas
CREATE TABLE IF NOT EXISTS configuracion (
    id INT(11) AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT(11) NULL DEFAULT 1 COMMENT 'ID del restaurante (NULL o 1 = restaurante por defecto)',
    
    -- Capacidad y duración
    capacidad_maxima INT(11) NOT NULL DEFAULT 100 COMMENT 'Capacidad máxima del restaurante en personas',
    duracion_reserva_minutos INT(11) NOT NULL DEFAULT 120 COMMENT 'Duración estimada de una reserva en minutos',
    
    -- Horarios generales
    horario_apertura TIME NOT NULL DEFAULT '12:00:00' COMMENT 'Hora de apertura del restaurante',
    horario_cierre TIME NOT NULL DEFAULT '23:00:00' COMMENT 'Hora de cierre del restaurante',
    
    -- Horarios de comida y cena
    lunch_start TIME NOT NULL DEFAULT '13:00:00' COMMENT 'Inicio del horario de comida',
    lunch_end TIME NOT NULL DEFAULT '15:00:00' COMMENT 'Fin del horario de comida',
    dinner_start TIME NOT NULL DEFAULT '19:00:00' COMMENT 'Inicio del horario de cena',
    dinner_end TIME NOT NULL DEFAULT '23:00:00' COMMENT 'Fin del horario de cena',
    
    -- Validaciones
    min_antelacion_horas INT(11) NOT NULL DEFAULT 2 COMMENT 'Mínimo de horas de antelación para hacer una reserva',
    max_personas_mesa INT(11) NOT NULL DEFAULT 20 COMMENT 'Máximo número de personas por reserva/mesa',
    min_personas INT(11) NOT NULL DEFAULT 1 COMMENT 'Mínimo número de personas por reserva',
    
    -- Configuraciones adicionales
    buffer_capacidad INT(11) NOT NULL DEFAULT 10 COMMENT 'Porcentaje de buffer de capacidad (10 = 10%)',
    ventana_solapamiento INT(11) NOT NULL DEFAULT 30 COMMENT 'Ventana de solapamiento en minutos (antes y después de reserva)',
    
    -- Metadatos
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices para optimizar consultas
    UNIQUE KEY unique_restaurant (restaurant_id),
    INDEX idx_restaurant_id (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Configuración de restaurantes con columnas específicas';

-- Insertar configuración por defecto para restaurante 1
INSERT INTO configuracion (
    restaurant_id,
    capacidad_maxima,
    duracion_reserva_minutos,
    horario_apertura,
    horario_cierre,
    lunch_start,
    lunch_end,
    dinner_start,
    dinner_end,
    min_antelacion_horas,
    max_personas_mesa,
    min_personas,
    buffer_capacidad,
    ventana_solapamiento 
) VALUES (
    1,  -- restaurant_id
    100,  -- capacidad_maxima
    120,  -- duracion_reserva_minutos
    '12:00:00',  -- horario_apertura
    '23:00:00',  -- horario_cierre
    '13:00:00',  -- lunch_start
    '15:00:00',  -- lunch_end
    '19:00:00',  -- dinner_start
    '23:00:00',  -- dinner_end
    2,  -- min_antelacion_horas
    20,  -- max_personas_mesa
    1,  -- min_personas
    10,  -- buffer_capacidad
    30   -- ventana_solapamiento
)
ON DUPLICATE KEY UPDATE 
    capacidad_maxima = VALUES(capacidad_maxima),
    duracion_reserva_minutos = VALUES(duracion_reserva_minutos),
    horario_apertura = VALUES(horario_apertura),
    horario_cierre = VALUES(horario_cierre),
    lunch_start = VALUES(lunch_start),
    lunch_end = VALUES(lunch_end),
    dinner_start = VALUES(dinner_start),
    dinner_end = VALUES(dinner_end),
    min_antelacion_horas = VALUES(min_antelacion_horas),
    max_personas_mesa = VALUES(max_personas_mesa),
    min_personas = VALUES(min_personas),
    buffer_capacidad = VALUES(buffer_capacidad),
    ventana_solapamiento = VALUES(ventana_solapamiento);

-- Verificar que se insertó correctamente
SELECT 'Tabla de configuración creada correctamente' as mensaje;
SELECT 
    restaurant_id,
    capacidad_maxima,
    duracion_reserva_minutos,
    horario_apertura,
    horario_cierre,
    lunch_start,
    lunch_end,
    dinner_start,
    dinner_end,
    min_antelacion_horas,
    max_personas_mesa
FROM configuracion 
WHERE restaurant_id = 1 OR restaurant_id IS NULL;

