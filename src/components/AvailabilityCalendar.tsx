import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react'

type CalendarSlot = {
  starts_at: string
  ends_at: string
  label?: string
}

type AvailabilityCalendarProps = {
  slots: CalendarSlot[]
  value: string
  values?: string[]
  selectionLimit?: number
  onChange: (startsAt: string) => void
  loading?: boolean
}

const dateKey = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-')

const startOfWeek = (date: Date) => {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7))
  return result
}

const addDays = (date: Date, amount: number) => {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

export function AvailabilityCalendar({ slots, value, values, selectionLimit, onChange, loading = false }: AvailabilityCalendarProps) {
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
  const selectedValues = values || (value ? [value] : [])
  const selectedValueDay = selectedValues[0] && !Number.isNaN(new Date(selectedValues[0]).getTime()) ? dateKey(new Date(selectedValues[0])) : ''
  const [selectedDay, setSelectedDay] = useState('')
  const [view, setView] = useState<'week' | 'month'>('week')
  const [periodAnchor, setPeriodAnchor] = useState<Date>(() => new Date())
  useEffect(() => {
    if (days.length && !days.some((day) => day.key === selectedDay)) {
      setSelectedDay(days[0].key)
      setPeriodAnchor(days[0].date)
    }
    if (!days.length && selectedDay) setSelectedDay('')
  }, [days, selectedDay])

  if (loading) return <div className="availability-state" role="status">Cargando agenda…</div>
  if (!slots.length) return <p className="booking-note">No hay huecos publicados para los próximos días.</p>

  if (!days.length) {
    return <div className="slot-grid">{slots.map((slot) => <button key={slot.starts_at} type="button" className={selectedValues.includes(slot.starts_at) ? 'selected' : ''} onClick={() => onChange(slot.starts_at)}>{slot.label || slot.starts_at}</button>)}</div>
  }

  const weekStart = startOfWeek(periodAnchor)
  const visibleWeekKeys = new Set(Array.from({ length: 7 }, (_, index) => dateKey(addDays(weekStart, index))))
  const visibleDays = view === 'week' ? days.filter((day) => visibleWeekKeys.has(day.key)) : days.filter((day) => day.date.getMonth() === periodAnchor.getMonth() && day.date.getFullYear() === periodAnchor.getFullYear())
  const activeDay = visibleDays.find((day) => day.key === selectedDay)
    || visibleDays.find((day) => day.key === selectedValueDay)
    || visibleDays[0]
  const activeDayKey = activeDay?.key || ''
  const monthStart = new Date(periodAnchor.getFullYear(), periodAnchor.getMonth(), 1)
  const monthEnd = new Date(periodAnchor.getFullYear(), periodAnchor.getMonth() + 1, 0)
  const monthCells = Array.from({ length: ((monthStart.getDay() + 6) % 7) + monthEnd.getDate() }, (_, index) => {
    const dayNumber = index - ((monthStart.getDay() + 6) % 7) + 1
    if (dayNumber < 1) return null
    const date = new Date(periodAnchor.getFullYear(), periodAnchor.getMonth(), dayNumber)
    return days.find((day) => day.key === dateKey(date)) || { key: dateKey(date), date, slots: [] }
  })
  const periodLabel = view === 'month'
    ? periodAnchor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
    : `${weekStart.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} — ${addDays(weekStart, 6).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
  const movePeriod = (direction: number) => {
    const next = new Date(periodAnchor)
    if (view === 'month') next.setMonth(next.getMonth() + direction, 1)
    else next.setDate(next.getDate() + direction * 7)
    const nextWeekStart = startOfWeek(next)
    const nextWeekKeys = new Set(Array.from({ length: 7 }, (_, index) => dateKey(addDays(nextWeekStart, index))))
    const nextDays = view === 'month'
      ? days.filter((day) => day.date.getMonth() === next.getMonth() && day.date.getFullYear() === next.getFullYear())
      : days.filter((day) => nextWeekKeys.has(day.key))
    setPeriodAnchor(next)
    setSelectedDay(nextDays[0]?.key || '')
  }
  const changeView = (nextView: 'week' | 'month') => {
    if (nextView === view) return
    if (activeDay) {
      setSelectedDay(activeDay.key)
      setPeriodAnchor(activeDay.date)
    }
    setView(nextView)
  }
  const chooseDay = (key: string, date: Date, available: boolean) => {
    if (!available) return
    setSelectedDay(key)
    setPeriodAnchor(date)
    if (!values && selectedValueDay !== key) onChange('')
  }

  return <div className="availability-calendar">
    <div className="availability-calendar-head">
      <span><CalendarDays /> {periodLabel}</span>
      <div className="calendar-view-controls">
        <button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => changeView('week')}>Semana</button>
        <button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => changeView('month')}>Mes</button>
        <button type="button" aria-label="Periodo anterior" onClick={() => movePeriod(-1)}><ChevronLeft /></button>
        <button type="button" aria-label="Periodo siguiente" onClick={() => movePeriod(1)}><ChevronRight /></button>
      </div>
    </div>
    {values && <p className="selection-progress" role="status">Has elegido <strong>{selectedValues.length}</strong> de <strong>{selectionLimit}</strong> sesiones. Puedes combinar días y horas.</p>}
    {view === 'week' ? <div className="availability-days" role="list" aria-label="Fechas con disponibilidad">
      {visibleDays.length ? visibleDays.map((day) => <button
        type="button"
        key={day.key}
        className={day.key === activeDayKey ? 'active' : ''}
        aria-pressed={day.key === activeDayKey}
        onClick={() => chooseDay(day.key, day.date, true)}
      >
        <span>{day.date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span>
        <strong>{day.date.getDate()}</strong>
        <small>{day.slots.length}</small>
      </button>) : <p className="period-empty">No hay huecos esta semana. Avanza a la siguiente o cambia a vista mensual.</p>}
    </div> : <div className="availability-month" role="grid" aria-label="Disponibilidad mensual">
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((label, index) => <span className="month-weekday" key={`${label}-${index}`}>{label}</span>)}
      {monthCells.map((day, index) => day ? <button type="button" key={day.key} disabled={!day.slots.length} className={day.key === activeDayKey ? 'active' : ''} aria-label={`${day.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}: ${day.slots.length} huecos`} onClick={() => chooseDay(day.key, day.date, Boolean(day.slots.length))}>
        <strong>{day.date.getDate()}</strong><small>{day.slots.length || ''}</small>
      </button> : <span key={`empty-${index}`} />)}
    </div>}
    {activeDay && <div className="availability-times">
      <p><Clock3 /> {activeDay.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="slot-grid" role="group" aria-label="Horas disponibles">
        {activeDay.slots.map((slot) => <button key={slot.starts_at} type="button" className={selectedValues.includes(slot.starts_at) ? 'selected' : ''} aria-pressed={selectedValues.includes(slot.starts_at)} onClick={() => onChange(slot.starts_at)}>
          {new Date(slot.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </button>)}
      </div>
    </div>}
  </div>
}
