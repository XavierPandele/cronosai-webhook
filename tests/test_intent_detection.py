#!/usr/bin/env python3
"""
Script para probar la detección de intents con diferentes frases
"""

import os
import sys
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Agregar el directorio src al path
sys.path.append('src')

from dialogflow_client import DialogflowCXClient

def test_intent_detection():
    """Prueba la detección de intents con diferentes frases"""
    
    print("PROBANDO DETECCION DE INTENTS")
    print("=" * 50)
    
    try:
        client = DialogflowCXClient(
            os.getenv('PROJECT_ID'),
            os.getenv('LOCATION'), 
            os.getenv('AGENT_ID')
        )
        
        # Probar con diferentes variaciones
        test_phrases = [
            'Quiero reservar una mesa',
            'Reservar mesa',
            'Hacer reserva',
            'Necesito reservar',
            'Reservar para 4 personas',
            'Quiero hacer una reserva',
            'Mesa para dos personas',
            'Reservar una mesa para mañana',
            '¿Puedo reservar?',
            'Reserva de mesa'
        ]
        
        print("Probando diferentes frases de reserva...")
        print()
        
        for i, phrase in enumerate(test_phrases, 1):
            print(f"Prueba {i}: \"{phrase}\"")
            response = client.detect_intent_from_text(phrase)
            print(f"   Intent: '{response['intent_name']}'")
            print(f"   Confianza: {response['confidence']:.2f}")
            print(f"   Respuesta: {response['fulfillment_text']}")
            
            if response['intent_name'] == 'ReservarMesa':
                print("   ¡INTENT DETECTADO CORRECTAMENTE!")
                print(f"   Parametros: {response['parameters']}")
            else:
                print("   Intent NO detectado")
            print("-" * 40)
        
        print("\nCONCLUSIONES:")
        print("Si ninguna frase detecta 'ReservarMesa', el problema esta en:")
        print("1. El agente no tiene configurado el intent 'ReservarMesa'")
        print("2. Las frases de entrenamiento no coinciden")
        print("3. El agente no esta publicado o activo")
        print("4. Problema de configuracion de region")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_intent_detection()
