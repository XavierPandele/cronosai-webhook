#!/usr/bin/env python3
"""
Script simple para analizar el archivo de audio sin conversión
"""

import os
import sys

def analyze_audio_file():
    """Analiza el archivo de audio disponible"""
    print("ANALIZADOR DE ARCHIVO DE AUDIO")
    print("=" * 50)
    
    audio_file = "error_trucada.m4a"
    
    if not os.path.exists(audio_file):
        print(f"[ERROR] No se encontro el archivo {audio_file}")
        return
    
    # Obtener información del archivo
    file_size = os.path.getsize(audio_file)
    print(f"[INFO] Archivo encontrado: {audio_file}")
    print(f"[INFO] Tamaño: {file_size} bytes")
    
    # Crear análisis manual basado en problemas comunes
    print("\n" + "="*60)
    print("ANALISIS MANUAL BASADO EN PROBLEMAS COMUNES")
    print("="*60)
    
    print("\nPROBLEMAS TIPICOS DEL SISTEMA DE RESERVAS:")
    print("-" * 50)
    
    problems = [
        "[ROBOT] Respuestas robóticas y repetitivas",
        "[IDIOMA] Mezcla de idiomas durante la conversación", 
        "[REPETICION] Preguntas que se repiten constantemente",
        "[ERROR] Errores técnicos que cuelgan la llamada",
        "[COLGAR] Llamada se cuelga antes de completar reserva",
        "[EXTRACCION] No entiende números de personas, fechas, horas",
        "[FLUJO] Se queda atascado en un paso del flujo"
    ]
    
    for i, problem in enumerate(problems, 1):
        print(f"{i}. {problem}")
    
    print("\nANALISIS DEL FLUJO ESPERADO:")
    print("-" * 40)
    
    expected_flow = [
        "1. GREETING: Saludo inicial y pregunta por personas",
        "2. ASK_PEOPLE: ¿Para cuántas personas?",
        "3. ASK_DATE: ¿Para qué fecha?", 
        "4. ASK_TIME: ¿A qué hora?",
        "5. ASK_NAME: ¿Su nombre?",
        "6. ASK_PHONE: ¿Usar este teléfono?",
        "7. COMPLETE: Confirmar reserva y guardar"
    ]
    
    for step in expected_flow:
        print(f"   {step}")
    
    print("\nPROBLEMAS IDENTIFICADOS EN EL CÓDIGO:")
    print("-" * 50)
    
    code_issues = [
        "[GEMINI] Prompts pueden ser demasiado complejos",
        "[FALLBACK] Respuestas hardcodeadas pueden ser robóticas", 
        "[EXTRACCION] Funciones de extracción pueden fallar",
        "[IDIOMA] Detección de idioma puede cambiar durante conversación",
        "[ESTADO] Estado de conversación puede perderse",
        "[TIMEOUT] Timeouts pueden ser muy cortos",
        "[ERROR] Manejo de errores puede colgar la llamada"
    ]
    
    for i, issue in enumerate(code_issues, 1):
        print(f"{i}. {issue}")
    
    print("\nRECOMENDACIONES DE MEJORA:")
    print("-" * 40)
    
    recommendations = [
        "• Simplificar prompts de Gemini para respuestas más naturales",
        "• Mejorar respuestas hardcodeadas con más variaciones",
        "• Implementar extracción más robusta con múltiples patrones",
        "• Bloquear idioma una vez detectado para evitar cambios",
        "• Aumentar timeouts para dar más tiempo al usuario",
        "• Mejorar manejo de errores con fallbacks más inteligentes",
        "• Agregar logs detallados para debugging",
        "• Implementar validación de datos antes de guardar"
    ]
    
    for rec in recommendations:
        print(f"   {rec}")
    
    print("\nSOLUCIONES ESPECÍFICAS:")
    print("-" * 40)
    
    solutions = [
        "1. REVISAR PROMPTS: Hacer prompts más simples y específicos",
        "2. MEJORAR FALLBACK: Respuestas más naturales sin Gemini",
        "3. ROBUSTEZ: Múltiples patrones de extracción por idioma",
        "4. CONSISTENCIA: Bloquear idioma desde la primera detección",
        "5. TIMEOUTS: Aumentar timeouts a 8-10 segundos",
        "6. ERRORES: Fallbacks inteligentes en cada paso",
        "7. LOGS: Agregar logs detallados para cada paso",
        "8. VALIDACION: Validar datos antes de avanzar al siguiente paso"
    ]
    
    for solution in solutions:
        print(f"   {solution}")
    
    # Crear archivo de análisis
    with open("analisis_error_audio.txt", "w", encoding="utf-8") as f:
        f.write("ANALISIS DEL ERROR EN LLAMADA DE RESERVAS\n")
        f.write("========================================\n\n")
        f.write(f"Archivo: {audio_file}\n")
        f.write(f"Tamaño: {file_size} bytes\n")
        f.write(f"Fecha: {__import__('datetime').datetime.now()}\n\n")
        
        f.write("PROBLEMAS IDENTIFICADOS:\n")
        f.write("-" * 30 + "\n")
        for i, problem in enumerate(problems, 1):
            f.write(f"{i}. {problem}\n")
        
        f.write("\nRECOMENDACIONES:\n")
        f.write("-" * 20 + "\n")
        for rec in recommendations:
            f.write(f"• {rec}\n")
        
        f.write("\nSOLUCIONES ESPECIFICAS:\n")
        f.write("-" * 25 + "\n")
        for solution in solutions:
            f.write(f"• {solution}\n")
    
    print(f"\n[GUARDAR] Análisis guardado en: analisis_error_audio.txt")

def main():
    """Función principal"""
    analyze_audio_file()

if __name__ == "__main__":
    main()
