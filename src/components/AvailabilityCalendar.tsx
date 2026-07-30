import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock3 } from 'lucide-react'

type CalendarSlot = {
  starts_at: string
  ends_at: string
  label?: string
}

type AvailabilityCalendarProps = {
  slots: CalendarSlot[]
  value: string
  onChange: (startsAt: string) => void
  loading?: boolean
}

const dateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

export function AvailabilityCalendar({ slots, value, onChange, loading = false }: AvailabilityCalendarProps) {
  const days = useMemo(() => {
    const grouped = new Map<string, { key: string; date: Date; slots: CalendarSlot[] }>()
    for (const slot of slots) {
      const date = new Date(slot.starts_at)
      if (Number.isNaN(date.getTime())) continue
      const key = dateKey(date)
      const day = grouped.get(key) || { key, date, slots: [] }
      day.slots.push(slot)
      grouped.set(key, day)
    }
    return [...grouped.values()]
      .sort((left, right) => left.date.getTime() - right.date.getTime())
      .map((day) => ({
        ...day,
        slots: day.slots.sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()),
      }))
  }, [slots])
  const selectedValueDay = value && !Number.isNaN(new Date(value).getTime()) ? dateKey(new Date(value)) : ''
  const [selectedDay, setSelectedDay] = useState('')
  const activeDayKey = days.some((day) => day.key === selectedDay)
    ? selectedDay
    : days.some((day) => day.key === selectedValueDay) ? selectedValueDay : days[0]?.key || ''
  const activeDay = days.find((day) => day.key === activeDayKey)

  useEffect(() => {
    if (days.length && !days.some((day) => day.key === selectedDay)) setSelectedDay(days[0].key)
    if (!days.length && selectedDay) setSelectedDay('')
  }, [days, selectedDay])

  if (loading) return <div className="availability-state" role="status">Cargando agenda…</div>
  if (!slots.length) return <p className="booking-note">No hay huecos publicados para los próximos días.</p>

  // Demo profiles still carry human-readable placeholders instead of ISO
  // timestamps. Preserve their compact fallback without affecting real data.
  if (!days.length) {
    return <div className="slot-grid">{slots.map((slot) => <button key={slot.starts_at} type="button" className={value === slot.starts_at ? 'selected' : ''} onClick={() => onChange(slot.starts_at)}>{slot.label || slot.starts_at}</button>)}</div>
  }

  const monthLabel = activeDay?.date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return <div className="availability-calendar">
    <div className="availability-calendar-head"><span><CalendarDays /> {monthLabel}</span><small>{slots.length} huecos</small></div>
    <div className="availability-days" role="list" aria-label="Fechas con disponibilidad">
      {days.map((day) => <button
        type="button"
        key={day.key}
        className={day.key === activeDayKey ? 'active' : ''}
        aria-pressed={day.key === activeDayKey}
        onClick={() => {
          setSelectedDay(day.key)
          if (selectedValueDay !== day.key) onChange('')
        }}
      >
        <span>{day.date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span>
        <strong>{day.date.getDate()}</strong>
        <small>{day.slots.length}</small>
      </button>)}
    </div>
    {activeDay && <div className="availability-times">
      <p><Clock3 /> {activeDay.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="slot-grid" role="group" aria-label="Horas disponibles">
        {activeDay.slots.map((slot) => <button key={slot.starts_at} type="button" className={value === slot.starts_at ? 'selected' : ''} aria-pressed={value === slot.starts_at} onClick={() => onChange(slot.starts_at)}>
          {new Date(slot.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </button>)}
      </div>
    </div>}
  </div>
}
