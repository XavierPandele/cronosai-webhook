// 🌍 RESPUESTAS OPTIMIZADAS MULTIIDIOMA
// Sistema Premium de Reservas Telefónicas
// 6 idiomas: ES, EN, DE, IT, FR, PT

const RESPONSES_OPTIMIZED = {
  greeting: {
    es: {
      positive: [
        '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
        '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy?',
        '¡Hola! Encantado de atenderle. ¿En qué puedo ayudarle?',
        '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita?',
        '¡Hola! Gracias por llamar. ¿En qué puedo asistirle?'
      ],
      neutral: [
        '¡Hola! Gracias por llamar. ¿En qué puedo asistirle?',
        '¡Buenas tardes! Bienvenido al restaurante. ¿Qué necesita?',
        '¡Hola! Bienvenido a nuestro restaurante. ¿En qué puedo ayudarle?',
        '¡Buenos días! Bienvenido. ¿Cómo puedo ayudarle hoy?',
        '¡Hola! Encantado de atenderle. ¿En qué puedo ayudarle?'
      ],
      negative: [
        '¡Hola! Entiendo que puede estar molesto. ¿En qué puedo ayudarle?',
        '¡Hola! Lamento cualquier inconveniente. ¿Cómo puedo asistirle?',
        '¡Hola! Disculpe las molestias. ¿En qué puedo ayudarle?',
        '¡Hola! Entiendo su frustración. ¿Cómo puedo asistirle?',
        '¡Hola! Lamento el inconveniente. ¿En qué puedo ayudarle?'
      ],
      frustrated: [
        '¡Hola! Entiendo su urgencia. ¿En qué puedo ayudarle rápidamente?',
        '¡Hola! Veo que necesita ayuda urgente. ¿Qué puedo hacer por usted?',
        '¡Hola! Entiendo que tiene prisa. ¿Cómo puedo asistirle rápidamente?',
        '¡Hola! Veo que necesita ayuda inmediata. ¿En qué puedo ayudarle?',
        '¡Hola! Entiendo su urgencia. ¿Qué puedo hacer por usted ahora?'
      ]
    },
    en: {
      positive: [
        'Hello! Welcome to our restaurant. How can I help you?',
        'Good morning! Welcome. How can I assist you today?',
        'Hello! Thank you for calling. How can I help you?',
        'Good afternoon! Welcome to the restaurant. What do you need?',
        'Hello! Delighted to serve you. How can I help you?'
      ],
      neutral: [
        'Hello! Thank you for calling. How can I help you?',
        'Good afternoon! Welcome to the restaurant. What do you need?',
        'Hello! Welcome to our restaurant. How can I help you?',
        'Good morning! Welcome. How can I assist you today?',
        'Hello! Delighted to serve you. How can I help you?'
      ],
      negative: [
        'Hello! I understand you may be upset. How can I help you?',
        'Hello! I apologize for any inconvenience. How can I assist you?',
        'Hello! Sorry for the trouble. How can I help you?',
        'Hello! I understand your frustration. How can I assist you?',
        'Hello! I apologize for the inconvenience. How can I help you?'
      ],
      frustrated: [
        'Hello! I understand your urgency. How can I help you quickly?',
        'Hello! I see you need urgent help. What can I do for you?',
        'Hello! I understand you\'re in a hurry. How can I assist you quickly?',
        'Hello! I see you need immediate help. How can I help you?',
        'Hello! I understand your urgency. What can I do for you now?'
      ]
    },
    de: {
      positive: [
        'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?',
        'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?',
        'Hallo! Vielen Dank für den Anruf. Wie kann ich Ihnen helfen?',
        'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?',
        'Hallo! Freue mich, Ihnen zu dienen. Wie kann ich Ihnen helfen?'
      ],
      neutral: [
        'Hallo! Vielen Dank für den Anruf. Wie kann ich Ihnen helfen?',
        'Guten Tag! Willkommen im Restaurant. Was benötigen Sie?',
        'Hallo! Willkommen in unserem Restaurant. Wie kann ich Ihnen helfen?',
        'Guten Morgen! Willkommen. Wie kann ich Ihnen heute helfen?',
        'Hallo! Freue mich, Ihnen zu dienen. Wie kann ich Ihnen helfen?'
      ],
      negative: [
        'Hallo! Ich verstehe, dass Sie verärgert sein könnten. Wie kann ich Ihnen helfen?',
        'Hallo! Entschuldigung für die Unannehmlichkeiten. Wie kann ich Ihnen helfen?',
        'Hallo! Entschuldigung für die Probleme. Wie kann ich Ihnen helfen?',
        'Hallo! Ich verstehe Ihre Frustration. Wie kann ich Ihnen helfen?',
        'Hallo! Entschuldigung für die Unannehmlichkeiten. Wie kann ich Ihnen helfen?'
      ],
      frustrated: [
        'Hallo! Ich verstehe Ihre Dringlichkeit. Wie kann ich Ihnen schnell helfen?',
        'Hallo! Ich sehe, Sie brauchen dringend Hilfe. Was kann ich für Sie tun?',
        'Hallo! Ich verstehe, Sie haben es eilig. Wie kann ich Ihnen schnell helfen?',
        'Hallo! Ich sehe, Sie brauchen sofortige Hilfe. Wie kann ich Ihnen helfen?',
        'Hallo! Ich verstehe Ihre Dringlichkeit. Was kann ich für Sie jetzt tun?'
      ]
    },
    it: {
      positive: [
        'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?',
        'Buongiorno! Benvenuto. Come posso aiutarti oggi?',
        'Ciao! Grazie per la chiamata. Come posso aiutarti?',
        'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?',
        'Ciao! Felice di servirti. Come posso aiutarti?'
      ],
      neutral: [
        'Ciao! Grazie per la chiamata. Come posso aiutarti?',
        'Buon pomeriggio! Benvenuto nel ristorante. Di cosa hai bisogno?',
        'Ciao! Benvenuto nel nostro ristorante. Come posso aiutarti?',
        'Buongiorno! Benvenuto. Come posso aiutarti oggi?',
        'Ciao! Felice di servirti. Come posso aiutarti?'
      ],
      negative: [
        'Ciao! Capisco che potresti essere arrabbiato. Come posso aiutarti?',
        'Ciao! Mi scuso per qualsiasi inconveniente. Come posso aiutarti?',
        'Ciao! Scusa per i problemi. Come posso aiutarti?',
        'Ciao! Capisco la tua frustrazione. Come posso aiutarti?',
        'Ciao! Mi scuso per l\'inconveniente. Come posso aiutarti?'
      ],
      frustrated: [
        'Ciao! Capisco la tua urgenza. Come posso aiutarti rapidamente?',
        'Ciao! Vedo che hai bisogno di aiuto urgente. Cosa posso fare per te?',
        'Ciao! Capisco che hai fretta. Come posso aiutarti rapidamente?',
        'Ciao! Vedo che hai bisogno di aiuto immediato. Come posso aiutarti?',
        'Ciao! Capisco la tua urgenza. Cosa posso fare per te ora?'
      ]
    },
    fr: {
      positive: [
        'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
        'Bonjour! Bienvenue. Comment puis-je vous aider aujourd\'hui?',
        'Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?',
        'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?',
        'Bonjour! Ravi de vous servir. Comment puis-je vous aider?'
      ],
      neutral: [
        'Bonjour! Merci d\'avoir appelé. Comment puis-je vous aider?',
        'Bonjour! Bienvenue au restaurant. De quoi avez-vous besoin?',
        'Bonjour! Bienvenue dans notre restaurant. Comment puis-je vous aider?',
        'Bonjour! Bienvenue. Comment puis-je vous aider aujourd\'hui?',
        'Bonjour! Ravi de vous servir. Comment puis-je vous aider?'
      ],
      negative: [
        'Bonjour! Je comprends que vous pourriez être contrarié. Comment puis-je vous aider?',
        'Bonjour! Je m\'excuse pour tout inconvénient. Comment puis-je vous aider?',
        'Bonjour! Désolé pour les problèmes. Comment puis-je vous aider?',
        'Bonjour! Je comprends votre frustration. Comment puis-je vous aider?',
        'Bonjour! Je m\'excuse pour l\'inconvénient. Comment puis-je vous aider?'
      ],
      frustrated: [
        'Bonjour! Je comprends votre urgence. Comment puis-je vous aider rapidement?',
        'Bonjour! Je vois que vous avez besoin d\'aide urgente. Que puis-je faire pour vous?',
        'Bonjour! Je comprends que vous êtes pressé. Comment puis-je vous aider rapidement?',
        'Bonjour! Je vois que vous avez besoin d\'aide immédiate. Comment puis-je vous aider?',
        'Bonjour! Je comprends votre urgence. Que puis-je faire pour vous maintenant?'
      ]
    },
    pt: {
      positive: [
        'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?',
        'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?',
        'Olá! Obrigado por ligar. Como posso ajudá-lo?',
        'Boa tarde! Bem-vindo ao restaurante. Do que precisa?',
        'Olá! Prazer em servi-lo. Como posso ajudá-lo?'
      ],
      neutral: [
        'Olá! Obrigado por ligar. Como posso ajudá-lo?',
        'Boa tarde! Bem-vindo ao restaurante. Do que precisa?',
        'Olá! Bem-vindo ao nosso restaurante. Como posso ajudá-lo?',
        'Bom dia! Bem-vindo. Como posso ajudá-lo hoje?',
        'Olá! Prazer em servi-lo. Como posso ajudá-lo?'
      ],
      negative: [
        'Olá! Entendo que pode estar chateado. Como posso ajudá-lo?',
        'Olá! Peço desculpa por qualquer inconveniente. Como posso ajudá-lo?',
        'Olá! Desculpe pelos problemas. Como posso ajudá-lo?',
        'Olá! Entendo a sua frustração. Como posso ajudá-lo?',
        'Olá! Peço desculpa pelo inconveniente. Como posso ajudá-lo?'
      ],
      frustrated: [
        'Olá! Entendo a sua urgência. Como posso ajudá-lo rapidamente?',
        'Olá! Vejo que precisa de ajuda urgente. O que posso fazer por si?',
        'Olá! Entendo que tem pressa. Como posso ajudá-lo rapidamente?',
        'Olá! Vejo que precisa de ajuda imediata. Como posso ajudá-lo?',
        'Olá! Entendo a sua urgência. O que posso fazer por si agora?'
      ]
    }
  },

  ask_people: {
    es: {
      positive: [
        '¡Perfecto! ¿Para cuántas personas?',
        '¡Excelente! ¿Cuántas personas serán?',
        '¡Genial! ¿Para cuántos comensales?',
        '¡Muy bien! ¿Cuántas personas van a venir?',
        '¡Perfecto! ¿Para cuántas personas necesita la mesa?'
      ],
      neutral: [
        '¿Para cuántas personas?',
        '¿Cuántas personas serán?',
        '¿Para cuántos comensales?',
        '¿Cuántas personas van a venir?',
        '¿Para cuántas personas necesita la mesa?'
      ],
      negative: [
        'Entiendo. ¿Para cuántas personas?',
        'Disculpe. ¿Cuántas personas serán?',
        'Entiendo. ¿Para cuántos comensales?',
        'Disculpe. ¿Cuántas personas van a venir?',
        'Entiendo. ¿Para cuántas personas necesita la mesa?'
      ],
      frustrated: [
        'Rápido, ¿cuántas personas?',
        '¿Cuántas personas? Necesito saberlo ya.',
        '¿Para cuántas personas? Dígalo rápido.',
        '¿Cuántas personas? Necesito saberlo ahora.',
        '¿Para cuántas personas? Rápido, por favor.'
      ]
    },
    en: {
      positive: [
        'Perfect! For how many people?',
        'Excellent! How many people will it be?',
        'Great! For how many diners?',
        'Very good! How many people are coming?',
        'Perfect! For how many people do you need the table?'
      ],
      neutral: [
        'For how many people?',
        'How many people will it be?',
        'For how many diners?',
        'How many people are coming?',
        'For how many people do you need the table?'
      ],
      negative: [
        'I understand. For how many people?',
        'Sorry. How many people will it be?',
        'I understand. For how many diners?',
        'Sorry. How many people are coming?',
        'I understand. For how many people do you need the table?'
      ],
      frustrated: [
        'Quick, how many people?',
        'How many people? I need to know now.',
        'For how many people? Say it quickly.',
        'How many people? I need to know right now.',
        'For how many people? Quick, please.'
      ]
    },
    de: {
      positive: [
        'Perfekt! Für wie viele Personen?',
        'Ausgezeichnet! Wie viele Personen werden es sein?',
        'Großartig! Für wie viele Gäste?',
        'Sehr gut! Wie viele Personen kommen?',
        'Perfekt! Für wie viele Personen brauchen Sie den Tisch?'
      ],
      neutral: [
        'Für wie viele Personen?',
        'Wie viele Personen werden es sein?',
        'Für wie viele Gäste?',
        'Wie viele Personen kommen?',
        'Für wie viele Personen brauchen Sie den Tisch?'
      ],
      negative: [
        'Ich verstehe. Für wie viele Personen?',
        'Entschuldigung. Wie viele Personen werden es sein?',
        'Ich verstehe. Für wie viele Gäste?',
        'Entschuldigung. Wie viele Personen kommen?',
        'Ich verstehe. Für wie viele Personen brauchen Sie den Tisch?'
      ],
      frustrated: [
        'Schnell, wie viele Personen?',
        'Wie viele Personen? Ich muss es jetzt wissen.',
        'Für wie viele Personen? Sagen Sie es schnell.',
        'Wie viele Personen? Ich muss es sofort wissen.',
        'Für wie viele Personen? Schnell, bitte.'
      ]
    },
    it: {
      positive: [
        'Perfetto! Per quante persone?',
        'Eccellente! Quante persone saranno?',
        'Fantastico! Per quanti commensali?',
        'Molto bene! Quante persone vengono?',
        'Perfetto! Per quante persone avete bisogno del tavolo?'
      ],
      neutral: [
        'Per quante persone?',
        'Quante persone saranno?',
        'Per quanti commensali?',
        'Quante persone vengono?',
        'Per quante persone avete bisogno del tavolo?'
      ],
      negative: [
        'Capisco. Per quante persone?',
        'Scusi. Quante persone saranno?',
        'Capisco. Per quanti commensali?',
        'Scusi. Quante persone vengono?',
        'Capisco. Per quante persone avete bisogno del tavolo?'
      ],
      frustrated: [
        'Veloce, quante persone?',
        'Quante persone? Devo saperlo ora.',
        'Per quante persone? Dite veloce.',
        'Quante persone? Devo saperlo subito.',
        'Per quante persone? Veloce, per favore.'
      ]
    },
    fr: {
      positive: [
        'Parfait! Pour combien de personnes?',
        'Excellent! Combien de personnes seront-ce?',
        'Génial! Pour combien de convives?',
        'Très bien! Combien de personnes viennent?',
        'Parfait! Pour combien de personnes avez-vous besoin de la table?'
      ],
      neutral: [
        'Pour combien de personnes?',
        'Combien de personnes seront-ce?',
        'Pour combien de convives?',
        'Combien de personnes viennent?',
        'Pour combien de personnes avez-vous besoin de la table?'
      ],
      negative: [
        'Je comprends. Pour combien de personnes?',
        'Désolé. Combien de personnes seront-ce?',
        'Je comprends. Pour combien de convives?',
        'Désolé. Combien de personnes viennent?',
        'Je comprends. Pour combien de personnes avez-vous besoin de la table?'
      ],
      frustrated: [
        'Rapidement, combien de personnes?',
        'Combien de personnes? Je dois le savoir maintenant.',
        'Pour combien de personnes? Dites-le rapidement.',
        'Combien de personnes? Je dois le savoir tout de suite.',
        'Pour combien de personnes? Rapidement, s\'il vous plaît.'
      ]
    },
    pt: {
      positive: [
        'Perfeito! Para quantas pessoas?',
        'Excelente! Quantas pessoas serão?',
        'Ótimo! Para quantos comensais?',
        'Muito bem! Quantas pessoas vêm?',
        'Perfeito! Para quantas pessoas precisam da mesa?'
      ],
      neutral: [
        'Para quantas pessoas?',
        'Quantas pessoas serão?',
        'Para quantos comensais?',
        'Quantas pessoas vêm?',
        'Para quantas pessoas precisam da mesa?'
      ],
      negative: [
        'Entendo. Para quantas pessoas?',
        'Desculpe. Quantas pessoas serão?',
        'Entendo. Para quantos comensais?',
        'Desculpe. Quantas pessoas vêm?',
        'Entendo. Para quantas pessoas precisam da mesa?'
      ],
      frustrated: [
        'Rápido, quantas pessoas?',
        'Quantas pessoas? Preciso saber agora.',
        'Para quantas pessoas? Diga rápido.',
        'Quantas pessoas? Preciso saber imediatamente.',
        'Para quantas pessoas? Rápido, por favor.'
      ]
    }
  },

  ask_people_error: {
    es: {
      positive: [
        'Disculpe, no entendí. ¿Para cuántas personas?',
        '¿Podría repetir? ¿Cuántas personas serán?',
        'No entendí bien. ¿Para cuántas personas?',
        '¿Cuántas personas serán? Dígalo despacio.',
        'Disculpe, no capté. ¿Para cuántas personas?'
      ],
      neutral: [
        'No entendí bien. ¿Para cuántas personas?',
        '¿Cuántas personas serán?',
        'No capté bien. ¿Para cuántas personas?',
        '¿Podría repetir? ¿Cuántas personas?',
        'No entendí. ¿Para cuántas personas?'
      ],
      negative: [
        'Disculpe, no capté. ¿Para cuántas personas?',
        '¿Podría repetir? ¿Cuántas personas?',
        'No entendí bien. ¿Para cuántas personas?',
        'Disculpe, no escuché bien. ¿Para cuántas personas?',
        'No capté. ¿Para cuántas personas?'
      ],
      frustrated: [
        'Rápido, ¿cuántas personas?',
        '¿Cuántas personas? Dígalo claro.',
        '¿Para cuántas personas? Rápido.',
        '¿Cuántas personas? Claro y rápido.',
        '¿Para cuántas personas? Necesito saberlo ya.'
      ]
    },
    en: {
      positive: [
        'Sorry, I didn\'t understand. For how many people?',
        'Could you repeat? How many people will it be?',
        'I didn\'t get that. For how many people?',
        'How many people will it be? Say it slowly.',
        'Sorry, I didn\'t catch that. For how many people?'
      ],
      neutral: [
        'I didn\'t get that. For how many people?',
        'How many people will it be?',
        'I didn\'t catch that. For how many people?',
        'Could you repeat? How many people?',
        'I didn\'t understand. For how many people?'
      ],
      negative: [
        'Sorry, I didn\'t catch that. For how many people?',
        'Could you repeat? How many people?',
        'I didn\'t get that. For how many people?',
        'Sorry, I didn\'t hear well. For how many people?',
        'I didn\'t catch that. For how many people?'
      ],
      frustrated: [
        'Quick, how many people?',
        'How many people? Say it clearly.',
        'For how many people? Quick.',
        'How many people? Clear and quick.',
        'For how many people? I need to know now.'
      ]
    },
    de: {
      positive: [
        'Entschuldigung, ich habe nicht verstanden. Für wie viele Personen?',
        'Könnten Sie wiederholen? Wie viele Personen werden es sein?',
        'Ich habe das nicht verstanden. Für wie viele Personen?',
        'Wie viele Personen werden es sein? Sagen Sie es langsam.',
        'Entschuldigung, ich habe das nicht erfasst. Für wie viele Personen?'
      ],
      neutral: [
        'Ich habe das nicht verstanden. Für wie viele Personen?',
        'Wie viele Personen werden es sein?',
        'Ich habe das nicht erfasst. Für wie viele Personen?',
        'Könnten Sie wiederholen? Wie viele Personen?',
        'Ich habe nicht verstanden. Für wie viele Personen?'
      ],
      negative: [
        'Entschuldigung, ich habe das nicht erfasst. Für wie viele Personen?',
        'Könnten Sie wiederholen? Wie viele Personen?',
        'Ich habe das nicht verstanden. Für wie viele Personen?',
        'Entschuldigung, ich habe nicht gut gehört. Für wie viele Personen?',
        'Ich habe das nicht erfasst. Für wie viele Personen?'
      ],
      frustrated: [
        'Schnell, wie viele Personen?',
        'Wie viele Personen? Sagen Sie es klar.',
        'Für wie viele Personen? Schnell.',
        'Wie viele Personen? Klar und schnell.',
        'Für wie viele Personen? Ich muss es jetzt wissen.'
      ]
    },
    it: {
      positive: [
        'Scusi, non ho capito. Per quante persone?',
        'Potrebbe ripetere? Quante persone saranno?',
        'Non ho capito. Per quante persone?',
        'Quante persone saranno? Dica lentamente.',
        'Scusi, non ho sentito. Per quante persone?'
      ],
      neutral: [
        'Non ho capito. Per quante persone?',
        'Quante persone saranno?',
        'Non ho sentito. Per quante persone?',
        'Potrebbe ripetere? Quante persone?',
        'Non ho capito. Per quante persone?'
      ],
      negative: [
        'Scusi, non ho sentito. Per quante persone?',
        'Potrebbe ripetere? Quante persone?',
        'Non ho capito. Per quante persone?',
        'Scusi, non ho sentito bene. Per quante persone?',
        'Non ho sentito. Per quante persone?'
      ],
      frustrated: [
        'Veloce, quante persone?',
        'Quante persone? Dica chiaramente.',
        'Per quante persone? Veloce.',
        'Quante persone? Chiaro e veloce.',
        'Per quante persone? Devo saperlo ora.'
      ]
    },
    fr: {
      positive: [
        'Désolé, je n\'ai pas compris. Pour combien de personnes?',
        'Pourriez-vous répéter? Combien de personnes seront-ce?',
        'Je n\'ai pas compris. Pour combien de personnes?',
        'Combien de personnes seront-ce? Dites-le lentement.',
        'Désolé, je n\'ai pas saisi. Pour combien de personnes?'
      ],
      neutral: [
        'Je n\'ai pas compris. Pour combien de personnes?',
        'Combien de personnes seront-ce?',
        'Je n\'ai pas saisi. Pour combien de personnes?',
        'Pourriez-vous répéter? Combien de personnes?',
        'Je n\'ai pas compris. Pour combien de personnes?'
      ],
      negative: [
        'Désolé, je n\'ai pas saisi. Pour combien de personnes?',
        'Pourriez-vous répéter? Combien de personnes?',
        'Je n\'ai pas compris. Pour combien de personnes?',
        'Désolé, je n\'ai pas bien entendu. Pour combien de personnes?',
        'Je n\'ai pas saisi. Pour combien de personnes?'
      ],
      frustrated: [
        'Rapidement, combien de personnes?',
        'Combien de personnes? Dites-le clairement.',
        'Pour combien de personnes? Rapidement.',
        'Combien de personnes? Clair et rapide.',
        'Pour combien de personnes? Je dois le savoir maintenant.'
      ]
    },
    pt: {
      positive: [
        'Desculpe, não entendi. Para quantas pessoas?',
        'Poderia repetir? Quantas pessoas serão?',
        'Não entendi. Para quantas pessoas?',
        'Quantas pessoas serão? Diga devagar.',
        'Desculpe, não captei. Para quantas pessoas?'
      ],
      neutral: [
        'Não entendi. Para quantas pessoas?',
        'Quantas pessoas serão?',
        'Não captei. Para quantas pessoas?',
        'Poderia repetir? Quantas pessoas?',
        'Não entendi. Para quantas pessoas?'
      ],
      negative: [
        'Desculpe, não captei. Para quantas pessoas?',
        'Poderia repetir? Quantas pessoas?',
        'Não entendi. Para quantas pessoas?',
        'Desculpe, não ouvi bem. Para quantas pessoas?',
        'Não captei. Para quantas pessoas?'
      ],
      frustrated: [
        'Rápido, quantas pessoas?',
        'Quantas pessoas? Diga claramente.',
        'Para quantas pessoas? Rápido.',
        'Quantas pessoas? Claro e rápido.',
        'Para quantas pessoas? Preciso saber agora.'
      ]
    }
  }
};

module.exports = RESPONSES_OPTIMIZED;
