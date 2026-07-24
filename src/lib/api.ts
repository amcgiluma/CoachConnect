import { supabase } from './supabase'

const configuredApiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
// API call sites use versioned paths. Accept legacy env values ending in /api/v1
// without producing /api/v1/api/v1 URLs.
const API_URL = configuredApiUrl.replace(/\/api\/v1$/, '')

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`)
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    let message = 'No se pudo completar la operación.'
    try {
      const payload = await response.json()
      message = payload.detail || message
    } catch { /* response without JSON */ }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<T>
}
