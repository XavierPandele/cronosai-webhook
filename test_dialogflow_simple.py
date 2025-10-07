#!/usr/bin/env python3
"""
Version simple del cliente de Dialogflow para testing
"""

import os
from google.cloud import dialogflowcx as df
import json
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class SimpleDialogflowClient:
    def __init__(self, project_id, location, agent_id):
        """Inicializa el cliente simple de Dialogflow CX"""
        try:
            print("Inicializando DialogflowCX Client...")
            
            # Verificar credenciales
            credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
            if not credentials_path or not os.path.exists(credentials_path):
                raise Exception("Credenciales no encontradas")
            
            print(f"Credenciales encontradas: {credentials_path}")
            
            self.project_id = project_id
            self.location = location
            self.agent_id = agent_id
            
            print(f"Project ID: {self.project_id}")
            print(f"Location: {self.location}")
            print(f"Agent ID: {self.agent_id}")
            
            # Configurar cliente para region EU
            if self.location == 'eu':
                print("Configurando cliente para region EU...")
                self.client = df.SessionsClient(
                    client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
                )
            else:
                print("Configurando cliente para region global...")
                self.client = df.SessionsClient()
            
            # Construir session path
            self.session_path = self.client.session_path(
                self.project_id, self.location, self.agent_id, "default-session"
            )
            
            print("DialogflowCX Client inicializado correctamente")
            print(f"Session Path: {self.session_path}")
            
        except Exception as e:
            print(f"Error inicializando DialogflowCX Client: {e}")
            raise e
    
    def detect_intent_from_text(self, text, language_code="es-ES"):
        """Detecta la intencion a partir de texto"""
        try:
            print(f"Enviando texto: '{text}'")
            
            # Crear query input
            query_input = df.QueryInput(
                text=df.TextInput(text=text),
                language_code=language_code
            )
            
            request = df.DetectIntentRequest(
                session=self.session_path,
                query_input=query_input
            )
            
            response = self.client.detect_intent(request=request)
            result = response.query_result
            intent = result.intent
            parameters = result.parameters
            
            print(f"Intent: {intent}")
            print(f"Parameters: {parameters}")
            
            # Obtener fulfillment text
            fulfillment_text = ""
            
            if hasattr(result, 'fulfillment_text') and result.fulfillment_text:
                fulfillment_text = result.fulfillment_text
            elif hasattr(result, 'response_messages') and result.response_messages:
                for message in result.response_messages:
                    if hasattr(message, 'text') and message.text:
                        fulfillment_text += message.text.text[0] + " "
            
            if not fulfillment_text.strip():
                fulfillment_text = "En que puedo ayudarle?"
            
            return {
                "intent_name": intent.display_name if intent else "No entendido",
                "confidence": result.intent_detection_confidence,
                "fulfillment_text": fulfillment_text.strip(),
                "parameters": dict(parameters) if parameters else {},
                "language_code": result.language_code
            }
            
        except Exception as e:
            print(f"Error en la deteccion de intencion: {e}")
            return {
                "intent_name": "Error",
                "confidence": 0.0,
                "fulfillment_text": "Disculpe, hubo un error. Puede repetir?",
                "parameters": {},
                "language_code": language_code
            }

def test_intents():
    """Prueba diferentes frases"""
    
    print("PROBANDO DETECCION DE INTENTS")
    print("=" * 50)
    
    try:
        client = SimpleDialogflowClient(
            os.getenv('PROJECT_ID'),
            os.getenv('LOCATION'), 
            os.getenv('AGENT_ID')
        )
        
        test_phrases = [
            'Quiero reservar una mesa',
            'Reservar mesa',
            'Hacer reserva',
            'Necesito reservar',
            'Reservar para 4 personas'
        ]
        
        for phrase in test_phrases:
            print(f"\nProbando: '{phrase}'")
            response = client.detect_intent_from_text(phrase)
            print(f"Intent: '{response['intent_name']}'")
            print(f"Confianza: {response['confidence']:.2f}")
            print(f"Respuesta: {response['fulfillment_text']}")
            
            if response['intent_name'] == 'ReservarMesa':
                print("INTENT DETECTADO!")
                break
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_intents()
