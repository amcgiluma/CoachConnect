import {
  Apple,
  BatteryCharging,
  BicepsFlexed,
  CalendarCheck2,
  CalendarDays,
  CircleDollarSign,
  Drama,
  Dumbbell,
  Focus,
  Gauge,
  Globe2,
  GraduationCap,
  HeartPulse,
  Languages,
  MapPin,
  Medal,
  Mountain,
  MoveDiagonal2,
  PersonStanding,
  Scale,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  Trees,
  Trophy,
  UsersRound,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Category } from './data'
import { getTrainingIcon } from './components/icons/trainingIcons'

export type QuestionnaireOption = { label: string; icon: LucideIcon }
export type QuestionnaireStep = {
  title: string
  key: 'subcategory' | 'goal' | 'mode' | 'availability' | 'city' | 'budget' | 'language'
  kind?: 'options' | 'location'
  options: QuestionnaireOption[]
}

type CategoryQuestions = {
  disciplineTitle: string
  goalTitle: string
  goals: QuestionnaireOption[]
}

const categoryQuestions: Record<string, CategoryQuestions> = {
  fitness: {
    disciplineTitle: '¿Qué tipo de entrenamiento buscas?',
    goalTitle: '¿Qué quieres conseguir con tu entrenamiento?',
    goals: [
      { label: 'Ganar fuerza', icon: BicepsFlexed },
      { label: 'Aumentar masa muscular', icon: Dumbbell },
      { label: 'Perder peso', icon: Scale },
      { label: 'Crear una rutina constante', icon: CalendarCheck2 },
    ],
  },
  martial: {
    disciplineTitle: '¿Qué arte marcial quieres practicar?',
    goalTitle: '¿Qué quieres conseguir con tu práctica?',
    goals: [
      { label: 'Aprender desde cero', icon: GraduationCap },
      { label: 'Mejorar técnica', icon: Focus },
      { label: 'Preparar un combate o grado', icon: Medal },
      { label: 'Aprender defensa personal', icon: Shield },
    ],
  },
  running: {
    disciplineTitle: '¿Qué disciplina de resistencia eliges?',
    goalTitle: '¿Cuál es tu próximo objetivo?',
    goals: [
      { label: 'Mejorar mi marca', icon: TimerReset },
      { label: 'Preparar una carrera', icon: Medal },
      { label: 'Ganar resistencia', icon: Gauge },
      { label: 'Volver a entrenar con seguridad', icon: HeartPulse },
    ],
  },
  mobility: {
    disciplineTitle: '¿Qué práctica te interesa?',
    goalTitle: '¿Qué quieres mejorar en tu cuerpo?',
    goals: [
      { label: 'Ganar movilidad', icon: MoveDiagonal2 },
      { label: 'Liberar tensión', icon: Wind },
      { label: 'Mejorar postura y control', icon: PersonStanding },
      { label: 'Crear una práctica constante', icon: CalendarCheck2 },
    ],
  },
  sport: {
    disciplineTitle: '¿Para qué deporte te preparas?',
    goalTitle: '¿Qué quieres trabajar para tu deporte?',
    goals: [
      { label: 'Mejorar técnica específica', icon: Focus },
      { label: 'Elevar mi rendimiento físico', icon: Gauge },
      { label: 'Preparar una competición', icon: Trophy },
      { label: 'Volver tras un parón', icon: BatteryCharging },
    ],
  },
  dance: {
    disciplineTitle: '¿Qué estilo quieres bailar?',
    goalTitle: '¿Qué buscas en tus clases?',
    goals: [
      { label: 'Aprender desde cero', icon: GraduationCap },
      { label: 'Mejorar técnica y coordinación', icon: Focus },
      { label: 'Preparar una coreografía', icon: Drama },
      { label: 'Disfrutar y ganar confianza', icon: Sparkles },
    ],
  },
  outdoor: {
    disciplineTitle: '¿Cómo quieres entrenar fuera?',
    goalTitle: '¿Qué buscas al entrenar al aire libre?',
    goals: [
      { label: 'Moverme más al aire libre', icon: Trees },
      { label: 'Mejorar mi condición física', icon: Gauge },
      { label: 'Preparar un reto', icon: Mountain },
      { label: 'Entrenar con otras personas', icon: UsersRound },
    ],
  },
  wellbeing: {
    disciplineTitle: '¿En qué área necesitas acompañamiento?',
    goalTitle: '¿Qué te gustaría cuidar ahora?',
    goals: [
      { label: 'Mejorar mi alimentación', icon: Apple },
      { label: 'Construir hábitos sostenibles', icon: CalendarCheck2 },
      { label: 'Recuperar energía', icon: BatteryCharging },
      { label: 'Gestionar mejor el estrés', icon: Wind },
    ],
  },
}

const fitnessGoalsByDiscipline: Record<string, QuestionnaireOption[]> = {
  Musculación: [
    { label: 'Aumentar masa muscular', icon: Dumbbell },
    { label: 'Ganar fuerza', icon: BicepsFlexed },
    { label: 'Mejorar mi técnica', icon: Focus },
    { label: 'Crear una rutina constante', icon: CalendarCheck2 },
  ],
  'Pérdida de peso': [
    { label: 'Reducir grasa corporal', icon: Scale },
    { label: 'Mejorar mi condición física', icon: Gauge },
    { label: 'Construir hábitos sostenibles', icon: CalendarCheck2 },
    { label: 'Mantener los resultados', icon: HeartPulse },
  ],
  Funcional: [
    { label: 'Moverme mejor en el día a día', icon: MoveDiagonal2 },
    { label: 'Ganar fuerza global', icon: BicepsFlexed },
    { label: 'Mejorar coordinación y agilidad', icon: Focus },
    { label: 'Entrenar con más confianza', icon: Shield },
  ],
  Calistenia: [
    { label: 'Aprender los movimientos básicos', icon: GraduationCap },
    { label: 'Conseguir mi primera dominada', icon: BicepsFlexed },
    { label: 'Dominar habilidades avanzadas', icon: Medal },
    { label: 'Ganar fuerza con mi cuerpo', icon: PersonStanding },
  ],
}

const commonSteps: QuestionnaireStep[] = [
  { title: '¿Cómo quieres entrenar?', key: 'mode', options: [{ label: 'Online', icon: Globe2 }, { label: 'Presencial', icon: MapPin }, { label: 'Me da igual', icon: SlidersHorizontal }] },
  { title: '¿Cuándo te viene bien?', key: 'availability', options: [{ label: 'Responde ahora', icon: Zap }, { label: 'Esta semana', icon: CalendarDays }, { label: 'Flexible', icon: TimerReset }] },
  { title: '¿Dónde quieres entrenar?', key: 'city', kind: 'location', options: [] },
  { title: '¿Qué presupuesto tienes por sesión?', key: 'budget', options: ['Hasta 25 €', 'Hasta 35 €', 'Hasta 50 €', 'Flexible'].map((label) => ({ label, icon: CircleDollarSign })) },
  { title: '¿En qué idioma prefieres entrenar?', key: 'language', options: ['Español', 'Inglés', 'Me da igual'].map((label) => ({ label, icon: Languages })) },
]

export function getQuestionnaireSteps(category: Category, answers: Record<string, string> = {}): QuestionnaireStep[] {
  const copy = categoryQuestions[category.id] || categoryQuestions.fitness
  const goals = category.id === 'fitness'
    ? fitnessGoalsByDiscipline[answers.subcategory] || fitnessGoalsByDiscipline.Musculación
    : copy.goals
  const steps: QuestionnaireStep[] = [
    {
      title: copy.disciplineTitle,
      key: 'subcategory',
      options: category.examples.map((label) => ({ label, icon: getTrainingIcon(label, category.id) })),
    },
    { title: copy.goalTitle, key: 'goal', options: goals },
    ...commonSteps,
  ]

  return answers.mode === 'Online' ? steps.filter((item) => item.key !== 'city') : steps
}

export const getCategoryGoalLabels = (categoryId: string, subcategory?: string): string[] => {
  const goals = categoryId === 'fitness'
    ? fitnessGoalsByDiscipline[subcategory || 'Musculación'] || fitnessGoalsByDiscipline.Musculación
    : (categoryQuestions[categoryId] || categoryQuestions.fitness).goals
  return goals.map((item) => item.label)
}
