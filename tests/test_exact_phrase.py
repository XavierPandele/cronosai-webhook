#!/usr/bin/env python3
"""
Script para probar la frase exacta que funciona en la interfaz web
"""

import os
import sys
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Agregar el directorio src al path
sys.path.append('src')

from dialogflow_client import DialogflowCXClient

def test_exact_phrase():
    """Prueba la frase exacta que funciona en la interfaz web"""
    
    print("PROBANDO FRASE EXACTA DE LA INTERFAZ WEB")
    print("=" * 50)
    
    try:
        client = DialogflowCXClient(
            os.getenv('PROJECT_ID'),
            os.getenv('LOCATION'), 
            os.getenv('AGENT_ID')
        )
        
        # Frase exacta que funciona en la interfaz web
        test_phrase = "me gustaria reservar una mesa"
        
        print(f"Probando frase: '{test_phrase}'")
        print("(Esta frase funciona en la interfaz web de Dialogflow CX)")
        print()
        
        response = client.detect_intent_from_text(test_phrase)
        
        print("RESULTADO:")
        print(f"Intent: '{response['intent_name']}'")
        print(f"Confianza: {response['confidence']:.2f}")
        print(f"Respuesta: {response['fulfillment_text']}")
        print(f"Parametros: {response['parameters']}")
        
        if response['intent_name'] == 'ReservarMesa':
            print("\n¡EXITO! El intent se detecto correctamente.")
        else:
            print(f"\nPROBLEMA: Se detecto '{response['intent_name']}' en lugar de 'ReservarMesa'")
            print("\nPosibles causas:")
            print("1. Problema de region/endpoint")
            print("2. Problema de version del agente")
            print("3. Problema de session path")
            print("4. Problema de configuracion de credenciales")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_exact_phrase()
