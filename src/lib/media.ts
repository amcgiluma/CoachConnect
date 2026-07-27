export type ResponsiveImage = {
  avif: string
  webp: string
  objectPosition?: string
}

const categoryVisuals: Record<string, ResponsiveImage> = {
  fitness: { avif: '/images/categories/fitness.avif', webp: '/images/categories/fitness.webp', objectPosition: '56% center' },
  martial: { avif: '/images/categories/martial.avif', webp: '/images/categories/martial.webp', objectPosition: '50% center' },
  running: { avif: '/images/categories/running.avif', webp: '/images/categories/running.webp', objectPosition: '54% center' },
  mobility: { avif: '/images/categories/mobility.avif', webp: '/images/categories/mobility.webp', objectPosition: '50% center' },
  sport: { avif: '/images/categories/sport.avif', webp: '/images/categories/sport.webp', objectPosition: '51% center' },
  dance: { avif: '/images/categories/dance.avif', webp: '/images/categories/dance.webp', objectPosition: '50% center' },
  outdoor: { avif: '/images/categories/outdoor.avif', webp: '/images/categories/outdoor.webp', objectPosition: '48% center' },
  wellbeing: { avif: '/images/categories/wellbeing.avif', webp: '/images/categories/wellbeing.webp', objectPosition: '56% center' },
}

export const getCategoryVisual = (categoryId: string): ResponsiveImage =>
  categoryVisuals[categoryId] || categoryVisuals.fitness
