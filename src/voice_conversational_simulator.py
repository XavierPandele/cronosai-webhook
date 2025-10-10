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

# Lista de voces disponibles para probar (solo las que funcionan)
AVAILABLE_VOICES = {
    '1': 'es-ES-Neural2-A',      # Voz femenina actual
    '2': 'es-ES-Neural2-B',      # Voz masculina
    '3': 'es-ES-Neural2-C',      # Voz femenina alternativa
    '4': 'es-ES-Standard-A',     # Voz estándar femenina
    '5': 'es-ES-Standard-B',     # Voz estándar masculina
    '6': 'es-ES-Standard-C',     # Voz estándar femenina 2
    '7': 'es-ES-Standard-D',     # Voz estándar masculina 2
    '8': 'es-ES-Wavenet-B',      # Voz WaveNet masculina
    '9': 'es-ES-Wavenet-C',      # Voz WaveNet femenina
    '10': 'es-ES-Wavenet-D',     # Voz WaveNet masculina 2
}

class VoiceConversationalSimulator:
    def __init__(self):
        """Simulador de llamada telefónica por voz"""
        self.webhook_url = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        self.speech_handler = SpeechToTextHandler()
        
        # Estados de la conversación
        self.conversation_state = {
            'step': 'greeting',  # greeting, ask_intention, ask_people, ask_date, ask_time, ask_name, ask_phone, ask_phone_number, confirm, complete
            'reservation_data': {},
            'phone': '+34600000000'  # Teléfono simulado
        }
        
        # Configuración de audio
        self.CHUNK = 1024
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.RATE = 16000
        self.RECORD_SECONDS = 5
        
        self.audio = pyaudio.PyAudio()
        self.is_recording = False
        
        # Voz actual (por defecto)
        self.current_voice = 'es-ES-Neural2-B'
        
    def select_voice(self):
        """Permite al usuario seleccionar una voz"""
        print("\n" + "="*60)
        print("SELECTOR DE VOCES - Elige la voz que mas te guste")
        print("="*60)
        print("Voces disponibles:")
        print()
        
        for key, voice in AVAILABLE_VOICES.items():
            voice_type = "Neural2" if "Neural2" in voice else "Standard" if "Standard" in voice else "WaveNet"
            gender = "Femenina" if voice.endswith('A') or voice.endswith('C') else "Masculina"
            current = " [ACTUAL]" if voice == self.current_voice else ""
            print(f"  {key:2}. {voice:<25} ({voice_type} - {gender}){current}")
        
        print()
        print("Comandos especiales:")
        print("  'test' - Probar la voz actual")
        print("  'current' - Ver voz actual")
        print("  'skip' - Continuar con la voz actual")
        print()
        
        while True:
            choice = input("Elige una voz (número) o comando: ").strip().lower()
            
            if choice == 'skip':
                break
            elif choice == 'current':
                print(f"Voz actual: {self.current_voice}")
                continue
            elif choice == 'test':
                self.test_current_voice()
                continue
            elif choice in AVAILABLE_VOICES:
                self.current_voice = AVAILABLE_VOICES[choice]
                print(f"Voz cambiada a: {self.current_voice}")
                self.test_current_voice()
                break
            else:
                print("Opcion no valida. Intenta de nuevo.")
    
    def test_current_voice(self):
        """Prueba la voz actual con un mensaje de ejemplo"""
        test_message = "Hola, esta es una prueba de la voz actual. ¿Te gusta cómo suena?"
        print(f"\nProbando voz: {self.current_voice}")
        print(f"Mensaje: '{test_message}'")
        
        # Crear un speech_handler temporal con la nueva voz
        temp_speech_handler = SpeechToTextHandler()
        temp_speech_handler.voice_name = self.current_voice
        
        try:
            # Sintetizar voz con la voz seleccionada
            audio_content = temp_speech_handler.synthesize_speech(test_message, voice_name=self.current_voice)
            
            if audio_content:
                # Guardar audio temporal
                temp_file = "temp_voice_test.mp3"
                with open(temp_file, 'wb') as f:
                    f.write(audio_content)
                
                # Reproducir
                self.play_audio_file(temp_file)
                
                # Limpiar
                if os.path.exists(temp_file):
                    os.remove(temp_file)
                
                print("Prueba completada")
            else:
                print("Error sintetizando voz")
                
        except Exception as e:
            print(f"Error probando voz: {e}")
        
    def start_call_simulation(self):
        """Inicia la simulación de llamada telefónica por voz"""
        print("SIMULADOR DE LLAMADA TELEFONICA POR VOZ")
        print("=" * 50)
        
        # Seleccionar voz al inicio
        self.select_voice()
        
        print("\n" + "="*50)
        print("Instrucciones:")
        print("1. El sistema te hablará y te hará preguntas")
        print("2. Presiona ENTER cuando quieras responder")
        print("3. Habla tu respuesta (máximo 5 segundos)")
        print("4. Presiona ENTER para procesar tu respuesta")
        print("5. Escribe 'salir' para terminar la llamada")
        print("6. Escribe 'voz' para cambiar de voz durante la conversación")
        print("=" * 50)
        
        # Saludo inicial
        response = self.process_user_response("")
        self.say_and_speak(response)
        
        while True:
            # Mostrar el estado actual
            self.show_current_state()
            
            # Obtener respuesta del usuario
            user_input = input(f"\nPresiona ENTER para responder por voz (o 'salir' para terminar, 'voz' para cambiar voz): ").strip()
            
            if user_input.lower() == 'salir':
                self.say_and_speak("¡Hasta luego! Que tenga un buen día.")
                break
            elif user_input.lower() == 'voz':
                self.select_voice()
                continue
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
        print(f"Voz actual: {self.current_voice}")
        if data:
            print("Datos recopilados:")
            for key, value in data.items():
                print(f"  {key}: {value}")
    
    def say_and_speak(self, message):
        """Muestra y reproduce por voz un mensaje"""
        print(f"\nSistema: {message}")
        self.play_audio_response(message)
    
    def restart_conversation(self):
        """Reinicia la conversación"""
        self.conversation_state = {
            'step': 'greeting',
            'reservation_data': {},
            'phone': '+34600000000'
        }
        response = self.process_user_response("")
        self.say_and_speak(f"¡Perfecto! {response}")
    
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
        
        # greeting - solo dice hola y pregunta en qué puede ayudar
        if step == 'greeting':
            self.conversation_state['step'] = 'ask_intention'
            return "¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?"
        
        # ask_intention - confirma que quiere hacer una reserva
        elif step == 'ask_intention':
            if self.is_reservation_request(text):
                self.conversation_state['step'] = 'ask_people'
                return "¡Perfecto! Encantado de ayudarle con su reserva. ¿Para cuántas personas?"
            else:
                return "Disculpe, solo puedo ayudarle con reservas. ¿Le gustaría hacer una reserva?"
        
        elif step == 'ask_people':
            people = self.extract_people_count(text)
            if people:
                self.conversation_state['reservation_data']['NumeroReserva'] = people
                self.conversation_state['step'] = 'ask_date'
                personas_texto = "persona" if people == 1 else "personas"
                return f"Perfecto, {people} {personas_texto}. ¿Para qué fecha?"
            else:
                return "No entendí. ¿Cuántas personas?"
        
        elif step == 'ask_date':
            date = self.extract_date(text)
            if date:
                self.conversation_state['reservation_data']['FechaReserva'] = date
                self.conversation_state['step'] = 'ask_time'
                return f"Perfecto, {self.format_date_spanish(date)}. ¿A qué hora?"
            else:
                return "No entendí la fecha. ¿Qué día?"
        
        elif step == 'ask_time':
            time = self.extract_time(text)
            if time:
                self.conversation_state['reservation_data']['HoraReserva'] = time
                self.conversation_state['step'] = 'ask_name'
                return f"Perfecto, a las {time}. ¿Su nombre?"
            else:
                return "No entendí. ¿A qué hora?"
        
        elif step == 'ask_name':
            name = self.extract_name(text)
            if name:
                self.conversation_state['reservation_data']['NomReserva'] = name
                self.conversation_state['step'] = 'ask_phone'
                return f"Perfecto, {name}. ¿Desea usar este número de teléfono para la reserva, o prefiere indicar otro?"
            else:
                return "No entendí. ¿Su nombre?"
        
        elif step == 'ask_phone':
            # Verificar si quiere usar el número actual o dar otro
            if 'este' in text or 'mismo' in text or 'si' in text or 'sí' in text or 'vale' in text or 'ok' in text:
                # Usa el número de la llamada
                self.conversation_state['reservation_data']['TelefonReserva'] = self.conversation_state['phone']
                self.conversation_state['step'] = 'confirm'
                return self.get_confirmation_message()
            elif 'otro' in text or 'diferente' in text or 'no' in text:
                # Preguntar por otro número
                self.conversation_state['step'] = 'ask_phone_number'
                return "¿Qué número de teléfono prefiere?"
            else:
                # Intentar extraer un número directamente
                phone = self.extract_phone(text)
                if phone:
                    self.conversation_state['reservation_data']['TelefonReserva'] = phone
                    self.conversation_state['step'] = 'confirm'
                    return self.get_confirmation_message()
                else:
                    return "¿Desea usar este número o prefiere dar otro?"
        
        elif step == 'ask_phone_number':
            # Extraer el número de teléfono
            phone = self.extract_phone(text)
            if phone:
                self.conversation_state['reservation_data']['TelefonReserva'] = phone
                self.conversation_state['step'] = 'confirm'
                return self.get_confirmation_message()
            else:
                return "No entendí el número. Por favor, dígalo dígito por dígito."
        
        elif step == 'confirm':
            if 'si' in text or 'sí' in text or 'confirmo' in text or 'correcto' in text:
                self.conversation_state['step'] = 'complete'
                return "¡Perfecto! Su reserva está confirmada. Le esperamos. ¡Buen día!"
            elif 'no' in text or 'cambiar' in text or 'modificar' in text:
                return "¿Qué le gustaría cambiar? Puede decir cambiar personas, cambiar fecha, cambiar hora, cambiar nombre o cambiar teléfono."
            else:
                return "¿Confirma los datos de la reserva? Responda sí para confirmar o no para modificar algo."
        
        else:
            # Paso no reconocido - reiniciar
            self.conversation_state['step'] = 'greeting'
            return "¿En qué puedo ayudarle? ¿Le gustaría hacer una reserva?"
    
    def format_date_spanish(self, date_str):
        """Formatea la fecha en español"""
        try:
            parts = date_str.split('-')
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
            months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                     'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
            return f"{day} de {months[month - 1]}"
        except:
            return date_str
    
    def is_reservation_request(self, text):
        """Detecta si es una solicitud de reserva"""
        reservation_words = ['reservar', 'reserva', 'mesa', 'quiero', 'necesito', 
                           'me gustaría', 'quisiera', 'deseo', 'quería',
                           'hacer una reserva', 'reservar mesa', 'si', 'sí', 'vale']
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
        
        # Manejar "pasado mañana" ANTES que "mañana"
        if 'pasado mañana' in text or ('pasado' in text and 'mañana' in text):
            date = today + timedelta(days=2)
            return date.strftime("%Y-%m-%d")
        
        # Manejar "mañana" 
        if 'mañana' in text and 'pasado' not in text:
            date = today + timedelta(days=1)
            return date.strftime("%Y-%m-%d")
        
        # Manejar "hoy"
        if 'hoy' in text:
            return today.strftime("%Y-%m-%d")
        
        # Mapeo de nombres de meses en español
        month_names = {
            'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
            'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
            'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
        }
        
        # Detectar días de la semana
        days_of_week = {
            'lunes': 0, 'martes': 1, 'miércoles': 2, 'miercoles': 2,
            'jueves': 3, 'viernes': 4, 'sábado': 5, 'sabado': 5, 'domingo': 6
        }
        
        # Intentar extraer fecha con nombre de mes: "10 de octubre", "15 de enero"
        for month_name, month_number in month_names.items():
            if month_name in text:
                # Buscar el número antes del mes
                patterns = [
                    rf'(\d{{1,2}})\s*de\s*{month_name}',  # "10 de octubre"
                    rf'(\d{{1,2}})\s*{month_name}',         # "10 octubre"
                    rf'{month_name}\s*(\d{{1,2}})',         # "octubre 10"
                ]
                
                for pattern in patterns:
                    match = re.search(pattern, text, re.IGNORECASE)
                    if match:
                        day = int(match.group(1))
                        if 1 <= day <= 31:
                            year = today.year
                            try:
                                date = datetime(year, month_number, day)
                                if date < today:
                                    date = datetime(year + 1, month_number, day)
                                return date.strftime("%Y-%m-%d")
                            except ValueError:
                                return None
        
        # Detectar días de la semana como "viernes que viene"
        for day_name, day_number in days_of_week.items():
            if day_name in text:
                current_weekday = today.weekday()  # 0=lunes, 6=domingo
                days_until = day_number - current_weekday
                
                if days_until <= 0:
                    days_until += 7
                
                # Si dice "que viene" o "próximo", asegurar que es la próxima semana
                if 'que viene' in text or 'próximo' in text or 'proximo' in text:
                    if days_until < 7:
                        days_until += 7
                
                date = today + timedelta(days=days_until)
                return date.strftime("%Y-%m-%d")
        
        # Intentar extraer fecha numérica: "10/10", "10-10"
        date_match = re.search(r'(\d{1,2})[\/\-](\d{1,2})', text)
        if date_match:
            day, month = int(date_match.group(1)), int(date_match.group(2))
            year = today.year
            try:
                date = datetime(year, month, day)
                if date < today:
                    date = datetime(year + 1, month, day)
                return date.strftime("%Y-%m-%d")
            except ValueError:
                return None
        
        return None
    
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
        
        # Formatear teléfono dígito por dígito
        phone_formatted = self.format_phone_for_speech(data['TelefonReserva'])
        
        # Formatear fecha
        date_formatted = self.format_date_spanish(data['FechaReserva'])
        
        personas_texto = "persona" if data['NumeroReserva'] == 1 else "personas"
        
        message = f"Confirmo: {data['NumeroReserva']} {personas_texto}, "
        message += f"{date_formatted} a las {data['HoraReserva']}, "
        message += f"a nombre de {data['NomReserva']}, "
        message += f"teléfono {phone_formatted}. ¿Es correcto?"
        
        return message
    
    def format_phone_for_speech(self, phone):
        """Formatea el teléfono para que se lea dígito por dígito"""
        clean_phone = re.sub(r'\D', '', phone)
        
        digit_words = {
            '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro',
            '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve'
        }
        
        result = ''
        for i, digit in enumerate(clean_phone):
            result += digit_words.get(digit, digit)
            # Añadir pausa después de cada 3 dígitos
            if (i + 1) % 3 == 0 and i != len(clean_phone) - 1:
                result += ', '
            elif i != len(clean_phone) - 1:
                result += ' '
        
        return result
    
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
            # Actualizar la voz del speech_handler con la voz actual
            self.speech_handler.voice_name = self.current_voice
            
            # Sintetizar voz con la voz seleccionada
            audio_content = self.speech_handler.synthesize_speech(text, voice_name=self.current_voice)
            
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
