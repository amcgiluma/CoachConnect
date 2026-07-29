import {
  Apple,
  AudioWaveform,
  BatteryCharging,
  BicepsFlexed,
  Bike,
  CalendarDays,
  CircleDot,
  Dumbbell,
  Footprints,
  Goal,
  Medal,
  Mountain,
  MoveDiagonal2,
  Music2,
  PersonStanding,
  RotateCcw,
  Route,
  Scale,
  Sparkles,
  Sun,
  Swords,
  Target,
  Trees,
  Trophy,
  UsersRound,
  Waves,
  Zap,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react'

const BoxingGlove = createLucideIcon('BoxingGlove', [
  ['path', { d: 'M7 12V7a5 5 0 0 1 10 0v2', key: 'bg-1' }],
  ['path', { d: 'M17 7h1a3 3 0 0 1 3 3v2a5 5 0 0 1-5 5H9', key: 'bg-2' }],
  ['rect', { x: '4', y: '10', width: '5', height: '9', rx: '1.5', key: 'bg-3' }],
  ['path', { d: 'M9 17v4h7v-4', key: 'bg-4' }],
])

const MuayThai = createLucideIcon('MuayThai', [
  ['circle', { cx: '12', cy: '4', r: '2', key: 'mt-1' }],
  ['path', { d: 'm11 7-2 5 3 2 2-3', key: 'mt-2' }],
  ['path', { d: 'm9 9-4 2', key: 'mt-3' }],
  ['path', { d: 'm14 8 4 2', key: 'mt-4' }],
  ['path', { d: 'm12 14-2 7', key: 'mt-5' }],
  ['path', { d: 'm12 14 4 3 4-1', key: 'mt-6' }],
])

const Karate = createLucideIcon('Karate', [
  ['circle', { cx: '12', cy: '4', r: '2', key: 'ka-1' }],
  ['path', { d: 'm10 7-1 7h6l-1-7', key: 'ka-2' }],
  ['path', { d: 'm10 8-5 3', key: 'ka-3' }],
  ['path', { d: 'm14 8 5 3', key: 'ka-4' }],
  ['path', { d: 'M9 12h6', key: 'ka-5' }],
  ['path', { d: 'm10 14-4 7', key: 'ka-6' }],
  ['path', { d: 'm14 14 4 7', key: 'ka-7' }],
])

const KungFu = createLucideIcon('KungFu', [
  ['circle', { cx: '12', cy: '4', r: '2', key: 'kf-1' }],
  ['path', { d: 'm12 7-1 7', key: 'kf-2' }],
  ['path', { d: 'm11 9-5-2-3 2', key: 'kf-3' }],
  ['path', { d: 'm11 10 5 1 3-2', key: 'kf-4' }],
  ['path', { d: 'm11 14-5 5-3-1', key: 'kf-5' }],
  ['path', { d: 'm11 14 5 5 4-1', key: 'kf-6' }],
])

const FootballBall = createLucideIcon('FootballBall', [
  ['circle', { cx: '12', cy: '12', r: '9', key: 'fb-1' }],
  ['path', { d: 'm12 7.4 3.2 2.3-1.2 3.8h-4l-1.2-3.8Z', key: 'fb-2' }],
  ['path', { d: 'M12 7.4V3m3.2 6.7 4.1-1.4M14 13.5l2.5 3.8M10 13.5l-2.5 3.8M8.8 9.7 4.7 8.3', key: 'fb-3' }],
])

const TennisRacket = createLucideIcon('TennisRacket', [
  ['ellipse', { cx: '9.2', cy: '8.3', rx: '5.2', ry: '7', transform: 'rotate(-42 9.2 8.3)', key: 'tr-1' }],
  ['path', { d: 'm13 13 7.5 7.5M16.5 17.5l-2 2', key: 'tr-2' }],
  ['path', { d: 'M5.4 5.5 13 11M4.3 9l6.3 4.6M8.2 2.8l6.2 4.5M5.8 12.7 12.9 4', key: 'tr-3' }],
])

const PadelRacket = createLucideIcon('PadelRacket', [
  ['path', { d: 'M7.2 3.8c2.8-2.5 7.4-2 9.5.8s1.4 7.4-1.4 9.5c-2.1 1.6-5 1.8-7 .3-3.3-2.4-4.1-7.8-1.1-10.6Z', key: 'pr-1' }],
  ['path', { d: 'm13.8 14.8 6.3 6.3M17.4 18.4l-1.8 1.8', key: 'pr-2' }],
  ['circle', { cx: '9', cy: '7', r: '.45', fill: 'currentColor', key: 'pr-3' }],
  ['circle', { cx: '12', cy: '6', r: '.45', fill: 'currentColor', key: 'pr-4' }],
  ['circle', { cx: '14.5', cy: '8.5', r: '.45', fill: 'currentColor', key: 'pr-5' }],
  ['circle', { cx: '10', cy: '10.5', r: '.45', fill: 'currentColor', key: 'pr-6' }],
])

export const categoryIcons: Record<string, LucideIcon> = {
  fitness: Dumbbell,
  martial: Swords,
  running: Route,
  mobility: PersonStanding,
  sport: Trophy,
  dance: Music2,
  outdoor: Trees,
  wellbeing: Sparkles,
}

const optionIcons: Record<string, LucideIcon> = {
  Musculación: BicepsFlexed,
  Strength: BicepsFlexed,
  'Pérdida de peso': Scale,
  'Perder peso': Scale,
  'Weight loss': Scale,
  Funcional: Zap,
  Functional: Zap,
  Calistenia: PersonStanding,
  Calisthenics: PersonStanding,
  'Muay Thai': MuayThai,
  Boxeo: BoxingGlove,
  Boxing: BoxingGlove,
  Karate,
  'Kung fu': KungFu,
  Running: Footprints,
  Trail: Mountain,
  Ciclismo: Bike,
  Cycling: Bike,
  Natación: Waves,
  Swimming: Waves,
  Yoga: Sun,
  Pilates: CircleDot,
  Flexibilidad: MoveDiagonal2,
  Flexibility: MoveDiagonal2,
  Movilidad: RotateCcw,
  Mobility: RotateCcw,
  Fútbol: FootballBall,
  Football: FootballBall,
  Pádel: PadelRacket,
  Padel: PadelRacket,
  Tenis: TennisRacket,
  Tennis: TennisRacket,
  Rendimiento: Medal,
  Performance: Medal,
  'Danza urbana': AudioWaveform,
  'Urban dance': AudioWaveform,
  Ballet: Sparkles,
  Contemporáneo: Music2,
  Contemporary: Music2,
  Parque: Trees,
  Park: Trees,
  Outdoor: Sun,
  'Entreno en grupo': UsersRound,
  'Group training': UsersRound,
  Nutrición: Apple,
  Nutrition: Apple,
  Hábitos: CalendarDays,
  Habits: CalendarDays,
  Recuperación: BatteryCharging,
  Recovery: BatteryCharging,
}

export function getCategoryIcon(categoryId: string): LucideIcon {
  return categoryIcons[categoryId] || Sparkles
}

export function getTrainingIcon(label: string, categoryId?: string): LucideIcon {
  return optionIcons[label] || (categoryId ? categoryIcons[categoryId] : undefined) || Sparkles
}
