import type { CSSProperties } from 'react'
import { ArrowUpRight, Check, Crosshair, SlidersHorizontal } from 'lucide-react'
import type { Category } from '../data'

type MatchStageCategory = Pick<Category, 'id' | 'label' | 'kicker' | 'examples' | 'accent'>

type HomeMatchStageProps = {
  category: MatchStageCategory
  categoryIndex: number
  labels: {
    eyebrow: string
    status: string
    specialty: string
    criteria: string
    goal: string
    mode: string
    availability: string
    ready: string
  }
}

const accentColors: Record<string, string> = {
  lime: '#c8ff20',
  coral: '#ff927d',
  blue: '#9ed8ff',
  gold: '#f3d47a',
  violet: '#c9c0ff',
  pink: '#ffbed8',
  mint: '#a9efd6',
  sand: '#dfc6a2',
}

export function HomeMatchStage({ category, categoryIndex, labels }: HomeMatchStageProps) {
  const style = {
    '--stage-accent': accentColors[category.accent] || accentColors.lime,
    '--marker-rotation': `${categoryIndex * 45}deg`,
  } as CSSProperties

  return (
    <aside className="match-stage" style={style} aria-label={`${labels.eyebrow}: ${category.label}`}>
      <header className="match-stage-header">
        <span><Crosshair aria-hidden="true" /> {labels.eyebrow}</span>
        <strong><i /> {labels.status}</strong>
      </header>

      <div className="match-orbit">
        <div className="match-ring match-ring-outer" aria-hidden="true" />
        <div className="match-ring match-ring-inner" aria-hidden="true" />
        <div className="match-marker" aria-hidden="true"><span /></div>

        <div className="match-core">
          <div className="match-core-heading">
            <span>{labels.specialty}</span>
            <ArrowUpRight aria-hidden="true" />
          </div>
          <p>{category.kicker}</p>
          <h2>{category.label}</h2>
          <div className="match-examples">
            {category.examples.slice(0, 3).map((example) => <span key={example}>{example}</span>)}
          </div>
        </div>
      </div>

      <footer className="match-criteria">
        <div className="match-criteria-title"><SlidersHorizontal aria-hidden="true" /><span>{labels.criteria}</span></div>
        <div className="match-criteria-grid">
          {[labels.specialty, labels.goal, labels.mode, labels.availability].map((label, index) => (
            <span className={index === 0 ? 'is-active' : ''} key={label}>
              {index === 0 ? <Check aria-hidden="true" /> : `0${index + 1}`}
              <small>{label}</small>
            </span>
          ))}
        </div>
        <p><i /> {labels.ready}</p>
      </footer>
    </aside>
  )
}
