# src/main.py
import os
from speech_handler import SpeechToTextHandler
from dialogflow_client import DialogflowCXClient
from database_handler import DatabaseHandler
import json
import requests
from datetime import datetime

class VoiceReservationSystem:
    def __init__(self, project_id, location, agent_id, webhook_url=None):
        """
        Sistema completo de reservas por voz
        
        Args:
            project_id (str): ID del proyecto de Google Cloud
            location (str): Ubicación del agente
            agent_id (str): ID del agente de Dialogflow CX
            webhook_url (str): URL del webhook para procesar reservas
        """
        self.speech_handler = SpeechToTextHandler()
        self.dialogflow_client = DialogflowCXClient(project_id, location, agent_id)
        self.database_handler = DatabaseHandler()
        self.webhook_url = webhook_url or os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        
    def process_voice_input(self, audio_file_path, language="es-ES"):
        """
        Procesa una entrada de voz completa
        
        Args:
            audio_file_path (str): Ruta al archivo de audio
            language (str): Idioma del usuario
            
        Returns:
            dict: Respuesta completa del sistema
        """
        print("🎙️ Procesando entrada de voz...")
        
        # Paso 1: Transcribir audio a texto
        transcript = self.speech_handler.transcribe_audio(audio_file_path)
        
        if not transcript:
            return {
                "success": False,
                "error": "No se pudo transcribir el audio",
                "transcript": "",
                "intent": None,
                "response": "Disculpe, no pude entender. ¿Puede repetir?"
            }
        
        print(f"📝 Transcripción: {transcript}")
        
        # Paso 2: Enviar a Dialogflow CX
        print("🤖 Consultando con el agente...")
        dialogflow_response = self.dialogflow_client.detect_intent_from_text(
            transcript, language
        )
        
        print(f"🎯 Intención detectada: {dialogflow_response['intent_name']}")
        print(f"📊 Confianza: {dialogflow_response['confidence']:.2f}")
        
        # Paso 3: Procesar reserva si es necesario y obtener respuesta
        response_text = dialogflow_response['fulfillment_text']
        
        if dialogflow_response['intent_name'] == 'ReservarMesa' and dialogflow_response.get('parameters'):
            webhook_success = self._call_webhook_for_reservation(dialogflow_response['parameters'])
            if webhook_success and hasattr(self, 'last_webhook_response'):
                # Usar la respuesta del webhook si está disponible
                response_text = self.last_webhook_response
                print(f"💬 Usando respuesta del webhook: {response_text}")
            elif not webhook_success:
                print("⚠️ Webhook falló, procesando reserva localmente...")
                self._process_reservation(dialogflow_response['parameters'])
        
        print(f"💬 Respuesta final: {response_text}")
        
        # Paso 4: Sintetizar respuesta
        print("🔊 Generando respuesta de voz...")
        response_audio = self.speech_handler.synthesize_speech(response_text, language)
        
        # Paso 6: Guardar respuesta de audio
        output_path = f"response_{language}.mp3"
        if response_audio:
            self.speech_handler.save_audio(response_audio, output_path)
        
        return {
            "success": True,
            "transcript": transcript,
            "intent": dialogflow_response,
            "response_text": response_text,
            "response_audio_path": output_path if response_audio else None
        }
    
    def _call_webhook_for_reservation(self, parameters):
        """
        Llama al webhook para procesar la reserva
        
        Args:
            parameters (dict): Parámetros de la reserva extraídos de Dialogflow
            
        Returns:
            bool: True si el webhook procesó la reserva exitosamente, False si hubo error
        """
        try:
            print("🌐 Llamando al webhook para procesar reserva...")
            print(f"🔗 Webhook URL: {self.webhook_url}")
            
            # Preparar datos para el webhook en el formato esperado
            webhook_data = {
                "sessionInfo": {
                    "session": "default-session",
                    "parameters": self._format_parameters_for_webhook(parameters)
                },
                "languageCode": "es-ES"
            }
            
            print(f"📤 Enviando datos al webhook: {json.dumps(webhook_data, indent=2)}")
            
            # Llamar al webhook
            response = requests.post(
                self.webhook_url,
                json=webhook_data,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            print(f"📥 Respuesta del webhook - Status: {response.status_code}")
            
            if response.status_code == 200:
                webhook_response = response.json()
                print(f"✅ Webhook procesó la reserva exitosamente")
                print(f"📋 Respuesta del webhook: {json.dumps(webhook_response, indent=2)}")
                
                # Actualizar el texto de respuesta con la confirmación del webhook
                if 'fulfillment_response' in webhook_response:
                    messages = webhook_response['fulfillment_response'].get('messages', [])
                    if messages and 'text' in messages[0]:
                        self.last_webhook_response = messages[0]['text']['text']
                        print(f"💬 Nueva respuesta del webhook: {self.last_webhook_response}")
                
                return True
            else:
                print(f"❌ Error en webhook - Status: {response.status_code}")
                print(f"📋 Respuesta: {response.text}")
                return False
                
        except requests.exceptions.RequestException as e:
            print(f"❌ Error de conexión con el webhook: {e}")
            return False
        except Exception as e:
            print(f"❌ Error inesperado llamando al webhook: {e}")
            return False
    
    def _format_parameters_for_webhook(self, parameters):
        """
        Formatea los parámetros para que coincidan con lo que espera el webhook
        
        Args:
            parameters (dict): Parámetros originales de Dialogflow
            
        Returns:
            dict: Parámetros formateados para el webhook
        """
        # Mapear los nombres de parámetros para que coincidan con el webhook
        formatted_params = {}
        
        # Mapeo de parámetros (Dialogflow -> Webhook)
        param_mapping = {
            'NomReserva': 'nomreserva',
            'TelefonReserva': 'telefonreserva', 
            'FechaReserva': 'fechareserva',
            'HoraReserva': 'horareserva',
            'NumeroReserva': 'numeroreserva',
            'Observacions': 'observacions'
        }
        
        for dialogflow_param, webhook_param in param_mapping.items():
            if dialogflow_param in parameters:
                formatted_params[webhook_param] = parameters[dialogflow_param]
        
        print(f"🔄 Parámetros formateados: {json.dumps(formatted_params, indent=2)}")
        return formatted_params

    def _process_reservation(self, parameters):
        """
        Procesa una reserva y la guarda en la base de datos
        
        Args:
            parameters (dict): Parámetros de la reserva
        """
        try:
            # Conectar a la base de datos
            if not self.database_handler.connect():
                print("❌ Error conectando a la base de datos")
                return False
            
            # Extraer parámetros según tu estructura
            nom_reserva = parameters.get('NomReserva', '')
            telefon_reserva = parameters.get('TelefonReserva', '')
            fecha_reserva = parameters.get('FechaReserva', '')
            hora_reserva = parameters.get('HoraReserva', '')
            numero_reserva = parameters.get('NumeroReserva', 1)
            
            # Combinar fecha y hora
            data_combinada = f"{fecha_reserva} {hora_reserva}:00"
            
            # Crear conversación completa
            conversacion = f"""
            Reserva procesada por Speech to Text:
            - Nombre: {nom_reserva}
            - Teléfono: {telefon_reserva}
            - Fecha: {fecha_reserva}
            - Hora: {hora_reserva}
            - Personas: {numero_reserva}
            - Timestamp: {datetime.now().isoformat()}
            """
            
            # Insertar cliente
            if self.database_handler.insert_client(nom_reserva, telefon_reserva):
                print("✅ Cliente insertado/actualizado")
            
            # Insertar reserva
            reserva_id = self.database_handler.insert_reserva(
                data=data_combinada,
                numero_personas=numero_reserva,
                telefon=telefon_reserva,
                nom_persona_reserva=nom_reserva,
                observacions="Reserva por voz - Speech to Text",
                tota_la_conversa=conversacion
            )
            
            if reserva_id:
                print(f"✅ Reserva guardada con ID: {reserva_id}")
                return True
            else:
                print("❌ Error guardando reserva")
                return False
                
        except Exception as e:
            print(f"❌ Error procesando reserva: {e}")
            return False
        finally:
            self.database_handler.disconnect()
    
    def process_text_input(self, text, language="es-ES"):
        """
        Procesa una entrada de texto (para testing)
        
        Args:
            text (str): Texto del usuario
            language (str): Idioma del usuario
            
        Returns:
            dict: Respuesta completa del sistema
        """
        print(f"📝 Procesando texto: {text}")
        
        # Enviar a Dialogflow CX
        dialogflow_response = self.dialogflow_client.detect_intent_from_text(
            text, language
        )
        
        print(f"🎯 Intención: {dialogflow_response['intent_name']}")
        print(f"📊 Confianza: {dialogflow_response['confidence']:.2f}")
        
        # Procesar reserva si es necesario
        response_text = dialogflow_response['fulfillment_text']
        
        if dialogflow_response['intent_name'] == 'ReservarMesa' and dialogflow_response.get('parameters'):
            webhook_success = self._call_webhook_for_reservation(dialogflow_response['parameters'])
            if webhook_success and hasattr(self, 'last_webhook_response'):
                response_text = self.last_webhook_response
                print(f"💬 Usando respuesta del webhook: {response_text}")
            elif not webhook_success:
                print("⚠️ Webhook falló, procesando reserva localmente...")
                self._process_reservation(dialogflow_response['parameters'])
        
        # Generar respuesta de voz
        response_audio = self.speech_handler.synthesize_speech(response_text, language)
        
        # Guardar respuesta
        output_path = f"response_{language}.mp3"
        if response_audio:
            self.speech_handler.save_audio(response_audio, output_path)
        
        return {
            "success": True,
            "input_text": text,
            "intent": dialogflow_response,
            "response_text": response_text,
            "response_audio_path": output_path if response_audio else None
        }

def main():
    """Función principal para probar el sistema"""
    print("🚀 Iniciando Sistema de Reservas por Voz")
    print("=" * 50)
    
    # Configuración (reemplaza con tus valores)
    PROJECT_ID = "cronos-473012"
    LOCATION = "eu"
    AGENT_ID = "e44a94ba-5f5c-4eec-8f00-d03d9ca0c3b9"
    WEBHOOK_URL = "https://cronosai-webhook.vercel.app/api/webhook"  # Reemplaza con tu URL real
    
    # Crear el sistema
    system = VoiceReservationSystem(PROJECT_ID, LOCATION, AGENT_ID, WEBHOOK_URL)
    
    # Menú de opciones
    while True:
        print("\n📋 Opciones disponibles:")
        print("1. Probar con texto")
        print("2. Probar con archivo de audio")
        print("3. Salir")
        
        choice = input("\nSelecciona una opción (1-3): ").strip()
        
        if choice == "1":
            # Probar con texto
            text = input("Escribe tu mensaje: ")
            if text:
                result = system.process_text_input(text)
                print(f"\n✅ Resultado:")
                print(f"Respuesta: {result['response_text']}")
                if result['response_audio_path']:
                    print(f"Audio guardado en: {result['response_audio_path']}")
        
        elif choice == "2":
            # Probar con audio
            audio_path = input("Ruta al archivo de audio: ")
            if os.path.exists(audio_path):
                result = system.process_voice_input(audio_path)
                if result['success']:
                    print(f"\n✅ Resultado:")
                    print(f"Transcripción: {result['transcript']}")
                    print(f"Respuesta: {result['response_text']}")
                    if result['response_audio_path']:
                        print(f"Audio guardado en: {result['response_audio_path']}")
                else:
                    print(f"❌ Error: {result['error']}")
            else:
                print("❌ Archivo de audio no encontrado")
        
        elif choice == "3":
            print("👋 ¡Hasta luego!")
            break
        
        else:
            print("❌ Opción no válida")

if __name__ == "__main__":
    main()