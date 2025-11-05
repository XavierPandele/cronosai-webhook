// API endpoint para manejar el formulario de contacto
// Compatible con Vercel Serverless Functions

module.exports = async function handler(req, res) {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Manejar preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Solo permitir POST
    if (req.method !== 'POST') {
        return res.status(405).json({ 
            error: 'Método no permitido',
            message: 'Solo se permite POST para enviar mensajes'
        });
    }

    try {
        const { name, email, message } = req.body;

        // Validar datos
        if (!name || !email || !message) {
            return res.status(400).json({
                error: 'Datos incompletos',
                message: 'Por favor, completa todos los campos requeridos'
            });
        }

        // Validar formato de email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Email inválido',
                message: 'Por favor, ingresa un email válido'
            });
        }

        // Enviar email usando nodemailer o servicio de email
        await sendEmail(name, email, message);

        return res.status(200).json({
            success: true,
            message: 'Mensaje enviado exitosamente'
        });

    } catch (error) {
        console.error('❌ Error procesando contacto:', error);
        console.error('❌ Error stack:', error.stack);
        
        // Log detallado del error
        if (error.response) {
            console.error('❌ Error response:', JSON.stringify(error.response.body, null, 2));
        }
        
        // Determinar el tipo de error
        let errorMessage = 'No se pudo enviar el mensaje. Por favor, inténtalo de nuevo más tarde.';
        let statusCode = 500;
        
        if (error.response) {
            const errorBody = error.response.body;
            if (errorBody && errorBody.errors) {
                const firstError = errorBody.errors[0];
                console.error('❌ SendGrid error details:', firstError);
                
                // Rate limiting
                if (firstError.message && firstError.message.includes('rate limit')) {
                    errorMessage = 'Límite de envío alcanzado. Por favor, intenta de nuevo en unos minutos.';
                    statusCode = 429;
                }
                // Invalid email
                else if (firstError.field === 'from' || firstError.field === 'to') {
                    errorMessage = 'Error en la dirección de email. Por favor, verifica los datos.';
                    statusCode = 400;
                }
            }
        }
        
        return res.status(statusCode).json({
            error: 'Error del servidor',
            message: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}

async function sendEmail(name, email, message) {
    // Priorizar SendGrid si está configurado
    if (process.env.SENDGRID_API_KEY) {
        console.log('Using SendGrid for email delivery');
        return sendEmailWithSendGrid(name, email, message);
    }
    
    // Si no hay SendGrid, intentar Mailgun
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
        console.log('Using Mailgun for email delivery');
        return sendEmailWithMailgun(name, email, message);
    }
    
    // Si no hay servicios de email configurados, intentar SMTP
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log('Using SMTP for email delivery');
        const nodemailer = require('nodemailer');
        
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false, // true para 465, false para otros puertos
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        // Preparar el contenido del email
        const mailOptions = {
            from: process.env.SMTP_USER,
            to: 'contact@usecronos.com',
            subject: `Demo Request from ${name}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #800020;">New Demo Request</h2>
                    <p><strong>From:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <hr style="border: 1px solid #ddd; margin: 20px 0;">
                    <h3 style="color: #800020;">Message:</h3>
                    <p style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${message}</p>
                    <hr style="border: 1px solid #ddd; margin: 20px 0;">
                    <p style="color: #666; font-size: 12px;">This message was sent from the Cronos AI landing page.</p>
                </div>
            `,
            text: `
New Demo Request

From: ${name}
Email: ${email}

Message:
${message}
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent via SMTP:', info.messageId);
        return info;
    }
    
    // Si no hay ninguna configuración, lanzar error
    throw new Error('Email service not configured. Please set up SENDGRID_API_KEY, MAILGUN credentials, or SMTP credentials.');
}

// Función alternativa usando SendGrid
async function sendEmailWithSendGrid(name, email, message) {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'contact@usecronos.com';
    const toEmail = 'contact@usecronos.com';
    
    const msg = {
        to: toEmail,
        from: {
            email: fromEmail, // Debe ser el email verificado
            name: `${name} (via Cronos AI)` // Nombre visible en el cliente de email
        },
        replyTo: {
            email: email, // Email del usuario
            name: name // Nombre del usuario
        },
        subject: `[Demo Request] ${name} - ${email}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #800020 0%, #5C0017 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="margin: 0; font-size: 24px;">New Demo Request</h1>
                </div>
                <div style="padding: 20px; background: #fafafa;">
                    <div style="background: white; border: 2px solid #800020; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                        <h3 style="color: #800020; margin-top: 0; border-bottom: 2px solid #FFD700; padding-bottom: 10px;">Contact Information</h3>
                        <p style="font-size: 16px; margin: 10px 0;"><strong>👤 Name:</strong> ${name}</p>
                        <p style="font-size: 16px; margin: 10px 0;"><strong>📧 Email:</strong> <a href="mailto:${email}" style="color: #800020; text-decoration: none; font-weight: bold;">${email}</a></p>
                    </div>
                    
                    <div style="background: white; border: 1px solid #ddd; border-radius: 8px; padding: 20px;">
                        <h3 style="color: #800020; margin-top: 0; border-bottom: 2px solid #FFD700; padding-bottom: 10px;">Message</h3>
                        <p style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap; line-height: 1.6; font-size: 14px;">${message}</p>
                    </div>
                    
                    <div style="background: #fff3cd; border-left: 4px solid #FFD700; padding: 15px; margin-top: 20px; border-radius: 4px;">
                        <p style="margin: 0; color: #856404; font-size: 13px;">
                            <strong>💡 Tip:</strong> Click "Reply" to respond directly to <strong>${email}</strong>
                        </p>
                    </div>
                </div>
                <div style="background: #f5f5f5; padding: 15px; text-align: center; border-radius: 0 0 10px 10px; font-size: 12px; color: #666;">
                    <p style="margin: 0;">This message was sent from the Cronos AI landing page</p>
                </div>
            </div>
        `,
        text: `
═══════════════════════════════════════════════════════
  NEW DEMO REQUEST - CRONOS AI
═══════════════════════════════════════════════════════

CONTACT INFORMATION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Name: ${name}
📧 Email: ${email}

MESSAGE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${message}

═══════════════════════════════════════════════════════
💡 Tip: Reply to this email to respond directly to ${email}
═══════════════════════════════════════════════════════

This message was sent from the Cronos AI landing page.
        `
    };

    try {
        console.log('📧 Sending email via SendGrid:', {
            from: `${msg.from.name} <${msg.from.email}>`,
            to: msg.to,
            replyTo: `${msg.replyTo.name} <${msg.replyTo.email}>`,
            subject: msg.subject,
            timestamp: new Date().toISOString()
        });
        
        const response = await sgMail.send(msg);
        const messageId = response[0]?.headers?.['x-message-id'] || 'N/A';
        
        console.log('✅ Email sent via SendGrid successfully:', {
            messageId: messageId,
            statusCode: response[0]?.statusCode,
            timestamp: new Date().toISOString()
        });
        
        return response;
    } catch (error) {
        console.error('❌ SendGrid error occurred:', {
            message: error.message,
            code: error.code,
            timestamp: new Date().toISOString()
        });
        
        if (error.response) {
            const errorBody = error.response.body;
            console.error('❌ SendGrid error response:', {
                statusCode: error.response.statusCode,
                body: JSON.stringify(errorBody, null, 2)
            });
            
            // Log específico para rate limiting
            if (errorBody && errorBody.errors) {
                errorBody.errors.forEach((err, index) => {
                    console.error(`❌ SendGrid error ${index + 1}:`, {
                        field: err.field,
                        message: err.message,
                        help: err.help
                    });
                });
            }
        }
        
        throw error;
    }
}

// Función alternativa usando Mailgun
async function sendEmailWithMailgun(name, email, message) {
    const formData = require('form-data');
    const Mailgun = require('mailgun.js');
    const mailgun = new Mailgun(formData);
    
    const mg = mailgun.client({
        username: 'api',
        key: process.env.MAILGUN_API_KEY
    });

    const data = {
        from: `Landing Page <noreply@${process.env.MAILGUN_DOMAIN}>`,
        to: 'contact@usecronos.com',
        subject: `Demo Request from ${name}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #800020;">New Demo Request</h2>
                <p><strong>From:</strong> ${name}</p>
                <p><strong>Email:</strong> ${email}</p>
                <hr style="border: 1px solid #ddd; margin: 20px 0;">
                <h3 style="color: #800020;">Message:</h3>
                <p style="background: #f5f5f5; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${message}</p>
            </div>
        `,
        text: `
New Demo Request

From: ${name}
Email: ${email}

Message:
${message}
        `
    };

    await mg.messages.create(process.env.MAILGUN_DOMAIN, data);
    console.log('Email sent via Mailgun');
}

