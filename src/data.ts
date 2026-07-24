export type Mode = 'online' | 'presencial' | 'hibrido'

export type Category = { id: string; label: string; kicker: string; examples: string[]; accent: string }
export type CoachService = { id?: string; name: string; detail: string; price: number; duration?: number; packageSize?: number }
export type Coach = {
  id: string; name: string; initials: string; specialty: string; category: string; mode: Mode; city: string
  rating: number; reviews: number; price: number; response: string; nextSlot: string; verified: boolean
  onlineNow: boolean; bio: string; tags: string[]; services: CoachService[]; matchReasons?: string[]
  videoProvider?: 'meet' | 'zoom' | 'custom'
}

export const categories: Category[] = [
  { id: 'fitness', label: 'Fitness & fuerza', kicker: 'Construye capacidad', examples: ['Musculación', 'Pérdida de peso', 'Funcional', 'Calistenia'], accent: 'lime' },
  { id: 'martial', label: 'Artes marciales', kicker: 'Aprende a moverte', examples: ['Muay Thai', 'Boxeo', 'Karate', 'Kung fu'], accent: 'coral' },
  { id: 'running', label: 'Running & resistencia', kicker: 'Ve más lejos', examples: ['Running', 'Trail', 'Ciclismo', 'Natación'], accent: 'blue' },
  { id: 'mobility', label: 'Movilidad & cuerpo', kicker: 'Muévete mejor', examples: ['Yoga', 'Pilates', 'Flexibilidad', 'Movilidad'], accent: 'gold' },
  { id: 'sport', label: 'Preparación deportiva', kicker: 'Compite preparado', examples: ['Fútbol', 'Pádel', 'Tenis', 'Rendimiento'], accent: 'violet' },
  { id: 'dance', label: 'Danza & movimiento', kicker: 'Encuentra tu ritmo', examples: ['Danza urbana', 'Ballet', 'Contemporáneo'], accent: 'pink' },
  { id: 'outdoor', label: 'Entrenamiento exterior', kicker: 'Sal fuera', examples: ['Parque', 'Outdoor', 'Entreno en grupo'], accent: 'mint' },
  { id: 'wellbeing', label: 'Bienestar aplicado', kicker: 'Sostén el hábito', examples: ['Nutrición', 'Hábitos', 'Recuperación'], accent: 'sand' },
]

export const coaches: Coach[] = [
  { id: 'ines-martin', name: 'Inés Martín', initials: 'IM', specialty: 'Fuerza y movilidad', category: 'fitness', mode: 'hibrido', city: 'Madrid', rating: 4.9, reviews: 42, price: 32, response: '< 5 min', nextSlot: 'Hoy · 18:30', verified: true, onlineNow: true, bio: 'Entrenamiento con intención: fuerza, técnica y movilidad para que notes progreso sin vivir en el gimnasio.', tags: ['Musculación', 'Funcional', 'Movilidad'], services: [{ name: 'Sesión 1:1', detail: '60 min · online o presencial', price: 32, duration: 60 }, { name: 'Bono 4 sesiones', detail: 'A tu ritmo · caduca en 60 días', price: 116, packageSize: 4 }] },
  { id: 'marcos-sanz', name: 'Marcos Sanz', initials: 'MS', specialty: 'Muay Thai', category: 'martial', mode: 'presencial', city: 'Madrid', rating: 5, reviews: 28, price: 28, response: 'Ahora', nextSlot: 'Hoy · 20:00', verified: true, onlineNow: true, bio: 'Técnica, condición y confianza. Clases directas para empezar desde cero o afilar tu juego.', tags: ['Muay Thai', 'Boxeo', 'Defensa personal'], services: [{ name: 'Primera sesión', detail: '60 min · Lavapiés', price: 28, duration: 60 }, { name: 'Bono 8 sesiones', detail: 'Entrenamiento presencial', price: 198, packageSize: 8 }] },
  { id: 'laura-cano', name: 'Laura Cano', initials: 'LC', specialty: 'Running y resistencia', category: 'running', mode: 'online', city: 'Barcelona', rating: 4.8, reviews: 63, price: 25, response: '< 1 h', nextSlot: 'Mañana · 07:30', verified: true, onlineNow: false, bio: 'Planes claros para correr mejor, desde tus primeros 5K hasta tu próxima marca personal.', tags: ['Running', 'Trail', 'Planificación'], services: [{ name: 'Diagnóstico + plan', detail: '45 min · online', price: 25, duration: 45 }, { name: 'Bono mensual', detail: 'Seguimiento semanal', price: 74, packageSize: 4 }] },
  { id: 'diego-ortiz', name: 'Diego Ortiz', initials: 'DO', specialty: 'Movilidad y yoga', category: 'mobility', mode: 'hibrido', city: 'Valencia', rating: 4.7, reviews: 19, price: 24, response: '< 2 h', nextSlot: 'Jueves · 09:00', verified: true, onlineNow: false, bio: 'Una práctica útil para sentirte ligero, fuerte y presente en tu día a día.', tags: ['Yoga', 'Movilidad', 'Postura'], services: [{ name: 'Sesión individual', detail: '60 min · online o presencial', price: 24, duration: 60 }, { name: 'Bono 4 sesiones', detail: 'Seguimiento flexible', price: 86, packageSize: 4 }] },
]

export const isRemoteCoach = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
