const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const url = 'https://cronosai-webhook.vercel.app/LandingPage/index.html';
const outputPath = path.join(__dirname, 'LandingPage', 'qrcode.png');

// Configuración del QR code
const options = {
    errorCorrectionLevel: 'H', // Alto nivel de corrección de errores
    type: 'png',
    quality: 0.92,
    margin: 2,
    color: {
        dark: '#800020', // Color burgundy que coincide con tu diseño
        light: '#FFFFFF' // Fondo blanco
    },
    width: 512 // Tamaño grande para alta calidad
};

QRCode.toFile(outputPath, url, options, (err) => {
    if (err) {
        console.error('Error generando el código QR:', err);
        process.exit(1);
    }
    
    console.log('✓ Código QR generado exitosamente!');
    console.log(`✓ Archivo guardado en: ${outputPath}`);
    console.log(`✓ URL codificada: ${url}`);
    console.log(`✓ Tamaño: 512x512 píxeles`);
    console.log(`✓ Color: Burgundy (#800020) con fondo blanco`);
});



