#!/usr/bin/env python3
"""
Cliente simple sin emojis para testing
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_exact_phrase():
    """Prueba la frase exacta que funciona en la interfaz web"""
    
    print("PROBANDO FRASE EXACTA DE LA INTERFAZ WEB")
    print("=" * 50)
    
    try:
        # Configurar cliente
        if os.getenv('LOCATION') == 'eu':
            client = df.SessionsClient(
                client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
            )
        else:
            client = df.SessionsClient()
        
        # Construir session path
        session_path = client.session_path(
            os.getenv('PROJECT_ID'),
            os.getenv('LOCATION'),
            os.getenv('AGENT_ID'),
            "default-session"
        )
        
        print(f"Session Path: {session_path}")
        
        # Frase exacta que funciona en la interfaz web
        test_phrase = "me gustaria reservar una mesa"
        
        print(f"Probando frase: '{test_phrase}'")
        print("(Esta frase funciona en la interfaz web de Dialogflow CX)")
        print()
        
        # Crear query input
        query_input = df.QueryInput(
            text=df.TextInput(text=test_phrase),
            language_code="es-ES"
        )
        
        request = df.DetectIntentRequest(
            session=session_path,
            query_input=query_input,
            environment="draft"  # Usar environment draft
        )
        
        response = client.detect_intent(request=request)
        result = response.query_result
        intent = result.intent
        
        print("RESULTADO:")
        print(f"Intent: '{intent.display_name if intent else 'None'}'")
        print(f"Confianza: {result.intent_detection_confidence:.2f}")
        print(f"Respuesta: {result.fulfillment_text}")
        
        if intent and intent.display_name == 'ReservarMesa':
            print("\nEXITO! El intent se detecto correctamente.")
            print(f"Parametros: {dict(result.parameters)}")
        else:
            print(f"\nPROBLEMA: Se detecto '{intent.display_name if intent else 'None'}' en lugar de 'ReservarMesa'")
            print("\nPosibles causas:")
            print("1. Problema de region/endpoint")
            print("2. Problema de version del agente")
            print("3. Problema de session path")
            print("4. Problema de configuracion de credenciales")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_exact_phrase()
