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
    expect(screen.getByText(/para que reserves con el entrenador adecuado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /elegir qué quiero entrenar/i })).toBeInTheDocument()
    expect(screen.getByText(/online y presencial, con reserva desde la app/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    expect(screen.getByRole('heading', { name: /qué disciplina encaja mejor/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))
    expect(screen.getByRole('heading', { name: /qué quieres conseguir/i })).toBeInTheDocument()
  })

  it('shows contextual symbols in the questionnaire options', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))
    fireEvent.click(screen.getByRole('button', { name: /ganar fuerza/i }))

    const online = screen.getByRole('button', { name: /online/i })
    const inPerson = screen.getByRole('button', { name: /presencial/i })
    expect(online.querySelector('svg')).toBeInTheDocument()
    expect(inPerson.querySelector('svg')).toBeInTheDocument()
  })

  it('previews the matching system from hover and focus', () => {
    render(<App />)
    const dance = screen.getByRole('button', { name: /danza & movimiento/i })

    fireEvent.mouseEnter(dance)
    expect(screen.getByRole('heading', { level: 2, name: /danza & movimiento/i })).toBeInTheDocument()

    const running = screen.getByRole('button', { name: /running & resistencia/i })
    fireEvent.focus(running)
    expect(screen.getByRole('heading', { level: 2, name: /running & resistencia/i })).toBeInTheDocument()
    expect(document.querySelector('.match-core-photo img')).toHaveAttribute('src', '/images/categories/running.webp')
  })

  it('shows trainer portraits with resilient image dimensions', () => {
    render(<App />)
    const portraits = document.querySelectorAll('.coach-proof .coach-avatar img')

    expect(portraits).toHaveLength(4)
    portraits.forEach((portrait) => {
      expect(portrait).toHaveAttribute('width', '320')
      expect(portrait).toHaveAttribute('height', '320')
    })
  })

  it('moves to the exact next category and keeps the wheel in sync', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /categoría siguiente/i }))

    const martial = screen.getByRole('button', { name: /artes marciales/i })
    expect(martial).toHaveFocus()
    expect(screen.getByRole('heading', { level: 2, name: /artes marciales/i })).toBeInTheDocument()
  })

  it('uses the wheel action to guide focus to the active category', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /elegir especialidad/i }))
    expect(screen.getByRole('button', { name: /fitness & fuerza/i })).toHaveFocus()
  })

  it('uses distinct, meaningful martial arts symbols', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /artes marciales/i }))

    const iconClasses = ['Muay Thai', 'Boxeo', 'Karate', 'Kung fu'].map((label) =>
      screen.getByRole('button', { name: new RegExp(label, 'i') }).querySelector('svg')?.getAttribute('class'),
    )
    expect(new Set(iconClasses).size).toBe(4)
    expect(iconClasses.join(' ')).not.toMatch(/shield-check|activity/)
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
