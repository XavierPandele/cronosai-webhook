#!/usr/bin/env python3
"""
Script para convertir archivo M4A a WAV y transcribir
"""

import os
import subprocess
import sys

def convert_m4a_to_wav(input_file, output_file):
    """Convierte archivo M4A a WAV usando ffmpeg"""
    print(f"[CONVERTIR] Convirtiendo {input_file} a {output_file}")
    
    try:
        # Comando ffmpeg para convertir M4A a WAV
        cmd = [
            'ffmpeg', 
            '-i', input_file,
            '-acodec', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            '-y',  # Sobrescribir archivo si existe
            output_file
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("[OK] Conversion exitosa")
            return True
        else:
            print(f"[ERROR] Error en conversion: {result.stderr}")
            return False
            
    except FileNotFoundError:
        print("[ERROR] ffmpeg no encontrado. Instalando...")
        try:
            # Intentar instalar ffmpeg
            subprocess.run(['pip', 'install', 'ffmpeg-python'], check=True)
            print("[OK] ffmpeg-python instalado")
            return convert_m4a_to_wav(input_file, output_file)
        except:
            print("[ERROR] No se pudo instalar ffmpeg. Usando alternativa...")
            return False
    except Exception as e:
        print(f"[ERROR] Error en conversion: {e}")
        return False

def transcribe_with_pydub(input_file):
    """Transcribe usando pydub para manejar M4A directamente"""
    try:
        from pydub import AudioSegment
        import speech_recognition as sr
        
        print(f"[AUDIO] Cargando archivo M4A: {input_file}")
        
        # Cargar archivo M4A con pydub
        audio = AudioSegment.from_file(input_file, format="m4a")
        
        # Convertir a formato compatible con speech_recognition
        audio = audio.set_frame_rate(16000).set_channels(1)
        
        # Exportar a formato temporal WAV
        temp_wav = "temp_audio.wav"
        audio.export(temp_wav, format="wav")
        
        print("[AUDIO] Archivo convertido, transcribiendo...")
        
        # Transcribir con speech_recognition
        r = sr.Recognizer()
        with sr.AudioFile(temp_wav) as source:
            audio_data = r.record(source)
        
        # Intentar transcribir
        try:
            text = r.recognize_google(audio_data, language='es-ES')
            print("[OK] Transcripcion exitosa")
            return text
        except sr.UnknownValueError:
            print("[WARN] Google no pudo entender el audio")
            return None
        except sr.RequestError as e:
            print(f"[ERROR] Error en servicio de reconocimiento: {e}")
            return None
            
    except Exception as e:
        print(f"[ERROR] Error procesando archivo: {e}")
        return None
    finally:
        # Limpiar archivo temporal
        if os.path.exists("temp_audio.wav"):
            os.remove("temp_audio.wav")

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
    print("CONVERTIDOR Y TRANSCRIPTOR DE AUDIO")
    print("=" * 50)
    
    input_file = "error_trucada.m4a"
    
    if not os.path.exists(input_file):
        print(f"[ERROR] No se encontro el archivo {input_file}")
        return
    
    # Intentar transcribir directamente con pydub
    print("[INFO] Intentando transcripcion directa con pydub...")
    transcription = transcribe_with_pydub(input_file)
    
    if transcription:
        # Analizar transcripción
        analyze_transcription(transcription)
        
        # Guardar transcripción en archivo
        with open("transcripcion_error.txt", "w", encoding="utf-8") as f:
            f.write(f"TRANSCRIPCION DEL ERROR\n")
            f.write(f"======================\n\n")
            f.write(f"Archivo: {input_file}\n")
            f.write(f"Fecha: {__import__('datetime').datetime.now()}\n\n")
            f.write(f"Transcripcion:\n")
            f.write(f'"{transcription}"\n\n')
            f.write(f"Analisis guardado en este archivo para referencia futura.\n")
        
        print(f"\n[GUARDAR] Transcripcion guardada en: transcripcion_error.txt")
    else:
        print("[ERROR] No se pudo transcribir el audio")
        print("[INFO] Intenta convertir el archivo a WAV manualmente")

if __name__ == "__main__":
    main()
