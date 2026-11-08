// Verify the real hosted OAuth return URL without a Google login or an email.
// Simulate provider cancellation using a state issued by Supabase itself.
try {
  process.loadEnvFile('.env')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const expected = new URL(process.argv[2] || 'https://coachconnect-testing.vercel.app')
const supabaseUrl = process.env.VITE_SUPABASE_URL
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!supabaseUrl || !publishableKey) {
  throw new Error('Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.')
}

const startUrl = new URL('/auth/v1/authorize', supabaseUrl)
startUrl.searchParams.set('provider', 'google')
startUrl.searchParams.set('redirect_to', expected.origin)
const start = await fetch(startUrl, {
  redirect: 'manual',
  headers: { apikey: publishableKey },
  signal: AbortSignal.timeout(20_000),
})
if (start.status !== 302 || !start.headers.get('location')) {
  throw new Error(`No se pudo iniciar OAuth: HTTP ${start.status}.`)
}
const state = new URL(start.headers.get('location')).searchParams.get('state')
if (!state) throw new Error('Supabase no ha devuelto un estado OAuth.')

const callbackUrl = new URL('/auth/v1/callback', supabaseUrl)
callbackUrl.searchParams.set('state', state)
callbackUrl.searchParams.set('error', 'access_denied')
callbackUrl.searchParams.set('error_description', 'Automated redirect check: simulated provider cancellation')
const cookies = start.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
const callback = await fetch(callbackUrl, {
  redirect: 'manual',
  headers: cookies ? { cookie: cookies } : {},
  signal: AbortSignal.timeout(20_000),
})
if (callback.status !== 302 || !callback.headers.get('location')) {
  throw new Error(`No se ha recibido el retorno OAuth: HTTP ${callback.status}.`)
}
const actual = new URL(callback.headers.get('location'))
const error = new URLSearchParams(actual.hash.slice(1) || actual.search).get('error')
if (error !== 'access_denied') throw new Error('La cancelación OAuth no ha seguido el flujo esperado.')

console.log(`Retorno solicitado: ${expected.origin}`)
console.log(`Retorno de Supabase: ${actual.origin}${actual.pathname}`)
if (actual.origin !== expected.origin) {
  console.error('ERROR: revisa Site URL y Redirect URLs en Supabase Authentication → URL Configuration.')
  process.exitCode = 1
} else {
  console.log('OK: Supabase devuelve al dominio solicitado. No se ha iniciado sesión ni enviado correo.')
}
