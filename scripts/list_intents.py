#!/usr/bin/env python3
"""
Script para listar todos los intents disponibles en el agente
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

def list_intents():
    """Lista todos los intents del agente"""
    
    print("LISTANDO INTENTS DISPONIBLES")
    print("=" * 50)
    
    try:
        # Configurar cliente
        if os.getenv('LOCATION') == 'eu':
            client = df.IntentsClient(
                client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
            )
        else:
            client = df.IntentsClient()
        
        # Construir path del agente
        project_id = os.getenv('PROJECT_ID')
        location = os.getenv('LOCATION')
        agent_id = os.getenv('AGENT_ID')
        
        agent_path = f"projects/{project_id}/locations/{location}/agents/{agent_id}"
        
        print(f"Agent Path: {agent_path}")
        
        # Listar intents
        intents = client.list_intents(parent=agent_path)
        
        print("\nIntents encontrados:")
        for intent in intents:
            print(f"- {intent.display_name}")
            print(f"  ID: {intent.name}")
            if intent.training_phrases:
                print(f"  Frases de entrenamiento: {len(intent.training_phrases)}")
            print()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_intents()
