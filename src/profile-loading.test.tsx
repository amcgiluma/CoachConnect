import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Account, ProPortal } from './App'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

vi.mock('./auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { id: 'coach-1', email: 'correo@example.com' },
    session: null,
    loading: false,
    signOut: vi.fn(),
  }),
}))

vi.mock('./lib/api', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number) { super(message) }
  },
}))

const pending = new Map<string, (value: unknown) => void>()

beforeEach(() => {
  pending.clear()
  apiMock.mockReset()
  apiMock.mockImplementation((path: string) => new Promise((resolve) => pending.set(path, resolve)))
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() },
  })
})

afterEach(() => cleanup())

async function resolveRequest(path: string, value: unknown) {
  await waitFor(() => expect(pending.has(path)).toBe(true))
  await act(async () => pending.get(path)?.(value))
}

describe('profile loading transitions', () => {
  it('never renders the email alias while the account profile is loading', async () => {
    render(<MemoryRouter><Account onAuth={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText('Preparando tu espacio')).toBeInTheDocument()
    expect(screen.queryByText(/hola, correo/i)).not.toBeInTheDocument()

    await resolveRequest('/api/v1/me', { id: 'coach-1', display_name: 'Marta Entrenadora', role: 'coach', email: 'correo@example.com', city: 'Madrid' })
    expect(screen.getByText('Preparando tu espacio')).toBeInTheDocument()
    await resolveRequest('/api/v1/bookings?perspective=consumer', [])
    await resolveRequest('/api/v1/packages', [])

    expect(await screen.findByRole('heading', { name: 'Hola, Marta Entrenadora.' })).toBeInTheDocument()
    expect(screen.queryByText(/hola, correo/i)).not.toBeInTheDocument()

    await resolveRequest('/api/v1/feedback/pending?perspective=consumer', {
      items: [{
        booking: {
          id: 'booking-feedback-1', status: 'completed', starts_at: '2026-08-13T14:00:00Z', ends_at: '2026-08-13T15:00:00Z', amount_cents: 3500,
          coach_services: { name: 'Fuerza personal', duration_minutes: 60, mode: 'online' },
          coach_profiles: { profiles: { display_name: 'Carlos Entrenador' } },
        },
        perspective: 'consumer', needs_outcome: true, needs_review: true,
        review_deadline: '2026-08-27T15:00:00Z', action_url: '/reservas?booking=booking-feedback-1',
      }],
      reward: { qualifying_review_count: 0, tier: 'standard', commission_discount_bps: 0, effective_platform_fee_percent: 15, next_tier_at: 10 },
    })

    expect(await screen.findByRole('heading', { name: /termina de cerrar tus entrenamientos/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirmar resultado/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /valorar entrenador/i })).toBeInTheDocument()
  })

  it('mounts the professional portal only after all overview data is ready', async () => {
    render(<MemoryRouter initialEntries={['/profesional']}><ProPortal onAuth={vi.fn()} /></MemoryRouter>)

    expect(screen.getByText('Preparando tu espacio')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /tu trabajo/i })).not.toBeInTheDocument()

    await resolveRequest('/api/v1/me', { id: 'coach-1', display_name: 'Marta Entrenadora', role: 'coach', email: 'correo@example.com', city: 'Madrid' })
    expect(screen.getByText('Preparando tu espacio')).toBeInTheDocument()
    await resolveRequest('/api/v1/coach/profile', { user_id: 'coach-1', headline: 'Fuerza', bio: 'Entrenamiento funcional', city: 'Madrid', mode: 'hibrido', verification_status: 'verified', responds_now: true, rating: 5, review_count: 1, availability_rules: [{}] })
    await resolveRequest('/api/v1/coach/services', [{ id: 'service-1' }])
    await resolveRequest('/api/v1/bookings?perspective=coach', [])

    expect(await screen.findByRole('heading', { name: /tu trabajo/i })).toBeInTheDocument()
    expect(screen.getByText('Marta Entrenadora')).toBeInTheDocument()
    expect(screen.queryByText('Preparando tu resumen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Perfil' }))
    expect(screen.getByLabelText('Nombre visible')).toHaveValue('Marta Entrenadora')
    expect(screen.queryByText('Cargando tu perfil')).not.toBeInTheDocument()
  })
})
