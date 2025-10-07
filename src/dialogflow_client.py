# src/dialogflow_client.py
import os
from google.cloud import dialogflowcx as df
import json
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class DialogflowCXClient:
    def __init__(self, project_id=None, location=None, agent_id=None):
        """Inicializa el cliente de Dialogflow CX"""
        try:
            print("🔧 Inicializando DialogflowCX Client...")
            
            # Verificar que las credenciales estén configuradas
            credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
            if not credentials_path or not os.path.exists(credentials_path):
                raise Exception("Credenciales de Google Cloud no encontradas. Verifica el archivo .env y credentials/service-account.json")
            
            print(f"✅ Credenciales encontradas: {credentials_path}")
            
            # Usar valores por defecto desde variables de entorno si no se proporcionan
            self.project_id = project_id or os.getenv('PROJECT_ID')
            self.location = location or os.getenv('LOCATION', 'global')
            self.agent_id = agent_id or os.getenv('AGENT_ID')
            
            print(f"🔧 Project ID: {self.project_id}")
            print(f"🔧 Location: {self.location}")
            print(f"🔧 Agent ID: {self.agent_id}")
            
            if not all([self.project_id, self.location, self.agent_id]):
                raise Exception("Faltan variables de entorno: PROJECT_ID, LOCATION, AGENT_ID")
            
            # CORREGIDO: Especificar la región correcta
            if self.location == 'eu':
                print("🔧 Configurando cliente para región EU...")
                # Para región EU, usar el endpoint específico
                self.client = df.SessionsClient(
                    client_options={"api_endpoint": "eu-dialogflow.googleapis.com"}
                )
            else:
                print("🔧 Configurando cliente para región global...")
                self.client = df.SessionsClient()
            
            # CORREGIDO: Construir session path con environment draft
            # El Conversational Messenger usa draft por defecto
            self.session_path = f"projects/{self.project_id}/locations/{self.location}/agents/{self.agent_id}/environments/draft/sessions/default-session"
            
            # Configurar cliente con opciones optimizadas
            self.client_options = {
                "api_endpoint": "eu-dialogflow.googleapis.com" if self.location == 'eu' else None
            }
            
            print(f"✅ DialogflowCX Client inicializado correctamente")
            print(f"   Project ID: {self.project_id}")
            print(f"   Location: {self.location}")
            print(f"   Agent ID: {self.agent_id}")
            print(f"   Session Path: {self.session_path}")
            
        except Exception as e:
            print(f"❌ Error inicializando DialogflowCX Client: {e}")
            print("💡 Verifica que tengas:")
            print("   1. Archivo credentials/service-account.json")
            print("   2. Variables PROJECT_ID, LOCATION, AGENT_ID en .env")
            print("   3. APIs habilitadas en Google Cloud Console")
            raise e
    
    def detect_intent_from_text(self, text, language_code="es-ES"):
        """Detecta la intención a partir de texto"""
        try:
            print(f"Enviando texto: '{text}'")
            print(f"Idioma: {language_code}")
            
            # Crear query input con configuración optimizada
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
            
            print(f"Intent detectado: {intent.display_name if intent else 'None'}")
            print(f"Confianza: {result.intent_detection_confidence:.2f}")
            print(f"Parametros: {dict(parameters) if parameters else 'None'}")
            
            # Obtener fulfillment text
            fulfillment_text = ""
            
            if hasattr(result, 'fulfillment_text') and result.fulfillment_text:
                fulfillment_text = result.fulfillment_text
            elif hasattr(result, 'response_messages') and result.response_messages:
                for message in result.response_messages:
                    if hasattr(message, 'text') and message.text:
                        fulfillment_text += message.text.text[0] + " "
            
            # Mensaje por defecto si no hay respuesta
            if not fulfillment_text.strip():
                fulfillment_text = "¿En qué puedo ayudarle?"
            
            return {
                "intent_name": intent.display_name if intent else "No entendido",
                "confidence": result.intent_detection_confidence,
                "fulfillment_text": fulfillment_text.strip(),
                "parameters": dict(parameters) if parameters else {},
                "language_code": result.language_code
            }
            
        except Exception as e:
            print(f"❌ Error en la detección de intención: {e}")
            return {
                "intent_name": "Error",
                "confidence": 0.0,
                "fulfillment_text": "Disculpe, hubo un error. ¿Puede repetir?",
                "parameters": {},
                "language_code": language_code
            }

if __name__ == "__main__":
    print("🚀 Iniciando prueba del DialogflowCX Client...")
    
    try:
        print("🔧 Creando cliente...")
        # Usar variables de entorno automáticamente
        client = DialogflowCXClient()
        
        print("🔧 Probando con texto...")
        # Probar con texto
        test_text = "Quiero reservar una mesa para 4 personas"
        response = client.detect_intent_from_text(test_text)
        
        print("📋 Respuesta del agente:")
        print(f"Intención: {response['intent_name']}")
        print(f"Confianza: {response['confidence']:.2f}")
        print(f"Respuesta: {response['fulfillment_text']}")
        print(f"Parámetros: {response['parameters']}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 Verifica tu configuración de credenciales y variables de entorno")
        import traceback
        traceback.print_exc()