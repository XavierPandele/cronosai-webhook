#!/usr/bin/env python3
"""
Script de prueba para verificar la integración del webhook
"""

import os
import sys
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Agregar el directorio src al path
sys.path.append('src')

from main import VoiceReservationSystem

def test_webhook_integration():
    """Prueba la integración del webhook con texto de reserva"""
    
    print("🧪 PRUEBA DE INTEGRACIÓN DEL WEBHOOK")
    print("=" * 50)
    
    # Configuración
    PROJECT_ID = os.getenv('PROJECT_ID', 'cronos-473012')
    LOCATION = os.getenv('LOCATION', 'eu')
    AGENT_ID = os.getenv('AGENT_ID', 'e44a94ba-5f5c-4eec-8f00-d03d9ca0c3b9')
    WEBHOOK_URL = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
    
    print(f"🔧 Configuración:")
    print(f"   Project ID: {PROJECT_ID}")
    print(f"   Location: {LOCATION}")
    print(f"   Agent ID: {AGENT_ID}")
    print(f"   Webhook URL: {WEBHOOK_URL}")
    print()
    
    try:
        # Crear el sistema
        print("🚀 Creando sistema de reservas...")
        system = VoiceReservationSystem(PROJECT_ID, LOCATION, AGENT_ID, WEBHOOK_URL)
        print("✅ Sistema creado exitosamente")
        print()
        
        # Textos de prueba para reservas
        test_texts = [
            "Quiero reservar una mesa para 4 personas para mañana a las 8 de la noche",
            "Necesito hacer una reserva para 2 personas el viernes a las 19:30",
            "Reservar mesa para 6 personas para el sábado a las 20:00"
        ]
        
        for i, text in enumerate(test_texts, 1):
            print(f"📝 PRUEBA {i}: {text}")
            print("-" * 40)
            
            try:
                result = system.process_text_input(text)
                
                if result['success']:
                    print(f"✅ Éxito:")
                    print(f"   Intención: {result['intent']['intent_name']}")
                    print(f"   Confianza: {result['intent']['confidence']:.2f}")
                    print(f"   Respuesta: {result['response_text']}")
                    
                    if result['response_audio_path']:
                        print(f"   Audio guardado: {result['response_audio_path']}")
                else:
                    print(f"❌ Error: {result.get('error', 'Error desconocido')}")
                    
            except Exception as e:
                print(f"❌ Error en la prueba: {e}")
            
            print()
        
        print("🎉 Pruebas completadas")
        
    except Exception as e:
        print(f"❌ Error creando el sistema: {e}")
        print("💡 Verifica tu configuración de credenciales y variables de entorno")

if __name__ == "__main__":
    test_webhook_integration()
