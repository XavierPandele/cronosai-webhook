-- Script para crear la tabla RESTAURANT
-- Esta tabla combina información del restaurante y su configuración
-- Diseño simplificado: todo en una sola tabla

-- Crear tabla RESTAURANT
CREATE TABLE IF NOT EXISTS RESTAURANT (
    id_restaurante INT(11) AUTO_INCREMENT PRIMARY KEY,
    
    -- Información básica del restaurante
    nombre_restaurante VARCHAR(100) NOT NULL COMMENT 'Nombre del restaurante',
    pais_restaurante VARCHAR(100) NULL COMMENT 'País donde está ubicado el restaurante',
    ubicacion_restaurante TEXT NULL COMMENT 'Dirección completa del restaurante',
    
    -- Información de contacto y enlaces
    num_telefono_twilio VARCHAR(20) NULL COMMENT 'Número de teléfono de Twilio asociado',
    url_web_restaurante VARCHAR(255) NULL COMMENT 'URL del sitio web del restaurante',
    url_maps_restaurante VARCHAR(255) NULL COMMENT 'URL de Google Maps o similar',
    
    -- Configuración de capacidad
    capacidad_maxima_restaurante INT(11) NOT NULL DEFAULT 100 COMMENT 'Capacidad máxima del restaurante en personas',
    buffer_capacidad_restaurante INT(11) NOT NULL DEFAULT 10 COMMENT 'Porcentaje de buffer de capacidad (10 = 10%)',
    
    -- Configuración de reservas
    duracion_reserva_minutos INT(11) NOT NULL DEFAULT 120 COMMENT 'Duración estimada de una reserva en minutos',
    min_antelacion_horas_reserva INT(11) NOT NULL DEFAULT 2 COMMENT 'Mínimo de horas de antelación para hacer una reserva',
    max_personas_mesa INT(11) NOT NULL DEFAULT 20 COMMENT 'Máximo número de personas por reserva/mesa',
    min_personas_mesa INT(11) NOT NULL DEFAULT 1 COMMENT 'Mínimo número de personas por reserva/mesa',
    ventana_solapamiento INT(11) NOT NULL DEFAULT 30 COMMENT 'Ventana de solapamiento en minutos (antes y después de reserva)',
    
    -- Horarios (tipo TIME para facilitar validaciones y comparaciones)
    -- horario1: desayuno, horario2: comida, horario3: cena
    horario1_inicio TIME NULL COMMENT 'Inicio del horario 1 (desayuno)',
    horario1_fin TIME NULL COMMENT 'Fin del horario 1 (desayuno)',
    horario2_inicio TIME NULL COMMENT 'Inicio del horario 2 (comida)',
    horario2_fin TIME NULL COMMENT 'Fin del horario 2 (comida)',
    horario3_inicio TIME NULL COMMENT 'Inicio del horario 3 (cena)',
    horario3_fin TIME NULL COMMENT 'Fin del horario 3 (cena)',
    
    -- Metadatos
    activo BOOLEAN DEFAULT TRUE COMMENT 'Si el restaurante está activo',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Índices
    INDEX idx_activo (activo),
    INDEX idx_num_telefono_twilio (num_telefono_twilio)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='Tabla de restaurantes con información y configuración';

-- Insertar restaurante por defecto
INSERT INTO RESTAURANT (
    id_restaurante,
    nombre_restaurante,
    pais_restaurante,
    ubicacion_restaurante,
    num_telefono_twilio,
    url_web_restaurante,
    url_maps_restaurante,
    capacidad_maxima_restaurante,
    buffer_capacidad_restaurante,
    duracion_reserva_minutos,
    min_antelacion_horas_reserva,
    max_personas_mesa,
    min_personas_mesa,
    ventana_solapamiento,
    horario1_inicio,
    horario1_fin,
    horario2_inicio,
    horario2_fin,
    horario3_inicio,
    horario3_fin,
    activo
) VALUES (
    1,  -- id_restaurante
    'Restaurante Principal',  -- nombre_restaurante
    NULL,  -- pais_restaurante (configurar según necesidad)
    NULL,  -- ubicacion_restaurante (configurar según necesidad)
    NULL,  -- num_telefono_twilio (configurar con tu número de Twilio)
    NULL,  -- url_web_restaurante (configurar según necesidad)
    NULL,  -- url_maps_restaurante (configurar según necesidad)
    100,  -- capacidad_maxima_restaurante
    10,  -- buffer_capacidad_restaurante
    120,  -- duracion_reserva_minutos
    2,  -- min_antelacion_horas_reserva
    20,  -- max_personas_mesa
    1,  -- min_personas_mesa
    30,  -- ventana_solapamiento
    '08:00:00',  -- horario1_inicio (desayuno)
    '11:00:00',  -- horario1_fin (desayuno)
    '13:00:00',  -- horario2_inicio (comida)
    '15:00:00',  -- horario2_fin (comida)
    '19:00:00',  -- horario3_inicio (cena)
    '23:00:00',  -- horario3_fin (cena)
    TRUE  -- activo
)
ON DUPLICATE KEY UPDATE 
    nombre_restaurante = VALUES(nombre_restaurante),
    capacidad_maxima_restaurante = VALUES(capacidad_maxima_restaurante),
    buffer_capacidad_restaurante = VALUES(buffer_capacidad_restaurante),
    duracion_reserva_minutos = VALUES(duracion_reserva_minutos);

-- Verificar que se insertó correctamente
SELECT 'Tabla RESTAURANT creada correctamente' as mensaje;
SELECT 
    id_restaurante,
    nombre_restaurante,
    capacidad_maxima_restaurante,
    duracion_reserva_minutos,
    horario1_inicio,
    horario1_fin,
    horario2_inicio,
    horario2_fin,
    horario3_inicio,
    horario3_fin
FROM RESTAURANT 
WHERE id_restaurante = 1;

