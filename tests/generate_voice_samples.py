#!/usr/bin/env python3
"""
Script para generar automáticamente muestras de todas las voces
"""

import os
import sys
sys.path.append('../src')
from speech_handler import SpeechToTextHandler
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Lista de voces disponibles
VOICES = {
    '1': 'es-ES-Neural2-A',      # Voz femenina actual
    '2': 'es-ES-Neural2-B',      # Voz masculina
    '3': 'es-ES-Neural2-C',      # Voz femenina alternativa
    '4': 'es-ES-Neural2-D',      # Voz masculina alternativa
    '5': 'es-ES-Standard-A',     # Voz estándar femenina
    '6': 'es-ES-Standard-B',     # Voz estándar masculina
    '7': 'es-ES-Standard-C',     # Voz estándar femenina 2
    '8': 'es-ES-Standard-D',     # Voz estándar masculina 2
    '9': 'es-ES-Wavenet-A',      # Voz WaveNet femenina
    '10': 'es-ES-Wavenet-B',     # Voz WaveNet masculina
    '11': 'es-ES-Wavenet-C',     # Voz WaveNet femenina 2
    '12': 'es-ES-Wavenet-D',     # Voz WaveNet masculina 2
}

def generate_voice_samples():
    """Genera muestras de todas las voces"""
    print("GENERANDO MUESTRAS DE VOCES")
    print("=" * 50)
    
    try:
        # Crear handler
        handler = SpeechToTextHandler()
        
        # Crear carpeta para las muestras
        samples_dir = "voice_samples"
        if not os.path.exists(samples_dir):
            os.makedirs(samples_dir)
        
        # Mensaje de prueba
        test_message = "Hola, esta es una prueba de la voz actual. ¿Te gusta cómo suena?"
        
        print(f"Generando muestras para {len(VOICES)} voces...")
        print(f"Guardando en carpeta: {samples_dir}/")
        print()
        
        for key, voice_name in VOICES.items():
            voice_type = "Neural2" if "Neural2" in voice_name else "Standard" if "Standard" in voice_name else "WaveNet"
            gender = "Femenina" if voice_name.endswith('A') or voice_name.endswith('C') else "Masculina"
            
            print(f"Generando {key:2}. {voice_name} ({voice_type} - {gender})")
            
            try:
                # Sintetizar voz
                audio_content = handler.synthesize_speech(test_message, voice_name=voice_name)
                
                if audio_content:
                    # Guardar archivo
                    safe_name = voice_name.replace('-', '_')
                    output_file = os.path.join(samples_dir, f"{key:02}_{safe_name}.mp3")
                    
                    with open(output_file, 'wb') as f:
                        f.write(audio_content)
                    
                    print(f"  OK - Guardado: {output_file}")
                else:
                    print(f"  ERROR - Error sintetizando voz")
                    
            except Exception as e:
                print(f"  ERROR - {e}")
        
        print()
        print("¡Muestras generadas!")
        print(f"Revisa la carpeta '{samples_dir}' para escuchar las diferentes voces")
        print()
        print("Archivos generados:")
        if os.path.exists(samples_dir):
            files = sorted(os.listdir(samples_dir))
            for file in files:
                if file.endswith('.mp3'):
                    print(f"  - {file}")
        
    except Exception as e:
        print(f"Error general: {e}")

if __name__ == "__main__":
    generate_voice_samples()
