# src/speech_handler.py
import os
from google.cloud import speech
from google.cloud import texttospeech
import json

class SpeechToTextHandler:
    def __init__(self):
        """Inicializa el cliente de Speech to Text"""
        self.speech_client = speech.SpeechClient()
        self.tts_client = texttospeech.TextToSpeechClient()
    
    def transcribe_audio(self, audio_file_path):
        """
        Convierte un archivo de audio a texto
        
        Args:
            audio_file_path (str): Ruta al archivo de audio
            
        Returns:
            str: Texto transcrito
        """
        try:
            # Leer el archivo de audio
            with open(audio_file_path, 'rb') as audio_file:
                audio_content = audio_file.read()
            
            # Configuración optimizada para llamadas telefónicas
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
                sample_rate_hertz=16000,
                language_code="es-ES",
                alternative_language_codes=["de-DE", "en-US"],
                model="phone_call",
                use_enhanced=True,
                enable_automatic_punctuation=True,
                enable_word_time_offsets=True,
                enable_word_confidence=True,
                speech_contexts=[
                    speech.SpeechContext(
                        phrases=[
                            # Frases específicas para tu agente CronosAgent
                            "reservar mesa",
                            "hacer reserva", 
                            "disponibilidad",
                            "cancelar reserva",
                            "número de personas",
                            "fecha",
                            "hora",
                            "nombre",
                            "teléfono",
                            "confirmar",
                            "gracias",
                            "adiós",
                            # Frases en alemán (para tu mercado)
                            "Tisch reservieren",
                            "Reservierung machen",
                            "Verfügbarkeit",
                            "Stornieren",
                            "Anzahl Personen",
                            "Datum",
                            "Uhrzeit",
                            "Name",
                            "Telefon",
                            "Bestätigen",
                            "Danke",
                            "Auf Wiedersehen"
                        ],
                        boost=25.0
                    )
                ]
            )
            
            # Crear el objeto de audio
            audio = speech.RecognitionAudio(content=audio_content)
            
            # Realizar la transcripción
            response = self.speech_client.recognize(
                config=config, 
                audio=audio
            )
            
            # Extraer el texto transcrito
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
    
    def synthesize_speech(self, text, language="es-ES"):
        """
        Convierte texto a audio
        
        Args:
            text (str): Texto a convertir
            language (str): Código de idioma
            
        Returns:
            bytes: Audio generado
        """
        try:
            # Configuración de voces por idioma
            voice_config = {
                "es-ES": {
                    "name": "es-ES-Neural2-A",
                    "gender": texttospeech.SsmlVoiceGender.FEMALE
                },
                "de-DE": {
                    "name": "de-DE-Neural2-F", 
                    "gender": texttospeech.SsmlVoiceGender.FEMALE
                },
                "en-US": {
                    "name": "en-US-Neural2-J",
                    "gender": texttospeech.SsmlVoiceGender.FEMALE
                }
            }
            
            voice = voice_config.get(language, voice_config["es-ES"])
            
            # Configurar la entrada de síntesis
            synthesis_input = texttospeech.SynthesisInput(text=text)
            
            # Configurar los parámetros de voz
            voice_params = texttospeech.VoiceSelectionParams(
                language_code=language,
                name=voice["name"],
                ssml_gender=voice["gender"]
            )
            
            # Configurar el audio de salida
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                speaking_rate=1.0,
                pitch=0.0,
                volume_gain_db=0.0,
                effects_profile_id="telephony-class-application"
            )
            
            # Generar el audio
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
        """
        Guarda el audio generado en un archivo
        
        Args:
            audio_content (bytes): Contenido de audio
            output_path (str): Ruta donde guardar el archivo
        """
        try:
            with open(output_path, 'wb') as audio_file:
                audio_file.write(audio_content)
            print(f"Audio guardado en: {output_path}")
        except Exception as e:
            print(f"Error al guardar audio: {e}")

# Función de prueba
def test_speech_to_text():
    """Función para probar el Speech to Text"""
    handler = SpeechToTextHandler()
    
    # Probar síntesis de voz
    test_text = "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?"
    audio = handler.synthesize_speech(test_text)
    
    if audio:
        handler.save_audio(audio, "test_output.mp3")
        print("✅ Prueba de síntesis de voz completada")
    else:
        print("❌ Error en la síntesis de voz")

if __name__ == "__main__":
    test_speech_to_text()