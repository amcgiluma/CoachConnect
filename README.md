# CoachConnect

MVP de un marketplace bilingüe de entrenadores personales. La experiencia de consumidor empieza con un cuestionario interactivo que prioriza la especialidad, la disponibilidad y el encaje real antes de mostrar perfiles.

El alcance funcional completo y las decisiones de producto están guardados en [PLAN_COACHCONNECT_MVP.md](./PLAN_COACHCONNECT_MVP.md).

## Estado actual

Esta primera implementación incluye:

- Home interactiva y responsive.
- Cuestionario de matching en cinco pasos.
- Resultados con filtros, ordenación y vista de mapa preparada para OpenStreetMap.
- Perfil de entrenador, servicios, disponibilidad y reserva simulada.
- Modal de acceso.
- Primer dashboard premium para entrenadores.
- API FastAPI con salud, categorías y matching ponderado.
- Esquema inicial de Supabase y políticas RLS.
- Dockerfiles, Docker Compose y configuración de Vercel.

Las integraciones reales de autenticación, Stripe, Supabase Realtime, Google Meet y Zoom requieren credenciales y se conectarán sobre esta base.

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

- `VITE_API_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Supabase

1. Crea un proyecto en Supabase.
2. Configura proveedores Email, Google y Apple en Auth.
3. Ejecuta `supabase/migrations/001_initial.sql` desde las migraciones o el editor SQL.
4. Crea buckets privados para `credentials`, `coach-videos` y `chat-files`.
5. Añade las URLs local y de Vercel a las URLs permitidas de Auth.

## Comandos de calidad

```bash
npm run lint
npm run test
npm run build
```

Para la API:

```powershell
$env:PYTHONPATH="api"
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
supabase/migrations/ Esquema inicial
PLAN_COACHCONNECT_MVP.md
docker-compose.yml
```

## Seguridad antes de producción

- Revisar las políticas RLS con usuarios reales de prueba.
- Verificar firmas de webhooks de Stripe.
- Mantener documentos profesionales en buckets privados.
- Revisar RGPD, condiciones, cancelaciones y fiscalidad con asesoría legal.
- No mostrar direcciones personales exactas antes de una reserva confirmada.
