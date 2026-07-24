# CoachConnect

MVP de un marketplace bilingüe de entrenadores personales. La experiencia de consumidor empieza con un cuestionario interactivo que prioriza la especialidad, la disponibilidad y el encaje real antes de mostrar perfiles.

El alcance funcional completo y las decisiones de producto están guardados en [PLAN_COACHCONNECT_MVP.md](./PLAN_COACHCONNECT_MVP.md).

## Estado actual

La implementación cubre:

- Cuestionario de matching con especialidad, objetivo, modalidad, horario, zona, presupuesto, idioma y prioridad.
- Ranking explicable con pesos administrables y relajación controlada de un criterio.
- Perfiles, agenda real, excepciones, reservas transaccionales sin solapes, cancelaciones, reseñas y bonos.
- Auth Email/Google/Apple, mensajería Realtime, adjuntos privados, bloqueos, denuncias y notificaciones web/email.
- Portal profesional con onboarding, servicios, agenda, acreditaciones, vídeo, Stripe Connect y videollamadas.
- Operaciones para validar profesionales y vídeos, moderar, gestionar taxonomía y consultar pagos.
- Interfaz responsive, base bilingüe español/inglés y pruebas Vitest, Pytest y Playwright.

Email funciona con la configuración actual. Google, Apple, Stripe, Resend, Meet y Zoom necesitan sus credenciales de proveedor para poder probarse extremo a extremo.

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

El orden aplicable es `20260720171236_initial_coachconnect_schema.sql` → `20260720171413_security_hardening.sql` → `20260720172355_complete_coachconnect_mvp.sql` → `20260720172446_advisor_fixes.sql` → `20260724102931_harden_access_and_booking_slots.sql` → `20260724110603_advisor_cleanup.sql`. Antes de producción:

1. Configura Email, Google y Apple en Auth y registra las URLs de local, Vercel y producción.
2. Ejecuta los advisors de seguridad y rendimiento desde Supabase.
3. Crea el primer administrador de forma explícita:

```powershell
.venv\Scripts\python.exe api/scripts/bootstrap_admin.py admin@dominio.com
```

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
- Probar firmas e idempotencia de webhooks de Stripe en staging.
- Revisar RGPD, condiciones, cancelaciones y fiscalidad con asesoría legal.
- No mostrar direcciones personales exactas antes de una reserva confirmada.
