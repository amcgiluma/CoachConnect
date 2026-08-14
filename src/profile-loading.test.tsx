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
