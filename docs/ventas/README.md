# 📁 MATERIALES DE VENTA

Este directorio contiene todos los materiales necesarios para las reuniones de ventas.

---

## 📄 ARCHIVOS DISPONIBLES

### 1. **PRESENTACION_VENTA_CLIENTE.md**
📝 **Documento principal de guía** (Formato Markdown)

- ✅ Propuesta de valor completa
- ✅ Análisis de costes y ROI
- ✅ Características detalladas
- ✅ Casos de uso
- ✅ 10 objeciones y respuestas técnicas avanzadas
- ✅ Casos de éxito reales
- ✅ Script de demostración paso a paso
- ✅ Frases de cierre poderosas
- ✅ Checklist pre-reunión

**✨ USO:** Leer ANTES de la reunión. Guía completa para preparación.

---

### 2. **PRESENTACION_VENTA_CLIENTE_VISUAL.md**
🎨 **Material visual** (Formato Markdown con diagramas ASCII)

- ✅ 25 slides con diagramas visuales
- ✅ Comparaciones lado a lado
- ✅ Casos de uso en código
- ✅ Gráficos de ahorro
- ✅ Flujos de proceso
- ✅ Tablas comparativas

**✨ USO:** Proyectar en pantalla durante la reunión. Apoyo visual.

**📊 DIAGRAMAS MERMAID:** Los diagramas pueden visualizarse en:
- [GitHub](https://github.com) - Se renderizan automáticamente
- [Mermaid Live Editor](https://mermaid.live) - Para capturar screenshots
- Visual Studio Code - Con extensión Mermaid Preview
- PowerPoint - Importar screenshots de mermaid.live

---

### 3. **presentacion-venta-cliente.md**
🎤 **Presentación Marp** (Formato para generar PDF/HTML)

- ✅ 30+ slides profesionales
- ✅ Diseño limpio y moderno
- ✅ Genera PDF automáticamente
- ✅ Genera HTML interactivo

**✨ USO:** Para proyectos y presentaciones formales.

**🔧 GENERAR NUEVOS ARCHIVOS:**

```bash
# Generar PDF
npx -y @marp-team/marp-cli@latest presentacion-venta-cliente.md --pdf --output PRESENTACION.pdf

# Generar HTML (interactivo)
npx -y @marp-team/marp-cli@latest presentacion-venta-cliente.md --html --output PRESENTACION.html

# Presentar en pantalla (modo presentación)
npx -y @marp-team/marp-cli@latest presentacion-venta-cliente.md --server
```

---

### 4. **PRESENTACION_VENTA_CLIENTE.pdf**
📄 **PDF generado** (Listo para enviar/imprimir)

- ✅ Versión final en PDF
- ✅ 30+ diapositivas
- ✅ Diseño profesional
- ✅ Lista para compartir

**✨ USO:** Enviar por email después de la reunión, imprimir, compartir.

---

### 5. **PRESENTACION_VENTA_CLIENTE.html**
🌐 **HTML interactivo** (Para presentar en navegador)

- ✅ Versión web interactiva
- ✅ Navegación con teclado
- ✅ Modo presentación
- ✅ Responsive design

**✨ USO:** Abrir en navegador y usar F11 para pantalla completa. Presentar con navegador.

---

## 🎯 FLUJO DE USO RECOMENDADO

### **ANTES DE LA REUNIÓN**

```
1. Leer: PRESENTACION_VENTA_CLIENTE.md
   ↓
   (Preparación completa: objeciones, datos, casos)

2. Revisar: PRESENTACION_VENTA_CLIENTE_VISUAL.md
   ↓
   (Material visual de apoyo para proyección)

3. Preparar: Checklist y materiales
   ↓
   (Ver sección "CHECKLIST PRE-REUNIÓN")
```

### **DURANTE LA REUNIÓN**

```
OPCIÓN A: Proyectar con laptop
├─ Abrir: PRESENTACION_VENTA_CLIENTE.html
├─ F11: Pantalla completa
└─ Usar flechas para navegar

OPCIÓN B: Mostrar PDF en tablet/laptop
├─ Abrir: PRESENTACION_VENTA_CLIENTE.pdf
└─ Mostrar slides manualmente

OPCIÓN C: Presentación tradicional
├─ Usar: PRESENTACION_VENTA_CLIENTE_VISUAL.md
├─ Proyectar en pantalla
└─ Copiar textos a PowerPoint si necesario
```

### **DESPUÉS DE LA REUNIÓN**

```
1. Enviar: PRESENTACION_VENTA_CLIENTE.pdf
   ↓
   (Material formal para revisión)

2. Seguimiento: Seguir roadmap en documento
   ↓
   (Ver "PRÓXIMOS PASOS")
```

---

## 🛠️ CONVERSIÓN A POWERPOINT (OPCIONAL)

Si prefieres usar PowerPoint tradicional:

### **Opción 1: Marp → PowerPoint**
```bash
# 1. Generar HTML primero
npx -y @marp-team/marp-cli@latest presentacion-venta-cliente.md --html

# 2. Abrir HTML en navegador
# 3. Imprimir cada slide como PDF
# 4. Combinar PDFs en PowerPoint
```

### **Opción 2: Manual**
1. Abrir `PRESENTACION_VENTA_CLIENTE_VISUAL.md`
2. Copiar cada slide
3. Pegar en PowerPoint
4. Ajustar diseño

### **Opción 3: Online Converters**
- Usar [Markdown to PowerPoint](https://www.markdowntopresentation.com)
- Importar `presentacion-venta-cliente.md`

---

## 📊 RECURSOS ADICIONALES

### **Diagramas Mermaid**

Los diagramas pueden exportarse como imágenes:

1. Ir a [mermaid.live](https://mermaid.live)
2. Pegar código del diagrama
3. Download PNG/SVG
4. Usar en cualquier presentación

### **Temas de Marp**

Personalizar el tema en `presentacion-venta-cliente.md`:

```yaml
---
theme: default        # default, gaia, uncover
paginate: true        # Mostrar números
backgroundColor: #fff # Color fondo
color: #000          # Color texto
---
```

Temas disponibles:
- `default` - Clásico y limpio
- `gaia` - Estilo WordPress
- `uncover` - Animaciones

---

## ✅ CHECKLIST ANTES DE USAR

### **Verificación de archivos:**
- [ ] `PRESENTACION_VENTA_CLIENTE.md` existe
- [ ] `PRESENTACION_VENTA_CLIENTE.pdf` generado
- [ ] `PRESENTACION_VENTA_CLIENTE.html` generado
- [ ] Navegador web instalado
- [ ] Laptop cargada

### **Preparación técnica:**
- [ ] Probar HTML en navegador
- [ ] Verificar que PDF se abre
- [ ] Test de proyección (si presenta)
- [ ] Internet estable (si demo en vivo)

### **Contenido:**
- [ ] Revisar números de ROI
- [ ] Memorizar casos de éxito
- [ ] Preparar respuestas a objeciones
- [ ] Tener demo funcionando

---

## 🚀 QUICK START

### **Para empezar AHORA:**

```bash
# 1. Abrir HTML en navegador (preparado)
start docs/ventas/PRESENTACION_VENTA_CLIENTE.html

# 2. O abrir PDF
start docs/ventas/PRESENTACION_VENTA_CLIENTE.pdf

# 3. O presentar con Marp (modo live)
cd docs/ventas
npx -y @marp-team/marp-cli@latest presentacion-venta-cliente.md --server --port 8080
```

---

## 📞 SOPORTE

Si algo no funciona:

1. **PDF no se genera:** Verificar que Node.js esté instalado
2. **HTML no carga:** Verificar navegador actualizado
3. **Mermaid no renderiza:** Abrir en GitHub o mermaid.live
4. **Falta algo:** Revisar `PRESENTACION_VENTA_CLIENTE.md` (documento completo)

---

## 📝 NOTAS

- Todos los archivos son auto-contenidos
- No necesitas conexión internet para presentar
- Los números y datos están actualizados
- Personaliza según tu caso específico

---

## 🎯 RECOMENDACIÓN FINAL

**Para máxima efectividad:**

1. ✅ **Lee** el documento completo ANTES de la reunión
2. ✅ **Practica** la demo en vivo 3 veces
3. ✅ **Prepara** respuestas a objeciones
4. ✅ **Ten** todos los materiales listos
5. ✅ **Confía** en tu producto

---

**¡Éxito en tus ventas!** 🚀💼

