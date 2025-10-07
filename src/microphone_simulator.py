# src/microphone_simulator.py
import pyaudio
import wave
import threading
import time
import os
import json
import requests
from speech_handler import SpeechToTextHandler
from dialogflow_client import DialogflowCXClient
from database_handler import DatabaseHandler
from smart_reservation_detector import SmartReservationDetector
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class MicrophoneSimulator:
    def __init__(self, webhook_url=None):
        """Simulador de llamada telefónica con micrófono"""
        self.speech_handler = SpeechToTextHandler()
        self.dialogflow_client = DialogflowCXClient(
            os.getenv('PROJECT_ID'),
            os.getenv('LOCATION'),
            os.getenv('AGENT_ID')
        )
        self.database_handler = DatabaseHandler()
        self.webhook_url = webhook_url or os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        self.smart_detector = SmartReservationDetector(self.webhook_url)
        
        # Configuración de audio
        self.CHUNK = 1024
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.RATE = 16000
        self.RECORD_SECONDS = 5
        
        self.audio = pyaudio.PyAudio()
        self.is_recording = False
        
    def start_call_simulation(self):
        """Inicia la simulación de llamada"""
        print("SIMULADOR DE LLAMADA TELEFONICA")
        print("=" * 50)
        print("Instrucciones:")
        print("1. Presiona ENTER para empezar a hablar")
        print("2. Habla tu mensaje (maximo 5 segundos)")
        print("3. Presiona ENTER para procesar")
        print("4. Escribe 'salir' para terminar")
        print("=" * 50)
        
        # Saludo inicial
        self.play_audio_response("¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?")
        
        while True:
            user_input = input("\n🎙️ Presiona ENTER para hablar (o 'salir' para terminar): ").strip()
            
            if user_input.lower() == 'salir':
                print("👋 ¡Hasta luego!")
                break
                
            if user_input == '':
                # Grabar audio
                print("🔴 Grabando... (5 segundos)")
                audio_data = self.record_audio()
                
                if audio_data:
                    # Procesar audio
                    print("🔄 Procesando...")
                    result = self.process_voice_input(audio_data)
                    
                    if result['success']:
                        print(f"📝 Transcripción: {result['transcript']}")
                        print(f"🤖 Respuesta: {result['response_text']}")
                        
                        # Reproducir respuesta
                        self.play_audio_response(result['response_text'])
                    else:
                        print(f"❌ Error: {result['error']}")
                        self.play_audio_response("Disculpe, no pude entender. ¿Puede repetir?")
    
    def record_audio(self):
        """Graba audio desde el micrófono"""
        try:
            stream = self.audio.open(
                format=self.FORMAT,
                channels=self.CHANNELS,
                rate=self.RATE,
                input=True,
                frames_per_buffer=self.CHUNK
            )
            
            print("🔴 Grabando...")
            frames = []
            
            for i in range(0, int(self.RATE / self.CHUNK * self.RECORD_SECONDS)):
                data = stream.read(self.CHUNK)
                frames.append(data)
            
            print("⏹️ Grabación completada")
            
            stream.stop_stream()
            stream.close()
            
            # Convertir a bytes
            audio_data = b''.join(frames)
            return audio_data
            
        except Exception as e:
            print(f"❌ Error grabando audio: {e}")
            return None
    
    def process_voice_input(self, audio_data):
        """Procesa el audio grabado"""
        try:
            # Guardar audio temporalmente
            temp_file = "temp_audio.wav"
            with wave.open(temp_file, 'wb') as wf:
                wf.setnchannels(self.CHANNELS)
                wf.setsampwidth(self.audio.get_sample_size(self.FORMAT))
                wf.setframerate(self.RATE)
                wf.writeframes(audio_data)
            
            # Transcribir
            transcript = self.speech_handler.transcribe_audio(temp_file)
            
            if not transcript:
                return {
                    "success": False,
                    "error": "No se pudo transcribir el audio"
                }
            
            # Enviar a Dialogflow CX
            dialogflow_response = self.dialogflow_client.detect_intent_from_text(transcript)
            
            # Procesar reserva si es necesario
            response_text = dialogflow_response['fulfillment_text']
            
            # Procesar según el intent detectado
            intent_name = dialogflow_response['intent_name']
            confidence = dialogflow_response['confidence']
            
            print(f"Procesando intent: {intent_name} (confianza: {confidence:.2f})")
            
            # Si Dialogflow detecta ReservarMesa con alta confianza
            if intent_name == 'ReservarMesa' and confidence > 0.5 and dialogflow_response.get('parameters'):
                print("Dialogflow detecto ReservarMesa con parametros")
                webhook_success = self._call_webhook_for_reservation(dialogflow_response['parameters'])
                if webhook_success and hasattr(self, 'last_webhook_response'):
                    response_text = self.last_webhook_response
                    print(f"Webhook exitoso: {response_text}")
                else:
                    print("Webhook falló, usando fallback...")
                    response_text = "Reserva procesada localmente"
            
            # Si Dialogflow no detecta o tiene baja confianza, usar detector inteligente
            elif intent_name in ['None', 'No entendido', 'Error'] or confidence < 0.5:
                print("Dialogflow no detecto o baja confianza, probando detector inteligente...")
                if self.smart_detector.is_reservation_request(transcript):
                    print("Detector inteligente detecto solicitud de reserva")
                    response_text = self.smart_detector.process_reservation(transcript)
                else:
                    response_text = "Disculpe, no pude entender. ¿Puede ser más específico sobre su reserva?"
            
            # Para otros intents, usar la respuesta de Dialogflow
            else:
                print(f"Usando respuesta de Dialogflow para intent: {intent_name}")
                response_text = dialogflow_response['fulfillment_text']
            
            # Limpiar archivo temporal
            if os.path.exists(temp_file):
                os.remove(temp_file)
            
            return {
                "success": True,
                "transcript": transcript,
                "response_text": response_text
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
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
                    "session": "simulator-session",
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

    def process_reservation(self, parameters):
        """Procesa una reserva"""
        try:
            if self.database_handler.connect():
                # Insertar cliente
                self.database_handler.insert_client(
                    parameters.get('NomReserva', ''),
                    parameters.get('TelefonReserva', '')
                )
                
                # Insertar reserva
                self.database_handler.insert_reserva(
                    data_reserva=f"{parameters.get('FechaReserva', '')} {parameters.get('HoraReserva', '')}",
                    num_persones=parameters.get('NumeroReserva', 1),
                    telefon=parameters.get('TelefonReserva', ''),
                    nom_persona_reserva=parameters.get('NomReserva', ''),
                    observacions="Reserva por simulación de llamada",
                    conversa_completa=f"Simulación: {parameters}"
                )
                
                self.database_handler.disconnect()
                print("✅ Reserva guardada en la base de datos")
                return True
        except Exception as e:
            print(f"❌ Error procesando reserva: {e}")
            return False
    
    def play_audio_response(self, text):
        """Reproduce la respuesta del agente"""
        try:
            # Sintetizar voz
            audio_content = self.speech_handler.synthesize_speech(text)
            
            if audio_content:
                # Guardar audio temporal
                temp_file = "temp_response.mp3"
                with open(temp_file, 'wb') as f:
                    f.write(audio_content)
                
                # Reproducir (requiere pygame o similar)
                self.play_audio_file(temp_file)
                
                # Limpiar
                if os.path.exists(temp_file):
                    os.remove(temp_file)
            else:
                print(f"🔊 Respuesta: {text}")
                
        except Exception as e:
            print(f"❌ Error reproduciendo audio: {e}")
            print(f"🔊 Respuesta: {text}")
    
    def play_audio_file(self, file_path):
        """Reproduce un archivo de audio"""
        try:
            import pygame
            pygame.mixer.init()
            pygame.mixer.music.load(file_path)
            pygame.mixer.music.play()
            
            # Esperar a que termine
            while pygame.mixer.music.get_busy():
                time.sleep(0.1)
                
            # Limpiar el mixer
            pygame.mixer.quit()
            
        except ImportError:
            print("⚠️ Instala pygame para reproducir audio: pip install pygame")
        except Exception as e:
            print(f"❌ Error reproduciendo audio: {e}")
            # Fallback: mostrar el texto
            print(f"🔊 Respuesta: {text}")

def main():
    """Función principal"""
    print("Iniciando Simulador de Llamada Telefonica")
    print("=" * 50)
    
    # Configuración del webhook
    WEBHOOK_URL = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
    print(f"Webhook URL: {WEBHOOK_URL}")
    print()
    
    # Verificar dependencias
    try:
        import pyaudio
        import wave
    except ImportError:
        print("Error: Instala las dependencias necesarias:")
        print("pip install pyaudio wave pygame")
        return
    
    # Crear y ejecutar simulador
    simulator = MicrophoneSimulator(WEBHOOK_URL)
    simulator.start_call_simulation()

if __name__ == "__main__":
    main()