# 🎤 Resumen de Voces Disponibles

## Archivos de Muestra Generados

Se han generado archivos de audio en la carpeta `voice_samples/` para que puedas escuchar las diferentes voces:

### Voces Neural2 (Más Naturales)
- **01_es_ES_Neural2_A.mp3** - Femenina (actual)
- **02_es_ES_Neural2_B.mp3** - Masculina  
- **03_es_ES_Neural2_C.mp3** - Femenina alternativa

### Voces Standard (Clásicas)
- **04_es_ES_Standard_A.mp3** - Femenina
- **05_es_ES_Standard_B.mp3** - Masculina
- **06_es_ES_Standard_C.mp3** - Femenina alternativa
- **07_es_ES_Standard_D.mp3** - Masculina alternativa

### Voces WaveNet (Avanzadas)
- **08_es_ES_Wavenet_B.mp3** - Masculina
- **09_es_ES_Wavenet_C.mp3** - Femenina
- **10_es_ES_Wavenet_D.mp3** - Masculina alternativa

## Cómo Probar las Voces

### Opción 1: Escuchar Archivos Directamente
1. Ve a la carpeta `voice_samples/`
2. Reproduce cada archivo .mp3
3. Elige la voz que más te guste

### Opción 2: Usar el Simulador Interactivo
1. Ejecuta: `python src/voice_conversational_simulator.py`
2. Selecciona una voz del menú
3. Prueba la voz con el comando 'test'
4. Usa 'skip' para continuar con esa voz

### Opción 3: Cambiar Voz Durante la Conversación
1. Durante una conversación, escribe 'voz'
2. Selecciona una nueva voz
3. Prueba la voz
4. Continúa la conversación

## Voces Recomendadas

- **Para sonido más natural**: Neural2-A, Neural2-B, Neural2-C
- **Para sonido clásico**: Standard-A, Standard-B
- **Para sonido avanzado**: WaveNet-B, WaveNet-C

## Aplicar la Voz Elegida al Código Principal

Una vez que elijas tu voz favorita, actualiza estos archivos:

### 1. api/twilio-call.js
```javascript
voice="es-ES-Neural2-A"  // Cambia por tu voz elegida
```

### 2. src/voice_conversational_simulator.py
```python
self.current_voice = 'es-ES-Neural2-A'  # Cambia por tu voz elegida
```

## Notas Técnicas

- Las voces Neural2 son las más naturales y recomendadas
- Las voces Standard son más básicas pero funcionan bien
- Las voces WaveNet son avanzadas pero algunas no están disponibles
- Todas las voces funcionan en español (es-ES)
