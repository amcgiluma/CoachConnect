import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Toaster, toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Ban, Bell, CalendarDays, Camera, Check, ChevronDown,
  ChevronLeft, ChevronRight, Clock3, CreditCard, Eye, FileCheck2, Globe2, Languages,
  Dumbbell, Flag, LayoutDashboard, LoaderCircle, LogOut, MapPin, MessageCircle,
  MessageSquareOff, Paperclip, Pencil, Plus, Send, Settings2, ShieldAlert, ShieldCheck,
  SlidersHorizontal, Sparkles, Star, Unlock, Upload, UserRound, UserRoundX, Video, X, Zap,
} from 'lucide-react'
import { AuthProvider, useAuth } from './auth'
import { AuthModal } from './components/AuthModal'
import { AvailabilityCalendar } from './components/AvailabilityCalendar'
import { CategorySelector } from './components/CategorySelector'
import { CoachAvatar } from './components/CoachAvatar'
import { HomeMatchStage } from './components/HomeMatchStage'
import { getCategoryIcon } from './components/icons/trainingIcons'
import { Button } from './components/ui/button'
import { api, ApiError } from './lib/api'
import { getCategoryVisual } from './lib/media'
import { hasSupabase, supabase } from './lib/supabase'
import { categories, coaches, isRemoteCoach, type Category, type Coach, type CoachService, type Mode } from './data'
import { getQuestionnaireSteps, type QuestionnaireOption } from './questionnaire'
import './i18n'

type MatchApiCoach = {
  id: string
  name: string
  specialty: string
  category: string
  mode: Mode
  city: string
  rating: number
  reviews: number
  price_from: number
  next_slot: string
  responds_now: boolean
  verified: boolean
  languages: string[]
  specialties: string[]
  match_reasons: string[]
  avatar_url?: string | null
}
type MatchApiResponse = {
  items: MatchApiCoach[]
  relaxed_filter: string | null
}
type LocalBooking = {
  id: string
  coachId: string
  coachName: string
  serviceName: string
  startsAt: string
  amount: number
  status: string
}
export type Profile = {
  id: string
  display_name: string
  role: 'consumer' | 'coach' | 'admin'
  email?: string | null
  city?: string | null
  avatar_url?: string | null
  updated_at?: string
  timezone?: string
}
type AvailableSlot = { starts_at: string; ends_at: string; label: string; occurrences?: string[] }
type ChatMessage = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  attachment_path?: string | null
  created_at: string
  delivery_status?: 'sending'
}
type ConversationRecord = {
  id: string
  consumer_id: string
  coach_id: string
  last_message_at: string
  consumer?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'> | null
  coach?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'> | null
  blocked_by_me: boolean
  blocked_me: boolean
}
type BlockedUserRecord = {
  blocker_id: string
  blocked_id: string
  created_at: string
  profile?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'> | null
}
type ModerationSanction = {
  id: string
  user_id: string
  kind: 'account' | 'messaging' | 'training'
  reason: string
  starts_at: string
  expires_at: string
  report_id?: string | null
  revoked_at?: string | null
  profile?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'role'> | null
}
type CoachServiceRecord = {
  id: string
  category_id: string
  name: string
  description: string
  mode: Mode
  duration_minutes: number
  price_cents: number
  package_size: number
  active: boolean
  offer_type: 'single' | 'flex_pack' | 'recurring_plan'
  booking_mode: 'instant' | 'request'
  expiry_days?: number | null
  cadence_weeks?: number | null
  recurring_schedule_mode?: 'fixed' | 'flexible'
  booking_window_days?: number
  available_weekdays?: number[]
  available_start_time?: string
  available_end_time?: string
  categories?: { slug?: string; name_es?: string } | null
  location_policy?: 'fixed_private' | 'travel' | 'agreed'
  public_area_label?: string | null
  private_location?: {
    address_line: string
    locality: string
    postal_code?: string
    instructions?: string
  } | null
}
type CoachProfileRecord = {
  user_id: string
  headline: string
  bio: string
  city?: string | null
  mode: Mode
  verification_status: string
  responds_now: boolean
  rating: number
  review_count: number
  years_experience?: number
  languages?: string[]
  preferred_video_provider?: 'meet' | 'zoom' | 'custom'
  presentation_video_url?: string | null
  min_booking_notice_minutes?: number
  profiles?: { display_name?: string; avatar_url?: string | null } | null
  coach_services?: CoachServiceRecord[]
}
type BookingRecord = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  amount_cents: number
  video_url?: string | null
  notes?: string | null
  meeting_provider?: string | null
  consumer_id?: string
  coach_id?: string
  outcome_status?: string | null
  outcome_finalized_at?: string | null
  coach_services?: { name?: string; description?: string; duration_minutes?: number; mode?: Mode; location_policy?: string; public_area_label?: string | null } | null
  profiles?: { display_name?: string } | null
  coach_profiles?: { headline?: string; profiles?: { display_name?: string } | null } | null
  session_reports?: Array<{ id: string; author_id: string; outcome: string }>
  reviews?: Array<{
    id: string
    author_id: string
    revealed_at?: string | null
  }>
  private_location?: {
    address_line: string
    locality: string
    postal_code?: string
    instructions?: string
  } | null
  booking_reschedule_requests?: Array<{
    id: string
    proposed_by: string
    proposed_starts_at: string
    proposed_ends_at: string
    reason?: string
    status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled'
    expires_at: string
  }>
}
type ProfessionalOverviewData = {
  coachProfile: (CoachProfileRecord & { availability_rules?: any[]; stripe_account_id?: string | null }) | null
  services: CoachServiceRecord[]
  bookings: BookingRecord[]
}
type CredentialStatus = {
  verification_status: string
  verification_note?: string | null
  video_path?: string | null
  video_status: string
  video_review_note?: string | null
  updated_at: string
  credential?: {
    id: string
    title: string
    status: string
    review_note?: string | null
    created_at: string
    reviewed_at?: string | null
  } | null
}
type AdminUser = {
  id: string
  display_name: string
  email?: string | null
  role: Profile['role']
  created_at?: string | null
  last_sign_in_at?: string | null
  access_enabled: boolean
  coach?: {
    user_id: string
    verification_status: string
    verification_note?: string | null
  } | null
  active_sanctions?: ModerationSanction[]
}
const CoachMap = lazy(() =>
  import('./components/CoachMap').then((module) => ({
    default: module.CoachMap,
  })),
)

const mergeMessage = (items: ChatMessage[], row: ChatMessage) => (items.some((item) => item.id === row.id) ? items : [...items, row])

const fallbackCoach = (row: MatchApiCoach): Coach => ({
  id: row.id,
  name: row.name,
  initials: row.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
  specialty: row.specialty,
  category: row.category,
  mode: row.mode,
  city: row.city,
  rating: row.rating,
  reviews: row.reviews,
  price: row.price_from,
  response: row.responds_now ? 'Ahora' : '< 2 h',
  nextSlot: row.next_slot,
  verified: row.verified,
  onlineNow: row.responds_now,
  bio: 'Un enfoque claro, profesional y adaptado a tu objetivo.',
  avatarUrl: row.avatar_url || undefined,
  tags: [row.specialty, ...(row.specialties || []), ...(row.languages || []), row.mode === 'presencial' ? 'Presencial' : 'Online'],
  services: [{ name: 'Sesión individual', detail: '60 min', price: row.price_from }],
  matchReasons: row.match_reasons,
})

const coachFromProfile = (row: CoachProfileRecord, fallback?: Coach): Coach => {
  const services: CoachService[] = (row.coach_services || [])
    .filter((item) => item.active !== false)
    .map((item) => ({
      id: item.id,
      name: item.name,
      detail: item.offer_type === 'recurring_plan'
        ? item.recurring_schedule_mode === 'flexible'
          ? `Serie de ${item.package_size} sesiones · eliges todas las fechas · pago único`
          : `Serie de ${item.package_size} sesiones · mismo día y hora cada ${item.cadence_weeks === 2 ? '2 semanas' : 'semana'} · pago único`
        : item.offer_type === 'flex_pack'
          ? `Bono de ${item.package_size} sesiones · eliges cada fecha después · caduca en ${item.expiry_days} días`
          : `${item.duration_minutes} min · ${item.mode}`,
      price: item.price_cents / 100,
      duration: item.duration_minutes,
      packageSize: item.package_size,
      offerType: item.offer_type || (item.package_size > 1 ? 'flex_pack' : 'single'),
      bookingMode: item.booking_mode || 'instant',
      expiryDays: item.expiry_days,
      cadenceWeeks: item.cadence_weeks,
      recurringScheduleMode: item.recurring_schedule_mode || (item.offer_type === 'recurring_plan' && item.cadence_weeks == null ? 'flexible' : 'fixed'),
      bookingWindowDays: item.booking_window_days || 31,
      availableWeekdays: item.available_weekdays || [0, 1, 2, 3, 4, 5, 6],
      availableStartTime: item.available_start_time?.slice(0, 5) || '00:00',
      availableEndTime: item.available_end_time?.slice(0, 5) || '23:59',
    }))
  const displayName = row.profiles?.display_name || fallback?.name || 'Entrenador'
  return {
    id: row.user_id,
    name: displayName,
    initials: displayName
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase(),
    avatarUrl: row.profiles?.avatar_url || fallback?.avatarUrl,
    avatarAvifUrl: fallback?.avatarAvifUrl,
    specialty: row.headline || services[0]?.name || 'Entrenamiento personalizado',
    category: row.coach_services?.find((item) => item.categories?.slug)?.categories?.slug || fallback?.category || 'fitness',
    mode: row.mode,
    city: row.city || 'Online',
    rating: Number(row.rating || 0),
    reviews: row.review_count || 0,
    price: services.length ? Math.min(...services.map((item) => item.price)) : 0,
    response: '< 2 h',
    nextSlot: 'Consulta la agenda',
    verified: row.verification_status === 'verified',
    onlineNow: row.responds_now,
    bio: row.bio || 'Este profesional está preparando la presentación de su método.',
    tags: [row.headline, ...(row.languages || [])].filter(Boolean),
    services,
    videoProvider: row.preferred_video_provider,
    presentationVideoUrl: row.presentation_video_url || undefined,
    minBookingNoticeMinutes: row.min_booking_notice_minutes ?? 30,
  }
}

const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const weekdayNames = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

const formatBookingNotice = (minutes = 30) => {
  if (minutes === 0) return 'sin margen mínimo'
  if (minutes < 60) return `${minutes} min de antelación`
  if (minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'día' : 'días'} de antelación`
  return `${minutes / 60} h de antelación`
}

const formatServiceWeekdays = (days: number[] = []) => {
  if (days.length === 7) return 'Todos los días'
  if (days.length === 5 && days.every((day, index) => day === index)) return 'De lunes a viernes'
  return days.map((day) => weekdayNames[day]).filter(Boolean).join(', ')
}

const formatServiceHours = (startsAt = '00:00', endsAt = '23:59') => {
  const start = startsAt.slice(0, 5)
  const end = endsAt.slice(0, 5)
  return start === '00:00' && end === '23:59' ? 'Según agenda general' : `${start}—${end}`
}

const startOfWeek = (value: Date) => {
  const date = new Date(value)
  const day = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date
}

const addDays = (value: Date, days: number) => {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

const startOfDay = (value: Date) => {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

const startOfMonth = (value: Date) => {
  const date = startOfDay(value)
  date.setDate(1)
  return date
}

const addMonths = (value: Date, months: number) => {
  const date = new Date(value)
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  return date
}

type CalendarView = 'day' | 'week' | 'month'

const calendarDaysFor = (view: CalendarView, anchor: Date) => {
  if (view === 'day') return [startOfDay(anchor)]
  if (view === 'week') return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))
  const gridStart = startOfWeek(startOfMonth(anchor))
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <CoachConnect />
      </BrowserRouter>
    </AuthProvider>
  )
}

function CoachConnect() {
  const [authOpen, setAuthOpen] = useState(false)
  const location = useLocation()
  const isHomeRoute = location.pathname === '/'
  return (
    <div className={`app-shell ${isHomeRoute ? 'home-route' : ''}`}>
      <Header onAuth={() => setAuthOpen(true)} />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buscar" element={<Results />} />
          <Route path="/entrenadores/:coachId" element={<CoachProfile onAuth={() => setAuthOpen(true)} />} />
          <Route path="/cuenta" element={<Account onAuth={() => setAuthOpen(true)} />} />
          <Route path="/reservas" element={<Account onAuth={() => setAuthOpen(true)} />} />
          <Route path="/mensajes" element={<Messages onAuth={() => setAuthOpen(true)} />} />
          <Route path="/notificaciones" element={<Notifications onAuth={() => setAuthOpen(true)} />} />
          <Route path="/profesional" element={<ProPortal onAuth={() => setAuthOpen(true)} />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!isHomeRoute && <Footer />}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      <Toaster position="bottom-center" richColors closeButton />
    </div>
  )
}

function Header({ onAuth }: { onAuth: () => void }) {
  const { user, signOut } = useAuth()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.resolvedLanguage || i18n.language || 'es'
  const toggleLanguage = () => void i18n.changeLanguage(currentLanguage.startsWith('es') ? 'en' : 'es')
  const confirmLogout = async () => {
    setLogoutBusy(true)
    try {
      await signOut()
      setLogoutOpen(false)
      toast.success('Sesión cerrada')
    } catch {
      toast.error('No se pudo cerrar la sesión')
    } finally {
      setLogoutBusy(false)
    }
  }
  return (
    <>
      <header className="topbar">
        <Link className="brand" to="/" aria-label="Volver a CoachConnect">
          <span className="brand-mark">
            <span />
          </span>
          <span>
            Coach<span className="brand-link">Connect</span>
          </span>
        </Link>
        <nav className="top-actions" aria-label="Navegación principal">
          <button className="language-toggle" onClick={toggleLanguage}>
            {currentLanguage.startsWith('es') ? 'EN' : 'ES'}
          </button>
          <Link className="text-button subtle coach-nav-link" to="/profesional" aria-label={t('nav.coach')}>
            <Zap />
            <span>{t('nav.coach')}</span>
          </Link>
          {user && (
            <Link className="text-button subtle desktop-account" to="/mensajes">
              {t('nav.messages')}
            </Link>
          )}
          {user && (
            <Link className="icon-button" to="/notificaciones" aria-label={t('nav.notifications')}>
              <Bell />
            </Link>
          )}
          {user ? (
            <div className="user-actions">
              <Link className="login-button" to="/cuenta">
                <UserRound /> {t('nav.account')}
              </Link>
              <button className="icon-button logout-button" onClick={() => setLogoutOpen(true)} aria-label="Cerrar sesión">
                <LogOut />
              </button>
            </div>
          ) : (
            <button className="login-button" onClick={onAuth}>
              <UserRound /> {t('nav.login')}
            </button>
          )}
        </nav>
      </header>
      {logoutOpen && <ConfirmDialog title="¿Cerrar sesión?" copy="Tendrás que volver a identificarte para acceder a tus reservas, mensajes y perfil." confirmLabel="Sí, cerrar sesión" busy={logoutBusy} onCancel={() => setLogoutOpen(false)} onConfirm={confirmLogout} />}
    </>
  )
}

function ConfirmDialog({ title, copy, confirmLabel, busy, onCancel, onConfirm }: { title: string; copy: string; confirmLabel: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [busy, onCancel])
  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="confirm-icon">
          <LogOut />
        </div>
        <p className="eyebrow">Confirmación</p>
        <h2 id="confirm-title">{title}</h2>
        <p>{copy}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <Button onClick={onConfirm} disabled={busy} autoFocus>
            {busy && <LoaderCircle className="spin" />} {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  )
}

function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [category, setCategory] = useState<Category | null>(null)
  const [previewId, setPreviewId] = useState(categories[0].id)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [guideActive, setGuideActive] = useState(false)
  const categorySelectorRef = useRef<HTMLElement>(null)
  const begin = (item: Category) => {
    setCategory(item)
    setAnswers({ category: item.id })
    setStep(1)
  }
  const finish = (completedAnswers: Record<string, string>) => {
    const search = new URLSearchParams(completedAnswers)
    navigate(`/buscar?${search}`)
  }
  const answer = (key: string, value: string) => {
    const completedAnswers = { ...answers, [key]: value }
    const completedSteps = category ? getQuestionnaireSteps(category, completedAnswers) : []
    if (step >= completedSteps.length) finish(completedAnswers)
    else {
      setAnswers(completedAnswers)
      setStep((current) => current + 1)
    }
  }
  const displayCategories = categories.map((item) => ({
    ...item,
    label: t(`home.categories.${item.id}.label`, { defaultValue: item.label }),
    kicker: t(`home.categories.${item.id}.kicker`, {
      defaultValue: item.kicker,
    }),
    examples: item.examples.map((example, index) =>
      t(`home.categories.${item.id}.examples.${index}`, {
        defaultValue: example,
      }),
    ),
  }))
  const previewIndex = Math.max(
    0,
    categories.findIndex((item) => item.id === previewId),
  )
  const previewCategory = displayCategories[previewIndex]
  const verifiedCoaches = coaches.filter((item) => item.verified)
  const focusCategorySelector = () => {
    const selector = categorySelectorRef.current
    if (!selector) return
    setGuideActive(false)
    selector.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
    selector.querySelector<HTMLButtonElement>(`[data-category-id="${previewId}"]`)?.focus({ preventScroll: true })
    window.requestAnimationFrame(() => {
      setGuideActive(true)
    })
  }
  if (step === 0)
    return (
      <section className="hero-screen" aria-labelledby="home-title">
        <div className="hero-grid" />
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" /> {t('home.eyebrow')}
          </p>
          <h1 id="home-title">
            {t('home.titleBefore')}
            <br />
            <em>{t('home.titleAccent')}</em>
            <br />
            {t('home.titleAfter')}
          </h1>
          <p className="hero-deck">{t('home.description')}</p>
          <div className="hero-cta-row">
            <Button className="hero-selector-cta" size="lg" onClick={focusCategorySelector}>
              {t('home.action')} <ArrowRight aria-hidden="true" />
            </Button>
            {verifiedCoaches.length > 0 && (
              <div className="coach-proof">
                <span className="coach-proof-avatars">
                  {verifiedCoaches.slice(0, 4).map((coach) => (
                    <CoachAvatar coach={coach} className="proof-avatar" key={coach.id} eager title={`${coach.name} · ${coach.specialty}`} />
                  ))}
                </span>
                <span>
                  <strong>
                    <ShieldCheck aria-hidden="true" /> {t('home.verified')}
                  </strong>
                  <small>{t('home.proofRating')}</small>
                  <small>{t('home.proofDetail')}</small>
                </span>
              </div>
            )}
          </div>
        </div>
        <HomeMatchStage
          category={previewCategory}
          categoryIndex={previewIndex}
          categoryCount={displayCategories.length}
          categoryIcon={getCategoryIcon(previewCategory.id)}
          onGuide={focusCategorySelector}
          labels={{
            eyebrow: t('home.stage.eyebrow'),
            status: t('home.stage.status'),
            specialty: t('home.stage.specialty'),
            criteria: t('home.stage.criteria'),
            location: t('home.stage.location'),
            rating: t('home.stage.rating'),
            response: t('home.stage.response'),
            ready: t('home.stage.ready'),
            action: t('home.stage.action'),
          }}
        />
        <div className="hero-number" aria-hidden="true">
          01<span>/04</span>
        </div>
        <CategorySelector
          ref={categorySelectorRef}
          categories={displayCategories}
          activeCategoryId={previewId}
          guideActive={guideActive}
          onActiveChange={setPreviewId}
          onSelect={(item) => begin(categories.find((categoryItem) => categoryItem.id === item.id) || item)}
          labels={{
            question: t('home.question'),
            help: t('home.questionHelp'),
            previous: t('home.categoriesPrevious'),
            next: t('home.categoriesNext'),
            region: t('home.categoriesRegion'),
            active: t('home.categoryActive'),
          }}
        />
      </section>
    )
  if (!category) return null
  const steps = getQuestionnaireSteps(category, answers)
  const current = steps[step - 1]
  return (
    <section className="question-screen" aria-labelledby="question-title">
      <div className="question-progress">
        <span>02 — Afinemos la búsqueda</span>
        <div>
          <i style={{ width: `${Math.min(100, (step / steps.length) * 100)}%` }} />
        </div>
        <b>
          {String(step).padStart(2, '0')}
          <small>/{String(steps.length).padStart(2, '0')}</small>
        </b>
      </div>
      <div className="question-layout">
        <QuestionnaireContext category={category} answers={answers} step={step} total={steps.length} onChange={() => setStep(0)} />
        <div className="question-wrap">
          <button type="button" className="back-link" onClick={() => setStep(Math.max(0, step - 1))}>
            <ArrowLeft /> Atrás
          </button>
          {current?.kind === 'location' ? <LocationQuestion title={current.title} initialValue={answers.city} onSelect={(value) => answer(current.key, value)} /> : current ? <Question title={current.title} options={current.options} onSelect={(value) => answer(current.key, value)} /> : null}
        </div>
      </div>
    </section>
  )
}

const questionAccentColors: Record<string, string> = {
  lime: '#c8ff20',
  coral: '#ff927d',
  blue: '#9ed8ff',
  gold: '#f3d47a',
  violet: '#c9c0ff',
  pink: '#ffbed8',
  mint: '#a9efd6',
  sand: '#dfc6a2',
}

function QuestionnaireContext({ category, answers, step, total, onChange }: { category: Category; answers: Record<string, string>; step: number; total: number; onChange: () => void }) {
  const visual = getCategoryVisual(category.id)
  const CategoryIcon = getCategoryIcon(category.id)
  const style = {
    '--question-accent': questionAccentColors[category.accent] || questionAccentColors.lime,
  } as CSSProperties
  return (
    <aside className="question-category-card" style={style} aria-label={`Especialidad elegida: ${category.label}`}>
      <picture className="question-category-photo" aria-hidden="true">
        <source srcSet={visual.avif} type="image/avif" />
        <img src={visual.webp} alt="" width="800" height="600" decoding="async" style={{ objectPosition: visual.objectPosition }} />
      </picture>
      <div className="question-category-content">
        <span className="question-category-kicker">
          <CategoryIcon aria-hidden="true" /> Especialidad elegida
        </span>
        <strong>{category.label}</strong>
        <p>{answers.subcategory || category.kicker}</p>
      </div>
      <div className="question-category-foot">
        <span>
          Paso {String(step).padStart(2, '0')} de {String(total).padStart(2, '0')}
        </span>
        <button type="button" onClick={onChange}>
          Cambiar
        </button>
      </div>
    </aside>
  )
}

function OptionButton({ option, index, onSelect }: { option: QuestionnaireOption; index: number; onSelect: () => void }) {
  const Icon = option.icon
  return (
    <button type="button" className="option-card" onClick={onSelect}>
      <span className="option-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="option-index" aria-hidden="true">
        0{index + 1}
      </span>
      <strong>{option.label}</strong>
      <ArrowRight aria-hidden="true" />
    </button>
  )
}

function Question({ title, options, onSelect }: { title: string; options: QuestionnaireOption[]; onSelect: (value: string) => void }) {
  return (
    <div className="question-content">
      <p className="eyebrow">Una respuesta rápida</p>
      <h2 id="question-title">{title}</h2>
      <div className="option-list">
        {options.map((option, index) => (
          <OptionButton key={option.label} option={option} index={index} onSelect={() => onSelect(option.label)} />
        ))}
      </div>
    </div>
  )
}

type PhotonFeature = {
  properties: {
    osm_type?: string
    osm_id?: number
    name?: string
    city?: string
    county?: string
    state?: string
    postcode?: string
    countrycode?: string
    type?: string
    osm_key?: string
  }
}
type LocationSuggestion = {
  id: string
  label: string
  name: string
  detail: string
  value: string
}

function toLocationSuggestions(features: PhotonFeature[]): LocationSuggestion[] {
  const seen = new Set<string>()
  return features.flatMap((feature, index) => {
    const properties = feature.properties
    const name = properties.name?.trim()
    if (!name || properties.countrycode?.toUpperCase() !== 'ES' || !['place', 'boundary'].includes(properties.osm_key || '')) return []
    const detailParts = [properties.postcode, properties.city, properties.county, properties.state]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part) && part?.toLocaleLowerCase('es') !== name.toLocaleLowerCase('es'))
      .filter((part, partIndex, parts) => parts.findIndex((candidate) => candidate.toLocaleLowerCase('es') === part.toLocaleLowerCase('es')) === partIndex)
    const detail = detailParts.join(' · ')
    const label = detail ? `${name}, ${detail}` : name
    if (seen.has(label.toLocaleLowerCase('es'))) return []
    seen.add(label.toLocaleLowerCase('es'))
    return [
      {
        id: `${properties.osm_type || 'place'}-${properties.osm_id || index}`,
        label,
        name,
        detail: detail || 'España',
        value: properties.city?.trim() || name,
      },
    ]
  })
}

function useLocationLookup(locationValue: string, acceptedLabel?: string) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const query = locationValue.trim()
    if (acceptedLabel === query || query.length < 3) {
      setSuggestions([])
      setLookupState(acceptedLabel === query && query ? 'ready' : 'idle')
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLookupState('loading')
      try {
        const url = new URL('https://photon.komoot.io/api/')
        url.searchParams.set('q', query)
        url.searchParams.set('limit', '6')
        url.searchParams.set('countrycode', 'ES')
        if (!/^\d/.test(query)) {
          for (const layer of ['city', 'locality', 'district', 'county', 'state']) url.searchParams.append('layer', layer)
        }
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error('Location lookup failed')
        const data = (await response.json()) as { features?: PhotonFeature[] }
        const nextSuggestions = toLocationSuggestions(data.features || []).slice(0, 5)
        setSuggestions(nextSuggestions)
        setLookupState(nextSuggestions.length ? 'ready' : 'empty')
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setSuggestions([])
          setLookupState('error')
        }
      }
    }, 400)
    return () => { window.clearTimeout(timeout); controller.abort() }
  }, [acceptedLabel, locationValue, retryToken])

  return { suggestions, lookupState, retry: () => setRetryToken((value) => value + 1), clearSuggestions: () => setSuggestions([]), setLookupState }
}

function LocationQuestion({ title, initialValue, onSelect }: { title: string; initialValue?: string; onSelect: (value: string) => void }) {
  const [locationValue, setLocationValue] = useState(initialValue || '')
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null)
  const { suggestions, lookupState, retry, clearSuggestions, setLookupState } = useLocationLookup(locationValue, selectedLocation?.label)

  const chooseLocation = (suggestion: LocationSuggestion) => {
    setLocationValue(suggestion.label)
    setSelectedLocation(suggestion)
    clearSuggestions()
    setLookupState('ready')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (selectedLocation) onSelect(selectedLocation.value)
  }
  return <div className="question-content location-question"><p className="eyebrow">Elige una ubicación real</p><h2 id="question-title">{title}</h2><p className="location-copy" id="location-help">Empieza a escribir y selecciona la coincidencia correcta.</p>
    <form className="location-form" onSubmit={submit}>
      <label className="sr-only" htmlFor="location-input">Ciudad, municipio, barrio o código postal</label>
      <div className={`location-input-shell ${selectedLocation ? 'is-selected' : ''}`}><MapPin aria-hidden="true" /><input id="location-input" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="location-suggestions" value={locationValue} onChange={(event) => { setLocationValue(event.target.value); setSelectedLocation(null); setLookupState('idle') }} placeholder="Por ejemplo, Sevilla, Getxo o 29010" autoComplete="off" aria-describedby="location-help location-status" autoFocus /><button type="submit" disabled={!selectedLocation} aria-label="Continuar con esta ubicación">{selectedLocation ? <Check aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}</button></div>
      <div className="location-status" id="location-status" aria-live="polite">
        {lookupState === 'loading' && <span><LoaderCircle className="spin" aria-hidden="true" /> Buscando coincidencias…</span>}
        {lookupState === 'empty' && <span>No encontramos ese lugar. Prueba con el municipio o el código postal.</span>}
        {lookupState === 'error' && <span>No pudimos consultar las ubicaciones. <button type="button" onClick={retry}>Reintentar</button></span>}
        {selectedLocation && <span className="location-confirmed"><Check aria-hidden="true" /> Ubicación seleccionada</span>}
      </div>
      <div className="location-suggestions" id="location-suggestions" role="listbox" aria-label="Coincidencias de ubicación">
        {suggestions.map((suggestion) => <button type="button" role="option" aria-selected="false" key={suggestion.id} onClick={() => chooseLocation(suggestion)}><MapPin aria-hidden="true" /><span><strong>{suggestion.name}</strong><small>{suggestion.detail}</small></span><ArrowRight aria-hidden="true" /></button>)}
      </div>
      <small>Resultados de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>. Selecciona uno para continuar.</small>
    </form>
    <button type="button" className="location-online" onClick={() => onSelect('Cualquier lugar si es online')}><span className="option-icon"><Globe2 aria-hidden="true" /></span><span><strong>Cualquier lugar si es online</strong><small>Buscaremos entrenadores online sin filtrar por zona.</small></span><ArrowRight aria-hidden="true" /></button>
  </div>
}

function CityAutocompleteField({ initialValue = '', onValueChange }: { initialValue?: string; onValueChange?: (value: string) => void }) {
  const [displayValue, setDisplayValue] = useState(initialValue)
  const [cityValue, setCityValue] = useState(initialValue)
  const [acceptedLabel, setAcceptedLabel] = useState(initialValue)
  const { suggestions, lookupState, retry, clearSuggestions, setLookupState } = useLocationLookup(displayValue, acceptedLabel)
  const choose = (suggestion: LocationSuggestion) => {
    setDisplayValue(suggestion.label)
    setAcceptedLabel(suggestion.label)
    setCityValue(suggestion.value)
    onValueChange?.(suggestion.value)
    clearSuggestions()
    setLookupState('ready')
  }
  return <div className="pro-location-field wide"><label htmlFor="profile-city">Ciudad o municipio</label><input type="hidden" name="city" value={cityValue} /><div className={`location-input-shell ${cityValue ? 'is-selected' : ''}`}><MapPin aria-hidden="true" /><input id="profile-city" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="profile-city-suggestions" value={displayValue} onChange={(event) => { setDisplayValue(event.target.value); setCityValue(''); setAcceptedLabel(''); onValueChange?.(''); setLookupState('idle') }} placeholder="Empieza a escribir tu ciudad" autoComplete="off" /><span className="location-field-state">{cityValue ? <Check aria-label="Ciudad seleccionada" /> : lookupState === 'loading' ? <LoaderCircle className="spin" aria-label="Buscando ciudad" /> : null}</span></div><div className="location-status" aria-live="polite">{lookupState === 'empty' && <span>No encontramos ese lugar.</span>}{lookupState === 'error' && <span>No pudimos consultar las ubicaciones. <button type="button" onClick={retry}>Reintentar</button></span>}</div><div className="location-suggestions" id="profile-city-suggestions" role="listbox" aria-label="Coincidencias de ciudad">{suggestions.map((suggestion) => <button type="button" role="option" aria-selected="false" key={suggestion.id} onClick={() => choose(suggestion)}><MapPin aria-hidden="true" /><span><strong>{suggestion.name}</strong><small>{suggestion.detail}</small></span><ArrowRight aria-hidden="true" /></button>)}</div></div>
}

function Results() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const requestedOnline = search.get('mode') === 'Online' || search.get('city')?.startsWith('Cualquier') === true
  const [items, setItems] = useState<Coach[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [relaxedFilter, setRelaxedFilter] = useState<string | null>(null)
  const [mode, setMode] = useState<'all' | 'online' | 'presencial'>(requestedOnline ? 'online' : 'all')
  const [sort, setSort] = useState('match')
  const [mapOpen, setMapOpen] = useState(false)
  const category = search.get('category') || 'fitness'
  useEffect(() => {
    setLoading(true)
    setLoadError('')
    const rawMode = search.get('mode')
    const rawBudget = search.get('budget')
    const language = search.get('language')
    const payload = {
      category,
      subcategory: search.get('subcategory'),
      city: search.get('city')?.startsWith('Cualquier') ? undefined : search.get('city'),
      mode: requestedOnline || rawMode === 'Online' ? 'online' : rawMode === 'Presencial' ? 'presencial' : undefined,
      max_price: rawBudget?.startsWith('Hasta') ? Number(rawBudget.match(/\d+/)?.[0]) : undefined,
      languages: language === 'Español' ? ['es'] : language === 'Inglés' ? ['en'] : [],
    }
    api<MatchApiResponse>('/api/v1/matching/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
      .then((data) => {
        setItems(data.items.map(fallbackCoach))
        setRelaxedFilter(data.relaxed_filter)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'No pudimos consultar los entrenadores.'
        setItems([])
        setRelaxedFilter(null)
        setLoadError(message)
        toast.error(message)
      })
      .finally(() => setLoading(false))
  }, [category, requestedOnline, search, retryKey])
  const shown = useMemo(() => {
    const filtered = items.filter((coach) => (mode === 'all' || coach.mode === mode || coach.mode === 'hibrido') && (coach.category === category || !items.some((item) => item.category === category)))
    const requestedSubcategory = search.get('subcategory')?.toLocaleLowerCase('es') || ''
    const requestedCity = search.get('city')?.toLocaleLowerCase('es') || ''
    return [...filtered].sort((a, b) => {
      if (sort === 'price') return a.price - b.price
      if (sort === 'rating') return b.rating - a.rating || b.reviews - a.reviews
      if (sort === 'availability') return Number(b.onlineNow) - Number(a.onlineNow)
      const specialtyDifference = Number(b.category === category) - Number(a.category === category) || Number(Boolean(requestedSubcategory) && [b.specialty, ...b.tags].some((value) => value.toLocaleLowerCase('es').includes(requestedSubcategory))) - Number(Boolean(requestedSubcategory) && [a.specialty, ...a.tags].some((value) => value.toLocaleLowerCase('es').includes(requestedSubcategory)))
      const locationDifference = Number(Boolean(requestedCity) && b.city.toLocaleLowerCase('es') === requestedCity) - Number(Boolean(requestedCity) && a.city.toLocaleLowerCase('es') === requestedCity)
      return specialtyDifference || locationDifference || b.rating - a.rating || b.reviews - a.reviews || Number(b.onlineNow) - Number(a.onlineNow)
    })
  }, [items, mode, sort, category, search])
  const label = categories.find((item) => item.id === category)?.label || 'Entrenadores'
  return (
    <section className="results-screen">
      <div className="results-head">
        <Link className="back-link" to="/">
          <ArrowLeft /> Cambiar búsqueda
        </Link>
        <div className="results-title">
          <div>
            <p className="eyebrow">Tu búsqueda</p>
            <h1>
              {label}
              <span> que encajan contigo.</span>
            </h1>
          </div>
          <div className="result-count">
            <strong>{shown.length}</strong>
            <small>
              coincidencias
              <br />
              encontradas
            </small>
          </div>
        </div>
        <div className="answer-pills">
          <span>
            <b>Especialidad</b>
            {label}
          </span>
          {search.get('city') && (
            <span>
              <b>Zona</b>
              {search.get('city')}
            </span>
          )}
        </div>
      </div>
      <div className="results-toolbar">
        <div className="mode-tabs">
          {(
            [
              ['all', 'Todos'],
              ['online', 'Online'],
              ['presencial', 'Presencial'],
            ] as const
          ).map(([value, text]) => (
            <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>
              {text}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label className="select-wrap">
            <span>Ordenar</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="match">Mejor coincidencia</option>
              <option value="availability">Disponibilidad</option>
              <option value="rating">Reputación</option>
              <option value="price">Precio</option>
            </select>
            <ChevronDown />
          </label>
          <button className={`map-toggle ${mapOpen ? 'active' : ''}`} onClick={() => setMapOpen(!mapOpen)}>
            <MapPin /> {mapOpen ? 'Ocultar mapa' : 'Ver mapa'}
          </button>
        </div>
      </div>
      {relaxedFilter && (
        <div className="match-notice">
          <Sparkles />
          <span>
            No encontramos una coincidencia completa. Hemos relajado <strong>{relaxedFilter}</strong> para enseñarte la alternativa más cercana.
          </span>
        </div>
      )}
      <div className={`results-layout ${mapOpen ? 'with-map' : ''}`}>
        <div className="coach-list">
          {loading && <LoadingBlock label="Buscando el mejor encaje" />}
          {!loading && loadError && <div className="empty-state" role="alert"><Sparkles /><h2>No pudimos cargar los entrenadores.</h2><p>{loadError} No mostramos perfiles de muestra para evitar confundirlos con datos reales.</p><Button onClick={() => setRetryKey((current) => current + 1)}>Reintentar</Button></div>}
          {!loading && !loadError && shown.map((coach, index) => <CoachCard key={coach.id} coach={coach} rank={index + 1} onClick={() => navigate(`/entrenadores/${coach.id}`, { state: { coach } })} />)}
          {!loading && !loadError && !shown.length && (
            <div className="empty-state">
              <Sparkles />
              <h2>Podemos abrir un poco la búsqueda.</h2>
              <p>Prueba con otra modalidad o zona.</p>
            </div>
          )}
        </div>
        {mapOpen && (
          <Suspense fallback={<LoadingBlock label="Cargando mapa" />}>
            <CoachMap coaches={shown} onCoach={(coach) => navigate(`/entrenadores/${coach.id}`, { state: { coach } })} />
          </Suspense>
        )}
      </div>
    </section>
  )
}

function CoachCard({ coach, rank, onClick }: { coach: Coach; rank: number; onClick: () => void }) {
  return (
    <article className="coach-card" onClick={onClick} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onClick()}>
      <CoachAvatar coach={coach} className={`avatar avatar-${rank}`} />
      <div className="coach-main">
        <div className="coach-card-top">
          <div>
            <p className="coach-specialty">{coach.specialty}</p>
            <h2>{coach.name}</h2>
          </div>
          <div className="rating">
            <Star fill="currentColor" /> <strong>{coach.reviews >= 3 ? coach.rating : 'Nuevo'}</strong>
            <span>({coach.reviews} relaciones)</span>
          </div>
        </div>
        <p className="coach-bio">{coach.bio}</p>
        {coach.matchReasons?.length ? (
          <div className="match-reasons">
            {coach.matchReasons.slice(0, 3).map((reason) => (
              <span key={reason}>
                <Check /> {reason}
              </span>
            ))}
          </div>
        ) : null}
        <div className="coach-meta">
          <span>
            <MapPin /> {coach.city}
          </span>
          <span>
            <Clock3 /> {coach.nextSlot}
          </span>
          <span className={coach.onlineNow ? 'is-live' : ''}>
            <Zap /> {coach.onlineNow ? 'Responde ahora' : coach.response}
          </span>
        </div>
        <div className="coach-card-bottom">
          <div className="tag-row">
            {coach.tags.slice(0, 2).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <strong className="price-from">
            Desde {coach.price} € <small>/ sesión</small>
          </strong>
        </div>
      </div>
      <ArrowRight className="card-arrow" />
    </article>
  )
}

function CoachProfile({ onAuth }: { onAuth: () => void }) {
  const { coachId = '' } = useParams()
  const [profileSearch] = useSearchParams()
  const packageId = profileSearch.get('package')
  const packageServiceId = profileSearch.get('service')
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const preview = profileSearch.get('preview') === '1' && user?.id === coachId
  const ownProfile = user?.id === coachId
  const initial = (location.state as { coach?: Coach } | null)?.coach || coaches.find((item) => item.id === coachId)
  const [coach, setCoach] = useState<Coach | undefined>(initial)
  const [profileLoading, setProfileLoading] = useState(isRemoteCoach(coachId))
  const [profileError, setProfileError] = useState('')
  const [service, setService] = useState(0)
  const [slot, setSlot] = useState('')
  const [recurringSlots, setRecurringSlots] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [publicReviews, setPublicReviews] = useState<any[]>([])
  useEffect(() => {
    if (!isRemoteCoach(coachId)) return
    setProfileLoading(true)
    setProfileError('')
    const endpoint = preview ? '/api/v1/coach/profile' : `/api/v1/coaches/${coachId}`
    api<CoachProfileRecord>(endpoint)
      .then((row) => {
        const mapped = coachFromProfile(row, initial)
        setCoach(mapped)
        if (packageServiceId) {
          const selectedIndex = mapped.services.findIndex((item) => item.id === packageServiceId)
          if (selectedIndex >= 0) setService(selectedIndex)
        }
      })
      .catch((error) => setProfileError(error instanceof Error ? error.message : 'No se pudo abrir el perfil'))
      .finally(() => setProfileLoading(false))
  }, [coachId, initial, packageServiceId, preview])
  useEffect(() => {
    if (!isRemoteCoach(coachId) || preview) return
    api<{ items: any[] }>(`/api/v1/coaches/${coachId}/reviews`)
      .then((data) => setPublicReviews(data.items))
      .catch(() => setPublicReviews([]))
  }, [coachId, preview])
  useEffect(() => {
    const selectedService = coach?.services[service]
    if (preview) {
      setSlots([])
      setSlotsLoading(false)
      return
    }
    if (!isRemoteCoach(coachId)) {
      setSlots([])
      setSlotsLoading(false)
      return
    }
    if (!selectedService?.id) {
      setSlots([])
      setSlotsLoading(false)
      return
    }
    setSlot('')
    setRecurringSlots([])
    setSlotsLoading(true)
    api<{ items: Array<{ starts_at: string; ends_at: string; occurrences?: string[] }> }>(`/api/v1/coaches/${coachId}/slots?service_id=${selectedService.id}`)
      .then(({ items }) =>
        setSlots(
          items.map((item) => ({
            ...item,
            label: new Date(item.starts_at).toLocaleString('es-ES', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })),
        ),
      )
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [coachId, coach?.services, preview, service])
  if (profileLoading && isRemoteCoach(coachId)) return <LoadingPage />
  if (profileError && isRemoteCoach(coachId))
    return (
      <section className="auth-required">
        <h1>No pudimos abrir este perfil.</h1>
        <p>{profileError}</p>
        <Link className="button button-primary button-md" to={preview ? '/profesional' : '/buscar'}>
          Volver
        </Link>
      </section>
    )
  if (!coach) return <NotFound />
  const selectedService = coach.services[service]
  const selectedSlot = slots.find((item) => item.starts_at === slot)
  const flexibleRecurring = selectedService?.offerType === 'recurring_plan' && selectedService.recurringScheduleMode === 'flexible'
  const pricePerSession = selectedService?.packageSize && selectedService.packageSize > 1
    ? selectedService.price / selectedService.packageSize
    : selectedService?.price
  const reserve = async () => {
    if (!user) return onAuth()
    if (ownProfile) return toast.error('No puedes reservar un entrenamiento contigo mismo.')
    const selected = coach.services[service]
    if (!selected) return toast.error('Este entrenador aún no tiene servicios disponibles.')
    if (isRemoteCoach(coach.id) && !selected.id) return toast.error('No pudimos cargar este servicio. Actualiza la página e inténtalo de nuevo.')
    if (flexibleRecurring && recurringSlots.length !== selected.packageSize) {
      return toast.error(`Elige las ${selected.packageSize} fechas del plan antes de continuar.`)
    }
    if (!flexibleRecurring && (packageId || selected.offerType === 'recurring_plan' || !selected.packageSize || selected.packageSize <= 1)) {
      if (!slot) return toast.error('Elige primero un horario.')
    }
    setBusy(true)
    try {
      if (isRemoteCoach(coach.id) && selected.id) {
        if (packageId) {
          await api('/api/v1/packages/book', {
            method: 'POST',
            body: JSON.stringify({
              package_id: packageId,
              starts_at: slot,
              meeting_provider: coach.videoProvider || 'meet',
            }),
          })
          toast.success('Sesión reservada con tu bono.')
          navigate('/reservas')
          return
        }
        const endpoint = selected.packageSize && selected.packageSize > 1 ? '/api/v1/packages/checkout' : '/api/v1/checkout'
        const payload =
          selected.packageSize && selected.packageSize > 1
            ? {
                service_id: selected.id,
                starts_at: selected.offerType === 'recurring_plan' ? slot : null,
                occurrences: flexibleRecurring ? recurringSlots : null,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
              }
            : {
                service_id: selected.id,
                starts_at: slot,
                meeting_provider: coach.videoProvider || 'meet',
              }
        const result = await api<{ checkout_url: string | null }>(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        if (result.checkout_url) window.location.assign(result.checkout_url)
        else toast.success(selected.packageSize && selected.packageSize > 1 ? 'Bono creado. El pago queda pendiente.' : 'Reserva creada. El pago queda pendiente.')
      } else {
        const booking: LocalBooking = {
          id: crypto.randomUUID(),
          coachId: coach.id,
          coachName: coach.name,
          serviceName: selected.name,
          startsAt: slots.find((item) => item.starts_at === slot)?.label || slot,
          amount: selected.price,
          status: 'confirmed',
        }
        const stored = JSON.parse(localStorage.getItem('coachconnect-demo-bookings') || '[]') as LocalBooking[]
        localStorage.setItem('coachconnect-demo-bookings', JSON.stringify([booking, ...stored]))
        toast.success('Reserva de demostración confirmada.')
        navigate('/cuenta')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reservar')
    } finally {
      setBusy(false)
    }
  }
  const contact = () => {
    if (!user) return onAuth()
    if (ownProfile) return toast.error('Este es tu propio perfil profesional.')
    if (!isRemoteCoach(coach.id)) return toast.error('Este perfil es de demostración y no admite mensajes. Elige un entrenador publicado.')
    setChatOpen(true)
  }
  return (
    <section className={`profile-screen ${preview ? 'is-preview' : ''}`}>
      {preview && (
        <div className="preview-banner">
          <span>
            <Eye /> Así ven tu perfil los clientes
          </span>
          <small>La reserva y el contacto están desactivados en la previsualización.</small>
          <Link to="/profesional">Volver a editar</Link>
        </div>
      )}
      <Link className="back-link" to={preview ? '/profesional' : '/buscar'}>
        <ArrowLeft /> {preview ? 'Volver al panel' : 'Volver a resultados'}
      </Link>
      <div className="profile-hero">
        <CoachAvatar coach={coach} className="profile-avatar" eager />
        <div className="profile-title">
          <div className="profile-title-line">
            <h1>{coach.name}</h1>
            {coach.onlineNow && <span className="live-badge">Disponible ahora</span>}
          </div>
          <p>
            {coach.specialty} · {coach.city}
          </p>
          <div className="profile-rating">
            <Star fill="currentColor" />
            <strong>{coach.reviews >= 3 ? coach.rating : 'Nuevo'}</strong>
            <span>{coach.reviews} reseñas</span>
            {coach.verified && (
              <span className="verified-copy">
                <BadgeCheck /> Identidad y título verificados
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="profile-grid">
        <div className="profile-details">
          <section className="profile-block">
            <p className="eyebrow">Cómo entrena</p>
            <p className="profile-bio">{coach.bio}</p>
            <div className="tag-row large">
              {coach.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </section>
          <section className="profile-block">
            <div className="section-title">
              <p className="eyebrow">Servicios</p>
              {coach.services.length > 0 && <span>Elige una opción</span>}
            </div>
            <div className="service-list">
              {coach.services.map((item, index) => (
                <button className={`service-row ${service === index ? 'selected' : ''}`} onClick={() => setService(index)} key={item.name}>
                  <span className="service-radio">{service === index && <Check />}</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.detail} · {item.bookingMode === 'request' ? 'requiere aprobación' : 'reserva inmediata'}
                    </small>
                    {item.availableWeekdays && <small className="service-availability-summary">{formatServiceWeekdays(item.availableWeekdays)} · {formatServiceHours(item.availableStartTime, item.availableEndTime)} · agenda abierta {item.bookingWindowDays || 31} días</small>}
                  </span>
                  <b className="service-price">
                    {item.price} €
                    <small>
                      {item.offerType === 'single'
                        ? 'por sesión'
                        : `${(item.price / Math.max(1, item.packageSize || 1)).toFixed(2)} €/sesión · total`}
                    </small>
                  </b>
                </button>
              ))}
              {!coach.services.length && (
                <div className="profile-empty">
                  <CalendarDays />
                  <strong>Aún no hay servicios publicados</strong>
                  <span>Así se verá el estado vacío hasta que añadas el primero.</span>
                </div>
              )}
            </div>
          </section>
          {coach.presentationVideoUrl && (
            <section className="profile-block presentation-video">
              <div className="section-title">
                <div>
                  <p className="eyebrow">Conoce a tu entrenador</p>
                  <h2>Vídeo de presentación</h2>
                </div>
                <span>Revisado por CoachConnect</span>
              </div>
              <video controls preload="metadata" src={coach.presentationVideoUrl}>
                Tu navegador no puede reproducir este vídeo.
              </video>
            </section>
          )}
          <section className="profile-block review-highlight">
            <div>
              <p className="eyebrow">Reputación</p>
              <p>{coach.reviews >= 3 ? `${coach.rating} sobre 5 en ${coach.reviews} relaciones verificadas.` : coach.reviews > 0 ? `${coach.reviews} relaciones verificadas; mostraremos la media al llegar a 3.` : 'Este perfil todavía no tiene valoraciones.'}</p>
              <span>{coach.reviews > 0 ? 'Estrellas, fiabilidad y respuesta se calculan por separado.' : 'Las reseñas aparecerán después de sesiones reales.'}</span>
            </div>
            <Star fill="currentColor" />
          </section>
          {publicReviews.length > 0 && (
            <section className="profile-block public-reviews">
              <div className="section-title">
                <p className="eyebrow">Comentarios verificados</p>
                <span>{publicReviews.length} clientes</span>
              </div>
              {publicReviews.map((item) => (
                <article key={item.id}>
                  <div>
                    <strong>{item.profiles?.display_name || 'Cliente verificado'}</strong>
                    <span>
                      <Star fill="currentColor" /> {item.rating}/5
                    </span>
                  </div>
                  <p>{item.comment || 'Valoración sin comentario.'}</p>
                  {item.review_replies?.[0] && (
                    <blockquote>
                      <b>Respuesta del entrenador</b>
                      {item.review_replies[0].body}
                    </blockquote>
                  )}
                </article>
              ))}
            </section>
          )}
        </div>
        <aside className="booking-card">
          <div className="booking-card-top">
            <p className="eyebrow">{packageId ? 'Sesión incluida en tu bono' : flexibleRecurring ? 'Serie con fechas flexibles' : selectedService?.offerType === 'recurring_plan' ? 'Serie con patrón fijo' : selectedService?.offerType === 'flex_pack' ? 'Bono flexible' : 'Tu próxima sesión'}</p>
            <strong>{coach.services.length ? (packageId ? '0 €' : `${selectedService?.price} €`) : 'Sin servicios'}</strong>
            {selectedService && !packageId && (
              <span className="price-explanation">
                {selectedService.offerType === 'single'
                  ? 'Precio de esta sesión.'
                  : `Pago único por ${selectedService.packageSize} sesiones · ${pricePerSession?.toFixed(2)} € por sesión. No es una cuota semanal ni mensual.`}
              </span>
            )}
            <small>{selectedService ? `${selectedService.name} · cancelación disponible solo hasta 24 h antes` : 'Añade un servicio para que puedan reservarte'}</small>
            {selectedService && <small className="public-booking-policy"><Clock3 /> Reserva con {formatBookingNotice(coach.minBookingNoticeMinutes)} · fechas hasta {selectedService.bookingWindowDays || 31} días</small>}
          </div>
          {!preview && selectedService?.offerType === 'flex_pack' && !packageId && (
            <div className="purchase-explainer">
              <strong>¿Cuándo eliges los días?</strong>
              <p>Después de comprar. El bono aparecerá en “Mis reservas” y podrás reservar cada sesión, una a una, entre los huecos libres.</p>
            </div>
          )}
          {!preview && coach.services.length > 0 && (packageId || coach.services[service]?.offerType === 'recurring_plan' || !coach.services[service]?.packageSize || coach.services[service]!.packageSize! <= 1) && (
            <>
              <p className="calendar-heading">
                <CalendarDays /> {flexibleRecurring ? 'Elige todas las fechas del plan' : coach.services[service]?.offerType === 'recurring_plan' ? 'Horarios libres para toda la serie' : 'Horarios disponibles'}
              </p>
              <AvailabilityCalendar
                slots={slots}
                value={slot}
                values={flexibleRecurring ? recurringSlots : undefined}
                selectionLimit={flexibleRecurring ? selectedService?.packageSize : undefined}
                onChange={(startsAt) => {
                  if (!flexibleRecurring) return setSlot(startsAt)
                  setRecurringSlots((current) => current.includes(startsAt)
                    ? current.filter((item) => item !== startsAt)
                    : current.length < (selectedService?.packageSize || 0)
                      ? [...current, startsAt].sort()
                      : current)
                }}
                loading={slotsLoading}
              />
            </>
          )}
          {!preview && selectedService?.offerType === 'recurring_plan' && !flexibleRecurring && selectedSlot?.occurrences && (
            <div className="series-preview" aria-live="polite">
              <strong>Estas son las {selectedSlot.occurrences.length} sesiones incluidas</strong>
              <p>El primer horario fija toda la serie; todos estos huecos están libres ahora.</p>
              <ol>
                {selectedSlot.occurrences.map((occurrence) => (
                  <li key={occurrence}>
                    {new Date(occurrence).toLocaleString('es-ES', {
                      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Button className="full-button" onClick={reserve} disabled={preview || ownProfile || busy || !coach.verified || !coach.services.length || ((Boolean(packageId) || coach.services[service]?.offerType === 'recurring_plan' || !coach.services[service]?.packageSize || coach.services[service]!.packageSize! <= 1) && !slots.length) || (flexibleRecurring && recurringSlots.length !== selectedService?.packageSize)}>
            {busy && <LoaderCircle className="spin" />} {preview ? 'Vista previa' : ownProfile ? 'Este es tu propio servicio' : coach.verified ? (packageId ? 'Reservar con mi bono' : selectedService?.bookingMode === 'request' ? 'Solicitar y autorizar pago' : selectedService?.offerType === 'recurring_plan' ? `Reservar ${selectedService.packageSize} fechas y pagar` : selectedService?.offerType === 'flex_pack' ? `Comprar bono de ${selectedService.packageSize}` : 'Reservar y pagar') : 'Pendiente de verificación'}
          </Button>
          <button className="chat-cta" onClick={contact} disabled={preview || ownProfile}>
            <MessageCircle /> Preguntar antes de reservar
          </button>
          <p className="booking-note">
            <ShieldCheck /> {preview ? 'Completa los pasos de publicación para activar reservas y mensajes.' : coach.services[service]?.bookingMode === 'request' ? 'El cargo queda autorizado y solo se captura si el entrenador acepta en 12 horas.' : 'Pago protegido por Stripe. La dirección exacta nunca se muestra antes de confirmar.'}
          </p>
        </aside>
      </div>
      {chatOpen && <QuickChat coach={coach} onClose={() => setChatOpen(false)} />}
    </section>
  )
}

function QuickChat({ coach, onClose }: { coach: Coach; onClose: () => void }) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [sent, setSent] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim() || !user) return
    const message = body.trim()
    const optimisticId = `sending:${crypto.randomUUID()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      conversation_id: conversationId || '',
      sender_id: user.id,
      body: message,
      created_at: new Date().toISOString(),
      delivery_status: 'sending',
    }
    setSent((items) => [...items, optimistic])
    setBody('')
    setBusy(true)
    try {
      if (!isRemoteCoach(coach.id)) throw new Error('Este perfil no puede recibir mensajes reales.')
      let id = conversationId
      if (!id) {
        const conversation = await api<{ id: string }>('/api/v1/conversations', { method: 'POST', body: JSON.stringify({ coach_id: coach.id }) })
        id = conversation.id
        setConversationId(id)
      }
      const row = await api<ChatMessage>(`/api/v1/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: message }) })
      setSent((items) =>
        mergeMessage(
          items.filter((item) => item.id !== optimisticId),
          row,
        ),
      )
      toast.success('Mensaje guardado y enviado')
    } catch (error) {
      setSent((items) => items.filter((item) => item.id !== optimisticId))
      setBody(message)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="chat-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-title">
        <header>
          <CoachAvatar coach={coach} className="avatar" />
          <div>
            <p className="eyebrow">Conversación directa</p>
            <h2 id="chat-title">{coach.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar chat">
            <X />
          </button>
        </header>
        <div className="chat-messages">
          <div className="message incoming">Hola, cuéntame qué quieres conseguir y qué horarios tienes.</div>
          {sent.map((item) => (
            <div className={`message outgoing ${item.delivery_status === 'sending' ? 'sending' : ''}`} key={item.id}>
              {item.body}
              <small>
                {item.delivery_status === 'sending'
                  ? 'Enviando…'
                  : new Date(item.created_at).toLocaleTimeString('es-ES', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
              </small>
            </div>
          ))}
        </div>
        {conversationId && (
          <Link className="chat-open-link" to={`/mensajes?conversation=${conversationId}`} onClick={onClose}>
            Abrir conversación completa <ArrowRight />
          </Link>
        )}
        <form className="chat-composer" onSubmit={send}>
          <button type="button" aria-label="Adjuntar archivo" disabled>
            <Paperclip />
          </button>
          <input aria-label="Mensaje" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe tu mensaje…" disabled={busy} />
          <button type="submit" aria-label="Enviar" disabled={busy || !body.trim()}>
            {busy ? <LoaderCircle className="spin" /> : <Send />}
          </button>
        </form>
      </section>
    </div>
  )
}

function ScoreField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset className="score-field">
      <legend>{label}</legend>
      <div>
        {[1, 2, 3, 4, 5].map((score) => (
          <button type="button" className={score <= value ? 'active' : ''} aria-label={`${label}: ${score} de 5`} onClick={() => onChange(score)} key={score}>
            <Star fill={score <= value ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ReviewDialog({ booking, isCoach, onClose, onSaved }: { booking: BookingRecord; isCoach: boolean; onClose: () => void; onSaved: () => void }) {
  const [scores, setScores] = useState<Record<string, number>>({
    rating: 5,
    punctuality: 5,
    communication: 5,
    respect: 5,
    quality: 5,
    personalization: 5,
    safety: 5,
    commitment: 5,
  })
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const setScore = (key: string, value: number) => setScores((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    const payload = isCoach
      ? {
          rating: scores.rating,
          punctuality: scores.punctuality,
          communication: scores.communication,
          respect: scores.respect,
          commitment: scores.commitment,
          comment,
        }
      : {
          rating: scores.rating,
          punctuality: scores.punctuality,
          communication: scores.communication,
          respect: scores.respect,
          quality: scores.quality,
          personalization: scores.personalization,
          safety: scores.safety,
          comment,
        }
    try {
      await api(`/api/v1/bookings/${booking.id}/review`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast.success('Valoración guardada. Se revelará cuando responda la otra parte o venza el plazo.')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la valoración')
    } finally {
      setBusy(false)
    }
  }
  const fields = isCoach
    ? [
        ['rating', 'Valoración global'],
        ['punctuality', 'Puntualidad y asistencia'],
        ['communication', 'Comunicación'],
        ['respect', 'Respeto'],
        ['commitment', 'Compromiso'],
      ]
    : [
        ['rating', 'Valoración global'],
        ['punctuality', 'Puntualidad'],
        ['communication', 'Comunicación'],
        ['respect', 'Trato y respeto'],
        ['quality', 'Calidad'],
        ['personalization', 'Personalización'],
        ['safety', 'Seguridad profesional'],
      ]
  return (
    <div className="modal-backdrop">
      <form className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title" onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Valoración bilateral · doble ciego</p>
            <h2 id="review-title">¿Cómo fue la sesión?</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </header>
        <p>Nadie verá la valoración contraria hasta que ambas estén listas o termine el plazo de 14 días.</p>
        <div className="score-grid">
          {fields.map(([key, label]) => (
            <ScoreField key={key} label={label} value={scores[key]} onChange={(value) => setScore(key, value)} />
          ))}
        </div>
        <label className="feedback-comment">
          Comentario opcional
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1200} rows={4} placeholder={isCoach ? 'Describe solo conductas relacionadas con la sesión.' : 'Cuenta qué te ayudó y qué podría mejorar.'} />
        </label>
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle className="spin" />} Guardar valoración
        </Button>
      </form>
    </div>
  )
}

function OutcomeDialog({ booking, onClose, onSaved }: { booking: BookingRecord; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState('attended')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const options = [
    ['attended', 'Realizada según lo previsto'],
    ['attended_with_issues', 'Realizada con alguna incidencia'],
    ['client_no_show', 'El cliente no asistió'],
    ['coach_no_show', 'El entrenador no asistió'],
    ['mutually_rescheduled', 'Acordamos reprogramarla'],
    ['technical_failure', 'No pudo realizarse por un problema técnico'],
  ]
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api(`/api/v1/bookings/${booking.id}/outcome`, {
        method: 'POST',
        body: JSON.stringify({
          outcome,
          note,
          circumstances: outcome === 'attended_with_issues' ? ['other'] : [],
        }),
      })
      toast.success('Resultado registrado. La otra parte tiene 48 horas para responder.')
      onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el resultado')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="feedback-dialog outcome-dialog" role="dialog" aria-modal="true" aria-labelledby="outcome-title" onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Confirmación de asistencia</p>
            <h2 id="outcome-title">¿Qué ocurrió?</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">
            <X />
          </button>
        </header>
        <div className="outcome-options">
          {options.map(([value, label]) => (
            <label className={outcome === value ? 'active' : ''} key={value}>
              <input type="radio" name="outcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
              <span>{label}</span>
              <Check />
            </label>
          ))}
        </div>
        <label className="feedback-comment">
          Detalle opcional
          <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1200} rows={3} />
        </label>
        <Button type="submit" disabled={busy}>
          {busy && <LoaderCircle className="spin" />} Confirmar resultado
        </Button>
      </form>
    </div>
  )
}

function CancellationDialog({ booking, onClose, onConfirm }: { booking: BookingRecord; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('schedule_change')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const reasons = [
    ['schedule_change', 'Me ha surgido un cambio de agenda'],
    ['illness', 'Enfermedad o emergencia'],
    ['technical', 'Problema técnico o de desplazamiento'],
    ['other', 'Otro motivo'],
  ]
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const label = reasons.find(([value]) => value === reason)?.[1] || 'Otro motivo'
    setBusy(true)
    try {
      await onConfirm(`${label}${detail.trim() ? `: ${detail.trim()}` : ''}`)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <form className="feedback-dialog cancellation-dialog" role="dialog" aria-modal="true" aria-labelledby="cancellation-title" onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Cancelación de la sesión</p>
            <h2 id="cancellation-title">¿Seguro que quieres cancelar?</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X /></button>
        </header>
        <p>Vas a cancelar la sesión del {new Date(booking.starts_at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Esta acción avisa a la otra persona y solo está disponible hasta 24 horas antes.</p>
        <div className="outcome-options">
          {reasons.map(([value, label]) => (
            <label className={reason === value ? 'active' : ''} key={value}>
              <input type="radio" name="cancellation_reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>{label}</span>
              <Check />
            </label>
          ))}
        </div>
        <label className="feedback-comment">
          Añade contexto si hace falta
          <textarea value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={350} rows={3} placeholder="La otra persona verá este mensaje." />
        </label>
        <div className="dialog-actions">
          <button type="button" className="text-button visible-text-button" onClick={onClose}>Mantener sesión</button>
          <Button type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" />} Confirmar cancelación</Button>
        </div>
      </form>
    </div>
  )
}

export function BookingDetailsDialog({ booking, perspective, onClose }: { booking: BookingRecord; perspective: 'coach' | 'consumer'; onClose: () => void }) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const [locationOpen, setLocationOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const startsAt = new Date(booking.starts_at)
  const endsAt = new Date(booking.ends_at)
  const duration = booking.coach_services?.duration_minutes || Math.round((endsAt.getTime() - startsAt.getTime()) / 60000)
  const counterpart = perspective === 'coach'
    ? booking.profiles?.display_name || 'Cliente CoachConnect'
    : booking.coach_profiles?.profiles?.display_name || 'Entrenador CoachConnect'
  const status = ({ pending_payment: 'Pago pendiente', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', disputed: 'En revisión', refunded: 'Reembolsada' } as Record<string, string>)[booking.status] || booking.status
  const ownId = perspective === 'coach' ? booking.coach_id : booking.consumer_id
  const pendingReschedule = booking.booking_reschedule_requests?.find((request) => request.status === 'pending')
  const canChange = booking.status === 'confirmed' && startsAt.getTime() - Date.now() >= 86400000
  const decideReschedule = async (decision: 'accept' | 'reject') => {
    if (!pendingReschedule) return
    setBusy(true)
    try {
      await api(`/api/v1/bookings/reschedule-requests/${pendingReschedule.id}/decision`, { method: 'POST', body: JSON.stringify({ decision }) })
      toast.success(decision === 'accept' ? 'Nuevo horario confirmado. Ambos recibiréis los detalles actualizados.' : 'Cambio rechazado. Se mantiene el horario original.')
      onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo responder') }
    finally { setBusy(false) }
  }
  const proposeReschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = String(form.get('starts_at') || '')
    if (!value) return
    setBusy(true)
    try {
      await api(`/api/v1/bookings/${booking.id}/reschedule-requests`, { method: 'POST', body: JSON.stringify({ starts_at: new Date(value).toISOString(), reason: form.get('reason') }) })
      toast.success('Propuesta enviada. El horario solo cambiará si la otra persona la acepta.')
      onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo proponer el cambio') }
    finally { setBusy(false) }
  }
  const saveLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await api(`/api/v1/bookings/${booking.id}/location`, { method: 'PUT', body: JSON.stringify(Object.fromEntries(form)) })
      toast.success('Ubicación confirmada. El cliente recibirá la dirección y el calendario se actualizará.')
      onClose()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar la ubicación') }
    finally { setBusy(false) }
  }
  const calendarStamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const calendarUrl = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE', text: booking.coach_services?.name || 'Entrenamiento CoachConnect',
    dates: `${calendarStamp(startsAt)}/${calendarStamp(endsAt)}`,
    details: booking.video_url || `${window.location.origin}/cuenta`,
    location: booking.private_location ? `${booking.private_location.address_line}, ${booking.private_location.locality}` : booking.coach_services?.public_area_label || '',
  }).toString()}`
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="booking-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-detail-title">
      <header>
        <div><p className="eyebrow">{status}</p><h2 id="booking-detail-title">{booking.coach_services?.name || 'Sesión de entrenamiento'}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="booking-detail-lead">
        <CalendarDays />
        <div><strong>{startsAt.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong><span>{startsAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} — {endsAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span></div>
      </div>
      <dl className="booking-detail-grid">
        <div><dt><UserRound /> {perspective === 'coach' ? 'Cliente' : 'Entrenador'}</dt><dd>{counterpart}</dd></div>
        <div><dt><Clock3 /> Duración</dt><dd>{duration} minutos</dd></div>
        <div><dt><CreditCard /> Importe</dt><dd>{booking.amount_cents ? `${(booking.amount_cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 })} €` : 'Incluida en bono o plan'}</dd></div>
        <div><dt><Video /> Modalidad</dt><dd>{booking.coach_services?.mode || booking.meeting_provider || 'Según el servicio'}</dd></div>
      </dl>
      <div className="booking-training-detail">
        <p className="eyebrow">Detalles del entrenamiento</p>
        <p>{booking.notes || booking.coach_services?.description || 'No hay indicaciones adicionales para esta sesión.'}</p>
      </div>
      {booking.private_location && <div className="booking-training-detail booking-location-detail"><p className="eyebrow">Lugar confirmado</p><p><MapPin /> <strong>{booking.private_location.address_line}, {booking.private_location.locality}{booking.private_location.postal_code ? ` · ${booking.private_location.postal_code}` : ''}</strong></p>{booking.private_location.instructions && <small>{booking.private_location.instructions}</small>}</div>}
      {!booking.private_location && booking.coach_services?.mode !== 'online' && <div className="booking-training-detail booking-location-detail"><p className="eyebrow">Ubicación</p><p><MapPin /> {booking.coach_services?.public_area_label || 'La dirección exacta se acordará antes de la sesión.'}</p></div>}
      {pendingReschedule && <div className="reschedule-status"><CalendarDays /><span><strong>{pendingReschedule.proposed_by === ownId ? 'Esperando respuesta a tu propuesta' : 'Te han propuesto un nuevo horario'}</strong><small>{new Date(pendingReschedule.proposed_starts_at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}{pendingReschedule.reason ? ` · ${pendingReschedule.reason}` : ''}</small></span>{pendingReschedule.proposed_by !== ownId && <div><button type="button" className="text-button visible-text-button" disabled={busy} onClick={() => decideReschedule('reject')}>Rechazar</button><Button type="button" disabled={busy} onClick={() => decideReschedule('accept')}>Aceptar</Button></div>}</div>}
      {rescheduleOpen && !pendingReschedule && <form className="inline-booking-form" onSubmit={proposeReschedule}><label>Nueva fecha y hora<input name="starts_at" type="datetime-local" required min={new Date(Date.now() + 86400000).toISOString().slice(0, 16)} /></label><label>Motivo o contexto<input name="reason" maxLength={500} placeholder="Opcional" /></label><div><button type="button" className="text-button visible-text-button" onClick={() => setRescheduleOpen(false)}>Cerrar</button><Button type="submit" disabled={busy}>Enviar propuesta</Button></div></form>}
      {locationOpen && perspective === 'coach' && <form className="inline-booking-form" onSubmit={saveLocation}><label>Dirección exacta<input name="address_line" required maxLength={240} defaultValue={booking.private_location?.address_line || ''} /></label><label>Localidad<input name="locality" required maxLength={120} defaultValue={booking.private_location?.locality || ''} /></label><label>Código postal<input name="postal_code" maxLength={20} defaultValue={booking.private_location?.postal_code || ''} /></label><label className="wide">Indicaciones<textarea name="instructions" maxLength={1000} rows={2} defaultValue={booking.private_location?.instructions || ''} /></label><div><button type="button" className="text-button visible-text-button" onClick={() => setLocationOpen(false)}>Cerrar</button><Button type="submit" disabled={busy}>Confirmar lugar</Button></div></form>}
      <footer>
        <div>{booking.video_url ? <a className="button button-primary button-md" href={booking.video_url} target="_blank" rel="noreferrer"><Video /> Entrar a la videollamada</a> : <span><ShieldCheck /> {booking.coach_services?.mode === 'online' ? 'El enlace aparecerá aquí cuando esté preparado.' : 'Sesión presencial.'}</span>}</div>
        <div className="booking-detail-actions"><a className="login-button" href={calendarUrl} target="_blank" rel="noreferrer"><CalendarDays /> Añadir a Calendar</a>{canChange && !pendingReschedule && <button type="button" className="login-button" onClick={() => { setRescheduleOpen((value) => !value); setLocationOpen(false) }}><Clock3 /> Proponer cambio</button>}{perspective === 'coach' && canChange && booking.coach_services?.mode !== 'online' && <button type="button" className="login-button" onClick={() => { setLocationOpen((value) => !value); setRescheduleOpen(false) }}><MapPin /> {booking.private_location ? 'Editar lugar' : 'Confirmar lugar'}</button>}</div>
      </footer>
    </section>
  </div>
}

export function SessionCalendar({ bookings, perspective, onSelect }: { bookings: BookingRecord[]; perspective: 'coach' | 'consumer'; onSelect: (booking: BookingRecord) => void }) {
  const upcoming = bookings.filter((item) => new Date(item.ends_at).getTime() >= Date.now() && ['pending_payment', 'confirmed'].includes(item.status))
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(() => upcoming[0] ? startOfDay(new Date(upcoming[0].starts_at)) : startOfDay(new Date()))
  const visibleDays = calendarDaysFor(view, anchor)
  const move = (direction: number) => setAnchor((current) => view === 'month' ? addMonths(current, direction) : addDays(current, direction * 7))
  const title = view === 'month'
    ? anchor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
    : `${visibleDays[0].toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} — ${visibleDays[6].toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`
  return <section className={`week-calendar account-calendar calendar-${view}`} aria-label="Calendario de próximas clases">
    <header><div><p className="eyebrow">Próximas clases</p><h3>{title}</h3></div><div className="calendar-toolbar"><div className="calendar-view-tabs" role="group" aria-label="Visualización del calendario"><button type="button" className={view === 'week' ? 'active' : ''} aria-pressed={view === 'week'} onClick={() => setView('week')}>Semana</button><button type="button" className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Mes</button></div><div className="calendar-controls"><button type="button" aria-label="Periodo anterior" onClick={() => move(-1)}><ChevronLeft /></button><button type="button" onClick={() => setAnchor(startOfDay(new Date()))}>Hoy</button><button type="button" aria-label="Periodo siguiente" onClick={() => move(1)}><ChevronRight /></button></div></div></header>
    <div className="week-grid">{visibleDays.map((date) => {
      const dayBookings = upcoming.filter((item) => new Date(item.starts_at).toDateString() === date.toDateString())
      const counterpart = (item: BookingRecord) => perspective === 'coach' ? item.profiles?.display_name || 'Cliente' : item.coach_profiles?.profiles?.display_name || 'Entrenador'
      return <article className={`${date.toDateString() === new Date().toDateString() ? 'today' : ''} ${view === 'month' && date.getMonth() !== anchor.getMonth() ? 'outside-month' : ''}`} key={date.toISOString()}><div className="week-day-head"><span>{date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span><strong>{date.getDate()}</strong></div><div className="week-events">{dayBookings.map((item) => <button type="button" className={`calendar-event status-${item.status.replaceAll('_', '-')}`} key={item.id} onClick={() => onSelect(item)} aria-label={`Ver detalles de ${item.coach_services?.name || 'la sesión'} con ${counterpart(item)}`}><time>{new Date(item.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</time><strong>{item.coach_services?.name || 'Sesión'}</strong><span>{counterpart(item)}</span></button>)}{!dayBookings.length && <span className="calendar-empty">Sin clases</span>}</div></article>
    })}</div>
  </section>
}

function ProfileAvatar({ profile, className = '' }: { profile: Pick<Profile, 'display_name' | 'avatar_url'>; className?: string }) {
  return <span className={`account-avatar ${className}`}>{profile.avatar_url ? <img src={profile.avatar_url} alt={`Foto de ${profile.display_name}`} /> : profile.display_name.slice(0, 2).toUpperCase()}</span>
}

function ReadonlyAccountEmail({ email }: { email?: string | null }) {
  return <div className="profile-readonly-field"><span>Correo de la cuenta</span><strong>{email || 'Correo no disponible'}</strong><small>El correo de acceso no se puede editar desde aquí.</small></div>
}

export function AccountNavigation({ active }: { active: 'profile' | 'messages' | 'professional' }) {
  const links = [
    { key: 'profile', label: 'Mi perfil', to: '/cuenta' },
    { key: 'messages', label: 'Mensajes', to: '/mensajes' },
    { key: 'professional', label: 'Perfil profesional', to: '/profesional' },
  ] as const
  return <nav className={`account-tabs account-tabs-${active}`} aria-label="Secciones de tu cuenta">{links.map((link) => <Link key={link.key} className={active === link.key ? 'active' : undefined} aria-current={active === link.key ? 'page' : undefined} to={link.to}>{link.label}</Link>)}</nav>
}

export function AccountIdentity({ profile, userId, onSaved }: { profile: Profile; userId: string; onSaved: (profile: Profile) => void }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '')
  const [stagedAvatarPath, setStagedAvatarPath] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) {
      setAvatarUrl(profile.avatar_url || '')
      return
    }
    const frame = window.requestAnimationFrame(() => {
      const input = nameInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editing, profile.avatar_url])
  const startEditing = () => {
    setAvatarUrl(profile.avatar_url || '')
    setEditing(true)
  }
  const discardChanges = async () => {
    if (busy || avatarBusy) return
    const pathToRemove = stagedAvatarPath
    setStagedAvatarPath(null)
    setAvatarUrl(profile.avatar_url || '')
    setEditing(false)
    if (pathToRemove) {
      const { error } = await supabase.storage.from('avatars').remove([pathToRemove])
      if (error) toast.error('Los cambios se descartaron, pero no se pudo limpiar la foto provisional.')
    }
  }
  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast.error('Usa una imagen JPG, PNG, WebP o AVIF de hasta 5 MB.')
      input.value = ''
      return
    }
    setAvatarBusy(true)
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${extension}`
    const { error } = await supabase.storage.from('avatars').upload(path, file)
    if (error) toast.error(error.message)
    else {
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const previousStagedPath = stagedAvatarPath
      setAvatarUrl(data.publicUrl)
      setStagedAvatarPath(path)
      if (previousStagedPath) {
        const { error: cleanupError } = await supabase.storage.from('avatars').remove([previousStagedPath])
        if (cleanupError) toast.error('La foto nueva está lista, pero no se pudo limpiar la anterior.')
      }
      toast.success('Foto preparada. Guarda los cambios para publicarla.')
    }
    setAvatarBusy(false)
    input.value = ''
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const city = String(form.get('city') || '').trim()
    if (!city) return toast.error('Selecciona una ciudad de la lista de coincidencias.')
    setBusy(true)
    try {
      const updated = await api<Profile>('/api/v1/me', {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: form.get('display_name'), city, avatar_url: avatarUrl || null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || profile.timezone || 'Europe/Madrid',
        }),
      })
      onSaved(updated)
      setStagedAvatarPath(null)
      setEditing(false)
      toast.success('Perfil actualizado')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar el perfil') }
    finally { setBusy(false) }
  }
  return <section className="account-identity"><div className="account-identity-summary"><ProfileAvatar profile={{ ...profile, avatar_url: avatarUrl }} /><div><p className="eyebrow">Tu perfil</p><h2>{profile.display_name}</h2><span><MapPin /> {profile.city || 'Ubicación pendiente'}</span><span><Globe2 /> {profile.email || 'Correo no disponible'}</span></div><button type="button" className="login-button" disabled={busy || avatarBusy} onClick={editing ? () => void discardChanges() : startEditing}><Pencil /> {editing ? 'Descartar cambios' : 'Editar datos'}</button></div>{editing && <form className="pro-form account-identity-form" onSubmit={submit}><div className="form-grid"><div className="avatar-editor"><ProfileAvatar profile={{ ...profile, avatar_url: avatarUrl }} /><label className="login-button"><Camera /> {avatarBusy ? 'Subiendo…' : 'Cambiar foto'}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={uploadAvatar} disabled={avatarBusy} /></label><small>JPG, PNG, WebP o AVIF · máximo 5 MB</small></div><label>Nombre visible<input ref={nameInputRef} name="display_name" required minLength={2} defaultValue={profile.display_name} /></label><ReadonlyAccountEmail email={profile.email} /><CityAutocompleteField initialValue={profile.city || ''} /></div><div className="form-actions"><Button type="submit" disabled={busy || avatarBusy}>{busy && <LoaderCircle className="spin" />} Guardar cambios</Button><button type="button" className="text-button visible-text-button" disabled={busy || avatarBusy} onClick={() => void discardChanges()}>Descartar cambios</button></div></form>}</section>
}

export function Account({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [remote, setRemote] = useState<any[]>([])
  const [packages, setPackages] = useState<any[]>([])
  const [activeReview, setActiveReview] = useState<BookingRecord | null>(null)
  const [activeOutcome, setActiveOutcome] = useState<BookingRecord | null>(null)
  const [activeCancellation, setActiveCancellation] = useState<BookingRecord | null>(null)
  const [activeBookingDetails, setActiveBookingDetails] = useState<BookingRecord | null>(null)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const local = useMemo(() => JSON.parse(localStorage.getItem('coachconnect-demo-bookings') || '[]') as LocalBooking[], [])
  const refresh = async () => {
    if (!user) return
    const [nextProfile, nextRemote, nextPackages] = await Promise.all([
      api<Profile>('/api/v1/me').catch(() => null),
      api<any[]>('/api/v1/bookings?perspective=consumer').catch(() => []),
      api<any[]>('/api/v1/packages').catch(() => []),
    ])
    setProfile(nextProfile)
    setRemote(nextRemote)
    setPackages(nextPackages)
    setLoadedUserId(user.id)
  }
  useEffect(() => {
    if (!user) return
    let current = true
    Promise.all([
      api<Profile>('/api/v1/me').catch(() => null),
      api<any[]>('/api/v1/bookings?perspective=consumer').catch(() => []),
      api<any[]>('/api/v1/packages').catch(() => []),
    ]).then(([nextProfile, nextRemote, nextPackages]) => {
      if (!current) return
      setProfile(nextProfile)
      setRemote(nextRemote)
      setPackages(nextPackages)
      setLoadedUserId(user.id)
    })
    return () => { current = false }
  }, [user])
  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60000)
    return () => window.clearInterval(interval)
  }, [])
  if (loading || (user && loadedUserId !== user.id)) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tus reservas, en un sitio." />
  const cancelBooking = async (bookingId: string, reason: string) => {
    try {
      await api(`/api/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      setRemote((items) => items.map((item) => (item.id === bookingId ? { ...item, status: 'cancelled' } : item)))
      toast.success('Reserva cancelada. La otra persona ha sido avisada.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar')
      throw error
    }
  }
  const sortedRemote = [...remote].sort((left, right) => {
    const leftUpcoming = left.status !== 'cancelled' && new Date(left.ends_at).getTime() >= clock
    const rightUpcoming = right.status !== 'cancelled' && new Date(right.ends_at).getTime() >= clock
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1
    const difference = new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
    return leftUpcoming ? difference : -difference
  })
  return (
    <section className="account-screen">
      <div className="account-head">
        <div>
          <p className="eyebrow">Área personal</p>
          <h1>Hola, {profile?.display_name || user.email?.split('@')[0]}.</h1>
        </div>
        {profile?.role === 'coach' && (
          <Link className="login-button" to="/profesional">
            <LayoutDashboard /> Panel profesional
          </Link>
        )}
      </div>
      <AccountNavigation active="profile" />
      {profile && <AccountIdentity profile={profile} userId={user.id} onSaved={setProfile} />}
      {profile?.role === 'coach' && <div className="booking-perspective-note"><UserRound /><span><strong>Estas son tus reservas como cliente.</strong> Las sesiones que impartes están separadas en el <Link to="/profesional">panel profesional</Link>.</span></div>}
      {packages.some((item) => item.status === 'active' && item.offer_type !== 'recurring_plan' && (item.session_credits?.some((credit: any) => credit.status === 'available') || item.used_sessions < item.total_sessions)) && (
        <a className="package-reminder" href="#mis-bonos">
          <CreditCard />
          <span><strong>Tienes sesiones de bono sin fecha.</strong> Comprar el bono no reserva los días: elige cada clase desde “Mis bonos y planes”.</span>
          <ArrowRight />
        </a>
      )}
      {remote.length > 0 && <SessionCalendar bookings={remote} perspective="consumer" onSelect={setActiveBookingDetails} />}
      <section className="booking-list">
        <div className="section-title">
          <h2>Sesiones</h2>
          <span>{remote.length + local.length} en total</span>
        </div>
        {!remote.length && !local.length && (
          <Empty
            title="Todavía no has reservado."
            copy="Encuentra a tu entrenador y elige el primer hueco que te venga bien."
            action={
              <Link className="button button-primary button-md" to="/">
                Buscar entrenador
              </Link>
            }
          />
        )}
        {local.map((item) => (
          <article className="booking-row" key={item.id}>
            <div className="date-block">
              <strong>{item.startsAt.split(' · ')[0]}</strong>
              <span>{item.startsAt.split(' · ')[1]}</span>
            </div>
            <div>
              <p className="eyebrow">{item.status === 'confirmed' ? 'Confirmada · Demo' : item.status}</p>
              <h3>{item.coachName}</h3>
              <span>{item.serviceName}</span>
            </div>
            <strong>{item.amount} €</strong>
          </article>
        ))}
        {sortedRemote.map((item: BookingRecord & any, index) => {
          const ownReport = item.session_reports?.some((report: any) => report.author_id === user.id)
          const ownReview = item.reviews?.some((review: any) => review.author_id === user.id)
          const startsAt = new Date(item.starts_at).getTime()
          const endsAt = new Date(item.ends_at).getTime()
          const canCancel = ['pending_payment', 'confirmed'].includes(item.status) && startsAt - clock >= 86400000
          const inProgress = item.status === 'confirmed' && startsAt <= clock && endsAt > clock
          const attended = ['attended', 'attended_with_issues', 'assumed_attended'].includes(item.outcome_status || '')
          const statusLabel = item.status === 'cancelled'
            ? 'Cancelada'
            : inProgress
              ? 'En curso'
              : item.status === 'confirmed'
                ? 'Confirmada'
                : item.status === 'completed' && item.outcome_finalized_at
                  ? 'Resultado confirmado'
                  : item.status === 'completed' && ownReport
                    ? 'Tu resultado está enviado'
                    : item.status === 'completed'
                      ? 'Sesión terminada · confirma qué ocurrió'
                      : item.status.replaceAll('_', ' ')
          const section = item.status !== 'cancelled' && endsAt >= clock ? 'Próximas sesiones' : 'Historial'
          const previous = sortedRemote[index - 1]
          const previousSection = previous && previous.status !== 'cancelled' && new Date(previous.ends_at).getTime() >= clock ? 'Próximas sesiones' : 'Historial'
          const day = new Date(item.starts_at).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          const previousDay = previous ? new Date(previous.starts_at).toLocaleDateString('es-ES') : ''
          const currentDay = new Date(item.starts_at).toLocaleDateString('es-ES')
          return (
            <div className="booking-day-group" key={item.id}>
              {section !== previousSection && <h3 className="booking-section-heading">{section}</h3>}
              {(section !== previousSection || currentDay !== previousDay) && <p className="booking-day-heading">{day}</p>}
            <article className="booking-row">
              <div className="date-block">
                <strong>
                  {new Date(item.starts_at).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                  })}
                </strong>
                <span>
                  {new Date(item.starts_at).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div>
                <p className="eyebrow">{statusLabel}</p>
                <h3>{item.coach_profiles?.profiles?.display_name || 'Entrenador CoachConnect'}</h3>
                <span>
                  {item.coach_services?.name}
                  {item.outcome_finalized_at && item.outcome_status ? ` · ${item.outcome_status.replaceAll('_', ' ')}` : ''}
                </span>
                {inProgress && <small className="booking-guidance">Podrás confirmar qué ocurrió cuando termine a las {new Date(item.ends_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.</small>}
                {item.status === 'completed' && ownReport && !item.outcome_finalized_at && <small className="booking-guidance">Esperando la confirmación de la otra persona; si no responde, se cerrará automáticamente en 48 h.</small>}
              </div>
              <strong>{item.amount_cents / 100} €</strong>
              <div className="booking-actions">
                {item.video_url && (
                  <a className="login-button" href={item.video_url} target="_blank" rel="noreferrer">
                    <Video /> Entrar
                  </a>
                )}
                {canCancel && (
                  <button className="text-button visible-text-button" onClick={() => setActiveCancellation(item)}>
                    Cancelar
                  </button>
                )}
                {['pending_payment', 'confirmed'].includes(item.status) && !canCancel && (
                  <span className="locked-action">
                    <ShieldCheck /> Cancelación cerrada
                  </span>
                )}
                {item.status === 'completed' && !ownReport && !item.outcome_finalized_at && (
                  <button className="text-button visible-text-button" onClick={() => setActiveOutcome(item)}>
                    Confirmar resultado
                  </button>
                )}
                {item.status === 'completed' && !ownReview && (attended || item.session_reports?.some((report: any) => report.author_id === user.id && ['attended', 'attended_with_issues'].includes(report.outcome))) && (
                  <button className="text-button visible-text-button" onClick={() => setActiveReview(item)}>
                    Valorar
                  </button>
                )}
                {ownReview && (
                  <span className="locked-action">
                    <Check /> Valoración guardada
                  </span>
                )}
              </div>
            </article>
            </div>
          )
        })}
      </section>
      {packages.length > 0 && (
        <section className="package-list" id="mis-bonos">
          <div className="section-title">
            <h2>Mis bonos y planes</h2>
          </div>
          {packages.map((item) => {
            const available = item.session_credits?.filter((credit: any) => credit.status === 'available').length ?? Math.max(0, item.total_sessions - item.used_sessions)
            return (
              <article key={item.id}>
                <div>
                  <p className="eyebrow">
                    {item.offer_type === 'recurring_plan' ? 'Serie programada' : 'Bono flexible'} · {item.status}
                  </p>
                  <h3>{item.coach_services?.name}</h3>
                  <span>
                    {item.offer_type === 'recurring_plan'
                      ? `${item.total_sessions} sesiones con fechas ya programadas; consúltalas arriba. Pago único, sin renovación automática.`
                      : `${available} de ${item.total_sessions} sesiones por reservar; elige ahora una fecha para cada crédito.`}
                    {item.expires_at ? ` · válido hasta ${new Date(item.expires_at).toLocaleDateString('es-ES')}` : ''}
                  </span>
                </div>
                {item.status === 'active' && item.offer_type !== 'recurring_plan' && (
                  <Link className="login-button" to={`/entrenadores/${item.coach_id}?package=${item.id}&service=${item.service_id}`}>
                    Reservar una sesión · {available} quedan <ArrowRight />
                  </Link>
                )}
              </article>
            )
          })}
        </section>
      )}
      {activeReview && <ReviewDialog booking={activeReview} isCoach={false} onClose={() => setActiveReview(null)} onSaved={refresh} />}
      {activeOutcome && <OutcomeDialog booking={activeOutcome} onClose={() => setActiveOutcome(null)} onSaved={refresh} />}
      {activeCancellation && <CancellationDialog booking={activeCancellation} onClose={() => setActiveCancellation(null)} onConfirm={(reason) => cancelBooking(activeCancellation.id, reason)} />}
      {activeBookingDetails && <BookingDetailsDialog booking={activeBookingDetails} perspective="consumer" onClose={() => setActiveBookingDetails(null)} />}
    </section>
  )
}

function Messages({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [search, setSearch] = useSearchParams()
  const [conversations, setConversations] = useState<ConversationRecord[]>([])
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserRecord[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)
  const [reportContext, setReportContext] = useState<{ messageId?: string } | null>(null)
  useEffect(() => {
    if (!user) return
    Promise.all([api<ConversationRecord[]>('/api/v1/conversations'), api<BlockedUserRecord[]>('/api/v1/blocks')])
      .then(([rows, blocks]) => {
        setConversations(rows)
        setBlockedUsers(blocks)
        const requested = search.get('conversation')
        setActive(rows.find((item) => item.id === requested)?.id || rows[0]?.id || null)
        setLoadError('')
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las conversaciones'))
  }, [user])
  useEffect(() => {
    if (!active) return
    setMessages([])
    api<ChatMessage[]>(`/api/v1/conversations/${active}/messages`)
      .then((rows) => {
        setMessages(rows)
        setLoadError('')
        void api(`/api/v1/conversations/${active}/read`, { method: 'POST' }).catch(() => undefined)
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los mensajes'))
    const channel = supabase
      .channel(`conversation:${active}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${active}`,
        },
        (payload) => {
          const incoming = payload.new as ChatMessage
          setMessages((current) => mergeMessage(current, incoming))
          if (incoming.sender_id !== user?.id) void api(`/api/v1/conversations/${active}/read`, { method: 'POST' }).catch(() => undefined)
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [active])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Habla directamente con tu entrenador." />
  const chooseConversation = (id: string) => {
    setActive(id)
    setSearch({ conversation: id }, { replace: true })
  }
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!active || !body.trim() || busy) return
    const text = body.trim()
    const optimisticId = `sending:${crypto.randomUUID()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      conversation_id: active,
      sender_id: user.id,
      body: text,
      created_at: new Date().toISOString(),
      delivery_status: 'sending',
    }
    setMessages((items) => [...items, optimistic])
    setBody('')
    setBusy(true)
    try {
      const row = await api<ChatMessage>(`/api/v1/conversations/${active}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) })
      setMessages((items) =>
        mergeMessage(
          items.filter((item) => item.id !== optimisticId),
          row,
        ),
      )
    } catch (error) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId))
      setBody(text)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar')
    } finally {
      setBusy(false)
    }
  }
  const activeConversation = conversations.find((item) => item.id === active)
  const activeOther = activeConversation ? (activeConversation.consumer_id === user.id ? activeConversation.coach : activeConversation.consumer) : null
  const messagingUnavailable = Boolean(activeConversation?.blocked_by_me || activeConversation?.blocked_me)
  const attach = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !active || messagingUnavailable) return
    const path = `${active}/${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file)
    if (error) return toast.error(error.message)
    try {
      const row = await api<ChatMessage>(`/api/v1/conversations/${active}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: file.name, attachment_path: path }),
      })
      setMessages((items) => mergeMessage(items, row))
    } catch (apiError) {
      toast.error(apiError instanceof Error ? apiError.message : 'No se pudo adjuntar')
    }
  }
  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(path, 300)
    if (error) return toast.error(error.message)
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!active || !activeOther?.id || busy) return
    const form = new FormData(event.currentTarget)
    const reason = String(form.get('reason') || '')
    const details = String(form.get('details') || '')
    const blockAfter = form.get('block_after') === 'on'
    setBusy(true)
    try {
      await api('/api/v1/reports', {
        method: 'POST',
        body: JSON.stringify({
          conversation_id: active,
          message_id: reportContext?.messageId || null,
          reported_user_id: activeOther.id,
          reason,
          details,
        }),
      })
      if (blockAfter && !activeConversation?.blocked_by_me) {
        const block = await api<BlockedUserRecord>('/api/v1/blocks', {
          method: 'POST',
          body: JSON.stringify({ user_id: activeOther.id }),
        })
        setBlockedUsers((items) => [block, ...items.filter((item) => item.blocked_id !== block.blocked_id)])
        setConversations((items) => items.map((item) => (item.id === active ? { ...item, blocked_by_me: true } : item)))
      }
      setReportContext(null)
      toast.success('Denuncia enviada al equipo')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo denunciar')
    } finally {
      setBusy(false)
    }
  }
  const blockActiveUser = async () => {
    if (!activeOther?.id || !active || busy) return
    setBusy(true)
    try {
      const row = await api<BlockedUserRecord>('/api/v1/blocks', {
        method: 'POST',
        body: JSON.stringify({ user_id: activeOther.id }),
      })
      setBlockedUsers((items) => [row, ...items.filter((item) => item.blocked_id !== row.blocked_id)])
      setConversations((items) => items.map((item) => (item.id === active ? { ...item, blocked_by_me: true } : item)))
      toast.success('Usuario bloqueado. Ya no puede enviarte mensajes.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo bloquear')
    } finally {
      setBusy(false)
    }
  }
  const unblockUser = async (blockedUserId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/api/v1/blocks/${blockedUserId}`, { method: 'DELETE' })
      setBlockedUsers((items) => items.filter((item) => item.blocked_id !== blockedUserId))
      setConversations((items) =>
        items.map((item) => {
          const otherId = item.consumer_id === user.id ? item.coach_id : item.consumer_id
          return otherId === blockedUserId ? { ...item, blocked_by_me: false } : item
        }),
      )
      toast.success('Usuario desbloqueado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo desbloquear')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="messages-screen">
      <div className="messages-head">
        <div>
          <p className="eyebrow">Mensajería privada</p>
          <h1>Tus conversaciones.</h1>
        </div>
        <button className={`blocked-users-toggle ${showBlocked ? 'active' : ''}`} onClick={() => setShowBlocked((value) => !value)} aria-expanded={showBlocked}>
          <UserRoundX />
          <span>Usuarios bloqueados</span>
          <strong>{blockedUsers.length}</strong>
        </button>
      </div>
      <AccountNavigation active="messages" />
      {loadError && <p className="inbox-error" role="alert">{loadError}</p>}
      {showBlocked && (
        <section className="blocked-users-panel" aria-label="Usuarios bloqueados">
          <header>
            <div><p className="eyebrow">Tu privacidad</p><h2>Usuarios bloqueados</h2></div>
            <button className="icon-button" onClick={() => setShowBlocked(false)} aria-label="Cerrar usuarios bloqueados"><X /></button>
          </header>
          <div>
            {blockedUsers.map((item) => (
              <article key={item.blocked_id}>
                <span className="avatar">{(item.profile?.display_name || 'CC').slice(0, 2).toUpperCase()}</span>
                <div><strong>{item.profile?.display_name || 'Usuario de CoachConnect'}</strong><small>Bloqueado el {new Date(item.created_at).toLocaleDateString('es-ES')}</small></div>
                <button onClick={() => unblockUser(item.blocked_id)} disabled={busy}><Unlock /> Desbloquear</button>
              </article>
            ))}
            {!blockedUsers.length && <Empty title="No has bloqueado a nadie." copy="Cuando bloquees a una persona desde un chat, podrás administrarla aquí." />}
          </div>
        </section>
      )}
      <div className="inbox">
        <aside>
          <div className="inbox-list-label"><span>Conversaciones</span><strong>{conversations.length}</strong></div>
          {conversations.map((item) => {
            const other = item.consumer_id === user.id ? item.coach : item.consumer
            return (
              <button className={active === item.id ? 'active' : ''} key={item.id} onClick={() => chooseConversation(item.id)}>
                <span className="avatar">{(other?.display_name || 'CC').slice(0, 2).toUpperCase()}</span>
                <span><strong>{other?.display_name || 'CoachConnect'}</strong><small>{item.blocked_by_me ? 'Bloqueado por ti' : item.blocked_me ? 'Mensajería no disponible' : 'Conversación segura'}</small></span>
                {(item.blocked_by_me || item.blocked_me) && <Ban className="conversation-blocked-icon" />}
              </button>
            )
          })}
          {!conversations.length && <p>Aún no tienes conversaciones.</p>}
        </aside>
        <div className="conversation">
          {active ? (
            <>
              <div className="conversation-actions">
                <div><span className="avatar">{(activeOther?.display_name || 'CC').slice(0, 2).toUpperCase()}</span><span><strong>{activeOther?.display_name || 'CoachConnect'}</strong><small>{activeOther?.role === 'coach' ? 'Entrenador' : 'Cliente'} · chat privado</small></span></div>
                <div>
                  <button className="chat-action report" onClick={() => setReportContext({})}><Flag /> Denunciar</button>
                  {activeConversation?.blocked_by_me ? (
                    <button className="chat-action" onClick={() => activeOther?.id && unblockUser(activeOther.id)} disabled={busy}><Unlock /> Desbloquear</button>
                  ) : (
                    <button className="chat-action danger" onClick={blockActiveUser} disabled={busy}><Ban /> Bloquear</button>
                  )}
                </div>
              </div>
              {messagingUnavailable && (
                <div className="chat-restriction-banner"><MessageSquareOff /><div><strong>Mensajería detenida</strong><span>{activeConversation?.blocked_by_me ? 'Has bloqueado a esta persona. Desbloquéala para volver a conversar.' : 'No es posible intercambiar mensajes con esta persona.'}</span></div></div>
              )}
              <div className="chat-messages">
                {messages.map((item) => (
                  <div className={`message ${item.sender_id === user.id ? 'outgoing' : 'incoming'} ${item.delivery_status === 'sending' ? 'sending' : ''}`} key={item.id}>
                    {item.body}
                    {item.attachment_path && <button className="attachment-link" onClick={() => openAttachment(item.attachment_path || '')}><Paperclip /> Abrir archivo</button>}
                    <small>{item.delivery_status === 'sending' ? 'Enviando…' : new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</small>
                    {item.sender_id !== user.id && <button className="message-report-button" onClick={() => setReportContext({ messageId: item.id })} aria-label="Denunciar este mensaje"><Flag /></button>}
                  </div>
                ))}
              </div>
              <form className={`chat-composer ${messagingUnavailable ? 'disabled' : ''}`} onSubmit={send}>
                <label className="attachment-button" aria-label="Adjuntar archivo"><Paperclip /><input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={attach} disabled={messagingUnavailable || busy} /></label>
                <input aria-label="Mensaje" value={body} onChange={(event) => setBody(event.target.value)} placeholder={messagingUnavailable ? 'Desbloquea al usuario para escribir' : 'Escribe un mensaje…'} disabled={busy || messagingUnavailable} />
                <button type="submit" aria-label="Enviar" disabled={busy || messagingUnavailable || !body.trim()}>{busy ? <LoaderCircle className="spin" /> : <Send />}</button>
              </form>
            </>
          ) : <Empty title="Elige una conversación." copy="Tus mensajes aparecerán aquí." />}
        </div>
      </div>
      {reportContext && (
        <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setReportContext(null)}>
          <form className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submitReport}>
            <header><span><ShieldAlert /></span><button type="button" className="icon-button" onClick={() => setReportContext(null)} aria-label="Cerrar denuncia"><X /></button></header>
            <p className="eyebrow">Seguridad CoachConnect</p>
            <h2 id="report-title">Denunciar a {activeOther?.display_name || 'este usuario'}</h2>
            <p>El equipo de operaciones revisará el contexto de la conversación. La otra persona no sabrá quién realizó la denuncia.</p>
            {reportContext.messageId && <div className="reported-message-note"><Flag /> Se adjuntará el mensaje seleccionado como evidencia.</div>}
            <label>Motivo<select name="reason" required defaultValue=""><option value="" disabled>Selecciona un motivo</option><option>Acoso o comportamiento abusivo</option><option>Contenido inapropiado</option><option>Fraude o intento de estafa</option><option>Riesgo para la seguridad</option><option>Suplantación de identidad</option><option>Otro motivo</option></select></label>
            <label>Cuéntanos qué ha ocurrido<textarea name="details" maxLength={1200} rows={4} placeholder="Añade detalles que ayuden al equipo a revisar el caso…" /></label>
            {!activeConversation?.blocked_by_me && <label className="report-block-option"><input type="checkbox" name="block_after" /><span><strong>Bloquear también a esta persona</strong><small>No podréis enviaros más mensajes hasta que la desbloquees.</small></span></label>}
            <footer><button type="button" className="text-button" onClick={() => setReportContext(null)}>Cancelar</button><Button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar denuncia'}</Button></footer>
          </form>
        </div>
      )}
    </section>
  )
}

type NotificationPreference = {
  category: 'chat' | 'reminders' | 'reviews' | 'summaries'
  email_enabled: boolean
  in_app_enabled: boolean
}

type ConnectedIntegration = {
  provider: 'google' | 'zoom'
  calendar_enabled?: boolean
  calendar_id?: string
}

function CommunicationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreference[]>([])
  const [connections, setConnections] = useState<ConnectedIntegration[]>([])
  const [busyKey, setBusyKey] = useState('')
  useEffect(() => {
    Promise.all([
      api<NotificationPreference[]>('/api/v1/notification-preferences'),
      api<{ providers: ConnectedIntegration[] }>('/api/v1/integrations'),
    ]).then(([nextPreferences, integrations]) => {
      setPreferences(nextPreferences)
      setConnections(integrations.providers)
    }).catch(() => undefined)
  }, [])
  const updatePreference = async (preference: NotificationPreference, channel: 'email_enabled' | 'in_app_enabled') => {
    const next = { ...preference, [channel]: !preference[channel] }
    setBusyKey(`${preference.category}:${channel}`)
    try {
      const saved = await api<NotificationPreference>('/api/v1/notification-preferences', { method: 'PATCH', body: JSON.stringify(next) })
      setPreferences((items) => items.map((item) => item.category === saved.category ? saved : item))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la preferencia')
    } finally { setBusyKey('') }
  }
  const connectGoogle = async () => {
    setBusyKey('google')
    try {
      const result = await api<{ url: string }>('/api/v1/integrations/google/oauth-url')
      window.location.assign(result.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo conectar Google')
      setBusyKey('')
    }
  }
  const google = connections.find((connection) => connection.provider === 'google')
  const toggleCalendar = async () => {
    if (!google) return void connectGoogle()
    setBusyKey('calendar')
    try {
      const saved = await api<ConnectedIntegration>('/api/v1/integrations/google/calendar', {
        method: 'PATCH', body: JSON.stringify({ enabled: !google.calendar_enabled, calendar_id: google.calendar_id || 'primary' }),
      })
      setConnections((items) => items.map((item) => item.provider === 'google' ? saved : item))
      toast.success(saved.calendar_enabled ? 'Las reservas se añadirán a Google Calendar' : 'Sincronización de calendario desactivada')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar Calendar') }
    finally { setBusyKey('') }
  }
  const labels: Record<NotificationPreference['category'], [string, string]> = {
    chat: ['Mensajes sin leer', 'Un resumen por correo tras 15 minutos; se cancela si ya has leído la conversación.'],
    reminders: ['Recordatorios de sesiones', 'Avisos 24 horas y 1 hora antes del entrenamiento.'],
    reviews: ['Valoraciones', 'Recordatorios para dejar una valoración después del entrenamiento.'],
    summaries: ['Resúmenes de actividad', 'Novedades agrupadas que no requieren una acción inmediata.'],
  }
  return <section className="communication-settings">
    <div><p className="eyebrow">Preferencias</p><h2>Decide qué avisos recibes.</h2><p>Pagos, cambios de reserva, seguridad y moderación son esenciales y se envían siempre. El resto lo controlas aquí.</p></div>
    <div className="preference-table">
      <div className="preference-head"><span>Tipo de aviso</span><span>Correo</span><span>En la app</span></div>
      {preferences.map((preference) => <div className="preference-row" key={preference.category}>
        <span><strong>{labels[preference.category][0]}</strong><small>{labels[preference.category][1]}</small></span>
        <button type="button" className={preference.email_enabled ? 'switch active' : 'switch'} aria-pressed={preference.email_enabled} aria-label={`Correo para ${labels[preference.category][0]}`} disabled={Boolean(busyKey)} onClick={() => updatePreference(preference, 'email_enabled')}><span /></button>
        <button type="button" className={preference.in_app_enabled ? 'switch active' : 'switch'} aria-pressed={preference.in_app_enabled} aria-label={`Notificación en la app para ${labels[preference.category][0]}`} disabled={Boolean(busyKey)} onClick={() => updatePreference(preference, 'in_app_enabled')}><span /></button>
      </div>)}
    </div>
    <div className="calendar-connection"><CalendarDays /><span><strong>Google Calendar</strong><small>{google ? google.calendar_enabled ? 'Activo: las reservas confirmadas y sus cambios se sincronizan automáticamente.' : 'Google está conectado, pero la sincronización está pausada.' : 'Conecta Google para añadir y actualizar automáticamente tus entrenamientos.'}</small></span><Button type="button" onClick={toggleCalendar} disabled={Boolean(busyKey)}>{busyKey === 'calendar' || busyKey === 'google' ? <LoaderCircle className="spin" /> : google?.calendar_enabled ? <Check /> : <Plus />}{google?.calendar_enabled ? 'Activo' : google ? 'Activar' : 'Conectar'}</Button></div>
  </section>
}

function Notifications({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [items, setItems] = useState<any[]>([])
  useEffect(() => {
    if (!user) return
    api<any[]>('/api/v1/notifications')
      .then(setItems)
      .catch(() => undefined)
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => setItems((current) => [payload.new, ...current]),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tus avisos importantes, sin ruido." />
  const open = async (item: any) => {
    if (!item.read_at) {
      await api(`/api/v1/notifications/${item.id}/read`, { method: 'PATCH' })
      setItems((current) => current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, read_at: new Date().toISOString() } : currentItem)))
    }
    if (item.action_url) window.location.assign(item.action_url)
  }
  return (
    <section className="account-screen">
      <div className="account-head">
        <div>
          <p className="eyebrow">Actividad</p>
          <h1>Notificaciones.</h1>
        </div>
      </div>
      <CommunicationSettings />
      <div className="notification-list">
        {items.map((item) => (
          <button key={item.id} className={item.read_at ? 'read' : 'unread'} onClick={() => open(item)}>
            <Bell />
            <span>
              <strong>{item.title}</strong>
              <small>{item.body}</small>
            </span>
            <time>{new Date(item.created_at).toLocaleString('es-ES')}</time>
          </button>
        ))}
        {!items.length && <Empty title="Todo al día." copy="Aquí aparecerán mensajes, reservas y cambios importantes." />}
      </div>
    </section>
  )
}

export function ProPortal({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [overviewData, setOverviewData] = useState<ProfessionalOverviewData | null>(null)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [portalSearch, setPortalSearch] = useSearchParams()
  const tab = portalSearch.get('tab') || 'overview'
  const setTab = (nextTab: string) => {
    const next = new URLSearchParams(portalSearch)
    next.set('tab', nextTab)
    setPortalSearch(next)
  }
  useEffect(() => {
    if (!user) return
    let current = true
    Promise.all([
      api<Profile>('/api/v1/me').catch(() => null),
      api<CoachProfileRecord & { availability_rules?: any[]; stripe_account_id?: string | null }>('/api/v1/coach/profile').catch(() => null),
      api<CoachServiceRecord[]>('/api/v1/coach/services').catch(() => []),
      api<BookingRecord[]>('/api/v1/bookings?perspective=coach').catch(() => []),
    ]).then(([nextProfile, coachProfile, services, bookings]) => {
      if (!current) return
      setProfile(nextProfile)
      setOverviewData({ coachProfile, services, bookings })
      setLoadedUserId(user.id)
    })
    return () => { current = false }
  }, [user])
  if (loading || (user && loadedUserId !== user.id)) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tu trabajo. Sin perseguir al algoritmo." coach />
  return <section className="pro-screen"><div className="pro-header"><div className="pro-header-profile">{profile && <ProfileAvatar profile={profile} />}<div><p className="eyebrow">CoachConnect para profesionales</p><h1>Tu trabajo.<br /><em>Bien visible.</em></h1></div></div><div className="pro-header-actions">{profile?.role === 'coach' && <Link className="preview-link" to={`/entrenadores/${user.id}?preview=1`}><Eye /> Ver como cliente</Link>}<Link className="back-link" to="/"><ArrowLeft /> Volver a la web</Link></div></div><AccountNavigation active="professional" /><div className="pro-shell"><aside className="pro-sidebar"><div className="pro-user">{profile && <ProfileAvatar profile={profile} className="pro-user-avatar" />}<div><strong>{profile?.display_name || user.email}</strong><span>{profile?.role === 'coach' ? 'Perfil profesional' : 'Completa tu alta'}</span></div></div>{[['overview', 'Resumen'], ['requests', 'Solicitudes'], ['reviews', 'Valoraciones'], ['profile', 'Perfil'], ['services', 'Servicios'], ['availability', 'Agenda'], ['validation', 'Validación'], ['integrations', 'Pagos y vídeo']].map(([key, label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}<div className="pro-sidebar-foot"><ShieldCheck /> Datos protegidos</div></aside><div className="pro-content">{tab === 'overview' && overviewData && <ProOverview profile={profile} userId={user.id} onTab={setTab} data={overviewData} />}{tab === 'requests' && <BookingRequestsPanel />}{tab === 'reviews' && <CoachReviewsPanel />}{tab === 'profile' && <CoachOnboarding accountProfile={profile} current={overviewData?.coachProfile || null} onSaved={(saved) => { setOverviewData((data) => data ? { ...data, coachProfile: { ...data.coachProfile, ...saved } as ProfessionalOverviewData['coachProfile'] } : data); void api<Profile>('/api/v1/me').then(setProfile) }} />}{tab === 'services' && <ServicesForm />}{tab === 'availability' && <AvailabilityForm />}{tab === 'validation' && <CredentialForm userId={user.id} />}{tab === 'integrations' && <Integrations />}</div></div></section>
}

function ProOverview({ profile, userId, onTab, data }: { profile: Profile | null; userId: string; onTab: (tab: string) => void; data: ProfessionalOverviewData }) {
  const { coachProfile, services, bookings } = data
  const now = Date.now()
  const upcoming = bookings.filter((item) => new Date(item.starts_at).getTime() >= now && ['pending_payment', 'confirmed'].includes(item.status))
  const netRevenue = bookings.filter((item) => ['confirmed', 'completed'].includes(item.status)).reduce((sum, item) => sum + item.amount_cents * 0.85, 0) / 100
  const checks = [
    {
      label: 'Completa tu perfil y especialidad',
      tab: 'profile',
      done: Boolean(coachProfile?.headline && coachProfile?.bio && coachProfile?.city),
    },
    {
      label: 'Añade un servicio con precio',
      tab: 'services',
      done: services.length > 0,
    },
    {
      label: 'Configura tu disponibilidad',
      tab: 'availability',
      done: Boolean(coachProfile?.availability_rules?.length),
    },
    {
      label: 'Sube tu título para revisión',
      tab: 'validation',
      done: Boolean(coachProfile && coachProfile.verification_status !== 'draft' && coachProfile.verification_status !== 'rejected'),
    },
    {
      label: 'Conecta Stripe y videollamada',
      tab: 'integrations',
      done: Boolean(coachProfile?.stripe_account_id),
    },
  ]
  const progress = Math.round((checks.filter((item) => item.done).length / checks.length) * 100)
  const publication = (
    {
      draft: 'Borrador privado',
      credentials_submitted: 'Documentación recibida',
      under_review: 'En revisión',
      verified: 'Perfil publicado',
      rejected: 'Requiere cambios',
      suspended: 'Perfil suspendido',
    } as Record<string, string>
  )[coachProfile?.verification_status || 'draft']
  return (
    <>
      <div className="pro-content-head">
        <div>
          <p className="eyebrow">Vista general</p>
          <h2>{profile?.role === 'coach' ? 'Tu negocio, de un vistazo.' : 'Empieza por tu perfil.'}</h2>
        </div>
        <span className={`status-pill status-${coachProfile?.verification_status || 'draft'}`}>
          <span className="live-dot" /> {publication}
        </span>
      </div>
      <div className="publication-note">
        <div>
          <strong>{coachProfile?.verification_status === 'verified' ? 'Tu perfil ya aparece en las búsquedas.' : 'Tu perfil aún no aparece públicamente.'}</strong>
          <span>{coachProfile?.verification_status === 'verified' ? 'Los clientes pueden verlo, escribirte y reservar.' : 'Puedes previsualizarlo ahora; se publicará al completar la validación.'}</span>
        </div>
        {coachProfile && (
          <Link to={`/entrenadores/${userId}?preview=1`}>
            <Eye /> Previsualizar
          </Link>
        )}
      </div>
      <div className="metric-grid">
        <div>
          <span>Estado del perfil</span>
          <strong>{progress}%</strong>
          <small>{checks.filter((item) => !item.done).length} pasos pendientes</small>
        </div>
        <div>
          <span>Próximas sesiones</span>
          <strong>{upcoming.length}</strong>
          <small>{upcoming.length ? 'Reservadas en tu agenda' : 'Sin reservas próximas'}</small>
        </div>
        <div>
          <span>Ingresos netos</span>
          <strong>
            {netRevenue.toLocaleString('es-ES', {
              style: 'currency',
              currency: 'EUR',
            })}
          </strong>
          <small>Después de comisión</small>
        </div>
      </div>
      <div className="pro-panels">
        <div className="pro-panel schedule-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Lista de publicación</p>
              <h3>Haz que tu perfil trabaje por ti</h3>
            </div>
          </div>
          {checks.map((item, index) => (
            <button type="button" className={`schedule-row ${item.done ? 'done' : ''}`} key={item.label} onClick={() => onTab(item.tab)}>
              <span className="schedule-day">0{index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.done ? 'Completado' : 'Abrir y completar'}</small>
              </div>
              {item.done ? <Check /> : <ArrowRight />}
            </button>
          ))}
        </div>
        <div className="pro-panel profile-progress">
          <div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as CSSProperties}>
            <strong>{progress}%</strong>
            <span>perfil</span>
          </div>
          <div>
            <p className="eyebrow">Tu escaparate</p>
            <h3>{progress === 100 ? 'Listo para recibir clientes.' : 'Completa lo que falta.'}</h3>
            <p>El progreso se calcula con tus datos reales, servicios, agenda, validación y pagos.</p>
          </div>
        </div>
      </div>
    </>
  )
}

function BookingRequestsPanel() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const load = () =>
    api<any[]>('/api/v1/coach/booking-requests')
      .then(setItems)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las solicitudes'))
      .finally(() => setLoading(false))
  useEffect(() => {
    load()
  }, [])
  const decide = async (id: string, decision: 'accept' | 'reject') => {
    try {
      await api(`/api/v1/coach/booking-requests/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reason_code: decision === 'reject' ? 'not_available' : null,
        }),
      })
      toast.success(decision === 'accept' ? 'Solicitud aceptada y pago capturado' : 'Solicitud rechazada y autorización liberada')
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo responder')
    }
  }
  if (loading) return <LoadingBlock label="Cargando solicitudes" />
  return (
    <section className="request-panel">
      <p className="eyebrow">Reservas que requieren aprobación</p>
      <h2 className="form-title">Tú decides con quién comprometes tu agenda.</h2>
      <p className="form-intro">Solo se muestran datos de conducta dentro de CoachConnect. La autorización se libera automáticamente si no respondes en 12 horas.</p>
      <div className="request-list">
        {items.map((item) => {
          const service = item.bookings?.coach_services || item.booking_packages?.coach_services
          const summary = item.client_reputation
          return (
            <article key={item.id}>
              <header>
                <div>
                  <p className="eyebrow">{item.status.replaceAll('_', ' ')}</p>
                  <h3>{item.client?.display_name || 'Cliente CoachConnect'}</h3>
                </div>
                <time>{item.status === 'awaiting_coach' ? `Hasta ${new Date(item.expires_at).toLocaleString('es-ES')}` : new Date(item.created_at).toLocaleDateString('es-ES')}</time>
              </header>
              <div className="reputation-strip">
                <span>
                  <Star fill="currentColor" /> {summary?.unique_reviewers >= 3 ? `${summary.star_rating}/5` : 'Nuevo'}
                </span>
                <span>
                  <ShieldCheck /> {summary?.reliability_percent != null ? `${summary.reliability_percent}% asistencia` : 'Sin historial suficiente'}
                </span>
                <span>{summary?.completed_sessions || 0} sesiones completadas</span>
              </div>
              <p>
                {service?.name || 'Oferta de entrenamiento'}
                {item.booking_packages?.total_sessions ? ` · ${item.booking_packages.total_sessions} sesiones` : ''}
                {item.bookings?.starts_at ? ` · ${new Date(item.bookings.starts_at).toLocaleString('es-ES')}` : ''}
              </p>
              {item.status === 'awaiting_coach' && (
                <div className="request-actions">
                  <Button onClick={() => decide(item.id, 'accept')}>Aceptar y capturar</Button>
                  <button className="danger-action" onClick={() => decide(item.id, 'reject')}>
                    Rechazar
                  </button>
                </div>
              )}
            </article>
          )
        })}
        {!items.length && <Empty title="Sin solicitudes pendientes." copy="Cuando una oferta requiera aprobación, aparecerá aquí con su plazo y la reputación conductual del cliente." />}
      </div>
    </section>
  )
}

function CoachReviewsPanel() {
  const [data, setData] = useState<{ summary: any; items: any[] }>({
    summary: null,
    items: [],
  })
  const [loading, setLoading] = useState(true)
  const load = () =>
    api<{ summary: any; items: any[] }>('/api/v1/coach/reviews')
      .then(setData)
      .catch((error) => toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las valoraciones'))
      .finally(() => setLoading(false))
  useEffect(() => {
    load()
  }, [])
  const reply = async (review: any) => {
    const body = window.prompt('Escribe una respuesta pública, respetuosa y definitiva')
    if (!body) return
    try {
      await api(`/api/v1/reviews/${review.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      toast.success('Respuesta publicada')
      load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo responder')
    }
  }
  if (loading) return <LoadingBlock label="Calculando tu reputación" />
  const summary = data.summary
  const dimensions = ['punctuality', 'communication', 'respect', 'quality', 'personalization', 'safety']
  return (
    <section className="coach-reviews-panel">
      <p className="eyebrow">Reputación verificada</p>
      <h2 className="form-title">Lo que dicen tus clientes.</h2>
      <div className="reputation-dashboard">
        <div>
          <span>Estrellas</span>
          <strong>{summary?.unique_reviewers >= 3 ? Number(summary.star_rating).toFixed(2) : 'Nuevo'}</strong>
          <small>{summary?.unique_reviewers || 0} relaciones únicas</small>
        </div>
        <div>
          <span>Fiabilidad</span>
          <strong>{summary?.reliability_percent != null ? `${summary.reliability_percent}%` : '—'}</strong>
          <small>Separada de las estrellas</small>
        </div>
        <div>
          <span>Respuesta mediana</span>
          <strong>{summary?.median_response_minutes ? `${summary.median_response_minutes} min` : '—'}</strong>
          <small>Últimos 90 días</small>
        </div>
      </div>
      <div className="review-manager">
        {data.items.map((item) => (
          <article key={item.id}>
            <header>
              <div>
                <strong>{item.profiles?.display_name || 'Cliente verificado'}</strong>
                <span>
                  <Star fill="currentColor" /> {item.rating}/5 · {new Date(item.revealed_at).toLocaleDateString('es-ES')}
                </span>
              </div>
              <small>Doble ciego completado</small>
            </header>
            <div className="dimension-pills">
              {dimensions
                .filter((key) => item[key])
                .map((key) => (
                  <span key={key}>
                    {key}: {item[key]}
                  </span>
                ))}
            </div>
            <p>{item.comment || 'Sin comentario.'}</p>
            {item.review_replies?.[0] ? (
              <blockquote>
                <b>Tu respuesta</b>
                {item.review_replies[0].body}
              </blockquote>
            ) : (
              <button className="text-button visible-text-button" onClick={() => reply(item)}>
                Responder públicamente
              </button>
            )}
          </article>
        ))}
        {!data.items.length && <Empty title="Todavía no hay valoraciones reveladas." copy="Las nuevas valoraciones permanecen ocultas hasta que ambas partes respondan o se cumplan 14 días." />}
      </div>
    </section>
  )
}

function CoachOnboarding({ accountProfile, current, onSaved }: { accountProfile: Profile | null; current: ProfessionalOverviewData['coachProfile']; onSaved: (profile: CoachProfileRecord) => void }) {
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form); if (!String(values.city || '').trim()) return toast.error('Selecciona una ciudad de la lista de coincidencias.'); setBusy(true); const payload = { ...values, years_experience: Number(values.years_experience), languages: String(values.languages_text || 'es').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) }; delete (payload as Record<string, unknown>).languages_text; try { const saved = await api<CoachProfileRecord>('/api/v1/coach/onboarding', { method: 'POST', body: JSON.stringify(payload) }); toast.success('Perfil profesional guardado'); onSaved(saved) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') } finally { setBusy(false) } }
  return <ProForm title="Perfil profesional" intro="Lo esencial para que un consumidor entienda en segundos si encajas." onSubmit={submit}><div className="profile-form-identity wide">{accountProfile && <ProfileAvatar profile={accountProfile} />}<div><strong>{accountProfile?.display_name || 'Tu identidad'}</strong><span>{accountProfile?.email || 'Correo no disponible'}</span></div><Link className="login-button" to="/cuenta"><Camera /> Cambiar foto</Link></div><label>Nombre visible<input name="display_name" required minLength={2} defaultValue={current?.profiles?.display_name || accountProfile?.display_name || ''} /></label><ReadonlyAccountEmail email={accountProfile?.email} /><label>Titular profesional<input name="headline" required minLength={5} placeholder="Fuerza y movilidad sin complicaciones" defaultValue={current?.headline || ''} /></label><label>Modalidad<select name="mode" defaultValue={current?.mode || 'hibrido'}><option value="hibrido">Online y presencial</option><option value="online">Online</option><option value="presencial">Presencial</option></select></label><label className="wide">Sobre tu método<textarea name="bio" required minLength={20} rows={5} defaultValue={current?.bio || ''} /></label><CityAutocompleteField initialValue={current?.city || accountProfile?.city || ''} /><label>Años de experiencia<input name="years_experience" type="number" min="0" defaultValue={current?.years_experience || 0} /></label><label>Idiomas<input name="languages_text" defaultValue={(current?.languages || ['es']).join(', ')} placeholder="es, en" /></label><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" />} Guardar perfil</Button></ProForm>
}

function ServicesForm() {
  const [services, setServices] = useState<CoachServiceRecord[]>([])
  const [catalog, setCatalog] = useState<Array<{ id: string; name_es: string }>>([])
  const [editing, setEditing] = useState<CoachServiceRecord | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [offerType, setOfferType] = useState<'single' | 'flex_pack' | 'recurring_plan'>('single')
  const [recurringScheduleMode, setRecurringScheduleMode] = useState<'fixed' | 'flexible'>('fixed')
  const [availableWeekdays, setAvailableWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6])
  const [availableStartTime, setAvailableStartTime] = useState('09:00')
  const [availableEndTime, setAvailableEndTime] = useState('19:00')
  const [bookingWindowDays, setBookingWindowDays] = useState(60)
  const [serviceMode, setServiceMode] = useState<Mode>('online')
  const [locationPolicy, setLocationPolicy] = useState<'fixed_private' | 'travel' | 'agreed'>('agreed')
  useEffect(() => {
    api<CoachServiceRecord[]>('/api/v1/coach/services')
      .then((items) => {
        setServices(items)
        setFormOpen(items.length === 0)
        setLoadError('')
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'No pudimos cargar tus servicios'))
      .finally(() => setLoaded(true))
    if (hasSupabase)
      supabase
        .from('categories')
        .select('id,name_es')
        .not('parent_id', 'is', null)
        .then(({ data, error }) => {
          if (error) setLoadError(error.message)
          else setCatalog(data || [])
        })
  }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    if (!availableWeekdays.length) return toast.error('Elige al menos un día para ofrecer este servicio.')
    if (availableEndTime <= availableStartTime) return toast.error('La hora final del servicio debe ser posterior a la inicial.')
    const packageSize = offerType === 'single' ? 1 : Number(form.get('package_size'))
    const cadenceWeeks = offerType === 'recurring_plan' && recurringScheduleMode === 'fixed' ? Number(form.get('cadence_weeks')) : null
    const expiryDays = offerType === 'single'
      ? null
      : offerType === 'recurring_plan'
        ? Math.min(365, Math.max(30, (packageSize - 1) * (cadenceWeeks || 1) * 7 + 30))
        : Number(form.get('expiry_days'))
    const payload = {
      category_id: form.get('category_id'),
      name: form.get('name'),
      description: form.get('description'),
      mode: form.get('mode'),
      duration_minutes: Number(form.get('duration_minutes')),
      price_cents: Math.round(Number(form.get('price')) * 100),
      offer_type: offerType,
      booking_mode: form.get('booking_mode'),
      package_size: packageSize,
      expiry_days: expiryDays,
      cadence_weeks: cadenceWeeks,
      booking_window_days: Number(form.get('booking_window_days')),
      available_weekdays: availableWeekdays,
      available_start_time: availableStartTime,
      available_end_time: availableEndTime,
      location_policy: serviceMode === 'online' ? 'agreed' : locationPolicy,
      public_area_label: serviceMode === 'online' ? null : String(form.get('public_area_label') || '').trim() || null,
      private_address_line: locationPolicy === 'fixed_private' ? String(form.get('private_address_line') || '').trim() || null : null,
      private_locality: locationPolicy === 'fixed_private' ? String(form.get('private_locality') || '').trim() || null : null,
      private_postal_code: locationPolicy === 'fixed_private' ? String(form.get('private_postal_code') || '').trim() : '',
      private_location_instructions: locationPolicy === 'fixed_private' ? String(form.get('private_location_instructions') || '').trim() : '',
      ...(offerType === 'recurring_plan' ? { recurring_schedule_mode: recurringScheduleMode } : {}),
    }
    setBusy(true)
    try {
      const item = await api<CoachServiceRecord>(editing ? `/api/v1/coach/services/${editing.id}` : '/api/v1/coach/services', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      setServices((items) => (editing ? items.map((current) => (current.id === item.id ? item : current)) : [...items, item]))
      formElement.reset()
      setEditing(null)
      setFormOpen(false)
      toast.success(editing ? 'Servicio actualizado' : 'Servicio añadido')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    try {
      await api(`/api/v1/coach/services/${id}`, { method: 'DELETE' })
      setServices((items) => items.filter((item) => item.id !== id))
      if (editing?.id === id) {
        setEditing(null)
        setFormOpen(false)
      }
      toast.success('Servicio desactivado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo desactivar')
    }
  }
  const edit = (item: CoachServiceRecord) => {
    setEditing(item)
    setOfferType(item.offer_type || (item.package_size > 1 ? 'flex_pack' : 'single'))
    setRecurringScheduleMode(item.recurring_schedule_mode || 'fixed')
    setAvailableWeekdays(item.available_weekdays || [0, 1, 2, 3, 4, 5, 6])
    setAvailableStartTime(item.available_start_time?.slice(0, 5) || '00:00')
    setAvailableEndTime(item.available_end_time?.slice(0, 5) || '23:59')
    setBookingWindowDays(item.booking_window_days || 31)
    setServiceMode(item.mode)
    setLocationPolicy(item.location_policy || 'agreed')
    setFormOpen(true)
  }
  const create = () => {
    setEditing(null)
    setOfferType('single')
    setRecurringScheduleMode('fixed')
    setAvailableWeekdays([0, 1, 2, 3, 4, 5, 6])
    setAvailableStartTime('09:00')
    setAvailableEndTime('19:00')
    setBookingWindowDays(60)
    setServiceMode('online')
    setLocationPolicy('agreed')
    setFormOpen(true)
  }
  if (!loaded) return <LoadingBlock label="Cargando tus servicios" />
  return (
    <section className="services-manager">
      <div className="section-title services-heading">
        <div>
          <p className="eyebrow">Oferta profesional</p>
          <h2 className="form-title">Servicios y precios.</h2>
          <p className="form-intro">Crea sesiones sueltas, bonos cuyas fechas se eligen después o series con todas las fechas programadas desde la compra.</p>
        </div>
        {!formOpen && (
          <Button onClick={create}>
            <Plus /> Nueva oferta
          </Button>
        )}
      </div>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
      {formOpen && (
        <div className="service-editor">
          <ProForm key={editing?.id || 'new-service'} title={editing ? 'Editar servicio' : 'Nuevo servicio'} intro="Define primero la experiencia y después sus reglas de reserva. Las compras existentes no cambiarán." onSubmit={submit}>
            <div className="service-form-section wide"><span>01</span><div><strong>Modelo de venta</strong><small>Sesión suelta, bono o plan con varias fechas.</small></div></div>
            <label>
              Tipo de oferta
              <select name="offer_type" value={offerType} onChange={(event) => setOfferType(event.target.value as typeof offerType)}>
                <option value="single">Sesión individual</option>
                <option value="flex_pack">Bono flexible · fechas después</option>
                <option value="recurring_plan">Plan de varias sesiones · pago único</option>
              </select>
            </label>
            <label>
              Forma de reserva
              <select name="booking_mode" defaultValue={editing?.booking_mode || 'instant'}>
                <option value="instant">Reserva inmediata</option>
                <option value="request">Solicitud con aprobación</option>
              </select>
            </label>
            <div className="service-form-section wide"><span>02</span><div><strong>Contenido y precio</strong><small>Lo que verá el cliente al comparar tus opciones.</small></div></div>
            <label>
              Especialidad
              <select name="category_id" required defaultValue={editing?.category_id || ''}>
                <option value="">Selecciona</option>
                {catalog.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name_es}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nombre
              <input name="name" required minLength={3} defaultValue={editing?.name || ''} placeholder="Plan semanal de fuerza" />
            </label>
            <label className="wide">
              Descripción
              <textarea name="description" rows={3} maxLength={500} defaultValue={editing?.description || ''} placeholder="Objetivo, nivel, lugar y qué debe preparar el cliente." />
            </label>
            <label>
              Modalidad
              <select name="mode" value={serviceMode} onChange={(event) => setServiceMode(event.target.value as Mode)}>
                <option value="online">Online</option>
                <option value="presencial">Presencial</option>
                <option value="hibrido">Híbrido</option>
              </select>
            </label>
            {serviceMode !== 'online' && <>
              <label>
                Cómo se decide el lugar
                <select name="location_policy" value={locationPolicy} onChange={(event) => setLocationPolicy(event.target.value as typeof locationPolicy)}>
                  <option value="agreed">Se acuerda después por el chat</option>
                  <option value="travel">Me desplazo por una zona</option>
                  <option value="fixed_private">Tengo una ubicación fija</option>
                </select>
              </label>
              <label>
                Zona pública aproximada
                <input name="public_area_label" required={locationPolicy !== 'agreed'} maxLength={120} defaultValue={editing?.public_area_label || ''} placeholder="Ej. Chamberí, Madrid" />
                <small>Esta zona sí se muestra antes de reservar. Nunca publiques aquí la dirección exacta.</small>
              </label>
              {locationPolicy === 'fixed_private' && <>
                <label>
                  Dirección exacta privada
                  <input name="private_address_line" required maxLength={240} defaultValue={editing?.private_location?.address_line || ''} autoComplete="street-address" />
                </label>
                <label>
                  Localidad
                  <input name="private_locality" required maxLength={120} defaultValue={editing?.private_location?.locality || ''} autoComplete="address-level2" />
                </label>
                <label>
                  Código postal
                  <input name="private_postal_code" maxLength={20} defaultValue={editing?.private_location?.postal_code || ''} autoComplete="postal-code" />
                </label>
                <label className="wide">
                  Indicaciones para llegar
                  <textarea name="private_location_instructions" rows={2} maxLength={1000} defaultValue={editing?.private_location?.instructions || ''} placeholder="Portal, recepción o punto de encuentro." />
                  <small>Solo se comparte con el cliente cuando la reserva está confirmada.</small>
                </label>
              </>}
            </>}
            <label>
              Duración por sesión (min)
              <input name="duration_minutes" type="number" min="20" max="240" defaultValue={editing?.duration_minutes || 60} />
            </label>
            <label>
              {offerType === 'single' ? 'Precio por sesión (€)' : 'Precio total del paquete (€)'}
              <input name="price" type="number" min="5" max="1000" step="0.01" required defaultValue={editing ? editing.price_cents / 100 : ''} />
              {offerType !== 'single' && <small>Es un único cobro por todas las sesiones, no un precio semanal ni mensual.</small>}
            </label>
            {offerType !== 'single' && (
              <label>
                Sesiones incluidas
                <input name="package_size" type="number" min="2" max="24" required defaultValue={editing?.package_size || 4} />
              </label>
            )}
            {offerType === 'flex_pack' && (
              <label>
                Caducidad (días)
                <input name="expiry_days" type="number" min="30" max="365" required defaultValue={editing?.expiry_days || 90} />
                <small>El cliente comprará ahora y elegirá cada fecha desde “Mis reservas”.</small>
              </label>
            )}
            {offerType === 'recurring_plan' && (
              <>
                <label>
                  Elección de fechas
                  <select name="recurring_schedule_mode" value={recurringScheduleMode} onChange={(event) => setRecurringScheduleMode(event.target.value as typeof recurringScheduleMode)}>
                    <option value="flexible">Flexibles · el cliente elige cada fecha</option>
                    <option value="fixed">Patrón fijo · mismo día y hora</option>
                  </select>
                  <small>{recurringScheduleMode === 'flexible' ? 'El cliente combinará días y horas disponibles antes de pagar.' : 'El cliente elegirá el primer horario y verá la serie completa antes de pagar.'}</small>
                </label>
                {recurringScheduleMode === 'fixed' && <label>
                  Frecuencia
                  <select name="cadence_weeks" defaultValue={editing?.cadence_weeks || 1}>
                    <option value="1">Cada semana</option>
                    <option value="2">Cada dos semanas</option>
                  </select>
                </label>}
              </>
            )}
            <div className="service-form-section wide"><span>03</span><div><strong>Reglas de agenda</strong><small>Limita los días y hasta qué fecha pueden elegir los clientes.</small></div></div>
            <fieldset className="service-weekdays wide">
              <legend>Días en que ofreces este servicio</legend>
              <div>{weekdayLabels.map((label, index) => <button type="button" key={label} className={availableWeekdays.includes(index) ? 'active' : ''} aria-pressed={availableWeekdays.includes(index)} onClick={() => setAvailableWeekdays((current) => current.includes(index) ? current.filter((day) => day !== index) : [...current, index].sort())}><span>{label}</span><small>{weekdayNames[index]}</small><Check /></button>)}</div>
              <small>Estos días deben estar también activos en tu Agenda general.</small>
            </fieldset>
            <div className="time-range service-time-range wide">
              <label>Disponible desde<input aria-label="Hora inicial del servicio" type="time" value={availableStartTime} onChange={(event) => setAvailableStartTime(event.target.value)} required /></label>
              <label>Disponible hasta<input aria-label="Hora final del servicio" type="time" value={availableEndTime} onChange={(event) => setAvailableEndTime(event.target.value)} required /></label>
              <small>Esta franja se cruza con tu horario general; el cliente solo verá las horas que cumplan ambos.</small>
            </div>
            <label>
              Hasta cuándo se puede reservar
              <select name="booking_window_days" value={bookingWindowDays} onChange={(event) => setBookingWindowDays(Number(event.target.value))}>
                <option value="14">2 semanas</option><option value="31">1 mes</option><option value="60">2 meses</option><option value="90">3 meses</option><option value="180">6 meses</option><option value="365">1 año</option>
              </select>
              <small>El calendario del cliente mostrará huecos hasta este límite.</small>
            </label>
            <div className="service-policy-preview"><Clock3 /><span><strong>{formatServiceWeekdays(availableWeekdays) || 'Elige los días'} · {availableStartTime}—{availableEndTime}</strong><small>Reserva disponible durante los próximos {bookingWindowDays} días.</small></span></div>
            <div className="form-actions">
              <Button type="submit" disabled={busy}>
                {busy && <LoaderCircle className="spin" />} {editing ? 'Guardar cambios' : 'Crear oferta'}
              </Button>
              {services.length > 0 && (
                <button
                  type="button"
                  className="text-button visible-text-button"
                  onClick={() => {
                    setEditing(null)
                    setFormOpen(false)
                  }}
                >
                  Cancelar
                </button>
              )}
            </div>
          </ProForm>
        </div>
      )}
      {services.length > 0 ? (
        <div className="service-manager-list">
          {services.map((item) => (
            <article key={item.id}>
              <div className="service-manager-icon">{item.package_size > 1 ? <span>{item.package_size}×</span> : <CalendarDays />}</div>
              <div className="service-manager-copy">
                <div>
                  <p className="eyebrow">
                    {item.offer_type === 'recurring_plan' ? `${item.recurring_schedule_mode === 'flexible' ? 'Plan flexible' : `Serie ${item.cadence_weeks === 2 ? 'quincenal' : 'semanal'}`} de ${item.package_size} sesiones` : item.offer_type === 'flex_pack' || item.package_size > 1 ? `Bono de ${item.package_size} sesiones` : 'Sesión individual'} · {item.booking_mode === 'request' ? 'Con aprobación' : 'Inmediata'}
                  </p>
                  <h3>{item.name}</h3>
                </div>
                <p>{item.description || 'Sin descripción todavía.'}</p>
                <div className="service-facts">
                  <span>{item.duration_minutes} min</span>
                  <span>{item.expiry_days ? `${item.expiry_days} días` : item.mode}</span>
                  <span>{formatServiceWeekdays(item.available_weekdays || [0, 1, 2, 3, 4, 5, 6])}</span>
                  <span>{formatServiceHours(item.available_start_time, item.available_end_time)}</span>
                  {item.mode !== 'online' && <span>{item.public_area_label || 'Lugar por acordar'}</span>}
                  <span>Hasta {item.booking_window_days || 31} días</span>
                  <strong>
                    {(item.price_cents / 100).toLocaleString('es-ES', {
                      style: 'currency',
                      currency: 'EUR',
                    })}
                  </strong>
                </div>
              </div>
              <div className="service-manager-actions">
                <button onClick={() => edit(item)}>
                  <Pencil /> Editar
                </button>
                <button className="danger-action" onClick={() => remove(item.id)}>
                  Desactivar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !formOpen && <Empty title="Aún no tienes ofertas." copy="Crea la primera para que los clientes sepan qué pueden reservar." action={<Button onClick={create}>Crear oferta</Button>} />
      )}
    </section>
  )
}

function AvailabilityForm() {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
  const [schedule, setSchedule] = useState(() => days.map((_, weekday) => ({
    weekday,
    enabled: weekday < 5,
    startsAt: '09:00',
    endsAt: '19:00',
  })))
  const [exceptions, setExceptions] = useState<any[]>([])
  const [respondsNow, setRespondsNow] = useState(false)
  const [minBookingNotice, setMinBookingNotice] = useState(30)
  const [calendarView, setCalendarView] = useState<CalendarView>('week')
  const [calendarDate, setCalendarDate] = useState(() => startOfDay(new Date()))
  const [calendarBookings, setCalendarBookings] = useState<BookingRecord[]>([])
  const [calendarExceptions, setCalendarExceptions] = useState<any[]>([])
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [calendarError, setCalendarError] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<BookingRecord | null>(null)
  useEffect(() => {
    api<{ rules: any[]; exceptions: any[] }>('/api/v1/coach/availability')
      .then((data) => {
        if (data.rules.length) {
          setSchedule((current) => current.map((day) => {
            const rule = data.rules.find((item) => item.weekday === day.weekday)
            return rule ? { ...day, enabled: true, startsAt: rule.starts_at.slice(0, 5), endsAt: rule.ends_at.slice(0, 5) } : { ...day, enabled: false }
          }))
        }
        setExceptions(data.exceptions)
      })
      .catch(() => undefined)
    api<any>('/api/v1/coach/profile')
      .then((profile) => { setRespondsNow(profile.responds_now); setMinBookingNotice(profile.min_booking_notice_minutes ?? 30) })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    const visibleDays = calendarDaysFor(calendarView, calendarDate)
    const rangeStart = visibleDays[0]
    const rangeEnd = addDays(visibleDays[visibleDays.length - 1], 1)
    setCalendarLoading(true)
    api<{ bookings: BookingRecord[]; exceptions: any[] }>(`/api/v1/coach/calendar?from=${encodeURIComponent(rangeStart.toISOString())}&to=${encodeURIComponent(rangeEnd.toISOString())}`)
      .then((data) => { setCalendarBookings(data.bookings); setCalendarExceptions(data.exceptions); setCalendarError('') })
      .catch((error) => setCalendarError(error instanceof Error ? error.message : 'No pudimos cargar el calendario'))
      .finally(() => setCalendarLoading(false))
  }, [calendarDate, calendarView])
  const save = async () => {
    const invalidDay = schedule.find((day) => day.enabled && day.endsAt <= day.startsAt)
    if (invalidDay) return toast.error(`La hora final del ${days[invalidDay.weekday].toLowerCase()} debe ser posterior a la inicial.`)
    const rules = schedule.filter((day) => day.enabled).map((day) => ({ weekday: day.weekday, starts_at: day.startsAt, ends_at: day.endsAt, timezone: 'Europe/Madrid' }))
    try {
      await Promise.all([
        api('/api/v1/coach/availability', { method: 'PUT', body: JSON.stringify(rules) }),
        api('/api/v1/coach/booking-settings', { method: 'PATCH', body: JSON.stringify({ min_booking_notice_minutes: minBookingNotice }) }),
      ])
      toast.success('Disponibilidad y condiciones actualizadas')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') }
  }
  const addException = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const available = form.get('kind') === 'available'; try { const item = await api<any>('/api/v1/coach/availability/exceptions', { method: 'POST', body: JSON.stringify({ starts_at: new Date(String(form.get('starts_at'))).toISOString(), ends_at: new Date(String(form.get('ends_at'))).toISOString(), available, label: form.get('label') }) }); setExceptions((current) => [...current, item]); setCalendarExceptions((current) => [...current, item]); formElement.reset(); toast.success(available ? 'Disponibilidad puntual añadida' : 'Bloqueo añadido') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo añadir') } }
  const removeException = async (id: string) => { try { await api(`/api/v1/coach/availability/exceptions/${id}`, { method: 'DELETE' }); setExceptions((current) => current.filter((item) => item.id !== id)); setCalendarExceptions((current) => current.filter((item) => item.id !== id)); toast.success('Bloqueo eliminado') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo eliminar') } }
  const toggleRespondsNow = async () => { const enabled = !respondsNow; try { await api('/api/v1/coach/responds-now', { method: 'PATCH', body: JSON.stringify({ enabled }) }); setRespondsNow(enabled) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar') } }
  const visibleDays = calendarDaysFor(calendarView, calendarDate)
  const moveCalendar = (direction: number) => setCalendarDate((current) => calendarView === 'month' ? addMonths(current, direction) : addDays(current, direction * (calendarView === 'week' ? 7 : 1)))
  const calendarTitle = calendarView === 'day'
    ? calendarDate.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    : calendarView === 'month'
      ? calendarDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
      : `${visibleDays[0].toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })} — ${visibleDays[6].toLocaleDateString('es-ES', { day: '2-digit', month: 'long' })}`
  const statusLabel: Record<string, string> = { pending_payment: 'Pago pendiente', confirmed: 'Confirmada', completed: 'Completada', cancelled: 'Cancelada', no_show: 'No asistió' }
  return <section className="agenda-manager">
    <div className="section-title"><div><p className="eyebrow">Agenda profesional</p><h2 className="form-title">Tus sesiones, claras.</h2></div><button className={`status-toggle ${respondsNow ? 'active' : ''}`} onClick={toggleRespondsNow}><span className="live-dot" /> {respondsNow ? 'Respondo ahora' : 'Activar Responde ahora'}</button></div>
    <p className="form-intro">Consulta qué sesiones están reservadas y administra debajo tu disponibilidad recurrente.</p>
    <section className={`week-calendar calendar-${calendarView}`} aria-label={`Calendario ${calendarView === 'day' ? 'diario' : calendarView === 'week' ? 'semanal' : 'mensual'} de sesiones`}>
      <header><div><p className="eyebrow">{calendarView === 'day' ? 'Día' : calendarView === 'week' ? 'Semana' : 'Mes'}</p><h3>{calendarTitle}</h3></div><div className="calendar-toolbar"><div className="calendar-view-tabs" role="group" aria-label="Visualización del calendario">{([['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']] as const).map(([view, label]) => <button type="button" className={calendarView === view ? 'active' : ''} aria-pressed={calendarView === view} onClick={() => setCalendarView(view)} key={view}>{label}</button>)}</div><div className="calendar-controls"><button aria-label="Periodo anterior" onClick={() => moveCalendar(-1)}><ChevronLeft /></button><button onClick={() => setCalendarDate(startOfDay(new Date()))}>Hoy</button><button aria-label="Periodo siguiente" onClick={() => moveCalendar(1)}><ChevronRight /></button></div></div></header>
      {calendarError && <p className="form-error" role="alert">{calendarError}</p>}
      {calendarLoading ? <LoadingBlock label="Cargando el calendario" /> : <div className="week-grid">{visibleDays.map((date) => {
        const dayBookings = calendarBookings.filter((item) => new Date(item.starts_at).toDateString() === date.toDateString())
        const dayExceptions = calendarExceptions.filter((item) => new Date(item.starts_at).toDateString() === date.toDateString())
        const today = date.toDateString() === new Date().toDateString()
        const outsideMonth = calendarView === 'month' && date.getMonth() !== calendarDate.getMonth()
        return <article className={`${today ? 'today' : ''} ${outsideMonth ? 'outside-month' : ''}`} key={date.toISOString()}><div className="week-day-head"><span>{date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span><strong>{date.getDate()}</strong></div><div className="week-events">{dayBookings.map((item) => <button type="button" className={`calendar-event status-${item.status.replaceAll('_', '-')}`} key={item.id} onClick={() => setSelectedBooking(item)} aria-label={`Ver detalles de ${item.coach_services?.name || 'la sesión'} con ${item.profiles?.display_name || 'el cliente'}`}><time>{new Date(item.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</time><strong>{item.coach_services?.name || 'Sesión'}</strong><span>{item.profiles?.display_name || 'Cliente'}</span><small>{statusLabel[item.status] || item.status}</small></button>)}{dayExceptions.map((item) => <div className={`calendar-event ${item.available ? 'available-extra' : 'blocked'}`} key={item.id}><time>{new Date(item.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</time><strong>{item.label || (item.available ? 'Disponibilidad puntual' : 'Bloqueo')}</strong><small>{item.available ? 'Disponible extra' : 'No disponible'}</small></div>)}{!dayBookings.length && !dayExceptions.length && <span className="calendar-empty">Sin sesiones</span>}</div></article>
      })}</div>}
    </section>
    <section className="availability-settings"><div><p className="eyebrow">Horario recurrente</p><h3>Cuándo pueden reservarte</h3><p>Activa tus días habituales y define una franja distinta para cada uno. El horario de cada servicio se cruzará con esta agenda general.</p></div><div className="booking-policy-setting"><div><Clock3 /><span><strong>Margen mínimo de reserva</strong><small>Se mostrará en tu perfil y se aplicará a todos tus servicios.</small></span></div><select aria-label="Margen mínimo de reserva" value={minBookingNotice} onChange={(event) => setMinBookingNotice(Number(event.target.value))}><option value="0">Sin margen mínimo</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="120">2 horas</option><option value="360">6 horas</option><option value="720">12 horas</option><option value="1440">1 día</option><option value="2880">2 días</option><option value="10080">1 semana</option></select></div><div className="availability-day-list">{schedule.map((item) => <div className={item.enabled ? 'availability-day-row active' : 'availability-day-row'} key={item.weekday}><button type="button" className="availability-day-toggle" aria-pressed={item.enabled} onClick={() => setSchedule((current) => current.map((day) => day.weekday === item.weekday ? { ...day, enabled: !day.enabled } : day))}><span>{days[item.weekday]}</span><Check /></button><label>Desde<input aria-label={`Desde el ${days[item.weekday].toLowerCase()}`} type="time" value={item.startsAt} disabled={!item.enabled} onChange={(event) => setSchedule((current) => current.map((day) => day.weekday === item.weekday ? { ...day, startsAt: event.target.value } : day))} /></label><label>Hasta<input aria-label={`Hasta el ${days[item.weekday].toLowerCase()}`} type="time" value={item.endsAt} disabled={!item.enabled} onChange={(event) => setSchedule((current) => current.map((day) => day.weekday === item.weekday ? { ...day, endsAt: event.target.value } : day))} /></label></div>)}</div><Button onClick={save}>Guardar disponibilidad</Button></section>
    <form className="exception-form" onSubmit={addException}><div><p className="eyebrow">Fechas concretas</p><h3>Días sueltos y bloqueos</h3><p>Añade horas extra fuera de tu rutina o marca vacaciones y ausencias.</p></div><label>Tipo<select name="kind" defaultValue="available"><option value="available">Disponibilidad puntual</option><option value="blocked">Bloqueo / no disponible</option></select></label><label>Desde<input name="starts_at" type="datetime-local" required /></label><label>Hasta<input name="ends_at" type="datetime-local" required /></label><label>Motivo<input name="label" placeholder="Clase especial, vacaciones…" /></label><Button type="submit">Añadir fecha</Button></form><div className="compact-list exception-list">{exceptions.map((item) => <div key={item.id}><div><strong>{item.label || (item.available ? 'Disponibilidad puntual' : 'Bloqueo')}</strong><span>{item.available ? 'Disponible' : 'No disponible'} · {new Date(item.starts_at).toLocaleString('es-ES')} — {new Date(item.ends_at).toLocaleString('es-ES')}</span></div><button className="danger-action" onClick={() => removeException(item.id)}>Eliminar</button></div>)}</div>
    {selectedBooking && <BookingDetailsDialog booking={selectedBooking} perspective="coach" onClose={() => setSelectedBooking(null)} />}
  </section>
}

function CredentialForm({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const [status, setStatus] = useState<CredentialStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const refresh = async () => {
    try {
      setStatus(await api<CredentialStatus>('/api/v1/coach/credentials/status'))
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No pudimos consultar la validación')
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setBusy(true)
    const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error } = await supabase.storage.from('credentials').upload(path, file)
    if (error) {
      toast.error(error.message)
      setBusy(false)
      return
    }
    try {
      await api('/api/v1/coach/credentials', {
        method: 'POST',
        body: JSON.stringify({
          title: file.name,
          kind: 'qualification',
          storage_path: path,
        }),
      })
      await refresh()
      toast.success('Título enviado para revisión manual')
    } catch (apiError) {
      toast.error(apiError instanceof Error ? apiError.message : 'No se pudo registrar')
    } finally {
      setBusy(false)
      input.value = ''
    }
  }
  const uploadVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setVideoBusy(true)
    const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error } = await supabase.storage.from('coach-videos').upload(path, file)
    if (error) {
      toast.error(error.message)
      setVideoBusy(false)
      return
    }
    try {
      await api('/api/v1/coach/video', {
        method: 'POST',
        body: JSON.stringify({ storage_path: path }),
      })
      await refresh()
      toast.success('Vídeo enviado para revisión')
    } catch (apiError) {
      toast.error(apiError instanceof Error ? apiError.message : 'No se pudo registrar el vídeo')
    } finally {
      setVideoBusy(false)
      input.value = ''
    }
  }
  if (!loaded) return <LoadingBlock label="Consultando tu validación" />
  const hasCredential = Boolean(status?.credential)
  const hasVideo = Boolean(status?.video_path)
  const waiting = status?.verification_status === 'credentials_submitted' || status?.verification_status === 'under_review' || status?.credential?.status === 'pending' || status?.video_status === 'pending'
  const progress = status?.verification_status === 'verified' ? 100 : status?.verification_status === 'under_review' ? 85 : Math.min(75, 15 + (hasCredential ? 35 : 0) + (hasVideo ? 25 : 0))
  const videoName = status?.video_path
    ?.split('/')
    .pop()
    ?.replace(/^[0-9a-f-]{36}-/i, '')
  return (
    <section className="credential-panel">
      <div className="coming-icon">
        <FileCheck2 />
      </div>
      <p className="eyebrow">Doble validación</p>
      <h2 className="form-title">Acredita lo que haces.</h2>
      <p className="form-intro">Revisamos manualmente tu acreditación y el vídeo que quieras publicar. Los archivos son privados y solo el equipo de validación puede abrirlos.</p>
      {loadError && (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      )}
      {status && (
        <section className={`validation-progress status-${status.verification_status}`} aria-labelledby="validation-progress-title">
          <div className="validation-progress-head">
            <div>
              <p className="eyebrow">Estado de la solicitud</p>
              <h3 id="validation-progress-title">{status.verification_status === 'verified' ? 'Validación completada' : status.verification_status === 'rejected' ? 'Necesitamos que hagas un cambio' : status.verification_status === 'suspended' ? 'Validación pausada' : waiting ? 'Estamos revisando tus archivos' : 'Prepara tu documentación'}</h3>
            </div>
            <strong>{progress}%</strong>
          </div>
          <div className="validation-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          {waiting && (
            <p>
              <Clock3 /> Tu título y tu vídeo están en proceso de validación. Tendrás respuesta en un máximo de 3 días hábiles.
            </p>
          )}
          {status.verification_status === 'verified' && (
            <p>
              <BadgeCheck /> Tu título está validado y tu perfil profesional puede publicarse.
            </p>
          )}
          {['rejected', 'suspended'].includes(status.verification_status) && (
            <p>
              <ShieldCheck /> {status.verification_note || 'El equipo revisará contigo los cambios necesarios.'}
            </p>
          )}
          <ol>
            <li className={hasCredential ? 'done' : ''}>
              <span>1</span> Acreditación enviada
            </li>
            <li className={waiting || status.verification_status === 'verified' ? 'done' : ''}>
              <span>2</span> Revisión manual
            </li>
            <li className={status.verification_status === 'verified' ? 'done' : ''}>
              <span>3</span> Perfil validado
            </li>
          </ol>
        </section>
      )}
      <div className="credential-files">
        <label className={`upload-box ${hasCredential ? 'has-file' : ''}`}>
          <FileCheck2 />
          <strong>{busy ? 'Subiendo…' : hasCredential ? 'Cambiar título o acreditación' : 'Subir título o acreditación'}</strong>
          {hasCredential ? (
            <span>
              <b>{status?.credential?.title}</b> · {status?.credential?.status === 'pending' ? 'Pendiente de revisión' : status?.credential?.status}
            </span>
          ) : (
            <span>PDF, JPG o PNG · máximo 10 MB</span>
          )}
          <small>{hasCredential ? 'Pulsa para editarlo y volver a enviarlo a validación.' : 'Necesario para validar tu perfil.'}</small>
          <input type="file" accept=".pdf,image/jpeg,image/png" onChange={upload} disabled={busy || status?.verification_status === 'suspended'} />
        </label>
        <label className={`upload-box video-upload ${hasVideo ? 'has-file' : ''}`}>
          <Video />
          <strong>{videoBusy ? 'Subiendo vídeo…' : hasVideo ? 'Cambiar vídeo' : 'Añadir vídeo promocional'}</strong>
          {hasVideo ? (
            <span>
              <b>{videoName || 'Vídeo enviado'}</b> · {status?.video_status === 'pending' ? 'Pendiente de revisión' : status?.video_status}
            </span>
          ) : (
            <span>MP4 o WebM · máximo 100 MB</span>
          )}
          <small>{hasVideo ? 'Pulsa para editarlo y enviarlo de nuevo.' : 'Opcional; se revisará antes de publicarse.'}</small>
          <input type="file" accept="video/mp4,video/webm" onChange={uploadVideo} disabled={videoBusy || status?.verification_status === 'suspended'} />
        </label>
      </div>
    </section>
  )
}

function Integrations() {
  type IntegrationStatus = {
    stripe: boolean
    stripe_status?: 'not_connected' | 'pending' | 'active' | 'unavailable'
    stripe_requirements_due?: number
    providers: string[]
    connections?: ConnectedIntegration[]
    custom_video_url?: string
  }
  const [status, setStatus] = useState<IntegrationStatus>({
    stripe: false,
    stripe_status: 'not_connected',
    providers: [],
  })
  useEffect(() => {
    api<IntegrationStatus>('/api/v1/coach/integrations')
      .then(setStatus)
      .catch(() => undefined)
  }, [])
  const connect = async (provider: 'google' | 'zoom') => {
    try {
      const result = await api<{ url: string }>(`/api/v1/integrations/${provider}/oauth-url`)
      window.location.assign(result.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo conectar')
    }
  }
  const stripeConnect = async () => {
    try {
      const result = await api<{ url: string }>('/api/v1/stripe/connect', {
        method: 'POST',
      })
      window.location.assign(result.url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo conectar Stripe')
    }
  }
  const saveCustom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = String(new FormData(event.currentTarget).get('url'))
    try {
      await api('/api/v1/coach/custom-video-link', {
        method: 'PUT',
        body: JSON.stringify({ url }),
      })
      setStatus((current) => ({ ...current, custom_video_url: url }))
      toast.success('Enlace guardado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    }
  }
  const stripeLabel = status.stripe ? 'Conectado · abrir panel de Stripe' : status.stripe_status === 'pending' ? `Completa la verificación${status.stripe_requirements_due ? ` · ${status.stripe_requirements_due} datos pendientes` : ''}` : status.stripe_status === 'unavailable' ? 'No se pudo comprobar el estado' : 'Recibe pagos y consulta tus ingresos'
  const google = status.connections?.find((connection) => connection.provider === 'google')
  const toggleCalendar = async () => {
    if (!google) return void connect('google')
    try {
      const saved = await api<ConnectedIntegration>('/api/v1/integrations/google/calendar', { method: 'PATCH', body: JSON.stringify({ enabled: !google.calendar_enabled, calendar_id: google.calendar_id || 'primary' }) })
      setStatus((current) => ({ ...current, connections: (current.connections || []).map((item) => item.provider === 'google' ? saved : item) }))
      toast.success(saved.calendar_enabled ? 'Google Calendar activado' : 'Google Calendar pausado')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar Calendar') }
  }
  return (
    <section>
      <p className="eyebrow">Pagos y videollamadas</p>
      <h2 className="form-title">Conecta una vez.</h2>
      <p className="form-intro">CoachConnect organiza la reserva. La sesión se celebra en la herramienta que ya conoces.</p>
      <div className="integration-grid">
        <button onClick={stripeConnect}>
          <CreditCard />
          <span>
            <strong>Stripe Connect</strong>
            <small>{stripeLabel}</small>
          </span>
          {status.stripe ? <Check /> : <ArrowRight />}
        </button>
        <button onClick={() => connect('google')}>
          <Globe2 />
          <span>
            <strong>Google Meet</strong>
            <small>{status.providers.includes('google') ? 'Conectado' : 'Crea enlaces desde Calendar'}</small>
          </span>
          {status.providers.includes('google') ? <Check /> : <ArrowRight />}
        </button>
        <button onClick={() => connect('zoom')}>
          <Video />
          <span>
            <strong>Zoom</strong>
            <small>{status.providers.includes('zoom') ? 'Conectado' : 'Crea reuniones automáticamente'}</small>
          </span>
          {status.providers.includes('zoom') ? <Check /> : <ArrowRight />}
        </button>
      </div>
      <div className="calendar-connection professional-calendar-connection"><CalendarDays /><span><strong>Sincronizar agenda con Google Calendar</strong><small>{google?.calendar_enabled ? 'Tus sesiones se crean y se actualizan automáticamente. Los enlaces de Meet se generan desde el evento del entrenador.' : google ? 'La cuenta está conectada; activa la sincronización automática de reservas.' : 'Conecta Google para generar Meet y mantener tu calendario al día.'}</small></span><Button type="button" onClick={toggleCalendar}>{google?.calendar_enabled ? <Check /> : <Plus />}{google?.calendar_enabled ? 'Activo' : google ? 'Activar' : 'Conectar'}</Button></div>
      <form className="custom-link-form" onSubmit={saveCustom}>
        <label>
          Enlace personalizado HTTPS
          <input name="url" type="url" pattern="https://.*" defaultValue={status.custom_video_url || ''} placeholder="https://…" />
        </label>
        <Button type="submit">Guardar enlace</Button>
      </form>
    </section>
  )
}

function ProForm({ title, intro, onSubmit, children }: { title: string; intro: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode }) {
  return (
    <form className="pro-form" onSubmit={onSubmit}>
      <p className="eyebrow">Configuración</p>
      <h2 className="form-title">{title}</h2>
      <p className="form-intro">{intro}</p>
      <div className="form-grid">{children}</div>
    </form>
  )
}

function Admin() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [videos, setVideos] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [sanctions, setSanctions] = useState<ModerationSanction[]>([])
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({})
  const [sessionDisputes, setSessionDisputes] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [accessFilter, setAccessFilter] = useState('all')
  const [verificationFilter, setVerificationFilter] = useState('all')
  const [adminError, setAdminError] = useState('')
  const [tab, setTab] = useState('validation')
  useEffect(() => {
    if (!user) return
    api<Profile>('/api/v1/me')
      .then((item) => {
        setProfile(item)
        if (item.role !== 'admin') return
        void Promise.all([api<any[]>('/api/v1/admin/credentials').then(setDocs), api<any[]>('/api/v1/admin/videos').then(setVideos), api<any[]>('/api/v1/admin/reports').then(setReports), api<ModerationSanction[]>('/api/v1/admin/sanctions').then(setSanctions), api<any[]>('/api/v1/admin/session-disputes').then(setSessionDisputes), api<any[]>('/api/v1/admin/categories').then(setCatalog), api<any[]>('/api/v1/admin/bookings').then(setBookings), api<any[]>('/api/v1/admin/payments').then(setPayments), api<AdminUser[]>('/api/v1/admin/users').then(setUsers)]).catch((error) => setAdminError(error instanceof Error ? error.message : 'No se pudo cargar el panel'))
      })
      .catch(() => undefined)
  }, [user])
  const filteredUsers = useMemo(
    () =>
      users.filter((item) => {
        const query = userQuery.trim().toLocaleLowerCase('es')
        const matchesQuery = !query || item.display_name.toLocaleLowerCase('es').includes(query) || item.email?.toLocaleLowerCase('es').includes(query)
        const matchesRole = roleFilter === 'all' || item.role === roleFilter
        const matchesAccess = accessFilter === 'all' || (accessFilter === 'active' ? item.access_enabled : !item.access_enabled)
        const matchesVerification = verificationFilter === 'all' || (verificationFilter === 'not_coach' ? !item.coach : item.coach?.verification_status === verificationFilter)
        return matchesQuery && matchesRole && matchesAccess && matchesVerification
      }),
    [users, userQuery, roleFilter, accessFilter, verificationFilter],
  )
  if (!user || profile?.role !== 'admin')
    return (
      <section className="access-denied">
        <ShieldCheck />
        <h1>Área de operaciones.</h1>
        <p>Solo las cuentas administradoras pueden revisar títulos y validar entrenadores.</p>
      </section>
    )
  const openPrivate = async (path: string) => {
    try {
      const result = await api<{ url: string }>(path)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo abrir')
    }
  }
  const setCoachStatus = async (coachId: string, status: 'verified' | 'rejected' | 'suspended', note: string) => {
    try {
      await api(`/api/v1/admin/coaches/${coachId}/verification`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note }),
      })
      setUsers((items) =>
        items.map((item) =>
          item.id === coachId && item.coach
            ? {
                ...item,
                coach: {
                  ...item.coach,
                  verification_status: status,
                  verification_note: note,
                },
              }
            : item,
        ),
      )
      if (status === 'verified' || status === 'rejected') setDocs((items) => items.filter((item) => item.coach_id !== coachId))
      toast.success(status === 'verified' ? 'Entrenador validado' : status === 'suspended' ? 'Validez profesional retirada' : 'Documentación rechazada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la validación')
    }
  }
  const reviewVideo = async (coachId: string, status: 'approved' | 'rejected') => {
    try {
      await api(`/api/v1/admin/videos/${coachId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note: '' }),
      })
      setVideos((items) => items.filter((item) => item.user_id !== coachId))
      toast.success(status === 'approved' ? 'Vídeo aprobado' : 'Vídeo rechazado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revisar el vídeo')
    }
  }
  const setUserAccess = async (item: AdminUser) => {
    const enabled = !item.access_enabled
    try {
      await api(`/api/v1/admin/users/${item.id}/access`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      })
      setUsers((items) => items.map((current) => (current.id === item.id ? { ...current, access_enabled: enabled } : current)))
      toast.success(enabled ? 'Acceso restaurado' : 'Acceso revocado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el acceso')
    }
  }
  const updateReport = async (id: string, status: 'reviewing' | 'resolved' | 'dismissed') => {
    try {
      const row = await api<any>(`/api/v1/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolution_note: reportNotes[id] || '' }),
      })
      setReports((items) => items.map((item) => (item.id === id ? { ...item, ...row } : item)))
      toast.success(status === 'resolved' ? 'Denuncia resuelta' : status === 'dismissed' ? 'Denuncia descartada' : 'Denuncia en revisión')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar la denuncia')
    }
  }
  const createSanction = async (event: FormEvent<HTMLFormElement>, report: any) => {
    event.preventDefault()
    if (!report.reported_user_id) return
    const form = new FormData(event.currentTarget)
    try {
      const row = await api<ModerationSanction>('/api/v1/admin/sanctions', {
        method: 'POST',
        body: JSON.stringify({
          user_id: report.reported_user_id,
          report_id: report.id,
          kind: form.get('kind'),
          duration_hours: Number(form.get('duration_hours')),
          reason: form.get('reason'),
        }),
      })
      setSanctions((items) => [row, ...items])
      setReports((items) => items.map((item) => (item.id === report.id ? { ...item, status: 'reviewing', sanctions: [row, ...(item.sanctions || [])] } : item)))
      toast.success('Medida temporal aplicada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo aplicar la medida')
    }
  }
  const revokeSanction = async (id: string) => {
    try {
      const row = await api<ModerationSanction>(`/api/v1/admin/sanctions/${id}/revoke`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Revocada manualmente desde el panel de moderación' }),
      })
      setSanctions((items) => items.map((item) => (item.id === id ? { ...item, ...row } : item)))
      setReports((items) => items.map((item) => ({ ...item, sanctions: (item.sanctions || []).map((sanction: ModerationSanction) => (sanction.id === id ? { ...sanction, ...row } : sanction)) })))
      toast.success('Restricción retirada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo retirar la restricción')
    }
  }
  const resolveSessionDispute = async (id: string, outcome: string) => {
    try {
      await api(`/api/v1/admin/session-disputes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          outcome,
          note: 'Resultado revisado por operaciones',
        }),
      })
      setSessionDisputes((items) => items.filter((item) => item.id !== id))
      toast.success('Resultado de la sesión resuelto')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo resolver la incidencia')
    }
  }
  const createCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const payload = {
      slug: form.get('slug'),
      name_es: form.get('name_es'),
      name_en: form.get('name_en'),
      sort_order: Number(form.get('sort_order')),
      active: true,
    }
    try {
      const row = await api('/api/v1/admin/categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      setCatalog((items) => [...items, row])
      formElement.reset()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear')
    }
  }
  const verificationLabels: Record<string, string> = {
    draft: 'Sin enviar',
    credentials_submitted: 'Pendiente',
    under_review: 'En revisión',
    verified: 'Válido',
    rejected: 'Rechazado',
    suspended: 'Suspendido',
  }
  const sanctionLabels: Record<ModerationSanction['kind'], string> = {
    account: 'Cuenta suspendida',
    messaging: 'Sin mensajería',
    training: 'Sin entrenamientos',
  }
  const activeSanctions = sanctions.filter((item) => !item.revoked_at && new Date(item.expires_at) > new Date())
  return (
    <section className="admin-screen">
      <p className="eyebrow">CoachConnect Ops</p>
      <h1>Operaciones.</h1>
      {adminError && (
        <p className="form-error" role="alert">
          {adminError}
        </p>
      )}
      <div className="admin-tabs">
        {[
          ['validation', 'Validación'],
          ['users', 'Usuarios'],
          ['moderation', 'Moderación'],
          ['sessions', 'Incidencias'],
          ['catalog', 'Taxonomía'],
          ['matching', 'Matching'],
          ['business', 'Reservas y pagos'],
        ].map(([key, label]) => (
          <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'validation' && (
        <>
          <h2>Documentación profesional</h2>
          <div className="admin-list">
            {docs.map((item) => (
              <article key={item.id}>
                <FileCheck2 />
                <div>
                  <strong>{item.profile?.display_name || 'Entrenador sin nombre'}</strong>
                  <span>
                    {item.title} · enviado el {new Date(item.created_at).toLocaleDateString('es-ES')} · ID {item.coach_id.slice(0, 8)}
                  </span>
                </div>
                <div>
                  <button onClick={() => openPrivate(`/api/v1/admin/credentials/${item.id}/download`)}>Abrir</button>
                  <button onClick={() => setCoachStatus(item.coach_id, 'verified', 'Documentación revisada')}>Aprobar</button>
                  <button onClick={() => setCoachStatus(item.coach_id, 'rejected', 'Revisa y vuelve a enviar tu documentación')}>Rechazar</button>
                </div>
              </article>
            ))}
            {!docs.length && <Empty title="Sin títulos pendientes." copy="Las nuevas acreditaciones aparecerán aquí con el nombre del entrenador." />}
          </div>
          <h2>Vídeos pendientes</h2>
          <div className="admin-list">
            {videos.map((item) => (
              <article key={item.user_id}>
                <Video />
                <div>
                  <strong>{item.profiles?.display_name || 'Entrenador sin nombre'}</strong>
                  <span>Vídeo promocional pendiente · ID {item.user_id.slice(0, 8)}</span>
                </div>
                <div>
                  <button onClick={() => openPrivate(`/api/v1/admin/videos/${item.user_id}/download`)}>Abrir</button>
                  <button onClick={() => reviewVideo(item.user_id, 'approved')}>Aprobar</button>
                  <button onClick={() => reviewVideo(item.user_id, 'rejected')}>Rechazar</button>
                </div>
              </article>
            ))}
            {!videos.length && <Empty title="Sin vídeos pendientes." copy="Los vídeos enviados para revisión aparecerán aquí." />}
          </div>
        </>
      )}
      {tab === 'users' && (
        <>
          <div className="admin-users-head">
            <div>
              <h2>Usuarios y accesos</h2>
              <p>
                {filteredUsers.length} de {users.length} usuarios
              </p>
            </div>
          </div>
          <div className="admin-user-filters">
            <label>
              <span>Buscar</span>
              <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Nombre o email" />
            </label>
            <label>
              <span>Tipo</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="coach">Entrenadores</option>
                <option value="consumer">Clientes</option>
                <option value="admin">Administradores</option>
              </select>
            </label>
            <label>
              <span>Acceso</span>
              <select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="active">Con acceso</option>
                <option value="revoked">Revocados</option>
              </select>
            </label>
            <label>
              <span>Validez profesional</span>
              <select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}>
                <option value="all">Cualquier estado</option>
                <option value="verified">Válidos</option>
                <option value="credentials_submitted">Pendientes</option>
                <option value="under_review">En revisión</option>
                <option value="rejected">Rechazados</option>
                <option value="suspended">Suspendidos</option>
                <option value="not_coach">No entrenadores</option>
              </select>
            </label>
          </div>
          <div className="admin-user-list">
            {filteredUsers.map((item) => (
              <article className={!item.access_enabled ? 'access-revoked' : ''} key={item.id}>
                <div className="admin-user-avatar">{item.display_name.slice(0, 2).toUpperCase()}</div>
                <div className="admin-user-identity">
                  <strong>{item.display_name}</strong>
                  <span>{item.email || 'Email no disponible'}</span>
                  <small>Alta: {item.created_at ? new Date(item.created_at).toLocaleDateString('es-ES') : 'sin fecha'}</small>
                </div>
                <div className="admin-user-badges">
                  <span className={`role-badge role-${item.role}`}>{item.role === 'coach' ? 'Entrenador' : item.role === 'admin' ? 'Administrador' : 'Cliente'}</span>
                  <span className={`access-badge ${item.access_enabled ? 'active' : 'revoked'}`}>{item.access_enabled ? 'Acceso activo' : 'Acceso revocado'}</span>
                  {item.coach && <span className={`status-pill status-${item.coach.verification_status}`}>{verificationLabels[item.coach.verification_status] || item.coach.verification_status}</span>}
                  {(item.active_sanctions || []).map((sanction) => <span className={`sanction-badge kind-${sanction.kind}`} key={sanction.id}>{sanctionLabels[sanction.kind]}</span>)}
                </div>
                <div className="admin-user-actions">
                  {item.coach && <button onClick={() => setCoachStatus(item.id, item.coach?.verification_status === 'verified' ? 'suspended' : 'verified', item.coach?.verification_status === 'verified' ? 'Validez retirada por administración' : 'Validez concedida por administración')}>{item.coach.verification_status === 'verified' ? 'Retirar validez' : 'Dar validez'}</button>}
                  <button className={item.access_enabled ? 'danger-action' : ''} disabled={item.id === user.id && item.access_enabled} title={item.id === user.id && item.access_enabled ? 'No puedes revocar tu propia cuenta' : undefined} onClick={() => setUserAccess(item)}>
                    {item.access_enabled ? 'Revocar acceso' : 'Restaurar acceso'}
                  </button>
                </div>
              </article>
            ))}
            {!filteredUsers.length && <Empty title="Ningún usuario coincide." copy="Prueba a cambiar los filtros o el texto de búsqueda." />}
          </div>
        </>
      )}
      {tab === 'moderation' && (
        <div className="moderation-workspace">
          <div className="moderation-summary">
            <div><span><Flag /></span><strong>{reports.filter((item) => item.status === 'open').length}</strong><small>Denuncias nuevas</small></div>
            <div><span><ShieldAlert /></span><strong>{reports.filter((item) => item.status === 'reviewing').length}</strong><small>En revisión</small></div>
            <div><span><Ban /></span><strong>{activeSanctions.length}</strong><small>Medidas activas</small></div>
          </div>
          <div className="moderation-layout">
            <div className="report-queue">
              <header><div><p className="eyebrow">Bandeja de seguridad</p><h2>Denuncias de usuarios</h2></div><span>{reports.length} casos</span></header>
              {reports.map((item) => (
                <article className={`moderation-report status-${item.status}`} key={item.id}>
                  <header>
                    <div className="report-identities">
                      <span className="avatar">{(item.reporter?.display_name || 'CC').slice(0, 2).toUpperCase()}</span>
                      <div><small>Denuncia de</small><strong>{item.reporter?.display_name || 'Usuario'}</strong></div>
                      <ArrowRight />
                      <span className="avatar reported">{(item.reported_user?.display_name || 'CC').slice(0, 2).toUpperCase()}</span>
                      <div><small>Usuario denunciado</small><strong>{item.reported_user?.display_name || 'Usuario no disponible'}</strong></div>
                    </div>
                    <span className={`report-status ${item.status}`}>{item.status === 'open' ? 'Nueva' : item.status === 'reviewing' ? 'En revisión' : item.status === 'resolved' ? 'Resuelta' : 'Descartada'}</span>
                  </header>
                  <div className="report-body">
                    <div className="report-reason"><Flag /><div><small>Motivo</small><strong>{item.reason}</strong><p>{item.details || 'La persona no añadió más detalles.'}</p></div></div>
                    {item.message && <blockquote><small>Mensaje señalado · {new Date(item.message.created_at).toLocaleString('es-ES')}</small><p>“{item.message.body}”</p></blockquote>}
                    <small className="report-date">Recibida el {new Date(item.created_at).toLocaleString('es-ES')}</small>
                  </div>
                  {(item.sanctions || []).length > 0 && <div className="report-measures">{item.sanctions.map((sanction: ModerationSanction) => <span className={sanction.revoked_at ? 'revoked' : ''} key={sanction.id}><ShieldCheck /> {sanctionLabels[sanction.kind]} · hasta {new Date(sanction.expires_at).toLocaleDateString('es-ES')}</span>)}</div>}
                  {item.reported_user_id && ['open', 'reviewing'].includes(item.status) && (
                    <form className="sanction-form" onSubmit={(event) => createSanction(event, item)}>
                      <div><p className="eyebrow">Aplicar medida manual</p><strong>Restringir temporalmente</strong></div>
                      <label>Medida<select name="kind" defaultValue="messaging"><option value="messaging">Bloquear mensajes</option><option value="training">Bloquear entrenamientos</option><option value="account">Suspender cuenta</option></select></label>
                      <label>Duración<select name="duration_hours" defaultValue="168"><option value="24">24 horas</option><option value="72">3 días</option><option value="168">7 días</option><option value="720">30 días</option><option value="2160">90 días</option></select></label>
                      <label className="sanction-reason">Justificación<input name="reason" minLength={3} maxLength={500} required defaultValue={`Denuncia: ${item.reason}`} /></label>
                      <Button type="submit">Aplicar medida</Button>
                    </form>
                  )}
                  <div className="report-resolution">
                    <label>Nota interna<textarea value={reportNotes[item.id] ?? item.resolution_note ?? ''} onChange={(event) => setReportNotes((notes) => ({ ...notes, [item.id]: event.target.value }))} rows={2} maxLength={1200} placeholder="Conclusión de la revisión, evidencias o criterio aplicado…" /></label>
                    <div><button onClick={() => updateReport(item.id, 'reviewing')}>Marcar en revisión</button><button onClick={() => updateReport(item.id, 'dismissed')}>Descartar</button><button className="primary-action" onClick={() => updateReport(item.id, 'resolved')}>Resolver caso</button></div>
                  </div>
                </article>
              ))}
              {!reports.length && <Empty title="No hay denuncias." copy="Los nuevos avisos enviados desde los chats aparecerán aquí con todo su contexto." />}
            </div>
            <aside className="active-sanctions-panel">
              <header><p className="eyebrow">Control activo</p><h2>Medidas vigentes</h2><span>{activeSanctions.length}</span></header>
              <div>
                {activeSanctions.map((item) => (
                  <article key={item.id}>
                    <span className={`sanction-icon kind-${item.kind}`}>{item.kind === 'account' ? <UserRoundX /> : item.kind === 'messaging' ? <MessageSquareOff /> : <Dumbbell />}</span>
                    <div><strong>{item.profile?.display_name || 'Usuario'}</strong><span>{sanctionLabels[item.kind]}</span><small>Hasta {new Date(item.expires_at).toLocaleString('es-ES')}</small><p>{item.reason}</p></div>
                    <button onClick={() => revokeSanction(item.id)}><Unlock /> Retirar</button>
                  </article>
                ))}
                {!activeSanctions.length && <p className="sanctions-empty"><ShieldCheck /> No hay restricciones temporales activas.</p>}
              </div>
            </aside>
          </div>
        </div>
      )}
      {tab === 'sessions' && (
        <div className="admin-list dispute-list">
          {sessionDisputes.map((item) => (
            <article key={item.id}>
              <ShieldCheck />
              <div>
                <strong>
                  {item.consumer?.display_name || 'Cliente'} / {item.coach?.display_name || 'Entrenador'}
                </strong>
                <span>
                  {item.coach_services?.name || 'Entrenamiento'} · {new Date(item.starts_at).toLocaleString('es-ES')}
                </span>
                {(item.session_reports || []).map((report: any) => (
                  <small key={report.id}>
                    {report.author_id === item.coach_id ? 'Entrenador' : 'Cliente'}: {report.outcome}
                    {report.note ? ` · ${report.note}` : ''}
                  </small>
                ))}
              </div>
              <div className="dispute-actions">
                <button onClick={() => resolveSessionDispute(item.id, 'attended')}>Realizado</button>
                <button onClick={() => resolveSessionDispute(item.id, 'client_no_show')}>No vino cliente</button>
                <button onClick={() => resolveSessionDispute(item.id, 'coach_no_show')}>No vino entrenador</button>
                <button onClick={() => resolveSessionDispute(item.id, 'technical_failure')}>Fallo técnico</button>
              </div>
            </article>
          ))}
          {!sessionDisputes.length && <Empty title="Sin sesiones en disputa." copy="Las versiones contradictorias aparecerán aquí para revisión." />}
        </div>
      )}
      {tab === 'catalog' && (
        <>
          <form className="admin-form" onSubmit={createCategory}>
            <input name="slug" placeholder="slug" required />
            <input name="name_es" placeholder="Nombre ES" required />
            <input name="name_en" placeholder="Name EN" required />
            <input name="sort_order" type="number" defaultValue="100" />
            <Button type="submit">Crear categoría</Button>
          </form>
          <div className="compact-list">
            {catalog.map((item) => (
              <div key={item.id}>
                <strong>{item.name_es}</strong>
                <span>
                  {item.name_en} · {item.slug}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'matching' && (
        <>
          <h2>Orden de matching</h2>
          <div className="compact-list">
            {['1. Especialidad', '2. Zona indicada', '3. Valoraciones', '4. Rapidez de respuesta'].map((criterion) => (
              <div key={criterion}>
                <strong>{criterion}</strong>
                <span>Prioridad fija</span>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'business' && (
        <div className="metric-grid">
          <div>
            <span>Reservas</span>
            <strong>{bookings.length}</strong>
            <small>{bookings.filter((item) => item.status === 'confirmed').length} confirmadas</small>
          </div>
          <div>
            <span>Volumen pagado</span>
            <strong>{(payments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount_cents, 0) / 100).toFixed(0)} €</strong>
            <small>{payments.length} pagos</small>
          </div>
          <div>
            <span>Comisión</span>
            <strong>{(payments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.platform_fee_cents, 0) / 100).toFixed(0)} €</strong>
            <small>Ingresos de plataforma</small>
          </div>
        </div>
      )}
    </section>
  )
}

function AuthRequired({ onAuth, title, coach = false }: { onAuth: () => void; title: string; coach?: boolean }) {
  return (
    <section className="auth-required">
      <div className="coming-icon">{coach ? <Zap /> : <UserRound />}</div>
      <p className="eyebrow">Acceso necesario</p>
      <h1>{title}</h1>
      <p>Crea tu cuenta o entra para guardar tus datos de forma segura y continuar donde lo dejaste.</p>
      <Button onClick={onAuth}>
        Entrar o crear cuenta <ArrowRight />
      </Button>
    </section>
  )
}

function Empty({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Sparkles />
      <h2>{title}</h2>
      <p>{copy}</p>
      {action}
    </div>
  )
}
function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="loading-block">
      <LoaderCircle className="spin" />
      <span>{label}</span>
    </div>
  )
}
function LoadingPage() {
  return (
    <section className="loading-page">
      <LoaderCircle className="spin" />
      <span>Preparando tu espacio</span>
    </section>
  )
}
function NotFound() {
  return (
    <section className="auth-required">
      <h1>No encontramos ese entrenador.</h1>
      <Link className="button button-primary button-md" to="/">
        Volver al inicio
      </Link>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <span>© 2026 CoachConnect</span>
      <div className="footer-links">
        <Link to="/profesional">Entrenadores</Link>
        <Link to="/admin">Administración</Link>
        <button onClick={() => toast.info('Legal y privacidad estarán disponibles antes del lanzamiento público.')}>Privacidad</button>
        <button onClick={() => toast.info('Escríbenos a soporte@coachconnect.es')}>Ayuda</button>
      </div>
      <span>Hecho para entrenar, no para hacer scroll.</span>
    </footer>
  )
}

export default App
