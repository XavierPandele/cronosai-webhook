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
        console.error('Error procesando contacto:', error);
        return res.status(500).json({
            error: 'Error del servidor',
            message: 'No se pudo enviar el mensaje. Por favor, inténtalo de nuevo más tarde.'
        });
    }
}

async function sendEmail(name, email, message) {
    // Usar nodemailer si está configurado, o usar un servicio de email
    // Para producción, se recomienda usar SendGrid, Mailgun, o configurar SMTP
    
    const nodemailer = require('nodemailer');
    
    // Configuración del transporter
    // Nota: En producción, configura estas variables en Vercel Environment Variables
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false, // true para 465, false para otros puertos
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    // Si no hay configuración SMTP, usar un servicio alternativo
    if (!process.env.SMTP_USER) {
        // Opción 1: Usar SendGrid (recomendado para producción)
        if (process.env.SENDGRID_API_KEY) {
            return sendEmailWithSendGrid(name, email, message);
        }
        
        // Opción 2: Usar Mailgun
        if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
            return sendEmailWithMailgun(name, email, message);
        }
        
        // Si no hay configuración, lanzar error informativo
        throw new Error('Email service not configured. Please set up SMTP or email service credentials.');
    }

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
    console.log('Email sent:', info.messageId);
    return info;
}

// Función alternativa usando SendGrid
async function sendEmailWithSendGrid(name, email, message) {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const msg = {
        to: 'contact@usecronos.com',
        from: process.env.SENDGRID_FROM_EMAIL || 'noreply@usecronos.com',
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

    await sgMail.send(msg);
    console.log('Email sent via SendGrid');
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

