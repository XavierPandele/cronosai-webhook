#!/usr/bin/env python3
"""
Script para probar diferentes configuraciones de flow
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_different_configs():
    """Prueba diferentes configuraciones"""
    
    print("PROBANDO DIFERENTES CONFIGURACIONES")
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
        
        # Probar con diferentes session paths
        session_configs = [
            # Configuración original
            client.session_path(project_id, location, agent_id, "default-session"),
            
            # Con flow específico (si existe)
            f"projects/{project_id}/locations/{location}/agents/{agent_id}/flows/default/startFlow",
            
            # Con session diferente
            client.session_path(project_id, location, agent_id, "test-session"),
        ]
        
        test_phrase = "me gustaria reservar una mesa"
        
        for i, session_path in enumerate(session_configs, 1):
            print(f"\nCONFIGURACION {i}: {session_path}")
            print("-" * 40)
            
            try:
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
                
                print(f"Intent: '{intent.display_name if intent else 'None'}'")
                print(f"Confianza: {result.intent_detection_confidence:.2f}")
                
                # Intentar obtener fulfillment text de diferentes maneras
                fulfillment_text = ""
                if hasattr(result, 'fulfillment_text') and result.fulfillment_text:
                    fulfillment_text = result.fulfillment_text
                elif hasattr(result, 'response_messages') and result.response_messages:
                    for message in result.response_messages:
                        if hasattr(message, 'text') and message.text:
                            fulfillment_text += message.text.text[0] + " "
                
                print(f"Respuesta: {fulfillment_text}")
                
                if intent and intent.display_name == 'ReservarMesa':
                    print("¡EXITO! Intent detectado correctamente.")
                    print(f"Parametros: {dict(result.parameters)}")
                    return True
                    
            except Exception as e:
                print(f"Error con configuracion {i}: {e}")
        
        print("\nNinguna configuracion funciono correctamente.")
        return False
        
    except Exception as e:
        print(f"Error general: {e}")
        return False

if __name__ == "__main__":
    test_different_configs()
