const { mdToPdf } = require('md-to-pdf');
const path = require('path');
const fs = require('fs');

async function convertMarkdownToPDF() {
  const markdownFile = path.join(__dirname, '../docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.md');
  const outputFile = path.join(__dirname, '../docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.pdf');

  // Verificar que el archivo existe
  if (!fs.existsSync(markdownFile)) {
    console.error(`❌ Error: No se encontró el archivo ${markdownFile}`);
    process.exit(1);
  }

  console.log('📄 Convirtiendo Markdown a PDF...');
  console.log(`📂 Archivo origen: ${markdownFile}`);
  console.log(`📂 Archivo destino: ${outputFile}`);

  const stylesheetPath = path.join(__dirname, 'pdf-styles.css');

  try {
    const pdf = await mdToPdf(
      { path: markdownFile },
      {
        // Configuración del PDF
        pdf_options: {
          format: 'A4',
          margin: {
            top: '20mm',
            right: '15mm',
            bottom: '20mm',
            left: '15mm'
          },
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: `
            <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
              <span>Guía Completa para Agentes de Ventas - CronosAI</span>
            </div>
          `,
          footerTemplate: `
            <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
              <span class="pageNumber"></span> / <span class="totalPages"></span>
            </div>
          `
        },
        // Estilos CSS personalizados (ruta al archivo)
        stylesheet: stylesheetPath
      }
    );

    if (pdf) {
      fs.writeFileSync(outputFile, pdf.content);
      console.log('✅ PDF generado exitosamente!');
      console.log(`📄 Archivo guardado en: ${outputFile}`);
      console.log(`📊 Tamaño: ${(pdf.content.length / 1024).toFixed(2)} KB`);
    } else {
      console.error('❌ Error: No se pudo generar el PDF');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error al convertir a PDF:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar la conversión
convertMarkdownToPDF();

