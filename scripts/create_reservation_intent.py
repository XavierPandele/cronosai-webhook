#!/usr/bin/env python3
"""
Script para crear el intent ReservarMesa en Dialogflow CX
"""

import os
from google.cloud import dialogflowcx as df
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

def create_reservation_intent():
    """Crea el intent ReservarMesa"""
    
    print("CREANDO INTENT RESERVARMESA")
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
        
        # Crear el intent ReservarMesa
        intent = df.Intent(
            display_name="ReservarMesa",
            training_phrases=[
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Quiero reservar una mesa")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Reservar mesa")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Hacer reserva")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Necesito reservar")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Quiero hacer una reserva")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Reservar para 4 personas")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Mesa para dos personas")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Reservar una mesa para manana")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Puedo reservar?")]
                ),
                df.Intent.TrainingPhrase(
                    parts=[df.Intent.TrainingPhrase.Part(text="Reserva de mesa")]
                )
            ],
            parameters=[
                df.Intent.Parameter(
                    name="NomReserva",
                    entity_type="sys.person",
                    is_list=False
                ),
                df.Intent.Parameter(
                    name="TelefonReserva", 
                    entity_type="sys.phone-number",
                    is_list=False
                ),
                df.Intent.Parameter(
                    name="FechaReserva",
                    entity_type="sys.date",
                    is_list=False
                ),
                df.Intent.Parameter(
                    name="HoraReserva",
                    entity_type="sys.time",
                    is_list=False
                ),
                df.Intent.Parameter(
                    name="NumeroReserva",
                    entity_type="sys.number",
                    is_list=False
                )
            ]
        )
        
        # Crear el intent
        request = df.CreateIntentRequest(
            parent=agent_path,
            intent=intent
        )
        
        response = client.create_intent(request=request)
        print(f"Intent creado exitosamente: {response.name}")
        print(f"Display name: {response.display_name}")
        
        return True
        
    except Exception as e:
        print(f"Error creando intent: {e}")
        
        # Si ya existe, intentar obtenerlo
        if "already exists" in str(e) or "409" in str(e):
            print("El intent ya existe, continuando...")
            return True
        
        return False

if __name__ == "__main__":
    success = create_reservation_intent()
    if success:
        print("\nIntent ReservarMesa creado/verificado exitosamente!")
        print("Ahora puedes probar el simulador nuevamente.")
    else:
        print("\nError creando el intent. Verifica permisos en Google Cloud Console.")
