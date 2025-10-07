#!/usr/bin/env python3
"""
Script para listar flows y probar con cada uno
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

load_dotenv()

def test_flows():
    """Lista flows y prueba con cada uno"""
    
    print("LISTANDO FLOWS Y PROBANDO CON CADA UNO")
    print("=" * 50)
    
    try:
        # Configurar cliente para flows
        if os.getenv('LOCATION') == 'eu':
            client = df.FlowsClient(
                client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
            )
        else:
            client = df.FlowsClient()
        
        project_id = os.getenv('PROJECT_ID')
        location = os.getenv('LOCATION')
        agent_id = os.getenv('AGENT_ID')
        
        # Listar flows
        agent_path = f"projects/{project_id}/locations/{location}/agents/{agent_id}"
        print(f"Agent Path: {agent_path}")
        
        flows = client.list_flows(parent=agent_path)
        
        print("\nFlows encontrados:")
        flows_list = []
        for flow in flows:
            print(f"- {flow.display_name}")
            print(f"  ID: {flow.name}")
            flows_list.append(flow)
        
        if not flows_list:
            print("No se encontraron flows.")
            return
        
        # Probar con cada flow
        test_phrase = "me gustaria reservar una mesa"
        
        for flow in flows_list:
            print(f"\nProbando con flow: {flow.display_name}")
            print("-" * 40)
            
            try:
                # Crear session path con flow específico
                session_path = f"projects/{project_id}/locations/{location}/agents/{agent_id}/flows/{flow.name.split('/')[-1]}/sessions/default-session"
                
                # Configurar cliente de sesiones
                if os.getenv('LOCATION') == 'eu':
                    session_client = df.SessionsClient(
                        client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
                    )
                else:
                    session_client = df.SessionsClient()
                
                # Crear query input
                query_input = df.QueryInput(
                    text=df.TextInput(text=test_phrase),
                    language_code="es-ES"
                )
                
                request = df.DetectIntentRequest(
                    session=session_path,
                    query_input=query_input
                )
                
                response = session_client.detect_intent(request=request)
                result = response.query_result
                intent = result.intent
                
                print(f"Intent: '{intent.display_name if intent else 'None'}'")
                print(f"Confianza: {result.intent_detection_confidence:.2f}")
                
                if intent and intent.display_name == 'ReservarMesa':
                    print("¡EXITO! Intent detectado en este flow.")
                    print(f"Flow correcto: {flow.display_name}")
                    print(f"Session path correcto: {session_path}")
                    return session_path
                
            except Exception as e:
                print(f"Error probando flow {flow.display_name}: {e}")
        
        print("\nNingun flow detecto el intent ReservarMesa.")
        return None
        
    except Exception as e:
        print(f"Error general: {e}")
        return None

if __name__ == "__main__":
    correct_session_path = test_flows()
    if correct_session_path:
        print(f"\nSOLUCION: Usar este session path en tu aplicacion:")
        print(correct_session_path)
