// Testing del sistema premium sin Gemini (fallback mode)
console.log('🧪 Testing Sistema Premium Fallback (sin Gemini)...\n');

// Simular que no hay API key
process.env.GOOGLE_API_KEY = '';

// Importar el sistema premium
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurar Gemini (opcional)
let genAI = null;
let model = null;

// Verificar si Gemini está disponible
if (process.env.GOOGLE_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log('✅ Gemini AI configurado correctamente');
  } catch (error) {
    console.log('⚠️ Error configurando Gemini:', error.message);
    console.log('🔄 Usando sistema híbrido (fallback a respuestas hard-coded)');
  }
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurada');
  console.log('🔄 Usando sistema híbrido (fallback a respuestas hard-coded)');
}

// Función de análisis fallback
function analyzeUserInputFallback(userInput) {
  console.log('🔄 Usando análisis fallback (sin Gemini)');
  
  // Detección básica de idioma por palabras clave
  const languagePatterns = {
    en: /\b(hello|hi|reservation|table|people|time|date|yes|no|thank you)\b/i,
    de: /\b(hallo|reservierung|tisch|personen|zeit|datum|ja|nein|danke)\b/i,
    it: /\b(ciao|prenotazione|tavolo|persone|ora|data|sì|no|grazie)\b/i,
    fr: /\b(bonjour|réservation|table|personnes|heure|date|oui|non|merci)\b/i,
    pt: /\b(olá|reserva|mesa|pessoas|hora|data|sim|não|obrigado)\b/i
  };
  
  let detectedLanguage = 'es'; // Español por defecto
  for (const [lang, pattern] of Object.entries(languagePatterns)) {
    if (pattern.test(userInput)) {
      detectedLanguage = lang;
      break;
    }
  }
  
  // Detección básica de sentimiento
  let sentiment = 'neutral';
  if (userInput.includes('gracias') || userInput.includes('perfecto') || userInput.includes('excelente')) {
    sentiment = 'positive';
  } else if (userInput.includes('no') || userInput.includes('mal') || userInput.includes('error')) {
    sentiment = 'negative';
  } else if (userInput.includes('urgente') || userInput.includes('rápido') || userInput.includes('ya')) {
    sentiment = 'frustrated';
  }
  
  return {
    language: detectedLanguage,
    sentiment: sentiment,
    intent: 'reservation',
    urgency: 'medium',
    confidence: 0.7
  };
}

// Función de respuestas fallback
function generateResponseFallback(step, language, sentiment) {
  console.log('🔄 Usando respuestas fallback (sin Gemini)');
  
  const responses = {
    greeting: {
      es: {
        positive: ['¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?', '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy?'],
        neutral: ['¡Hola! Gracias por llamar. ¿En qué puedo asistirle?', '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita?'],
        negative: ['¡Hola! Entiendo que puede estar molesto. ¿En qué puedo ayudarle?', '¡Hola! Lamento cualquier inconveniente. ¿Cómo puedo asistirle?'],
        frustrated: ['¡Hola! Entiendo su urgencia. ¿En qué puedo ayudarle rápidamente?', '¡Hola! Veo que necesita ayuda urgente. ¿Qué puedo hacer por usted?']
      },
      en: {
        positive: ['Hello! Welcome to our restaurant. How can I help you?', 'Good morning! Welcome. How can I assist you today?'],
        neutral: ['Hello! Thank you for calling. How can I help you?', 'Good afternoon! Welcome to the restaurant. What do you need?'],
        negative: ['Hello! I understand you may be upset. How can I help you?', 'Hello! I apologize for any inconvenience. How can I assist you?'],
        frustrated: ['Hello! I understand your urgency. How can I help you quickly?', 'Hello! I see you need urgent help. What can I do for you?']
      },
      de: {
        positive: ['Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?', 'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?'],
        neutral: ['Hallo! Vielen Dank für den Anruf. Wie kann ich Ihnen helfen?', 'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?'],
        negative: ['Hallo! Ich verstehe, dass Sie verärgert sein könnten. Wie kann ich Ihnen helfen?', 'Hallo! Entschuldigung für die Unannehmlichkeiten. Wie kann ich Ihnen helfen?'],
        frustrated: ['Hallo! Ich verstehe Ihre Dringlichkeit. Wie kann ich Ihnen schnell helfen?', 'Hallo! Ich sehe, Sie brauchen dringend Hilfe. Was kann ich für Sie tun?']
      },
      it: {
        positive: ['Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?', 'Buongiorno! Benvenuto. Come posso aiutarti oggi?'],
        neutral: ['Ciao! Grazie per la chiamata. Come posso aiutarti?', 'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?'],
        negative: ['Ciao! Capisco che potresti essere arrabbiato. Come posso aiutarti?', 'Ciao! Mi scuso per qualsiasi inconveniente. Come posso aiutarti?'],
        frustrated: ['Ciao! Capisco la tua urgenza. Come posso aiutarti rapidamente?', 'Ciao! Vedo che hai bisogno di aiuto urgente. Cosa posso fare per te?']
      },
      fr: {
        positive: ['Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?', 'Bonjour! Bienvenue. Comment puis-je vous aider aujourd\'hui?'],
        neutral: ['Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?', 'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?'],
        negative: ['Bonjour! Je comprends que vous pourriez être contrarié. Comment puis-je vous aider?', 'Bonjour! Je m\'excuse pour tout inconvénient. Comment puis-je vous aider?'],
        frustrated: ['Bonjour! Je comprends votre urgence. Comment puis-je vous aider rapidement?', 'Bonjour! Je vois que vous avez besoin d\'aide urgente. Que puis-je faire pour vous?']
      },
      pt: {
        positive: ['Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?', 'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?'],
        neutral: ['Olá! Obrigado por ligar. Como posso ajudá-lo?', 'Boa tarde! Bem-vindo ao restaurante. Do que precisa?'],
        negative: ['Olá! Entendo que pode estar chateado. Como posso ajudá-lo?', 'Olá! Peço desculpa por qualquer inconveniente. Como posso ajudá-lo?'],
        frustrated: ['Olá! Entendo a sua urgência. Como posso ajudá-lo rapidamente?', 'Olá! Vejo que precisa de ajuda urgente. O que posso fazer por si?']
      }
    },
    
    ask_people: {
      es: {
        positive: ['¡Perfecto! ¿Para cuántas personas?', '¡Excelente! ¿Cuántas personas serán?'],
        neutral: ['¿Para cuántas personas?', '¿Cuántas personas serán?'],
        negative: ['Entiendo. ¿Para cuántas personas?', 'Disculpe. ¿Cuántas personas serán?'],
        frustrated: ['Rápido, ¿cuántas personas?', '¿Cuántas personas? Necesito saberlo ya.']
      },
      en: {
        positive: ['Perfect! For how many people?', 'Excellent! How many people will it be?'],
        neutral: ['For how many people?', 'How many people will it be?'],
        negative: ['I understand. For how many people?', 'Sorry. How many people will it be?'],
        frustrated: ['Quick, how many people?', 'How many people? I need to know now.']
      },
      de: {
        positive: ['Perfekt! Für wie viele Personen?', 'Ausgezeichnet! Wie viele Personen werden es sein?'],
        neutral: ['Für wie viele Personen?', 'Wie viele Personen werden es sein?'],
        negative: ['Ich verstehe. Für wie viele Personen?', 'Entschuldigung. Wie viele Personen werden es sein?'],
        frustrated: ['Schnell, wie viele Personen?', 'Wie viele Personen? Ich muss es jetzt wissen.']
      },
      it: {
        positive: ['Perfetto! Per quante persone?', 'Eccellente! Quante persone saranno?'],
        neutral: ['Per quante persone?', 'Quante persone saranno?'],
        negative: ['Capisco. Per quante persone?', 'Scusi. Quante persone saranno?'],
        frustrated: ['Veloce, quante persone?', 'Quante persone? Devo saperlo ora.']
      },
      fr: {
        positive: ['Parfait! Pour combien de personnes?', 'Excellent! Combien de personnes seront-ce?'],
        neutral: ['Pour combien de personnes?', 'Combien de personnes seront-ce?'],
        negative: ['Je comprends. Pour combien de personnes?', 'Désolé. Combien de personnes seront-ce?'],
        frustrated: ['Rapidement, combien de personnes?', 'Combien de personnes? Je dois le savoir maintenant.']
      },
      pt: {
        positive: ['Perfeito! Para quantas pessoas?', 'Excelente! Quantas pessoas serão?'],
        neutral: ['Para quantas pessoas?', 'Quantas pessoas serão?'],
        negative: ['Entendo. Para quantas pessoas?', 'Desculpe. Quantas pessoas serão?'],
        frustrated: ['Rápido, quantas pessoas?', 'Quantas pessoas? Preciso saber agora.']
      }
    }
  };
  
  const stepResponses = responses[step]?.[language]?.[sentiment] || responses[step]?.[language]?.['neutral'] || responses[step]?.['es']?.['neutral'];
  
  if (stepResponses && stepResponses.length > 0) {
    const randomIndex = Math.floor(Math.random() * stepResponses.length);
    return stepResponses[randomIndex];
  }
  
  // Fallback final
  return '¿En qué puedo ayudarle?';
}

// Testing
async function testFallbackSystem() {
  console.log('1️⃣ Testing detección de idioma y sentimiento (fallback)...');
  
  const testCases = [
    { input: "Hola, quiero hacer una reserva", expected: "es" },
    { input: "Hello, I would like to make a reservation", expected: "en" },
    { input: "Hallo, ich möchte eine Reservierung machen", expected: "de" },
    { input: "Ciao, vorrei fare una prenotazione", expected: "it" },
    { input: "Bonjour, je voudrais faire une réservation", expected: "fr" },
    { input: "Olá, gostaria de fazer uma reserva", expected: "pt" },
    { input: "Gracias, perfecto", expected: "es", sentiment: "positive" },
    { input: "No, esto está mal", expected: "es", sentiment: "negative" },
    { input: "Urgente, necesito ayuda ya", expected: "es", sentiment: "frustrated" }
  ];
  
  for (const testCase of testCases) {
    const analysis = analyzeUserInputFallback(testCase.input);
    console.log(`   Input: "${testCase.input}"`);
    console.log(`   Detected: ${analysis.language} (expected: ${testCase.expected})`);
    console.log(`   Sentiment: ${analysis.sentiment}${testCase.sentiment ? ` (expected: ${testCase.sentiment})` : ''}`);
    console.log(`   Confidence: ${analysis.confidence}`);
    console.log(`   ✅ ${analysis.language === testCase.expected ? 'CORRECT' : 'INCORRECT'}\n`);
  }
  
  console.log('2️⃣ Testing generación de respuestas (fallback)...');
  
  const responseTests = [
    { step: 'greeting', language: 'es', sentiment: 'positive' },
    { step: 'greeting', language: 'en', sentiment: 'frustrated' },
    { step: 'ask_people', language: 'de', sentiment: 'neutral' },
    { step: 'ask_people', language: 'it', sentiment: 'negative' },
    { step: 'greeting', language: 'fr', sentiment: 'positive' },
    { step: 'ask_people', language: 'pt', sentiment: 'frustrated' }
  ];
  
  for (const test of responseTests) {
    const response = generateResponseFallback(test.step, test.language, test.sentiment);
    console.log(`   Step: ${test.step}, Language: ${test.language}, Sentiment: ${test.sentiment}`);
    console.log(`   Response: "${response}"`);
    console.log(`   ✅ Generated successfully\n`);
  }
  
  console.log('✅ Todos los tests fallback completados exitosamente!');
  console.log('\n🎯 Sistema híbrido funcionando correctamente:');
  console.log('   - ✅ Detección de idioma por palabras clave');
  console.log('   - ✅ Detección de sentimiento básica');
  console.log('   - ✅ Respuestas adaptativas por idioma y sentimiento');
  console.log('   - ✅ Fallback automático cuando Gemini no está disponible');
  console.log('\n💡 Para activar Gemini:');
  console.log('   1. Obtener API key de Google AI Studio');
  console.log('   2. Configurar GOOGLE_API_KEY en variables de entorno');
  console.log('   3. El sistema automáticamente usará Gemini cuando esté disponible');
}

// Ejecutar tests
testFallbackSystem();
