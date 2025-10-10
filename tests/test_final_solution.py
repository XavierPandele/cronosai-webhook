#!/usr/bin/env python3
"""
Script final para encontrar la solucion correcta
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_final_solution():
    """Prueba la solucion final"""
    
    print("SOLUCION FINAL - PROBANDO CONFIGURACION CORRECTA")
    print("=" * 60)
    
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
        
        # FORMATO CORRECTO: Sin especificar flow en session path
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
            print("\n¡EXITO! Intent detectado correctamente.")
            print(f"Parametros: {dict(result.parameters)}")
            return session_path
        else:
            print(f"\nPROBLEMA: Se detecto '{intent.display_name if intent else 'None'}' en lugar de 'ReservarMesa'")
            
            # Probar también con production environment
            print("\nProbando con environment production...")
            session_path_prod = f"projects/{project_id}/locations/{location}/agents/{agent_id}/environments/production/sessions/default-session"
            
            try:
                request_prod = df.DetectIntentRequest(
                    session=session_path_prod,
                    query_input=query_input
                )
                
                response_prod = client.detect_intent(request=request_prod)
                result_prod = response_prod.query_result
                intent_prod = result_prod.intent
                
                print(f"Intent (production): '{intent_prod.display_name if intent_prod else 'None'}'")
                print(f"Confianza (production): {result_prod.intent_detection_confidence:.2f}")
                
                if intent_prod and intent_prod.display_name == 'ReservarMesa':
                    print("¡EXITO! Intent detectado con environment production.")
                    return session_path_prod
                    
            except Exception as e:
                print(f"Error con production: {e}")
            
            return None
        
    except Exception as e:
        print(f"Error: {e}")
        return None

if __name__ == "__main__":
    correct_session_path = test_final_solution()
    if correct_session_path:
        print(f"\n¡SOLUCION ENCONTRADA!")
        print(f"Usar este session path en tu aplicacion:")
        print(correct_session_path)
        
        print(f"\nPara implementar la solucion:")
        print(f"1. Modifica src/dialogflow_client.py")
        print(f"2. Cambia el session_path a: {correct_session_path}")
        print(f"3. Prueba el simulador nuevamente")
    else:
        print("\nEl problema persiste. Posibles causas:")
        print("1. El agente no esta publicado correctamente")
        print("2. El intent ReservarMesa no esta en el flow correcto")
        print("3. Problema de permisos o configuracion")
        print("4. El agente esta en una region diferente")
