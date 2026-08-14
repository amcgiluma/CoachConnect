import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import App, { AccountIdentity, AccountNavigation, BookingDetailsDialog, SessionCalendar, type Profile } from './App'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('CoachConnect', () => {
  it('opens a complete booking detail from the session calendar', () => {
    const booking = {
      id: 'booking-1', starts_at: '2026-08-18T16:00:00+02:00', ends_at: '2026-08-18T17:00:00+02:00', status: 'confirmed', amount_cents: 3500,
      video_url: 'https://meet.google.com/example', notes: 'Trabajaremos técnica de sentadilla.', profiles: { display_name: 'Ana Cliente' },
      coach_services: { name: 'Fuerza 1:1', duration_minutes: 60, mode: 'online' as const },
    }
    const onSelect = vi.fn()
    const { rerender } = render(<SessionCalendar bookings={[booking]} perspective="coach" onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /ver detalles de fuerza 1:1 con ana cliente/i }))
    expect(onSelect).toHaveBeenCalledWith(booking)

    rerender(<BookingDetailsDialog booking={booking} perspective="coach" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('Ana Cliente')
    expect(screen.getByRole('dialog')).toHaveTextContent('60 minutos')
    expect(screen.getByRole('dialog')).toHaveTextContent('35,00 €')
    expect(screen.getByRole('link', { name: /entrar a la videollamada/i })).toHaveAttribute('href', booking.video_url)
  })

  it('provides real navigation between profile, messages and professional profile', () => {
    render(<MemoryRouter><AccountNavigation active="messages" /></MemoryRouter>)

    expect(screen.getByRole('link', { name: /mi perfil/i })).toHaveAttribute('href', '/cuenta')
    expect(screen.getByRole('link', { name: /^mensajes$/i })).toHaveAttribute('href', '/mensajes')
    expect(screen.getByRole('link', { name: /perfil profesional/i })).toHaveAttribute('href', '/profesional')
    expect(screen.getByRole('link', { name: /^mensajes$/i })).toHaveAttribute('aria-current', 'page')
  })

  it('focuses profile editing at the end of the name and truly discards changes', async () => {
    const profile: Profile = { id: 'profile-1', display_name: 'María López', role: 'consumer', email: 'maria@example.com', city: 'Granada' }
    render(<AccountIdentity profile={profile} userId="user-1" onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /editar datos/i }))
    const name = screen.getByLabelText(/nombre visible/i) as HTMLInputElement
    await waitFor(() => expect(name).toHaveFocus())
    expect(name.selectionStart).toBe(profile.display_name.length)
    expect(screen.queryByRole('textbox', { name: /correo de la cuenta/i })).not.toBeInTheDocument()
    expect(screen.getAllByText(profile.email!)).toHaveLength(2)

    fireEvent.change(name, { target: { value: 'Nombre provisional' } })
    fireEvent.click(screen.getAllByRole('button', { name: /descartar cambios/i })[1])
    expect(screen.queryByLabelText(/nombre visible/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /editar datos/i }))
    expect(screen.getByLabelText(/nombre visible/i)).toHaveValue(profile.display_name)
  })

  it('starts the matching questionnaire from a category', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /encuentra tu próximo entrenador/i })).toBeInTheDocument()
    expect(screen.getByText(/para que reserves con el entrenador adecuado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /elegir qué quiero entrenar/i })).toBeInTheDocument()
    expect(screen.getByText(/online y presencial, con reserva desde la app/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    expect(screen.getByRole('heading', { name: /qué tipo de entrenamiento buscas/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))
    expect(screen.getByRole('heading', { name: /cómo quieres entrenar/i })).toBeInTheDocument()
  })

  it('does not replace a database error with sample coaches', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Supabase no disponible'))
    window.history.pushState({}, '', '/buscar?category=fitness')

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No mostramos perfiles de muestra')
    expect(screen.queryByText('Inés Martín')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('moves directly from specialty to mode without asking for a goal', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /danza & movimiento/i }))
    fireEvent.click(screen.getByRole('button', { name: /danza urbana/i }))
    expect(screen.getByRole('heading', { name: /cómo quieres entrenar/i })).toBeInTheDocument()
    expect(screen.queryByText(/objetivo/i)).not.toBeInTheDocument()
  })

  it('does not force the viewport to the top between questionnaire answers', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))

    expect(screen.getByRole('heading', { name: /cómo quieres entrenar/i })).toBeInTheDocument()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('keeps the selected specialty image visible throughout the questionnaire', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /artes marciales/i }))

    const context = screen.getByLabelText(/especialidad elegida: artes marciales/i)
    expect(context.querySelector('img')).toHaveAttribute('src', '/images/categories/martial.webp')
    fireEvent.click(screen.getByRole('button', { name: /muay thai/i }))
    expect(screen.getByText('Muay Thai', { selector: '.question-category-content > p' })).toBeInTheDocument()
  })

  it('accepts a verified Spanish location instead of a fixed city list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ features: [{ properties: { osm_type: 'N', osm_id: 1, osm_key: 'place', name: 'Granada', state: 'Andalucía', countrycode: 'ES', type: 'city' } }] }),
    } as Response)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /artes marciales/i }))
    fireEvent.click(screen.getByRole('button', { name: /muay thai/i }))
    fireEvent.click(screen.getByRole('button', { name: /^presencial$/i }))

    const location = screen.getByLabelText(/ciudad, municipio, barrio o código postal/i)
    fireEvent.change(location, { target: { value: 'Granada' } })
    fireEvent.click(await screen.findByRole('option', { name: /granada.*andalucía/i }))
    fireEvent.click(screen.getByRole('button', { name: /continuar con esta ubicación/i }))
    expect(screen.getByRole('heading', { name: /qué presupuesto tienes/i })).toBeInTheDocument()
  })

  it('shows contextual symbols in the questionnaire options', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /fitness & fuerza/i }))
    fireEvent.click(screen.getByRole('button', { name: /musculación/i }))

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

  it('does not invent availability or a Friday booking for demo coaches', () => {
    window.history.replaceState({}, '', '/entrenadores/marcos-sanz')
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Marcos Sanz' })).toBeInTheDocument()
    expect(screen.getByText(/no hay huecos publicados para los próximos días/i)).toBeInTheDocument()
    expect(screen.queryByText(/viernes.*19:00/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reservar y pagar/i })).toBeDisabled()
  })
})
