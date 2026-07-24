import { useState, type FormEvent } from 'react'
import { Apple, Chrome, LoaderCircle, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { hasSupabase, supabase } from '../lib/supabase'
import { Button } from './ui/button'

export function AuthModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!hasSupabase) return toast.error('Añade las variables VITE_SUPABASE_* para activar el acceso.')
    setBusy(true)
    const result = creating
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: name, locale: 'es' } } })
      : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (result.error) return toast.error(result.error.message)
    if (creating && !result.data.session) toast.success('Revisa tu correo para confirmar la cuenta.')
    else toast.success('Sesión iniciada.')
    onClose()
  }

  const oauth = async (provider: 'google' | 'apple') => {
    if (!hasSupabase) return toast.error('Añade las variables VITE_SUPABASE_* para activar el acceso.')
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } })
    if (error) toast.error(error.message)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="login-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="modal-close" onClick={onClose} aria-label="Cerrar"><X /></button>
      <p className="eyebrow">{t('auth.space')}</p>
      <h2 id="auth-title">{creating ? t('auth.createTitle') : t('auth.loginTitle')}</h2>
      <button className="oauth-button" onClick={() => oauth('google')}><Chrome /> {t('auth.google')}</button>
      <button className="oauth-button" onClick={() => oauth('apple')}><Apple /> {t('auth.apple')}</button>
      <div className="or-divider">{t('auth.orEmail')}</div>
      <form className="auth-form" onSubmit={submit}>
        {creating && <label className="email-field">{t('auth.name')}<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label className="email-field">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="email-field">{t('auth.password')}<input required minLength={8} type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <Button className="full-button" type="submit" disabled={busy}>{busy && <LoaderCircle className="spin" />} {creating ? t('auth.create') : t('auth.login')}</Button>
      </form>
      <button className="auth-switch" onClick={() => setCreating(!creating)}>{creating ? 'Ya tengo una cuenta' : 'Crear una cuenta nueva'}</button>
      <p className="modal-legal">Al continuar aceptas los términos y la política de privacidad. Nunca vendemos tus datos.</p>
    </section>
  </div>
}
