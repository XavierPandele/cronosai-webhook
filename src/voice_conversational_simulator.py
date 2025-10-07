#!/usr/bin/env python3
"""
Simulador de llamada telefónica por voz - conversación paso a paso
"""

import pyaudio
import wave
import threading
import time
import os
import re
import requests
import json
from datetime import datetime, timedelta
from speech_handler import SpeechToTextHandler
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class VoiceConversationalSimulator:
    def __init__(self):
        """Simulador de llamada telefónica por voz"""
        self.webhook_url = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        self.speech_handler = SpeechToTextHandler()
        
        # Estados de la conversación
        self.conversation_state = {
            'step': 'greeting',  # greeting, ask_people, ask_date, ask_time, ask_name, ask_phone, confirm, complete
            'reservation_data': {}
        }
        
        # Configuración de audio
        self.CHUNK = 1024
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.RATE = 16000
        self.RECORD_SECONDS = 5
        
        self.audio = pyaudio.PyAudio()
        self.is_recording = False
        
    def start_call_simulation(self):
        """Inicia la simulación de llamada telefónica por voz"""
        print("SIMULADOR DE LLAMADA TELEFONICA POR VOZ")
        print("=" * 50)
        print("Instrucciones:")
        print("1. El sistema te hablará y te hará preguntas")
        print("2. Presiona ENTER cuando quieras responder")
        print("3. Habla tu respuesta (máximo 5 segundos)")
        print("4. Presiona ENTER para procesar tu respuesta")
        print("5. Escribe 'salir' para terminar la llamada")
        print("=" * 50)
        
        # Saludo inicial por voz
        self.say_and_speak("¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?")
        
        while True:
            # Mostrar el estado actual
            self.show_current_state()
            
            # Obtener respuesta del usuario
            user_input = input("\nPresiona ENTER para responder por voz (o 'salir' para terminar): ").strip()
            
            if user_input.lower() == 'salir':
                self.say_and_speak("¡Hasta luego! Que tenga un buen día.")
                break
            elif user_input == '':
                # Grabar respuesta por voz
                print("🔴 Grabando tu respuesta... (5 segundos)")
                audio_data = self.record_audio()
                
                if audio_data:
                    # Procesar respuesta por voz
                    print("🔄 Procesando tu respuesta...")
                    result = self.process_voice_response(audio_data)
                    
                    if result['success']:
                        transcript = result['transcript']
                        print(f"📝 Entendí: '{transcript}'")
                        
                        # Procesar la respuesta según el paso actual
                        response = self.process_user_response(transcript)
                        
                        # Hablar la respuesta del sistema
                        self.say_and_speak(response)
                        
                        # Si la conversación está completa, procesar la reserva
                        if self.conversation_state['step'] == 'complete':
                            self.process_reservation()
                            self.restart_conversation()
                    else:
                        print(f"❌ Error: {result['error']}")
                        self.say_and_speak("Disculpe, no pude entender. ¿Puede repetir?")
    
    def show_current_state(self):
        """Muestra el estado actual de la conversación"""
        step = self.conversation_state['step']
        data = self.conversation_state['reservation_data']
        
        print(f"\n--- Estado: {step.upper()} ---")
        if data:
            print("Datos recopilados:")
            for key, value in data.items():
                print(f"  {key}: {value}")
    
    def say_and_speak(self, message):
        """Muestra y reproduce por voz un mensaje"""
        print(f"\n🤖 Sistema: {message}")
        self.play_audio_response(message)
    
    def restart_conversation(self):
        """Reinicia la conversación"""
        self.conversation_state = {
            'step': 'greeting',
            'reservation_data': {}
        }
        self.say_and_speak("¡Perfecto! Empecemos de nuevo. ¿En qué puedo ayudarle?")
    
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
    
    def process_voice_response(self, audio_data):
        """Procesa la respuesta de voz del usuario"""
        try:
            # Guardar audio temporalmente
            temp_file = "temp_voice_response.wav"
            with wave.open(temp_file, 'wb') as wf:
                wf.setnchannels(self.CHANNELS)
                wf.setsampwidth(self.audio.get_sample_size(self.FORMAT))
                wf.setframerate(self.RATE)
                wf.writeframes(audio_data)
            
            # Transcribir
            transcript = self.speech_handler.transcribe_audio(temp_file)
            
            # Limpiar archivo temporal
            if os.path.exists(temp_file):
                os.remove(temp_file)
            
            if not transcript:
                return {
                    "success": False,
                    "error": "No se pudo transcribir el audio"
                }
            
            return {
                "success": True,
                "transcript": transcript
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def process_user_response(self, user_input):
        """Procesa la respuesta del usuario según el paso actual"""
        step = self.conversation_state['step']
        text = user_input.lower()
        
        # Detectar si es una solicitud de reserva
        if step == 'greeting' and self.is_reservation_request(text):
            self.conversation_state['step'] = 'ask_people'
            return "¡Perfecto! Me alegra ayudarle con su reserva. ¿Para cuántas personas sería la mesa?"
        
        elif step == 'ask_people':
            people = self.extract_people_count(text)
            if people:
                self.conversation_state['reservation_data']['NumeroReserva'] = people
                self.conversation_state['step'] = 'ask_date'
                return f"Excelente, mesa para {people} personas. ¿Para qué fecha le gustaría la reserva? Puede decir mañana, pasado mañana o una fecha específica."
            else:
                return "Disculpe, no entendí cuántas personas. ¿Podría decirme el número de personas? Por ejemplo: para dos personas o somos cuatro."
        
        elif step == 'ask_date':
            date = self.extract_date(text)
            if date:
                self.conversation_state['reservation_data']['FechaReserva'] = date
                self.conversation_state['step'] = 'ask_time'
                return f"Perfecto, reserva para el {date}. ¿A qué hora le gustaría venir? Por ejemplo: a las ocho o a las siete y media."
            else:
                return "Disculpe, no entendí la fecha. ¿Podría especificar la fecha? Por ejemplo: mañana, pasado mañana o el quince de enero."
        
        elif step == 'ask_time':
            time = self.extract_time(text)
            if time:
                self.conversation_state['reservation_data']['HoraReserva'] = time
                self.conversation_state['step'] = 'ask_name'
                return f"Excelente, a las {time}. ¿Cuál es su nombre para la reserva?"
            else:
                return "Disculpe, no entendí la hora. ¿Podría especificar la hora? Por ejemplo: a las ocho, a las siete y media o ocho de la noche."
        
        elif step == 'ask_name':
            name = self.extract_name(text)
            if name:
                self.conversation_state['reservation_data']['NomReserva'] = name
                self.conversation_state['step'] = 'ask_phone'
                return f"Perfecto, {name}. ¿Cuál es su número de teléfono para confirmar la reserva?"
            else:
                return "Disculpe, no entendí su nombre. ¿Podría decirme su nombre completo?"
        
        elif step == 'ask_phone':
            phone = self.extract_phone(text)
            if phone:
                self.conversation_state['reservation_data']['TelefonReserva'] = phone
                self.conversation_state['step'] = 'confirm'
                return self.get_confirmation_message()
            else:
                return "Disculpe, no entendí su teléfono. ¿Podría darme un número de teléfono válido?"
        
        elif step == 'confirm':
            if 'si' in text or 'sí' in text or 'confirmo' in text or 'correcto' in text:
                self.conversation_state['step'] = 'complete'
                return "¡Perfecto! Procesando su reserva..."
            elif 'no' in text or 'cambiar' in text or 'modificar' in text:
                return "¿Qué le gustaría cambiar? Puede decir cambiar personas, cambiar fecha, cambiar hora, cambiar nombre o cambiar teléfono."
            else:
                return "¿Confirma los datos de la reserva? Responda sí para confirmar o no para modificar algo."
        
        else:
            # Paso no reconocido
            if self.is_reservation_request(text):
                self.conversation_state['step'] = 'ask_people'
                return "¡Perfecto! ¿Para cuántas personas sería la mesa?"
            else:
                return "Disculpe, no entendí. ¿Le gustaría hacer una reserva? Puede decir sí o describir lo que necesita."
    
    def is_reservation_request(self, text):
        """Detecta si es una solicitud de reserva"""
        reservation_words = ['reservar', 'mesa', 'reserva', 'quiero', 'necesito', 'gustaría', 'gustaria']
        return any(word in text for word in reservation_words)
    
    def extract_people_count(self, text):
        """Extrae el número de personas del texto"""
        # Mapeo de números en palabras a números
        word_to_number = {
            'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
            'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10
        }
        
        # Buscar números en palabras
        for word, number in word_to_number.items():
            if word in text:
                return number
        
        # Buscar números
        patterns = [
            r'(\d+)\s+personas?',
            r'para\s+(\d+)',
            r'somos\s+(\d+)',
            r'(\d+)\s+comensales?'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                count = int(match.group(1))
                if 1 <= count <= 20:
                    return count
        
        return None
    
    def extract_date(self, text):
        """Extrae la fecha del texto"""
        today = datetime.now()
        
        if 'mañana' in text:
            date = today + timedelta(days=1)
        elif 'pasado mañana' in text or 'pasado' in text:
            date = today + timedelta(days=2)
        elif 'hoy' in text:
            date = today
        else:
            # Intentar extraer fecha específica
            date_match = re.search(r'(\d{1,2})[\/\-](\d{1,2})', text)
            if date_match:
                day, month = int(date_match.group(1)), int(date_match.group(2))
                year = today.year
                try:
                    date = datetime(year, month, day)
                    if date < today:
                        date = datetime(year + 1, month, day)
                except ValueError:
                    return None
            else:
                return None
        
        return date.strftime("%Y-%m-%d")
    
    def extract_time(self, text):
        """Extrae la hora del texto"""
        # Mapeo de números en palabras
        word_to_number = {
            'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
            'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
            'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
            'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
            'veintiuno': 21, 'veintidós': 22, 'veintitrés': 23
        }
        
        # Buscar números en palabras primero
        for word, number in word_to_number.items():
            if word in text:
                hours = number
                minutes = 0
                
                # Buscar minutos
                if 'y media' in text or 'y treinta' in text:
                    minutes = 30
                elif 'y cuarto' in text or 'y quince' in text:
                    minutes = 15
                
                # Ajustar para formato 24h
                if 'noche' in text and hours < 12:
                    hours += 12
                elif 'tarde' in text and hours < 12:
                    hours += 12
                
                if 0 <= hours <= 23 and 0 <= minutes <= 59:
                    return f"{hours:02d}:{minutes:02d}"
        
        # Buscar patrones numéricos
        patterns = [
            r'a\s+las?\s+(\d{1,2}):?(\d{0,2})',
            r'(\d{1,2}):(\d{0,2})',
            r'a\s+(\d{1,2})\s+horas?',
            r'(\d{1,2})\s+horas?'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                hours = int(match.group(1))
                minutes = int(match.group(2)) if len(match.groups()) > 1 and match.group(2) else 0
                
                # Ajustar para formato 24h
                if 'noche' in text and hours < 12:
                    hours += 12
                elif 'tarde' in text and hours < 12:
                    hours += 12
                
                if 0 <= hours <= 23 and 0 <= minutes <= 59:
                    return f"{hours:02d}:{minutes:02d}"
        
        return None
    
    def extract_name(self, text):
        """Extrae el nombre del texto"""
        # Limpiar y capitalizar
        name = text.strip().title()
        if len(name) > 1:
            return name
        return None
    
    def extract_phone(self, text):
        """Extrae el teléfono del texto"""
        # Buscar números de teléfono
        phone_match = re.search(r'[\+]?[\d\s\-\(\)]{7,15}', text)
        if phone_match:
            phone = re.sub(r'[^\d\+]', '', phone_match.group(0))
            if len(phone) >= 7:
                return phone
        
        return None
    
    def get_confirmation_message(self):
        """Genera el mensaje de confirmación"""
        data = self.conversation_state['reservation_data']
        
        message = "Perfecto, déjeme confirmar los datos de su reserva. Mesa para "
        message += f"{data['NumeroReserva']} personas, fecha {data['FechaReserva']}, "
        message += f"hora {data['HoraReserva']}, nombre {data['NomReserva']}, "
        message += f"teléfono {data['TelefonReserva']}. "
        message += "¿Está todo correcto? Responda sí para confirmar o no para modificar algo."
        
        return message
    
    def process_reservation(self):
        """Procesa la reserva final"""
        try:
            data = self.conversation_state['reservation_data']
            
            # Preparar datos para el webhook
            webhook_data = {
                "sessionInfo": {
                    "session": "voice-conversational-session",
                    "parameters": {
                        "nomreserva": data['NomReserva'],
                        "telefonreserva": data['TelefonReserva'],
                        "fechareserva": {
                            "year": int(data['FechaReserva'].split('-')[0]),
                            "month": int(data['FechaReserva'].split('-')[1]),
                            "day": int(data['FechaReserva'].split('-')[2])
                        },
                        "horareserva": {
                            "hours": int(data['HoraReserva'].split(':')[0]),
                            "minutes": int(data['HoraReserva'].split(':')[1]),
                            "seconds": 0
                        },
                        "numeroreserva": data['NumeroReserva'],
                        "observacions": f"Reserva creada por simulador de voz conversacional"
                    }
                },
                "languageCode": "es-ES"
            }
            
            print(f"\n🌐 Enviando reserva al webhook...")
            
            response = requests.post(
                self.webhook_url,
                json=webhook_data,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            if response.status_code == 200:
                webhook_response = response.json()
                print(f"✅ ¡Reserva procesada exitosamente!")
                
                # Extraer respuesta del webhook y hablar
                if 'fulfillment_response' in webhook_response:
                    messages = webhook_response['fulfillment_response'].get('messages', [])
                    if messages and 'text' in messages[0]:
                        confirmation_text = messages[0]['text']['text']
                        self.say_and_speak(confirmation_text)
                    else:
                        self.say_and_speak("¡Reserva confirmada! Recibirá una confirmación por teléfono.")
                else:
                    self.say_and_speak("¡Reserva confirmada! Recibirá una confirmación por teléfono.")
            else:
                print(f"❌ Error procesando reserva: {response.status_code}")
                self.say_and_speak("Hubo un problema procesando su reserva. Por favor, intente de nuevo.")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            self.say_and_speak("Hubo un error procesando su reserva. Por favor, intente de nuevo.")
    
    def play_audio_response(self, text):
        """Reproduce la respuesta del agente por voz"""
        try:
            # Sintetizar voz
            audio_content = self.speech_handler.synthesize_speech(text)
            
            if audio_content:
                # Guardar audio temporal
                temp_file = "temp_voice_response.mp3"
                with open(temp_file, 'wb') as f:
                    f.write(audio_content)
                
                # Reproducir
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

def main():
    """Función principal"""
    print("Iniciando Simulador de Llamada Telefonica por Voz")
    print("=" * 50)
    
    # Verificar dependencias
    try:
        import pyaudio
        import wave
    except ImportError:
        print("Error: Instala las dependencias necesarias:")
        print("pip install pyaudio wave pygame")
        return
    
    # Crear y ejecutar simulador
    simulator = VoiceConversationalSimulator()
    simulator.start_call_simulation()

if __name__ == "__main__":
    main()
