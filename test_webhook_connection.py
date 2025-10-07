#!/usr/bin/env python3
"""
Script para probar la conexión directa con el webhook
"""

import requests
import json
import os
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

def test_webhook_connection():
    """Prueba la conexión directa con el webhook"""
    
    print("🌐 PRUEBA DE CONEXIÓN CON WEBHOOK")
    print("=" * 50)
    
    # URL del webhook
    webhook_url = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
    print(f"🔗 Webhook URL: {webhook_url}")
    print()
    
    # Datos de prueba para una reserva
    test_data = {
        "sessionInfo": {
            "session": "test-session-123",
            "parameters": {
                "nomreserva": "Juan Pérez",
                "telefonreserva": "+49123456789",
                "fechareserva": {
                    "year": 2024,
                    "month": 3,
                    "day": 25
                },
                "horareserva": {
                    "hours": 20,
                    "minutes": 0,
                    "seconds": 0
                },
                "numeroreserva": 4,
                "observacions": "Mesa cerca de la ventana"
            }
        },
        "languageCode": "es-ES"
    }
    
    print("📤 Enviando datos de prueba:")
    print(json.dumps(test_data, indent=2))
    print()
    
    try:
        # Probar conexión GET primero
        print("🔍 Probando conexión GET...")
        get_response = requests.get(webhook_url, timeout=10)
        print(f"   Status: {get_response.status_code}")
        if get_response.status_code == 200:
            print("✅ Webhook está disponible")
        else:
            print(f"⚠️ Respuesta inesperada: {get_response.text}")
        print()
        
        # Probar envío de datos POST
        print("📤 Enviando datos de reserva...")
        post_response = requests.post(
            webhook_url,
            json=test_data,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        print(f"📥 Respuesta del webhook:")
        print(f"   Status: {post_response.status_code}")
        print(f"   Headers: {dict(post_response.headers)}")
        
        if post_response.status_code == 200:
            response_data = post_response.json()
            print("✅ Webhook procesó la solicitud exitosamente")
            print("📋 Respuesta completa:")
            print(json.dumps(response_data, indent=2))
        else:
            print(f"❌ Error en el webhook:")
            print(f"   Status: {post_response.status_code}")
            print(f"   Response: {post_response.text}")
            
    except requests.exceptions.ConnectionError as e:
        print(f"❌ Error de conexión: {e}")
        print("💡 Verifica que el webhook esté desplegado y accesible")
    except requests.exceptions.Timeout as e:
        print(f"❌ Timeout: {e}")
        print("💡 El webhook tardó demasiado en responder")
    except Exception as e:
        print(f"❌ Error inesperado: {e}")

if __name__ == "__main__":
    test_webhook_connection()
