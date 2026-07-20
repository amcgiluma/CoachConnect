import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(cleanup)

describe('CoachConnect', () => {
  it('starts the matching questionnaire from a category', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))

    expect(screen.getByRole('heading', { name: /qué quieres conseguir/i })).toBeInTheDocument()
  })

  it('opens the professional portal', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /eres entrenador/i }))
    expect(screen.getByRole('heading', { name: /tu trabajo/i })).toBeInTheDocument()
  })
})
