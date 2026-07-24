import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('CoachConnect', () => {
  it('starts the matching questionnaire from a category', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    expect(screen.getByRole('heading', { name: /qué disciplina encaja mejor/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))
    expect(screen.getByRole('heading', { name: /qué quieres conseguir/i })).toBeInTheDocument()
  })

  it('previews the matching system from hover and focus', () => {
    render(<App />)
    const dance = screen.getByRole('button', { name: /danza & movimiento/i })

    fireEvent.mouseEnter(dance)
    expect(screen.getByRole('heading', { level: 2, name: /danza & movimiento/i })).toBeInTheDocument()

    const running = screen.getByRole('button', { name: /running & resistencia/i })
    fireEvent.focus(running)
    expect(screen.getByRole('heading', { level: 2, name: /running & resistencia/i })).toBeInTheDocument()
  })

  it('opens the professional portal', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: /eres entrenador/i }))
    expect(await screen.findByRole('heading', { name: /tu trabajo/i })).toBeInTheDocument()
  })

  it('opens the real authentication dialog', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))
    expect(screen.getByRole('dialog', { name: /vuelve a entrenar/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument()
  })
})
