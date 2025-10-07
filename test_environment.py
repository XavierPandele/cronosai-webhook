#!/usr/bin/env python3
"""
Script para probar con environment draft específico
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_with_draft_environment():
    """Prueba con environment draft específico"""
    
    print("PROBANDO CON ENVIRONMENT DRAFT")
    print("=" * 50)
    
    try:
        # Configurar cliente
        if os.getenv('LOCATION') == 'eu':
            client = df.SessionsClient(
                client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
            )
        else:
            client = df.SessionsClient()
        
        project_id = os.getenv('PROJECT_ID')
        location = os.getenv('LOCATION')
        agent_id = os.getenv('AGENT_ID')
        
        # IMPORTANTE: Usar environment "draft" explícitamente
        # La interfaz web usa "draft" por defecto
        session_path = f"projects/{project_id}/locations/{location}/agents/{agent_id}/environments/draft/sessions/default-session"
        
        print(f"Session Path: {session_path}")
        
        test_phrase = "me gustaria reservar una mesa"
        print(f"Probando frase: '{test_phrase}'")
        print()
        
        # Crear query input
        query_input = df.QueryInput(
            text=df.TextInput(text=test_phrase),
            language_code="es-ES"
        )
        
        request = df.DetectIntentRequest(
            session=session_path,
            query_input=query_input
        )
        
        response = client.detect_intent(request=request)
        result = response.query_result
        intent = result.intent
        
        print("RESULTADO:")
        print(f"Intent: '{intent.display_name if intent else 'None'}'")
        print(f"Confianza: {result.intent_detection_confidence:.2f}")
        
        # Intentar obtener fulfillment text
        fulfillment_text = ""
        if hasattr(result, 'fulfillment_text') and result.fulfillment_text:
            fulfillment_text = result.fulfillment_text
        elif hasattr(result, 'response_messages') and result.response_messages:
            for message in result.response_messages:
                if hasattr(message, 'text') and message.text:
                    fulfillment_text += message.text.text[0] + " "
        
        print(f"Respuesta: {fulfillment_text}")
        
        if intent and intent.display_name == 'ReservarMesa':
            print("\n¡EXITO! Intent detectado correctamente con environment draft.")
            print(f"Parametros: {dict(result.parameters)}")
            return True
        else:
            print(f"\nPROBLEMA: Se detecto '{intent.display_name if intent else 'None'}' en lugar de 'ReservarMesa'")
            return False
        
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == "__main__":
    success = test_with_draft_environment()
    if success:
        print("\nSOLUCION ENCONTRADA: Usar environment 'draft' en el session path")
    else:
        print("\nEl problema persiste. Puede ser un problema de configuracion del agente.")
