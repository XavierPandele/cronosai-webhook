#!/usr/bin/env python3
"""
Detector inteligente de reservas que bypasea Dialogflow CX
"""

import re
import requests
import json
from datetime import datetime, timedelta

class SmartReservationDetector:
    def __init__(self, webhook_url):
        self.webhook_url = webhook_url
        
        # Patrones para detectar reservas (más completos)
        self.reservation_patterns = [
            r'reservar.*mesa',
            r'mesa.*reservar',
            r'hacer.*reserva',
            r'reserva.*mesa',
            r'quiero.*mesa',
            r'necesito.*reservar',
            r'me gustaría.*reservar',
            r'me gustaria.*reservar',
            r'quiero.*reservar',
            r'necesito.*mesa',
            r'puedo.*reservar',
            r'puedo.*mesa',
            r'reserva.*para',
            r'mesa.*para'
        ]
        
        # Patrones para extraer información (mejorados)
        self.person_patterns = [
            r'para\s+(\d+)\s+personas?',
            r'(\d+)\s+personas?',
            r'(\d+)\s+persona',
            r'para\s+(\d+)',
            r'(\d+)\s+comensales?'
        ]
        
        self.time_patterns = [
            r'a\s+las?\s+(\d{1,2}):?(\d{0,2})',
            r'a\s+la\s+(\d{1,2}):?(\d{0,2})',
            r'(\d{1,2}):(\d{0,2})',
            r'a\s+(\d{1,2})\s+horas?',
            r'(\d{1,2})\s+horas?'
        ]
        
    def is_reservation_request(self, text):
        """Detecta si el texto es una solicitud de reserva"""
        text_lower = text.lower()
        
        for pattern in self.reservation_patterns:
            if re.search(pattern, text_lower):
                return True
        return False
    
    def extract_reservation_info(self, text):
        """Extrae información de la reserva del texto"""
        text_lower = text.lower()
        
        # Extraer número de personas
        num_personas = 2  # Default
        for pattern in self.person_patterns:
            match = re.search(pattern, text_lower)
            if match:
                num_personas = int(match.group(1))
                break
        
        # Extraer hora
        hora = "20:00"  # Default
        for pattern in self.time_patterns:
            match = re.search(pattern, text_lower)
            if match:
                if ':' in pattern:  # Formato HH:MM
                    horas = match.group(1)
                    minutos = match.group(2) if match.group(2) else "00"
                    hora = f"{horas.zfill(2)}:{minutos.zfill(2)}"
                else:  # Solo horas
                    horas = match.group(1)
                    hora = f"{horas.zfill(2)}:00"
                break
        
        # Fecha por defecto: mañana
        fecha = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        
        return {
            'NumeroReserva': num_personas,
            'FechaReserva': {
                'year': int(fecha.split('-')[0]),
                'month': int(fecha.split('-')[1]),
                'day': int(fecha.split('-')[2])
            },
            'HoraReserva': {
                'hours': int(hora.split(':')[0]),
                'minutes': int(hora.split(':')[1]),
                'seconds': 0
            },
            'NomReserva': 'Cliente',
            'TelefonReserva': '+49123456789',
            'Observacions': f'Reserva detectada automáticamente de: "{text}"'
        }
    
    def process_reservation(self, text):
        """Procesa una solicitud de reserva"""
        try:
            print("Detectando solicitud de reserva...")
            
            # Extraer información
            params = self.extract_reservation_info(text)
            print(f"Información extraída: {params}")
            
            # Llamar al webhook
            webhook_data = {
                "sessionInfo": {
                    "session": "smart-detector-session",
                    "parameters": {
                        "nomreserva": params['NomReserva'],
                        "telefonreserva": params['TelefonReserva'],
                        "fechareserva": params['FechaReserva'],
                        "horareserva": params['HoraReserva'],
                        "numeroreserva": params['NumeroReserva'],
                        "observacions": params['Observacions']
                    }
                },
                "languageCode": "es-ES"
            }
            
            print("Llamando al webhook...")
            response = requests.post(
                self.webhook_url,
                json=webhook_data,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            if response.status_code == 200:
                webhook_response = response.json()
                print("Webhook procesado exitosamente")
                
                # Extraer respuesta del webhook
                if 'fulfillment_response' in webhook_response:
                    messages = webhook_response['fulfillment_response'].get('messages', [])
                    if messages and 'text' in messages[0]:
                        return messages[0]['text']['text']
                
                return "¡Reserva procesada exitosamente!"
            else:
                print(f"Error en webhook: {response.status_code}")
                return "Hubo un error procesando la reserva. Intenta de nuevo."
                
        except Exception as e:
            print(f"Error procesando reserva: {e}")
            return "Hubo un error procesando la reserva. Intenta de nuevo."

def test_smart_detector():
    """Prueba el detector inteligente"""
    
    print("PROBANDO DETECTOR INTELIGENTE DE RESERVAS")
    print("=" * 50)
    
    detector = SmartReservationDetector("https://cronosai-webhook.vercel.app/api/webhook")
    
    test_phrases = [
        "Me gustaría reservar una mesa para 4 personas",
        "Quiero hacer una reserva para 2 personas a las 8",
        "Necesito reservar una mesa para mañana",
        "Me gustaria reservar para 6 personas a las 19:30"
    ]
    
    for phrase in test_phrases:
        print(f"\nProbando: '{phrase}'")
        
        if detector.is_reservation_request(phrase):
            print("Solicitud de reserva detectada")
            response = detector.process_reservation(phrase)
            print(f"Respuesta: {response}")
        else:
            print("No es una solicitud de reserva")

if __name__ == "__main__":
    test_smart_detector()
