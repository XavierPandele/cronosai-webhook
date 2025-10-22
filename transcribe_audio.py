#!/usr/bin/env python3
"""
Script para transcribir archivo de audio y analizar errores del sistema de reservas
"""

import speech_recognition as sr
import os
import sys

def transcribe_audio(file_path):
    """Transcribe audio file to text"""
    print(f"[AUDIO] Transcribiendo archivo: {file_path}")
    
    # Verificar que el archivo existe
    if not os.path.exists(file_path):
        print(f"[ERROR] El archivo {file_path} no existe")
        return None
    
    # Inicializar reconocedor
    r = sr.Recognizer()
    
    try:
        # Cargar archivo de audio
        with sr.AudioFile(file_path) as source:
            print("[AUDIO] Cargando archivo de audio...")
            audio = r.record(source)
        
        print("[AUDIO] Transcribiendo audio...")
        
        # Intentar transcribir con Google Speech Recognition
        try:
            text = r.recognize_google(audio, language='es-ES')
            print("[OK] Transcripcion exitosa con Google")
            return text
        except sr.UnknownValueError:
            print("[WARN] Google no pudo entender el audio, intentando con Sphinx...")
            try:
                text = r.recognize_sphinx(audio)
                print("[OK] Transcripcion exitosa con Sphinx")
                return text
            except sr.UnknownValueError:
                print("[ERROR] Sphinx tampoco pudo entender el audio")
                return None
        except sr.RequestError as e:
            print(f"[ERROR] Error en el servicio de reconocimiento: {e}")
            return None
            
    except Exception as e:
        print(f"[ERROR] Error procesando archivo: {e}")
        return None

def analyze_transcription(text):
    """Analiza la transcripción para identificar problemas"""
    print("\n" + "="*60)
    print("ANALISIS DE LA TRANSCRIPCION")
    print("="*60)
    
    if not text:
        print("[ERROR] No hay transcripcion para analizar")
        return
    
    print(f"Transcripcion completa:")
    print(f'"{text}"')
    print()
    
    # Análisis de problemas comunes
    problems = []
    
    # 1. Verificar si hay respuestas robóticas
    robotic_phrases = [
        "en qué puedo ayudarle",
        "por favor responda",
        "no he recibido respuesta",
        "gracias por llamar"
    ]
    
    for phrase in robotic_phrases:
        if phrase.lower() in text.lower():
            problems.append(f"[ROBOT] Respuesta robotica detectada: '{phrase}'")
    
    # 2. Verificar cambios de idioma
    spanish_words = ["hola", "gracias", "por favor", "sí", "no", "mesa", "personas", "fecha", "hora", "nombre"]
    english_words = ["hello", "thanks", "please", "yes", "no", "table", "people", "date", "time", "name"]
    
    spanish_count = sum(1 for word in spanish_words if word in text.lower())
    english_count = sum(1 for word in english_words if word in text.lower())
    
    if spanish_count > 0 and english_count > 0:
        problems.append(f"[IDIOMA] Mezcla de idiomas detectada (ES: {spanish_count}, EN: {english_count})")
    
    # 3. Verificar si se repite la misma pregunta
    lines = text.split('.')
    unique_questions = set()
    for line in lines:
        if '?' in line:
            question = line.strip()
            if question in unique_questions:
                problems.append(f"[REPETICION] Pregunta repetida: '{question}'")
            unique_questions.add(question)
    
    # 4. Verificar si hay errores técnicos
    error_phrases = [
        "error técnico",
        "problema técnico",
        "application error",
        "ha ocurrido un error",
        "lo siento ha habido un problema"
    ]
    
    for phrase in error_phrases:
        if phrase.lower() in text.lower():
            problems.append(f"[ERROR] Error tecnico detectado: '{phrase}'")
    
    # 5. Verificar si se cuelga la llamada
    hangup_phrases = [
        "gracias por llamar",
        "hasta pronto",
        "nos vemos",
        "hasta luego"
    ]
    
    for phrase in hangup_phrases:
        if phrase.lower() in text.lower():
            problems.append(f"[COLGAR] Llamada terminada: '{phrase}'")
    
    # Mostrar problemas encontrados
    if problems:
        print("PROBLEMAS DETECTADOS:")
        for i, problem in enumerate(problems, 1):
            print(f"{i}. {problem}")
    else:
        print("[OK] No se detectaron problemas obvios")
    
    # Análisis del flujo de conversación
    print("\nANALISIS DEL FLUJO:")
    print("-" * 40)
    
    # Contar preguntas
    questions = [line for line in lines if '?' in line]
    print(f"Preguntas detectadas: {len(questions)}")
    for i, q in enumerate(questions, 1):
        print(f"   {i}. {q.strip()}")
    
    # Verificar pasos del flujo
    flow_steps = {
        "personas": ["cuántas personas", "how many people", "para cuántos"],
        "fecha": ["qué fecha", "what date", "cuándo", "when"],
        "hora": ["qué hora", "what time", "a qué hora", "at what time"],
        "nombre": ["nombre", "name", "cómo se llama", "what's your name"],
        "teléfono": ["teléfono", "phone", "número", "number"]
    }
    
    detected_steps = []
    for step, keywords in flow_steps.items():
        for keyword in keywords:
            if keyword in text.lower():
                detected_steps.append(step)
                break
    
    print(f"Pasos detectados: {', '.join(detected_steps)}")
    
    # Recomendaciones
    print("\nRECOMENDACIONES:")
    print("-" * 40)
    
    if "[ROBOT]" in str(problems):
        print("• Mejorar respuestas para que sean más naturales")
    if "[IDIOMA]" in str(problems):
        print("• Implementar bloqueo de idioma más estricto")
    if "[REPETICION]" in str(problems):
        print("• Evitar repetición de preguntas")
    if "[ERROR]" in str(problems):
        print("• Revisar manejo de errores y fallbacks")
    if "[COLGAR]" in str(problems):
        print("• Verificar que la reserva se complete antes de colgar")

def main():
    """Función principal"""
    print("TRANSCRIPTOR Y ANALIZADOR DE AUDIO")
    print("=" * 50)
    
    # Verificar que el archivo existe
    audio_file = "error_trucada.m4a"
    
    if not os.path.exists(audio_file):
        print(f"[ERROR] No se encontro el archivo {audio_file}")
        print("Asegurate de que el archivo este en el directorio actual")
        return
    
    # Transcribir audio
    transcription = transcribe_audio(audio_file)
    
    if transcription:
        # Analizar transcripción
        analyze_transcription(transcription)
        
        # Guardar transcripción en archivo
        with open("transcripcion_error.txt", "w", encoding="utf-8") as f:
            f.write(f"TRANSCRIPCION DEL ERROR\n")
            f.write(f"======================\n\n")
            f.write(f"Archivo: {audio_file}\n")
            f.write(f"Fecha: {__import__('datetime').datetime.now()}\n\n")
            f.write(f"Transcripcion:\n")
            f.write(f'"{transcription}"\n\n')
            f.write(f"Analisis guardado en este archivo para referencia futura.\n")
        
        print(f"\n[GUARDAR] Transcripcion guardada en: transcripcion_error.txt")
    else:
        print("[ERROR] No se pudo transcribir el audio")

if __name__ == "__main__":
    main()
