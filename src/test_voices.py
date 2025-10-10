#!/usr/bin/env python3
"""
Script simple para probar diferentes voces
"""

import os
import sys
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

def test_voice(voice_name):
    """Prueba una voz específica"""
    print(f"\nProbando voz: {voice_name}")
    
    try:
        # Crear handler
        handler = SpeechToTextHandler()
        
        # Mensaje de prueba
        test_message = "Hola, esta es una prueba de la voz actual. ¿Te gusta cómo suena?"
        
        # Sintetizar voz
        audio_content = handler.synthesize_speech(test_message, voice_name=voice_name)
        
        if audio_content:
            # Guardar archivo
            output_file = f"test_voice_{voice_name.replace('-', '_')}.mp3"
            handler.save_audio(audio_content, output_file)
            print(f"Audio guardado en: {output_file}")
            print("Reproduce el archivo para escuchar la voz")
            return True
        else:
            print("Error sintetizando voz")
            return False
            
    except Exception as e:
        print(f"Error: {e}")
        return False

def main():
    """Función principal"""
    print("PROBADOR DE VOCES")
    print("=" * 50)
    print("Este script genera archivos de audio para que puedas escuchar las diferentes voces")
    print()
    
    # Mostrar voces disponibles
    print("Voces disponibles:")
    for key, voice in VOICES.items():
        voice_type = "Neural2" if "Neural2" in voice else "Standard" if "Standard" in voice else "WaveNet"
        gender = "Femenina" if voice.endswith('A') or voice.endswith('C') else "Masculina"
        print(f"  {key:2}. {voice:<25} ({voice_type} - {gender})")
    
    print()
    print("Opciones:")
    print("  'all' - Generar archivos para todas las voces")
    print("  'femeninas' - Solo voces femeninas")
    print("  'masculinas' - Solo voces masculinas")
    print("  'neural' - Solo voces Neural2")
    print("  Número específico - Probar una voz específica")
    
    choice = input("\n¿Qué quieres probar? ").strip().lower()
    
    if choice == 'all':
        print("\nGenerando archivos para todas las voces...")
        for voice_name in VOICES.values():
            test_voice(voice_name)
    
    elif choice == 'femeninas':
        print("\nGenerando archivos para voces femeninas...")
        for voice_name in VOICES.values():
            if voice_name.endswith('A') or voice_name.endswith('C'):
                test_voice(voice_name)
    
    elif choice == 'masculinas':
        print("\nGenerando archivos para voces masculinas...")
        for voice_name in VOICES.values():
            if voice_name.endswith('B') or voice_name.endswith('D'):
                test_voice(voice_name)
    
    elif choice == 'neural':
        print("\nGenerando archivos para voces Neural2...")
        for voice_name in VOICES.values():
            if 'Neural2' in voice_name:
                test_voice(voice_name)
    
    elif choice in VOICES:
        test_voice(VOICES[choice])
    
    else:
        print("Opción no válida")
        return
    
    print("\n¡Listo! Revisa los archivos .mp3 generados para escuchar las voces")

if __name__ == "__main__":
    main()
