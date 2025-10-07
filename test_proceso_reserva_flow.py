#!/usr/bin/env python3
"""
Script para probar con el flow ProcesoReserva específico
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_proceso_reserva_flow():
    """Prueba con el flow ProcesoReserva"""
    
    print("PROBANDO CON FLOW PROCESORESERVA")
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
        
        # IMPORTANTE: Usar el flow ProcesoReserva específico con environment
        # Basado en la imagen que mostraste
        session_path = f"projects/{project_id}/locations/{location}/agents/{agent_id}/environments/draft/flows/ProcesoReserva/sessions/default-session"
        
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
            print("\n¡EXITO! Intent detectado correctamente con flow ProcesoReserva.")
            print(f"Parametros: {dict(result.parameters)}")
            return session_path
        else:
            print(f"\nPROBLEMA: Se detecto '{intent.display_name if intent else 'None'}' en lugar de 'ReservarMesa'")
            
            # Probar también con environment draft
            print("\nProbando con environment draft...")
            session_path_draft = f"projects/{project_id}/locations/{location}/agents/{agent_id}/environments/draft/flows/ProcesoReserva/sessions/default-session"
            
            try:
                request_draft = df.DetectIntentRequest(
                    session=session_path_draft,
                    query_input=query_input
                )
                
                response_draft = client.detect_intent(request=request_draft)
                result_draft = response_draft.query_result
                intent_draft = result_draft.intent
                
                print(f"Intent (draft): '{intent_draft.display_name if intent_draft else 'None'}'")
                print(f"Confianza (draft): {result_draft.intent_detection_confidence:.2f}")
                
                if intent_draft and intent_draft.display_name == 'ReservarMesa':
                    print("¡EXITO! Intent detectado con environment draft.")
                    return session_path_draft
                    
            except Exception as e:
                print(f"Error con draft: {e}")
            
            return None
        
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    correct_session_path = test_proceso_reserva_flow()
    if correct_session_path:
        print(f"\nSOLUCION ENCONTRADA!")
        print(f"Usar este session path en tu aplicacion:")
        print(correct_session_path)
    else:
        print("\nEl problema persiste. Verifica:")
        print("1. Que el flow se llame exactamente 'ProcesoReserva'")
        print("2. Que el intent 'ReservarMesa' este en ese flow")
        print("3. Que el agente este publicado correctamente")
