# Guía de paso a producción de CoachConnect

Esta guía describe cómo desplegar la aplicación actual, no una arquitectura genérica. Asume:

- Frontend React/Vite en Vercel: `https://coachconnect.example.com`.
- API FastAPI en Railway: `https://api.coachconnect.example.com`.
- Base de datos, Auth, Storage y Realtime en Supabase.
- Pagos con Stripe Connect.
- Reuniones con Google Calendar/Meet y Zoom.
- Correo transaccional con Resend.

Sustituye los dominios de ejemplo antes de configurar proveedores. No copies secretos reales en este documento, Git o variables `VITE_*`.

## 1. Mapa de URLs de producción

Define primero estas dos URLs estables:

```text
APP_URL=https://coachconnect.example.com
API_URL=https://api.coachconnect.example.com
```

De ellas salen todos los callbacks:

| Servicio | URL exacta |
| --- | --- |
| API pública | `https://api.coachconnect.example.com` |
| Health check | `https://api.coachconnect.example.com/health` |
| Google Calendar/Meet | `https://api.coachconnect.example.com/api/v1/integrations/google/callback` |
| Zoom | `https://api.coachconnect.example.com/api/v1/integrations/zoom/callback` |
| Stripe webhook | `https://api.coachconnect.example.com/api/v1/webhooks/stripe` |
| Retorno OAuth a la aplicación | `https://coachconnect.example.com/profesional` |

En producción no se debe usar `localhost`, un túnel temporal ni la página puente de GitHub Pages que se utilizó para desarrollar Zoom.

## 2. Estrategia de entornos

Usa recursos separados para `staging` y `production` siempre que sea posible:

- Un proyecto de Supabase por entorno.
- Claves y endpoints de Stripe sandbox/live separados.
- Clientes OAuth de Google separados.
- Credenciales Development/Production de Zoom separadas.
- Dominios o subdominios separados, por ejemplo `staging.coachconnect.example.com` y `api-staging.coachconnect.example.com`.

Esto evita que reservas de prueba, cuentas Connect de sandbox o tokens OAuth de desarrollo lleguen a producción.

## 3. Supabase

### 3.1 Crear y migrar el proyecto

1. Crea el proyecto de producción en Supabase y guarda su `project-ref`.
2. Comprueba la versión de la CLI antes de usarla:

   ```bash
   npx supabase --version
   npx supabase --help
   ```

3. Vincula el repositorio con el proyecto correcto y revisa el destino antes de aplicar nada:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref-produccion>
   npx supabase migration list --linked
   npx supabase db push
   npx supabase db lint --linked
   ```

4. Verifica en Supabase que existen las tablas, políticas RLS, índices y buckets creados por `supabase/migrations/`.
5. No ejecutes `api/scripts/seed_test_accounts.py` en producción.

Las migraciones crean los buckets privados `credentials`, `coach-videos` y `chat-files`, además de las políticas de acceso y la publicación Realtime para `messages` y `notifications`.

Supabase dejó de exponer automáticamente las tablas nuevas mediante Data API. Si en el futuro se añade una tabla, además de RLS hay que conceder explícitamente los permisos necesarios a `anon` o `authenticated`. Esta aplicación ya contiene los `GRANT` de sus tablas actuales. Consulta el [cambio de Data API](https://supabase.com/changelog) y la [lista oficial de producción de Supabase](https://supabase.com/docs/guides/deployment/going-into-prod).

### 3.2 Claves

Obtén desde Supabase:

- Project URL → `SUPABASE_URL` y `VITE_SUPABASE_URL`.
- Publishable key → `SUPABASE_PUBLISHABLE_KEY` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Secret key → solo `SUPABASE_SECRET_KEY` en la API.

La publishable key está diseñada para el navegador y queda protegida por RLS. La secret key no debe llegar nunca al frontend, a Vercel como variable `VITE_*`, a capturas ni a Git.

### 3.3 Auth y redirects

En Supabase → Authentication → URL Configuration:

- Site URL: `https://coachconnect.example.com`.
- Redirect URLs de producción: `https://coachconnect.example.com/**` o, preferiblemente, las rutas exactas utilizadas.
- Conserva URLs de preview solo en el proyecto de staging.
- Elimina URLs antiguas o temporales cuando termine la migración.

Supabase recomienda que el Site URL sea el dominio real y que en producción se prefieran redirects exactos. Consulta [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

Para los botones de acceso con Google y Apple, configura cada proveedor dentro de Supabase Auth. El callback que se registra en esos proveedores es el callback de Supabase:

```text
https://<project-ref>.supabase.co/auth/v1/callback
```

Este OAuth de inicio de sesión es independiente del OAuth de Google Calendar/Meet descrito más adelante.

### 3.4 Seguridad y disponibilidad

Antes de abrir producción:

- Ejecuta Security Advisor y Performance Advisor.
- Confirma RLS en todas las tablas expuestas.
- Confirma que los buckets siguen siendo privados.
- Activa MFA en las cuentas administradoras de Supabase.
- Activa confirmación de email y CAPTCHA/rate limits según el riesgo esperado.
- Configura SMTP propio para los correos de Supabase Auth.
- Activa SSL Enforcement y valora Network Restrictions si Railway tiene salida IP estable.
- Define la política de backups; usa un plan sin pausado por inactividad y PITR si el RPO del negocio lo exige.
- Prueba recuperación de backup antes del lanzamiento, no solo su creación.

Referencia: [Production Checklist de Supabase](https://supabase.com/docs/guides/deployment/going-into-prod).

## 4. API FastAPI en Railway

### 4.1 Crear el servicio

1. Conecta Railway al repositorio.
2. Configura `api` como Root Directory del servicio. Esto es necesario porque `api/Dockerfile` copia `requirements.txt` y `app/` relativos a esa carpeta.
3. Railway detectará `api/Dockerfile` dentro de ese directorio.
4. Genera un dominio y después asigna el dominio definitivo de API.
5. Configura el target port `8000`, porque el Dockerfile actual ejecuta Uvicorn en ese puerto.
6. Configura `/health` como Healthcheck Path y confirma que responde `200`.

Railway documenta el despliegue de FastAPI con Dockerfile en [Deploy a FastAPI App](https://docs.railway.com/guides/fastapi) y el comportamiento de los checks en [Healthchecks](https://docs.railway.com/deployments/healthchecks).

### 4.2 Variables del backend

Configura estas variables en el entorno Production de Railway:

```dotenv
ENVIRONMENT=production
DEMO_MODE=false

FRONTEND_URL=https://coachconnect.example.com
BACKEND_URL=https://api.coachconnect.example.com

SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_PERCENT=15

RESEND_API_KEY=re_...
EMAIL_FROM=CoachConnect <notificaciones@updates.coachconnect.example.com>
EMAIL_TEST_RECIPIENT=

OAUTH_CLIENT_ID=<google-calendar-client-id>
OAUTH_CLIENT_SECRET=<google-calendar-client-secret>
OAUTH_STATE_TTL_SECONDS=600

TOKEN_ENCRYPTION_KEY=<secreto-aleatorio-largo-y-estable>

ZOOM_CLIENT_ID=<zoom-production-client-id>
ZOOM_CLIENT_SECRET=<zoom-production-client-secret>
ZOOM_OAUTH_URL=https://zoom.us/oauth/authorize
ZOOM_REDIRECT_URI=https://api.coachconnect.example.com/api/v1/integrations/zoom/callback
```

Genera `TOKEN_ENCRYPTION_KEY` fuera del repositorio, por ejemplo:

```bash
openssl rand -hex 32
```

Guárdala también en el gestor de secretos/backup. La API cifra con ella los access y refresh tokens de Google y Zoom. Cambiarla sin migrar los tokens existentes hará que todas esas conexiones dejen de poder descifrarse y haya que reconectarlas.

Notas específicas del código actual:

- `OAUTH_REDIRECT_URIS` aparece en `api/.env.example`, pero el flujo actual de Google no lo utiliza. El callback se calcula exclusivamente desde `BACKEND_URL`.
- `DEMO_MODE` debe ser `false`; de lo contrario se podrían ocultar fallos de configuración propios del desarrollo.
- `EMAIL_TEST_RECIPIENT` debe quedar vacío para que los emails lleguen al usuario real.
- Todos los secretos deben estar solo en Railway. Las variables de Vite son públicas.

### 4.3 CORS y dominio

`FRONTEND_URL` debe coincidir exactamente con el origen del frontend, sin rutas. Tras desplegar:

```bash
curl -fsS https://api.coachconnect.example.com/health
```

La respuesta debe indicar:

```json
{
  "status": "ok",
  "environment": "production",
  "database": "configured",
  "stripe": "configured"
}
```

Antes del lanzamiento público conviene modificar la lista CORS para que los orígenes `localhost` solo se añadan cuando `ENVIRONMENT` sea de desarrollo. Actualmente permanecen permitidos también en producción.

## 5. Frontend Vite en Vercel

1. Importa el repositorio en Vercel usando la raíz del proyecto.
2. El repositorio ya incluye `vercel.json` con:
   - Build command: `npm run build`.
   - Output directory: `dist`.
   - Rewrite SPA hacia `index.html`.
3. Configura el dominio definitivo.
4. Añade en Production:

   ```dotenv
   VITE_API_URL=https://api.coachconnect.example.com
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

`VITE_STRIPE_PUBLISHABLE_KEY` está preparada en los archivos de entorno y Docker, pero el frontend actual no usa Stripe.js: el checkout se crea en la API y se abre mediante una URL de Stripe. No es necesaria hasta que se añadan Elements u otra función cliente.

Las variables `VITE_*` quedan integradas en el bundle durante el build. Después de cambiarlas hay que crear un despliegue nuevo. Consulta [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) y [Environment Variables](https://vercel.com/docs/environment-variables).

## 6. Stripe Connect en modo live

### 6.1 Activar la plataforma

1. Completa la activación legal, fiscal y bancaria de la cuenta de plataforma.
2. Revisa la configuración de Connect para España y las responsabilidades de la plataforma.
3. Cambia el Dashboard a live mode.
4. Copia `sk_live_...` a `STRIPE_SECRET_KEY` en Railway.
5. Si en el futuro se usa Stripe.js, copia `pk_live_...` a `VITE_STRIPE_PUBLISHABLE_KEY` en Vercel.

Los objetos de sandbox y live mode son independientes. Los `stripe_account_id` creados con `sk_test_...` no funcionarán con una clave `sk_live_...`. Cada entrenador debe completar de nuevo el onboarding live. Lo más seguro es usar una base de datos de producción limpia; si se reutilizan datos, hay que planificar la retirada de los IDs de prueba antes de abrir pagos.

Stripe explica la separación de claves y objetos en [API keys](https://docs.stripe.com/keys) y exige activar la cuenta para cobrar dinero real en [Stripe accounts](https://docs.stripe.com/get-started/account).

### 6.2 Webhook live

En Stripe Workbench crea un endpoint de tipo Account para:

```text
https://api.coachconnect.example.com/api/v1/webhooks/stripe
```

Selecciona únicamente los eventos que procesa el código actual:

```text
checkout.session.completed
checkout.session.expired
charge.refunded
refund.updated
```

Copia el signing secret live de ese endpoint a `STRIPE_WEBHOOK_SECRET`. No reutilices el `whsec_...` de `stripe listen` ni el de staging.

El webhook actual verifica la firma y registra cada `event.id` para mantener idempotencia. Si se decide escuchar `account.updated` u otros eventos de cuentas conectadas, primero debe añadirse su tratamiento al backend y después crear/configurar un destino de eventos Connect. Referencias: [crear un webhook](https://docs.stripe.com/development/dashboard/webhooks) y [Connect webhooks](https://docs.stripe.com/connect/webhooks).

### 6.3 Prueba mínima live

Realiza una operación real de importe mínimo y reembólsala:

- Un entrenador completa onboarding y aparece como conectado solo cuando Stripe devuelve `details_submitted`, `charges_enabled` y `payouts_enabled`.
- Un cliente compra una sesión.
- El webhook confirma la reserva y guarda el PaymentIntent.
- Se crea la reunión del proveedor elegido.
- El reembolso actualiza el pago.
- El Dashboard de Stripe muestra application fee y transferencia al entrenador.

## 7. Google Calendar y Google Meet

### 7.1 Proyecto y cliente OAuth

El acceso social con Google de Supabase y la integración Calendar/Meet son dos clientes distintos, aunque puedan vivir en el mismo proyecto de Google Cloud:

1. Habilita Google Calendar API.
2. Crea un cliente OAuth 2.0 de tipo Web application para Calendar/Meet.
3. Registra como Authorized redirect URI exacta:

   ```text
   https://api.coachconnect.example.com/api/v1/integrations/google/callback
   ```

4. Coloca su client ID y secret en `OAUTH_CLIENT_ID` y `OAUTH_CLIENT_SECRET` de Railway.
5. Configura la marca, email de soporte, dominio autorizado, homepage, términos y privacidad.
6. Verifica el dominio con una cuenta propietaria/editora del proyecto.

La API solicita actualmente:

```text
openid
email
https://www.googleapis.com/auth/calendar.events
```

`calendar.events` permite ver y modificar eventos de los calendarios del usuario. Google pide el alcance mínimo y las aplicaciones públicas que usan scopes sensibles deben pasar verificación. Consulta [Scopes de Calendar](https://developers.google.com/workspace/calendar/api/auth) y [requisitos de verificación](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

### 7.2 Salir de Testing

El error “solo pueden acceder los testers aprobados” aparece mientras Audience/Publishing status está en Testing.

Para producción:

1. Google Auth Platform → Audience → selecciona audiencia External si accederán cuentas fuera de tu organización.
2. Publica la aplicación a In production.
3. Prepara y envía la verificación de marca y del scope de Calendar.
4. Aporta justificación y un vídeo que muestre el flujo OAuth completo y la creación del evento/Meet.
5. Espera la aprobación antes de abrir la integración a usuarios finales.

Una aplicación en Testing queda limitada a sus test users; en In production puede autorizar cualquier cuenta, aunque Google puede mostrar advertencias o aplicar límites hasta finalizar la verificación de scopes. Referencias: [Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en) y [Submitting your app for verification](https://support.google.com/cloud/answer/13461325?hl=en).

CoachConnect crea el evento en el calendario primario con `conferenceDataVersion=1` y una `createRequest`, que es el mecanismo documentado para generar Google Meet: [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events).

## 8. Zoom

### 8.1 Configuración de Production

CoachConnect tiene backend y usa el flujo OAuth confidencial con client ID y client secret. En Zoom Marketplace:

1. Abre la app General de CoachConnect.
2. Cambia de Development a Production.
3. Copia las credenciales de Production, no las de Development, a Railway.
4. Configura como OAuth Redirect URL:

   ```text
   https://api.coachconnect.example.com/api/v1/integrations/zoom/callback
   ```

5. Deja exactamente la misma URL como única OAuth Allow List.
6. Activa Strict Mode si la consola acepta la coincidencia exacta.
7. Elimina callbacks de `localhost`, `127.0.0.1`, trycloudflare y GitHub Pages del entorno Production.
8. Mantén únicamente los scopes que usa la aplicación:

   ```text
   meeting:read:list_meetings
   meeting:write:meeting
   ```

9. Desactiva `Use Public Client OAuth` salvo que se implemente PKCE para una app móvil/escritorio. El backend actual no lo necesita. Si se conserva activado, Zoom mantiene dos clientes y ambos deben tener redirects/allowlists coherentes.

Zoom usa valores y credenciales distintos entre Development y Production. El `redirect_uri` del authorize y del intercambio de token debe coincidir con el configurado en Marketplace. Consulta [OAuth Information](https://developers.zoom.us/docs/build-flow/basic-info/oauth-info/) y [OAuth 2.0](https://developers.zoom.us/docs/integrations/oauth/).

### 8.2 Distribución

Local Test/beta solo sirve para pruebas internas y usuarios limitados. Para entrenadores externos:

- Completa App Listing, información de soporte, términos y privacidad.
- Decide si será pública, unlisted o privada para una única cuenta.
- Habilita publishing y envíala a revisión.
- Explica por qué necesita cada scope y demuestra el flujo completo.
- Añade un endpoint de desautorización antes de publicar si Zoom lo exige; el backend actual todavía no implementa `app_deauthorized`, por lo que este es un pendiente de código para una publicación pública.

Zoom exige revisión para apps públicas y documentación/soporte propios. Consulta [App distribution](https://developers.zoom.us/docs/distribute/) y [App Review Process](https://developers.zoom.us/docs/distribute/app-review-process/).

## 9. Resend y correo

1. Añade un dominio o subdominio propio, por ejemplo `updates.coachconnect.example.com`.
2. Publica los registros DNS SPF y DKIM indicados por Resend; añade DMARC cuando esté estable.
3. Espera a que el dominio figure como Verified.
4. Crea una API key restringida al entorno de producción.
5. Configura en Railway:

   ```dotenv
   RESEND_API_KEY=re_...
   EMAIL_FROM=CoachConnect <notificaciones@updates.coachconnect.example.com>
   EMAIL_TEST_RECIPIENT=
   ```

6. Envía una notificación real y comprueba entrega, rebotes y spam.

El envío de notificaciones de la API mediante Resend es independiente del SMTP de Supabase Auth. Configura también un SMTP propio en Supabase para confirmaciones y recuperación de contraseña. Referencia: [Managing Domains en Resend](https://resend.com/docs/dashboard/domains/introduction).

## 10. Seguridad y observabilidad antes del lanzamiento

### Secretos

- No guardar `.env`, claves live ni tokens en Git.
- Rotar cualquier secreto que haya aparecido en logs, capturas o conversaciones compartidas.
- Limitar acceso a Railway, Vercel, Supabase, Stripe, Google, Zoom, Resend y DNS con MFA.
- Documentar quién puede rotar cada clave y cómo recuperar el servicio.
- Mantener `TOKEN_ENCRYPTION_KEY` estable y respaldada.

### Aplicación

- Servir frontend, API y callbacks únicamente mediante HTTPS.
- Publicar páginas reales de privacidad, términos y soporte antes de las revisiones de Google/Zoom.
- Restringir CORS de producción al dominio definitivo.
- Añadir rate limiting en endpoints de autenticación, mensajería, pagos y callbacks según el tráfico esperado.
- Confirmar que no se registra en logs ningún access token, refresh token, código OAuth o secreto.
- Probar que un usuario no puede leer reservas, mensajes, archivos o conexiones de otro usuario.

### Monitorización

- Monitor externo continuo para `/health`; el healthcheck de Railway solo valida el despliegue.
- Alertas de errores 5xx y latencia de la API.
- Alertas de fallos de webhooks en Stripe.
- Alertas de cuota/errores en Google Calendar y Zoom.
- Revisión de Auth Logs, Postgres Logs y Advisors en Supabase.
- Seguimiento de entregas y rebotes en Resend.

## 11. Orden recomendado de lanzamiento

1. Comprar/configurar los dominios y publicar privacidad, términos y soporte.
2. Crear recursos separados de producción en Supabase, Stripe, Google, Zoom y Resend.
3. Aplicar migraciones y validar RLS, Storage y Realtime en Supabase.
4. Desplegar la API en Railway con `DEMO_MODE=false` y comprobar `/health`.
5. Configurar el dominio definitivo de la API.
6. Registrar callbacks definitivos de Google, Zoom y Stripe.
7. Desplegar el frontend en Vercel con el dominio y variables de producción.
8. Configurar Site URL y redirects de Supabase Auth.
9. Completar las verificaciones/publicación de Google y Zoom.
10. Ejecutar las pruebas de aceptación de la siguiente sección.
11. Abrir producción gradualmente y mantener staging separado.

## 12. Pruebas de aceptación

Marca cada punto en el entorno final:

- [ ] `GET /health` devuelve `environment=production`, `database=configured` y `stripe=configured`.
- [ ] Registro, confirmación de email, login y recuperación de contraseña funcionan.
- [ ] Login con Google y Apple vuelve al dominio de producción.
- [ ] Un entrenador puede completar perfil, subir credencial y subir vídeo.
- [ ] Cliente y entrenador pueden conversar y reciben Realtime sin ver conversaciones ajenas.
- [ ] Stripe Connect exige onboarding real y no marca conectado solo por guardar un ID.
- [ ] Un pago live mínimo confirma la reserva mediante webhook.
- [ ] Un reembolso actualiza Stripe y la base de datos.
- [ ] Google OAuth no muestra “solo testers” y crea un evento con enlace Meet.
- [ ] Zoom OAuth no muestra `4700`/`Invalid redirect` y crea una reunión.
- [ ] Tras reiniciar la API, los tokens de Google y Zoom siguen descifrándose y renovándose.
- [ ] Los emails salen desde el dominio verificado y llegan al usuario real.
- [ ] RLS impide acceso cruzado a perfiles privados, pagos, mensajes, archivos y tokens.
- [ ] Las URLs de retorno de Stripe, Google y Zoom no contienen localhost ni dominios temporales.
- [ ] Los logs y paneles no contienen secretos ni tokens.

## 13. Rollback

Antes de cada release conserva:

- El deployment anterior de Vercel y Railway listo para promover/re desplegar.
- Backup de Supabase y migraciones versionadas.
- Inventario de versiones de API, frontend y esquema compatibles.
- Claves anteriores durante una ventana corta solo cuando el proveedor permita rotación segura.

Si falla el lanzamiento:

1. Detén nuevos pagos o conexiones OAuth desde la interfaz.
2. Revierte frontend/API a la última versión compatible.
3. No reviertas una migración de datos destructivamente sin backup probado.
4. Reenvía webhooks fallidos desde Stripe después de recuperar la API.
5. Comprueba qué reservas quedaron pagadas pero sin reunión y reprovisiónalas de forma idempotente.

## 14. Pendientes de código detectados antes de una producción pública

- Restringir los orígenes localhost de CORS a desarrollo.
- Implementar la desautorización de Zoom y borrado de datos/tokens exigido para publicación pública.
- Decidir si `OAUTH_REDIRECT_URIS` se elimina del ejemplo o se convierte en la fuente real del callback de Google.
- Añadir monitorización continua y alertas; `/health` por sí solo no cubre dependencias externas.
- Añadir una prueba automatizada de configuración de producción que falle con `DEMO_MODE=true`, URLs localhost o secretos vacíos.
- Documentar/rehearsar la rotación de `TOKEN_ENCRYPTION_KEY`; no debe rotarse como un secreto normal sin migración de ciphertexts.
- Revisar cumplimiento legal de marketplace, pagos, privacidad, retención y eliminación de datos antes de aceptar usuarios reales.

