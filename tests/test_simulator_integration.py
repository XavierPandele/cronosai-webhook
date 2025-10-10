#!/usr/bin/env python3
"""
Script de prueba para verificar la integración del webhook en el simulador
"""

import os
import sys
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Agregar el directorio src al path
sys.path.append('src')

from microphone_simulator import MicrophoneSimulator

def test_simulator_webhook_integration():
    """Prueba la integración del webhook en el simulador"""
    
    print("🧪 PRUEBA DE INTEGRACIÓN DEL WEBHOOK EN SIMULADOR")
    print("=" * 60)
    
    # Configuración
    WEBHOOK_URL = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
    
    print(f"🔧 Configuración:")
    print(f"   Webhook URL: {WEBHOOK_URL}")
    print()
    
    try:
        # Crear el simulador
        print("🚀 Creando simulador...")
        simulator = MicrophoneSimulator(WEBHOOK_URL)
        print("✅ Simulador creado exitosamente")
        print()
        
        # Datos de prueba simulando una respuesta de Dialogflow
        test_parameters = {
            'NomReserva': 'María García',
            'TelefonReserva': '+49123456789',
            'FechaReserva': {
                'year': 2024,
                'month': 3,
                'day': 25
            },
            'HoraReserva': {
                'hours': 20,
                'minutes': 0,
                'seconds': 0
            },
            'NumeroReserva': 4,
            'Observacions': 'Mesa cerca de la ventana'
        }
        
        print("🧪 Probando llamada al webhook...")
        print(f"📋 Parámetros de prueba: {test_parameters}")
        print("-" * 40)
        
        # Probar la función del webhook
        webhook_success = simulator._call_webhook_for_reservation(test_parameters)
        
        if webhook_success:
            print("✅ Webhook funcionó correctamente")
            if hasattr(simulator, 'last_webhook_response'):
                print(f"💬 Respuesta del webhook: {simulator.last_webhook_response}")
        else:
            print("❌ Webhook falló")
        
        print()
        print("🧪 Probando formateo de parámetros...")
        formatted_params = simulator._format_parameters_for_webhook(test_parameters)
        print(f"📋 Parámetros formateados: {formatted_params}")
        
        print()
        print("🎉 Pruebas del simulador completadas")
        print()
        print("📝 Para probar el simulador completo, ejecuta:")
        print("   cd src")
        print("   python microphone_simulator.py")
        
    except Exception as e:
        print(f"❌ Error creando el simulador: {e}")
        print("💡 Verifica tu configuración de credenciales y variables de entorno")

if __name__ == "__main__":
    test_simulator_webhook_integration()
