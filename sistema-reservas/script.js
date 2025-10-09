// Configuración global
const CONFIG = {
    API_ENDPOINT: '/api/reservations',
    MIN_ADVANCE_HOURS: 2,
    MAX_PEOPLE: 20
};

// Utilidades
const utils = {
    // Formatear fecha para mostrar
    formatDate: (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    // Validar teléfono
    validatePhone: (phone) => {
        const phoneRegex = /^[\+]?[0-9\s\-\(\)]{9,16}$/;
        return phoneRegex.test(phone);
    },

    // Validar nombre
    validateName: (name) => {
        return name.trim().length >= 2 && name.trim().length <= 100;
    },

    // Validar fecha futura
    validateFutureDate: (dateString) => {
        const selectedDate = new Date(dateString);
        const now = new Date();
        const minDate = new Date(now.getTime() + (CONFIG.MIN_ADVANCE_HOURS * 60 * 60 * 1000));
        return selectedDate >= minDate;
    },

    // Mostrar error
    showError: (fieldId, message) => {
        const field = document.getElementById(fieldId);
        const errorElement = document.getElementById(`error-${fieldId}`);
        
        if (field && errorElement) {
            field.classList.add('error');
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    },

    // Limpiar error
    clearError: (fieldId) => {
        const field = document.getElementById(fieldId);
        const errorElement = document.getElementById(`error-${fieldId}`);
        
        if (field && errorElement) {
            field.classList.remove('error');
            errorElement.classList.remove('show');
            errorElement.textContent = '';
        }
    },

    // Limpiar todos los errores
    clearAllErrors: () => {
        const errorElements = document.querySelectorAll('.error-message');
        const errorFields = document.querySelectorAll('.error');
        
        errorElements.forEach(element => {
            element.classList.remove('show');
            element.textContent = '';
        });
        
        errorFields.forEach(field => {
            field.classList.remove('error');
        });
    }
};

// Clase principal para manejar el formulario
class ReservationForm {
    constructor() {
        this.form = document.getElementById('reservationForm');
        this.submitBtn = document.getElementById('submitBtn');
        this.clearBtn = document.getElementById('clearForm');
        this.modal = document.getElementById('confirmationModal');
        this.closeModalBtn = document.getElementById('closeModal');
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setMinDateTime();
        this.setupFormValidation();
    }

    setupEventListeners() {
        // Envío del formulario
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Botón limpiar
        this.clearBtn.addEventListener('click', () => this.clearForm());
        
        // Cerrar modal
        this.closeModalBtn.addEventListener('click', () => this.closeModal());
        
        // Cerrar modal al hacer clic fuera
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.closeModal();
            }
        });

        // Validación en tiempo real
        this.setupRealTimeValidation();
    }

    setupRealTimeValidation() {
        const fields = ['nom_persona_reserva', 'telefon', 'data_reserva', 'num_persones'];
        
        fields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('blur', () => this.validateField(fieldId));
                field.addEventListener('input', () => utils.clearError(fieldId));
            }
        });
    }

    setMinDateTime() {
        const now = new Date();
        const minDate = new Date(now.getTime() + (CONFIG.MIN_ADVANCE_HOURS * 60 * 60 * 1000));
        const dateInput = document.getElementById('data_reserva');
        
        if (dateInput) {
            // Formatear para datetime-local (YYYY-MM-DDTHH:MM)
            const year = minDate.getFullYear();
            const month = String(minDate.getMonth() + 1).padStart(2, '0');
            const day = String(minDate.getDate()).padStart(2, '0');
            const hours = String(minDate.getHours()).padStart(2, '0');
            const minutes = String(minDate.getMinutes()).padStart(2, '0');
            
            dateInput.min = `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    }

    setupFormValidation() {
        // Validación personalizada para el formulario
        this.form.addEventListener('submit', (e) => {
            if (!this.validateForm()) {
                e.preventDefault();
                return false;
            }
        });
    }

    validateField(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return true;

        const value = field.value.trim();
        let isValid = true;
        let errorMessage = '';

        switch (fieldId) {
            case 'nom_persona_reserva':
                if (!value) {
                    errorMessage = 'El nombre es obligatorio';
                    isValid = false;
                } else if (!utils.validateName(value)) {
                    errorMessage = 'El nombre debe tener entre 2 y 100 caracteres';
                    isValid = false;
                }
                break;

            case 'telefon':
                if (!value) {
                    errorMessage = 'El teléfono es obligatorio';
                    isValid = false;
                } else if (!utils.validatePhone(value)) {
                    errorMessage = 'Formato de teléfono inválido';
                    isValid = false;
                }
                break;

            case 'data_reserva':
                if (!value) {
                    errorMessage = 'La fecha y hora son obligatorias';
                    isValid = false;
                } else if (!utils.validateFutureDate(value)) {
                    errorMessage = `Debe ser al menos ${CONFIG.MIN_ADVANCE_HOURS} horas en el futuro`;
                    isValid = false;
                }
                break;

            case 'num_persones':
                if (!value) {
                    errorMessage = 'El número de personas es obligatorio';
                    isValid = false;
                } else if (parseInt(value) > CONFIG.MAX_PEOPLE) {
                    errorMessage = `Máximo ${CONFIG.MAX_PEOPLE} personas`;
                    isValid = false;
                }
                break;
        }

        if (!isValid) {
            utils.showError(fieldId, errorMessage);
        } else {
            utils.clearError(fieldId);
        }

        return isValid;
    }

    validateForm() {
        utils.clearAllErrors();
        
        const fields = ['nom_persona_reserva', 'telefon', 'data_reserva', 'num_persones'];
        let isFormValid = true;

        fields.forEach(fieldId => {
            if (!this.validateField(fieldId)) {
                isFormValid = false;
            }
        });

        return isFormValid;
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        if (!this.validateForm()) {
            // Scroll to first error
            const firstError = document.querySelector('.error');
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            return;
        }

        this.setLoadingState(true);

        try {
            const formData = new FormData(this.form);
            const reservationData = Object.fromEntries(formData.entries());
            
            // Agregar timestamp de creación
            reservationData.created_at = new Date().toISOString();
            
            const response = await fetch(CONFIG.API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(reservationData)
            });

            if (response.ok) {
                this.showSuccessModal(reservationData);
                this.clearForm();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Error al procesar la reserva');
            }
        } catch (error) {
            console.error('Error:', error);
            this.showError('Error al enviar la reserva. Por favor, inténtalo de nuevo.');
        } finally {
            this.setLoadingState(false);
        }
    }

    setLoadingState(loading) {
        this.submitBtn.disabled = loading;
        this.submitBtn.classList.toggle('loading', loading);
        
        if (loading) {
            this.submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
        } else {
            this.submitBtn.innerHTML = '<i class="fas fa-check"></i> Confirmar Reserva';
        }
    }

    showSuccessModal(data) {
        const detailsElement = document.getElementById('reservationDetails');
        if (detailsElement) {
            detailsElement.innerHTML = `
                <div style="text-align: left;">
                    <p><strong>Nombre:</strong> ${data.nom_persona_reserva}</p>
                    <p><strong>Teléfono:</strong> ${data.telefon}</p>
                    <p><strong>Fecha:</strong> ${utils.formatDate(data.data_reserva)}</p>
                    <p><strong>Personas:</strong> ${data.num_persones}</p>
                    ${data.observacions ? `<p><strong>Observaciones:</strong> ${data.observacions}</p>` : ''}
                </div>
            `;
        }
        
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        this.modal.classList.remove('show');
        document.body.style.overflow = 'auto';
    }

    showError(message) {
        // Crear notificación de error temporal
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--error-color);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: var(--shadow-lg);
            z-index: 1001;
            max-width: 400px;
            animation: slideIn 0.3s ease-out;
        `;
        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    clearForm() {
        this.form.reset();
        utils.clearAllErrors();
        this.setMinDateTime();
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new ReservationForm();
    
    // Agregar estilos para la animación de carga
    const style = document.createElement('style');
    style.textContent = `
        .fa-spinner {
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

// Manejo de errores globales
window.addEventListener('error', (e) => {
    console.error('Error global:', e.error);
});

// Prevenir envío accidental con Enter en campos de texto
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA') {
        // Permitir Enter en textareas
        return;
    }
    
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') {
        e.preventDefault();
        // Enfocar siguiente campo
        const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
        const currentIndex = inputs.indexOf(e.target);
        if (currentIndex < inputs.length - 1) {
            inputs[currentIndex + 1].focus();
        }
    }
});
