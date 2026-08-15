# CoachConnect

MVP de un marketplace bilingüe de entrenadores personales. La experiencia de consumidor empieza con un cuestionario interactivo que prioriza la especialidad, la zona y el encaje real antes de mostrar perfiles.

El alcance funcional completo y las decisiones de producto están guardados en [PLAN_COACHCONNECT_MVP.md](./PLAN_COACHCONNECT_MVP.md).

## Estado actual

La implementación cubre:

- Cuestionario de matching con especialidad, modalidad, zona, presupuesto e idioma.
- Ranking explicable con orden fijo —especialidad, zona, valoraciones y rapidez de respuesta— y relajación controlada de un criterio.
- Perfiles, agenda real, excepciones, reservas transaccionales sin solapes y cancelación del cliente hasta 24 horas antes.
- Confirmación bilateral de asistencia, valoraciones de doble ciego, reputación separada para entrenadores y clientes, respuestas públicas y resolución administrativa de disputas.
- Bonos flexibles con créditos y planes periódicos semanales o quincenales que reservan toda la serie de forma atómica.
- Auth Email/Google/Apple, mensajería Realtime, adjuntos privados, bloqueos, denuncias y comunicaciones duraderas por app, email y calendario.
- Correos transaccionales descriptivos con fecha, participantes, ubicación o acceso online, importes, comisión/neto por rol, recibo e invitación ICS; recordatorios y preferencias no esenciales.
- Sincronización opcional con Google Calendar, creación de Meet, ubicaciones exactas privadas tras confirmar y reprogramaciones bilaterales.
- Portal profesional con onboarding, servicios, agenda, acreditaciones, vídeo, Stripe Connect y videollamadas.
- Operaciones para validar profesionales y vídeos, moderar, gestionar taxonomía y consultar pagos.
- Interfaz responsive, base bilingüe español/inglés y pruebas Vitest, Pytest y Playwright.

Email funciona con la configuración actual. Google, Apple, Stripe, Resend, Meet y Zoom necesitan sus credenciales de proveedor para poder probarse extremo a extremo.

### Comprobar Stripe, Meet y Zoom en local

- Stripe está en modo de prueba cuando `STRIPE_SECRET_KEY` empieza por `sk_test_`. Guardar un `stripe_account_id` no completa Connect: la cuenta solo se considera conectada cuando Stripe devuelve `details_submitted`, `charges_enabled` y `payouts_enabled`.
- En local, ejecuta `stripe listen --forward-to localhost:8000/api/v1/webhooks/stripe` y copia el `whsec_...` que muestra a `STRIPE_WEBHOOK_SECRET`. En producción, registra `https://<API>/api/v1/webhooks/stripe` en Stripe Workbench para `checkout.session.completed`, `checkout.session.expired`, `charge.refunded` y `refund.updated`.
- Google Calendar/Meet usa exactamente `BACKEND_URL/api/v1/integrations/google/callback`. Mientras la pantalla de consentimiento esté en **Testing**, añade cada cuenta en Google Auth Platform → Audience → Test users. Habilita también Google Calendar API.
- Zoom usa exactamente el valor de `ZOOM_REDIRECT_URI`. Debe ser una URL HTTPS estable y no-localhost; el desarrollo local puede usar una página pública que reenvíe `code` y `state` al callback local. Copia la URL completa tanto en OAuth Redirect URL como en OAuth Allow Lists de la app de desarrollo de Zoom; protocolo, host, ruta y barra final deben coincidir.
- Tras un callback correcto aparece una fila `google` o `zoom` en `integration_connections`. Un botón pulsado sin esa fila no significa que la integración haya terminado.
- Resend entrega el correo transaccional. Registra `https://<API>/api/v1/webhooks/resend`, copia su secreto `whsec_...` a `RESEND_WEBHOOK_SECRET` y habilita eventos de entrega, rebote y complaint. Los rebotes duros y complaints suprimen nuevos envíos a esa cuenta.

## Tecnologías

- React + TypeScript + Vite.
- Tailwind CSS y primitivas compatibles con shadcn/ui.
- FastAPI + Pydantic.
- Supabase: Auth, PostgreSQL, Storage y Realtime.
- Stripe Connect.
- Docker.
- Vercel para el frontend.

## Desarrollo local

### Frontend

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`.

### API

En PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r api/requirements.txt
uvicorn app.main:app --reload --app-dir api
```

La API estará en `http://localhost:8000` y su documentación en `http://localhost:8000/docs`.

### Todo con Docker

```bash
docker compose up --build
```

- Web: `http://localhost:5173`
- API: `http://localhost:8000`
- OpenAPI: `http://localhost:8000/docs`

## Variables de entorno

Copia `.env.example` y `api/.env.example` a sus variantes `.env`. Las claves privadas solo deben estar en el backend.

Variables principales:

- `VITE_API_URL` (origen de la API, sin `/api/v1`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `INTERNAL_CRON_SECRET` (protege el avance periódico de sesiones, plazos y autorizaciones)
- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM` y `EMAIL_REPLY_TO`
- `OPERATIONS_EMAIL` (alertas de moderación, disputas y fallos operativos)
- `TOKEN_ENCRYPTION_KEY`
- Credenciales OAuth de Google y Zoom, y Resend si se quiere email.

## Supabase

El repositorio usa migraciones imperativas. `003_complete_mvp.sql` ya crea buckets privados, Realtime y el trigger de perfiles; no hay que repetir esos pasos en Studio.

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase db lint --linked
```

El orden aplicable termina en `20260814134904_route_training_feedback_through_communications.sql`; Supabase aplica automáticamente el historial por marca temporal. Antes de producción:

1. Configura Email, Google y Apple en Auth y registra las URLs de local, Vercel y producción.
2. Ejecuta los advisors de seguridad y rendimiento desde Supabase.
3. Crea el primer administrador de forma explícita:

```powershell
.venv\Scripts\python.exe api/scripts/bootstrap_admin.py admin@dominio.com
```

4. Programa una llamada frecuente (cada cinco minutos) a `POST /api/v1/internal/lifecycle` con la cabecera `X-Cron-Secret`. El valor debe coincidir con `INTERNAL_CRON_SECRET`; la operación es idempotente y, además de avanzar sesiones y liberar autorizaciones, programa recordatorios y procesa las colas de email/calendario con reintentos.
5. Configura SMTP personalizado en Supabase Auth para usar las plantillas de `supabase/templates`; en los proyectos Free nuevos las plantillas personalizadas requieren SMTP propio.

El proyecto incluye `.cursor/mcp.json` para `https://mcp.supabase.com/mcp`. Reinicia/recarga Cursor y completa OAuth para habilitar sus herramientas.

## Comandos de calidad

```bash
npm run lint
npm run test
npm run test:e2e
npm run build
```

Para la API:

```powershell
$env:PYTHONPATH="api"
$env:ENVIRONMENT="test"
pytest api/tests
```

## Despliegue

### Frontend en Vercel

1. Importa este repositorio en Vercel.
2. Usa `npm run build` como build command y `dist` como output.
3. Configura las variables `VITE_*`.
4. `vercel.json` mantiene el enrutado de la SPA.

### API

Despliega `api/Dockerfile` en Railway y configura las variables de `api/.env.example`. Actualiza `FRONTEND_URL` con el dominio definitivo de Vercel y `VITE_API_URL` con la URL pública de Railway.

## Estructura

```text
src/                 Frontend React
api/app/             Aplicación FastAPI
api/tests/           Pruebas de la API
api/scripts/         Utilidades operativas controladas
e2e/                 Recorridos Playwright
supabase/migrations/ Historial completo del esquema
PLAN_COACHCONNECT_MVP.md
docker-compose.yml
```

## Seguridad antes de producción

- Aplicar la última migración y probar la matriz RLS con anon, consumidor, entrenador y admin.
- Mantener `SUPABASE_SECRET_KEY`, Stripe, OAuth y `TOKEN_ENCRYPTION_KEY` solo en el backend.
- Probar firmas e idempotencia de webhooks de Stripe y Resend en staging.
- Revisar RGPD, condiciones, cancelaciones y fiscalidad con asesoría legal.
- No mostrar direcciones personales exactas antes de una reserva confirmada.
