import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvailabilityCalendar } from './AvailabilityCalendar'

const slots = [
  { starts_at: '2026-08-03T08:00:00+02:00', ends_at: '2026-08-03T09:00:00+02:00' },
  { starts_at: '2026-08-03T10:00:00+02:00', ends_at: '2026-08-03T11:00:00+02:00' },
  { starts_at: '2026-08-05T17:30:00+02:00', ends_at: '2026-08-05T18:30:00+02:00' },
]

afterEach(cleanup)

describe('AvailabilityCalendar', () => {
  it('shows only the times for the selected date', () => {
    const onChange = vi.fn()
    render(<AvailabilityCalendar slots={slots} value="" onChange={onChange} />)

    expect(screen.getByRole('button', { name: '08:00' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '17:30' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mié 5 1/ }))

    expect(screen.queryByRole('button', { name: '08:00' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '17:30' })).toBeInTheDocument()
  })

  it('returns the selected ISO slot', () => {
    const onChange = vi.fn()
    render(<AvailabilityCalendar slots={slots} value="" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '10:00' }))

    expect(onChange).toHaveBeenCalledWith(slots[1].starts_at)
  })

  it('switches to a monthly view and keeps available days selectable', () => {
    render(<AvailabilityCalendar slots={slots} value="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }))

    expect(screen.getByRole('grid', { name: 'Disponibilidad mensual' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /3 de agosto: 2 huecos/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^4 de agosto: 0 huecos$/i })).toBeDisabled()
  })

  it('supports selecting several dates for a flexible plan', () => {
    const onChange = vi.fn()
    render(<AvailabilityCalendar slots={slots} value="" values={[slots[0].starts_at]} selectionLimit={3} onChange={onChange} />)

    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 sesiones')
    fireEvent.click(screen.getByRole('button', { name: '10:00' }))
    expect(onChange).toHaveBeenCalledWith(slots[1].starts_at)
  })
})
