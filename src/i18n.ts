import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const resources = {
  es: {
    translation: {
      nav: {
        coach: '¿Eres entrenador?',
        messages: 'Mensajes',
        account: 'Mi cuenta',
        login: 'Entrar',
        notifications: 'Notificaciones',
      },
      home: {
        eyebrow: 'Entrenadores verificados, cerca o online',
        titleBefore: 'Encuentra',
        titleAccent: 'tu próximo',
        titleAfter: 'entrenador.',
        description: 'Elige qué quieres entrenar. Comparamos especialidad, objetivos y disponibilidad para que reserves con el entrenador adecuado, online o presencial.',
        action: 'Elegir qué quiero entrenar',
        verified: 'Entrenadores verificados',
        proofRating: '4,9/5 · 152 reseñas reales',
        proofDetail: 'Online y presencial, con reserva desde la app',
        question: '¿Qué quieres entrenar?',
        questionHelp: 'Elige una especialidad para empezar.',
        categoriesPrevious: 'Categoría anterior',
        categoriesNext: 'Categoría siguiente',
        categoriesRegion: 'Categorías de entrenamiento',
        categoryActive: 'Categoría activa',
        stage: {
          eyebrow: 'Tu matching de entrenador',
          status: 'Categoría activa',
          specialty: 'Especialidad',
          criteria: 'Así encontramos tu coach',
          goal: 'Objetivo',
          mode: 'Modalidad',
          availability: 'Horario',
          ready: 'Listo para afinar tu búsqueda',
          action: 'Elegir especialidad',
        },
        categories: {
          fitness: { label: 'Fitness & fuerza', kicker: 'Construye capacidad', examples: ['Musculación', 'Pérdida de peso', 'Funcional', 'Calistenia'] },
          martial: { label: 'Artes marciales', kicker: 'Aprende a moverte', examples: ['Muay Thai', 'Boxeo', 'Karate', 'Kung fu'] },
          running: { label: 'Running & resistencia', kicker: 'Ve más lejos', examples: ['Running', 'Trail', 'Ciclismo', 'Natación'] },
          mobility: { label: 'Movilidad & cuerpo', kicker: 'Muévete mejor', examples: ['Yoga', 'Pilates', 'Flexibilidad', 'Movilidad'] },
          sport: { label: 'Preparación deportiva', kicker: 'Compite preparado', examples: ['Fútbol', 'Pádel', 'Tenis', 'Rendimiento'] },
          dance: { label: 'Danza & movimiento', kicker: 'Encuentra tu ritmo', examples: ['Danza urbana', 'Ballet', 'Contemporáneo'] },
          outdoor: { label: 'Entrenamiento exterior', kicker: 'Sal fuera', examples: ['Parque', 'Outdoor', 'Entreno en grupo'] },
          wellbeing: { label: 'Bienestar aplicado', kicker: 'Sostén el hábito', examples: ['Nutrición', 'Hábitos', 'Recuperación'] },
        },
      },
      auth: {
        space: 'Tu espacio CoachConnect',
        createTitle: 'Crea tu cuenta.',
        loginTitle: 'Vuelve a entrenar.',
        google: 'Continuar con Google',
        apple: 'Continuar con Apple',
        orEmail: 'o con email',
        name: 'Nombre',
        password: 'Contraseña',
        create: 'Crear cuenta',
        login: 'Entrar',
      },
    },
  },
  en: {
    translation: {
      nav: {
        coach: 'Are you a coach?',
        messages: 'Messages',
        account: 'My account',
        login: 'Log in',
        notifications: 'Notifications',
      },
      home: {
        eyebrow: 'Verified coaches, nearby or online',
        titleBefore: 'Find',
        titleAccent: 'your next',
        titleAfter: 'coach.',
        description: 'Choose what you want to train. We compare expertise, goals and availability so you can book the right coach, online or in person.',
        action: 'Choose what to train',
        verified: 'Verified coaches',
        proofRating: '4.9/5 · 152 real reviews',
        proofDetail: 'Online and in person, bookable in the app',
        question: 'What do you want to train?',
        questionHelp: 'Choose a specialty to begin.',
        categoriesPrevious: 'Previous category',
        categoriesNext: 'Next category',
        categoriesRegion: 'Training categories',
        categoryActive: 'Active category',
        stage: {
          eyebrow: 'Your coach match',
          status: 'Active category',
          specialty: 'Specialty',
          criteria: 'How we find your coach',
          goal: 'Goal',
          mode: 'Format',
          availability: 'Schedule',
          ready: 'Ready to refine your search',
          action: 'Choose a specialty',
        },
        categories: {
          fitness: { label: 'Fitness & strength', kicker: 'Build capacity', examples: ['Strength', 'Weight loss', 'Functional', 'Calisthenics'] },
          martial: { label: 'Martial arts', kicker: 'Learn to move', examples: ['Muay Thai', 'Boxing', 'Karate', 'Kung fu'] },
          running: { label: 'Running & endurance', kicker: 'Go further', examples: ['Running', 'Trail', 'Cycling', 'Swimming'] },
          mobility: { label: 'Mobility & body', kicker: 'Move better', examples: ['Yoga', 'Pilates', 'Flexibility', 'Mobility'] },
          sport: { label: 'Sports performance', kicker: 'Compete prepared', examples: ['Football', 'Padel', 'Tennis', 'Performance'] },
          dance: { label: 'Dance & movement', kicker: 'Find your rhythm', examples: ['Urban dance', 'Ballet', 'Contemporary'] },
          outdoor: { label: 'Outdoor training', kicker: 'Get outside', examples: ['Park', 'Outdoor', 'Group training'] },
          wellbeing: { label: 'Applied wellbeing', kicker: 'Make it sustainable', examples: ['Nutrition', 'Habits', 'Recovery'] },
        },
      },
      auth: {
        space: 'Your CoachConnect space',
        createTitle: 'Create your account.',
        loginTitle: 'Welcome back.',
        google: 'Continue with Google',
        apple: 'Continue with Apple',
        orEmail: 'or use email',
        name: 'Name',
        password: 'Password',
        create: 'Create account',
        login: 'Log in',
      },
    },
  },
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('coachconnect-language') || 'es',
  fallbackLng: 'es',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => {
  localStorage.setItem('coachconnect-language', language)
  document.documentElement.lang = language
})

document.documentElement.lang = i18n.language

export default i18n
