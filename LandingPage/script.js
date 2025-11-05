// Form handling for contact form
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('contactForm');
    const submitBtn = document.getElementById('submitBtn');
    const btnLoader = document.getElementById('btnLoader');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    // Clear error messages on input
    const inputs = form.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.addEventListener('input', function() {
            clearFieldError(this);
            hideErrorMessage();
        });
    });

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Clear previous errors
        clearAllErrors();
        hideErrorMessage();
        hideSuccessMessage();

        // Validate form
        if (!validateForm()) {
            return;
        }

        // Prepare form data
        const formData = {
            name: document.getElementById('name').value.trim(),
            email: document.getElementById('email').value.trim(),
            message: document.getElementById('message').value.trim()
        };

        // Submit form
        await submitForm(formData);
    });

    function validateForm() {
        let isValid = true;
        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const message = document.getElementById('message').value.trim();

        // Validate name
        if (!name) {
            showFieldError('name', 'Name is required');
            isValid = false;
        } else if (name.length < 2) {
            showFieldError('name', 'Name must be at least 2 characters');
            isValid = false;
        }

        // Validate email
        if (!email) {
            showFieldError('email', 'Email is required');
            isValid = false;
        } else if (!isValidEmail(email)) {
            showFieldError('email', 'Please enter a valid email address');
            isValid = false;
        }

        // Validate message
        if (!message) {
            showFieldError('message', 'Please tell us what you are interested in');
            isValid = false;
        } else if (message.length < 10) {
            showFieldError('message', 'Please provide more details (at least 10 characters)');
            isValid = false;
        }

        return isValid;
    }

    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    function showFieldError(fieldId, message) {
        const field = document.getElementById(fieldId);
        const errorElement = document.getElementById(fieldId + 'Error');
        
        field.classList.add('error');
        errorElement.textContent = message;
    }

    function clearFieldError(field) {
        field.classList.remove('error');
        const errorElement = document.getElementById(field.id + 'Error');
        if (errorElement) {
            errorElement.textContent = '';
        }
    }

    function clearAllErrors() {
        inputs.forEach(input => {
            clearFieldError(input);
        });
    }

    function showErrorMessage(message) {
        errorText.textContent = message;
        errorMessage.classList.remove('hidden');
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideErrorMessage() {
        errorMessage.classList.add('hidden');
    }

    function showSuccessMessage() {
        successMessage.classList.remove('hidden');
        form.style.display = 'none';
        successMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideSuccessMessage() {
        successMessage.classList.add('hidden');
        form.style.display = 'flex';
    }

    async function submitForm(formData) {
        // Show loading state
        submitBtn.disabled = true;
        submitBtn.classList.add('loading');

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (response.ok) {
                showSuccessMessage();
                form.reset();
            } else {
                showErrorMessage(data.message || 'An error occurred. Please try again later.');
            }
        } catch (error) {
            console.error('Error submitting form:', error);
            showErrorMessage('Network error. Please check your connection and try again.');
        } finally {
            // Hide loading state
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    }
});

