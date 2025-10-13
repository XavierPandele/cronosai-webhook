#!/usr/bin/env python3
"""
Script para probar la voz seleccionada: es-ES-Neural2-B
"""

import os
import sys
sys.path.append('../src')
from speech_handler import SpeechToTextHandler
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

def test_selected_voice():
    """Prueba la voz seleccionada"""
    print("PROBANDO VOZ SELECCIONADA")
    print("=" * 40)
    print("Voz: es-ES-Neural2-B (Masculina Neural2)")
    print()
    
    try:
        # Crear handler
        handler = SpeechToTextHandler()
        
        # Mensaje de prueba del restaurante
        test_message = "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle? Me gustaría hacer una reserva para 4 personas el viernes que viene a las 8 de la noche."
        
        print(f"Generando audio para: '{test_message}'")
        print()
        
        # Sintetizar voz
        audio_content = handler.synthesize_speech(test_message, voice_name="es-ES-Neural2-B")
        
        if audio_content:
            # Guardar archivo
            output_file = "test_selected_voice.mp3"
            handler.save_audio(audio_content, output_file)
            
            print(f"✅ Audio generado exitosamente!")
            print(f"📁 Archivo: {output_file}")
            print()
            print("🎵 Reproduce el archivo para escuchar la voz seleccionada")
            print("🔊 Esta es la voz que usará tu sistema de reservas")
            
        else:
            print("❌ Error generando audio")
            
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    test_selected_voice()
