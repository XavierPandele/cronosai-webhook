# 📄 Cómo Convertir la Guía a PDF

Este documento explica las diferentes formas de convertir `GUIA_COMPLETA_AGENTES_VENTAS.md` a PDF.

---

## 🚀 Método 1: Script Automático (Recomendado)

### Paso 1: Instalar la dependencia

```bash
npm install --save-dev md-to-pdf
```

### Paso 2: Ejecutar el script

```bash
npm run convert-to-pdf
```

O directamente:

```bash
node scripts/convert-to-pdf.js
```

### Resultado

El PDF se generará en: `docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.pdf`

---

## 🌐 Método 2: Herramientas Online (Sin Instalar Nada)

### Opción A: Dillinger.io

1. Ve a https://dillinger.io
2. Abre el archivo `GUIA_COMPLETA_AGENTES_VENTAS.md`
3. Click en el botón "Export as" → "Styled HTML"
4. Abre el HTML en tu navegador
5. Presiona `Ctrl+P` (Windows) o `Cmd+P` (Mac)
6. Selecciona "Guardar como PDF"

### Opción B: Markdown to PDF

1. Ve a https://www.markdowntopdf.com
2. Sube el archivo `GUIA_COMPLETA_AGENTES_VENTAS.md`
3. Click en "Convert to PDF"
4. Descarga el PDF generado

### Opción C: CloudConvert

1. Ve a https://cloudconvert.com/md-to-pdf
2. Sube el archivo Markdown
3. Click en "Convert"
4. Descarga el PDF

---

## 💻 Método 3: Usando Pandoc (Línea de Comandos)

Si tienes Pandoc instalado:

```bash
pandoc docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.md -o docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.pdf --pdf-engine=wkhtmltopdf
```

O con LaTeX (mejor calidad):

```bash
pandoc docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.md -o docs/ventas/GUIA_COMPLETA_AGENTES_VENTAS.pdf
```

---

## 📱 Método 4: Desde VS Code

1. Instala la extensión "Markdown PDF" en VS Code
2. Abre el archivo `GUIA_COMPLETA_AGENTES_VENTAS.md`
3. Presiona `Ctrl+Shift+P` (Windows) o `Cmd+Shift+P` (Mac)
4. Escribe "Markdown PDF: Export (pdf)"
5. Selecciona la opción
6. El PDF se generará en la misma carpeta

---

## 🖥️ Método 5: Desde el Navegador (Chrome/Edge)

1. Instala una extensión de Markdown Preview (ej: "Markdown Preview Enhanced")
2. Abre el archivo Markdown en VS Code o cualquier editor
3. Usa la vista previa de Markdown
4. Presiona `Ctrl+P` (Windows) o `Cmd+P` (Mac)
5. Selecciona "Guardar como PDF"
6. Ajusta la configuración:
   - Márgenes: Mínimos
   - Escala: 100%
   - Opciones: Marca "Gráficos de fondo"

---

## ⚙️ Configuración del PDF (Script Automático)

El script `convert-to-pdf.js` incluye:

- ✅ Formato A4
- ✅ Márgenes optimizados (20mm arriba/abajo, 15mm izquierda/derecha)
- ✅ Encabezado y pie de página con numeración
- ✅ Estilos CSS personalizados
- ✅ Tablas con formato profesional
- ✅ Código con fondo gris
- ✅ Saltos de página inteligentes

---

## 🔧 Solución de Problemas

### Error: "md-to-pdf no se encuentra"

```bash
npm install --save-dev md-to-pdf
```

### Error: "No se puede generar el PDF"

Asegúrate de tener Node.js 18+ instalado:

```bash
node --version
```

### El PDF no se ve bien

El script usa estilos CSS personalizados. Si necesitas ajustar algo, edita el archivo `scripts/convert-to-pdf.js` y modifica la sección `stylesheet`.

---

## 📊 Comparación de Métodos

| Método | Facilidad | Calidad | Requiere Instalación |
|--------|-----------|---------|---------------------|
| Script Automático | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Sí (npm) |
| Dillinger.io | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ No |
| Markdown to PDF | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ No |
| Pandoc | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Sí |
| VS Code Extension | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ Sí (extensión) |
| Navegador | ⭐⭐⭐ | ⭐⭐⭐ | ❌ No |

---

## 💡 Recomendación

**Para uso rápido:** Usa Dillinger.io o Markdown to PDF (Método 2)

**Para mejor calidad y control:** Usa el script automático (Método 1)

**Para integración en workflow:** Usa Pandoc (Método 3)

---

## 📝 Notas

- El PDF generado incluirá todos los emojis y formato del Markdown original
- Las tablas se formatean automáticamente
- Los bloques de código mantienen su formato
- Los enlaces se convierten a texto (no son clickeables en PDF)

---

**¿Necesitas ayuda?** Revisa el script `scripts/convert-to-pdf.js` para personalizar la configuración del PDF.



