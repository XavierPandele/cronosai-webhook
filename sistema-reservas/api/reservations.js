// API endpoint para manejar reservas
// Compatible con Vercel Serverless Functions

export default async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Manejar preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo permitir POST para crear reservas
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Método no permitido',
            message: 'Solo se permite POST para crear reservas'
        });
    }

    try {
        // Validar datos de entrada
        const validationResult = validateReservationData(req.body);
        if (!validationResult.isValid) {
            return res.status(400).json({
                error: 'Datos inválidos',
                message: validationResult.message,
                details: validationResult.errors
            });
        }

        // Procesar la reserva
        const reservation = await processReservation(req.body);

        // Enviar respuesta exitosa
        return res.status(201).json({
            success: true,
            message: 'Reserva creada exitosamente',
            reservation: {
                id: reservation.id,
                nom_persona_reserva: reservation.nom_persona_reserva,
                telefon: reservation.telefon,
                data_reserva: reservation.data_reserva,
                num_persones: reservation.num_persones,
                observacions: reservation.observacions,
                created_at: reservation.created_at
            }
        });

    } catch (error) {
        console.error('Error procesando reserva:', error);
        
        return res.status(500).json({
            error: 'Error interno del servidor',
            message: 'No se pudo procesar la reserva. Inténtalo de nuevo más tarde.'
        });
    }
}

// Validar datos de la reserva
function validateReservationData(data) {
    const errors = [];
    
    // Validar campos obligatorios
    if (!data.nom_persona_reserva || data.nom_persona_reserva.trim().length < 2) {
        errors.push('El nombre es obligatorio y debe tener al menos 2 caracteres');
    }
    
    if (!data.telefon || !isValidPhone(data.telefon)) {
        errors.push('El teléfono es obligatorio y debe tener un formato válido');
    }
    
    if (!data.data_reserva || !isValidDate(data.data_reserva)) {
        errors.push('La fecha y hora son obligatorias y deben ser válidas');
    }
    
    if (!data.num_persones || !isValidNumberOfPeople(data.num_persones)) {
        errors.push('El número de personas es obligatorio y debe ser entre 1 y 20');
    }
    
    // Validar longitud de campos opcionales
    if (data.observacions && data.observacions.length > 1000) {
        errors.push('Las observaciones no pueden exceder 1000 caracteres');
    }
    
    if (data.conversa_completa && data.conversa_completa.length > 2000) {
        errors.push('La conversación completa no puede exceder 2000 caracteres');
    }
    
    return {
        isValid: errors.length === 0,
        message: errors.length > 0 ? 'Datos de reserva inválidos' : 'Datos válidos',
        errors: errors
    };
}

// Validar teléfono
function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{9,16}$/;
    return phoneRegex.test(phone.trim());
}

// Validar fecha
function isValidDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const minAdvanceHours = 2;
    const minDate = new Date(now.getTime() + (minAdvanceHours * 60 * 60 * 1000));
    
    return !isNaN(date.getTime()) && date >= minDate;
}

// Validar número de personas
function isValidNumberOfPeople(num) {
    const numPeople = parseInt(num);
    return !isNaN(numPeople) && numPeople >= 1 && numPeople <= 20;
}

// Procesar la reserva (simular inserción en base de datos)
async function processReservation(data) {
    // En un entorno real, aquí conectarías con la base de datos
    // Por ahora, simulamos el procesamiento
    
    const reservation = {
        id: generateReservationId(),
        nom_persona_reserva: data.nom_persona_reserva.trim(),
        telefon: data.telefon.trim(),
        data_reserva: data.data_reserva,
        num_persones: parseInt(data.num_persones),
        observacions: data.observacions ? data.observacions.trim() : null,
        conversa_completa: data.conversa_completa ? data.conversa_completa.trim() : null,
        created_at: new Date().toISOString(),
        status: 'pending'
    };
    
    // Aquí iría la lógica para insertar en la base de datos
    // await insertReservationToDatabase(reservation);
    
    // Simular delay de base de datos
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return reservation;
}

// Generar ID único para la reserva
function generateReservationId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `RES-${timestamp}-${random}`.toUpperCase();
}
