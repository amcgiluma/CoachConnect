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
