# CoachConnect — Plan de ejecución para el MVP

## Resumen

CoachConnect será un marketplace de entrenadores para consumidores en España, inicialmente en español e inglés. La promesa principal es: **“Encuentra el entrenador adecuado para ti, disponible ahora.”**

El consumidor entra en una home interactiva de pantalla completa, elige especialidad, subespecialidad, modalidad, ubicación y presupuesto, y recibe resultados explicables antes de contactar, reservar y pagar. La home no será una landing tradicional con secciones de marketing: el cuestionario es el producto.

El portal de entrenadores será independiente en navegación, pero compartirá marca, usuarios y datos. El equipo de CoachConnect tendrá un panel de administración para validar profesionales, gestionar categorías, moderar y operar reservas y pagos.

El TFG se usa como base conceptual para el marketplace, la personalización, las sesiones online/presenciales y la validación profesional. Quedan fuera del MVP los estudios de costes, estructura empresarial y previsiones financieras.

## Alcance funcional

### Consumidor

- Home interactiva con la pregunta «¿Qué quieres entrenar?».
- Cuestionario inicial antes de mostrar resultados.
- Categorías y subcategorías. Los objetivos se incorporarán cuando cada servicio pueda declarar compatibilidades estructuradas.
- Filtros por especialidad, modalidad, ubicación, precio e idioma.
- Resultados por mejor coincidencia y orden alternativo por reputación, disponibilidad o precio.
- Perfil de entrenador con especialidad, agenda, precio, modalidad, validación y reseñas.
- Mensajería directa antes y después de reservar, con texto, imágenes y archivos ligeros.
- Sesiones individuales y bonos.
- Pago y comisión mediante Stripe Connect.
- Reserva automática cuando el hueco esté libre y el entrenador esté validado.
- Videollamada mediante Google Meet, Zoom o enlace personalizado.
- Historial de reservas y notificaciones web/email.

### Entrenadores

- Registro y perfil profesional.
- Especialidades, subespecialidades, servicios, precios y duraciones.
- Disponibilidad semanal, excepciones, vacaciones y bloqueos.
- Estado «Responde ahora».
- Modalidad online/presencial, ciudad, radio y ubicaciones.
- Subida de títulos/acreditaciones y vídeo promocional opcional.
- Onboarding de Stripe Connect.
- Agenda, reservas, mensajes e ingresos.
- Configuración de Meet, Zoom o enlace propio.

### Administración

- CRUD de categorías y subcategorías, con traducciones y orden.
- Revisión de documentación y aprobación manual.
- Revisión de vídeos promocionales.
- Suspensión de perfiles y usuarios.
- Gestión de reservas, pagos, reembolsos e incidencias.
- Moderación de mensajes y archivos denunciados.
- Métricas básicas, orden de matching y auditoría de acciones.

## Validación profesional

Estados: `draft`, `credentials_submitted`, `under_review`, `verified`, `rejected`, `suspended`.

Un perfil con documentación aportada puede aparecer en búsquedas, pero no aceptar reservas ni cobrar hasta la aprobación manual. Los documentos se almacenan de forma privada y solo los ve administración. El vídeo promocional es opcional, requiere revisión y puede mejorar la visibilidad después de ser aprobado.

## Matching

Primero se aplican filtros de elegibilidad: especialidad compatible, modalidad, ubicación cuando sea presencial y validación para reservar. Después se aplica un orden lexicográfico y explicable.

Orden fijo inicial: especialidad/subespecialidad, zona indicada, valoraciones y rapidez de respuesta. Modalidad, presupuesto e idioma actúan como criterios de elegibilidad. El consumidor verá motivos comprensibles («Coincide con tu especialidad», «En tu zona», etc.), no una cifra técnica opaca.

Si no existe coincidencia completa, se propone relajar un único criterio —zona, modalidad o presupuesto— explicando la causa.

## Diseño

- Fondo blanco cálido, negro intenso y verde ácido reservado para acciones/disponibilidad.
- Titulares geométricos y contundentes; `Sora` para display, `Manrope` para texto e `IBM Plex Mono` para metadatos puntuales.
- Home sin fotografías de stock ni vídeo de fondo.
- Gesto distintivo: las palabras de las especialidades se transforman al seleccionarlas.
- Wordmark + símbolo, acceso y ayuda/legal mínima.
- Responsive mobile-first, foco visible, contraste correcto y respeto a `prefers-reduced-motion`.
- Referencia de diseño: skill oficial `frontend-design` de Anthropic.

## Arquitectura

- Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, i18next, Leaflet, Vitest y Playwright.
- Backend: FastAPI, Pydantic, JWT de Supabase, reglas de negocio, webhooks Stripe y callbacks OAuth.
- Supabase: Auth (email, Google y Apple), PostgreSQL, Storage privado y Realtime.
- Docker: frontend y backend en `docker-compose.yml`; Supabase como servicio gestionado.
- Despliegue: frontend en Vercel y backend Docker en Railway.
- Mapas: OpenStreetMap/Leaflet solo en resultados presenciales; ubicación exacta protegida antes de reservar.

## Entidades y API

Entidades principales: `User`, `ConsumerProfile`, `CoachProfile`, `Category`, `Subcategory`, `CoachService`, `CredentialDocument`, `AvailabilityRule`, `AvailabilityException`, `Conversation`, `Message`, `Booking`, `BookingPackage`, `Payment`, `Review`, `Cancellation`, `Report`, `Notification` y `AuditLog`.

API versionada bajo `/api/v1`: categorías, matching, perfiles, disponibilidad, conversaciones, mensajes, checkout, reservas, reseñas, credenciales, integraciones de vídeo, webhook Stripe y operaciones administrativas.

## Pagos y reservas

- Stripe Connect para profesionales.
- Comisión inicial del 15%.
- Cancelación gratuita hasta 24 horas antes.
- Reembolso y disputa gestionados por Stripe y administración.
- La reserva queda confirmada después del pago si el hueco es válido.
- Stripe genera el recibo; textos fiscales y legales se revisan antes de producción.

## Fases

1. Monorepo, React/Vite, FastAPI, Tailwind, shadcn, Docker, Supabase, Auth y roles.
2. Taxonomía y panel de administración.
3. Registro, perfiles y validación de entrenadores.
4. Home, cuestionario, matching, resultados y mapa.
5. Agenda, presencia, chat y notificaciones.
6. Reservas, bonos, Stripe, cancelaciones y reseñas.
7. Meet, Zoom, despliegue, monitorización y documentación.

## Aceptación

- El consumidor llega de cero a resultados relevantes mediante el cuestionario.
- No se permiten reservas de entrenadores no validados ni dobles reservas.
- El pago de prueba aplica la comisión y permite reembolso.
- Las reseñas solo proceden de reservas reales.
- El chat funciona en tiempo real y permite reportar/bloquear.
- La localización exacta no se muestra antes de reservar.
- El frontend se despliega en Vercel y el backend se levanta con Docker.
- El README permite ejecutar el proyecto sin instrucciones externas.
