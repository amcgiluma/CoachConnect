import { describe, expect, it } from 'vitest'
import { getCategoryIcon, getTrainingIcon } from './trainingIcons'

describe('training icon registry', () => {
  it('uses exact icons before the parent category fallback', () => {
    expect(getTrainingIcon('Pérdida de peso', 'fitness').displayName).toMatch(/scale/i)
    expect(getTrainingIcon('Natación', 'running').displayName).toMatch(/waves/i)
    expect(getTrainingIcon('Boxeo', 'martial').displayName).toMatch(/boxingglove/i)
    expect(getTrainingIcon('Kung fu', 'martial').displayName).toMatch(/kungfu/i)
  })

  it('falls back to the parent category and then to a neutral symbol', () => {
    expect(getTrainingIcon('Disciplina futura', 'running')).toBe(getCategoryIcon('running'))
    expect(getTrainingIcon('Disciplina futura')).toBe(getCategoryIcon('unknown'))
  })
})
