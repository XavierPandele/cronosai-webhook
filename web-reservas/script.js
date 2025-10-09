// Configuración de la aplicación
const CONFIG = {
    API_BASE_URL: '/api/reservas',  // Usar ruta relativa para Vercel
    MIN_ADVANCE_HOURS: 2,
    MAX_ADVANCE_DAYS: 30,
    RESTAURANT_HOURS: {
        open: '18:00',
        close: '23:00'
    }
};

// Estado de la aplicación
let currentReservation = null;
let isLoading = false;

// Elementos del DOM
const form = document.getElementById('reservaForm');
const loadingOverlay = document.getElementById('loadingOverlay');
const confirmModal = document.getElementById('confirmModal');
const reservaDetails = document.getElementById('reserva-details');

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    initializeForm();
    setupEventListeners();
    setMinDate();
    updateAvailableHours();
});

// Configurar fecha mínima
function setMinDate() {
    const dataReservaInput = document.getElementById('data_reserva');
    const today = new Date();
    const minDate = new Date(today.getTime() + (CONFIG.MIN_ADVANCE_HOURS * 60 * 60 * 1000));
    
    dataReservaInput.min = minDate.toISOString().split('T')[0];
    
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + CONFIG.MAX_ADVANCE_DAYS);
    dataReservaInput.max = maxDate.toISOString().split('T')[0];
}

// Inicializar formulario
function initializeForm() {
    const form = document.getElementById('reservaForm');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
}

// Configurar event listeners
function setupEventListeners() {
    // Cambio de fecha
    const dataReservaInput = document.getElementById('data_reserva');
    if (dataReservaInput) {
        dataReservaInput.addEventListener('change', updateAvailableHours);
    }

    // Validación en tiempo real
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('blur', () => validateField(input));
        input.addEventListener('input', () => clearFieldError(input));
    });

    // Cerrar modal
    const closeModal = document.querySelector('.close-modal');
    if (closeModal) {
        closeModal.addEventListener('click', closeModalHandler);
    }

    // Cerrar modal al hacer clic fuera
    if (confirmModal) {
        confirmModal.addEventListener('click', (e) => {
            if (e.target === confirmModal) {
                closeModalHandler();
            }
        });
    }
}

// Actualizar horas disponibles
async function updateAvailableHours() {
    const dataReservaInput = document.getElementById('data_reserva');
    const numPersonesSelect = document.getElementById('num_persones');
    
    if (!dataReservaInput.value || !numPersonesSelect.value) {
        return;
    }

    try {
        showLoading(true);
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/disponibilidad`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data_reserva: dataReservaInput.value,
                num_persones: parseInt(numPersonesSelect.value)
            })
        });

        const data = await response.json();
        
        if (data.success) {
            // Mostrar mensaje de disponibilidad
            if (data.disponible) {
                showNotification(data.message, 'success');
            } else {
                showNotification(data.message, 'warning');
            }
        }
    } catch (error) {
        console.error('Error consultando disponibilidad:', error);
        showNotification('Error consultando disponibilidad. Por favor, intente de nuevo.', 'error');
    } finally {
        showLoading(false);
    }
}

// Manejar envío del formulario
async function handleFormSubmit(e) {
    e.preventDefault();
    
    if (isLoading) return;
    
    // Validar formulario
    if (!validateForm()) {
        return;
    }

    const formData = new FormData(form);
    const reservationData = {
        nom_persona_reserva: formData.get('nom_persona_reserva'),
        telefon: formData.get('telefon'),
        data_reserva: formData.get('data_reserva'),
        num_persones: parseInt(formData.get('num_persones')),
        observacions: formData.get('observacions')
    };

    try {
        showLoading(true);
        
        const response = await fetch(`${CONFIG.API_BASE_URL}/crear-reserva`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(reservationData)
        });

        const data = await response.json();
        
        if (data.success) {
            // Extraer información de la reserva de la respuesta
            const message = data.message;
            const idReserva = data.id_reserva;
            
            currentReservation = {
                ...reservationData,
                id_reserva: idReserva,
                confirmacion: message
            };
            
            showConfirmationModal();
            form.reset();
        } else {
            throw new Error(data.error || 'Error creando la reserva');
        }
    } catch (error) {
        console.error('Error creando reserva:', error);
        showNotification('Error procesando la reserva. Por favor, intente de nuevo o contacte al restaurante.', 'error');
    } finally {
        showLoading(false);
    }
}

// Esta función ya no es necesaria ya que usamos IDs numéricos autoincrement

// Validar formulario completo
function validateForm() {
    let isValid = true;
    const requiredFields = ['nom_persona_reserva', 'telefon', 'data_reserva', 'num_persones'];
    
    requiredFields.forEach(fieldName => {
        const field = document.getElementById(fieldName);
        if (field && !validateField(field)) {
            isValid = false;
        }
    });

    // Validar términos y condiciones
    const terminosCheckbox = document.getElementById('acepto_terminos');
    if (!terminosCheckbox.checked) {
        showFieldError(terminosCheckbox, 'Debe aceptar los términos y condiciones');
        isValid = false;
    }

    return isValid;
}

// Validar campo individual
function validateField(field) {
    const value = field.value.trim();
    const fieldName = field.name;
    let isValid = true;
    let errorMessage = '';

    // Limpiar errores previos
    clearFieldError(field);

    // Validaciones específicas por campo
    switch (fieldName) {
        case 'nom_persona_reserva':
            if (!value) {
                errorMessage = 'El nombre es requerido';
                isValid = false;
            } else if (value.length < 2) {
                errorMessage = 'El nombre debe tener al menos 2 caracteres';
                isValid = false;
            }
            break;

        case 'telefon':
            if (!value) {
                errorMessage = 'El teléfono es requerido';
                isValid = false;
            } else if (!isValidPhone(value)) {
                errorMessage = 'Ingrese un teléfono válido';
                isValid = false;
            }
            break;

        case 'data_reserva':
            if (!value) {
                errorMessage = 'La fecha es requerida';
                isValid = false;
            } else if (!isValidDate(value)) {
                errorMessage = 'La fecha debe ser válida y con suficiente anticipación';
                isValid = false;
            }
            break;

        case 'num_persones':
            if (!value) {
                errorMessage = 'El número de personas es requerido';
                isValid = false;
            } else if (parseInt(value) < 1 || parseInt(value) > 20) {
                errorMessage = 'El número de personas debe estar entre 1 y 20';
                isValid = false;
            }
            break;
    }

    if (!isValid) {
        showFieldError(field, errorMessage);
    }

    return isValid;
}

// Validar teléfono
function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[0-9\s\-\(\)]{7,20}$/;
    return phoneRegex.test(phone);
}

// Validar email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Validar fecha
function isValidDate(dateString) {
    const selectedDate = new Date(dateString);
    const today = new Date();
    const minDate = new Date(today.getTime() + (CONFIG.MIN_ADVANCE_HOURS * 60 * 60 * 1000));
    const maxDate = new Date(today.getTime() + (CONFIG.MAX_ADVANCE_DAYS * 24 * 60 * 60 * 1000));
    
    return selectedDate >= minDate && selectedDate <= maxDate;
}

// Mostrar error en campo
function showFieldError(field, message) {
    const errorElement = document.getElementById(`${field.name}-error`);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.add('show');
    }
    field.classList.add('error');
}

// Limpiar error de campo
function clearFieldError(field) {
    const errorElement = document.getElementById(`${field.name}-error`);
    if (errorElement) {
        errorElement.classList.remove('show');
    }
    field.classList.remove('error');
}

// Mostrar modal de confirmación
function showConfirmationModal() {
    if (!currentReservation) return;

    const details = `
        <div class="reservation-details">
            <h4>Detalles de su reserva:</h4>
            <div class="detail-item">
                <strong>ID de reserva:</strong> ${currentReservation.id_reserva}
            </div>
            <div class="detail-item">
                <strong>Nombre:</strong> ${currentReservation.nom_persona_reserva}
            </div>
            <div class="detail-item">
                <strong>Teléfono:</strong> ${currentReservation.telefon}
            </div>
            <div class="detail-item">
                <strong>Fecha:</strong> ${formatDate(currentReservation.data_reserva)}
            </div>
            <div class="detail-item">
                <strong>Personas:</strong> ${currentReservation.num_persones}
            </div>
            ${currentReservation.observacions ? `
            <div class="detail-item">
                <strong>Observaciones:</strong> ${currentReservation.observacions}
            </div>
            ` : ''}
        </div>
        <div class="confirmation-message">
            <p>¡Su reserva ha sido confirmada exitosamente!</p>
            <p>Recibirá una confirmación por SMS o email.</p>
        </div>
    `;

    reservaDetails.innerHTML = details;
    confirmModal.classList.add('show');
}

// Cerrar modal
function closeModalHandler() {
    confirmModal.classList.remove('show');
    currentReservation = null;
}

// Función global para cerrar modal (llamada desde HTML)
function closeModal() {
    closeModalHandler();
}

// Formatear fecha
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// Mostrar/ocultar loading
function showLoading(show) {
    isLoading = show;
    if (show) {
        loadingOverlay.classList.add('show');
    } else {
        loadingOverlay.classList.remove('show');
    }
}

// Mostrar notificación
function showNotification(message, type = 'info') {
    // Crear elemento de notificación
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
    `;

    // Estilos para la notificación
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${getNotificationColor(type)};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 4000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
    `;

    document.body.appendChild(notification);

    // Animar entrada
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);

    // Remover después de 5 segundos
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Obtener icono de notificación
function getNotificationIcon(type) {
    const icons = {
        success: 'check-circle',
        error: 'exclamation-circle',
        warning: 'exclamation-triangle',
        info: 'info-circle'
    };
    return icons[type] || 'info-circle';
}

// Obtener color de notificación
function getNotificationColor(type) {
    const colors = {
        success: '#10B981',
        error: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6'
    };
    return colors[type] || '#3B82F6';
}

// Smooth scroll para enlaces
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Manejar cambios en el formulario para actualizar disponibilidad
document.getElementById('num_persones')?.addEventListener('change', updateAvailableHours);

// Prevenir envío del formulario con Enter en campos de texto
document.querySelectorAll('input[type="text"], input[type="email"], textarea').forEach(input => {
    input.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
        }
    });
});

// Manejar tecla Escape para cerrar modal
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && confirmModal.classList.contains('show')) {
        closeModalHandler();
    }
});

// Función para probar la conexión con el backend
async function testBackendConnection() {
    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/health`);
        const data = await response.json();
        console.log('Backend connection test:', data);
        return data.status === 'OK';
    } catch (error) {
        console.error('Backend connection failed:', error);
        return false;
    }
}

// Probar conexión al cargar la página
window.addEventListener('load', async function() {
    const isConnected = await testBackendConnection();
    if (!isConnected) {
        console.warn('Backend no disponible. Algunas funciones pueden no funcionar correctamente.');
    }
});
