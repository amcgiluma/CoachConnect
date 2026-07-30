import {
  CircleDollarSign,
  Globe2,
  Languages,
  MapPin,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'
import type { Category } from './data'
import { getTrainingIcon } from './components/icons/trainingIcons'

export type QuestionnaireOption = { label: string; icon: LucideIcon }
export type QuestionnaireStep = {
  title: string
  key: 'subcategory' | 'mode' | 'city' | 'budget' | 'language'
  kind?: 'options' | 'location'
  options: QuestionnaireOption[]
}

const disciplineTitles: Record<string, string> = {
  fitness: '¿Qué tipo de entrenamiento buscas?',
  martial: '¿Qué arte marcial quieres practicar?',
  running: '¿Qué disciplina de resistencia eliges?',
  mobility: '¿Qué práctica te interesa?',
  sport: '¿Para qué deporte te preparas?',
  dance: '¿Qué estilo quieres bailar?',
  outdoor: '¿Cómo quieres entrenar fuera?',
  wellbeing: '¿En qué área necesitas acompañamiento?',
}

const commonSteps: QuestionnaireStep[] = [
  { title: '¿Cómo quieres entrenar?', key: 'mode', options: [{ label: 'Online', icon: Globe2 }, { label: 'Presencial', icon: MapPin }, { label: 'Me da igual', icon: SlidersHorizontal }] },
  { title: '¿Dónde quieres entrenar?', key: 'city', kind: 'location', options: [] },
  { title: '¿Qué presupuesto tienes por sesión?', key: 'budget', options: ['Hasta 25 €', 'Hasta 35 €', 'Hasta 50 €', 'Flexible'].map((label) => ({ label, icon: CircleDollarSign })) },
  { title: '¿En qué idioma prefieres entrenar?', key: 'language', options: ['Español', 'Inglés', 'Me da igual'].map((label) => ({ label, icon: Languages })) },
]

export function getQuestionnaireSteps(category: Category, answers: Record<string, string> = {}): QuestionnaireStep[] {
  const steps: QuestionnaireStep[] = [
    {
      title: disciplineTitles[category.id] || disciplineTitles.fitness,
      key: 'subcategory',
      options: category.examples.map((label) => ({ label, icon: getTrainingIcon(label, category.id) })),
    },
    ...commonSteps,
  ]

  return answers.mode === 'Online' ? steps.filter((item) => item.key !== 'city') : steps
}
