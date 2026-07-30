from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, time as datetime_time, timedelta, timezone
import logging
from typing import Any
from zoneinfo import ZoneInfo

import stripe
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .config import settings
from .dependencies import close_auth_client, current_user
from .schemas import (
    AuthUser,
    AvailabilityExceptionRequest,
    AvailabilityRuleRequest,
    BlockUserRequest,
    CancellationRequest,
    Category,
    CategoryWriteRequest,
    CheckoutRequest,
    CheckoutResponse,
    CoachOnboardingRequest,
    CoachSummary,
    CoachVideoRequest,
    ConversationCreateRequest,
    CredentialCreateRequest,
    CustomVideoLinkRequest,
    MatchRequest,
    MatchResponse,
    MessageCreateRequest,
    OAuthUrlResponse,
    PackageCheckoutRequest,
    PackageCheckoutResponse,
    PackageBookingRequest,
    ReportCreateRequest,
    RespondsNowRequest,
    ReviewCreateRequest,
    ServiceCreateRequest,
    ServiceMode,
    VerificationRequest,
    VideoReviewRequest,
)
from .seed import CATEGORIES, COACHES
from .services import create_checkout, create_package_checkout, db, exchange_oauth_code, notify_user, oauth_url, provision_meeting, storage_signed_url


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    close_database = getattr(db, "close", None)
    if close_database is not None:
        await close_database()
    await close_auth_client()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="API funcional del marketplace CoachConnect.",
    lifespan=lifespan,
)

allowed_origins = {settings.frontend_url, "http://localhost:5173", "http://127.0.0.1:5173"}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def frontend_url_for_request(request: Request) -> str:
    """Keep local Checkout redirects on the origin that owns the auth session."""
    origin = request.headers.get("origin", "").rstrip("/")
    if settings.environment in {"development", "test", "testing"} and origin in {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    }:
        return origin
    return settings.frontend_url.rstrip("/")


@app.get("/health", tags=["system"])
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "environment": settings.environment,
        "database": "configured" if db.ready else "demo",
        "stripe": "configured" if settings.stripe_secret_key else "demo",
    }


async def assert_participant(conversation_id: str, user_id: str) -> dict[str, Any]:
    rows = await db.select("conversations", id=f"eq.{conversation_id}")
    if not rows or user_id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Conversación no encontrada")
    return rows[0]


async def assert_not_blocked(first_user_id: str, second_user_id: str) -> None:
    direct = await db.select("blocked_users", blocker_id=f"eq.{first_user_id}", blocked_id=f"eq.{second_user_id}")
    reverse = await db.select("blocked_users", blocker_id=f"eq.{second_user_id}", blocked_id=f"eq.{first_user_id}")
    if direct or reverse:
        raise HTTPException(403, "No puedes contactar con este usuario")


async def assert_admin(user_id: str) -> None:
    rows = await db.select("profiles", id=f"eq.{user_id}", role="eq.admin")
    if not rows:
        raise HTTPException(403, "Acceso reservado al equipo de CoachConnect")


@app.get("/api/v1/categories", response_model=list[Category], tags=["catalog"])
async def list_categories() -> list[Category]:
    if not db.ready:
        return CATEGORIES
    try:
        rows = await db.select("categories", active="eq.true", order="sort_order.asc")
        parents = [row for row in rows if row["parent_id"] is None]
        children: dict[str, list[str]] = {}
        for row in rows:
            if row["parent_id"]:
                children.setdefault(row["parent_id"], []).append(row["name_es"])
        return [
            Category(id=row["slug"], name=row["name_es"], name_en=row["name_en"], subcategories=children.get(row["id"], []))
            for row in parents
        ]
    except HTTPException:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return CATEGORIES
        raise


def rank_coaches(
    items: list[CoachSummary],
    request: MatchRequest,
) -> MatchResponse:
    ranked: list[tuple[tuple[int, int, int, float, int, int], CoachSummary, set[str]]] = []
    requested_subcategory = (request.subcategory or "").casefold()
    requested_languages = {item.casefold() for item in request.languages}
    for coach in items:
        reasons: list[str] = []
        failed_filters: set[str] = set()
        specialty_match = coach.category == request.category
        if specialty_match:
            reasons.append("Coincide con tu especialidad")
        else:
            failed_filters.add("especialidad")

        subcategory_match = bool(requested_subcategory and requested_subcategory in coach.specialty.casefold())
        if subcategory_match:
            reasons.append("Especialidad específica compatible")

        mode_match = not request.mode or coach.mode == request.mode or coach.mode.value == "hibrido"
        if request.mode and mode_match:
            reasons.append("Modalidad compatible")
        elif not mode_match:
            failed_filters.add("modalidad")

        city_match = not request.city or request.mode == ServiceMode.online or coach.city.casefold() == request.city.casefold()
        if request.city and city_match:
            reasons.append("En tu zona")
        elif not city_match:
            failed_filters.add("zona")

        if request.max_price and coach.price_from <= request.max_price:
            reasons.append("Dentro de tu presupuesto")
        elif request.max_price:
            failed_filters.add("presupuesto")

        if requested_languages and not requested_languages.intersection(language.casefold() for language in coach.languages):
            failed_filters.add("idioma")
        elif requested_languages:
            reasons.append("Habla tu idioma")

        ranking = (int(specialty_match), int(subcategory_match), int(city_match), coach.rating, coach.reviews, int(coach.responds_now))
        ranked.append((ranking, coach.model_copy(update={"match_reasons": reasons}), failed_filters))

    exact = [item for item in ranked if not item[2]]
    relaxed_filter: str | None = None
    eligible = exact
    if not eligible:
        relaxable = ("zona", "modalidad", "presupuesto")
        for criterion in relaxable:
            candidates = [item for item in ranked if item[2] == {criterion}]
            if candidates:
                eligible = candidates
                relaxed_filter = criterion
                break
    if not eligible:
        eligible = [item for item in ranked if "especialidad" not in item[2]]

    eligible.sort(key=lambda item: item[0], reverse=True)
    return MatchResponse(items=[coach for _, coach, _ in eligible], relaxed_filter=relaxed_filter)


async def remote_coaches() -> list[CoachSummary]:
    if not db.ready:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return COACHES
        raise HTTPException(503, "La base de datos no está configurada")
    try:
        rows = await db.select(
            "coach_profiles",
            select="*,profiles(display_name,avatar_url),coach_services(*,categories(slug,name_es))",
            verification_status="in.(credentials_submitted,under_review,verified)",
        )
        result: list[CoachSummary] = []
        for row in rows:
            services = [item for item in row.get("coach_services", []) if item.get("active")]
            if not services:
                continue
            primary = min(services, key=lambda item: item["price_cents"])
            category = primary.get("categories") or {}
            result.append(CoachSummary(
                id=row["user_id"],
                name=(row.get("profiles") or {}).get("display_name", "Entrenador CoachConnect"),
                avatar_url=(row.get("profiles") or {}).get("avatar_url"),
                specialty=row["headline"] or primary["name"],
                category=category.get("slug", "fitness"),
                mode=row["mode"],
                city=row.get("city") or "Online",
                rating=float(row["rating"]),
                reviews=row["review_count"],
                price_from=primary["price_cents"] / 100,
                next_slot="Consulta su agenda",
                responds_now=row["responds_now"],
                verified=row["verification_status"] == "verified",
                languages=row.get("languages") or ["es"],
            ))
        if result:
            return result
        return COACHES if settings.demo_mode and settings.environment in {"development", "test", "testing"} else []
    except HTTPException:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return COACHES
        raise


@app.post("/api/v1/matching/search", response_model=MatchResponse, tags=["matching"])
async def match_coaches(request: MatchRequest) -> MatchResponse:
    return rank_coaches(await remote_coaches(), request)


@app.get("/api/v1/coaches/{coach_id}", tags=["catalog"])
async def coach_detail(coach_id: str) -> dict[str, Any]:
    if db.ready:
        rows = await db.select(
            "coach_profiles",
            select="*,profiles(display_name,avatar_url),coach_services(*,categories(slug,name_es)),availability_rules(*)",
            user_id=f"eq.{coach_id}",
            verification_status="in.(credentials_submitted,under_review,verified)",
        )
        if rows:
            rows[0]["coach_services"] = [service for service in rows[0].get("coach_services", []) if service.get("active")]
            if rows[0].get("video_status") != "approved":
                rows[0]["video_path"] = None
            return rows[0]
    demo = next((coach for coach in COACHES if coach.id == coach_id), None)
    if not demo:
        raise HTTPException(404, "Entrenador no encontrado")
    return demo.model_dump()


@app.get("/api/v1/coaches/{coach_id}/slots", tags=["catalog"])
async def coach_slots(coach_id: str, service_id: str, days: int = Query(default=14, ge=1, le=31)) -> dict[str, Any]:
    services = await db.select("coach_services", id=f"eq.{service_id}", coach_id=f"eq.{coach_id}", active="eq.true")
    if not services:
        raise HTTPException(404, "Servicio no encontrado")
    duration = timedelta(minutes=services[0]["duration_minutes"])
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=days)
    rules = await db.select("availability_rules", coach_id=f"eq.{coach_id}")
    exceptions = await db.select(
        "availability_exceptions",
        coach_id=f"eq.{coach_id}",
        ends_at=f"gte.{now.isoformat()}",
        starts_at=f"lte.{horizon.isoformat()}",
    )
    reservations = await db.select(
        "bookings",
        coach_id=f"eq.{coach_id}",
        ends_at=f"gte.{now.isoformat()}",
        starts_at=f"lte.{horizon.isoformat()}",
        status="in.(pending_payment,confirmed)",
    )

    blocked = [
        (
            datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00")),
            datetime.fromisoformat(item["ends_at"].replace("Z", "+00:00")),
        )
        for item in [*reservations, *(item for item in exceptions if not item["available"])]
    ]
    windows: list[tuple[datetime, datetime]] = []
    for offset in range(days + 1):
        target = now.date() + timedelta(days=offset)
        for rule in rules:
            if target.weekday() != rule["weekday"]:
                continue
            zone = ZoneInfo(rule.get("timezone") or "Europe/Madrid")
            start = datetime.combine(target, datetime_time.fromisoformat(rule["starts_at"]), tzinfo=zone).astimezone(timezone.utc)
            end = datetime.combine(target, datetime_time.fromisoformat(rule["ends_at"]), tzinfo=zone).astimezone(timezone.utc)
            windows.append((start, end))
    windows.extend(
        (
            datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00")),
            datetime.fromisoformat(item["ends_at"].replace("Z", "+00:00")),
        )
        for item in exceptions
        if item["available"]
    )

    items: list[dict[str, str]] = []
    earliest = now + timedelta(minutes=30)
    for window_start, window_end in sorted(windows):
        cursor = max(window_start, earliest)
        cursor = cursor.replace(second=0, microsecond=0)
        remainder = cursor.minute % 30
        if remainder:
            cursor += timedelta(minutes=30 - remainder)
        while cursor + duration <= window_end:
            slot_end = cursor + duration
            if not any(cursor < blocked_end and slot_end > blocked_start for blocked_start, blocked_end in blocked):
                items.append({"starts_at": cursor.isoformat(), "ends_at": slot_end.isoformat()})
            cursor += timedelta(minutes=30)
    return {"items": items[:80]}


@app.get("/api/v1/me", tags=["account"])
async def me(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("profiles", id=f"eq.{user.id}")
    return rows[0] if rows else {"id": user.id, "display_name": user.email or "Usuario", "role": "consumer"}


@app.post("/api/v1/coach/onboarding", tags=["coach"])
async def coach_onboarding(payload: CoachOnboardingRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await db.update("profiles", {"display_name": payload.display_name, "role": "coach", "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{user.id}")
    return await db.upsert(
        "coach_profiles",
        {
            "user_id": user.id,
            "headline": payload.headline,
            "bio": payload.bio,
            "city": payload.city,
            "mode": payload.mode.value,
            "years_experience": payload.years_experience,
            "languages": payload.languages,
        },
        "user_id",
    )


@app.get("/api/v1/coach/profile", tags=["coach"])
async def my_coach_profile(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("coach_profiles", select="*,profiles(display_name,avatar_url)", user_id=f"eq.{user.id}")
    if not rows:
        raise HTTPException(404, "Perfil profesional no encontrado")
    return rows[0]


@app.post("/api/v1/coach/services", tags=["coach"])
async def create_service(payload: ServiceCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    return await db.insert("coach_services", {"coach_id": user.id, **payload.model_dump(mode="json")})


@app.get("/api/v1/coach/services", tags=["coach"])
async def my_services(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select("coach_services", coach_id=f"eq.{user.id}", order="name.asc")


@app.put("/api/v1/coach/services/{service_id}", tags=["coach"])
async def update_service(service_id: str, payload: ServiceCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.update(
        "coach_services",
        payload.model_dump(mode="json"),
        id=f"eq.{service_id}",
        coach_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Servicio no encontrado")
    return rows[0]


@app.delete("/api/v1/coach/services/{service_id}", tags=["coach"])
async def delete_service(service_id: str, user: AuthUser = Depends(current_user)) -> dict[str, bool]:
    rows = await db.update("coach_services", {"active": False}, id=f"eq.{service_id}", coach_id=f"eq.{user.id}")
    if not rows:
        raise HTTPException(404, "Servicio no encontrado")
    return {"deleted": True}


@app.get("/api/v1/coach/availability", tags=["coach"])
async def my_availability(user: AuthUser = Depends(current_user)) -> dict[str, list[dict[str, Any]]]:
    return {
        "rules": await db.select("availability_rules", coach_id=f"eq.{user.id}", order="weekday.asc"),
        "exceptions": await db.select("availability_exceptions", coach_id=f"eq.{user.id}", order="starts_at.asc"),
    }


@app.put("/api/v1/coach/availability", tags=["coach"])
async def replace_availability(payload: list[AvailabilityRuleRequest], user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await db.request("DELETE", "availability_rules", params={"coach_id": f"eq.{user.id}"})
    result = []
    for rule in payload:
        result.append(await db.insert("availability_rules", {"coach_id": user.id, **rule.model_dump()}))
    return result


@app.post("/api/v1/coach/availability/exceptions", tags=["coach"])
async def create_availability_exception(
    payload: AvailabilityExceptionRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    return await db.insert(
        "availability_exceptions",
        {"coach_id": user.id, **payload.model_dump(mode="json")},
    )


@app.delete("/api/v1/coach/availability/exceptions/{exception_id}", tags=["coach"])
async def delete_availability_exception(exception_id: str, user: AuthUser = Depends(current_user)) -> dict[str, bool]:
    rows = await db.request(
        "DELETE",
        "availability_exceptions",
        params={"id": f"eq.{exception_id}", "coach_id": f"eq.{user.id}"},
    )
    if not rows:
        raise HTTPException(404, "Excepción no encontrada")
    return {"deleted": True}


@app.patch("/api/v1/coach/responds-now", tags=["coach"])
async def set_responds_now(payload: RespondsNowRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.update(
        "coach_profiles",
        {"responds_now": payload.enabled, "updated_at": datetime.now(timezone.utc).isoformat()},
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Completa primero tu perfil profesional")
    return rows[0]


@app.post("/api/v1/coach/credentials", tags=["coach"])
async def record_credential(payload: CredentialCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    if not payload.storage_path.startswith(f"{user.id}/"):
        raise HTTPException(422, "La ruta del documento no pertenece al usuario")
    row = await db.insert("credential_documents", {"coach_id": user.id, **payload.model_dump()})
    await db.update("coach_profiles", {"verification_status": "credentials_submitted"}, user_id=f"eq.{user.id}")
    return row


@app.post("/api/v1/coach/video", tags=["coach"])
async def record_coach_video(payload: CoachVideoRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    if not payload.storage_path.startswith(f"{user.id}/"):
        raise HTTPException(422, "La ruta del vídeo no pertenece al usuario")
    rows = await db.update(
        "coach_profiles",
        {"video_path": payload.storage_path, "video_status": "pending", "video_review_note": None},
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Completa primero tu perfil profesional")
    return rows[0]


@app.post("/api/v1/checkout", response_model=CheckoutResponse, tags=["payments"])
async def checkout(payload: CheckoutRequest, request: Request, user: AuthUser = Depends(current_user)) -> CheckoutResponse:
    return CheckoutResponse(
        **await create_checkout(
            user.id,
            payload.service_id,
            payload.starts_at,
            payload.notes,
            payload.meeting_provider,
            frontend_url_for_request(request),
        )
    )


@app.post("/api/v1/packages/checkout", response_model=PackageCheckoutResponse, tags=["payments"])
async def package_checkout(
    payload: PackageCheckoutRequest,
    request: Request,
    user: AuthUser = Depends(current_user),
) -> PackageCheckoutResponse:
    return PackageCheckoutResponse(
        **await create_package_checkout(user.id, payload.service_id, frontend_url_for_request(request))
    )


@app.get("/api/v1/packages", tags=["bookings"])
async def packages(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select(
        "booking_packages",
        select="*,coach_services(name,duration_minutes),coach_profiles(profiles(display_name))",
        consumer_id=f"eq.{user.id}",
        order="created_at.desc",
    )


@app.post("/api/v1/packages/book", tags=["bookings"])
async def book_with_package(
    payload: PackageBookingRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    booking = await db.rpc(
        "create_package_booking",
        {
            "p_consumer_id": user.id,
            "p_package_id": payload.package_id,
            "p_starts_at": payload.starts_at.isoformat(),
            "p_meeting_provider": payload.meeting_provider,
        },
    )
    background.add_task(provision_meeting, booking["id"])
    return booking


@app.get("/api/v1/bookings", tags=["bookings"])
async def bookings(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select(
        "bookings",
        select="*,coach_services(name,duration_minutes),coach_profiles(headline,profiles(display_name))",
        or_=f"(consumer_id.eq.{user.id},coach_id.eq.{user.id})",
        order="starts_at.desc",
    )


@app.post("/api/v1/bookings/{booking_id}/cancel", tags=["bookings"])
async def cancel_booking(booking_id: str, payload: CancellationRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows or user.id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    starts_at = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00"))
    refundable = starts_at - datetime.now(timezone.utc)
    refund_cents = booking["amount_cents"] if refundable.total_seconds() >= 86400 else 0
    if refund_cents and booking.get("stripe_payment_intent_id") and settings.stripe_secret_key:
        stripe.api_key = settings.stripe_secret_key
        stripe.Refund.create(payment_intent=booking["stripe_payment_intent_id"])
    await db.update("bookings", {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
    cancellation = await db.insert("cancellations", {"booking_id": booking_id, "cancelled_by": user.id, "reason": payload.reason, "refund_cents": refund_cents})
    recipient_id = booking["coach_id"] if booking["consumer_id"] == user.id else booking["consumer_id"]
    await notify_user(recipient_id, "booking_cancelled", "Reserva cancelada", "La otra parte ha cancelado la sesión.", "/reservas")
    return cancellation


@app.post("/api/v1/bookings/{booking_id}/review", tags=["reviews"])
async def create_review(booking_id: str, payload: ReviewCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("bookings", id=f"eq.{booking_id}", consumer_id=f"eq.{user.id}", status="eq.completed")
    if not rows:
        raise HTTPException(409, "Solo puedes valorar una sesión completada")
    return await db.insert("reviews", {"booking_id": booking_id, "consumer_id": user.id, "coach_id": rows[0]["coach_id"], **payload.model_dump()})


@app.get("/api/v1/conversations", tags=["chat"])
async def conversations(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    rows = await db.select(
        "conversations",
        or_=f"(consumer_id.eq.{user.id},coach_id.eq.{user.id})", order="last_message_at.desc",
    )
    participant_ids = sorted({participant_id for row in rows for participant_id in (row["consumer_id"], row["coach_id"])})
    profiles = await db.select("profiles", select="id,display_name", id=f"in.({','.join(participant_ids)})") if participant_ids else []
    profiles_by_id = {profile["id"]: profile for profile in profiles}
    for row in rows:
        row["consumer"] = profiles_by_id.get(row["consumer_id"])
        row["coach"] = profiles_by_id.get(row["coach_id"])
    return rows


@app.post("/api/v1/conversations", tags=["chat"])
async def create_conversation(payload: ConversationCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_not_blocked(user.id, payload.coach_id)
    coaches = await db.select("coach_profiles", user_id=f"eq.{payload.coach_id}", verification_status="eq.verified")
    if not coaches:
        raise HTTPException(409, "Solo puedes contactar con entrenadores verificados")
    return await db.upsert("conversations", {"consumer_id": user.id, "coach_id": payload.coach_id}, "consumer_id,coach_id")


@app.get("/api/v1/conversations/{conversation_id}/messages", tags=["chat"])
async def messages(conversation_id: str, user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_participant(conversation_id, user.id)
    # Bound the payload as conversations grow. Fetch newest-first so the limit
    # never hides recent messages, then restore chronological display order.
    rows = await db.select(
        "messages",
        conversation_id=f"eq.{conversation_id}",
        order="created_at.desc",
        limit="200",
    )
    return list(reversed(rows))


async def notify_message_recipient(
    recipient_id: str,
    kind: str,
    title: str,
    body: str,
    action_url: str,
    message_id: str,
) -> None:
    try:
        await notify_user(recipient_id, kind, title, body, action_url)
    except Exception as exc:
        # Delivery is ancillary: the durable message must remain successful.
        detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
        logger.warning("Mensaje %s guardado, pero la notificación falló: %s", message_id, detail)


@app.post("/api/v1/conversations/{conversation_id}/messages", tags=["chat"])
async def send_message(
    conversation_id: str,
    payload: MessageCreateRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    conversation = await assert_participant(conversation_id, user.id)
    other_user_id = conversation["coach_id"] if conversation["consumer_id"] == user.id else conversation["consumer_id"]
    if payload.attachment_path and not payload.attachment_path.startswith(f"{conversation_id}/{user.id}/"):
        raise HTTPException(422, "La ruta del adjunto no pertenece a esta conversación")
    # These checks are independent. Running them together removes two network
    # round trips from the critical path while preserving all validations.
    _, existing_messages, sender_rows = await asyncio.gather(
        assert_not_blocked(user.id, other_user_id),
        db.select("messages", select="id", conversation_id=f"eq.{conversation_id}", limit="1"),
        db.select("profiles", select="display_name", id=f"eq.{user.id}"),
    )
    row = await db.insert(
        "messages",
        {
            "conversation_id": conversation_id,
            "sender_id": user.id,
            "body": payload.body,
            "attachment_path": payload.attachment_path,
        },
    )
    await db.update("conversations", {"last_message_at": row["created_at"]}, id=f"eq.{conversation_id}")
    sender_name = sender_rows[0]["display_name"] if sender_rows else (user.email or "Alguien")
    title = "Nueva conversación" if not existing_messages else "Nuevo mensaje"
    preview = payload.body.strip()[:120] or "Te ha enviado un archivo."
    background.add_task(
        notify_message_recipient,
        other_user_id,
        "conversation_started" if not existing_messages else "message",
        title,
        f"{sender_name}: {preview}",
        f"/mensajes?conversation={conversation_id}",
        row["id"],
    )
    return row


@app.get("/api/v1/notifications", tags=["notifications"])
async def notifications(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select("notifications", user_id=f"eq.{user.id}", order="created_at.desc")


@app.patch("/api/v1/notifications/{notification_id}/read", tags=["notifications"])
async def read_notification(notification_id: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.update(
        "notifications",
        {"read_at": datetime.now(timezone.utc).isoformat()},
        id=f"eq.{notification_id}",
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Notificación no encontrada")
    return rows[0]


@app.post("/api/v1/reports", tags=["moderation"])
async def create_report(payload: ReportCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    conversation_id = payload.conversation_id
    if payload.message_id:
        messages_found = await db.select("messages", id=f"eq.{payload.message_id}")
        if not messages_found:
            raise HTTPException(404, "Mensaje no encontrado")
        conversation_id = messages_found[0]["conversation_id"]
    if conversation_id:
        await assert_participant(conversation_id, user.id)
    elif not payload.reported_user_id:
        raise HTTPException(422, "Indica la conversación, mensaje o usuario denunciado")
    return await db.insert(
        "reports",
        {
            "reporter_id": user.id,
            **payload.model_dump(),
            "conversation_id": conversation_id,
        },
    )


@app.get("/api/v1/blocks", tags=["moderation"])
async def blocks(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select("blocked_users", blocker_id=f"eq.{user.id}", order="created_at.desc")


@app.post("/api/v1/blocks", tags=["moderation"])
async def block_user(payload: BlockUserRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    if payload.user_id == user.id:
        raise HTTPException(422, "No puedes bloquearte a ti mismo")
    return await db.upsert(
        "blocked_users",
        {"blocker_id": user.id, "blocked_id": payload.user_id},
        "blocker_id,blocked_id",
    )


@app.delete("/api/v1/blocks/{blocked_user_id}", tags=["moderation"])
async def unblock_user(blocked_user_id: str, user: AuthUser = Depends(current_user)) -> dict[str, bool]:
    rows = await db.request(
        "DELETE",
        "blocked_users",
        params={"blocker_id": f"eq.{user.id}", "blocked_id": f"eq.{blocked_user_id}"},
    )
    if not rows:
        raise HTTPException(404, "Bloqueo no encontrado")
    return {"deleted": True}


@app.get("/api/v1/integrations/{provider}/oauth-url", response_model=OAuthUrlResponse, tags=["integrations"])
async def integration_url(provider: str, user: AuthUser = Depends(current_user)) -> OAuthUrlResponse:
    return OAuthUrlResponse(provider=provider, url=oauth_url(provider, user.id))


@app.get("/api/v1/coach/integrations", tags=["integrations"])
async def coach_integrations(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    coaches = await db.select("coach_profiles", user_id=f"eq.{user.id}")
    connections = await db.select("integration_connections", user_id=f"eq.{user.id}")
    return {
        "stripe": bool(coaches and coaches[0].get("stripe_account_id")),
        "providers": [connection["provider"] for connection in connections],
        "custom_video_url": coaches[0].get("custom_video_url") if coaches else None,
    }


@app.put("/api/v1/coach/custom-video-link", tags=["integrations"])
async def custom_video_link(payload: CustomVideoLinkRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.update(
        "coach_profiles",
        {"custom_video_url": payload.url, "preferred_video_provider": "custom"},
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Completa primero tu perfil profesional")
    return rows[0]


@app.get("/api/v1/integrations/{provider}/callback", tags=["integrations"])
async def integration_callback(provider: str, code: str = Query(...), state: str = Query(...)) -> RedirectResponse:
    await exchange_oauth_code(provider, code, state)
    return RedirectResponse(f"{settings.frontend_url}/profesional?integration={provider}")


@app.post("/api/v1/stripe/connect", tags=["payments"])
async def stripe_connect(user: AuthUser = Depends(current_user)) -> dict[str, str]:
    if not settings.stripe_secret_key:
        raise HTTPException(503, "Stripe no está configurado")
    stripe.api_key = settings.stripe_secret_key
    coaches = await db.select("coach_profiles", user_id=f"eq.{user.id}")
    if not coaches:
        raise HTTPException(409, "Completa primero tu perfil profesional")
    account_id = coaches[0].get("stripe_account_id")
    if not account_id:
        account = stripe.Account.create(type="express", country="ES", email=user.email, capabilities={"card_payments": {"requested": True}, "transfers": {"requested": True}})
        account_id = account.id
        await db.update("coach_profiles", {"stripe_account_id": account_id}, user_id=f"eq.{user.id}")
    link = stripe.AccountLink.create(account=account_id, refresh_url=f"{settings.frontend_url}/profesional?stripe=refresh", return_url=f"{settings.frontend_url}/profesional?stripe=complete", type="account_onboarding")
    return {"url": link.url}


@app.post("/api/v1/webhooks/stripe", tags=["payments"])
async def stripe_webhook(request: Request, background: BackgroundTasks) -> dict[str, bool]:
    body = await request.body()
    signature = request.headers.get("stripe-signature", "")
    if not settings.stripe_webhook_secret:
        raise HTTPException(503, "Webhook de Stripe no configurado")
    try:
        event = stripe.Webhook.construct_event(body, signature, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(400, "Firma de Stripe no válida") from exc
    event_id = event["id"]
    existing_events = await db.select("stripe_webhook_events", id=f"eq.{event_id}")
    if existing_events and existing_events[0]["status"] == "processed":
        return {"received": True}
    if not existing_events:
        await db.insert("stripe_webhook_events", {"id": event_id, "event_type": event["type"]})
    obj = event["data"]["object"]
    if event["type"] == "checkout.session.completed":
        metadata = obj.get("metadata", {})
        booking_id = metadata.get("booking_id")
        package_id = metadata.get("package_id")
        if booking_id:
            await db.update("bookings", {"status": "confirmed", "stripe_payment_intent_id": obj.get("payment_intent"), "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
            await db.update("payments", {"status": "paid", "stripe_payment_intent_id": obj.get("payment_intent"), "updated_at": datetime.now(timezone.utc).isoformat()}, booking_id=f"eq.{booking_id}")
            bookings_found = await db.select("bookings", id=f"eq.{booking_id}")
            if bookings_found:
                booking = bookings_found[0]
                for recipient_id in {booking["consumer_id"], booking["coach_id"]}:
                    await notify_user(recipient_id, "booking_confirmed", "Reserva confirmada", "El pago se ha completado correctamente.", "/reservas")
            background.add_task(provision_meeting, booking_id)
        elif package_id:
            await db.update("booking_packages", {"status": "active"}, id=f"eq.{package_id}")
            await db.update("payments", {"status": "paid", "stripe_payment_intent_id": obj.get("payment_intent"), "updated_at": datetime.now(timezone.utc).isoformat()}, package_id=f"eq.{package_id}")
            packages_found = await db.select("booking_packages", id=f"eq.{package_id}")
            if packages_found:
                await notify_user(packages_found[0]["consumer_id"], "package_activated", "Bono activado", "Ya puedes reservar tus sesiones.", "/reservas")
    elif event["type"] == "checkout.session.expired":
        metadata = obj.get("metadata", {})
        booking_id = metadata.get("booking_id")
        package_id = metadata.get("package_id")
        if booking_id:
            await db.update("bookings", {"status": "cancelled"}, id=f"eq.{booking_id}")
            await db.update("payments", {"status": "failed"}, booking_id=f"eq.{booking_id}")
        elif package_id:
            await db.update("booking_packages", {"status": "expired"}, id=f"eq.{package_id}")
            await db.update("payments", {"status": "failed"}, package_id=f"eq.{package_id}")
    elif event["type"] in {"charge.refunded", "refund.updated"}:
        payment_intent = obj.get("payment_intent")
        if payment_intent:
            await db.update("payments", {"status": "refunded"}, stripe_payment_intent_id=f"eq.{payment_intent}")
    await db.update(
        "stripe_webhook_events",
        {"status": "processed", "processed_at": datetime.now(timezone.utc).isoformat()},
        id=f"eq.{event_id}",
    )
    return {"received": True}


@app.get("/api/v1/admin/credentials", tags=["admin"])
async def admin_credentials(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("credential_documents", order="created_at.asc")


@app.get("/api/v1/admin/credentials/{document_id}/download", tags=["admin"])
async def admin_credential_download(document_id: str, user: AuthUser = Depends(current_user)) -> dict[str, str]:
    await assert_admin(user.id)
    rows = await db.select("credential_documents", id=f"eq.{document_id}")
    if not rows:
        raise HTTPException(404, "Documento no encontrado")
    return {"url": await storage_signed_url("credentials", rows[0]["storage_path"])}


@app.get("/api/v1/admin/videos", tags=["admin"])
async def admin_videos(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select(
        "coach_profiles",
        select="user_id,video_path,video_status,video_review_note,profiles(display_name)",
        video_status="eq.pending",
    )


@app.get("/api/v1/admin/videos/{coach_id}/download", tags=["admin"])
async def admin_video_download(coach_id: str, user: AuthUser = Depends(current_user)) -> dict[str, str]:
    await assert_admin(user.id)
    rows = await db.select("coach_profiles", user_id=f"eq.{coach_id}")
    if not rows or not rows[0].get("video_path"):
        raise HTTPException(404, "Vídeo no encontrado")
    return {"url": await storage_signed_url("coach-videos", rows[0]["video_path"])}


@app.patch("/api/v1/admin/videos/{coach_id}", tags=["admin"])
async def admin_review_video(
    coach_id: str,
    payload: VideoReviewRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    if payload.status not in {"approved", "rejected"}:
        raise HTTPException(422, "Estado de vídeo no válido")
    rows = await db.update(
        "coach_profiles",
        {"video_status": payload.status, "video_review_note": payload.note},
        user_id=f"eq.{coach_id}",
    )
    if not rows:
        raise HTTPException(404, "Entrenador no encontrado")
    await db.insert("audit_logs", {"actor_id": user.id, "action": "coach.video.reviewed", "entity_type": "coach_profile", "entity_id": coach_id, "metadata": {"status": payload.status}})
    return rows[0]


@app.patch("/api/v1/admin/coaches/{coach_id}/verification", tags=["admin"])
async def verify_coach(coach_id: str, payload: VerificationRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_admin(user.id)
    if payload.status not in {"under_review", "verified", "rejected", "suspended"}:
        raise HTTPException(422, "Estado de verificación no válido")
    rows = await db.update("coach_profiles", {"verification_status": payload.status, "verification_note": payload.note, "updated_at": datetime.now(timezone.utc).isoformat()}, user_id=f"eq.{coach_id}")
    if not rows:
        raise HTTPException(404, "Entrenador no encontrado")
    if payload.status in {"verified", "rejected"}:
        await db.update(
            "credential_documents",
            {
                "status": "approved" if payload.status == "verified" else "rejected",
                "review_note": payload.note,
                "reviewed_at": datetime.now(timezone.utc).isoformat(),
            },
            coach_id=f"eq.{coach_id}",
            status="eq.pending",
        )
    await db.insert("audit_logs", {"actor_id": user.id, "action": "coach.verification.updated", "entity_type": "coach_profile", "entity_id": coach_id, "metadata": {"status": payload.status}})
    return rows[0]


@app.post("/api/v1/admin/categories", tags=["admin"])
async def admin_create_category(payload: CategoryWriteRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_admin(user.id)
    row = await db.insert("categories", payload.model_dump())
    await db.insert("audit_logs", {"actor_id": user.id, "action": "category.created", "entity_type": "category", "entity_id": row["id"]})
    return row


@app.get("/api/v1/admin/categories", tags=["admin"])
async def admin_categories(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("categories", order="sort_order.asc")


@app.put("/api/v1/admin/categories/{category_id}", tags=["admin"])
async def admin_update_category(
    category_id: str,
    payload: CategoryWriteRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    rows = await db.update("categories", payload.model_dump(), id=f"eq.{category_id}")
    if not rows:
        raise HTTPException(404, "Categoría no encontrada")
    await db.insert("audit_logs", {"actor_id": user.id, "action": "category.updated", "entity_type": "category", "entity_id": category_id})
    return rows[0]


@app.delete("/api/v1/admin/categories/{category_id}", tags=["admin"])
async def admin_archive_category(category_id: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_admin(user.id)
    rows = await db.update("categories", {"active": False}, id=f"eq.{category_id}")
    if not rows:
        raise HTTPException(404, "Categoría no encontrada")
    await db.insert("audit_logs", {"actor_id": user.id, "action": "category.archived", "entity_type": "category", "entity_id": category_id})
    return rows[0]


@app.get("/api/v1/admin/reports", tags=["admin"])
async def admin_reports(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("reports", order="created_at.asc")


@app.get("/api/v1/admin/bookings", tags=["admin"])
async def admin_bookings(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("bookings", select="*,coach_services(name)", order="created_at.desc")


@app.get("/api/v1/admin/payments", tags=["admin"])
async def admin_payments(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("payments", order="created_at.desc")


@app.patch("/api/v1/admin/reports/{report_id}", tags=["admin"])
async def admin_resolve_report(report_id: str, status_value: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_admin(user.id)
    if status_value not in {"reviewing", "resolved", "dismissed"}:
        raise HTTPException(422, "Estado de moderación no válido")
    rows = await db.update("reports", {"status": status_value}, id=f"eq.{report_id}")
    if not rows:
        raise HTTPException(404, "Denuncia no encontrada")
    await db.insert("audit_logs", {"actor_id": user.id, "action": "report.updated", "entity_type": "report", "entity_id": report_id, "metadata": {"status": status_value}})
    return rows[0]
