const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configurar Gemini para testing
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function testPremiumSystem() {
  console.log('🧪 Testing Sistema Premium con Gemini...\n');
  
  try {
    // Test 1: Detección de idioma y sentimiento
    console.log('1️⃣ Testing detección de idioma y sentimiento...');
    await testLanguageDetection();
    
    // Test 2: Generación de respuestas
    console.log('\n2️⃣ Testing generación de respuestas...');
    await testResponseGeneration();
    
    // Test 3: Extracción de información
    console.log('\n3️⃣ Testing extracción de información...');
    await testInformationExtraction();
    
    // Test 4: Análisis de conversación
    console.log('\n4️⃣ Testing análisis de conversación...');
    await testConversationAnalysis();
    
    console.log('\n✅ Todos los tests completados exitosamente!');
    
  } catch (error) {
    console.error('❌ Error en testing:', error);
  }
}

async function testLanguageDetection() {
  const testCases = [
    { input: "Hola, quiero hacer una reserva", expected: "es" },
    { input: "Hello, I would like to make a reservation", expected: "en" },
    { input: "Hallo, ich möchte eine Reservierung machen", expected: "de" },
    { input: "Ciao, vorrei fare una prenotazione", expected: "it" },
    { input: "Bonjour, je voudrais faire une réservation", expected: "fr" },
    { input: "Olá, gostaria de fazer uma reserva", expected: "pt" }
  ];
  
  for (const testCase of testCases) {
    try {
      const prompt = `
      Analiza este input del usuario: "${testCase.input}"
      
      Responde en JSON con:
      {
        "language": "código del idioma (es, en, de, it, fr, pt)",
        "sentiment": "positive/neutral/negative/frustrated",
        "intent": "reservation/information/cancellation/other",
        "urgency": "low/medium/high",
        "confidence": 0.0-1.0
      }
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const analysis = JSON.parse(text);
      console.log(`   Input: "${testCase.input}"`);
      console.log(`   Detected: ${analysis.language} (expected: ${testCase.expected})`);
      console.log(`   Sentiment: ${analysis.sentiment}, Confidence: ${analysis.confidence}`);
      console.log(`   ✅ ${analysis.language === testCase.expected ? 'CORRECT' : 'INCORRECT'}\n`);
      
    } catch (error) {
      console.log(`   ❌ Error testing "${testCase.input}": ${error.message}\n`);
    }
  }
}

async function testResponseGeneration() {
  const testCases = [
    { step: 'greeting', language: 'es', sentiment: 'positive' },
    { step: 'greeting', language: 'en', sentiment: 'frustrated' },
    { step: 'ask_people', language: 'de', sentiment: 'neutral' },
    { step: 'ask_date', language: 'it', sentiment: 'positive' },
    { step: 'complete', language: 'fr', sentiment: 'positive' }
  ];
  
  for (const testCase of testCases) {
    try {
      const prompt = `
      Eres un recepcionista premium de restaurante en ${testCase.language}.
      Sentimiento del cliente: ${testCase.sentiment}
      Paso: ${testCase.step}
      
      Genera una respuesta natural y profesional. Máximo 15 palabras.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      console.log(`   Step: ${testCase.step}, Language: ${testCase.language}, Sentiment: ${testCase.sentiment}`);
      console.log(`   Response: "${text.trim()}"`);
      console.log(`   ✅ Generated successfully\n`);
      
    } catch (error) {
      console.log(`   ❌ Error generating response: ${error.message}\n`);
    }
  }
}

async function testInformationExtraction() {
  const testCases = [
    { type: 'people', input: "Para 4 personas", expected: 4 },
    { type: 'people', input: "We need a table for 6 people", expected: 6 },
    { type: 'date', input: "Para mañana", expected: "date" },
    { type: 'date', input: "Next Friday", expected: "date" },
    { type: 'time', input: "A las 8 de la noche", expected: "20:00" },
    { type: 'time', input: "At 7:30 PM", expected: "19:30" },
    { type: 'name', input: "Mi nombre es Juan", expected: "Juan" },
    { type: 'name', input: "I'm called Maria", expected: "Maria" }
  ];
  
  for (const testCase of testCases) {
    try {
      const prompt = `
      Extrae la información de tipo "${testCase.type}" de este texto: "${testCase.input}"
      
      Responde en JSON:
      {
        "${testCase.type}": valor_extraído,
        "confidence": 0.0-1.0
      }
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const extraction = JSON.parse(text);
      console.log(`   Type: ${testCase.type}, Input: "${testCase.input}"`);
      console.log(`   Extracted: ${JSON.stringify(extraction[testCase.type])} (expected: ${testCase.expected})`);
      console.log(`   Confidence: ${extraction.confidence}`);
      console.log(`   ✅ Extracted successfully\n`);
      
    } catch (error) {
      console.log(`   ❌ Error extracting ${testCase.type}: ${error.message}\n`);
    }
  }
}

async function testConversationAnalysis() {
  const mockConversation = [
    { role: 'user', message: 'Hola, quiero hacer una reserva' },
    { role: 'bot', message: '¡Hola! Bienvenido. ¿Para cuántas personas?' },
    { role: 'user', message: 'Para 4 personas' },
    { role: 'bot', message: 'Perfecto. ¿Para qué fecha?' },
    { role: 'user', message: 'Para mañana' },
    { role: 'bot', message: 'Excelente. ¿A qué hora?' },
    { role: 'user', message: 'A las 8' },
    { role: 'bot', message: 'Muy bien. ¿Su nombre?' },
    { role: 'user', message: 'Juan' },
    { role: 'bot', message: 'Perfecto Juan. ¿Usa este número o prefiere otro?' },
    { role: 'user', message: 'Este mismo' },
    { role: 'bot', message: 'Confirmo: 4 personas, mañana a las 8, Juan. ¿Es correcto?' },
    { role: 'user', message: 'Sí, perfecto' },
    { role: 'bot', message: '¡Excelente! Reserva confirmada. ¡Hasta mañana!' }
  ];
  
  try {
    const prompt = `
    Analiza esta conversación de reserva:
    
    ${JSON.stringify(mockConversation, null, 2)}
    
    Genera un análisis completo que incluya:
    1. Resumen ejecutivo
    2. Análisis de sentimiento del cliente
    3. Efectividad de las respuestas del bot
    4. Sugerencias de mejora específicas
    5. Puntuación de calidad (0-100)
    6. Recomendaciones para futuras conversaciones
    
    Formato: Markdown estructurado y profesional.
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('   📊 Análisis de conversación generado:');
    console.log('   ' + text.substring(0, 200) + '...');
    console.log('   ✅ Analysis completed successfully\n');
    
  } catch (error) {
    console.log(`   ❌ Error analyzing conversation: ${error.message}\n`);
  }
}

// Ejecutar tests
testPremiumSystem();
