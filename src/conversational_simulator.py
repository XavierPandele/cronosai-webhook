#!/usr/bin/env python3
"""
Simulador conversacional que pide datos paso a paso
"""

import os
import re
import requests
import json
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

class ConversationalSimulator:
    def __init__(self):
        """Simulador conversacional paso a paso"""
        self.webhook_url = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        
        # Estados de la conversación
        self.conversation_state = {
            'step': 'greeting',  # greeting, ask_people, ask_date, ask_time, ask_name, ask_phone, confirm, complete
            'reservation_data': {}
        }
        
    def start_conversation(self):
        """Inicia la conversación paso a paso"""
        print("SIMULADOR CONVERSACIONAL DE RESERVAS")
        print("=" * 50)
        print("Instrucciones:")
        print("- Responde las preguntas paso a paso")
        print("- Escribe 'salir' en cualquier momento para terminar")
        print("- Escribe 'reiniciar' para empezar de nuevo")
        print("=" * 50)
        
        # Saludo inicial
        self.say("¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?")
        
        while True:
            # Mostrar el estado actual
            self.show_current_state()
            
            # Obtener respuesta del usuario
            user_input = input("\nTu respuesta: ").strip()
            
            if user_input.lower() == 'salir':
                self.say("¡Hasta luego! Que tenga un buen día.")
                break
            elif user_input.lower() == 'reiniciar':
                self.restart_conversation()
                continue
            elif user_input:
                # Procesar la respuesta del usuario
                response = self.process_user_response(user_input)
                self.say(response)
                
                # Si la conversación está completa, procesar la reserva
                if self.conversation_state['step'] == 'complete':
                    self.process_reservation()
                    self.restart_conversation()
    
    def show_current_state(self):
        """Muestra el estado actual de la conversación"""
        step = self.conversation_state['step']
        data = self.conversation_state['reservation_data']
        
        print(f"\n--- Estado: {step.upper()} ---")
        if data:
            print("Datos recopilados:")
            for key, value in data.items():
                print(f"  {key}: {value}")
    
    def say(self, message):
        """Muestra un mensaje del sistema"""
        print(f"\n🤖 Sistema: {message}")
    
    def restart_conversation(self):
        """Reinicia la conversación"""
        self.conversation_state = {
            'step': 'greeting',
            'reservation_data': {}
        }
        self.say("¡Perfecto! Empecemos de nuevo. ¿En qué puedo ayudarle?")
    
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
                return f"Excelente, mesa para {people} personas. ¿Para qué fecha le gustaría la reserva? (puede decir 'mañana', 'pasado mañana' o una fecha específica)"
            else:
                return "Disculpe, no entendí cuántas personas. ¿Podría decirme el número de personas? (ejemplo: 'para 2 personas' o 'somos 4')"
        
        elif step == 'ask_date':
            date = self.extract_date(text)
            if date:
                self.conversation_state['reservation_data']['FechaReserva'] = date
                self.conversation_state['step'] = 'ask_time'
                return f"Perfecto, reserva para el {date}. ¿A qué hora le gustaría venir? (ejemplo: 'a las 8' o 'a las 19:30')"
            else:
                return "Disculpe, no entendí la fecha. ¿Podría especificar la fecha? (ejemplo: 'mañana', 'pasado mañana' o 'el 15 de enero')"
        
        elif step == 'ask_time':
            time = self.extract_time(text)
            if time:
                self.conversation_state['reservation_data']['HoraReserva'] = time
                self.conversation_state['step'] = 'ask_name'
                return f"Excelente, a las {time}. ¿Cuál es su nombre para la reserva?"
            else:
                return "Disculpe, no entendí la hora. ¿Podría especificar la hora? (ejemplo: 'a las 8', 'a las 19:30' o '8 de la noche')"
        
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
                # Permitir modificar datos
                return "¿Qué le gustaría cambiar? Puede decir 'cambiar personas', 'cambiar fecha', 'cambiar hora', 'cambiar nombre' o 'cambiar teléfono'"
            else:
                return "¿Confirma los datos de la reserva? Responda 'sí' para confirmar o 'no' para modificar algo."
        
        else:
            # Paso no reconocido
            if self.is_reservation_request(text):
                self.conversation_state['step'] = 'ask_people'
                return "¡Perfecto! ¿Para cuántas personas sería la mesa?"
            else:
                return "Disculpe, no entendí. ¿Le gustaría hacer una reserva? Puede decir 'sí' o describir lo que necesita."
    
    def is_reservation_request(self, text):
        """Detecta si es una solicitud de reserva"""
        reservation_words = ['reservar', 'mesa', 'reserva', 'quiero', 'necesito', 'gustaría', 'gustaria']
        return any(word in text for word in reservation_words)
    
    def extract_people_count(self, text):
        """Extrae el número de personas del texto"""
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
                if 1 <= count <= 20:  # Límite razonable
                    return count
        
        # Buscar números sueltos
        numbers = re.findall(r'\d+', text)
        for num in numbers:
            count = int(num)
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
        patterns = [
            r'a\s+las?\s+(\d{1,2}):?(\d{0,2})',
            r'(\d{1,2}):(\d{0,2})',
            r'a\s+(\d{1,2})\s+horas?',
            r'(\d{1,2})\s+horas?',
            r'(\d{1,2})\s+de\s+la\s+(mañana|tarde|noche)'
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
        
        message = "Perfecto, déjeme confirmar los datos de su reserva:\n"
        message += f"• Mesa para {data['NumeroReserva']} personas\n"
        message += f"• Fecha: {data['FechaReserva']}\n"
        message += f"• Hora: {data['HoraReserva']}\n"
        message += f"• Nombre: {data['NomReserva']}\n"
        message += f"• Teléfono: {data['TelefonReserva']}\n\n"
        message += "¿Está todo correcto? Responda 'sí' para confirmar o 'no' para modificar algo."
        
        return message
    
    def process_reservation(self):
        """Procesa la reserva final"""
        try:
            data = self.conversation_state['reservation_data']
            
            # Preparar datos para el webhook
            webhook_data = {
                "sessionInfo": {
                    "session": "conversational-session",
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
                        "observacions": f"Reserva creada por simulador conversacional"
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
                
                # Extraer respuesta del webhook
                if 'fulfillment_response' in webhook_response:
                    messages = webhook_response['fulfillment_response'].get('messages', [])
                    if messages and 'text' in messages[0]:
                        confirmation_text = messages[0]['text']['text']
                        self.say(confirmation_text)
                    else:
                        self.say("¡Reserva confirmada! Recibirá una confirmación por teléfono.")
                else:
                    self.say("¡Reserva confirmada! Recibirá una confirmación por teléfono.")
            else:
                print(f"❌ Error procesando reserva: {response.status_code}")
                self.say("Hubo un problema procesando su reserva. Por favor, intente de nuevo.")
                
        except Exception as e:
            print(f"❌ Error: {e}")
            self.say("Hubo un error procesando su reserva. Por favor, intente de nuevo.")

def main():
    """Función principal"""
    print("Iniciando Simulador Conversacional de Reservas")
    print("=" * 50)
    
    # Crear y ejecutar simulador
    simulator = ConversationalSimulator()
    simulator.start_conversation()

if __name__ == "__main__":
    main()
