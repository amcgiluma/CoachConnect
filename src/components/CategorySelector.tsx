import { forwardRef, useRef, type UIEvent } from 'react'
import { ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Category } from '../data'
import { getCategoryVisual } from '../lib/media'
import { getCategoryIcon } from './icons/trainingIcons'

type CategorySelectorLabels = {
  question: string
  help: string
  previous: string
  next: string
  region: string
  active: string
}

type CategorySelectorProps = {
  categories: Category[]
  activeCategoryId: string
  labels: CategorySelectorLabels
  onActiveChange: (categoryId: string) => void
  onSelect: (category: Category) => void
}

export const CategorySelector = forwardRef<HTMLElement, CategorySelectorProps>(function CategorySelector({
  categories,
  activeCategoryId,
  labels,
  onActiveChange,
  onSelect,
}, forwardedRef) {
  const trackRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const activeIndex = Math.max(0, categories.findIndex((item) => item.id === activeCategoryId))

  const moveTo = (index: number, focus = false) => {
    const nextIndex = Math.min(categories.length - 1, Math.max(0, index))
    const category = categories[nextIndex]
    const tile = trackRef.current?.querySelector<HTMLButtonElement>(`[data-category-id="${category.id}"]`)

    onActiveChange(category.id)
    tile?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    })
    if (focus) tile?.focus({ preventScroll: true })
  }

  const updateActiveFromScroll = (event: UIEvent<HTMLDivElement>) => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    const track = event.currentTarget
    frameRef.current = requestAnimationFrame(() => {
      const trackRect = track.getBoundingClientRect()
      const trackCenter = trackRect.left + trackRect.width / 2
      const tiles = Array.from(track.querySelectorAll<HTMLButtonElement>('[data-category-id]'))
      const nearest = tiles.reduce<{ id: string; distance: number } | null>((current, tile) => {
        const rect = tile.getBoundingClientRect()
        const distance = Math.abs(rect.left + rect.width / 2 - trackCenter)
        return !current || distance < current.distance
          ? { id: tile.dataset.categoryId || categories[0].id, distance }
          : current
      }, null)

      if (nearest && nearest.id !== activeCategoryId) onActiveChange(nearest.id)
      frameRef.current = null
    })
  }

  return (
    <section className="category-dock" id="category-selector" ref={forwardedRef} aria-labelledby="category-selector-title">
      <div className="dock-heading">
        <span aria-hidden="true">01</span>
        <strong id="category-selector-title">{labels.question}</strong>
        <small>{labels.help}</small>
        <div className="category-carousel-controls" aria-label={labels.region}>
          <button
            type="button"
            onClick={() => moveTo(activeIndex - 1, true)}
            aria-label={labels.previous}
            disabled={activeIndex === 0}
          >
            <ChevronLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => moveTo(activeIndex + 1, true)}
            aria-label={labels.next}
            disabled={activeIndex === categories.length - 1}
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className="category-grid"
        ref={trackRef}
        role="region"
        aria-label={labels.region}
        onScroll={updateActiveFromScroll}
      >
        {categories.map((item) => {
          const CategoryIcon = getCategoryIcon(item.id)
          const visual = getCategoryVisual(item.id)
          const isActive = activeCategoryId === item.id
          return (
            <button
              type="button"
              key={item.id}
              data-category-id={item.id}
              className={`category-tile tile-${item.accent} ${isActive ? 'is-previewed' : ''}`}
              onMouseEnter={() => onActiveChange(item.id)}
              onFocus={() => onActiveChange(item.id)}
              onClick={() => onSelect(item)}
            >
              <picture className="category-photo" aria-hidden="true">
                <source srcSet={visual.avif} type="image/avif" />
                <img
                  src={visual.webp}
                  alt=""
                  width="800"
                  height="600"
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: visual.objectPosition }}
                />
              </picture>
              <CategoryIcon className="category-icon" aria-hidden="true" />
              <span className="tile-kicker">{item.kicker}</span>
              <strong>{item.label}</strong>
              <ArrowUpRight className="category-arrow" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <span className="sr-only" aria-live="polite">{labels.active}: {categories[activeIndex]?.label}</span>
    </section>
  )
})
