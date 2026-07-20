import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Clock3, Globe2, HelpCircle, MapPin, MessageCircle, ShieldCheck, Sparkles, Star, UserRound, X, Zap } from 'lucide-react'
import { Button } from './components/ui/button'
import { categories, coaches, type Category, type Coach, type Mode } from './data'

type Screen = 'home' | 'results' | 'profile' | 'pro'

const answerLabels: Record<string, string> = { goal: 'Objetivo', mode: 'Modalidad', time: 'Horario', city: 'Zona' }

function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [step, setStep] = useState(0)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [toast, setToast] = useState('')

  const begin = (category: Category) => { setSelectedCategory(category); setAnswers({ category: category.label }); setStep(1) }
  const answer = (key: string, value: string) => { setAnswers((current) => ({ ...current, [key]: value })); setStep((current) => current + 1) }
  const finish = () => { setScreen('results'); setStep(0) }
  const openCoach = (coach: Coach) => { setSelectedCoach(coach); setScreen('profile') }
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000) }

  return <div className="app-shell">
    <Header screen={screen} onHome={() => { setScreen('home'); setStep(0) }} onPro={() => setScreen('pro')} onLogin={() => setShowLogin(true)} />
    <main>
      {screen === 'home' && <Home step={step} category={selectedCategory} onBegin={begin} onAnswer={answer} onBack={() => setStep(Math.max(0, step - 1))} onFinish={finish} />}
      {screen === 'results' && <Results answers={answers} onBack={() => setScreen('home')} onCoach={openCoach} />}
      {screen === 'profile' && selectedCoach && <Profile coach={selectedCoach} onBack={() => setScreen('results')} onNotify={notify} />}
      {screen === 'pro' && <ProPortal onBack={() => setScreen('home')} onNotify={notify} />}
    </main>
    <Footer onPro={() => setScreen('pro')} onNotify={notify} />
    {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
  </div>
}

function Header({ screen, onHome, onPro, onLogin }: { screen: Screen; onHome: () => void; onPro: () => void; onLogin: () => void }) {
  return <header className="topbar">
    <button className="brand" onClick={onHome} aria-label="Volver a CoachConnect"><span className="brand-mark"><span /></span><span>Coach<span className="brand-link">Connect</span></span></button>
    <div className="top-actions">
      <button className="text-button subtle" onClick={onPro}>¿Eres entrenador?</button>
      <button className="login-button" onClick={onLogin}><UserRound size={16} /> Entrar</button>
    </div>
  </header>
}

function Home({ step, category, onBegin, onAnswer, onBack, onFinish }: { step: number; category: Category | null; onBegin: (category: Category) => void; onAnswer: (key: string, value: string) => void; onBack: () => void; onFinish: () => void }) {
  if (step === 0) return <section className="hero-screen" aria-labelledby="home-title">
    <div className="hero-grid" />
    <div className="hero-copy">
      <p className="eyebrow"><span className="live-dot" /> Entrenadores que encajan contigo</p>
      <h1 id="home-title">Encuentra<br /><em>tu próximo</em><br />entrenador.</h1>
      <p className="hero-deck">Deporte, objetivos y horarios reales. Te acercamos a la persona adecuada para empezar hoy.</p>
      <div className="hero-cta-row"><Button size="lg" onClick={() => document.getElementById('category-selector')?.scrollIntoView({ behavior: 'smooth' })}>Encontrar entrenador <ArrowRight size={18} /></Button><span className="quiet-note"><ShieldCheck size={15} /> Profesionales verificados</span></div>
    </div>
    <div className="hero-number" aria-hidden="true">01<span>/04</span></div>
    <div className="category-dock" id="category-selector">
      <div className="dock-heading"><span>01</span><strong>¿Qué quieres entrenar?</strong><small>Elige una especialidad para empezar.</small></div>
      <div className="category-grid">{categories.map((item) => <button key={item.id} className={`category-tile tile-${item.accent}`} onClick={() => onBegin(item)}><span className="tile-kicker">{item.kicker}</span><strong>{item.label}</strong><ArrowUpRight /></button>)}</div>
    </div>
  </section>

  return <section className="question-screen" aria-labelledby="question-title">
    <div className="question-progress"><span>02 — Afinemos la búsqueda</span><div><i style={{ width: `${Math.min(100, (step / 5) * 100)}%` }} /></div><b>{String(Math.min(step, 5)).padStart(2, '0')}<small>/05</small></b></div>
    <div className="question-wrap">
      <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Atrás</button>
      <p className="eyebrow">{category?.label}</p>
      {step === 1 && <Question title="¿Qué quieres conseguir?" options={['Ganar fuerza', 'Perder peso', 'Moverme mejor', 'Prepararme para competir']} onSelect={(value) => onAnswer('goal', value)} />}
      {step === 2 && <Question title="¿Cómo quieres entrenar?" options={['Online', 'Presencial', 'Me da igual']} onSelect={(value) => onAnswer('mode', value)} />}
      {step === 3 && <Question title="¿Cuándo te viene bien?" options={['Responde ahora', 'Esta semana', 'Flexible']} onSelect={(value) => onAnswer('time', value)} />}
      {step === 4 && <Question title="¿Dónde estás?" options={['Madrid', 'Barcelona', 'Valencia', 'En cualquier sitio si es online']} onSelect={(value) => onAnswer('city', value)} />}
      {step === 5 && <div className="final-question"><p className="eyebrow">Casi listo</p><h2 id="question-title">¿Qué pesa más para ti?</h2><p className="question-intro">Usaremos tu respuesta para ordenar los resultados, no para encerrarte en un filtro.</p><div className="option-list">{['La mejor coincidencia', 'Que responda ahora', 'La experiencia y las reseñas', 'El precio'].map((option, index) => <button key={option} className="option-card" onClick={onFinish}><span>0{index + 1}</span><strong>{option}</strong><ArrowRight size={18} /></button>)}</div></div>}
    </div>
  </section>
}

function Question({ title, options, onSelect }: { title: string; options: string[]; onSelect: (value: string) => void }) {
  return <div className="question-content"><p className="eyebrow">Una respuesta rápida</p><h2 id="question-title">{title}</h2><div className="option-list">{options.map((option, index) => <button key={option} className="option-card" onClick={() => onSelect(option)}><span>0{index + 1}</span><strong>{option}</strong><ArrowRight size={18} /></button>)}</div></div>
}

function Results({ answers, onBack, onCoach }: { answers: Record<string, string>; onBack: () => void; onCoach: (coach: Coach) => void }) {
  const [mode, setMode] = useState<'all' | 'online' | 'presencial'>('all')
  const [sort, setSort] = useState('match')
  const [mapOpen, setMapOpen] = useState(false)
  const shown = useMemo(() => {
    const selectedCategoryId = categories.find((category) => category.label === answers.category)?.id
    const compatibleMode = coaches.filter((coach) => mode === 'all' || coach.mode === mode || coach.mode === 'hibrido')
    const exactMatches = selectedCategoryId ? compatibleMode.filter((coach) => coach.category === selectedCategoryId) : compatibleMode
    const filtered = exactMatches.length > 0 ? exactMatches : compatibleMode
    return [...filtered].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating
      if (sort === 'price') return a.price - b.price
      if (sort === 'availability') return Number(b.onlineNow) - Number(a.onlineNow) || b.rating - a.rating
      const score = (coach: Coach) => Number(coach.category === selectedCategoryId) * 65 + Number(coach.onlineNow) * 10 + coach.rating
      return score(b) - score(a)
    })
  }, [answers.category, mode, sort])
  return <section className="results-screen"><div className="results-head"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Cambiar búsqueda</button><div className="results-title"><div><p className="eyebrow">Tu búsqueda</p><h1>{answers.category || 'Entrenadores'}<span> que encajan contigo.</span></h1></div><div className="result-count"><strong>{shown.length}</strong><small>{shown.length === 1 ? <>coincidencia<br />encontrada</> : <>coincidencias<br />encontradas</>}</small></div></div><div className="answer-pills">{Object.entries(answers).filter(([key]) => answerLabels[key] || key === 'category').map(([key, value]) => <span key={key}><b>{answerLabels[key] || 'Especialidad'}</b>{value}</span>)}</div></div><div className="results-toolbar"><div className="mode-tabs">{[['all', 'Todos'], ['online', 'Online'], ['presencial', 'Presencial']].map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value as typeof mode)}>{label}</button>)}</div><div className="toolbar-right"><label className="select-wrap"><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="match">Mejor coincidencia</option><option value="availability">Disponibilidad</option><option value="rating">Reputación</option><option value="price">Precio</option></select><ChevronDown size={15} /></label><button className={`map-toggle ${mapOpen ? 'active' : ''}`} onClick={() => setMapOpen(!mapOpen)}><MapPin size={16} /> {mapOpen ? 'Ocultar mapa' : 'Ver mapa'}</button></div></div><div className={`results-layout ${mapOpen ? 'with-map' : ''}`}><div className="coach-list">{shown.map((coach, index) => <CoachCard key={coach.id} coach={coach} rank={index + 1} onClick={() => onCoach(coach)} />)}{shown.length === 0 && <div className="empty-state"><Sparkles /><h2>Podemos abrir un poco la búsqueda.</h2><p>Prueba con otra modalidad o elimina el filtro de zona.</p></div>}</div>{mapOpen && <FakeMap coaches={shown} />}</div></section>
}

function CoachCard({ coach, rank, onClick }: { coach: Coach; rank: number; onClick: () => void }) {
  return <article className="coach-card" onClick={onClick} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && onClick()}><div className={`avatar avatar-${rank}`}>{coach.initials}</div><div className="coach-main"><div className="coach-card-top"><div><p className="coach-specialty">{coach.specialty}</p><h2>{coach.name}</h2></div><div className="rating"><Star size={15} fill="currentColor" /> <strong>{coach.rating}</strong><span>({coach.reviews})</span></div></div><p className="coach-bio">{coach.bio}</p><div className="coach-meta"><span><MapPin size={14} /> {coach.city}</span><span><Clock3 size={14} /> {coach.nextSlot}</span><span className={coach.onlineNow ? 'is-live' : ''}><Zap size={14} /> {coach.onlineNow ? 'Responde ahora' : coach.response}</span></div><div className="coach-card-bottom"><div className="tag-row">{coach.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}</div><strong className="price-from">Desde {coach.price}€ <small>/ sesión</small></strong></div></div><ArrowRight className="card-arrow" size={20} /></article>
}

function FakeMap({ coaches: shown }: { coaches: Coach[] }) {
  return <aside className="map-panel"><div className="map-label"><MapPin size={15} /> Resultados aproximados</div><div className="map-grid" />{shown.map((coach, index) => <button className={`map-pin pin-${index + 1}`} key={coach.id} title={coach.name} onClick={() => undefined}><span>{coach.initials}</span></button>)}<div className="map-attribution">© OpenStreetMap contributors · Ubicaciones aproximadas</div></aside>
}

function Profile({ coach, onBack, onNotify }: { coach: Coach; onBack: () => void; onNotify: (message: string) => void }) {
  const [service, setService] = useState(coach.services[0])
  const [booked, setBooked] = useState(false)
  return <section className="profile-screen"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Volver a resultados</button><div className="profile-hero"><div className={`profile-avatar avatar-${coach.id.length % 4 + 1}`}>{coach.initials}</div><div className="profile-title"><div className="profile-title-line"><p className="eyebrow">{coach.category === 'martial' ? 'Artes marciales' : 'Coach verificado'}</p>{coach.onlineNow && <span className="live-badge"><span className="live-dot" /> Responde ahora</span>}</div><h1>{coach.name}</h1><p>{coach.specialty} · {coach.city} · {coach.mode === 'online' ? 'Online' : coach.mode === 'presencial' ? 'Presencial' : 'Online y presencial'}</p><div className="profile-rating"><Star size={18} fill="currentColor" /><strong>{coach.rating}</strong><span>{coach.reviews} reseñas verificadas</span><span className="verified-copy"><ShieldCheck size={16} /> Documentación revisada</span></div></div><button className="share-button" onClick={() => onNotify('Enlace de perfil copiado')} aria-label="Compartir perfil"><Sparkles size={17} /></button></div><div className="profile-grid"><div className="profile-details"><section className="profile-block"><p className="eyebrow">Su forma de trabajar</p><p className="profile-bio">{coach.bio}</p><div className="tag-row large">{coach.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section><section className="profile-block"><div className="section-title"><p className="eyebrow">Lo que puedes reservar</p><span>Precios claros, sin sorpresas</span></div><div className="service-list">{coach.services.map((item) => <button className={`service-row ${service.name === item.name ? 'selected' : ''}`} key={item.name} onClick={() => setService(item)}><span className="service-radio">{service.name === item.name && <Check size={14} />}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span><b>{item.price}€</b></button>)}</div></section><section className="profile-block review-highlight"><div><p className="eyebrow">Última reseña</p><p>“Directo, atento y con un plan que por fin puedo mantener.”</p><span>— Cliente verificado · hace 3 días</span></div><Star size={30} fill="currentColor" /></section></div><aside className="booking-card"><div className="booking-card-top"><span className="eyebrow">Reserva tu primera sesión</span><strong>{service.price}€</strong><small>{service.detail}</small></div><div className="calendar-heading"><CalendarDays size={17} /><strong>Próximos huecos</strong></div><div className="slot-grid">{['Hoy · 18:30', 'Hoy · 20:00', 'Mañana · 09:00', 'Jueves · 17:30'].map((slot, index) => <button className={index === 0 ? 'selected' : ''} key={slot}>{slot}</button>)}</div><Button className="full-button" onClick={() => { setBooked(true); onNotify('Reserva preparada · conecta tu cuenta para pagar') }}>{booked ? <><Check size={17} /> Reserva preparada</> : <>Continuar con la reserva <ArrowRight size={17} /></>}</Button><button className="chat-cta" onClick={() => onNotify(`Mensaje iniciado con ${coach.name}`)}><MessageCircle size={17} /> Escribir antes de reservar</button><p className="booking-note"><ShieldCheck size={14} /> Pago protegido · cancelación gratuita hasta 24 h antes</p></aside></div></section>
}

function ProPortal({ onBack, onNotify }: { onBack: () => void; onNotify: (message: string) => void }) {
  const [tab, setTab] = useState('overview')
  return <section className="pro-screen"><div className="pro-header"><button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Vista consumidor</button><div><p className="eyebrow">Portal profesional</p><h1>Tu trabajo.<br /><em>Más visible.</em></h1></div><Button variant="outline" onClick={() => onNotify('El onboarding profesional estará disponible en el siguiente paso')}><Sparkles size={16} /> Empezar perfil</Button></div><div className="pro-shell"><aside className="pro-sidebar"><div className="pro-user"><div className="avatar avatar-2">IM</div><div><strong>Inés Martín</strong><span>Coach verificada</span></div></div>{[['overview', 'Resumen'], ['calendar', 'Agenda'], ['services', 'Servicios'], ['messages', 'Mensajes'], ['credentials', 'Validación']].map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}{id === 'messages' && <small>3</small>}</button>)}<div className="pro-sidebar-foot"><ShieldCheck size={15} /> Perfil visible y verificado</div></aside><div className="pro-content"><div className="pro-content-head"><div><p className="eyebrow">{tab === 'overview' ? 'Esta semana' : tab}</p><h2>{tab === 'overview' ? 'Hola, Inés.' : tab === 'calendar' ? 'Tu agenda' : tab === 'services' ? 'Tus servicios' : tab === 'messages' ? 'Conversaciones' : 'Tu validación'}</h2></div><button className="icon-button" onClick={() => onNotify('No hay notificaciones nuevas')}><HelpCircle size={19} /></button></div>{tab === 'overview' && <><div className="metric-grid"><div><span>Reservas este mes</span><strong>18</strong><small className="positive">+24% vs. mes anterior</small></div><div><span>Ingresos pendientes</span><strong>624€</strong><small>Próximo pago · viernes</small></div><div><span>Valoración media</span><strong>4.9 <Star size={18} fill="currentColor" /></strong><small>42 reseñas verificadas</small></div></div><div className="pro-panels"><div className="pro-panel schedule-panel"><div className="panel-heading"><div><p className="eyebrow">Agenda próxima</p><h3>Tienes 4 sesiones esta semana.</h3></div><button onClick={() => setTab('calendar')}>Ver agenda <ArrowRight size={15} /></button></div>{['Hoy · 18:30', 'Mañana · 09:00', 'Jueves · 17:30'].map((slot, index) => <div className="schedule-row" key={slot}><span className="schedule-day">{index === 0 ? 'HOY' : index === 1 ? 'MAR' : 'JUE'}</span><span><strong>{slot}</strong><small>{index === 0 ? 'Javier R. · Fuerza 1:1' : index === 1 ? 'Marta G. · Bono mensual' : 'Pablo T. · Movilidad'}</small></span><span className="schedule-mode">{index === 1 ? 'Online' : 'Presencial'}</span></div>)}</div><div className="pro-panel profile-progress"><div className="progress-ring"><strong>86%</strong><span>perfil</span></div><div><p className="eyebrow">Haz que te elijan</p><h3>Tu vídeo puede ser el siguiente paso.</h3><p>Añade una presentación de 30 segundos y aparece con más contexto en los resultados.</p><button onClick={() => onNotify('Subida de vídeo próximamente')}>Añadir vídeo <ArrowRight size={15} /></button></div></div></div></>}{tab !== 'overview' && <div className="coming-panel"><div className="coming-icon"><Sparkles /></div><h3>Estamos preparando este espacio.</h3><p>La base del portal está lista. Aquí conectaremos tu {tab === 'calendar' ? 'agenda con disponibilidad real' : 'flujo profesional'} con Supabase y Stripe.</p><Button onClick={() => setTab('overview')}>Volver al resumen</Button></div>}</div></div></section>
}

function Footer({ onPro, onNotify }: { onPro: () => void; onNotify: (message: string) => void }) { return <footer className="footer"><span>© 2026 CoachConnect</span><span className="footer-links"><button onClick={onPro}>Para entrenadores</button><button onClick={() => onNotify('Página de privacidad preparada para la revisión legal')}>Privacidad</button><button onClick={() => onNotify('Centro de ayuda en preparación')}>Ayuda</button></span><span>Hecho para empezar.</span></footer> }

function LoginModal({ onClose }: { onClose: () => void }) { return <div className="modal-backdrop" onClick={onClose}><div className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button><p className="eyebrow">Bienvenido de vuelta</p><h2 id="login-title">Tu próximo<br /><em>entrenamiento</em> empieza aquí.</h2><button className="oauth-button"><Globe2 size={17} /> Continuar con Google</button><button className="oauth-button"><span className="apple-symbol">●</span> Continuar con Apple</button><div className="or-divider"><span>o con email</span></div><label className="email-field"><span>Email</span><input type="email" placeholder="tu@email.com" /></label><Button className="full-button">Continuar <ArrowRight size={17} /></Button><p className="modal-legal">Al continuar aceptas nuestras condiciones y política de privacidad.</p></div></div> }

export default App
