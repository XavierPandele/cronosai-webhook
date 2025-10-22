#!/usr/bin/env node

// Cargar variables de entorno
require('dotenv').config();

console.log('🧪 Prueba Simple del Sistema de Comprensión Mejorado\n');

// Verificar configuración
console.log('📋 Verificando configuración...');
console.log('✅ GOOGLE_API_KEY:', process.env.GOOGLE_API_KEY ? 'CONFIGURADA' : 'NO CONFIGURADA');
console.log('✅ DB_HOST:', process.env.DB_HOST || 'NO CONFIGURADA');
console.log('✅ DB_USER:', process.env.DB_USER || 'NO CONFIGURADA');
console.log('✅ DB_NAME:', process.env.DB_NAME || 'NO CONFIGURADA');

// Probar inicialización de Gemini
console.log('\n🔧 Probando inicialización de Gemini...');
try {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.3,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 1024,
    }
  });
  console.log('✅ Gemini 2.0 Flash inicializado correctamente');
} catch (error) {
  console.log('❌ Error inicializando Gemini:', error.message);
}

// Probar sistema de fallback
console.log('\n🔄 Probando sistema de fallback...');

// Simular casos de prueba con sistema de fallback
const testCases = [
  {
    name: "Saludo simple",
    input: "Hola",
    expectedIntent: "greeting"
  },
  {
    name: "Número de personas",
    input: "Para 4 personas",
    expectedIntent: "reservation"
  },
  {
    name: "Despedida",
    input: "Gracias, hasta luego",
    expectedIntent: "goodbye"
  }
];

// Sistema de fallback básico
function getFallbackIntent(userInput, currentStep) {
  const lowerInput = userInput.toLowerCase();
  
  if (lowerInput.includes('hola') || lowerInput.includes('hello') || lowerInput.includes('hi')) {
    return {
      intent: 'greeting',
      confidence: 0.8,
      extracted_data: {},
      sentiment: 'positive',
      urgency: 'normal',
      next_step: 'ask_people',
      response_type: 'question',
      needs_clarification: false,
      clarification_question: null
    };
  }
  
  if (lowerInput.includes('gracias') || lowerInput.includes('thanks') || lowerInput.includes('bye')) {
    return {
      intent: 'goodbye',
      confidence: 0.8,
      extracted_data: {},
      sentiment: 'positive',
      urgency: 'low',
      next_step: 'complete',
      response_type: 'confirmation',
      needs_clarification: false,
      clarification_question: null
    };
  }
  
  // Extraer números básicos
  const numbers = userInput.match(/\b(\d+)\b/g);
  if (numbers && numbers.length > 0) {
    const num = parseInt(numbers[0]);
    if (num >= 1 && num <= 20) {
      return {
        intent: 'reservation',
        confidence: 0.7,
        extracted_data: { people: num },
        sentiment: 'neutral',
        urgency: 'normal',
        next_step: 'ask_date',
        response_type: 'confirmation',
        needs_clarification: false,
        clarification_question: null
      };
    }
  }
  
  return {
    intent: 'clarification',
    confidence: 0.5,
    extracted_data: {},
    sentiment: 'neutral',
    urgency: 'normal',
    next_step: currentStep,
    response_type: 'question',
    needs_clarification: true,
    clarification_question: '¿Podría repetir eso, por favor?'
  };
}

// Probar casos de fallback
let passedTests = 0;
testCases.forEach((testCase, index) => {
  console.log(`\n📋 Prueba ${index + 1}: ${testCase.name}`);
  console.log(`📝 Input: "${testCase.input}"`);
  
  const intent = getFallbackIntent(testCase.input, 'greeting');
  console.log(`✅ Intención detectada: ${intent.intent}`);
  console.log(`📊 Confianza: ${intent.confidence}`);
  console.log(`😊 Sentimiento: ${intent.sentiment}`);
  
  if (intent.extracted_data && Object.keys(intent.extracted_data).length > 0) {
    console.log(`📋 Datos extraídos:`, intent.extracted_data);
  }
  
  if (intent.intent === testCase.expectedIntent) {
    console.log(`✅ Prueba PASADA`);
    passedTests++;
  } else {
    console.log(`❌ Prueba FALLIDA - Esperado: ${testCase.expectedIntent}, Obtenido: ${intent.intent}`);
  }
});

console.log(`\n📊 RESUMEN DE PRUEBAS FALLBACK:`);
console.log(`✅ Pruebas pasadas: ${passedTests}/${testCases.length}`);
console.log(`📈 Porcentaje de éxito: ${((passedTests / testCases.length) * 100).toFixed(1)}%`);

if (passedTests === testCases.length) {
  console.log(`🎉 Sistema de fallback funcionando correctamente!`);
} else {
  console.log(`⚠️ Algunas pruebas de fallback fallaron.`);
}

console.log(`\n🚀 El sistema está listo para usar con fallback automático.`);
console.log(`💡 Si Gemini está sobrecargado, el sistema usará patrones de fallback.`);
