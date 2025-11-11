-- Script para renombrar la columna nom_complet a nom_persona_reserva en la tabla CLIENT
-- Esto unifica el nombre de la columna con la tabla RESERVA para evitar problemas de referencia

-- Renombrar la columna en la tabla CLIENT
ALTER TABLE CLIENT 
CHANGE COLUMN nom_complet nom_persona_reserva VARCHAR(100) NOT NULL;

-- Verificar el cambio
DESCRIBE CLIENT;

