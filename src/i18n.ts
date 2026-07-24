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
        eyebrow: 'Entrenadores que encajan contigo',
        titleBefore: 'Encuentra',
        titleAccent: 'tu próximo',
        titleAfter: 'entrenador.',
        description: 'Deporte, objetivos y horarios reales. Te acercamos a la persona adecuada para empezar hoy.',
        action: 'Encontrar entrenador',
        verified: 'Profesionales verificados',
        question: '¿Qué quieres entrenar?',
        questionHelp: 'Elige una especialidad para empezar.',
        stage: {
          eyebrow: 'Sistema de encaje',
          status: 'Vista activa',
          specialty: 'Especialidad',
          criteria: 'Criterios de búsqueda',
          goal: 'Objetivo',
          mode: 'Modalidad',
          availability: 'Horario',
          ready: 'Listo para afinar tu búsqueda',
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
        eyebrow: 'Coaches who fit your goals',
        titleBefore: 'Find',
        titleAccent: 'your next',
        titleAfter: 'coach.',
        description: 'Real sports, goals and schedules. We connect you with the right person to start today.',
        action: 'Find a coach',
        verified: 'Verified professionals',
        question: 'What do you want to train?',
        questionHelp: 'Choose a specialty to begin.',
        stage: {
          eyebrow: 'Matching system',
          status: 'Live preview',
          specialty: 'Specialty',
          criteria: 'Search criteria',
          goal: 'Goal',
          mode: 'Format',
          availability: 'Schedule',
          ready: 'Ready to refine your search',
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
