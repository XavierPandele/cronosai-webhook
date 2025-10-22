const { createConnection } = require('../lib/database');
const { combinarFechaHora, validarReserva } = require('../lib/utils');

// Estados de conversación
const conversationStates = new Map();

// Respuestas optimizadas y naturales
const RESPONSES = {
  greeting: {
    es: [
      '¡Hola! Bienvenido a nuestro restaurante. ¿Para cuántas personas necesitan mesa?',
      '¡Buenos días! ¿Cuántas personas serán para la reserva?',
      '¡Hola! ¿Para cuántos comensales?',
      '¡Saludos! ¿Cuántas personas en su grupo?',
      '¡Hola! ¿Para cuántas personas es la reserva?'
    ],
    en: [
      'Hello! Welcome to our restaurant. How many people will be dining?',
      'Good day! How many guests are we expecting?',
      'Hi there! How many people in your party?',
      'Hello! How many diners will we have?',
      'Good morning! How many people for the reservation?'
    ],
    de: [
      'Hallo! Willkommen in unserem Restaurant. Für wie viele Personen?',
      'Guten Tag! Wie viele Gäste erwarten wir?',
      'Hallo! Wie viele Personen in Ihrer Gruppe?',
      'Guten Morgen! Für wie viele Personen reservieren Sie?',
      'Hallo! Wie viele Gäste werden es sein?'
    ],
    it: [
      'Ciao! Benvenuto nel nostro ristorante. Per quante persone?',
      'Buongiorno! Quanti ospiti aspettiamo?',
      'Ciao! Quante persone nel vostro gruppo?',
      'Salve! Per quante persone prenotate?',
      'Ciao! Quanti ospiti saranno?'
    ],
    fr: [
      'Bonjour! Bienvenue dans notre restaurant. Pour combien de personnes?',
      'Bonjour! Combien d\'invités attendons-nous?',
      'Salut! Combien de personnes dans votre groupe?',
      'Bonjour! Pour combien de personnes réservez-vous?',
      'Salut! Combien d\'invités seront là?'
    ],
    pt: [
      'Olá! Bem-vindo ao nosso restaurante. Para quantas pessoas?',
      'Bom dia! Quantos convidados esperamos?',
      'Oi! Quantas pessoas no seu grupo?',
      'Olá! Para quantas pessoas está reservando?',
      'Oi! Quantos convidados serão?'
    ]
  },
  ask_date: {
    es: [
      'Perfecto. ¿Para qué día necesitan la mesa?',
      'Excelente. ¿Qué fecha prefieren?',
      'Genial. ¿Para cuándo es la reserva?',
      'Muy bien. ¿Qué día les conviene?',
      'Perfecto. ¿Cuándo quieren venir?'
    ],
    en: [
      'Perfect. What day do you need the table?',
      'Great. What date works for you?',
      'Excellent. When would you like to come?',
      'Wonderful. What day suits you?',
      'Perfect. When do you want to dine?'
    ],
    de: [
      'Perfekt. Für welchen Tag brauchen Sie den Tisch?',
      'Großartig. Welches Datum passt Ihnen?',
      'Ausgezeichnet. Wann möchten Sie kommen?',
      'Wunderbar. Welcher Tag passt Ihnen?',
      'Perfekt. Wann möchten Sie essen?'
    ],
    it: [
      'Perfetto. Per quale giorno avete bisogno del tavolo?',
      'Ottimo. Quale data vi conviene?',
      'Eccellente. Quando vorreste venire?',
      'Meraviglioso. Quale giorno vi va bene?',
      'Perfetto. Quando volete cenare?'
    ],
    fr: [
      'Parfait. Pour quel jour avez-vous besoin de la table?',
      'Excellent. Quelle date vous convient?',
      'Parfait. Quand aimeriez-vous venir?',
      'Merveilleux. Quel jour vous arrange?',
      'Parfait. Quand voulez-vous dîner?'
    ],
    pt: [
      'Perfeito. Para que dia precisam da mesa?',
      'Ótimo. Que data lhes convém?',
      'Excelente. Quando gostariam de vir?',
      'Maravilhoso. Que dia lhes serve?',
      'Perfeito. Quando querem jantar?'
    ]
  },
  ask_time: {
    es: [
      '¿A qué hora prefieren venir?',
      '¿Qué hora les conviene?',
      '¿A qué hora quieren la mesa?',
      '¿Cuál es su hora preferida?',
      '¿A qué hora desean cenar?'
    ],
    en: [
      'What time would you prefer?',
      'What time works for you?',
      'What time do you want the table?',
      'What\'s your preferred time?',
      'What time would you like to dine?'
    ],
    de: [
      'Um welche Uhrzeit möchten Sie kommen?',
      'Welche Zeit passt Ihnen?',
      'Um welche Uhrzeit brauchen Sie den Tisch?',
      'Was ist Ihre bevorzugte Zeit?',
      'Um welche Uhrzeit möchten Sie essen?'
    ],
    it: [
      'A che ora preferite venire?',
      'Che ora vi conviene?',
      'A che ora volete il tavolo?',
      'Qual è il vostro orario preferito?',
      'A che ora volete cenare?'
    ],
    fr: [
      'À quelle heure préférez-vous venir?',
      'Quelle heure vous convient?',
      'À quelle heure voulez-vous la table?',
      'Quel est votre horaire préféré?',
      'À quelle heure voulez-vous dîner?'
    ],
    pt: [
      'A que hora preferem vir?',
      'Que hora lhes convém?',
      'A que hora querem a mesa?',
      'Qual é o seu horário preferido?',
      'A que hora querem jantar?'
    ]
  },
  ask_name: {
    es: [
      '¿Cómo se llama la persona que hace la reserva?',
      '¿Cuál es el nombre para la reserva?',
      '¿Bajo qué nombre reservamos?',
      '¿Cómo debo anotar el nombre?',
      '¿Cuál es su nombre completo?'
    ],
    en: [
      'What\'s the name for the reservation?',
      'Who should I put the reservation under?',
      'What name should I use?',
      'How should I note the name?',
      'What\'s your full name?'
    ],
    de: [
      'Unter welchem Namen soll ich reservieren?',
      'Wie ist der Name für die Reservierung?',
      'Welchen Namen soll ich verwenden?',
      'Wie soll ich den Namen notieren?',
      'Wie ist Ihr vollständiger Name?'
    ],
    it: [
      'Sotto quale nome devo prenotare?',
      'Qual è il nome per la prenotazione?',
      'Che nome devo usare?',
      'Come devo annotare il nome?',
      'Qual è il vostro nome completo?'
    ],
    fr: [
      'Sous quel nom dois-je réserver?',
      'Quel est le nom pour la réservation?',
      'Quel nom dois-je utiliser?',
      'Comment dois-je noter le nom?',
      'Quel est votre nom complet?'
    ],
    pt: [
      'Sob qual nome devo reservar?',
      'Qual é o nome para a reserva?',
      'Que nome devo usar?',
      'Como devo anotar o nome?',
      'Qual é o seu nome completo?'
    ]
  },
  ask_phone: {
    es: [
      '¿Usamos este número de teléfono para confirmar?',
      '¿Este es el número de contacto correcto?',
      '¿Confirmamos con este teléfono?',
      '¿Este número está bien para avisos?',
      '¿Usamos este teléfono para la confirmación?'
    ],
    en: [
      'Should we use this phone number for confirmation?',
      'Is this the correct contact number?',
      'Do we confirm with this phone?',
      'Is this number good for notifications?',
      'Do we use this phone for confirmation?'
    ],
    de: [
      'Sollen wir diese Telefonnummer zur Bestätigung verwenden?',
      'Ist das die richtige Kontaktnummer?',
      'Bestätigen wir mit diesem Telefon?',
      'Ist diese Nummer gut für Benachrichtigungen?',
      'Verwenden wir dieses Telefon zur Bestätigung?'
    ],
    it: [
      'Dovremmo usare questo numero di telefono per la conferma?',
      'È questo il numero di contatto corretto?',
      'Confermiamo con questo telefono?',
      'Questo numero va bene per le notifiche?',
      'Usiamo questo telefono per la conferma?'
    ],
    fr: [
      'Devons-nous utiliser ce numéro de téléphone pour la confirmation?',
      'Est-ce le bon numéro de contact?',
      'Confirmons-nous avec ce téléphone?',
      'Ce numéro est-il bon pour les notifications?',
      'Utilisons-nous ce téléphone pour la confirmation?'
    ],
    pt: [
      'Devemos usar este número de telefone para confirmação?',
      'Este é o número de contato correto?',
      'Confirmamos com este telefone?',
      'Este número serve para notificações?',
      'Usamos este telefone para confirmação?'
    ]
  },
  complete: {
    es: [
      '¡Reserva confirmada! Los esperamos con gusto.',
      '¡Perfecto! Su mesa está reservada. ¡Hasta pronto!',
      '¡Excelente! Reserva lista. ¡Nos vemos pronto!',
      '¡Confirmado! Su reserva está lista. ¡Buen provecho!',
      '¡Listo! Mesa reservada. ¡Que disfruten!'
    ],
    en: [
      'Reservation confirmed! We look forward to seeing you.',
      'Perfect! Your table is reserved. See you soon!',
      'Excellent! Reservation is ready. See you soon!',
      'Confirmed! Your reservation is set. Enjoy!',
      'Done! Table reserved. Have a great time!'
    ],
    de: [
      'Reservierung bestätigt! Wir freuen uns auf Sie.',
      'Perfekt! Ihr Tisch ist reserviert. Bis bald!',
      'Ausgezeichnet! Reservierung ist bereit. Bis bald!',
      'Bestätigt! Ihre Reservierung ist festgelegt. Viel Spaß!',
      'Fertig! Tisch reserviert. Haben Sie eine schöne Zeit!'
    ],
    it: [
      'Prenotazione confermata! Non vediamo l\'ora di vedervi.',
      'Perfetto! Il vostro tavolo è prenotato. A presto!',
      'Eccellente! La prenotazione è pronta. A presto!',
      'Confermato! La vostra prenotazione è fissata. Buon appetito!',
      'Fatto! Tavolo prenotato. Divertitevi!'
    ],
    fr: [
      'Réservation confirmée! Nous avons hâte de vous voir.',
      'Parfait! Votre table est réservée. À bientôt!',
      'Excellent! La réservation est prête. À bientôt!',
      'Confirmé! Votre réservation est fixée. Bon appétit!',
      'Terminé! Table réservée. Amusez-vous bien!'
    ],
    pt: [
      'Reserva confirmada! Esperamos vê-los.',
      'Perfeito! Sua mesa está reservada. Até logo!',
      'Excelente! A reserva está pronta. Até logo!',
      'Confirmado! Sua reserva está marcada. Bom apetite!',
      'Pronto! Mesa reservada. Divirtam-se!'
    ]
  }
};

// Detectar idioma con sistema exhaustivo de patrones
function detectLanguage(text) {
  console.log(`[IDIOMA] Detectando idioma en: "${text}"`);
  
  // Sistema de puntuación por idioma
  const scores = { es: 0, en: 0, de: 0, it: 0, fr: 0, pt: 0 };
  
  // Si el texto está vacío o es muy corto, usar español por defecto
  if (!text || text.trim().length < 2) {
    console.log(`[IDIOMA] Texto vacío o muy corto, usando español por defecto`);
    return 'es';
  }
  
  // ESPAÑOL - Patrones exhaustivos
  const spanishPatterns = [
    // Saludos
    'hola', 'buenos días', 'buenas tardes', 'buenas noches', 'buenos', 'buenas',
    'saludos', 'hey', 'oye', 'eh',
    
    // Palabras de cortesía
    'gracias', 'por favor', 'disculpe', 'perdón', 'lo siento', 'con permiso',
    'muchas gracias', 'de nada', 'no hay de qué',
    
    // Afirmaciones y negaciones
    'sí', 'no', 'claro', 'por supuesto', 'obvio', 'exacto', 'correcto',
    'perfecto', 'genial', 'excelente', 'fantástico', 'maravilloso',
    
    // Reservas y restaurante
    'reservar', 'reserva', 'mesa', 'mesas', 'restaurante', 'comer', 'cenar',
    'almorzar', 'desayunar', 'personas', 'comensales', 'gente', 'grupo',
    'fecha', 'día', 'hora', 'momento', 'nombre', 'teléfono', 'contacto',
    
    // Tiempo
    'mañana', 'pasado mañana', 'hoy', 'ahora', 'después', 'más tarde',
    'temprano', 'tarde', 'noche', 'mediodía', 'medianoche',
    
    // Números en palabras
    'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
    'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
    'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte',
    
    // Días de la semana
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
    
    // Meses
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    
    // Expresiones comunes
    'me gustaría', 'quisiera', 'necesito', 'quiero', 'deseo', 'prefiero',
    'para cuántas', 'cuántas personas', 'cuántos', 'para cuándo',
    'a qué hora', 'qué día', 'qué fecha', 'cuál es', 'cómo se llama',
    
    // Correcciones
    'mejor', 'cambiar', 'corregir', 'modificar', 'actualizar', 'no mejor',
    'espera', 'perdón', 'disculpa', 'mejor para', 'cambio a'
  ];
  
  // INGLÉS - Patrones exhaustivos
  const englishPatterns = [
    // Greetings
    'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
    'good day', 'good', 'morning', 'afternoon', 'evening',
    
    // Courtesy
    'thanks', 'thank you', 'please', 'excuse me', 'sorry', 'pardon',
    'you\'re welcome', 'no problem', 'of course',
    
    // Affirmations and negations
    'yes', 'no', 'sure', 'of course', 'obviously', 'exactly', 'right',
    'perfect', 'great', 'excellent', 'fantastic', 'wonderful', 'amazing',
    
    // Reservations and restaurant
    'book', 'booking', 'reserve', 'reservation', 'table', 'tables', 'restaurant',
    'eat', 'dinner', 'lunch', 'breakfast', 'people', 'guests', 'party',
    'date', 'day', 'time', 'moment', 'name', 'phone', 'contact',
    
    // Time
    'tomorrow', 'day after tomorrow', 'today', 'now', 'later', 'early',
    'late', 'night', 'noon', 'midnight', 'around', 'about',
    
    // Numbers in words
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
    
    // Days of the week
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    
    // Months
    'january', 'february', 'march', 'april', 'may', 'june', 'july',
    'august', 'september', 'october', 'november', 'december',
    
    // Common expressions
    'i would like', 'i\'d like', 'i need', 'i want', 'i wish', 'i prefer',
    'for how many', 'how many people', 'how many', 'for when',
    'at what time', 'what day', 'what date', 'what is', 'what\'s your name',
    
    // Corrections
    'better', 'change', 'correct', 'modify', 'update', 'no better',
    'wait', 'sorry', 'change to', 'better for'
  ];
  
  // ALEMÁN - Patrones exhaustivos
  const germanPatterns = [
    // Grüße
    'hallo', 'guten tag', 'guten morgen', 'guten abend', 'guten', 'morgen',
    'abend', 'tag', 'hey', 'hi',
    
    // Höflichkeit
    'danke', 'bitte', 'entschuldigung', 'verzeihung', 'tut mir leid',
    'gern geschehen', 'kein problem', 'natürlich',
    
    // Bejahungen und Verneinungen
    'ja', 'nein', 'sicher', 'natürlich', 'offensichtlich', 'genau', 'richtig',
    'perfekt', 'großartig', 'ausgezeichnet', 'fantastisch', 'wunderbar',
    
    // Reservierungen und Restaurant
    'buchen', 'buchung', 'reservieren', 'reservierung', 'tisch', 'tische',
    'restaurant', 'essen', 'abendessen', 'mittagessen', 'frühstück',
    'personen', 'gäste', 'gruppe', 'datum', 'tag', 'zeit', 'moment',
    'name', 'telefon', 'kontakt',
    
    // Zeit
    'morgen', 'übermorgen', 'heute', 'jetzt', 'später', 'früh', 'spät',
    'nacht', 'mittag', 'mitternacht', 'um', 'gegen',
    
    // Zahlen in Wörtern
    'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht',
    'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn',
    'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn', 'zwanzig',
    
    // Wochentage
    'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
    
    // Monate
    'januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli',
    'august', 'september', 'oktober', 'november', 'dezember',
    
    // Häufige Ausdrücke
    'ich möchte', 'ich brauche', 'ich will', 'ich wünsche', 'ich bevorzuge',
    'für wie viele', 'wie viele personen', 'wie viele', 'für wann',
    'um welche uhrzeit', 'welcher tag', 'welches datum', 'wie ist', 'wie heißt',
    
    // Korrekturen
    'besser', 'ändern', 'korrigieren', 'modifizieren', 'aktualisieren',
    'warte', 'entschuldigung', 'ändern zu', 'besser für'
  ];
  
  // ITALIANO - Patrones exhaustivos
  const italianPatterns = [
    // Saluti
    'ciao', 'buongiorno', 'buon pomeriggio', 'buonasera', 'buona', 'giorno',
    'pomeriggio', 'sera', 'hey', 'salve',
    
    // Cortesia
    'grazie', 'per favore', 'scusi', 'mi dispiace', 'prego', 'di niente',
    'nessun problema', 'naturalmente',
    
    // Affermazioni e negazioni
    'sì', 'no', 'certo', 'naturalmente', 'ovviamente', 'esatto', 'giusto',
    'perfetto', 'grande', 'eccellente', 'fantastico', 'meraviglioso',
    
    // Prenotazioni e ristorante
    'prenotare', 'prenotazione', 'riservare', 'riservazione', 'tavolo', 'tavoli',
    'ristorante', 'mangiare', 'cena', 'pranzo', 'colazione', 'persone',
    'ospiti', 'gruppo', 'data', 'giorno', 'ora', 'momento', 'nome',
    'telefono', 'contatto',
    
    // Tempo
    'domani', 'dopodomani', 'oggi', 'ora', 'dopo', 'presto', 'tardi',
    'notte', 'mezzogiorno', 'mezzanotte', 'verso', 'intorno',
    
    // Numeri in parole
    'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto',
    'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici',
    'sedici', 'diciassette', 'diciotto', 'diciannove', 'venti',
    
    // Giorni della settimana
    'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica',
    
    // Mesi
    'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
    'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
    
    // Espressioni comuni
    'vorrei', 'ho bisogno', 'voglio', 'desidero', 'preferisco',
    'per quante', 'quante persone', 'quante', 'per quando',
    'a che ora', 'che giorno', 'che data', 'qual è', 'come si chiama',
    
    // Correzioni
    'meglio', 'cambiare', 'correggere', 'modificare', 'aggiornare',
    'aspetta', 'scusa', 'cambiare a', 'meglio per'
  ];
  
  // FRANCÉS - Patrones exhaustivos
  const frenchPatterns = [
    // Salutations
    'bonjour', 'bonsoir', 'salut', 'bon', 'jour', 'soir', 'hey', 'coucou',
    
    // Politesse
    'merci', 's\'il vous plaît', 'excusez-moi', 'désolé', 'pardon', 'de rien',
    'pas de problème', 'bien sûr',
    
    // Affirmations et négations
    'oui', 'non', 'bien sûr', 'évidemment', 'exactement', 'correct',
    'parfait', 'génial', 'excellent', 'fantastique', 'merveilleux',
    
    // Réservations et restaurant
    'réserver', 'réservation', 'table', 'tables', 'restaurant', 'manger',
    'dîner', 'déjeuner', 'petit-déjeuner', 'personnes', 'invités', 'groupe',
    'date', 'jour', 'heure', 'moment', 'nom', 'téléphone', 'contact',
    
    // Temps
    'demain', 'après-demain', 'aujourd\'hui', 'maintenant', 'plus tard',
    'tôt', 'tard', 'nuit', 'midi', 'minuit', 'vers', 'autour',
    
    // Nombres en mots
    'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit',
    'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze',
    'seize', 'dix-sept', 'dix-huit', 'dix-neuf', 'vingt',
    
    // Jours de la semaine
    'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
    
    // Mois
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
    'août', 'septembre', 'octobre', 'novembre', 'décembre',
    
    // Expressions communes
    'je voudrais', 'j\'aimerais', 'j\'ai besoin', 'je veux', 'je souhaite',
    'pour combien', 'combien de personnes', 'combien', 'pour quand',
    'à quelle heure', 'quel jour', 'quelle date', 'quel est', 'comment vous appelez',
    
    // Corrections
    'mieux', 'changer', 'corriger', 'modifier', 'mettre à jour',
    'attendez', 'désolé', 'changer à', 'mieux pour'
  ];
  
  // PORTUGUÉS - Patrones exhaustivos
  const portuguesePatterns = [
    // Cumprimentos
    'olá', 'bom dia', 'boa tarde', 'boa noite', 'bom', 'dia', 'tarde',
    'noite', 'oi', 'e aí', 'hey',
    
    // Cortesia
    'obrigado', 'obrigada', 'por favor', 'desculpe', 'me desculpe', 'sinto muito',
    'de nada', 'não há de quê', 'sem problemas', 'claro',
    
    // Afirmações e negações
    'sim', 'não', 'claro', 'obviamente', 'exatamente', 'certo',
    'perfeito', 'ótimo', 'excelente', 'fantástico', 'maravilhoso',
    
    // Reservas e restaurante
    'reservar', 'reserva', 'mesa', 'mesas', 'restaurante', 'comer',
    'jantar', 'almoçar', 'café da manhã', 'pessoas', 'convidados', 'grupo',
    'data', 'dia', 'hora', 'momento', 'nome', 'telefone', 'contato',
    
    // Tempo
    'amanhã', 'depois de amanhã', 'hoje', 'agora', 'depois', 'cedo',
    'tarde', 'noite', 'meio-dia', 'meia-noite', 'por volta', 'cerca',
    
    // Números em palavras
    'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito',
    'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze',
    'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte',
    
    // Dias da semana
    'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo',
    
    // Meses
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
    'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    
    // Expressões comuns
    'gostaria', 'preciso', 'quero', 'desejo', 'prefiro',
    'para quantas', 'quantas pessoas', 'quantas', 'para quando',
    'que horas', 'que dia', 'que data', 'qual é', 'como se chama',
    
    // Correções
    'melhor', 'mudar', 'corrigir', 'modificar', 'atualizar',
    'espere', 'desculpe', 'mudar para', 'melhor para'
  ];
  
  // Calcular puntuaciones
  const allPatterns = {
    es: spanishPatterns,
    en: englishPatterns,
    de: germanPatterns,
    it: italianPatterns,
    fr: frenchPatterns,
    pt: portuguesePatterns
  };
  
  for (const [lang, patterns] of Object.entries(allPatterns)) {
    for (const pattern of patterns) {
      const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      if (regex.test(text)) {
        scores[lang]++;
      }
    }
  }
  
  // Buscar el idioma con mayor puntuación
  let maxScore = 0;
  let detectedLang = 'es'; // Default
  
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedLang = lang;
    }
  }
  
  console.log(`[IDIOMA] Puntuaciones:`, scores);
  console.log(`[IDIOMA] Detectado: ${detectedLang} (puntuación: ${maxScore})`);
  
  // Validaciones adicionales para evitar confusiones
  if (maxScore === 0) {
    console.log(`[IDIOMA] Sin puntuación, usando español por defecto`);
    return 'es';
  }
  
  // Si hay empate, usar español por defecto
  const tiedLanguages = Object.entries(scores).filter(([lang, score]) => score === maxScore);
  if (tiedLanguages.length > 1) {
    console.log(`[IDIOMA] Empate detectado, usando español por defecto`);
    return 'es';
  }
  
  // Validaciones específicas para idiomas similares
  if (detectedLang === 'pt' && scores.es > 0) {
    // Si hay puntuación en español, preferir español
    if (scores.es >= maxScore * 0.8) {
      console.log(`[IDIOMA] Portugués vs Español - prefiriendo español`);
      return 'es';
    }
  }
  
  if (detectedLang === 'it' && scores.es > 0) {
    // Si hay puntuación en español, preferir español
    if (scores.es >= maxScore * 0.8) {
      console.log(`[IDIOMA] Italiano vs Español - prefiriendo español`);
      return 'es';
    }
  }
  
  if (detectedLang === 'fr' && scores.es > 0) {
    // Si hay puntuación en español, preferir español
    if (scores.es >= maxScore * 0.8) {
      console.log(`[IDIOMA] Francés vs Español - prefiriendo español`);
      return 'es';
    }
  }
  
  return detectedLang;
}

// Extraer número de personas - SISTEMA SÚPER ROBUSTO
function extractPeople(text) {
  console.log(`[EXTRACCION] Extrayendo personas de: "${text}"`);
  
  // Palabras de corrección en todos los idiomas
  const correctionWords = [
    // Español
    'no', 'mejor', 'espera', 'espere', 'perdón', 'disculpa', 'corrijo', 'cambio',
    'no mejor', 'mejor para', 'cambio a', 'corregir', 'modificar',
    
    // Inglés
    'no', 'better', 'wait', 'sorry', 'change', 'correct', 'modify',
    'no better', 'better for', 'change to', 'correct to',
    
    // Alemán
    'nein', 'besser', 'warte', 'entschuldigung', 'ändern', 'korrigieren',
    'nicht besser', 'besser für', 'ändern zu', 'korrigieren zu',
    
    // Francés
    'non', 'mieux', 'attendez', 'désolé', 'changer', 'corriger',
    'pas mieux', 'mieux pour', 'changer à', 'corriger à',
    
    // Italiano
    'no', 'meglio', 'aspetta', 'scusa', 'cambiare', 'correggere',
    'non meglio', 'meglio per', 'cambiare a', 'correggere a',
    
    // Portugués
    'não', 'melhor', 'espera', 'desculpa', 'mudar', 'corrigir',
    'não melhor', 'melhor para', 'mudar para', 'corrigir para'
  ];
  
  const hasCorrection = correctionWords.some(word => text.toLowerCase().includes(word));
  
  // Sistema exhaustivo de números en palabras
  const wordNumbers = {
    // ESPAÑOL - Números completos
    'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10,
    'once': 11, 'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15,
    'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19, 'veinte': 20,
    
    // INGLÉS - Números completos
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
    
    // ALEMÁN - Números completos
    'eins': 1, 'zwei': 2, 'drei': 3, 'vier': 4, 'fünf': 5,
    'sechs': 6, 'sieben': 7, 'acht': 8, 'neun': 9, 'zehn': 10,
    'elf': 11, 'zwölf': 12, 'dreizehn': 13, 'vierzehn': 14, 'fünfzehn': 15,
    'sechzehn': 16, 'siebzehn': 17, 'achtzehn': 18, 'neunzehn': 19, 'zwanzig': 20,
    
    // FRANCÉS - Números completos
    'un': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10,
    'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15,
    'seize': 16, 'dix-sept': 17, 'dix-huit': 18, 'dix-neuf': 19, 'vingt': 20,
    
    // ITALIANO - Números completos
    'uno': 1, 'due': 2, 'tre': 3, 'quattro': 4, 'cinque': 5,
    'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10,
    'undici': 11, 'dodici': 12, 'tredici': 13, 'quattordici': 14, 'quindici': 15,
    'sedici': 16, 'diciassette': 17, 'diciotto': 18, 'diciannove': 19, 'venti': 20,
    
    // PORTUGUÉS - Números completos
    'um': 1, 'dois': 2, 'três': 3, 'quatro': 4, 'cinco': 5,
    'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10,
    'onze': 11, 'doze': 12, 'treze': 13, 'catorze': 14, 'quinze': 15,
    'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19, 'vinte': 20,
    
    // VARIACIONES Y SINÓNIMOS
    // Español
    'persona': 1, 'personas': 1, 'gente': 1, 'comensales': 1, 'invitados': 1,
    'solo': 1, 'sola': 1, 'pareja': 2, 'parejas': 2, 'familia': 4,
    
    // Inglés
    'person': 1, 'people': 1, 'guests': 1, 'diners': 1, 'party': 1,
    'alone': 1, 'couple': 2, 'family': 4, 'group': 4,
    
    // Alemán
    'person': 1, 'personen': 1, 'gäste': 1, 'gruppe': 1,
    'allein': 1, 'paar': 2, 'familie': 4,
    
    // Italiano
    'persona': 1, 'persone': 1, 'ospiti': 1, 'gruppo': 1,
    'solo': 1, 'coppia': 2, 'famiglia': 4,
    
    // Francés
    'personne': 1, 'personnes': 1, 'invités': 1, 'groupe': 1,
    'seul': 1, 'couple': 2, 'famille': 4,
    
    // Portugués
    'pessoa': 1, 'pessoas': 1, 'convidados': 1, 'grupo': 1,
    'sozinho': 1, 'casal': 2, 'família': 4
  };
  
  let foundNumbers = [];
  
  // Buscar números en palabras
  for (const [word, number] of Object.entries(wordNumbers)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    let match;
    while ((match = regex.exec(text)) !== null) {
      foundNumbers.push({ number, position: match.index });
    }
  }
  
  // Buscar números digitales
  const digitMatches = text.matchAll(/\b(\d+)\b/g);
  for (const match of digitMatches) {
    const count = parseInt(match[1]);
    if (count >= 1 && count <= 20) {
      foundNumbers.push({ number: count, position: match.index });
    }
  }
  
  // Buscar patrones específicos
  const patterns = [
    /(?:para|for|für|per|pour)\s*(\d+)/i,
    /(\d+)\s*(?:personas|people|personen|persone|personnes|pessoas)/i,
    /(?:mesa|table|tisch|tavolo|table|mesa)\s*(?:para|for|für|per|pour)?\s*(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = parseInt(match[1]);
      if (count >= 1 && count <= 20) {
        foundNumbers.push({ number: count, position: match.index });
      }
    }
  }
  
  console.log(`[EXTRACCION] Números encontrados:`, foundNumbers);
  
  if (foundNumbers.length === 0) return null;
  
  // Si hay corrección o múltiples números, tomar el último
  if (hasCorrection || foundNumbers.length > 1) {
    foundNumbers.sort((a, b) => b.position - a.position);
    console.log(`[EXTRACCION] Usando último número: ${foundNumbers[0].number}`);
    return foundNumbers[0].number;
  }
  
  console.log(`[EXTRACCION] Usando único número: ${foundNumbers[0].number}`);
  return foundNumbers[0].number;
}

// Extraer fecha - SISTEMA SÚPER ROBUSTO
function extractDate(text) {
  console.log(`[EXTRACCION] Extrayendo fecha de: "${text}"`);
  
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfterTomorrow = new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000);
  
  // Fechas relativas exhaustivas en todos los idiomas
  const relativeDates = {
    // ESPAÑOL
    'hoy': today, 'mañana': tomorrow, 'pasado mañana': dayAfterTomorrow,
    'esta noche': today, 'mañana por la noche': tomorrow,
    'el lunes': getNextWeekday(1), 'el martes': getNextWeekday(2),
    'el miércoles': getNextWeekday(3), 'el jueves': getNextWeekday(4),
    'el viernes': getNextWeekday(5), 'el sábado': getNextWeekday(6), 'el domingo': getNextWeekday(0),
    'el próximo lunes': getNextWeekday(1), 'el próximo martes': getNextWeekday(2),
    'el próximo miércoles': getNextWeekday(3), 'el próximo jueves': getNextWeekday(4),
    'el próximo viernes': getNextWeekday(5), 'el próximo sábado': getNextWeekday(6), 'el próximo domingo': getNextWeekday(0),
    
    // INGLÉS
    'today': today, 'tomorrow': tomorrow, 'day after tomorrow': dayAfterTomorrow,
    'tonight': today, 'tomorrow night': tomorrow,
    'monday': getNextWeekday(1), 'tuesday': getNextWeekday(2),
    'wednesday': getNextWeekday(3), 'thursday': getNextWeekday(4),
    'friday': getNextWeekday(5), 'saturday': getNextWeekday(6), 'sunday': getNextWeekday(0),
    'next monday': getNextWeekday(1), 'next tuesday': getNextWeekday(2),
    'next wednesday': getNextWeekday(3), 'next thursday': getNextWeekday(4),
    'next friday': getNextWeekday(5), 'next saturday': getNextWeekday(6), 'next sunday': getNextWeekday(0),
    
    // ALEMÁN
    'heute': today, 'morgen': tomorrow, 'übermorgen': dayAfterTomorrow,
    'heute abend': today, 'morgen abend': tomorrow,
    'montag': getNextWeekday(1), 'dienstag': getNextWeekday(2),
    'mittwoch': getNextWeekday(3), 'donnerstag': getNextWeekday(4),
    'freitag': getNextWeekday(5), 'samstag': getNextWeekday(6), 'sonntag': getNextWeekday(0),
    'nächster montag': getNextWeekday(1), 'nächster dienstag': getNextWeekday(2),
    'nächster mittwoch': getNextWeekday(3), 'nächster donnerstag': getNextWeekday(4),
    'nächster freitag': getNextWeekday(5), 'nächster samstag': getNextWeekday(6), 'nächster sonntag': getNextWeekday(0),
    
    // ITALIANO
    'oggi': today, 'domani': tomorrow, 'dopodomani': dayAfterTomorrow,
    'stasera': today, 'domani sera': tomorrow,
    'lunedì': getNextWeekday(1), 'martedì': getNextWeekday(2),
    'mercoledì': getNextWeekday(3), 'giovedì': getNextWeekday(4),
    'venerdì': getNextWeekday(5), 'sabato': getNextWeekday(6), 'domenica': getNextWeekday(0),
    'prossimo lunedì': getNextWeekday(1), 'prossimo martedì': getNextWeekday(2),
    'prossimo mercoledì': getNextWeekday(3), 'prossimo giovedì': getNextWeekday(4),
    'prossimo venerdì': getNextWeekday(5), 'prossimo sabato': getNextWeekday(6), 'prossimo domenica': getNextWeekday(0),
    
    // FRANCÉS
    'aujourd\'hui': today, 'demain': tomorrow, 'après-demain': dayAfterTomorrow,
    'ce soir': today, 'demain soir': tomorrow,
    'lundi': getNextWeekday(1), 'mardi': getNextWeekday(2),
    'mercredi': getNextWeekday(3), 'jeudi': getNextWeekday(4),
    'vendredi': getNextWeekday(5), 'samedi': getNextWeekday(6), 'dimanche': getNextWeekday(0),
    'prochain lundi': getNextWeekday(1), 'prochain mardi': getNextWeekday(2),
    'prochain mercredi': getNextWeekday(3), 'prochain jeudi': getNextWeekday(4),
    'prochain vendredi': getNextWeekday(5), 'prochain samedi': getNextWeekday(6), 'prochain dimanche': getNextWeekday(0),
    
    // PORTUGUÉS
    'hoje': today, 'amanhã': tomorrow, 'depois de amanhã': dayAfterTomorrow,
    'hoje à noite': today, 'amanhã à noite': tomorrow,
    'segunda': getNextWeekday(1), 'terça': getNextWeekday(2),
    'quarta': getNextWeekday(3), 'quinta': getNextWeekday(4),
    'sexta': getNextWeekday(5), 'sábado': getNextWeekday(6), 'domingo': getNextWeekday(0),
    'próxima segunda': getNextWeekday(1), 'próxima terça': getNextWeekday(2),
    'próxima quarta': getNextWeekday(3), 'próxima quinta': getNextWeekday(4),
    'próxima sexta': getNextWeekday(5), 'próximo sábado': getNextWeekday(6), 'próximo domingo': getNextWeekday(0)
  };
  
  // Función auxiliar para obtener el próximo día de la semana
  function getNextWeekday(weekday) {
    const today = new Date();
    const daysUntilTarget = (weekday - today.getDay() + 7) % 7;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
    return targetDate;
  }
  
  // Buscar fechas relativas
  for (const [phrase, date] of Object.entries(relativeDates)) {
    if (text.toLowerCase().includes(phrase)) {
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
    const match = text.match(pattern);
    if (match) {
      console.log(`[EXTRACCION] Fecha específica encontrada: ${match[0]}`);
      // Aquí podrías parsear la fecha específica
      return match[0]; // Por ahora devolvemos el texto encontrado
    }
  }
  
  console.log(`[EXTRACCION] No se encontró fecha`);
  return null;
}

// Extraer hora - SISTEMA SÚPER ROBUSTO
function extractTime(text) {
  console.log(`[EXTRACCION] Extrayendo hora de: "${text}"`);
  
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
    if (text.toLowerCase().includes(word)) {
      console.log(`[EXTRACCION] Hora en palabras detectada: ${word} = ${time}`);
      return time;
    }
  }
  
  // Buscar patrones de hora
  for (const pattern of timePatterns) {
    const match = text.match(pattern);
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
      
      // Validar hora
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        console.log(`[EXTRACCION] Hora detectada: ${time}`);
        return time;
      }
    }
  }
  
  console.log(`[EXTRACCION] No se encontró hora`);
  return null;
}

// Extraer nombre - SISTEMA SÚPER ROBUSTO
function extractName(text) {
  console.log(`[EXTRACCION] Extrayendo nombre de: "${text}"`);
  
  // Patrones exhaustivos en todos los idiomas
  const patterns = [
    // ESPAÑOL
    /(?:me llamo|soy|mi nombre es|me llaman|me dicen)\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+)/i,
    /(?:soy|es)\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ\s]+)/i,
    
    // INGLÉS
    /(?:my name is|i am|i'm|they call me|i'm called)\s+([a-zA-Z\s]+)/i,
    /(?:i am|it's)\s+([a-zA-Z\s]+)/i,
    
    // ALEMÁN
    /(?:ich heiße|ich bin|mein name ist|man nennt mich)\s+([a-zA-ZäöüßÄÖÜ\s]+)/i,
    /(?:ich bin|es ist)\s+([a-zA-ZäöüßÄÖÜ\s]+)/i,
    
    // ITALIANO
    /(?:mi chiamo|sono|il mio nome è|mi chiamano)\s+([a-zA-ZàèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ\s]+)/i,
    /(?:sono|è)\s+([a-zA-ZàèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ\s]+)/i,
    
    // FRANCÉS
    /(?:je m'appelle|je suis|mon nom est|on m'appelle)\s+([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s]+)/i,
    /(?:je suis|c'est)\s+([a-zA-ZàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ\s]+)/i,
    
    // PORTUGUÉS
    /(?:meu nome é|eu sou|me chamam|chamo-me)\s+([a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß\s]+)/i,
    /(?:eu sou|é)\s+([a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß\s]+)/i
  ];
  
  // Buscar patrones específicos
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1].trim();
      // Limpiar el nombre de palabras comunes
      const cleanName = name.replace(/\b(hola|hello|hi|gracias|thanks|por|for|favor|please|mucho|much|gusto|pleasure|encantado|pleased|nice|meet|conocer|to meet)\b/gi, '').trim();
      if (cleanName.length > 0) {
        console.log(`[EXTRACCION] Nombre detectado: ${cleanName}`);
        return cleanName;
      }
    }
  }
  
  // Palabras comunes a excluir
  const excludeWords = [
    // Español
    'hola', 'hello', 'hi', 'gracias', 'thanks', 'por', 'for', 'favor', 'please',
    'mucho', 'much', 'gusto', 'pleasure', 'encantado', 'pleased', 'nice', 'meet',
    'conocer', 'reservar', 'reserva', 'mesa', 'table', 'personas', 'people',
    'fecha', 'date', 'hora', 'time', 'nombre', 'name', 'teléfono', 'phone',
    'sí', 'yes', 'no', 'claro', 'sure', 'perfecto', 'perfect', 'genial', 'great',
    'excelente', 'excellent', 'fantástico', 'fantastic', 'maravilloso', 'wonderful',
    
    // Inglés
    'book', 'booking', 'reserve', 'reservation', 'dinner', 'lunch', 'breakfast',
    'tomorrow', 'today', 'tonight', 'morning', 'afternoon', 'evening',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    
    // Alemán
    'buchen', 'buchung', 'reservieren', 'reservierung', 'abendessen', 'mittagessen',
    'frühstück', 'morgen', 'heute', 'heute abend', 'montag', 'dienstag', 'mittwoch',
    'donnerstag', 'freitag', 'samstag', 'sonntag',
    
    // Italiano
    'prenotare', 'prenotazione', 'riservare', 'riservazione', 'cena', 'pranzo',
    'colazione', 'domani', 'oggi', 'stasera', 'lunedì', 'martedì', 'mercoledì',
    'giovedì', 'venerdì', 'sabato', 'domenica',
    
    // Francés
    'réserver', 'réservation', 'dîner', 'déjeuner', 'petit-déjeuner', 'demain',
    'aujourd\'hui', 'ce soir', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi',
    'samedi', 'dimanche',
    
    // Portugués
    'reservar', 'reserva', 'jantar', 'almoçar', 'café da manhã', 'amanhã',
    'hoje', 'hoje à noite', 'segunda', 'terça', 'quarta', 'quinta', 'sexta',
    'sábado', 'domingo'
  ];
  
  // Si no hay patrón, buscar palabras que parezcan nombres
  const words = text.split(/\s+/).filter(word => {
    const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
    return cleanWord.length > 2 && 
           /^[a-zA-ZáéíóúñüÁÉÍÓÚÑÜäöüßÄÖÜàèéìíîòóùúÀÈÉÌÍÎÒÓÙÚàâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞß]+$/.test(cleanWord) &&
           !excludeWords.includes(cleanWord);
  });
  
  if (words.length > 0) {
    const name = words[0];
    console.log(`[EXTRACCION] Nombre por palabra: ${name}`);
    return name;
  }
  
  console.log(`[EXTRACCION] No se encontró nombre`);
  return null;
}

// Generar respuesta natural
function generateResponse(step, language) {
  console.log(`[RESPUESTA] Generando para paso: ${step}, idioma: ${language}`);
  
  const responses = RESPONSES[step]?.[language] || RESPONSES[step]?.['es'];
  if (responses && Array.isArray(responses)) {
    const selected = responses[Math.floor(Math.random() * responses.length)];
    console.log(`[RESPUESTA] Seleccionada: "${selected}"`);
    return selected;
  }
  
  return '¿En qué puedo ayudarle?';
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
  <Gather input="speech" language="${config.language}" timeout="8" speechTimeout="5" action="/api/twilio-call-final" method="POST">
    <Say voice="${config.voice}" language="${config.language}">
      ${getWaitMessage(language)}
    </Say>
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

// Guardar reserva
async function saveReservation(state) {
  try {
    console.log('[GUARDAR] Iniciando guardado de reserva...');
    console.log('[GUARDAR] Datos:', state.data);
    
    // Validar datos
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
        'Reserva por teléfono - Sistema Final',
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

// Función principal
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { From, SpeechResult } = req.body;
  const userInput = SpeechResult || '';
  
  console.log(`[LLAMADA] De: ${From}`);
  console.log(`[LLAMADA] Input: "${userInput}"`);
  
  // Obtener o crear estado de conversación
  let state = conversationStates.get(From) || {
    step: 'greeting',
    language: null,
    data: {},
    conversationHistory: []
  };
  
  // Detectar idioma - SISTEMA SÚPER AGRESIVO
  if (!state.language && userInput) {
    state.language = detectLanguage(userInput);
    console.log(`[IDIOMA] Idioma detectado y bloqueado: ${state.language}`);
    
    // Si detectamos un idioma diferente al español, forzar el cambio
    if (state.language !== 'es') {
      console.log(`[IDIOMA] Forzando idioma: ${state.language}`);
      // El idioma se mantendrá durante toda la conversación
    }
  } else if (state.language && userInput) {
    // Si ya tenemos idioma, solo cambiar si hay evidencia muy clara
    const newLanguage = detectLanguage(userInput);
    if (newLanguage !== state.language) {
      console.log(`[IDIOMA] Idioma actual: ${state.language}, nuevo: ${newLanguage}`);
      // Solo cambiar si la nueva detección tiene mucha más confianza
      // Por ahora, mantener el idioma original para evitar saltos
      console.log(`[IDIOMA] Manteniendo idioma original: ${state.language}`);
    }
  }
  
  // Si no se detectó idioma, usar español por defecto
  if (!state.language) {
    state.language = 'es';
    console.log(`[IDIOMA] Usando español por defecto`);
  }
  
  // Procesar según el paso actual
  let response = '';
  
  try {
    switch (state.step) {
      case 'greeting':
        state.step = 'ask_people';
        response = generateResponse('greeting', state.language);
        break;
        
      case 'ask_people':
        const people = extractPeople(userInput);
        if (people) {
          state.data.people = people;
          state.step = 'ask_date';
          response = generateResponse('ask_date', state.language);
        } else {
          response = generateResponse('ask_people', state.language);
        }
        break;
        
      case 'ask_date':
        const date = extractDate(userInput);
        if (date) {
          state.data.date = date;
          state.step = 'ask_time';
          response = generateResponse('ask_time', state.language);
        } else {
          response = generateResponse('ask_date', state.language);
        }
        break;
        
      case 'ask_time':
        const time = extractTime(userInput);
        if (time) {
          state.data.time = time;
          state.step = 'ask_name';
          response = generateResponse('ask_name', state.language);
        } else {
          response = generateResponse('ask_time', state.language);
        }
        break;
        
      case 'ask_name':
        const name = extractName(userInput);
        if (name) {
          state.data.name = name;
          state.step = 'ask_phone';
          response = generateResponse('ask_phone', state.language);
        } else {
          response = generateResponse('ask_name', state.language);
        }
        break;
        
      case 'ask_phone':
        // Usar número de Twilio
        state.data.phone = From;
        state.step = 'complete';
        
        // Guardar reserva
        const saved = await saveReservation(state);
        if (saved) {
          response = generateResponse('complete', state.language);
          state.step = 'finished';
        } else {
          response = 'Lo siento, ha habido un error. Por favor, contacte con el restaurante.';
        }
        break;
        
      default:
        response = generateResponse('greeting', state.language);
    }
    
  } catch (error) {
    console.error('[ERROR] Error en procesamiento:', error);
    response = 'Lo siento, ha habido un error. Por favor, intente de nuevo.';
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
  
  // Actualizar estado
  conversationStates.set(From, state);
  
  // Generar TwiML con configuración de idioma correcta
  const twiml = generateTwiML(response, state.language);
  
  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
};
