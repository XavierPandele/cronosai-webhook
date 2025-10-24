// Cargar variables de entorno
require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inicializar Gemini 2.0 Flash
let genAI, model;
if (process.env.GOOGLE_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 1024,
    }
  });
  console.log('✅ Gemini 2.0 Flash inicializado para pruebas');
} else {
  console.log('⚠️ GOOGLE_API_KEY no configurado');
  process.exit(1);
}

// Casos de prueba para validar comprensión mejorada
const testCases = [
  // Casos básicos
  {
    name: "Reserva simple",
    input: "Hola, quiero reservar una mesa para 4 personas mañana a las 8 de la noche",
    expectedIntent: "reservation",
    expectedData: { people: 4, date: "tomorrow", time: "20:00" }
  },
  {
    name: "Reserva con corrección",
    input: "Quiero reservar para 2 personas, no, mejor para 3",
    expectedIntent: "correction",
    expectedData: { people: 3 }
  },
  {
    name: "Cliente confundido",
    input: "No entiendo, ¿qué necesito decir?",
    expectedIntent: "clarification",
    needsClarification: true
  },
  {
    name: "Cliente frustrado",
    input: "Esto es muy complicado, solo quiero una mesa",
    expectedIntent: "complaint",
    expectedSentiment: "frustrated"
  },
  {
    name: "Múltiples datos en una frase",
    input: "Soy Juan Pérez, quiero reservar para 5 personas el viernes a las 7:30",
    expectedIntent: "reservation",
    expectedData: { name: "Juan Pérez", people: 5, date: "friday", time: "19:30" }
  },
  {
    name: "Pregunta específica",
    input: "¿Tienen disponibilidad para 6 personas el sábado?",
    expectedIntent: "question",
    expectedData: { people: 6, date: "saturday" }
  },
  {
    name: "Confirmación",
    input: "Sí, perfecto, eso está bien",
    expectedIntent: "confirmation"
  },
  {
    name: "Despedida",
    input: "Gracias, hasta luego",
    expectedIntent: "goodbye"
  },
  {
    name: "Datos ambiguos",
    input: "Quiero reservar para el 15, no, mejor el 16",
    expectedIntent: "correction",
    expectedData: { date: "16th" }
  },
  {
    name: "Cliente indeciso",
    input: "No sé, tal vez 2 personas, o mejor 3, ¿qué me recomienda?",
    expectedIntent: "clarification",
    needsClarification: true
  }
];

// Función para analizar intención (copiada del sistema enhanced)
async function analyzeIntent(userInput, conversationHistory, currentStep, language) {
  try {
    const context = buildConversationContext(conversationHistory, currentStep);
    
    const prompt = `Eres un experto en análisis de intenciones para un sistema de reservas de restaurante.

CONTEXTO DE LA CONVERSACIÓN:
${context}

PASO ACTUAL: ${currentStep}
IDIOMA: ${language}
ÚLTIMO MENSAJE DEL CLIENTE: "${userInput}"

Analiza la intención del cliente y responde en formato JSON:

{
  "intent": "reservation|clarification|correction|confirmation|greeting|goodbye|complaint|question",
  "confidence": 0.0-1.0,
  "extracted_data": {
    "people": number|null,
    "date": "YYYY-MM-DD"|null,
    "time": "HH:MM"|null,
    "name": string|null,
    "phone": string|null
  },
  "sentiment": "positive|neutral|negative|frustrated|confused",
  "urgency": "low|normal|high",
  "next_step": "ask_people|ask_date|ask_time|ask_name|ask_phone|complete|clarify",
  "response_type": "question|confirmation|clarification|error",
  "needs_clarification": boolean,
  "clarification_question": string|null
}

IMPORTANTE:
- Si el cliente está confundido o necesita aclaración, marca "needs_clarification": true
- Si hay datos ambiguos, pide clarificación específica
- Considera el contexto completo de la conversación
- Prioriza la comprensión sobre la velocidad

Análisis:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let responseText = response.text().trim();
    
    // Limpiar markdown si está presente
    if (responseText.includes('```json')) {
      responseText = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '');
    }
    
    const analysis = JSON.parse(responseText);
    
    return analysis;
    
  } catch (error) {
    console.error('Error analizando intención:', error);
    
    // Si es error de sobrecarga, esperar y reintentar
    if (error.status === 503) {
      console.log('⚠️ Modelo sobrecargado, esperando 2 segundos...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return null; // Retornar null para usar fallback
    }
    
    return null;
  }
}

function buildConversationContext(conversationHistory, currentStep) {
  let context = `FLUJO DE RESERVA ACTUAL:
1. greeting -> ask_people (¿Cuántas personas?)
2. ask_people -> ask_date (¿Qué fecha?)
3. ask_date -> ask_time (¿Qué hora?)
4. ask_time -> ask_name (¿Cuál es su nombre?)
5. ask_name -> ask_phone (¿Confirmar teléfono?)
6. ask_phone -> complete (Reserva confirmada)

PASO ACTUAL: ${currentStep}

HISTORIAL DE CONVERSACIÓN:`;
  
  if (conversationHistory && conversationHistory.length > 0) {
    conversationHistory.slice(-6).forEach((entry, index) => {
      const role = entry.role === 'user' ? 'CLIENTE' : 'BOT';
      context += `\n${index + 1}. ${role}: "${entry.message}"`;
    });
  } else {
    context += '\n(Conversación nueva)';
  }
  
  return context;
}

// Función para generar respuesta inteligente
async function generateIntelligentResponse(intentAnalysis, language, conversationHistory) {
  try {
    const context = buildConversationContext(conversationHistory, intentAnalysis.next_step);
    
    const prompt = `Eres un asistente de restaurante profesional y amigable. Genera una respuesta natural basada en el análisis de intención.

CONTEXTO:
${context}

ANÁLISIS DE INTENCIÓN:
- Intención: ${intentAnalysis.intent}
- Confianza: ${intentAnalysis.confidence}
- Sentimiento: ${intentAnalysis.sentiment}
- Urgencia: ${intentAnalysis.urgency}
- Necesita aclaración: ${intentAnalysis.needs_clarification}
- Datos extraídos: ${JSON.stringify(intentAnalysis.extracted_data)}

INSTRUCCIONES:
1. Si necesita aclaración, haz una pregunta específica y clara
2. Si hay datos extraídos, confírmalos de manera natural
3. Adapta el tono al sentimiento del cliente
4. Si está frustrado, sé empático y paciente
5. Si está confundido, explica de manera simple
6. Mantén un tono profesional pero amigable
7. Responde en ${language}

Genera UNA respuesta natural, directa y útil. No uses frases robóticas.

Respuesta:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const intelligentResponse = response.text().trim();
    
    return intelligentResponse;
    
  } catch (error) {
    console.error('Error generando respuesta:', error);
    return 'Lo siento, no pude procesar su solicitud.';
  }
}

// Ejecutar pruebas
async function runTests() {
  console.log('🧪 Iniciando pruebas de comprensión mejorada...\n');
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  for (const testCase of testCases) {
    console.log(`\n📋 Prueba: ${testCase.name}`);
    console.log(`📝 Input: "${testCase.input}"`);
    
    try {
      // Analizar intención
      const intentAnalysis = await analyzeIntent(
        testCase.input, 
        [], // Sin historial para pruebas simples
        'greeting', 
        'es'
      );
      
      if (intentAnalysis) {
        console.log(`✅ Intención detectada: ${intentAnalysis.intent}`);
        console.log(`📊 Confianza: ${intentAnalysis.confidence}`);
        console.log(`😊 Sentimiento: ${intentAnalysis.sentiment}`);
        console.log(`📈 Urgencia: ${intentAnalysis.urgency}`);
        console.log(`❓ Necesita aclaración: ${intentAnalysis.needs_clarification}`);
        
        if (intentAnalysis.extracted_data) {
          console.log(`📋 Datos extraídos:`, intentAnalysis.extracted_data);
        }
        
        // Generar respuesta
        const response = await generateIntelligentResponse(
          intentAnalysis, 
          'es', 
          []
        );
        
        console.log(`🤖 Respuesta generada: "${response}"`);
        
        // Validar resultados
        let testPassed = true;
        
        if (testCase.expectedIntent && intentAnalysis.intent !== testCase.expectedIntent) {
          console.log(`❌ Intención esperada: ${testCase.expectedIntent}, obtenida: ${intentAnalysis.intent}`);
          testPassed = false;
        }
        
        if (testCase.expectedSentiment && intentAnalysis.sentiment !== testCase.expectedSentiment) {
          console.log(`❌ Sentimiento esperado: ${testCase.expectedSentiment}, obtenido: ${intentAnalysis.sentiment}`);
          testPassed = false;
        }
        
        if (testCase.needsClarification && !intentAnalysis.needs_clarification) {
          console.log(`❌ Se esperaba que necesitara aclaración`);
          testPassed = false;
        }
        
        if (testPassed) {
          console.log(`✅ Prueba PASADA`);
          passedTests++;
        } else {
          console.log(`❌ Prueba FALLIDA`);
        }
        
      } else {
        console.log(`❌ No se pudo analizar la intención`);
      }
      
    } catch (error) {
      console.error(`❌ Error en prueba:`, error.message);
    }
    
    // Pausa entre pruebas
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n📊 RESUMEN DE PRUEBAS:`);
  console.log(`✅ Pruebas pasadas: ${passedTests}/${totalTests}`);
  console.log(`📈 Porcentaje de éxito: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (passedTests === totalTests) {
    console.log(`🎉 ¡Todas las pruebas pasaron! El sistema de comprensión mejorada está funcionando correctamente.`);
  } else {
    console.log(`⚠️ Algunas pruebas fallaron. Revisar la configuración del sistema.`);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, analyzeIntent, generateIntelligentResponse };
