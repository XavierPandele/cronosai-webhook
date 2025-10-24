// Cargar variables de entorno
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Inicializar Gemini SOLO para detección de idioma
let genAI, model;
if (process.env.GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.1, // Muy baja creatividad para detección precisa
      topP: 0.5,
      topK: 20,
      maxOutputTokens: 10, // Solo necesitamos el código del idioma
    }
  });
  console.log('✅ Gemini 2.0 Flash inicializado SOLO para detección de idioma');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado, usando detección hardcodeada');
}

// Estados de conversación
const conversationStates = new Map();

// Sistema híbrido: Gemini para idioma + Hardcodeado para todo lo demás
class HybridSystem {
  
  // Detectar idioma SOLO al inicio de la conversación
  static async detectLanguageOnce(userInput, phoneNumber) {
    if (!model) {
      console.log(`[LANGUAGE] ${phoneNumber}: es (1.0) via fallback`);
      return 'es';
    }
    
    try {
      const prompt = `Analiza el idioma del siguiente texto y responde SOLO con el código del idioma.

TEXTO: "${userInput}"

Responde únicamente con uno de estos códigos: es, en, de, it, fr, pt

Idioma:`;

      console.log(`[GEMINI_REQUEST] ${phoneNumber}: Enviando a language_detection_only`);
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const detectedLang = response.text().trim().toLowerCase();
      
      const supportedLangs = ['es', 'en', 'de', 'it', 'fr', 'pt'];
      if (supportedLangs.includes(detectedLang)) {
        console.log(`[LANGUAGE] ${phoneNumber}: ${detectedLang} (0.95) via gemini`);
        console.log(`[IDIOMA] Detectado: ${detectedLang} para ${phoneNumber}`);
        return detectedLang;
      }
      
      console.log(`[LANGUAGE] ${phoneNumber}: es (0.5) via fallback_invalid`);
      return 'es';
    } catch (error) {
      console.log(`[LANGUAGE] ${phoneNumber}: es (0.0) via error`);
      console.error('[IDIOMA] Error detectando idioma:', error);
      return 'es';
    }
  }
  
  // Análisis de intención HARDCODEADO (sin Gemini)
  static analyzeIntentHardcoded(userInput, currentStep, language) {
    const lowerInput = userInput.toLowerCase();
    
    // Detectar saludos
    if (this.isGreeting(lowerInput, language)) {
      return {
        intent: 'greeting',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'normal',
        next_step: 'waiting_for_request',
        response_type: 'question',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar solicitud de reserva
    if (this.isReservationRequest(lowerInput, language)) {
      return {
        intent: 'reservation_request',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'normal',
        next_step: 'ask_people',
        response_type: 'question',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar cancelación
    if (this.isCancellation(lowerInput, language)) {
      return {
        intent: 'cancellation',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'neutral',
        urgency: 'normal',
        next_step: 'cancelled',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar despedidas
    if (this.isGoodbye(lowerInput, language)) {
      return {
        intent: 'goodbye',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'positive',
        urgency: 'low',
        next_step: 'complete',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Detectar frustración
    if (this.isFrustrated(lowerInput, language)) {
      return {
        intent: 'complaint',
        confidence: 0.9,
        extracted_data: {},
        sentiment: 'frustrated',
        urgency: 'high',
        next_step: currentStep,
        response_type: 'clarification',
        needs_clarification: true,
        clarification_question: this.getFrustratedResponse(language)
      };
    }
    
    // Detectar confusión
    if (this.isConfused(lowerInput, language)) {
      return {
        intent: 'clarification',
        confidence: 0.8,
        extracted_data: {},
        sentiment: 'confused',
        urgency: 'normal',
        next_step: currentStep,
        response_type: 'question',
        needs_clarification: true,
        clarification_question: this.getConfusedResponse(language)
      };
    }
    
    // Extraer datos según el paso actual
    const extractedData = this.extractDataHardcoded(userInput, currentStep, language);
    
    if (Object.keys(extractedData).length > 0) {
      return {
        intent: 'reservation',
        confidence: 0.8,
        extracted_data: extractedData,
        sentiment: 'positive',
        urgency: 'normal',
        next_step: this.getNextStep(currentStep, extractedData),
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
    
    // Si no se detecta nada específico
    return {
      intent: 'clarification',
      confidence: 0.5,
      extracted_data: {},
      sentiment: 'neutral',
      urgency: 'normal',
      next_step: currentStep,
      response_type: 'question',
      needs_clarification: true,
      clarification_question: this.getClarificationResponse(currentStep, language)
    };
  }
  
  // Detectar saludos por idioma
  static isGreeting(input, language) {
    const greetings = {
      es: ['hola', 'buenos días', 'buenas tardes', 'buenas noches', 'hey', 'hi'],
      en: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'],
      de: ['hallo', 'guten tag', 'guten morgen', 'guten abend', 'hey'],
      it: ['ciao', 'buongiorno', 'buonasera', 'salve', 'hey'],
      fr: ['bonjour', 'salut', 'bonsoir', 'hey'],
      pt: ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hey']
    };
    
    return greetings[language]?.some(greeting => input.includes(greeting)) || false;
  }
  
  // Detectar solicitudes de reserva por idioma
  static isReservationRequest(input, language) {
    const reservationRequests = {
      es: ['reserva', 'reservar', 'mesa', 'comer', 'cenar', 'almorzar', 'quiero', 'necesito', 'hacer una reserva', 'reservar mesa'],
      en: ['reservation', 'reserve', 'table', 'eat', 'dinner', 'lunch', 'want', 'need', 'make a reservation', 'book a table'],
      de: ['reservierung', 'reservieren', 'tisch', 'essen', 'abendessen', 'mittagessen', 'möchte', 'brauche', 'reservierung machen'],
      it: ['prenotazione', 'prenotare', 'tavolo', 'mangiare', 'cena', 'pranzo', 'voglio', 'ho bisogno', 'fare una prenotazione'],
      fr: ['réservation', 'réserver', 'table', 'manger', 'dîner', 'déjeuner', 'veux', 'besoin', 'faire une réservation'],
      pt: ['reserva', 'reservar', 'mesa', 'comer', 'jantar', 'almoçar', 'quero', 'preciso', 'fazer uma reserva']
    };
    
    return reservationRequests[language]?.some(request => input.includes(request)) || false;
  }
  
  // Detectar cancelaciones por idioma
  static isCancellation(input, language) {
    const cancellations = {
      es: ['cancelar', 'cancelación', 'anular', 'no quiero', 'no necesito', 'quiero cancelar', 'cancelar reserva'],
      en: ['cancel', 'cancellation', 'cancel reservation', 'don\'t want', 'don\'t need', 'want to cancel'],
      de: ['stornieren', 'stornierung', 'abbrechen', 'nicht wollen', 'nicht brauchen', 'reservierung stornieren'],
      it: ['cancellare', 'cancellazione', 'annullare', 'non voglio', 'non ho bisogno', 'cancellare prenotazione'],
      fr: ['annuler', 'annulation', 'annuler réservation', 'ne veux pas', 'n\'ai pas besoin', 'vouloir annuler'],
      pt: ['cancelar', 'cancelamento', 'anular', 'não quero', 'não preciso', 'cancelar reserva']
    };
    
    return cancellations[language]?.some(cancellation => input.includes(cancellation)) || false;
  }
  
  // Detectar despedidas por idioma
  static isGoodbye(input, language) {
    const goodbyes = {
      es: ['gracias', 'hasta luego', 'adiós', 'chao', 'bye', 'thanks'],
      en: ['thank you', 'thanks', 'bye', 'goodbye', 'see you'],
      de: ['danke', 'tschüss', 'auf wiedersehen', 'bye'],
      it: ['grazie', 'arrivederci', 'ciao', 'bye'],
      fr: ['merci', 'au revoir', 'à bientôt', 'bye'],
      pt: ['obrigado', 'obrigada', 'tchau', 'até logo', 'bye']
    };
    
    return goodbyes[language]?.some(goodbye => input.includes(goodbye)) || false;
  }
  
  // Detectar frustración por idioma
  static isFrustrated(input, language) {
    const frustrated = {
      es: ['frustrado', 'molesto', 'enojado', 'complicado', 'difícil', 'problema'],
      en: ['frustrated', 'angry', 'annoyed', 'complicated', 'difficult', 'problem'],
      de: ['frustriert', 'ärgerlich', 'kompliziert', 'schwierig', 'problem'],
      it: ['frustrato', 'arrabbiato', 'complicato', 'difficile', 'problema'],
      fr: ['frustré', 'énervé', 'compliqué', 'difficile', 'problème'],
      pt: ['frustrado', 'irritado', 'complicado', 'difícil', 'problema']
    };
    
    return frustrated[language]?.some(word => input.includes(word)) || false;
  }
  
  // Detectar confusión por idioma
  static isConfused(input, language) {
    const confused = {
      es: ['no entiendo', 'confundido', 'qué necesito', 'no sé', 'ayuda'],
      en: ['don\'t understand', 'confused', 'what do i need', 'don\'t know', 'help'],
      de: ['verstehe nicht', 'verwirrt', 'was brauche ich', 'weiß nicht', 'hilfe'],
      it: ['non capisco', 'confuso', 'cosa serve', 'non so', 'aiuto'],
      fr: ['ne comprends pas', 'confus', 'que faut-il', 'ne sais pas', 'aide'],
      pt: ['não entendo', 'confuso', 'o que preciso', 'não sei', 'ajuda']
    };
    
    return confused[language]?.some(word => input.includes(word)) || false;
  }
  
  // Extraer datos hardcodeado por idioma
  static extractDataHardcoded(userInput, currentStep, language) {
    const data = {};
    
    // Extraer número de personas
    if (currentStep === 'greeting' || currentStep === 'ask_people') {
      const people = this.extractPeople(userInput, language);
      if (people) data.people = people;
    }
    
    // Extraer fecha
    if (currentStep === 'ask_people' || currentStep === 'ask_date') {
      const date = this.extractDate(userInput, language);
      if (date) data.date = date;
    }
    
    // Extraer hora
    if (currentStep === 'ask_date' || currentStep === 'ask_time') {
      const time = this.extractTime(userInput, language);
      if (time) data.time = time;
    }
    
    // Extraer nombre
    if (currentStep === 'ask_time' || currentStep === 'ask_name') {
      const name = this.extractName(userInput, language);
      if (name) data.name = name;
    }
    
    return data;
  }
  
  // Extraer número de personas
  static extractPeople(input, language) {
    // Buscar números del 1 al 20
    const numbers = input.match(/\b(\d+)\b/g);
    if (numbers) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 20) return num;
    }
    
    // Palabras específicas por idioma
    const peopleWords = {
      es: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'],
      en: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
      de: ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'],
      it: ['uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci'],
      fr: ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'],
      pt: ['um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez']
    };
    
    const words = peopleWords[language] || [];
    for (let i = 0; i < words.length; i++) {
      if (input.includes(words[i])) return i + 1;
    }
    
    return null;
  }
  
  // Extraer fecha - SISTEMA SÚPER ROBUSTO
  static extractDate(input, language) {
    console.log(`[EXTRACCION] Extrayendo fecha de: "${input}"`);
    
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
    
    // Fechas relativas exhaustivas en todos los idiomas
    const relativeDates = {
      // ESPAÑOL
      'hoy': today, 'mañana': tomorrow, 'pasado mañana': dayAfterTomorrow,
      'esta noche': today, 'mañana por la noche': tomorrow,
      'el lunes': this.getNextWeekday(1), 'el martes': this.getNextWeekday(2),
      'el miércoles': this.getNextWeekday(3), 'el jueves': this.getNextWeekday(4),
      'el viernes': this.getNextWeekday(5), 'el sábado': this.getNextWeekday(6), 'el domingo': this.getNextWeekday(0),
      'el próximo lunes': this.getNextWeekday(1), 'el próximo martes': this.getNextWeekday(2),
      'el próximo miércoles': this.getNextWeekday(3), 'el próximo jueves': this.getNextWeekday(4),
      'el próximo viernes': this.getNextWeekday(5), 'el próximo sábado': this.getNextWeekday(6), 'el próximo domingo': this.getNextWeekday(0),
      
      // INGLÉS
      'today': today, 'tomorrow': tomorrow, 'day after tomorrow': dayAfterTomorrow,
      'tonight': today, 'tomorrow night': tomorrow,
      'monday': this.getNextWeekday(1), 'tuesday': this.getNextWeekday(2),
      'wednesday': this.getNextWeekday(3), 'thursday': this.getNextWeekday(4),
      'friday': this.getNextWeekday(5), 'saturday': this.getNextWeekday(6), 'sunday': this.getNextWeekday(0),
      'next monday': this.getNextWeekday(1), 'next tuesday': this.getNextWeekday(2),
      'next wednesday': this.getNextWeekday(3), 'next thursday': this.getNextWeekday(4),
      'next friday': this.getNextWeekday(5), 'next saturday': this.getNextWeekday(6), 'next sunday': this.getNextWeekday(0),
      
      // ALEMÁN
      'heute': today, 'morgen': tomorrow, 'übermorgen': dayAfterTomorrow,
      'heute abend': today, 'morgen abend': tomorrow,
      'montag': this.getNextWeekday(1), 'dienstag': this.getNextWeekday(2),
      'mittwoch': this.getNextWeekday(3), 'donnerstag': this.getNextWeekday(4),
      'freitag': this.getNextWeekday(5), 'samstag': this.getNextWeekday(6), 'sonntag': this.getNextWeekday(0),
      'nächster montag': this.getNextWeekday(1), 'nächster dienstag': this.getNextWeekday(2),
      'nächster mittwoch': this.getNextWeekday(3), 'nächster donnerstag': this.getNextWeekday(4),
      'nächster freitag': this.getNextWeekday(5), 'nächster samstag': this.getNextWeekday(6), 'nächster sonntag': this.getNextWeekday(0),
      
      // ITALIANO
      'oggi': today, 'domani': tomorrow, 'dopodomani': dayAfterTomorrow,
      'stasera': today, 'domani sera': tomorrow,
      'lunedì': this.getNextWeekday(1), 'martedì': this.getNextWeekday(2),
      'mercoledì': this.getNextWeekday(3), 'giovedì': this.getNextWeekday(4),
      'venerdì': this.getNextWeekday(5), 'sabato': this.getNextWeekday(6), 'domenica': this.getNextWeekday(0),
      'prossimo lunedì': this.getNextWeekday(1), 'prossimo martedì': this.getNextWeekday(2),
      'prossimo mercoledì': this.getNextWeekday(3), 'prossimo giovedì': this.getNextWeekday(4),
      'prossimo venerdì': this.getNextWeekday(5), 'prossimo sabato': this.getNextWeekday(6), 'prossimo domenica': this.getNextWeekday(0),
      
      // FRANCÉS
      'aujourd\'hui': today, 'demain': tomorrow, 'après-demain': dayAfterTomorrow,
      'ce soir': today, 'demain soir': tomorrow,
      'lundi': this.getNextWeekday(1), 'mardi': this.getNextWeekday(2),
      'mercredi': this.getNextWeekday(3), 'jeudi': this.getNextWeekday(4),
      'vendredi': this.getNextWeekday(5), 'samedi': this.getNextWeekday(6), 'dimanche': this.getNextWeekday(0),
      'prochain lundi': this.getNextWeekday(1), 'prochain mardi': this.getNextWeekday(2),
      'prochain mercredi': this.getNextWeekday(3), 'prochain jeudi': this.getNextWeekday(4),
      'prochain vendredi': this.getNextWeekday(5), 'prochain samedi': this.getNextWeekday(6), 'prochain dimanche': this.getNextWeekday(0),
      
      // PORTUGUÉS
      'hoje': today, 'amanhã': tomorrow, 'depois de amanhã': dayAfterTomorrow,
      'hoje à noite': today, 'amanhã à noite': tomorrow,
      'segunda': this.getNextWeekday(1), 'terça': this.getNextWeekday(2),
      'quarta': this.getNextWeekday(3), 'quinta': this.getNextWeekday(4),
      'sexta': this.getNextWeekday(5), 'sábado': this.getNextWeekday(6), 'domingo': this.getNextWeekday(0),
      'próxima segunda': this.getNextWeekday(1), 'próxima terça': this.getNextWeekday(2),
      'próxima quarta': this.getNextWeekday(3), 'próxima quinta': this.getNextWeekday(4),
      'próxima sexta': this.getNextWeekday(5), 'próximo sábado': this.getNextWeekday(6), 'próximo domingo': this.getNextWeekday(0)
    };
    
    // Buscar fechas relativas
    for (const [phrase, date] of Object.entries(relativeDates)) {
      if (input.toLowerCase().includes(phrase)) {
        const result = date.toISOString().split('T')[0];
        console.log(`[EXTRACCION] Fecha detectada: ${phrase} = ${result}`);
        return result;
      }
    }
    
    // Buscar fechas específicas (DD/MM/YYYY, MM/DD/YYYY, etc.)
    const datePatterns = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
      /(\d{4})-(\d{1,2})-(\d{1,2})/g,
      /(\d{1,2}) de (\w+) de (\d{4})/gi
    ];
    
    for (const pattern of datePatterns) {
      const match = input.match(pattern);
      if (match) {
        console.log(`[EXTRACCION] Fecha específica encontrada: ${match[0]}`);
        // Aquí podrías parsear la fecha específica
        return match[0]; // Por ahora devolvemos el texto encontrado
      }
    }
    
    console.log(`[EXTRACCION] No se encontró fecha`);
    return null;
  }
  
  // Función auxiliar para obtener el próximo día de la semana
  static getNextWeekday(weekday) {
    const today = new Date();
    const daysUntilTarget = (weekday - today.getDay() + 7) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
    return targetDate;
  }
  
  // Extraer hora - SISTEMA SÚPER ROBUSTO
  static extractTime(input, language) {
    console.log(`[EXTRACCION] Extrayendo hora de: "${input}"`);
    
    // Patrones de hora exhaustivos
    const timePatterns = [
      // Formato 24h
      /(\d{1,2}):(\d{2})/g,
      /(\d{1,2})\.(\d{2})/g,
      /(\d{1,2})\s+(\d{2})/g,
      
      // Formato 12h con AM/PM
      /(\d{1,2})\s*(am|pm|AM|PM)/g,
      /(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)/g,
      
      // Formato 12h con palabras
      /(\d{1,2})\s*(de la mañana|de la tarde|de la noche)/gi,
      /(\d{1,2}):(\d{2})\s*(de la mañana|de la tarde|de la noche)/gi
    ];
    
    // Horas en palabras en todos los idiomas
    const wordTimes = {
      // ESPAÑOL
      'mediodía': '12:00', 'medianoche': '00:00',
      'una': '01:00', 'dos': '02:00', 'tres': '03:00', 'cuatro': '04:00',
      'cinco': '05:00', 'seis': '06:00', 'siete': '07:00', 'ocho': '08:00',
      'nueve': '09:00', 'diez': '10:00', 'once': '11:00', 'doce': '12:00',
      'una de la tarde': '13:00', 'dos de la tarde': '14:00', 'tres de la tarde': '15:00',
      'cuatro de la tarde': '16:00', 'cinco de la tarde': '17:00', 'seis de la tarde': '18:00',
      'siete de la noche': '19:00', 'ocho de la noche': '20:00', 'nueve de la noche': '21:00',
      'diez de la noche': '22:00', 'once de la noche': '23:00',
      
      // INGLÉS
      'noon': '12:00', 'midnight': '00:00',
      'one': '01:00', 'two': '02:00', 'three': '03:00', 'four': '04:00',
      'five': '05:00', 'six': '06:00', 'seven': '07:00', 'eight': '08:00',
      'nine': '09:00', 'ten': '10:00', 'eleven': '11:00', 'twelve': '12:00',
      'one pm': '13:00', 'two pm': '14:00', 'three pm': '15:00', 'four pm': '16:00',
      'five pm': '17:00', 'six pm': '18:00', 'seven pm': '19:00', 'eight pm': '20:00',
      'nine pm': '21:00', 'ten pm': '22:00', 'eleven pm': '23:00',
      
      // ALEMÁN
      'mittag': '12:00', 'mitternacht': '00:00',
      'eins': '01:00', 'zwei': '02:00', 'drei': '03:00', 'vier': '04:00',
      'fünf': '05:00', 'sechs': '06:00', 'sieben': '07:00', 'acht': '08:00',
      'neun': '09:00', 'zehn': '10:00', 'elf': '11:00', 'zwölf': '12:00',
      
      // ITALIANO
      'mezzogiorno': '12:00', 'mezzanotte': '00:00',
      'una': '01:00', 'due': '02:00', 'tre': '03:00', 'quattro': '04:00',
      'cinque': '05:00', 'sei': '06:00', 'sette': '07:00', 'otto': '08:00',
      'nove': '09:00', 'dieci': '10:00', 'undici': '11:00', 'dodici': '12:00',
      
      // FRANCÉS
      'midi': '12:00', 'minuit': '00:00',
      'une': '01:00', 'deux': '02:00', 'trois': '03:00', 'quatre': '04:00',
      'cinq': '05:00', 'six': '06:00', 'sept': '07:00', 'huit': '08:00',
      'neuf': '09:00', 'dix': '10:00', 'onze': '11:00', 'douze': '12:00',
      
      // PORTUGUÉS
      'meio-dia': '12:00', 'meia-noite': '00:00',
      'uma': '01:00', 'duas': '02:00', 'três': '03:00', 'quatro': '04:00',
      'cinco': '05:00', 'seis': '06:00', 'sete': '07:00', 'oito': '08:00',
      'nove': '09:00', 'dez': '10:00', 'onze': '11:00', 'doze': '12:00'
    };
    
    // Buscar horas en palabras
    for (const [word, time] of Object.entries(wordTimes)) {
      if (input.toLowerCase().includes(word)) {
        console.log(`[EXTRACCION] Hora en palabras detectada: ${word} = ${time}`);
        return time;
      }
    }
    
    // Buscar patrones de hora
    for (const pattern of timePatterns) {
      const match = input.match(pattern);
      if (match) {
        let hour = parseInt(match[1]);
        const minute = match[2] ? parseInt(match[2]) : 0;
        const period = match[3];
        
        // Convertir AM/PM a 24h
        if (period) {
          const periodLower = period.toLowerCase();
          if (periodLower === 'pm' && hour < 12) {
            hour += 12;
          } else if (periodLower === 'am' && hour === 12) {
            hour = 0;
          }
        }
        
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        console.log(`[EXTRACCION] Hora detectada: ${time}`);
        return time;
      }
    }
    
    console.log(`[EXTRACCION] No se encontró hora`);
    return null;
  }
  
  // Extraer nombre
  static extractName(input, language) {
    const namePatterns = {
      es: [/me llamo (\w+)/i, /mi nombre es (\w+)/i, /soy (\w+)/i],
      en: [/my name is (\w+)/i, /i'm (\w+)/i, /i am (\w+)/i],
      de: [/ich heiße (\w+)/i, /mein name ist (\w+)/i, /ich bin (\w+)/i],
      it: [/mi chiamo (\w+)/i, /il mio nome è (\w+)/i, /sono (\w+)/i],
      fr: [/je m'appelle (\w+)/i, /mon nom est (\w+)/i, /je suis (\w+)/i],
      pt: [/meu nome é (\w+)/i, /me chamo (\w+)/i, /sou (\w+)/i]
    };
    
    const patterns = namePatterns[language] || [];
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }
  
  // Obtener siguiente paso
  static getNextStep(currentStep, extractedData) {
    if (extractedData.people && currentStep === 'greeting') return 'ask_date';
    if (extractedData.date && currentStep === 'ask_people') return 'ask_time';
    if (extractedData.time && currentStep === 'ask_date') return 'ask_name';
    if (extractedData.name && currentStep === 'ask_time') return 'ask_phone';
    if (currentStep === 'ask_phone') return 'complete';
    return currentStep;
  }
  
  // Respuestas hardcodeadas optimizadas por idioma
  static getResponse(step, language, intentAnalysis = null) {
    const responses = {
      greeting: {
        es: [
          '¡Hola! Bienvenido a nuestro restaurante. ¿En qué le puedo ayudar?',
          '¡Buenos días! ¿En qué puedo ayudarle hoy?',
          '¡Hola! ¿Cómo puedo asistirle?',
          '¡Saludos! ¿En qué le puedo servir?',
          '¡Hola! ¿Qué puedo hacer por usted?'
        ],
        en: [
          'Hello! Welcome to our restaurant. How can I help you?',
          'Good day! How can I assist you today?',
          'Hi there! How can I help you?',
          'Hello! What can I do for you?',
          'Good morning! How can I be of service?'
        ],
        de: [
          'Hallo! Willkommen in unserem Restaurant. Womit kann ich Ihnen helfen?',
          'Guten Tag! Wie kann ich Ihnen heute helfen?',
          'Hallo! Wie kann ich Ihnen behilflich sein?',
          'Guten Morgen! Womit kann ich Ihnen dienen?',
          'Hallo! Was kann ich für Sie tun?'
        ],
        it: [
          'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarla?',
          'Buongiorno! Come posso assisterla oggi?',
          'Ciao! Come posso aiutarla?',
          'Salve! Cosa posso fare per lei?',
          'Buongiorno! Come posso esserle utile?'
        ],
        fr: [
          'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
          'Bonjour! Comment puis-je vous assister aujourd\'hui?',
          'Salut! Comment puis-je vous aider?',
          'Bonjour! Que puis-je faire pour vous?',
          'Bonjour! Comment puis-je vous être utile?'
        ],
        pt: [
          'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?',
          'Bom dia! Como posso ajudá-lo hoje?',
          'Oi! Como posso ajudá-lo?',
          'Olá! O que posso fazer por você?',
          'Bom dia! Como posso ser útil?'
        ]
      },
      waiting_for_request: {
        es: [
          '¿En qué le puedo ayudar?',
          '¿Cómo puedo asistirle?',
          '¿Qué puedo hacer por usted?',
          '¿En qué le puedo servir?',
          '¿Cómo puedo ayudarle?'
        ],
        en: [
          'How can I help you?',
          'How can I assist you?',
          'What can I do for you?',
          'How can I be of service?',
          'What can I help you with?'
        ],
        de: [
          'Womit kann ich Ihnen helfen?',
          'Wie kann ich Ihnen behilflich sein?',
          'Was kann ich für Sie tun?',
          'Womit kann ich Ihnen dienen?',
          'Wie kann ich Ihnen helfen?'
        ],
        it: [
          'Come posso aiutarla?',
          'Come posso assisterla?',
          'Cosa posso fare per lei?',
          'Come posso esserle utile?',
          'Come posso aiutarla?'
        ],
        fr: [
          'Comment puis-je vous aider?',
          'Comment puis-je vous assister?',
          'Que puis-je faire pour vous?',
          'Comment puis-je vous être utile?',
          'Comment puis-je vous aider?'
        ],
        pt: [
          'Como posso ajudá-lo?',
          'Como posso assisti-lo?',
          'O que posso fazer por você?',
          'Como posso ser útil?',
          'Como posso ajudá-lo?'
        ]
      },
      ask_people: {
        es: [
          '¿Para cuántas personas será la reserva?',
          '¿Cuántas personas serán?',
          '¿Para cuántos comensales?',
          '¿Cuántas personas en su grupo?',
          '¿Para cuántas personas necesitan mesa?'
        ],
        en: [
          'How many people will the reservation be for?',
          'How many guests will be dining?',
          'How many people in your party?',
          'How many diners will we have?',
          'How many people for the reservation?'
        ],
        de: [
          'Für wie viele Personen soll die Reservierung sein?',
          'Wie viele Gäste werden es sein?',
          'Für wie viele Personen?',
          'Wie viele Personen in Ihrer Gruppe?',
          'Für wie viele Gäste reservieren Sie?'
        ],
        it: [
          'Per quante persone sarà la prenotazione?',
          'Quanti ospiti saranno?',
          'Per quante persone?',
          'Quanti ospiti nel vostro gruppo?',
          'Per quanti ospiti prenotate?'
        ],
        fr: [
          'Pour combien de personnes sera la réservation?',
          'Combien d\'invités seront là?',
          'Pour combien de personnes?',
          'Combien de personnes dans votre groupe?',
          'Pour combien d\'invités réservez-vous?'
        ],
        pt: [
          'Para quantas pessoas será a reserva?',
          'Quantos convidados serão?',
          'Para quantas pessoas?',
          'Quantas pessoas no seu grupo?',
          'Para quantos convidados está reservando?'
        ]
      },
      ask_date: {
        es: '¿Para qué fecha necesita la reserva?',
        en: 'What date do you need the reservation for?',
        de: 'Für welches Datum benötigen Sie die Reservierung?',
        it: 'Per quale data avete bisogno della prenotazione?',
        fr: 'Pour quelle date avez-vous besoin de la réservation?',
        pt: 'Para que data vocês precisam da reserva?'
      },
      ask_time: {
        es: '¿A qué hora prefieren venir?',
        en: 'What time would you prefer to come?',
        de: 'Um welche Uhrzeit möchten Sie kommen?',
        it: 'A che ora preferite venire?',
        fr: 'À quelle heure préférez-vous venir?',
        pt: 'Que horas preferem vir?'
      },
      ask_name: {
        es: '¿Cómo se llama?',
        en: 'What\'s your name?',
        de: 'Wie heißen Sie?',
        it: 'Come si chiama?',
        fr: 'Comment vous appelez-vous?',
        pt: 'Como se chama?'
      },
      ask_phone: {
        es: '¿Podría confirmar su número de teléfono?',
        en: 'Could you confirm your phone number?',
        de: 'Könnten Sie Ihre Telefonnummer bestätigen?',
        it: 'Potrebbe confermare il suo numero di telefono?',
        fr: 'Pourriez-vous confirmer votre numéro de téléphone?',
        pt: 'Poderia confirmar o seu número de telefone?'
      },
      complete: {
        es: '¡Perfecto! Su reserva está confirmada. ¡Que disfruten!',
        en: 'Perfect! Your reservation is confirmed. Enjoy!',
        de: 'Perfekt! Ihre Reservierung ist bestätigt. Viel Spaß!',
        it: 'Perfetto! La sua prenotazione è confermata. Buon appetito!',
        fr: 'Parfait! Votre réservation est confirmée. Bon appétit!',
        pt: 'Perfeito! Sua reserva está confirmada. Bom apetite!'
      },
      cancelled: {
        es: [
          'Perfecto. La reserva ha sido cancelada. ¡Gracias por llamar!',
          'Entendido. Reserva cancelada. ¡Que tenga un buen día!',
          'Perfecto. Cancelación confirmada. ¡Gracias por contactarnos!',
          'De acuerdo. La reserva ha sido anulada. ¡Hasta luego!',
          'Perfecto. Reserva cancelada exitosamente. ¡Gracias!'
        ],
        en: [
          'Perfect. The reservation has been cancelled. Thank you for calling!',
          'Understood. Reservation cancelled. Have a great day!',
          'Perfect. Cancellation confirmed. Thank you for contacting us!',
          'Okay. The reservation has been cancelled. Goodbye!',
          'Perfect. Reservation cancelled successfully. Thank you!'
        ],
        de: [
          'Perfekt. Die Reservierung wurde storniert. Vielen Dank für den Anruf!',
          'Verstanden. Reservierung storniert. Haben Sie einen schönen Tag!',
          'Perfekt. Stornierung bestätigt. Vielen Dank für Ihren Anruf!',
          'In Ordnung. Die Reservierung wurde storniert. Auf Wiedersehen!',
          'Perfekt. Reservierung erfolgreich storniert. Vielen Dank!'
        ],
        it: [
          'Perfetto. La prenotazione è stata cancellata. Grazie per la chiamata!',
          'Capito. Prenotazione cancellata. Buona giornata!',
          'Perfetto. Cancellazione confermata. Grazie per averci contattato!',
          'Va bene. La prenotazione è stata annullata. Arrivederci!',
          'Perfetto. Prenotazione cancellata con successo. Grazie!'
        ],
        fr: [
          'Parfait. La réservation a été annulée. Merci d\'avoir appelé!',
          'Compris. Réservation annulée. Passez une bonne journée!',
          'Parfait. Annulation confirmée. Merci de nous avoir contactés!',
          'D\'accord. La réservation a été annulée. Au revoir!',
          'Parfait. Réservation annulée avec succès. Merci!'
        ],
        pt: [
          'Perfeito. A reserva foi cancelada. Obrigado por ligar!',
          'Entendido. Reserva cancelada. Tenha um ótimo dia!',
          'Perfeito. Cancelamento confirmado. Obrigado por nos contatar!',
          'Ok. A reserva foi cancelada. Tchau!',
          'Perfeito. Reserva cancelada com sucesso. Obrigado!'
        ]
      }
    };
    
    // Si hay una pregunta de aclaración específica, usarla
    if (intentAnalysis && intentAnalysis.clarification_question) {
      return intentAnalysis.clarification_question;
    }
    
    const responseArray = responses[step]?.[language] || responses[step]?.['es'];
    if (Array.isArray(responseArray)) {
      const selected = responseArray[Math.floor(Math.random() * responseArray.length)];
      console.log(`[RESPUESTA] Seleccionada: "${selected}"`);
      return selected;
    }
    return responseArray || '¿En qué puedo ayudarle?';
  }
  
  // Respuestas para frustración
  static getFrustratedResponse(language) {
    const responses = {
      es: 'Entiendo su frustración. Le ayudo paso a paso. ¿Para cuántas personas será la reserva?',
      en: 'I understand your frustration. Let me help you step by step. How many people will the reservation be for?',
      de: 'Ich verstehe Ihre Frustration. Lassen Sie mich Ihnen Schritt für Schritt helfen. Für wie viele Personen soll die Reservierung sein?',
      it: 'Capisco la sua frustrazione. La aiuto passo dopo passo. Per quante persone sarà la prenotazione?',
      fr: 'Je comprends votre frustration. Laissez-moi vous aider étape par étape. Pour combien de personnes sera la réservation?',
      pt: 'Entendo sua frustração. Deixe-me ajudá-lo passo a passo. Para quantas pessoas será a reserva?'
    };
    
    return responses[language] || responses['es'];
  }
  
  // Respuestas para confusión
  static getConfusedResponse(language) {
    const responses = {
      es: 'No se preocupe, le ayudo paso a paso. ¿Para cuántas personas será la reserva?',
      en: 'Don\'t worry, I\'ll help you step by step. How many people will the reservation be for?',
      de: 'Keine Sorge, ich helfe Ihnen Schritt für Schritt. Für wie viele Personen soll die Reservierung sein?',
      it: 'Non si preoccupi, la aiuto passo dopo passo. Per quante persone sarà la prenotazione?',
      fr: 'Ne vous inquiétez pas, je vous aide étape par étape. Pour combien de personnes sera la réservation?',
      pt: 'Não se preocupe, vou ajudá-lo passo a passo. Para quantas pessoas será a reserva?'
    };
    
    return responses[language] || responses['es'];
  }
  
  // Respuestas de aclaración por paso
  static getClarificationResponse(step, language) {
    const responses = {
      greeting: {
        es: '¿En qué le puedo ayudar?',
        en: 'How can I help you?',
        de: 'Womit kann ich Ihnen helfen?',
        it: 'Come posso aiutarla?',
        fr: 'Comment puis-je vous aider?',
        pt: 'Como posso ajudá-lo?'
      },
      waiting_for_request: {
        es: '¿En qué le puedo ayudar?',
        en: 'How can I help you?',
        de: 'Womit kann ich Ihnen helfen?',
        it: 'Come posso aiutarla?',
        fr: 'Comment puis-je vous aider?',
        pt: 'Como posso ajudá-lo?'
      },
      ask_people: {
        es: 'Por favor, dígame cuántas personas serán.',
        en: 'Please tell me how many people will be coming.',
        de: 'Bitte sagen Sie mir, für wie viele Personen.',
        it: 'Per favore, dimmi per quante persone.',
        fr: 'Veuillez me dire pour combien de personnes.',
        pt: 'Por favor, me diga para quantas pessoas.'
      },
      ask_date: {
        es: '¿Para qué fecha necesita la reserva?',
        en: 'What date do you need the reservation for?',
        de: 'Für welches Datum benötigen Sie die Reservierung?',
        it: 'Per quale data avete bisogno della prenotazione?',
        fr: 'Pour quelle date avez-vous besoin de la réservation?',
        pt: 'Para que data vocês precisam da reserva?'
      },
      ask_time: {
        es: '¿A qué hora prefieren venir?',
        en: 'What time would you prefer to come?',
        de: 'Um welche Uhrzeit möchten Sie kommen?',
        it: 'A che ora preferite venire?',
        fr: 'À quelle heure préférez-vous venir?',
        pt: 'Que horas preferem vir?'
      },
      ask_name: {
        es: '¿Cómo se llama?',
        en: 'What\'s your name?',
        de: 'Wie heißen Sie?',
        it: 'Come si chiama?',
        fr: 'Comment vous appelez-vous?',
        pt: 'Como se chama?'
      }
    };
    
    return responses[step]?.[language] || responses[step]?.['es'] || '¿Podría repetir eso, por favor?';
  }
}

// Guardar reserva (igual que antes)
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
    if (!state.data.people || !state.data.date || !state.data.time || !state.data.name) {
      console.error('[ERROR] Datos incompletos para guardar reserva');
      return false;
    }
    
    const connection = await createConnection();
    await connection.beginTransaction();
    
    try {
      // Insertar cliente
      await connection.execute(`
        INSERT INTO CLIENT (NOM_COMPLET, TELEFON, DATA_ULTIMA_RESERVA) 
        VALUES (?, ?, NOW()) 
        ON DUPLICATE KEY UPDATE 
          NOM_COMPLET = VALUES(NOM_COMPLET), 
          DATA_ULTIMA_RESERVA = NOW()
      `, [state.data.name, state.data.phone]);
      
      console.log('[GUARDAR] Cliente insertado/actualizado');
      
      // Insertar reserva
      const fechaCompleta = combinarFechaHora(state.data.date, state.data.time);
      await connection.execute(`
        INSERT INTO RESERVA 
        (data_reserva, num_persones, telefon, nom_persona_reserva, observacions, conversa_completa) 
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        fechaCompleta,
        state.data.people,
        state.data.phone,
        state.data.name,
        'Reserva por teléfono - Sistema Híbrido Vercel',
        JSON.stringify(state.conversationHistory)
      ]);
      
      await connection.commit();
      await connection.end();
      
      console.log('[GUARDAR] ✅ Reserva guardada exitosamente');
      return true;
      
    } catch (error) {
      await connection.rollback();
      await connection.end();
      throw error;
    }
    
  } catch (error) {
    console.error('[ERROR] Error guardando reserva:', error);
    return false;
  }
}

// Generar TwiML con configuración de idioma correcta
function generateTwiML(message, language = 'es') {
  console.log(`[TwiML] Generando para idioma: ${language}`);
  
  // Configuración de voz optimizada por idioma
  const voiceConfig = {
    es: { voice: 'Polly.Lupe', language: 'es-ES' },
    en: { voice: 'Polly.Joanna', language: 'en-US' },
    de: { voice: 'Polly.Marlene', language: 'de-DE' },
    it: { voice: 'Polly.Carla', language: 'it-IT' },
    fr: { voice: 'Polly.Celine', language: 'fr-FR' },
    pt: { voice: 'Polly.Camila', language: 'pt-BR' }
  };
  
  const config = voiceConfig[language] || voiceConfig.es;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${config.voice}" language="${config.language}">
    ${message}
  </Say>
  <Gather input="speech" language="${config.language}" timeout="8" speechTimeout="5" action="/api/twilio-call-hybrid-vercel" method="POST">
  </Gather>
  <Say voice="${config.voice}" language="${config.language}">
    ${getTimeoutMessage(language)}
  </Say>
  <Hangup/>
</Response>`;
}

// Mensajes de espera por idioma
function getWaitMessage(language) {
  const messages = {
    es: 'Por favor, responda.',
    en: 'Please respond.',
    de: 'Bitte antworten Sie.',
    it: 'Per favore, rispondi.',
    fr: 'Veuillez répondre.',
    pt: 'Por favor, responda.'
  };
  return messages[language] || messages.es;
}

// Mensajes de timeout por idioma
function getTimeoutMessage(language) {
  const messages = {
    es: 'No he recibido respuesta. Gracias por llamar.',
    en: 'I haven\'t received a response. Thank you for calling.',
    de: 'Ich habe keine Antwort erhalten. Vielen Dank für den Anruf.',
    it: 'Non ho ricevuto una risposta. Grazie per la chiamata.',
    fr: 'Je n\'ai pas reçu de réponse. Merci d\'avoir appelé.',
    pt: 'Não recebi uma resposta. Obrigado por ligar.'
  };
  return messages[language] || messages.es;
}

// Handler principal híbrido optimizado para Vercel
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  const startTime = Date.now();
  console.log(`[CALL_START] ${From}: "${userInput}"`);
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  console.log(`[LLAMADA] Timestamp: ${new Date().toISOString()}`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    data: {},
    conversationHistory: [],
    retryCount: 0,
    maxRetries: 3
  };
  
  // Detectar idioma SOLO si no está detectado
  if (!state.language && userInput) {
    state.language = await HybridSystem.detectLanguageOnce(userInput, From);
    console.log(`[IDIOMA] Idioma detectado: ${state.language}`);
  }
  
  if (!state.language) {
    state.language = 'es';
  }
  
  // Análisis de intención HARDCODEADO (sin Gemini)
  let intentAnalysis;
  if (userInput) {
    intentAnalysis = HybridSystem.analyzeIntentHardcoded(userInput, state.step, state.language);
    console.log(`[INTENT] ${From}: ${intentAnalysis.intent} (${intentAnalysis.confidence})`);
    console.log(`[ANÁLISIS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
  } else {
    intentAnalysis = {
      intent: 'greeting',
      confidence: 1.0,
      extracted_data: {},
      sentiment: 'positive',
      urgency: 'normal',
      next_step: 'ask_people',
      response_type: 'question',
      needs_clarification: false,
      clarification_question: null
    };
  }
  
  // Procesar datos extraídos
  if (intentAnalysis.extracted_data) {
    const { people, date, time, name, phone } = intentAnalysis.extracted_data;
    
    console.log(`[DATA] ${From}: Extraídos ${Object.keys(intentAnalysis.extracted_data).length} campos`);
    
    if (people && !state.data.people) {
      state.data.people = people;
      console.log(`[DATOS] Personas extraídas: ${people}`);
    }
    
    if (date && !state.data.date) {
      state.data.date = date;
      console.log(`[DATOS] Fecha extraída: ${date}`);
    }
    
    if (time && !state.data.time) {
      state.data.time = time;
      console.log(`[DATOS] Hora extraída: ${time}`);
    }
    
    if (name && !state.data.name) {
      state.data.name = name;
      console.log(`[DATOS] Nombre extraído: ${name}`);
    }
    
    if (phone && !state.data.phone) {
      state.data.phone = phone;
      console.log(`[DATOS] Teléfono extraído: ${phone}`);
    }
  }
  
  // Determinar siguiente paso
  let nextStep = state.step;
  let response = '';
  
  try {
    // Si necesita aclaración, mantener el paso actual
    if (intentAnalysis.needs_clarification) {
      nextStep = state.step;
      response = intentAnalysis.clarification_question || 
        HybridSystem.getClarificationResponse(state.step, state.language);
    } else {
      // Avanzar según el flujo
      switch (state.step) {
        case 'greeting':
          if (intentAnalysis.intent === 'reservation_request' || intentAnalysis.extracted_data.people) {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Solicitud de reserva detectada)`);
          } else {
            nextStep = 'waiting_for_request';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Esperando solicitud)`);
          }
          break;
          
        case 'waiting_for_request':
          if (intentAnalysis.intent === 'reservation_request' || intentAnalysis.extracted_data.people) {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Solicitud de reserva detectada)`);
          } else {
            nextStep = 'waiting_for_request';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Esperando solicitud)`);
          }
          break;
          
        case 'ask_people':
          if (intentAnalysis.extracted_data.people) {
            nextStep = 'ask_date';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Datos de personas confirmados)`);
          } else {
            nextStep = 'ask_people';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de personas)`);
          }
          break;
          
        case 'ask_date':
          if (intentAnalysis.extracted_data.date) {
            nextStep = 'ask_time';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Fecha extraída)`);
          } else {
            nextStep = 'ask_date';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de fecha)`);
          }
          break;
          
        case 'ask_time':
          if (intentAnalysis.extracted_data.time) {
            nextStep = 'ask_name';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Hora extraída)`);
          } else {
            nextStep = 'ask_time';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de hora)`);
          }
          break;
          
        case 'ask_name':
          if (intentAnalysis.extracted_data.name) {
            nextStep = 'ask_phone';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Nombre extraído)`);
          } else {
            nextStep = 'ask_name';
            console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Repitiendo solicitud de nombre)`);
          }
          break;
          
        case 'ask_phone':
          state.data.phone = From;
          nextStep = 'complete';
          console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Teléfono del llamador asignado)`);
          break;
          
        case 'complete':
          nextStep = 'finished';
          console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Reserva completada)`);
          break;
          
        case 'cancelled':
          nextStep = 'finished';
          console.log(`[STEP] ${From}: ${state.step} → ${nextStep} (Reserva cancelada)`);
          break;
      }
      
      // Generar respuesta hardcodeada optimizada
      response = HybridSystem.getResponse(nextStep, state.language, intentAnalysis);
      console.log(`[RESPONSE] ${From}: hardcoded (${state.language})`);
    }
    
    // Si es el paso final, guardar reserva
    if (nextStep === 'complete' && state.data.people && state.data.date && state.data.time && state.data.name) {
      const saved = await saveReservation(state);
      if (saved) {
        response = HybridSystem.getResponse('complete', state.language);
        nextStep = 'finished';
      } else {
        response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        nextStep = 'error';
      }
    }
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
    nextStep = 'error';
  }
  
  // Guardar conversación
  state.conversationHistory.push({
    role: 'user',
    message: userInput,
    timestamp: new Date().toISOString()
  });
  
  state.conversationHistory.push({
    role: 'bot',
    message: response,
    timestamp: new Date().toISOString()
  });
  
  console.log(`[HISTORY] ${From}: ${state.conversationHistory.length} mensajes`);
  
  // Actualizar estado
  state.step = nextStep;
  conversationStates.set(From, state);
  console.log(`[STATE] ${From}: ${state.step} (${state.language})`);
  
  // Generar TwiML
  const twiml = generateTwiML(response, state.language);
  
  // Logging de métricas
  const processingTime = Date.now() - startTime;
  console.log(`[METRICS] ${From}: ${processingTime}ms total`);
  console.log(`[MÉTRICAS] Tiempo de procesamiento: ${processingTime}ms`);
  console.log(`[MÉTRICAS] Intención: ${intentAnalysis.intent}, Confianza: ${intentAnalysis.confidence}`);
  console.log(`[MÉTRICAS] Sentimiento: ${intentAnalysis.sentiment}, Urgencia: ${intentAnalysis.urgency}`);
  console.log(`[MÉTRICAS] Paso: ${state.step} -> ${nextStep}`);
  console.log(`[MÉTRICAS] Idioma: ${state.language}`);
  console.log(`[MÉTRICAS] Sistema: Híbrido Vercel (Gemini solo para idioma)`);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
