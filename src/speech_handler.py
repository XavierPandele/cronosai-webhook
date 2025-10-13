# src/speech_handler.py
import os
from google.cloud import speech
from google.cloud import texttospeech
import json
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class SpeechToTextHandler:
    def __init__(self):
        """Inicializa el cliente de Speech to Text"""
        try:
            # Verificar que las credenciales estén configuradas
            credentials_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
            if not credentials_path or not os.path.exists(credentials_path):
                raise Exception("Credenciales de Google Cloud no encontradas. Verifica el archivo .env y credentials/service-account.json")
            
            self.speech_client = speech.SpeechClient()
            self.tts_client = texttospeech.TextToSpeechClient()
            # Voz por defecto
            self.voice_name = "es-ES-Neural2-A"
            print("Clientes de Google Cloud inicializados correctamente")
            
        except Exception as e:
            print(f"Error inicializando clientes de Google Cloud: {e}")
            print("Verifica que tengas:")
            print("   1. Archivo credentials/service-account.json")
            print("   2. Variable GOOGLE_APPLICATION_CREDENTIALS en .env")
            print("   3. APIs habilitadas en Google Cloud Console")
            raise e
    
    def transcribe_audio(self, audio_file_path):
        """Convierte un archivo de audio a texto"""
        try:
            with open(audio_file_path, 'rb') as audio_file:
                audio_content = audio_file.read()
            
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,
                language_code="es-ES",
                alternative_language_codes=["de-DE", "en-US"],
                model="phone_call",
                use_enhanced=True,
                enable_automatic_punctuation=True,
                speech_contexts=[
                    speech.SpeechContext(
                        phrases=[
                            "reservar mesa", "hacer reserva", "disponibilidad",
                            "cancelar reserva", "número de personas", "fecha", "hora",
                            "nombre", "teléfono", "confirmar", "gracias", "adiós"
                        ],
                        boost=25.0
                    )
                ]
            )
            
            audio = speech.RecognitionAudio(content=audio_content)
            response = self.speech_client.recognize(config=config, audio=audio)
            
            if response.results:
                transcript = response.results[0].alternatives[0].transcript
                confidence = response.results[0].alternatives[0].confidence
                print(f"Transcripción: {transcript}")
                print(f"Confianza: {confidence:.2f}")
                return transcript
            else:
                print("No se pudo transcribir el audio")
                return ""
                
        except Exception as e:
            print(f"Error en la transcripción: {e}")
            return ""
    
    def synthesize_speech(self, text, language="es-ES", voice_name=None):
        """Convierte texto a audio"""
        try:
            # Usar la voz especificada o la voz por defecto de la instancia
            if voice_name:
                selected_voice = voice_name
            else:
                selected_voice = self.voice_name
            
            # Extraer el código de idioma de la voz (ej: "es-ES" de "es-ES-Neural2-A")
            lang_code = selected_voice.split('-')[0] + '-' + selected_voice.split('-')[1]
            
            # Determinar el género basado en la voz
            if selected_voice.endswith('A') or selected_voice.endswith('C'):
                gender = texttospeech.SsmlVoiceGender.FEMALE
            else:
                gender = texttospeech.SsmlVoiceGender.MALE
            
            # Configuración simplificada
            synthesis_input = texttospeech.SynthesisInput(text=text)
            voice_params = texttospeech.VoiceSelectionParams(
                language_code=lang_code,
                name=selected_voice,
                ssml_gender=gender
            )
            
            # Configuración de audio simplificada
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3
            )
            
            response = self.tts_client.synthesize_speech(
                input=synthesis_input,
                voice=voice_params,
                audio_config=audio_config
            )
            
            return response.audio_content
            
        except Exception as e:
            print(f"Error en la síntesis de voz: {e}")
            return b""
    
    def save_audio(self, audio_content, output_path):
        """Guarda el audio generado en un archivo"""
        try:
            with open(output_path, 'wb') as audio_file:
                audio_file.write(audio_content)
            print(f"Audio guardado en: {output_path}")
        except Exception as e:
            print(f"Error al guardar audio: {e}")

if __name__ == "__main__":
    try:
        handler = SpeechToTextHandler()
        test_text = "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?"
        audio = handler.synthesize_speech(test_text)
        if audio:
            handler.save_audio(audio, "test_output.mp3")
            print("✅ Prueba de síntesis de voz completada")
    except Exception as e:
        print(f"❌ Error: {e}")
        print("💡 Verifica tu configuración de credenciales")