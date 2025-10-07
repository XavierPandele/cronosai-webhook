#!/usr/bin/env python3
"""
Simulador que funciona sin Google Cloud - solo con detector inteligente
"""

import os
import sys
from dotenv import load_dotenv
from smart_reservation_detector import SmartReservationDetector

# Cargar variables de entorno
load_dotenv()

class SimpleSimulator:
    def __init__(self):
        """Simulador simple sin Google Cloud"""
        webhook_url = os.getenv('WEBHOOK_URL', 'https://cronosai-webhook.vercel.app/api/webhook')
        self.smart_detector = SmartReservationDetector(webhook_url)
        
    def start_simulation(self):
        """Inicia la simulación simple"""
        print("SIMULADOR SIMPLE DE RESERVAS")
        print("=" * 50)
        print("Instrucciones:")
        print("1. Escribe tu mensaje de reserva")
        print("2. Presiona ENTER para procesar")
        print("3. Escribe 'salir' para terminar")
        print("=" * 50)
        
        # Saludo inicial
        print("Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?")
        
        while True:
            user_input = input("\nEscribe tu mensaje (o 'salir' para terminar): ").strip()
            
            if user_input.lower() == 'salir':
                print("¡Hasta luego!")
                break
                
            if user_input:
                # Procesar mensaje
                print("Procesando...")
                result = self.process_text_input(user_input)
                
                if result['success']:
                    print(f"Respuesta: {result['response']}")
                else:
                    print(f"Error: {result['error']}")
    
    def process_text_input(self, text):
        """Procesa entrada de texto"""
        try:
            print(f"Texto recibido: {text}")
            
            # Verificar si es solicitud de reserva
            if self.smart_detector.is_reservation_request(text):
                print("Solicitud de reserva detectada")
                response = self.smart_detector.process_reservation(text)
                return {
                    "success": True,
                    "response": response,
                    "type": "reservation"
                }
            else:
                return {
                    "success": True,
                    "response": "Disculpe, no pude entender. ¿Puede ser más específico sobre su reserva?",
                    "type": "general"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

def main():
    """Función principal"""
    print("Iniciando Simulador Simple de Reservas")
    print("=" * 50)
    
    # Crear y ejecutar simulador
    simulator = SimpleSimulator()
    simulator.start_simulation()

if __name__ == "__main__":
    main()
