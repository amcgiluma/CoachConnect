import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Toaster, toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Bell, CalendarDays, Check, ChevronDown,
  Clock3, CreditCard, FileCheck2, Globe2, Languages, LayoutDashboard, LoaderCircle,
  LogOut, MapPin, MessageCircle, Paperclip, Send, Settings2, ShieldCheck, SlidersHorizontal,
  Sparkles, Star, Upload, UserRound, Video, X, Zap,
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
  id: string; name: string; specialty: string; category: string; mode: Mode; city: string; rating: number
  reviews: number; price_from: number; next_slot: string; responds_now: boolean; verified: boolean
  languages: string[]; match_reasons: string[]; avatar_url?: string | null
}
type MatchApiResponse = { items: MatchApiCoach[]; relaxed_filter: string | null }
type LocalBooking = { id: string; coachId: string; coachName: string; serviceName: string; startsAt: string; amount: number; status: string }
type Profile = { id: string; display_name: string; role: 'consumer' | 'coach' | 'admin' }
type AvailableSlot = { starts_at: string; ends_at: string; label: string }
type ChatMessage = { id: string; conversation_id: string; sender_id: string; body: string; attachment_path?: string | null; created_at: string; delivery_status?: 'sending' }
const CoachMap = lazy(() => import('./components/CoachMap').then((module) => ({ default: module.CoachMap })))

const mergeMessage = (items: ChatMessage[], row: ChatMessage) =>
  items.some((item) => item.id === row.id) ? items : [...items, row]

const fallbackCoach = (row: MatchApiCoach): Coach => ({
  id: row.id, name: row.name, initials: row.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
  specialty: row.specialty, category: row.category, mode: row.mode, city: row.city, rating: row.rating,
  reviews: row.reviews, price: row.price_from, response: row.responds_now ? 'Ahora' : '< 2 h', nextSlot: row.next_slot,
  verified: row.verified, onlineNow: row.responds_now, bio: 'Un enfoque claro, profesional y adaptado a tu objetivo.',
  avatarUrl: row.avatar_url || undefined,
  tags: [row.specialty, ...(row.languages || []), row.mode === 'presencial' ? 'Presencial' : 'Online'],
  services: [{ name: 'Sesión individual', detail: '60 min', price: row.price_from }], matchReasons: row.match_reasons,
})

function App() {
  return <AuthProvider><BrowserRouter><CoachConnect /></BrowserRouter></AuthProvider>
}

function CoachConnect() {
  const [authOpen, setAuthOpen] = useState(false)
  const location = useLocation()
  const isHomeRoute = location.pathname === '/'
  return <div className={`app-shell ${isHomeRoute ? 'home-route' : ''}`}>
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
}

function Header({ onAuth }: { onAuth: () => void }) {
  const { user, signOut } = useAuth()
  const { t, i18n } = useTranslation()
  const currentLanguage = i18n.resolvedLanguage || i18n.language || 'es'
  const toggleLanguage = () => void i18n.changeLanguage(currentLanguage.startsWith('es') ? 'en' : 'es')
  return <header className="topbar">
    <Link className="brand" to="/" aria-label="Volver a CoachConnect"><span className="brand-mark"><span /></span><span>Coach<span className="brand-link">Connect</span></span></Link>
    <nav className="top-actions" aria-label="Navegación principal">
      <button className="language-toggle" onClick={toggleLanguage}>{currentLanguage.startsWith('es') ? 'EN' : 'ES'}</button>
      <Link className="text-button subtle" to="/profesional">{t('nav.coach')}</Link>
      {user && <Link className="text-button subtle desktop-account" to="/mensajes">{t('nav.messages')}</Link>}
      {user && <Link className="icon-button" to="/notificaciones" aria-label={t('nav.notifications')}><Bell /></Link>}
      {user ? <div className="user-actions"><Link className="login-button" to="/cuenta"><UserRound /> {t('nav.account')}</Link><button className="icon-button logout-button" onClick={() => signOut()} aria-label="Cerrar sesión"><LogOut /></button></div>
        : <button className="login-button" onClick={onAuth}><UserRound /> {t('nav.login')}</button>}
    </nav>
  </header>
}

function Home() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [category, setCategory] = useState<Category | null>(null)
  const [previewId, setPreviewId] = useState(categories[0].id)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const categorySelectorRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (step > 0) window.scrollTo({ top: 0, behavior: 'auto' })
  }, [step])
  const begin = (item: Category) => { setCategory(item); setAnswers({ category: item.id }); setStep(1) }
  const finish = (completedAnswers: Record<string, string>) => {
    const search = new URLSearchParams(completedAnswers)
    navigate(`/buscar?${search}`)
  }
  const answer = (key: string, value: string) => {
    const completedAnswers = { ...answers, [key]: value }
    const completedSteps = category ? getQuestionnaireSteps(category, completedAnswers) : []
    if (step >= completedSteps.length) finish(completedAnswers)
    else { setAnswers(completedAnswers); setStep((current) => current + 1) }
  }
  const displayCategories = categories.map((item) => ({
    ...item,
    label: t(`home.categories.${item.id}.label`, { defaultValue: item.label }),
    kicker: t(`home.categories.${item.id}.kicker`, { defaultValue: item.kicker }),
    examples: item.examples.map((example, index) => t(`home.categories.${item.id}.examples.${index}`, { defaultValue: example })),
  }))
  const previewIndex = Math.max(0, categories.findIndex((item) => item.id === previewId))
  const previewCategory = displayCategories[previewIndex]
  const verifiedCoaches = coaches.filter((item) => item.verified)
  const focusCategorySelector = () => {
    const selector = categorySelectorRef.current
    if (!selector) return
    selector.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    })
    selector.querySelector<HTMLButtonElement>(`[data-category-id="${previewId}"]`)?.focus({ preventScroll: true })
  }
  if (step === 0) return <section className="hero-screen" aria-labelledby="home-title">
    <div className="hero-grid" />
    <div className="hero-copy">
      <p className="eyebrow"><span className="live-dot" /> {t('home.eyebrow')}</p>
      <h1 id="home-title">{t('home.titleBefore')}<br /><em>{t('home.titleAccent')}</em><br />{t('home.titleAfter')}</h1>
      <p className="hero-deck">{t('home.description')}</p>
      <div className="hero-cta-row">
        <Button className="hero-selector-cta" size="lg" onClick={focusCategorySelector}>{t('home.action')} <ArrowRight aria-hidden="true" /></Button>
        {verifiedCoaches.length > 0 && <div className="coach-proof">
          <span className="coach-proof-avatars">
            {verifiedCoaches.slice(0, 4).map((coach) => <CoachAvatar coach={coach} className="proof-avatar" key={coach.id} eager title={`${coach.name} · ${coach.specialty}`} />)}
          </span>
          <span><strong><ShieldCheck aria-hidden="true" /> {t('home.verified')}</strong><small>{t('home.proofRating')}</small><small>{t('home.proofDetail')}</small></span>
        </div>}
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
    <div className="hero-number" aria-hidden="true">01<span>/04</span></div>
    <CategorySelector
      ref={categorySelectorRef}
      categories={displayCategories}
      activeCategoryId={previewId}
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
  if (!category) return null
  const steps = getQuestionnaireSteps(category, answers)
  const current = steps[step - 1]
  return <section className="question-screen" aria-labelledby="question-title">
    <div className="question-progress"><span>02 — Afinemos la búsqueda</span><div><i style={{ width: `${Math.min(100, step / steps.length * 100)}%` }} /></div><b>{String(step).padStart(2, '0')}<small>/{String(steps.length).padStart(2, '0')}</small></b></div>
    <div className="question-layout">
      <QuestionnaireContext category={category} answers={answers} step={step} total={steps.length} onChange={() => setStep(0)} />
      <div className="question-wrap"><button type="button" className="back-link" onClick={() => setStep(Math.max(0, step - 1))}><ArrowLeft /> Atrás</button>
        {current?.kind === 'location'
          ? <LocationQuestion title={current.title} initialValue={answers.city} onSelect={(value) => answer(current.key, value)} />
          : current
            ? <Question title={current.title} options={current.options} onSelect={(value) => answer(current.key, value)} />
            : null}
      </div>
    </div>
  </section>
}

const questionAccentColors: Record<string, string> = {
  lime: '#c8ff20', coral: '#ff927d', blue: '#9ed8ff', gold: '#f3d47a',
  violet: '#c9c0ff', pink: '#ffbed8', mint: '#a9efd6', sand: '#dfc6a2',
}

function QuestionnaireContext({ category, answers, step, total, onChange }: { category: Category; answers: Record<string, string>; step: number; total: number; onChange: () => void }) {
  const visual = getCategoryVisual(category.id)
  const CategoryIcon = getCategoryIcon(category.id)
  const style = { '--question-accent': questionAccentColors[category.accent] || questionAccentColors.lime } as CSSProperties
  return <aside className="question-category-card" style={style} aria-label={`Especialidad elegida: ${category.label}`}>
    <picture className="question-category-photo" aria-hidden="true">
      <source srcSet={visual.avif} type="image/avif" />
      <img src={visual.webp} alt="" width="800" height="600" decoding="async" style={{ objectPosition: visual.objectPosition }} />
    </picture>
    <div className="question-category-content">
      <span className="question-category-kicker"><CategoryIcon aria-hidden="true" /> Especialidad elegida</span>
      <strong>{category.label}</strong>
      <p>{answers.subcategory || category.kicker}</p>
    </div>
    <div className="question-category-foot"><span>Paso {String(step).padStart(2, '0')} de {String(total).padStart(2, '0')}</span><button type="button" onClick={onChange}>Cambiar</button></div>
  </aside>
}

function OptionButton({ option, index, onSelect }: { option: QuestionnaireOption; index: number; onSelect: () => void }) {
  const Icon = option.icon
  return <button type="button" className="option-card" onClick={onSelect}><span className="option-icon" aria-hidden="true"><Icon /></span><span className="option-index" aria-hidden="true">0{index + 1}</span><strong>{option.label}</strong><ArrowRight aria-hidden="true" /></button>
}

function Question({ title, options, onSelect }: { title: string; options: QuestionnaireOption[]; onSelect: (value: string) => void }) {
  return <div className="question-content"><p className="eyebrow">Una respuesta rápida</p><h2 id="question-title">{title}</h2><div className="option-list">{options.map((option, index) => <OptionButton key={option.label} option={option} index={index} onSelect={() => onSelect(option.label)} />)}</div></div>
}

type PhotonFeature = {
  properties: {
    osm_type?: string; osm_id?: number; name?: string; city?: string; county?: string
    state?: string; postcode?: string; countrycode?: string; type?: string; osm_key?: string
  }
}
type LocationSuggestion = { id: string; label: string; name: string; detail: string; value: string }

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
    return [{
      id: `${properties.osm_type || 'place'}-${properties.osm_id || index}`,
      label,
      name,
      detail: detail || 'España',
      value: properties.city?.trim() || name,
    }]
  })
}

function LocationQuestion({ title, initialValue, onSelect }: { title: string; initialValue?: string; onSelect: (value: string) => void }) {
  const [locationValue, setLocationValue] = useState(initialValue || '')
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null)
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [lookupState, setLookupState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [retryToken, setRetryToken] = useState(0)

  useEffect(() => {
    const query = locationValue.trim()
    if (selectedLocation?.label === query || query.length < 3) {
      setSuggestions([])
      if (query.length < 3) setLookupState('idle')
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
        const data = await response.json() as { features?: PhotonFeature[] }
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

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [locationValue, retryToken, selectedLocation])

  const chooseLocation = (suggestion: LocationSuggestion) => {
    setLocationValue(suggestion.label)
    setSelectedLocation(suggestion)
    setSuggestions([])
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
        {lookupState === 'error' && <span>No pudimos consultar las ubicaciones. <button type="button" onClick={() => setRetryToken((value) => value + 1)}>Reintentar</button></span>}
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

function Results() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const requestedOnline = search.get('mode') === 'Online' || search.get('city')?.startsWith('Cualquier') === true
  const [items, setItems] = useState<Coach[]>(coaches)
  const [loading, setLoading] = useState(true)
  const [relaxedFilter, setRelaxedFilter] = useState<string | null>(null)
  const [mode, setMode] = useState<'all' | 'online' | 'presencial'>(requestedOnline ? 'online' : 'all')
  const [sort, setSort] = useState('match')
  const [mapOpen, setMapOpen] = useState(false)
  const category = search.get('category') || 'fitness'
  useEffect(() => {
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
    api<MatchApiResponse>('/api/v1/matching/search', { method: 'POST', body: JSON.stringify(payload) })
      .then((data) => { setItems(data.items.map(fallbackCoach)); setRelaxedFilter(data.relaxed_filter) })
      .catch((error) => {
        setItems(coaches)
        setRelaxedFilter(null)
        toast.error(error instanceof Error ? `${error.message} Mostramos resultados de demostración.` : 'Mostramos resultados de demostración.')
      })
      .finally(() => setLoading(false))
  }, [category, requestedOnline, search])
  const shown = useMemo(() => {
    const filtered = items.filter((coach) => (mode === 'all' || coach.mode === mode || coach.mode === 'hibrido') && (coach.category === category || !items.some((item) => item.category === category)))
    const requestedSubcategory = search.get('subcategory')?.toLocaleLowerCase('es') || ''
    const requestedCity = search.get('city')?.toLocaleLowerCase('es') || ''
    return [...filtered].sort((a, b) => {
      if (sort === 'price') return a.price - b.price
      if (sort === 'rating') return b.rating - a.rating || b.reviews - a.reviews
      if (sort === 'availability') return Number(b.onlineNow) - Number(a.onlineNow)
      const specialtyDifference = Number(b.category === category) - Number(a.category === category)
        || Number(Boolean(requestedSubcategory) && [b.specialty, ...b.tags].some((value) => value.toLocaleLowerCase('es').includes(requestedSubcategory)))
          - Number(Boolean(requestedSubcategory) && [a.specialty, ...a.tags].some((value) => value.toLocaleLowerCase('es').includes(requestedSubcategory)))
      const locationDifference = Number(Boolean(requestedCity) && b.city.toLocaleLowerCase('es') === requestedCity)
        - Number(Boolean(requestedCity) && a.city.toLocaleLowerCase('es') === requestedCity)
      return specialtyDifference || locationDifference || b.rating - a.rating || b.reviews - a.reviews || Number(b.onlineNow) - Number(a.onlineNow)
    })
  }, [items, mode, sort, category, search])
  const label = categories.find((item) => item.id === category)?.label || 'Entrenadores'
  return <section className="results-screen"><div className="results-head"><Link className="back-link" to="/"><ArrowLeft /> Cambiar búsqueda</Link><div className="results-title"><div><p className="eyebrow">Tu búsqueda</p><h1>{label}<span> que encajan contigo.</span></h1></div><div className="result-count"><strong>{shown.length}</strong><small>coincidencias<br />encontradas</small></div></div><div className="answer-pills"><span><b>Especialidad</b>{label}</span>{search.get('city') && <span><b>Zona</b>{search.get('city')}</span>}</div></div>
    <div className="results-toolbar"><div className="mode-tabs">{([['all', 'Todos'], ['online', 'Online'], ['presencial', 'Presencial']] as const).map(([value, text]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{text}</button>)}</div><div className="toolbar-right"><label className="select-wrap"><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="match">Mejor coincidencia</option><option value="availability">Disponibilidad</option><option value="rating">Reputación</option><option value="price">Precio</option></select><ChevronDown /></label><button className={`map-toggle ${mapOpen ? 'active' : ''}`} onClick={() => setMapOpen(!mapOpen)}><MapPin /> {mapOpen ? 'Ocultar mapa' : 'Ver mapa'}</button></div></div>
    {relaxedFilter && <div className="match-notice"><Sparkles /><span>No encontramos una coincidencia completa. Hemos relajado <strong>{relaxedFilter}</strong> para enseñarte la alternativa más cercana.</span></div>}
    <div className={`results-layout ${mapOpen ? 'with-map' : ''}`}><div className="coach-list">{loading && <LoadingBlock label="Buscando el mejor encaje" />}{!loading && shown.map((coach, index) => <CoachCard key={coach.id} coach={coach} rank={index + 1} onClick={() => navigate(`/entrenadores/${coach.id}`, { state: { coach } })} />)}{!loading && !shown.length && <div className="empty-state"><Sparkles /><h2>Podemos abrir un poco la búsqueda.</h2><p>Prueba con otra modalidad o zona.</p></div>}</div>{mapOpen && <Suspense fallback={<LoadingBlock label="Cargando mapa" />}><CoachMap coaches={shown} onCoach={(coach) => navigate(`/entrenadores/${coach.id}`, { state: { coach } })} /></Suspense>}</div>
  </section>
}

function CoachCard({ coach, rank, onClick }: { coach: Coach; rank: number; onClick: () => void }) {
  return <article className="coach-card" onClick={onClick} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onClick()}><CoachAvatar coach={coach} className={`avatar avatar-${rank}`} /><div className="coach-main"><div className="coach-card-top"><div><p className="coach-specialty">{coach.specialty}</p><h2>{coach.name}</h2></div><div className="rating"><Star fill="currentColor" /> <strong>{coach.rating}</strong><span>({coach.reviews})</span></div></div><p className="coach-bio">{coach.bio}</p>{coach.matchReasons?.length ? <div className="match-reasons">{coach.matchReasons.slice(0, 3).map((reason) => <span key={reason}><Check /> {reason}</span>)}</div> : null}<div className="coach-meta"><span><MapPin /> {coach.city}</span><span><Clock3 /> {coach.nextSlot}</span><span className={coach.onlineNow ? 'is-live' : ''}><Zap /> {coach.onlineNow ? 'Responde ahora' : coach.response}</span></div><div className="coach-card-bottom"><div className="tag-row">{coach.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><strong className="price-from">Desde {coach.price} € <small>/ sesión</small></strong></div></div><ArrowRight className="card-arrow" /></article>
}

function CoachProfile({ onAuth }: { onAuth: () => void }) {
  const { coachId = '' } = useParams()
  const [profileSearch] = useSearchParams()
  const packageId = profileSearch.get('package')
  const packageServiceId = profileSearch.get('service')
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const initial = (location.state as { coach?: Coach } | null)?.coach || coaches.find((item) => item.id === coachId)
  const [coach, setCoach] = useState<Coach | undefined>(initial)
  const [service, setService] = useState(0)
  const [slot, setSlot] = useState('')
  const [busy, setBusy] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  useEffect(() => {
    if (!isRemoteCoach(coachId)) return
    api<any>(`/api/v1/coaches/${coachId}`).then((row) => {
      const services: CoachService[] = (row.coach_services || []).map((item: any) => ({ id: item.id, name: item.name, detail: `${item.duration_minutes} min · ${item.mode}`, price: item.price_cents / 100, duration: item.duration_minutes, packageSize: item.package_size }))
      setCoach({ id: row.user_id, name: row.profiles?.display_name || initial?.name || 'Entrenador', initials: (row.profiles?.display_name || 'CC').split(' ').map((p: string) => p[0]).join('').slice(0, 2), avatarUrl: row.profiles?.avatar_url || initial?.avatarUrl, avatarAvifUrl: initial?.avatarAvifUrl, specialty: row.headline, category: services[0] ? initial?.category || 'fitness' : 'fitness', mode: row.mode, city: row.city || 'Online', rating: Number(row.rating), reviews: row.review_count, price: Math.min(...services.map((item) => item.price)), response: '< 2 h', nextSlot: 'Consulta la agenda', verified: row.verification_status === 'verified', onlineNow: row.responds_now, bio: row.bio, tags: [row.headline, ...(row.languages || [])], services, videoProvider: row.preferred_video_provider })
      if (packageServiceId) {
        const selectedIndex = services.findIndex((item) => item.id === packageServiceId)
        if (selectedIndex >= 0) setService(selectedIndex)
      }
    }).catch(() => undefined)
  }, [coachId, initial])
  useEffect(() => {
    const selectedService = coach?.services[service]
    if (!isRemoteCoach(coachId) || !selectedService?.id) {
      setSlots(['Hoy · 18:30', 'Hoy · 20:00', 'Mañana · 08:00', 'Mañana · 17:30', 'Jueves · 09:00', 'Viernes · 19:00'].map((label) => ({ starts_at: label, ends_at: label, label })))
      setSlotsLoading(false)
      return
    }
    setSlot('')
    setSlotsLoading(true)
    api<{ items: Array<{ starts_at: string; ends_at: string }> }>(`/api/v1/coaches/${coachId}/slots?service_id=${selectedService.id}`)
      .then(({ items }) => setSlots(items.map((item) => ({
        ...item,
        label: new Date(item.starts_at).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      }))))
      .catch(() => setSlots([]))
      .finally(() => setSlotsLoading(false))
  }, [coachId, coach?.services, service])
  if (!coach) return <NotFound />
  const reserve = async () => {
    if (!user) return onAuth()
    const selected = coach.services[service]
    if (packageId || !selected.packageSize || selected.packageSize <= 1) {
      if (!slot) return toast.error('Elige primero un horario.')
    }
    setBusy(true)
    try {
      if (isRemoteCoach(coach.id) && selected.id) {
        if (packageId) {
          await api('/api/v1/packages/book', { method: 'POST', body: JSON.stringify({ package_id: packageId, starts_at: slot, meeting_provider: coach.videoProvider || 'meet' }) })
          toast.success('Sesión reservada con tu bono.')
          navigate('/reservas')
          return
        }
        const endpoint = selected.packageSize && selected.packageSize > 1 ? '/api/v1/packages/checkout' : '/api/v1/checkout'
        const payload = selected.packageSize && selected.packageSize > 1
          ? { service_id: selected.id }
          : { service_id: selected.id, starts_at: slot, meeting_provider: coach.videoProvider || 'meet' }
        const result = await api<{ checkout_url: string | null }>(endpoint, { method: 'POST', body: JSON.stringify(payload) })
        if (result.checkout_url) window.location.assign(result.checkout_url)
        else toast.success(selected.packageSize && selected.packageSize > 1 ? 'Bono creado. El pago queda pendiente.' : 'Reserva creada. El pago queda pendiente.')
      } else {
        const booking: LocalBooking = { id: crypto.randomUUID(), coachId: coach.id, coachName: coach.name, serviceName: selected.name, startsAt: slots.find((item) => item.starts_at === slot)?.label || slot, amount: selected.price, status: 'confirmed' }
        const stored = JSON.parse(localStorage.getItem('coachconnect-demo-bookings') || '[]') as LocalBooking[]
        localStorage.setItem('coachconnect-demo-bookings', JSON.stringify([booking, ...stored]))
        toast.success('Reserva de demostración confirmada.')
        navigate('/cuenta')
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo reservar') } finally { setBusy(false) }
  }
  const contact = () => {
    if (!user) return onAuth()
    if (!isRemoteCoach(coach.id)) return toast.error('Este perfil es de demostración y no admite mensajes. Elige un entrenador publicado.')
    setChatOpen(true)
  }
  return <section className="profile-screen"><Link className="back-link" to="/buscar"><ArrowLeft /> Volver a resultados</Link><div className="profile-hero"><CoachAvatar coach={coach} className="profile-avatar" eager /><div className="profile-title"><div className="profile-title-line"><h1>{coach.name}</h1>{coach.onlineNow && <span className="live-badge">Disponible ahora</span>}</div><p>{coach.specialty} · {coach.city}</p><div className="profile-rating"><Star fill="currentColor" /><strong>{coach.rating}</strong><span>{coach.reviews} reseñas</span>{coach.verified && <span className="verified-copy"><BadgeCheck /> Identidad y título verificados</span>}</div></div></div>
    <div className="profile-grid"><div className="profile-details"><section className="profile-block"><p className="eyebrow">Cómo entrena</p><p className="profile-bio">{coach.bio}</p><div className="tag-row large">{coach.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section><section className="profile-block"><div className="section-title"><p className="eyebrow">Servicios</p><span>Elige una opción</span></div><div className="service-list">{coach.services.map((item, index) => <button className={`service-row ${service === index ? 'selected' : ''}`} onClick={() => setService(index)} key={item.name}><span className="service-radio">{service === index && <Check />}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span><b>{item.price} €</b></button>)}</div></section><section className="profile-block review-highlight"><div><p className="eyebrow">Lo que más se repite</p><p>“Explica con claridad, escucha y adapta el entrenamiento de verdad.”</p><span>Reseñas verificadas tras sesiones reales</span></div><Star fill="currentColor" /></section></div>
      <aside className="booking-card"><div className="booking-card-top"><p className="eyebrow">{packageId ? 'Sesión incluida en tu bono' : coach.services[service]?.packageSize && coach.services[service]!.packageSize! > 1 ? 'Tu bono' : 'Tu próxima sesión'}</p><strong>{packageId ? '0 €' : `${coach.services[service]?.price} €`}</strong><small>{coach.services[service]?.name} · cancelación gratis hasta 24 h antes</small></div>{(packageId || !coach.services[service]?.packageSize || coach.services[service]!.packageSize! <= 1) && <><p className="calendar-heading"><CalendarDays /> Horarios disponibles</p><AvailabilityCalendar slots={slots} value={slot} onChange={setSlot} loading={slotsLoading} /></>}<Button className="full-button" onClick={reserve} disabled={busy || !coach.verified || ((Boolean(packageId) || !coach.services[service]?.packageSize || coach.services[service]!.packageSize! <= 1) && !slots.length)}>{busy && <LoaderCircle className="spin" />} {coach.verified ? (packageId ? 'Reservar con mi bono' : coach.services[service]?.packageSize && coach.services[service]!.packageSize! > 1 ? 'Comprar bono' : 'Reservar y pagar') : 'Pendiente de verificación'}</Button><button className="chat-cta" onClick={contact}><MessageCircle /> Preguntar antes de reservar</button><p className="booking-note"><ShieldCheck /> Pago protegido por Stripe. La dirección exacta nunca se muestra antes de confirmar.</p></aside>
    </div>{chatOpen && <QuickChat coach={coach} onClose={() => setChatOpen(false)} />}</section>
}

function QuickChat({ coach, onClose }: { coach: Coach; onClose: () => void }) {
  const { user } = useAuth()
  const [body, setBody] = useState('')
  const [sent, setSent] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (!body.trim() || !user) return
    const message = body.trim()
    const optimisticId = `sending:${crypto.randomUUID()}`
    const optimistic: ChatMessage = { id: optimisticId, conversation_id: conversationId || '', sender_id: user.id, body: message, created_at: new Date().toISOString(), delivery_status: 'sending' }
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
      setSent((items) => mergeMessage(items.filter((item) => item.id !== optimisticId), row))
      toast.success('Mensaje guardado y enviado')
    } catch (error) {
      setSent((items) => items.filter((item) => item.id !== optimisticId))
      setBody(message)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar')
    } finally { setBusy(false) }
  }
  return <div className="modal-backdrop"><section className="chat-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-title"><header><CoachAvatar coach={coach} className="avatar" /><div><p className="eyebrow">Conversación directa</p><h2 id="chat-title">{coach.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Cerrar chat"><X /></button></header><div className="chat-messages"><div className="message incoming">Hola, cuéntame qué quieres conseguir y qué horarios tienes.</div>{sent.map((item) => <div className={`message outgoing ${item.delivery_status === 'sending' ? 'sending' : ''}`} key={item.id}>{item.body}<small>{item.delivery_status === 'sending' ? 'Enviando…' : new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>{conversationId && <Link className="chat-open-link" to={`/mensajes?conversation=${conversationId}`} onClick={onClose}>Abrir conversación completa <ArrowRight /></Link>}<form className="chat-composer" onSubmit={send}><button type="button" aria-label="Adjuntar archivo" disabled><Paperclip /></button><input aria-label="Mensaje" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe tu mensaje…" disabled={busy} /><button type="submit" aria-label="Enviar" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="spin" /> : <Send />}</button></form></section></div>
}

function Account({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [remote, setRemote] = useState<any[]>([])
  const [packages, setPackages] = useState<any[]>([])
  const local = useMemo(() => JSON.parse(localStorage.getItem('coachconnect-demo-bookings') || '[]') as LocalBooking[], [])
  useEffect(() => { if (user) { api<Profile>('/api/v1/me').then(setProfile).catch(() => undefined); api<any[]>('/api/v1/bookings').then(setRemote).catch(() => setRemote([])); api<any[]>('/api/v1/packages').then(setPackages).catch(() => setPackages([])) } }, [user])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tus reservas, en un sitio." />
  const cancelBooking = async (bookingId: string) => {
    const reason = window.prompt('¿Por qué quieres cancelar la sesión?') || ''
    try {
      await api(`/api/v1/bookings/${bookingId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
      setRemote((items) => items.map((item) => item.id === bookingId ? { ...item, status: 'cancelled' } : item))
      toast.success('Reserva cancelada. Te indicaremos si corresponde reembolso.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo cancelar') }
  }
  const reviewBooking = async (bookingId: string) => {
    const comment = window.prompt('Cuéntanos brevemente cómo fue la sesión') || ''
    try {
      await api(`/api/v1/bookings/${bookingId}/review`, { method: 'POST', body: JSON.stringify({ rating: 5, comment }) })
      toast.success('Reseña publicada')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo publicar la reseña') }
  }
  return <section className="account-screen"><div className="account-head"><div><p className="eyebrow">Área personal</p><h1>Hola, {profile?.display_name || user.email?.split('@')[0]}.</h1></div>{profile?.role === 'coach' && <Link className="login-button" to="/profesional"><LayoutDashboard /> Panel profesional</Link>}</div><div className="account-tabs"><Link className="active" to="/cuenta">Reservas</Link><Link to="/mensajes">Mensajes</Link><Link to="/profesional">Perfil profesional</Link></div><section className="booking-list"><div className="section-title"><h2>Próximas sesiones</h2><span>{remote.length + local.length} en total</span></div>{!remote.length && !local.length && <Empty title="Todavía no has reservado." copy="Encuentra a tu entrenador y elige el primer hueco que te venga bien." action={<Link className="button button-primary button-md" to="/">Buscar entrenador</Link>} />}{local.map((item) => <article className="booking-row" key={item.id}><div className="date-block"><strong>{item.startsAt.split(' · ')[0]}</strong><span>{item.startsAt.split(' · ')[1]}</span></div><div><p className="eyebrow">{item.status === 'confirmed' ? 'Confirmada · Demo' : item.status}</p><h3>{item.coachName}</h3><span>{item.serviceName}</span></div><strong>{item.amount} €</strong></article>)}{remote.map((item) => <article className="booking-row" key={item.id}><div className="date-block"><strong>{new Date(item.starts_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}</strong><span>{new Date(item.starts_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span></div><div><p className="eyebrow">{item.status}</p><h3>{item.coach_profiles?.profiles?.display_name || 'Entrenador CoachConnect'}</h3><span>{item.coach_services?.name}</span></div><strong>{item.amount_cents / 100} €</strong>{item.video_url && <a className="login-button" href={item.video_url} target="_blank" rel="noreferrer"><Video /> Entrar</a>}{['pending_payment', 'confirmed'].includes(item.status) && <button className="text-button" onClick={() => cancelBooking(item.id)}>Cancelar</button>}{item.status === 'completed' && <button className="text-button" onClick={() => reviewBooking(item.id)}>Valorar</button>}</article>)}</section>{packages.length > 0 && <section className="package-list"><div className="section-title"><h2>Mis bonos</h2></div>{packages.map((item) => <article key={item.id}><div><p className="eyebrow">{item.status}</p><h3>{item.coach_services?.name}</h3><span>{item.total_sessions - item.used_sessions} de {item.total_sessions} sesiones disponibles</span></div>{item.status === 'active' && <Link className="login-button" to={`/entrenadores/${item.coach_id}?package=${item.id}&service=${item.service_id}`}>Reservar sesión <ArrowRight /></Link>}</article>)}</section>}</section>
}

function Messages({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [search, setSearch] = useSearchParams()
  const [conversations, setConversations] = useState<any[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  useEffect(() => {
    if (!user) return
    api<any[]>('/api/v1/conversations').then((rows) => {
      setConversations(rows)
      const requested = search.get('conversation')
      setActive(rows.find((item) => item.id === requested)?.id || rows[0]?.id || null)
      setLoadError('')
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las conversaciones'))
  }, [user])
  useEffect(() => {
    if (!active) return
    setMessages([])
    api<ChatMessage[]>(`/api/v1/conversations/${active}/messages`).then((rows) => { setMessages(rows); setLoadError('') }).catch((error) => setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los mensajes'))
    const channel = supabase.channel(`conversation:${active}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${active}` }, (payload) => setMessages((current) => mergeMessage(current, payload.new as ChatMessage))).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [active])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Habla directamente con tu entrenador." />
  const chooseConversation = (id: string) => { setActive(id); setSearch({ conversation: id }, { replace: true }) }
  const send = async (event: FormEvent) => {
    event.preventDefault(); if (!active || !body.trim() || busy) return
    const text = body.trim()
    const optimisticId = `sending:${crypto.randomUUID()}`
    const optimistic: ChatMessage = { id: optimisticId, conversation_id: active, sender_id: user.id, body: text, created_at: new Date().toISOString(), delivery_status: 'sending' }
    setMessages((items) => [...items, optimistic])
    setBody('')
    setBusy(true)
    try {
      const row = await api<ChatMessage>(`/api/v1/conversations/${active}/messages`, { method: 'POST', body: JSON.stringify({ body: text }) })
      setMessages((items) => mergeMessage(items.filter((item) => item.id !== optimisticId), row))
    } catch (error) {
      setMessages((items) => items.filter((item) => item.id !== optimisticId))
      setBody(text)
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar')
    } finally { setBusy(false) }
  }
  const activeConversation = conversations.find((item) => item.id === active)
  const activeOther = activeConversation ? (activeConversation.consumer_id === user.id ? activeConversation.coach : activeConversation.consumer) : null
  const attach = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !active) return
    const path = `${active}/${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file)
    if (error) return toast.error(error.message)
    try {
      const row = await api<ChatMessage>(`/api/v1/conversations/${active}/messages`, { method: 'POST', body: JSON.stringify({ body: file.name, attachment_path: path }) })
      setMessages((items) => mergeMessage(items, row))
    } catch (apiError) { toast.error(apiError instanceof Error ? apiError.message : 'No se pudo adjuntar') }
  }
  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from('chat-files').createSignedUrl(path, 300)
    if (error) return toast.error(error.message)
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const reportConversation = async () => {
    if (!active) return
    const reason = window.prompt('Motivo de la denuncia')
    if (!reason) return
    try { await api('/api/v1/reports', { method: 'POST', body: JSON.stringify({ conversation_id: active, reason }) }); toast.success('Denuncia enviada al equipo') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo denunciar') }
  }
  const blockActiveUser = async () => {
    if (!activeOther?.id) return
    try { await api('/api/v1/blocks', { method: 'POST', body: JSON.stringify({ user_id: activeOther.id }) }); toast.success('Usuario bloqueado') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo bloquear') }
  }
  return <section className="messages-screen"><Link className="back-link messages-back" to="/cuenta"><ArrowLeft /> Volver a mi cuenta</Link><div className="messages-head"><p className="eyebrow">Mensajería privada</p><h1>Tus conversaciones.</h1></div>{loadError && <p className="inbox-error" role="alert">{loadError}</p>}<div className="inbox"><aside>{conversations.map((item) => { const other = item.consumer_id === user.id ? item.coach : item.consumer; return <button className={active === item.id ? 'active' : ''} key={item.id} onClick={() => chooseConversation(item.id)}><span className="avatar">{(other?.display_name || 'CC').slice(0, 2).toUpperCase()}</span><span><strong>{other?.display_name || 'CoachConnect'}</strong><small>Conversación segura</small></span></button> })}{!conversations.length && <p>Aún no tienes conversaciones.</p>}</aside><div className="conversation">{active && <div className="conversation-actions"><strong>{activeOther?.display_name || 'CoachConnect'}</strong><button className="text-button" onClick={reportConversation}>Denunciar</button><button className="text-button" onClick={blockActiveUser}>Bloquear</button></div>}<div className="chat-messages">{messages.map((item) => <div className={`message ${item.sender_id === user.id ? 'outgoing' : 'incoming'} ${item.delivery_status === 'sending' ? 'sending' : ''}`} key={item.id}>{item.body}{item.attachment_path && <button className="attachment-link" onClick={() => openAttachment(item.attachment_path || '')}><Paperclip /> Abrir archivo</button>}<small>{item.delivery_status === 'sending' ? 'Enviando…' : new Date(item.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div>{active && <form className="chat-composer" onSubmit={send}><label className="attachment-button" aria-label="Adjuntar archivo"><Paperclip /><input type="file" accept=".pdf,image/jpeg,image/png,image/webp" onChange={attach} /></label><input aria-label="Mensaje" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escribe un mensaje…" disabled={busy} /><button type="submit" aria-label="Enviar" disabled={busy || !body.trim()}>{busy ? <LoaderCircle className="spin" /> : <Send />}</button></form>}</div></div></section>
}

function Notifications({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [items, setItems] = useState<any[]>([])
  useEffect(() => {
    if (!user) return
    api<any[]>('/api/v1/notifications').then(setItems).catch(() => undefined)
    const channel = supabase.channel(`notifications:${user.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => setItems((current) => [payload.new, ...current])).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [user])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tus avisos importantes, sin ruido." />
  const open = async (item: any) => {
    if (!item.read_at) {
      await api(`/api/v1/notifications/${item.id}/read`, { method: 'PATCH' })
      setItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, read_at: new Date().toISOString() } : currentItem))
    }
    if (item.action_url) window.location.assign(item.action_url)
  }
  return <section className="account-screen"><div className="account-head"><div><p className="eyebrow">Actividad</p><h1>Notificaciones.</h1></div></div><div className="notification-list">{items.map((item) => <button key={item.id} className={item.read_at ? 'read' : 'unread'} onClick={() => open(item)}><Bell /><span><strong>{item.title}</strong><small>{item.body}</small></span><time>{new Date(item.created_at).toLocaleString('es-ES')}</time></button>)}{!items.length && <Empty title="Todo al día." copy="Aquí aparecerán mensajes, reservas y cambios importantes." />}</div></section>
}

function ProPortal({ onAuth }: { onAuth: () => void }) {
  const { user, loading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState('overview')
  useEffect(() => { if (user) api<Profile>('/api/v1/me').then(setProfile).catch(() => undefined) }, [user])
  if (loading) return <LoadingPage />
  if (!user) return <AuthRequired onAuth={onAuth} title="Tu trabajo. Sin perseguir al algoritmo." coach />
  return <section className="pro-screen"><div className="pro-header"><div><p className="eyebrow">CoachConnect para profesionales</p><h1>Tu trabajo.<br /><em>Bien visible.</em></h1></div><Link className="back-link" to="/"><ArrowLeft /> Volver a la web</Link></div><div className="pro-shell"><aside className="pro-sidebar"><div className="pro-user"><div className="avatar">{(profile?.display_name || user.email || 'CC').slice(0, 2).toUpperCase()}</div><div><strong>{profile?.display_name || user.email}</strong><span>{profile?.role === 'coach' ? 'Perfil profesional' : 'Completa tu alta'}</span></div></div>{[['overview', 'Resumen'], ['profile', 'Perfil'], ['services', 'Servicios'], ['availability', 'Agenda'], ['validation', 'Validación'], ['integrations', 'Pagos y vídeo']].map(([key, label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}<div className="pro-sidebar-foot"><ShieldCheck /> Datos protegidos</div></aside><div className="pro-content">{tab === 'overview' && <ProOverview profile={profile} />}{tab === 'profile' && <CoachOnboarding onSaved={() => api<Profile>('/api/v1/me').then(setProfile)} />}{tab === 'services' && <ServicesForm />}{tab === 'availability' && <AvailabilityForm />}{tab === 'validation' && <CredentialForm userId={user.id} />}{tab === 'integrations' && <Integrations />}</div></div></section>
}

function ProOverview({ profile }: { profile: Profile | null }) {
  return <><div className="pro-content-head"><div><p className="eyebrow">Vista general</p><h2>{profile?.role === 'coach' ? 'Todo bajo control.' : 'Empieza por tu perfil.'}</h2></div><span className="status-pill"><span className="live-dot" /> Configuración activa</span></div><div className="metric-grid"><div><span>Visitas al perfil</span><strong>—</strong><small>Empezarán al publicar</small></div><div><span>Próximas sesiones</span><strong>0</strong><small>Agenda sincronizada</small></div><div><span>Ingresos netos</span><strong>0 €</strong><small>Comisión: 15 %</small></div></div><div className="pro-panels"><div className="pro-panel schedule-panel"><div className="panel-heading"><div><p className="eyebrow">Siguientes pasos</p><h3>Publica con confianza</h3></div></div>{['Completa tu perfil y especialidad', 'Añade un servicio con precio', 'Configura tu disponibilidad', 'Sube tu título para revisión', 'Conecta Stripe y videollamada'].map((item, index) => <div className="schedule-row" key={item}><span className="schedule-day">0{index + 1}</span><div><strong>{item}</strong><small>Se guarda en tu cuenta</small></div><Check /></div>)}</div><div className="pro-panel profile-progress"><div className="progress-ring"><strong>{profile?.role === 'coach' ? '40%' : '10%'}</strong><span>perfil</span></div><div><p className="eyebrow">Tu escaparate</p><h3>Directo y verificable.</h3><p>No necesitas crear contenido diario. Explica lo que haces, cuándo puedes y cuánto cuesta.</p></div></div></div></>
}

function CoachOnboarding({ onSaved }: { onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<any | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { api('/api/v1/coach/profile').then(setCurrent).catch(() => undefined).finally(() => setLoaded(true)) }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy(true); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form); const payload = { ...values, years_experience: Number(values.years_experience), languages: String(values.languages_text || 'es').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) }; delete (payload as Record<string, unknown>).languages_text; try { await api('/api/v1/coach/onboarding', { method: 'POST', body: JSON.stringify(payload) }); toast.success('Perfil profesional guardado'); onSaved() } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') } finally { setBusy(false) } }
  if (!loaded) return <LoadingBlock label="Cargando tu perfil" />
  return <ProForm title="Perfil profesional" intro="Lo esencial para que un consumidor entienda en segundos si encajas." onSubmit={submit}><label>Nombre visible<input name="display_name" required minLength={2} defaultValue={current?.profiles?.display_name || ''} /></label><label>Titular profesional<input name="headline" required minLength={5} placeholder="Fuerza y movilidad sin complicaciones" defaultValue={current?.headline || ''} /></label><label className="wide">Sobre tu método<textarea name="bio" required minLength={20} rows={5} defaultValue={current?.bio || ''} /></label><label>Ciudad<input name="city" required defaultValue={current?.city || ''} /></label><label>Modalidad<select name="mode" defaultValue={current?.mode || 'hibrido'}><option value="hibrido">Online y presencial</option><option value="online">Online</option><option value="presencial">Presencial</option></select></label><label>Años de experiencia<input name="years_experience" type="number" min="0" defaultValue={current?.years_experience || 0} /></label><label>Idiomas<input name="languages_text" defaultValue={(current?.languages || ['es']).join(', ')} placeholder="es, en" /></label><Button type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" />} Guardar perfil</Button></ProForm>
}

function ServicesForm() {
  const [services, setServices] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])
  useEffect(() => { api<any[]>('/api/v1/coach/services').then(setServices).catch(() => undefined); hasSupabase && supabase.from('categories').select('id,name_es').not('parent_id', 'is', null).then(({ data }) => setCatalog(data || [])) }, [])
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { category_id: form.get('category_id'), name: form.get('name'), description: form.get('description'), mode: form.get('mode'), duration_minutes: Number(form.get('duration_minutes')), price_cents: Math.round(Number(form.get('price')) * 100), package_size: Number(form.get('package_size')) }; try { const item = await api('/api/v1/coach/services', { method: 'POST', body: JSON.stringify(payload) }); setServices((items) => [...items, item]); event.currentTarget.reset(); toast.success('Servicio añadido') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') } }
  const remove = async (id: string) => { try { await api(`/api/v1/coach/services/${id}`, { method: 'DELETE' }); setServices((items) => items.filter((item) => item.id !== id)); toast.success('Servicio desactivado') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo desactivar') } }
  return <><ProForm title="Servicios y precios" intro="Una sesión individual o un bono. Sin letra pequeña." onSubmit={submit}><label>Especialidad<select name="category_id" required><option value="">Selecciona</option>{catalog.map((item) => <option value={item.id} key={item.id}>{item.name_es}</option>)}</select></label><label>Nombre<input name="name" required /></label><label>Modalidad<select name="mode"><option value="online">Online</option><option value="presencial">Presencial</option><option value="hibrido">Híbrido</option></select></label><label>Duración (min)<input name="duration_minutes" type="number" min="20" defaultValue="60" /></label><label>Precio (€)<input name="price" type="number" min="5" step="0.01" required /></label><label>Sesiones del bono<input name="package_size" type="number" min="1" defaultValue="1" /></label><label className="wide">Descripción<textarea name="description" rows={3} /></label><Button type="submit">Añadir servicio</Button></ProForm><div className="compact-list">{services.map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.duration_minutes} min · {item.price_cents / 100} €</span><button className="text-button" onClick={() => remove(item.id)}>Desactivar</button></div>)}</div></>
}

function AvailabilityForm() {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
  const [active, setActive] = useState<number[]>([0, 1, 2, 3, 4])
  const [startsAt, setStartsAt] = useState('09:00')
  const [endsAt, setEndsAt] = useState('19:00')
  const [exceptions, setExceptions] = useState<any[]>([])
  const [respondsNow, setRespondsNow] = useState(false)
  useEffect(() => {
    api<{ rules: any[]; exceptions: any[] }>('/api/v1/coach/availability').then((data) => {
      if (data.rules.length) {
        setActive(data.rules.map((item) => item.weekday))
        setStartsAt(data.rules[0].starts_at.slice(0, 5))
        setEndsAt(data.rules[0].ends_at.slice(0, 5))
      }
      setExceptions(data.exceptions)
    }).catch(() => undefined)
    api<any>('/api/v1/coach/profile').then((profile) => setRespondsNow(profile.responds_now)).catch(() => undefined)
  }, [])
  const save = async () => { const rules = active.map((weekday) => ({ weekday, starts_at: startsAt, ends_at: endsAt, timezone: 'Europe/Madrid' })); try { await api('/api/v1/coach/availability', { method: 'PUT', body: JSON.stringify(rules) }); toast.success('Disponibilidad actualizada') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') } }
  const addException = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); try { const item = await api('/api/v1/coach/availability/exceptions', { method: 'POST', body: JSON.stringify({ starts_at: new Date(String(form.get('starts_at'))).toISOString(), ends_at: new Date(String(form.get('ends_at'))).toISOString(), available: false, label: form.get('label') }) }); setExceptions((current) => [...current, item]); event.currentTarget.reset(); toast.success('Bloqueo añadido') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo añadir') } }
  const toggleRespondsNow = async () => { const enabled = !respondsNow; try { await api('/api/v1/coach/responds-now', { method: 'PATCH', body: JSON.stringify({ enabled }) }); setRespondsNow(enabled) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo actualizar') } }
  return <section><div className="section-title"><div><p className="eyebrow">Agenda recurrente</p><h2 className="form-title">Cuándo puedes entrenar.</h2></div><button className={`status-toggle ${respondsNow ? 'active' : ''}`} onClick={toggleRespondsNow}><span className="live-dot" /> {respondsNow ? 'Respondo ahora' : 'Activar Responde ahora'}</button></div><p className="form-intro">Activa tus días habituales y define tu franja. Los bloqueos tienen prioridad sobre esta regla.</p><div className="time-range"><label>Desde<input type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label>Hasta<input type="time" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label></div><div className="day-grid">{days.map((day, index) => <button className={active.includes(index) ? 'active' : ''} onClick={() => setActive((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])} key={day}><span>{day.slice(0, 3)}</span><strong>{startsAt}—{endsAt}</strong><Check /></button>)}</div><Button onClick={save}>Guardar disponibilidad</Button><form className="exception-form" onSubmit={addException}><h3>Vacaciones y bloqueos</h3><label>Desde<input name="starts_at" type="datetime-local" required /></label><label>Hasta<input name="ends_at" type="datetime-local" required /></label><label>Motivo<input name="label" placeholder="Vacaciones" /></label><Button type="submit">Añadir bloqueo</Button></form><div className="compact-list">{exceptions.map((item) => <div key={item.id}><strong>{item.label || 'Bloqueo'}</strong><span>{new Date(item.starts_at).toLocaleString('es-ES')} — {new Date(item.ends_at).toLocaleString('es-ES')}</span></div>)}</div></section>
}

function CredentialForm({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false)
  const [videoBusy, setVideoBusy] = useState(false)
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const { error } = await supabase.storage.from('credentials').upload(path, file); if (error) { toast.error(error.message); setBusy(false); return } try { await api('/api/v1/coach/credentials', { method: 'POST', body: JSON.stringify({ title: file.name, kind: 'qualification', storage_path: path }) }); toast.success('Título enviado para revisión manual') } catch (apiError) { toast.error(apiError instanceof Error ? apiError.message : 'No se pudo registrar') } finally { setBusy(false) } }
  const uploadVideo = async (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; setVideoBusy(true); const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const { error } = await supabase.storage.from('coach-videos').upload(path, file); if (error) { toast.error(error.message); setVideoBusy(false); return } try { await api('/api/v1/coach/video', { method: 'POST', body: JSON.stringify({ storage_path: path }) }); toast.success('Vídeo enviado para revisión') } catch (apiError) { toast.error(apiError instanceof Error ? apiError.message : 'No se pudo registrar el vídeo') } finally { setVideoBusy(false) } }
  return <section className="credential-panel"><div className="coming-icon"><FileCheck2 /></div><p className="eyebrow">Doble validación</p><h2 className="form-title">Acredita lo que haces.</h2><p className="form-intro">Primero comprobamos que has aportado un título. Después, el equipo de CoachConnect lo revisa manualmente. Los archivos son privados.</p><label className="upload-box"><Upload /><strong>{busy ? 'Subiendo…' : 'Subir título o acreditación'}</strong><span>PDF, JPG o PNG · máximo 10 MB</span><input type="file" accept=".pdf,image/jpeg,image/png" onChange={upload} disabled={busy} /></label><label className="upload-box video-upload"><Video /><strong>{videoBusy ? 'Subiendo vídeo…' : 'Añadir vídeo promocional opcional'}</strong><span>MP4 o WebM · revisión manual antes de publicar</span><input type="file" accept="video/mp4,video/webm" onChange={uploadVideo} disabled={videoBusy} /></label></section>
}

function Integrations() {
  const [status, setStatus] = useState<{ stripe: boolean; providers: string[]; custom_video_url?: string }>({ stripe: false, providers: [] })
  useEffect(() => { api<{ stripe: boolean; providers: string[]; custom_video_url?: string }>('/api/v1/coach/integrations').then(setStatus).catch(() => undefined) }, [])
  const connect = async (provider: 'google' | 'zoom') => { try { const result = await api<{ url: string }>(`/api/v1/integrations/${provider}/oauth-url`); window.location.assign(result.url) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo conectar') } }
  const stripeConnect = async () => { try { const result = await api<{ url: string }>('/api/v1/stripe/connect', { method: 'POST' }); window.location.assign(result.url) } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo conectar Stripe') } }
  const saveCustom = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const url = String(new FormData(event.currentTarget).get('url')); try { await api('/api/v1/coach/custom-video-link', { method: 'PUT', body: JSON.stringify({ url }) }); setStatus((current) => ({ ...current, custom_video_url: url })); toast.success('Enlace guardado') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') } }
  return <section><p className="eyebrow">Pagos y videollamadas</p><h2 className="form-title">Conecta una vez.</h2><p className="form-intro">CoachConnect organiza la reserva. La sesión se celebra en la herramienta que ya conoces.</p><div className="integration-grid"><button onClick={stripeConnect}><CreditCard /><span><strong>Stripe Connect</strong><small>{status.stripe ? 'Conectado' : 'Recibe pagos y consulta tus ingresos'}</small></span>{status.stripe ? <Check /> : <ArrowRight />}</button><button onClick={() => connect('google')}><Globe2 /><span><strong>Google Meet</strong><small>{status.providers.includes('google') ? 'Conectado' : 'Crea enlaces desde Calendar'}</small></span>{status.providers.includes('google') ? <Check /> : <ArrowRight />}</button><button onClick={() => connect('zoom')}><Video /><span><strong>Zoom</strong><small>{status.providers.includes('zoom') ? 'Conectado' : 'Crea reuniones automáticamente'}</small></span>{status.providers.includes('zoom') ? <Check /> : <ArrowRight />}</button></div><form className="custom-link-form" onSubmit={saveCustom}><label>Enlace personalizado HTTPS<input name="url" type="url" pattern="https://.*" defaultValue={status.custom_video_url || ''} placeholder="https://…" /></label><Button type="submit">Guardar enlace</Button></form></section>
}

function ProForm({ title, intro, onSubmit, children }: { title: string; intro: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: React.ReactNode }) {
  return <form className="pro-form" onSubmit={onSubmit}><p className="eyebrow">Configuración</p><h2 className="form-title">{title}</h2><p className="form-intro">{intro}</p><div className="form-grid">{children}</div></form>
}

function Admin() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [docs, setDocs] = useState<any[]>([])
  const [videos, setVideos] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [tab, setTab] = useState('validation')
  useEffect(() => {
    if (!user) return
    api<Profile>('/api/v1/me').then((item) => {
      setProfile(item)
      if (item.role !== 'admin') return
      void Promise.all([
        api<any[]>('/api/v1/admin/credentials').then(setDocs),
        api<any[]>('/api/v1/admin/videos').then(setVideos),
        api<any[]>('/api/v1/admin/reports').then(setReports),
        api<any[]>('/api/v1/admin/categories').then(setCatalog),
        api<any[]>('/api/v1/admin/bookings').then(setBookings),
        api<any[]>('/api/v1/admin/payments').then(setPayments),
      ])
    }).catch(() => undefined)
  }, [user])
  if (!user || profile?.role !== 'admin') return <section className="access-denied"><ShieldCheck /><h1>Área de operaciones.</h1><p>Solo las cuentas administradoras pueden revisar títulos y validar entrenadores.</p></section>
  const openPrivate = async (path: string) => { try { const result = await api<{ url: string }>(path); window.open(result.url, '_blank', 'noopener,noreferrer') } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo abrir') } }
  const reviewCoach = async (coachId: string, status: 'verified' | 'rejected') => { await api(`/api/v1/admin/coaches/${coachId}/verification`, { method: 'PATCH', body: JSON.stringify({ status, note: status === 'verified' ? 'Documentación revisada' : 'Revisar documentación' }) }); setDocs((items) => items.filter((item) => item.coach_id !== coachId)); toast.success(status === 'verified' ? 'Entrenador verificado' : 'Documentación rechazada') }
  const reviewVideo = async (coachId: string, status: 'approved' | 'rejected') => { await api(`/api/v1/admin/videos/${coachId}`, { method: 'PATCH', body: JSON.stringify({ status, note: '' }) }); setVideos((items) => items.filter((item) => item.user_id !== coachId)) }
  const resolveReport = async (id: string) => { await api(`/api/v1/admin/reports/${id}?status_value=resolved`, { method: 'PATCH' }); setReports((items) => items.filter((item) => item.id !== id)) }
  const createCategory = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = { slug: form.get('slug'), name_es: form.get('name_es'), name_en: form.get('name_en'), sort_order: Number(form.get('sort_order')), active: true }; try { const row = await api('/api/v1/admin/categories', { method: 'POST', body: JSON.stringify(payload) }); setCatalog((items) => [...items, row]); event.currentTarget.reset() } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo crear') } }
  return <section className="admin-screen"><p className="eyebrow">CoachConnect Ops</p><h1>Operaciones.</h1><div className="admin-tabs">{[['validation', 'Validación'], ['moderation', 'Moderación'], ['catalog', 'Taxonomía'], ['matching', 'Matching'], ['business', 'Reservas y pagos']].map(([key, label]) => <button className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}>{label}</button>)}</div>{tab === 'validation' && <><h2>Documentación profesional</h2><div className="admin-list">{docs.map((item) => <article key={item.id}><FileCheck2 /><div><strong>{item.title}</strong><span>{item.status} · {new Date(item.created_at).toLocaleDateString('es-ES')}</span></div><div><button onClick={() => openPrivate(`/api/v1/admin/credentials/${item.id}/download`)}>Abrir</button><button onClick={() => reviewCoach(item.coach_id, 'verified')}>Aprobar</button><button onClick={() => reviewCoach(item.coach_id, 'rejected')}>Rechazar</button></div></article>)}</div><h2>Vídeos pendientes</h2><div className="admin-list">{videos.map((item) => <article key={item.user_id}><Video /><div><strong>{item.profiles?.display_name || 'Entrenador'}</strong><span>Vídeo promocional pendiente</span></div><div><button onClick={() => openPrivate(`/api/v1/admin/videos/${item.user_id}/download`)}>Abrir</button><button onClick={() => reviewVideo(item.user_id, 'approved')}>Aprobar</button><button onClick={() => reviewVideo(item.user_id, 'rejected')}>Rechazar</button></div></article>)}</div></>}{tab === 'moderation' && <div className="admin-list">{reports.map((item) => <article key={item.id}><ShieldCheck /><div><strong>{item.reason}</strong><span>{item.details || 'Sin detalle'} · {item.status}</span></div><div><button onClick={() => resolveReport(item.id)}>Resolver</button></div></article>)}</div>}{tab === 'catalog' && <><form className="admin-form" onSubmit={createCategory}><input name="slug" placeholder="slug" required /><input name="name_es" placeholder="Nombre ES" required /><input name="name_en" placeholder="Name EN" required /><input name="sort_order" type="number" defaultValue="100" /><Button type="submit">Crear categoría</Button></form><div className="compact-list">{catalog.map((item) => <div key={item.id}><strong>{item.name_es}</strong><span>{item.name_en} · {item.slug}</span></div>)}</div></>}{tab === 'matching' && <><h2>Orden de matching</h2><div className="compact-list">{['1. Especialidad', '2. Zona indicada', '3. Valoraciones', '4. Rapidez de respuesta'].map((criterion) => <div key={criterion}><strong>{criterion}</strong><span>Prioridad fija</span></div>)}</div></>}{tab === 'business' && <div className="metric-grid"><div><span>Reservas</span><strong>{bookings.length}</strong><small>{bookings.filter((item) => item.status === 'confirmed').length} confirmadas</small></div><div><span>Volumen pagado</span><strong>{(payments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount_cents, 0) / 100).toFixed(0)} €</strong><small>{payments.length} pagos</small></div><div><span>Comisión</span><strong>{(payments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.platform_fee_cents, 0) / 100).toFixed(0)} €</strong><small>Ingresos de plataforma</small></div></div>}</section>
}

function AuthRequired({ onAuth, title, coach = false }: { onAuth: () => void; title: string; coach?: boolean }) {
  return <section className="auth-required"><div className="coming-icon">{coach ? <Zap /> : <UserRound />}</div><p className="eyebrow">Acceso necesario</p><h1>{title}</h1><p>Crea tu cuenta o entra para guardar tus datos de forma segura y continuar donde lo dejaste.</p><Button onClick={onAuth}>Entrar o crear cuenta <ArrowRight /></Button></section>
}

function Empty({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <div className="empty-state"><Sparkles /><h2>{title}</h2><p>{copy}</p>{action}</div> }
function LoadingBlock({ label }: { label: string }) { return <div className="loading-block"><LoaderCircle className="spin" /><span>{label}</span></div> }
function LoadingPage() { return <section className="loading-page"><LoaderCircle className="spin" /><span>Preparando tu espacio</span></section> }
function NotFound() { return <section className="auth-required"><h1>No encontramos ese entrenador.</h1><Link className="button button-primary button-md" to="/">Volver al inicio</Link></section> }

function Footer() { return <footer className="footer"><span>© 2026 CoachConnect</span><div className="footer-links"><Link to="/profesional">Entrenadores</Link><Link to="/admin">Administración</Link><button onClick={() => toast.info('Legal y privacidad estarán disponibles antes del lanzamiento público.')}>Privacidad</button><button onClick={() => toast.info('Escríbenos a soporte@coachconnect.es')}>Ayuda</button></div><span>Hecho para entrenar, no para hacer scroll.</span></footer> }

export default App
