# Versión de pruebas en Vercel

Proyecto: `coachconnect-testing`. Rama de publicación: `main`.

URL estable: https://coachconnect-testing.vercel.app

La configuración de `vercel.json` usa Vercel Services para publicar React/Vite
y FastAPI en el mismo despliegue. `/api/*`, `/health`, `/docs` y `/openapi.json`
llegan a FastAPI; las demás rutas llegan a la aplicación React, incluidas las
rutas internas de la SPA. En producción, el frontend usa la API del mismo
dominio si no se establece `VITE_API_URL`. En desarrollo mantiene localhost:8000.

## Configuración

En Vercel, configura las variables del entorno Production. No subas archivos
`.env` al repositorio ni incluyas claves privadas en variables `VITE_*`.

Variables públicas necesarias durante el build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PUBLISHABLE_KEY` de prueba, si se prueban pagos
- Deja `VITE_API_URL` sin definir para utilizar la API del mismo dominio

Variables privadas de FastAPI:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `ENVIRONMENT=production`, `DEMO_MODE=false`
- `FRONTEND_URL` y `BACKEND_URL`: URL HTTPS estable del despliegue
- `STRIPE_SECRET_KEY` de prueba y `PLATFORM_FEE_PERCENT`
- `TOKEN_ENCRYPTION_KEY`: clave Fernet persistente para las integraciones
- `INTERNAL_CRON_SECRET`: secreto del endpoint de ciclo de sesiones
- Credenciales de email, Google y Zoom según las funciones que se prueben

Los testers utilizan la base de datos de CoachConnect configurada en Supabase.
Sus registros, mensajes y cambios se guardan allí; este despliegue no crea una
base de datos independiente. RLS permanece activa.

## Autenticación e integraciones

En Supabase → Authentication → URL Configuration, añade la URL HTTPS estable a
Redirect URLs y configúrala como Site URL si debe recibir los enlaces de correo.
Conserva las URLs locales si también se usan para desarrollo.

Registrar credenciales no basta para completar las integraciones externas:

- Stripe necesita un webhook público en `/api/v1/webhooks/stripe` y su
  `STRIPE_WEBHOOK_SECRET` específico. El secreto del listener local no sirve.
- Google Calendar necesita autorizar el callback HTTPS
  `/api/v1/integrations/google/callback` en Google Cloud.
- Zoom necesita autorizar el callback HTTPS
  `/api/v1/integrations/zoom/callback` en su configuración OAuth.
- Resend necesita `/api/v1/webhooks/resend` y `RESEND_WEBHOOK_SECRET` para
  procesar eventos de entrega.
- El ciclo periódico de sesiones requiere programar llamadas autenticadas a
  `POST /api/v1/internal/lifecycle`, como se describe en el README.

Mantén Stripe en modo de prueba para las pruebas con testers.

## Comprobación después de publicar

1. Abrir la portada y una ruta interna directamente.
2. Comprobar `/health` y `/api/v1/categories` (esta última consulta Supabase).
3. Iniciar sesión con una cuenta de pruebas y comprobar `/api/v1/me`.
4. Probar los recorridos que se vayan entregando al equipo.

Los cambios publicados en `main` generan nuevos despliegues cuando está
habilitada la conexión Git de Vercel. Los cambios sin commit de tu equipo no
se publican mediante esa conexión.
