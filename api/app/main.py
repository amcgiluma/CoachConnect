from __future__ import annotations

import asyncio
import base64
import binascii
from contextlib import asynccontextmanager
from datetime import datetime, time as datetime_time, timedelta, timezone
import hashlib
import hmac
import json
import logging
import re
import unicodedata
from typing import Any, Literal
from zoneinfo import ZoneInfo

import stripe
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .config import settings
from .dependencies import close_auth_client, current_user
from .schemas import (
    AuthUser,
    AdminOutcomeResolutionRequest,
    AdminReportUpdateRequest,
    AdminSanctionCreateRequest,
    AdminSanctionRevokeRequest,
    AvailabilityExceptionRequest,
    AvailabilityRuleRequest,
    BlockUserRequest,
    BookingLocationRequest,
    BookingRescheduleCreateRequest,
    BookingRescheduleDecisionRequest,
    CalendarPreferenceUpdateRequest,
    BookingSettingsRequest,
    BookingDecisionRequest,
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
    NotificationPreferenceUpdateRequest,
    OAuthUrlResponse,
    PackageCheckoutRequest,
    PackageCheckoutResponse,
    PackageBookingRequest,
    ProfileUpdateRequest,
    ReportCreateRequest,
    RespondsNowRequest,
    ReviewReplyRequest,
    ReviewCreateRequest,
    ServiceCreateRequest,
    ServiceMode,
    SessionReportRequest,
    VerificationRequest,
    VideoReviewRequest,
    UserAccessRequest,
)
from .communications import process_communication_queue, publish_event, schedule_due_communications
from .seed import CATEGORIES, COACHES
from .services import (
    auth_admin_list_users,
    auth_admin_set_user_ban_duration,
    auth_admin_set_user_access,
    assert_user_capability,
    booking_notice_minutes,
    cancel_payment_intent,
    capture_payment_intent,
    client_reward_terms,
    create_checkout,
    create_package_checkout,
    db,
    exchange_oauth_code,
    notify_user,
    oauth_url,
    provision_meeting,
    refund_destination_payment,
    snapshot_service_location,
    storage_signed_url,
    stripe_account_status,
    stripe_receipt_url,
    validate_booking_schedule,
)


logger = logging.getLogger(__name__)

SANCTION_DETAILS_FOR_USER = {
    "account": "el acceso a la cuenta",
    "messaging": "el uso de la mensajería",
    "training": "la participación en nuevos entrenamientos",
}


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


def rank_coaches(
    items: list[CoachSummary],
    request: MatchRequest,
) -> MatchResponse:
    ranked: list[tuple[tuple[int, int, int, float, int, int], CoachSummary, set[str]]] = []
    requested_subcategory = normalize_matching_text(request.subcategory or "")
    requested_languages = {item.casefold() for item in request.languages}
    for coach in items:
        reasons: list[str] = []
        failed_filters: set[str] = set()
        specialty_match = coach.category == request.category
        if specialty_match:
            reasons.append("Coincide con tu especialidad")
        else:
            failed_filters.add("especialidad")

        searchable_specialties = [coach.specialty, *coach.specialties]
        subcategory_match = bool(requested_subcategory and any(
            requested_subcategory in normalize_matching_text(value)
            or normalize_matching_text(value) in requested_subcategory
            for value in searchable_specialties if value
        ))
        if subcategory_match:
            reasons.append("Especialidad específica compatible")
        elif requested_subcategory:
            failed_filters.add("disciplina")

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
        relaxable = ("zona", "modalidad", "presupuesto", "disciplina")
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


PUBLIC_COACH_SELECT = (
    "user_id,headline,bio,city,mode,verification_status,responds_now,rating,review_count,min_booking_notice_minutes,"
    "languages,preferred_video_provider,profiles(display_name,avatar_url),"
    "coach_services(id,category_id,name,description,mode,duration_minutes,price_cents,package_size,active,"
    "offer_type,booking_mode,expiry_days,cadence_weeks,acceptance_window_hours,request_booking_notice_minutes,"
    "booking_window_days,available_weekdays,available_start_time,available_end_time,"
    "categories(id,slug,name_es,parent_id))"
)


def normalize_matching_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(character for character in decomposed if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", " ", without_accents).strip()


async def remote_coaches(requested_category: str | None = None) -> list[CoachSummary]:
    if not db.ready:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return COACHES
        raise HTTPException(503, "La base de datos no está configurada")
    rows = await db.select(
        "coach_profiles",
        select=PUBLIC_COACH_SELECT,
        verification_status="eq.verified",
    )
    category_rows = await db.select("categories", select="id,slug,parent_id", active="eq.true")
    categories_by_id = {item["id"]: item for item in category_rows}

    def root_category_slug(service: dict[str, Any]) -> str:
        category = service.get("categories") or {}
        parent = categories_by_id.get(category.get("parent_id"))
        return (parent or category).get("slug", "fitness")

    result: list[CoachSummary] = []
    for row in rows:
        services = [item for item in row.get("coach_services", []) if item.get("active")]
        if not services:
            continue
        compatible_services = [item for item in services if root_category_slug(item) == requested_category]
        primary = min(compatible_services or services, key=lambda item: item["price_cents"])
        specialty_values = list(dict.fromkeys(
            value
            for service in (compatible_services or services)
            for value in (
                service.get("name"), service.get("description"),
                (service.get("categories") or {}).get("name_es"),
                (service.get("categories") or {}).get("slug"),
            )
            if value
        ))
        result.append(CoachSummary(
            id=row["user_id"],
            name=(row.get("profiles") or {}).get("display_name", "Entrenador CoachConnect"),
            avatar_url=(row.get("profiles") or {}).get("avatar_url"),
            specialty=row["headline"] or primary["name"],
            category=root_category_slug(primary),
            mode=row["mode"],
            city=row.get("city") or "Online",
            rating=float(row["rating"]),
            reviews=row["review_count"],
            price_from=primary["price_cents"] / 100,
            next_slot="Consulta su agenda",
            responds_now=row["responds_now"],
            verified=row["verification_status"] == "verified",
            languages=row.get("languages") or ["es"],
            specialties=specialty_values,
        ))
    return result


@app.post("/api/v1/matching/search", response_model=MatchResponse, tags=["matching"])
async def match_coaches(request: MatchRequest) -> MatchResponse:
    return rank_coaches(await remote_coaches(request.category), request)


@app.get("/api/v1/coaches/{coach_id}", tags=["catalog"])
async def coach_detail(coach_id: str) -> dict[str, Any]:
    if db.ready:
        rows = await db.select(
            "coach_profiles",
            select=f"{PUBLIC_COACH_SELECT},video_path,video_status",
            user_id=f"eq.{coach_id}",
            verification_status="eq.verified",
        )
        if rows:
            row = rows[0]
            video_path = row.pop("video_path", None)
            video_status = row.pop("video_status", None)
            row["coach_services"] = [service for service in row.get("coach_services", []) if service.get("active")]
            row["presentation_video_url"] = (
                await storage_signed_url("coach-videos", video_path, expires_in=3600)
                if video_path and video_status == "approved"
                else None
            )
            return row
    if db.ready:
        raise HTTPException(404, "Entrenador no encontrado")
    demo = next((coach for coach in COACHES if coach.id == coach_id), None)
    if not demo:
        raise HTTPException(404, "Entrenador no encontrado")
    return demo.model_dump()


@app.get("/api/v1/coaches/{coach_id}/slots", tags=["catalog"])
async def coach_slots(coach_id: str, service_id: str, days: int | None = Query(default=None, ge=1, le=365)) -> dict[str, Any]:
    services = await db.select("coach_services", id=f"eq.{service_id}", coach_id=f"eq.{coach_id}", active="eq.true")
    if not services:
        raise HTTPException(404, "Servicio no encontrado")
    service = services[0]
    service_horizon_days = int(service.get("booking_window_days") or 31)
    requested_days = min(days or service_horizon_days, service_horizon_days)
    service_weekdays = set(service.get("available_weekdays") or range(7))
    service_start_time = datetime_time.fromisoformat(service.get("available_start_time") or "00:00")
    service_end_time = datetime_time.fromisoformat(service.get("available_end_time") or "23:59:59")
    duration = timedelta(minutes=service["duration_minutes"])
    now = datetime.now(timezone.utc)
    anchor_horizon = now + timedelta(days=requested_days)
    horizon = anchor_horizon
    rules = await db.select("availability_rules", coach_id=f"eq.{coach_id}")
    coach_profiles = await db.select("coach_profiles", select="min_booking_notice_minutes", user_id=f"eq.{coach_id}")
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
    for offset in range(requested_days + 1):
        target = now.date() + timedelta(days=offset)
        if target.weekday() not in service_weekdays:
            continue
        for rule in rules:
            if target.weekday() != rule["weekday"]:
                continue
            zone = ZoneInfo(rule.get("timezone") or "Europe/Madrid")
            start = datetime.combine(target, max(datetime_time.fromisoformat(rule["starts_at"]), service_start_time), tzinfo=zone).astimezone(timezone.utc)
            end = datetime.combine(target, min(datetime_time.fromisoformat(rule["ends_at"]), service_end_time), tzinfo=zone).astimezone(timezone.utc)
            if end <= start:
                continue
            windows.append((start, end))
    exception_zone = ZoneInfo("Europe/Madrid")
    for item in exceptions:
        if not item["available"]:
            continue
        exception_start = datetime.fromisoformat(item["starts_at"].replace("Z", "+00:00"))
        exception_end = datetime.fromisoformat(item["ends_at"].replace("Z", "+00:00"))
        local_start = exception_start.astimezone(exception_zone)
        if local_start.weekday() not in service_weekdays:
            continue
        service_window_start = datetime.combine(local_start.date(), service_start_time, tzinfo=exception_zone).astimezone(timezone.utc)
        service_window_end = datetime.combine(local_start.date(), service_end_time, tzinfo=exception_zone).astimezone(timezone.utc)
        window_start = max(exception_start, service_window_start)
        window_end = min(exception_end, service_window_end)
        if window_end > window_start:
            windows.append((window_start, window_end))

    items: list[dict[str, str]] = []
    coach_profile = coach_profiles[0] if coach_profiles else {"min_booking_notice_minutes": 30}
    notice_minutes = booking_notice_minutes(service, coach_profile)
    earliest = now + timedelta(minutes=notice_minutes)
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
    if service.get("offer_type") == "recurring_plan" and service.get("recurring_schedule_mode", "fixed") == "fixed":
        timezone_name = rules[0].get("timezone") if rules else "Europe/Madrid"
        zone = ZoneInfo(timezone_name or "Europe/Madrid")
        available_starts = {item["starts_at"] for item in items}
        cadence = int(service.get("cadence_weeks") or 1)
        count = int(service.get("package_size") or 1)
        anchors: list[dict[str, Any]] = []
        for item in items:
            anchor = datetime.fromisoformat(item["starts_at"])
            if anchor > anchor_horizon:
                continue
            local_anchor = anchor.astimezone(zone)
            occurrences = [
                (local_anchor + timedelta(weeks=index * cadence)).astimezone(timezone.utc).isoformat()
                for index in range(count)
            ]
            if all(start in available_starts for start in occurrences):
                anchors.append({**item, "occurrences": occurrences})
        return {"items": anchors}
    return {"items": [item for item in items if datetime.fromisoformat(item["starts_at"]) <= anchor_horizon]}


@app.get("/api/v1/me", tags=["account"])
async def me(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("profiles", id=f"eq.{user.id}")
    profile = rows[0] if rows else {
        "id": user.id,
        "display_name": (user.email or "Usuario").split("@")[0],
        "role": "consumer",
    }
    return {**profile, "email": user.email}


@app.patch("/api/v1/me", tags=["account"])
async def update_me(payload: ProfileUpdateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    try:
        ZoneInfo(payload.timezone)
    except Exception as exc:
        raise HTTPException(422, "Zona horaria no válida") from exc
    if payload.avatar_url:
        expected_prefix = f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/avatars/{user.id}/"
        if db.ready and not payload.avatar_url.startswith(expected_prefix):
            raise HTTPException(422, "La foto de perfil debe pertenecer al usuario")
    updated_at = datetime.now(timezone.utc).isoformat()
    profile_payload = {
        "display_name": payload.display_name.strip(),
        "city": payload.city.strip() if payload.city else None,
        "avatar_url": payload.avatar_url,
        "timezone": payload.timezone,
        "updated_at": updated_at,
    }
    rows = await db.update("profiles", profile_payload, id=f"eq.{user.id}")
    if not rows:
        raise HTTPException(404, "Perfil no encontrado")
    if rows[0].get("role") == "coach":
        await db.update(
            "coach_profiles",
            {"city": profile_payload["city"], "updated_at": updated_at},
            user_id=f"eq.{user.id}",
        )
    return {**rows[0], "email": user.email}


@app.post("/api/v1/coach/onboarding", tags=["coach"])
async def coach_onboarding(payload: CoachOnboardingRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await db.update(
        "profiles",
        {"display_name": payload.display_name, "city": payload.city, "role": "coach", "updated_at": datetime.now(timezone.utc).isoformat()},
        id=f"eq.{user.id}",
    )
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
    rows = await db.select(
        "coach_profiles",
        select="*,profiles(display_name,avatar_url),coach_services(*,categories(slug,name_es)),availability_rules(*)",
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Perfil profesional no encontrado")
    row = rows[0]
    private_locations = await db.select("service_private_locations", service_id=f"in.({','.join(service['id'] for service in row.get('coach_services', []))})") if row.get("coach_services") else []
    locations_by_service = {item["service_id"]: item for item in private_locations}
    for service in row.get("coach_services", []):
        service["private_location"] = locations_by_service.get(service["id"])
    row["presentation_video_url"] = (
        await storage_signed_url("coach-videos", row["video_path"], expires_in=3600)
        if row.get("video_path")
        else None
    )
    return row


@app.post("/api/v1/coach/services", tags=["coach"])
async def create_service(payload: ServiceCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    service_data = payload.model_dump(mode="json")
    private_location = {
        "address_line": service_data.pop("private_address_line"),
        "locality": service_data.pop("private_locality"),
        "postal_code": service_data.pop("private_postal_code"),
        "instructions": service_data.pop("private_location_instructions"),
    }
    # Keep single sessions, flexible packs and legacy fixed series compatible
    # until the optional flexible-schedule migration is deployed remotely.
    if payload.recurring_schedule_mode == "fixed":
        service_data.pop("recurring_schedule_mode", None)
    service = await db.insert("coach_services", {"coach_id": user.id, **service_data})
    if payload.location_policy == "fixed_private":
        await db.upsert("service_private_locations", {"service_id": service["id"], **private_location}, "service_id")
        service["private_location"] = {"service_id": service["id"], **private_location}
    return service


@app.get("/api/v1/coach/services", tags=["coach"])
async def my_services(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    services = await db.select("coach_services", coach_id=f"eq.{user.id}", active="eq.true", order="name.asc")
    service_ids = [service["id"] for service in services]
    private_locations = await db.select(
        "service_private_locations", service_id=f"in.({','.join(service_ids)})",
    ) if service_ids else []
    locations_by_service = {item["service_id"]: item for item in private_locations}
    for service in services:
        service["private_location"] = locations_by_service.get(service["id"])
    return services


@app.put("/api/v1/coach/services/{service_id}", tags=["coach"])
async def update_service(service_id: str, payload: ServiceCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    service_data = payload.model_dump(mode="json")
    private_location = {
        "address_line": service_data.pop("private_address_line"),
        "locality": service_data.pop("private_locality"),
        "postal_code": service_data.pop("private_postal_code"),
        "instructions": service_data.pop("private_location_instructions"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.recurring_schedule_mode == "fixed":
        service_data.pop("recurring_schedule_mode", None)
    rows = await db.update(
        "coach_services",
        service_data,
        id=f"eq.{service_id}",
        coach_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Servicio no encontrado")
    if payload.location_policy == "fixed_private":
        await db.upsert("service_private_locations", {"service_id": service_id, **private_location}, "service_id")
        rows[0]["private_location"] = {"service_id": service_id, **private_location}
    else:
        await db.delete("service_private_locations", service_id=f"eq.{service_id}")
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


@app.get("/api/v1/coach/calendar", tags=["coach"])
async def coach_calendar(
    date_from: datetime = Query(alias="from"),
    date_to: datetime = Query(alias="to"),
    user: AuthUser = Depends(current_user),
) -> dict[str, list[dict[str, Any]]]:
    if date_to <= date_from:
        raise HTTPException(422, "El final del calendario debe ser posterior al inicio")
    if date_to - date_from > timedelta(days=62):
        raise HTTPException(422, "El rango del calendario no puede superar 62 días")
    return {
        "bookings": await db.select(
            "bookings",
            select="*,coach_services(name,description,duration_minutes,mode),profiles:profiles!bookings_consumer_id_fkey(display_name),session_reports(id,author_id,outcome,circumstances,note),reviews(id,author_id,revealed_at)",
            coach_id=f"eq.{user.id}",
            starts_at=f"lt.{date_to.isoformat()}",
            ends_at=f"gt.{date_from.isoformat()}",
            order="starts_at.asc",
        ),
        "exceptions": await db.select(
            "availability_exceptions",
            coach_id=f"eq.{user.id}",
            starts_at=f"lt.{date_to.isoformat()}",
            ends_at=f"gt.{date_from.isoformat()}",
            order="starts_at.asc",
        ),
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


@app.patch("/api/v1/coach/booking-settings", tags=["coach"])
async def update_booking_settings(payload: BookingSettingsRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.update(
        "coach_profiles",
        {
            "min_booking_notice_minutes": payload.min_booking_notice_minutes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        user_id=f"eq.{user.id}",
    )
    if not rows:
        raise HTTPException(404, "Perfil profesional no encontrado")
    return rows[0]


@app.post("/api/v1/coach/credentials", tags=["coach"])
async def record_credential(payload: CredentialCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    if not payload.storage_path.startswith(f"{user.id}/"):
        raise HTTPException(422, "La ruta del documento no pertenece al usuario")
    profiles = await db.select("coach_profiles", select="verification_status", user_id=f"eq.{user.id}")
    if not profiles:
        raise HTTPException(404, "Completa primero tu perfil profesional")
    current_status = profiles[0]["verification_status"]
    if current_status == "suspended":
        raise HTTPException(409, "El equipo de CoachConnect debe revisar un perfil suspendido")
    await db.update(
        "credential_documents",
        {
            "status": "rejected",
            "review_note": "Sustituido por un nuevo documento enviado por el entrenador",
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        },
        coach_id=f"eq.{user.id}",
        status="eq.pending",
    )
    row = await db.insert("credential_documents", {"coach_id": user.id, **payload.model_dump()})
    await db.update(
        "coach_profiles",
        {
            "verification_status": "credentials_submitted",
            "verification_note": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        user_id=f"eq.{user.id}",
    )
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


@app.get("/api/v1/coach/credentials/status", tags=["coach"])
async def credential_status(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    profiles = await db.select(
        "coach_profiles",
        select="verification_status,verification_note,video_path,video_status,video_review_note,updated_at",
        user_id=f"eq.{user.id}",
    )
    if not profiles:
        raise HTTPException(404, "Completa primero tu perfil profesional")
    documents = await db.select(
        "credential_documents",
        select="id,title,status,review_note,created_at,reviewed_at",
        coach_id=f"eq.{user.id}",
        order="created_at.desc",
        limit="1",
    )
    return {**profiles[0], "credential": documents[0] if documents else None}


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
        **await create_package_checkout(
            user.id,
            payload.service_id,
            frontend_url_for_request(request),
            payload.starts_at,
            payload.occurrences,
            payload.timezone,
        )
    )


@app.get("/api/v1/packages", tags=["bookings"])
async def packages(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select(
        "booking_packages",
        select="*,coach_services(name,duration_minutes,offer_type),coach_profiles(profiles(display_name)),session_credits(id,status,expires_at,booking_id)",
        consumer_id=f"eq.{user.id}",
        order="created_at.desc",
    )


async def ensure_package_credits(package: dict[str, Any]) -> None:
    existing = await db.select("session_credits", package_id=f"eq.{package['id']}")
    if existing:
        return
    expires_at = package.get("expires_at") or (datetime.now(timezone.utc) + timedelta(days=90)).isoformat()
    await db.insert_many("session_credits", [
        {
            "package_id": package["id"],
            "consumer_id": package["consumer_id"],
            "coach_id": package["coach_id"],
            "service_id": package["service_id"],
            "ordinal": ordinal,
            "status": "available",
            "expires_at": expires_at,
        }
        for ordinal in range(1, int(package["total_sessions"]) + 1)
    ])


async def advance_training_lifecycle() -> dict[str, Any]:
    if not getattr(db, "ready", False):
        return {}
    result = await db.rpc("advance_training_lifecycle", {})
    while True:
        job = await db.rpc("claim_lifecycle_job", {})
        if not job or not job.get("id"):
            break
        try:
            if job["kind"] != "cancel_authorization":
                raise RuntimeError(f"Trabajo de ciclo de vida desconocido: {job['kind']}")
            request_id = (job.get("payload") or {}).get("request_id")
            requests = await db.select("booking_requests", id=f"eq.{request_id}") if request_id else []
            if requests:
                booking_request = requests[0]
                payment_filter = (
                    {"package_id": f"eq.{booking_request['package_id']}"}
                    if booking_request.get("package_id")
                    else {"booking_id": f"eq.{booking_request['booking_id']}"}
                )
                payments = await db.select("payments", **payment_filter)
                payment = payments[0] if payments else None
                if payment and payment.get("stripe_payment_intent_id") and payment.get("status") in {"pending", "authorized"}:
                    cancel_payment_intent(payment["stripe_payment_intent_id"], f"request-expired:{request_id}")
                    await db.update("payments", {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{payment['id']}")
                now_iso = datetime.now(timezone.utc).isoformat()
                if booking_request.get("booking_id"):
                    await db.update("bookings", {"status": "cancelled", "updated_at": now_iso}, id=f"eq.{booking_request['booking_id']}")
                elif booking_request.get("package_id"):
                    await db.update("booking_packages", {"status": "expired"}, id=f"eq.{booking_request['package_id']}")
                    if booking_request.get("series_id"):
                        await db.update("booking_series", {"status": "expired", "updated_at": now_iso}, id=f"eq.{booking_request['series_id']}")
                        await db.update("bookings", {"status": "cancelled", "updated_at": now_iso}, series_id=f"eq.{booking_request['series_id']}")
                await publish_event(
                    "booking.request_expired",
                    "booking_request",
                    booking_request["id"],
                    f"booking.request_expired:{booking_request['id']}",
                )
            await db.rpc("finish_lifecycle_job", {"p_job_id": job["id"], "p_error": None})
        except Exception as exc:
            logger.exception("No se pudo procesar el trabajo de ciclo de vida %s", job.get("id"))
            await db.rpc("finish_lifecycle_job", {"p_job_id": job["id"], "p_error": str(exc)[:1000]})
    return result


@app.post("/api/v1/internal/lifecycle", tags=["internal"])
async def run_lifecycle(x_cron_secret: str = Header(default="")) -> dict[str, Any]:
    if not settings.internal_cron_secret or x_cron_secret != settings.internal_cron_secret:
        raise HTTPException(401, "Credencial interna no válida")
    lifecycle = await advance_training_lifecycle()
    scheduled = await schedule_due_communications()
    communication = await process_communication_queue()
    return {"lifecycle": lifecycle, "scheduled": scheduled, "communication": communication}


@app.post("/api/v1/packages/book", tags=["bookings"])
async def book_with_package(
    payload: PackageBookingRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    packages_found = await db.select(
        "booking_packages", id=f"eq.{payload.package_id}", consumer_id=f"eq.{user.id}", status="eq.active",
    )
    if not packages_found:
        raise HTTPException(409, "El bono no está activo")
    if packages_found[0]["coach_id"] == user.id:
        raise HTTPException(409, "No puedes reservar un entrenamiento contigo mismo")
    await asyncio.gather(
        assert_user_capability(user.id, "training", db),
        assert_user_capability(packages_found[0]["coach_id"], "training", db),
    )
    if packages_found[0].get("offer_type") == "recurring_plan":
        raise HTTPException(409, "Las fechas de este plan ya se reservaron al comprarlo")
    services_found = await db.select("coach_services", id=f"eq.{packages_found[0]['service_id']}", active="eq.true")
    coaches_found = await db.select("coach_profiles", user_id=f"eq.{packages_found[0]['coach_id']}")
    if not services_found or not coaches_found:
        raise HTTPException(409, "El servicio ya no está disponible")
    validate_booking_schedule(services_found[0], coaches_found[0], [payload.starts_at])
    await ensure_package_credits(packages_found[0])
    credits = await db.select(
        "session_credits", package_id=f"eq.{payload.package_id}", status="eq.available", order="ordinal.asc", limit="1",
    )
    if not credits:
        raise HTTPException(409, "No quedan sesiones disponibles en el bono")
    booking = await db.rpc(
        "create_package_booking",
        {
            "p_consumer_id": user.id,
            "p_package_id": payload.package_id,
            "p_starts_at": payload.starts_at.isoformat(),
            "p_meeting_provider": payload.meeting_provider,
        },
    )
    await db.update(
        "session_credits",
        {"status": "reserved", "booking_id": booking["id"], "updated_at": datetime.now(timezone.utc).isoformat()},
        id=f"eq.{credits[0]['id']}", status="eq.available",
    )
    if services_found[0].get("location_policy") == "fixed_private":
        await snapshot_service_location(booking["id"], services_found[0]["id"], packages_found[0]["coach_id"])
    await publish_event(
        "booking.credit_reserved", "booking", booking["id"], f"booking.credit_reserved:{booking['id']}", actor_id=user.id,
    )
    background.add_task(process_communication_queue)
    return booking


@app.get("/api/v1/bookings", tags=["bookings"])
async def bookings(
    perspective: Literal["consumer", "coach", "all"] = Query(default="all"),
    user: AuthUser = Depends(current_user),
) -> list[dict[str, Any]]:
    await advance_training_lifecycle()
    role_filter = (
        {"consumer_id": f"eq.{user.id}"}
        if perspective == "consumer"
        else {"coach_id": f"eq.{user.id}"}
        if perspective == "coach"
        else {"or_": f"(consumer_id.eq.{user.id},coach_id.eq.{user.id})"}
    )
    rows = await db.select(
        "bookings",
        select="*,coach_services(name,description,duration_minutes,mode,location_policy,public_area_label),coach_profiles(headline,profiles(display_name)),profiles:profiles!bookings_consumer_id_fkey(display_name),session_reports(id,author_id,outcome,circumstances,note),reviews(id,author_id,revealed_at),booking_reschedule_requests(*)",
        **role_filter,
        order="starts_at.desc",
    )
    confirmed_ids = [item["id"] for item in rows if item["status"] == "confirmed"]
    locations = await db.select("booking_private_locations", booking_id=f"in.({','.join(confirmed_ids)})") if confirmed_ids else []
    locations_by_booking = {item["booking_id"]: item for item in locations}
    for item in rows:
        item["private_location"] = locations_by_booking.get(item["id"])
    return rows


@app.get("/api/v1/feedback/pending", tags=["reviews"])
async def pending_feedback(
    perspective: Literal["consumer", "coach", "all"] = Query(default="all"),
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await advance_training_lifecycle()
    role_filter = (
        {"consumer_id": f"eq.{user.id}"}
        if perspective == "consumer"
        else {"coach_id": f"eq.{user.id}"}
        if perspective == "coach"
        else {"or_": f"(consumer_id.eq.{user.id},coach_id.eq.{user.id})"}
    )
    rows = await db.select(
        "bookings",
        select="*,coach_services(name,description,duration_minutes,mode),coach_profiles(profiles(display_name)),profiles:profiles!bookings_consumer_id_fkey(display_name),session_reports(id,author_id,outcome,circumstances,note),reviews(id,author_id,revealed_at)",
        status="in.(completed,disputed)",
        **role_filter,
        order="ends_at.desc",
    )
    now = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    for booking in rows:
        own_reports = [item for item in booking.get("session_reports") or [] if item.get("author_id") == user.id]
        own_reviews = [item for item in booking.get("reviews") or [] if item.get("author_id") == user.id]
        own_attended = bool(own_reports and own_reports[0].get("outcome") in {"attended", "attended_with_issues"})
        needs_outcome = (
            booking["status"] == "completed"
            and not booking.get("outcome_finalized_at")
            and not own_reports
        )
        deadline_anchor = booking.get("outcome_finalized_at") or booking["ends_at"]
        review_deadline = datetime.fromisoformat(deadline_anchor.replace("Z", "+00:00")) + timedelta(days=14)
        attended = booking.get("outcome_status") in {"attended", "attended_with_issues", "assumed_attended"}
        needs_review = (
            booking["status"] == "completed"
            and not own_reviews
            and review_deadline >= now
            and (attended or own_attended)
        )
        if not needs_outcome and not needs_review:
            continue
        booking_perspective = "consumer" if booking.get("consumer_id") == user.id else "coach"
        items.append({
            "booking": booking,
            "perspective": booking_perspective,
            "needs_outcome": needs_outcome,
            "needs_review": needs_review,
            "review_deadline": review_deadline.isoformat(),
            "action_url": (
                f"/reservas?booking={booking['id']}&feedback=1"
                if booking_perspective == "consumer"
                else f"/profesional?tab=reviews&booking={booking['id']}"
            ),
        })

    reward = await client_reward_terms(user.id)
    review_count = int(reward["qualifying_review_count"])
    next_tier_at = 10 if review_count < 10 else 25 if review_count < 25 else 50 if review_count < 50 else None
    reward["next_tier_at"] = next_tier_at
    reward["effective_platform_fee_percent"] = reward.pop("platform_fee_rate_bps") / 100
    return {"items": items, "reward": reward}


async def mark_feedback_notification_read(booking_id: str, user_id: str) -> None:
    """Notification housekeeping must never prevent saving the user's feedback."""
    try:
        await db.update(
            "notifications",
            {"read_at": datetime.now(timezone.utc).isoformat()},
            dedupe_key=f"eq.training-feedback:{booking_id}:{user_id}",
        )
    except Exception:
        logger.warning("Could not mark feedback notification as read", exc_info=True)


@app.post("/api/v1/bookings/{booking_id}/cancel", tags=["bookings"])
async def cancel_booking(booking_id: str, payload: CancellationRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows or user.id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    if booking["status"] not in {"pending_payment", "confirmed"}:
        raise HTTPException(409, "Esta sesión ya no se puede cancelar")
    starts_at = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00"))
    remaining = starts_at - datetime.now(timezone.utc)
    if remaining < timedelta(hours=24):
        raise HTTPException(409, "La cancelación se cierra 24 horas antes para ambas partes. Si hubo una incidencia, regístrala al finalizar la sesión")

    refund_cents = 0
    refund_id: str | None = None
    credits = await db.select("session_credits", booking_id=f"eq.{booking_id}")
    if credits:
        await db.update(
            "session_credits",
            {"status": "available", "booking_id": None, "updated_at": datetime.now(timezone.utc).isoformat()},
            id=f"eq.{credits[0]['id']}",
        )
        package_rows = await db.select("booking_packages", id=f"eq.{credits[0]['package_id']}") if credits[0].get("package_id") else []
        if package_rows:
            await db.update(
                "booking_packages",
                {"used_sessions": max(0, int(package_rows[0]["used_sessions"]) - 1), "status": "active"},
                id=f"eq.{package_rows[0]['id']}",
            )
    else:
        payments = await db.select("payments", booking_id=f"eq.{booking_id}", status="eq.paid")
        payment_intent_id = (payments[0].get("stripe_payment_intent_id") if payments else None) or booking.get("stripe_payment_intent_id")
        if payment_intent_id:
            refund = refund_destination_payment(payment_intent_id, f"booking-cancel:{booking_id}")
            refund_id = refund.get("id")
            refund_cents = int(booking["amount_cents"])
            if payments:
                await db.update("payments", {"status": "refunded", "stripe_refund_id": refund_id}, id=f"eq.{payments[0]['id']}")
    await db.update("bookings", {"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
    cancellation = await db.insert("cancellations", {"booking_id": booking_id, "cancelled_by": user.id, "reason": payload.reason, "refund_cents": refund_cents})
    await publish_event(
        "booking.cancelled", "booking", booking_id, f"booking.cancelled:{booking_id}", actor_id=user.id,
        payload={"credit_restored": bool(credits), "refund_id": refund_id},
    )
    await process_communication_queue()
    await advance_training_lifecycle()
    return {**cancellation, "credit_restored": bool(credits), "refund_id": refund_id}


@app.put("/api/v1/bookings/{booking_id}/location", tags=["bookings"])
async def confirm_booking_location(
    booking_id: str,
    payload: BookingLocationRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    rows = await db.select("bookings", select="*,coach_services(mode)", id=f"eq.{booking_id}", coach_id=f"eq.{user.id}")
    if not rows:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    if booking["status"] != "confirmed":
        raise HTTPException(409, "La ubicación exacta solo se confirma en reservas confirmadas")
    if (booking.get("coach_services") or {}).get("mode") == "online":
        raise HTTPException(409, "Una sesión online no necesita ubicación física")
    location = await db.upsert(
        "booking_private_locations",
        {
            "booking_id": booking_id, "source": "coach_confirmed", "confirmed_by": user.id,
            "updated_at": datetime.now(timezone.utc).isoformat(), **payload.model_dump(),
        },
        "booking_id",
    )
    await publish_event(
        "booking.location_updated", "booking", booking_id,
        f"booking.location_updated:{booking_id}:{location.get('updated_at') or location.get('confirmed_at')}", actor_id=user.id,
    )
    background.add_task(process_communication_queue)
    return location


@app.post("/api/v1/bookings/{booking_id}/reschedule-requests", tags=["bookings"])
async def propose_booking_reschedule(
    booking_id: str,
    payload: BookingRescheduleCreateRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows or user.id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    now = datetime.now(timezone.utc)
    original_start = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00"))
    proposed_start = payload.starts_at if payload.starts_at.tzinfo else payload.starts_at.replace(tzinfo=timezone.utc)
    if booking["status"] != "confirmed" or min(original_start, proposed_start) <= now + timedelta(hours=24):
        raise HTTPException(409, "Los cambios deben proponerse con al menos 24 horas de antelación")
    services, coaches = await asyncio.gather(
        db.select("coach_services", id=f"eq.{booking['service_id']}", active="eq.true"),
        db.select("coach_profiles", user_id=f"eq.{booking['coach_id']}"),
    )
    if not services or not coaches:
        raise HTTPException(409, "El servicio ya no está disponible")
    validate_booking_schedule(services[0], coaches[0], [proposed_start])
    proposed_end = proposed_start + timedelta(minutes=int(services[0]["duration_minutes"]))
    expires_at = min(now + timedelta(hours=24), original_start - timedelta(hours=24), proposed_start - timedelta(hours=24))
    request_row = await db.insert(
        "booking_reschedule_requests",
        {
            "booking_id": booking_id, "proposed_by": user.id,
            "proposed_starts_at": proposed_start.isoformat(), "proposed_ends_at": proposed_end.isoformat(),
            "reason": payload.reason.strip(), "expires_at": expires_at.isoformat(),
        },
    )
    await publish_event(
        "booking.reschedule_proposed", "booking", booking_id,
        f"booking.reschedule_proposed:{request_row['id']}", actor_id=user.id,
        payload={"request_id": request_row["id"], "recipient_ids": [booking["coach_id"] if user.id == booking["consumer_id"] else booking["consumer_id"]]},
    )
    background.add_task(process_communication_queue)
    return request_row


@app.post("/api/v1/bookings/reschedule-requests/{request_id}/decision", tags=["bookings"])
async def decide_booking_reschedule(
    request_id: str,
    payload: BookingRescheduleDecisionRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    requests = await db.select("booking_reschedule_requests", id=f"eq.{request_id}")
    if not requests or requests[0]["status"] != "pending":
        raise HTTPException(409, "La propuesta ya no está pendiente")
    request_row = requests[0]
    bookings_found = await db.select("bookings", id=f"eq.{request_row['booking_id']}")
    if not bookings_found:
        raise HTTPException(404, "Reserva no encontrada")
    booking = bookings_found[0]
    if user.id not in {booking["consumer_id"], booking["coach_id"]} or user.id == request_row["proposed_by"]:
        raise HTTPException(403, "No puedes decidir esta propuesta")
    if payload.decision == "accept":
        result = await db.rpc("accept_booking_reschedule", {"p_request_id": request_id, "p_user_id": user.id})
        kind = "booking.reschedule_accepted"
    else:
        rows = await db.update(
            "booking_reschedule_requests",
            {"status": "rejected", "decided_by": user.id, "decided_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()},
            id=f"eq.{request_id}", status="eq.pending",
        )
        if not rows:
            raise HTTPException(409, "La propuesta ya no está pendiente")
        result = rows[0]
        kind = "booking.reschedule_rejected"
    await publish_event(
        kind, "booking", booking["id"], f"{kind}:{request_id}", actor_id=user.id,
        payload={"request_id": request_id, "recipient_ids": [booking["consumer_id"], booking["coach_id"]]},
    )
    background.add_task(process_communication_queue)
    return result


@app.post("/api/v1/bookings/{booking_id}/outcome", tags=["bookings"])
async def report_booking_outcome(
    booking_id: str,
    payload: SessionReportRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await advance_training_lifecycle()
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows or user.id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    if booking["status"] not in {"completed", "disputed"}:
        raise HTTPException(409, "Podrás confirmar el resultado cuando termine la sesión")
    if booking.get("outcome_finalized_at"):
        raise HTTPException(409, "El resultado de esta sesión ya está cerrado")
    report = await db.upsert(
        "session_reports",
        {
            "booking_id": booking_id,
            "author_id": user.id,
            **payload.model_dump(),
            "response_due_at": (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        "booking_id,author_id",
    )
    recipient_id = booking["coach_id"] if user.id == booking["consumer_id"] else booking["consumer_id"]
    await publish_event(
        "booking.outcome_required", "booking", booking_id,
        f"booking.outcome_required:{booking_id}:{report['id']}", actor_id=user.id,
        payload={"recipient_ids": [recipient_id]},
    )
    await process_communication_queue()
    if payload.outcome not in {"attended", "attended_with_issues"}:
        await mark_feedback_notification_read(booking_id, user.id)
    await advance_training_lifecycle()
    return report


@app.post("/api/v1/bookings/{booking_id}/review", tags=["reviews"])
async def create_review(booking_id: str, payload: ReviewCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await advance_training_lifecycle()
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows or user.id not in {rows[0]["consumer_id"], rows[0]["coach_id"]}:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    own_reports = await db.select(
        "session_reports", booking_id=f"eq.{booking_id}", author_id=f"eq.{user.id}", limit="1",
    )
    own_attendance_confirmed = bool(own_reports and own_reports[0].get("outcome") in {"attended", "attended_with_issues"})
    if booking["status"] != "completed" or (
        booking.get("outcome_status") not in {"attended", "attended_with_issues", "assumed_attended"}
        and not own_attendance_confirmed
    ):
        raise HTTPException(409, "Solo puedes valorar una sesión realizada y sin disputa")
    if booking.get("outcome_finalized_at") and datetime.fromisoformat(booking["outcome_finalized_at"].replace("Z", "+00:00")) < datetime.now(timezone.utc) - timedelta(days=14):
        raise HTTPException(409, "El plazo de valoración ha terminado")

    target_role = "coach" if user.id == booking["consumer_id"] else "consumer"
    subject_id = booking["coach_id"] if target_role == "coach" else booking["consumer_id"]
    if target_role == "coach" and any(getattr(payload, field) is None for field in ("quality", "personalization", "safety")):
        raise HTTPException(422, "La valoración del entrenador necesita calidad, personalización y seguridad")
    if target_role == "consumer" and payload.commitment is None:
        raise HTTPException(422, "La valoración del cliente necesita compromiso")
    review = await db.upsert(
        "reviews",
        {
            "booking_id": booking_id,
            "consumer_id": booking["consumer_id"],
            "coach_id": booking["coach_id"],
            "author_id": user.id,
            "subject_id": subject_id,
            "target_role": target_role,
            **payload.model_dump(),
            "reveal_after": ((datetime.fromisoformat((booking.get("outcome_finalized_at") or booking["ends_at"]).replace("Z", "+00:00"))) + timedelta(days=14)).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        "booking_id,author_id",
    )
    await mark_feedback_notification_read(booking_id, user.id)
    pair = await db.select("reviews", booking_id=f"eq.{booking_id}")
    if len(pair) >= 2:
        revealed_at = datetime.now(timezone.utc).isoformat()
        await db.update("reviews", {"revealed_at": revealed_at, "updated_at": revealed_at}, booking_id=f"eq.{booking_id}")
        review["revealed_at"] = revealed_at
    return review


@app.get("/api/v1/coaches/{coach_id}/reviews", tags=["reviews"])
async def public_coach_reviews(coach_id: str) -> dict[str, Any]:
    await advance_training_lifecycle()
    reviews = await db.select(
        "reviews",
        select="*,profiles!reviews_author_id_fkey(display_name,avatar_url),review_replies(id,body,created_at)",
        subject_id=f"eq.{coach_id}", target_role="eq.coach", published="eq.true",
        moderation_status="eq.visible", revealed_at="not.is.null", order="revealed_at.desc",
    )
    summary_rows = await db.select("reputation_summaries", profile_id=f"eq.{coach_id}")
    latest_by_author: dict[str, dict[str, Any]] = {}
    for review in reviews:
        if isinstance(review.get("review_replies"), dict):
            review["review_replies"] = [review["review_replies"]]
        latest_by_author.setdefault(review["author_id"], review)
    return {"summary": summary_rows[0] if summary_rows else None, "items": list(latest_by_author.values())}


@app.get("/api/v1/coach/reviews", tags=["reviews"])
async def coach_reviews(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    reviews = await db.select(
        "reviews",
        select="*,profiles!reviews_author_id_fkey(display_name,avatar_url),review_replies(id,body,created_at)",
        subject_id=f"eq.{user.id}", target_role="eq.coach", revealed_at="not.is.null", order="revealed_at.desc",
    )
    summary_rows = await db.select("reputation_summaries", profile_id=f"eq.{user.id}")
    for review in reviews:
        if isinstance(review.get("review_replies"), dict):
            review["review_replies"] = [review["review_replies"]]
    return {"summary": summary_rows[0] if summary_rows else None, "items": reviews}


@app.get("/api/v1/clients/{client_id}/reputation", tags=["reviews"])
async def client_reputation(client_id: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    coach_profiles = await db.select("coach_profiles", user_id=f"eq.{user.id}")
    if not coach_profiles:
        raise HTTPException(403, "Solo los entrenadores pueden consultar esta reputación")
    related_bookings = await db.select("bookings", consumer_id=f"eq.{client_id}", coach_id=f"eq.{user.id}", limit="1")
    related_conversations = await db.select("conversations", consumer_id=f"eq.{client_id}", coach_id=f"eq.{user.id}", limit="1")
    if not related_bookings and not related_conversations:
        raise HTTPException(403, "Necesitas una solicitud, reserva o conversación con este cliente")
    profiles = await db.select("profiles", select="id,display_name,avatar_url", id=f"eq.{client_id}")
    summaries = await db.select("reputation_summaries", profile_id=f"eq.{client_id}")
    rewards = await db.select("client_rewards", consumer_id=f"eq.{client_id}")
    reviews = await db.select(
        "reviews", select="id,rating,comment,punctuality,communication,respect,commitment,revealed_at",
        subject_id=f"eq.{client_id}", target_role="eq.consumer", revealed_at="not.is.null",
        moderation_status="eq.visible", order="revealed_at.desc",
    )
    return {
        "profile": profiles[0] if profiles else None,
        "summary": summaries[0] if summaries else None,
        "reward": rewards[0] if rewards else {"qualifying_review_count": 0, "tier": "standard", "commission_discount_bps": 0},
        "items": reviews,
    }


@app.post("/api/v1/reviews/{review_id}/reply", tags=["reviews"])
async def reply_to_review(review_id: str, payload: ReviewReplyRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    reviews = await db.select(
        "reviews", id=f"eq.{review_id}", subject_id=f"eq.{user.id}", target_role="eq.coach", revealed_at="not.is.null",
    )
    if not reviews:
        raise HTTPException(404, "Reseña no encontrada")
    existing = await db.select("review_replies", review_id=f"eq.{review_id}")
    if existing:
        raise HTTPException(409, "Esta reseña ya tiene respuesta")
    return await db.insert("review_replies", {"review_id": review_id, "author_id": user.id, "body": payload.body.strip()})


@app.get("/api/v1/coach/booking-requests", tags=["bookings"])
async def coach_booking_requests(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await advance_training_lifecycle()
    rows = await db.select(
        "booking_requests",
        select="*,bookings(starts_at,ends_at,coach_services(name,price_cents)),booking_packages(total_sessions,offer_type,coach_services(name,price_cents))",
        coach_id=f"eq.{user.id}", order="created_at.desc",
    )
    consumer_ids = sorted({row["consumer_id"] for row in rows})
    booking_ids = sorted({row["booking_id"] for row in rows if row.get("booking_id")})
    package_ids = sorted({row["package_id"] for row in rows if row.get("package_id")})
    profiles, summaries, rewards, booking_payments, package_payments = await asyncio.gather(
        db.select("profiles", select="id,display_name,avatar_url", id=f"in.({','.join(consumer_ids)})") if consumer_ids else asyncio.sleep(0, result=[]),
        db.select("reputation_summaries", profile_id=f"in.({','.join(consumer_ids)})") if consumer_ids else asyncio.sleep(0, result=[]),
        db.select("client_rewards", consumer_id=f"in.({','.join(consumer_ids)})") if consumer_ids else asyncio.sleep(0, result=[]),
        db.select("payments", select="booking_id,amount_cents,platform_fee_cents,platform_fee_rate_bps,client_reward_tier", booking_id=f"in.({','.join(booking_ids)})") if booking_ids else asyncio.sleep(0, result=[]),
        db.select("payments", select="package_id,amount_cents,platform_fee_cents,platform_fee_rate_bps,client_reward_tier", package_id=f"in.({','.join(package_ids)})") if package_ids else asyncio.sleep(0, result=[]),
    )
    profiles_by_id = {item["id"]: item for item in profiles}
    summaries_by_id = {item["profile_id"]: item for item in summaries}
    rewards_by_id = {item["consumer_id"]: item for item in rewards}
    payments_by_booking = {item["booking_id"]: item for item in booking_payments}
    payments_by_package = {item["package_id"]: item for item in package_payments}
    return [{
        **row,
        "client": profiles_by_id.get(row["consumer_id"]),
        "client_reputation": summaries_by_id.get(row["consumer_id"]),
        "client_reward": rewards_by_id.get(row["consumer_id"], {
            "qualifying_review_count": 0, "tier": "standard", "commission_discount_bps": 0,
        }),
        "payment_terms": payments_by_booking.get(row.get("booking_id")) or payments_by_package.get(row.get("package_id")),
    } for row in rows]


@app.post("/api/v1/coach/booking-requests/{request_id}/decision", tags=["bookings"])
async def decide_booking_request(
    request_id: str,
    payload: BookingDecisionRequest,
    background: BackgroundTasks,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    requests = await db.select("booking_requests", id=f"eq.{request_id}", coach_id=f"eq.{user.id}")
    if not requests or requests[0]["status"] != "awaiting_coach":
        raise HTTPException(409, "La solicitud ya no está pendiente")
    booking_request = requests[0]
    if datetime.fromisoformat(booking_request["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
        raise HTTPException(409, "La solicitud ha caducado")
    payment_filter = {"package_id": f"eq.{booking_request['package_id']}"} if booking_request.get("package_id") else {"booking_id": f"eq.{booking_request['booking_id']}"}
    payments = await db.select("payments", **payment_filter)
    payment = payments[0] if payments else None
    intent_id = payment.get("stripe_payment_intent_id") if payment else None
    now_iso = datetime.now(timezone.utc).isoformat()

    if payload.decision == "accept":
        await asyncio.gather(
            assert_user_capability(user.id, "training", db),
            assert_user_capability(booking_request["consumer_id"], "training", db),
        )
        if intent_id:
            capture_payment_intent(intent_id, f"request-accept:{request_id}")
        await db.update("booking_requests", {"status": "accepted", "decided_at": now_iso, "reason_code": payload.reason_code}, id=f"eq.{request_id}")
        if payment:
            await db.update("payments", {"status": "paid", "stripe_receipt_url": stripe_receipt_url(intent_id), "updated_at": now_iso}, id=f"eq.{payment['id']}")
        if booking_request.get("booking_id"):
            await db.update("bookings", {"status": "confirmed", "request_expires_at": None, "updated_at": now_iso}, id=f"eq.{booking_request['booking_id']}")
            await publish_event(
                "booking.confirmed", "booking", booking_request["booking_id"],
                f"booking.confirmed:request:{request_id}", actor_id=user.id,
            )
        else:
            packages_found = await db.select("booking_packages", id=f"eq.{booking_request['package_id']}")
            if packages_found:
                await db.update("booking_packages", {"status": "active"}, id=f"eq.{booking_request['package_id']}")
                if packages_found[0].get("offer_type") == "flex_pack":
                    await ensure_package_credits({**packages_found[0], "status": "active"})
            if booking_request.get("series_id"):
                await db.update("booking_series", {"status": "confirmed", "updated_at": now_iso}, id=f"eq.{booking_request['series_id']}")
                series_bookings = await db.update("bookings", {"status": "confirmed", "updated_at": now_iso}, series_id=f"eq.{booking_request['series_id']}")
                for item in series_bookings:
                    await publish_event(
                        "booking.confirmed", "booking", item["id"], f"booking.confirmed:request:{request_id}:{item['id']}", actor_id=user.id,
                    )
            await publish_event(
                "package.activated", "package", booking_request["package_id"], f"package.activated:request:{request_id}", actor_id=user.id,
            )
        background.add_task(process_communication_queue)
    else:
        if intent_id:
            cancel_payment_intent(intent_id, f"request-reject:{request_id}")
        await db.update("booking_requests", {"status": "rejected", "decided_at": now_iso, "reason_code": payload.reason_code}, id=f"eq.{request_id}")
        if payment:
            await db.update("payments", {"status": "cancelled", "updated_at": now_iso}, id=f"eq.{payment['id']}")
        if booking_request.get("booking_id"):
            await db.update("bookings", {"status": "cancelled", "updated_at": now_iso}, id=f"eq.{booking_request['booking_id']}")
        else:
            await db.update("booking_packages", {"status": "cancelled"}, id=f"eq.{booking_request['package_id']}")
            if booking_request.get("series_id"):
                await db.update("booking_series", {"status": "cancelled", "updated_at": now_iso}, id=f"eq.{booking_request['series_id']}")
                await db.update("bookings", {"status": "cancelled", "updated_at": now_iso}, series_id=f"eq.{booking_request['series_id']}")
        await publish_event(
            "booking.request_rejected", "booking_request", request_id, f"booking.request_rejected:{request_id}", actor_id=user.id,
        )
        background.add_task(process_communication_queue)
    return {"id": request_id, "status": "accepted" if payload.decision == "accept" else "rejected"}


@app.get("/api/v1/conversations", tags=["chat"])
async def conversations(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    rows = await db.select(
        "conversations",
        or_=f"(consumer_id.eq.{user.id},coach_id.eq.{user.id})", order="last_message_at.desc",
    )
    participant_ids = sorted({participant_id for row in rows for participant_id in (row["consumer_id"], row["coach_id"])})
    profiles, own_blocks, incoming_blocks = await asyncio.gather(
        db.select("profiles", select="id,display_name,avatar_url,role", id=f"in.({','.join(participant_ids)})") if participant_ids else asyncio.sleep(0, result=[]),
        db.select("blocked_users", blocker_id=f"eq.{user.id}"),
        db.select("blocked_users", blocked_id=f"eq.{user.id}"),
    )
    profiles_by_id = {profile["id"]: profile for profile in profiles}
    own_blocked_ids = {item["blocked_id"] for item in own_blocks}
    incoming_blocker_ids = {item["blocker_id"] for item in incoming_blocks}
    for row in rows:
        row["consumer"] = profiles_by_id.get(row["consumer_id"])
        row["coach"] = profiles_by_id.get(row["coach_id"])
        other_user_id = row["coach_id"] if row["consumer_id"] == user.id else row["consumer_id"]
        row["blocked_by_me"] = other_user_id in own_blocked_ids
        row["blocked_me"] = other_user_id in incoming_blocker_ids
    return rows


@app.post("/api/v1/conversations", tags=["chat"])
async def create_conversation(payload: ConversationCreateRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_user_capability(user.id, "messaging", db)
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


@app.post("/api/v1/conversations/{conversation_id}/read", tags=["chat"])
async def mark_conversation_read(conversation_id: str, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    await assert_participant(conversation_id, user.id)
    latest = await db.select("messages", select="id,created_at", conversation_id=f"eq.{conversation_id}", order="created_at.desc", limit="1")
    read_at = datetime.now(timezone.utc).isoformat()
    return await db.upsert(
        "conversation_read_states",
        {
            "conversation_id": conversation_id, "user_id": user.id, "last_read_at": read_at,
            "last_read_message_id": latest[0]["id"] if latest else None, "updated_at": read_at,
        },
        "conversation_id,user_id",
    )


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


async def schedule_chat_digest(
    conversation_id: str,
    recipient_id: str,
    sender_name: str,
    preview: str,
    message_created_at: str,
    message_id: str,
) -> None:
    """Keep delayed email scheduling outside the successful message path."""
    try:
        await publish_event(
            "chat.digest",
            "conversation",
            conversation_id,
            f"chat.digest:{conversation_id}:{recipient_id}:{message_id}",
            payload={
                "recipient_ids": [recipient_id], "conversation_id": conversation_id,
                "sender_name": sender_name, "preview": preview, "message_count": 1,
                "message_created_at": message_created_at,
            },
            available_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
    except Exception as exc:
        logger.warning("No se pudo programar el resumen de la conversación %s: %s", conversation_id, exc)


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
    _, _, existing_messages, sender_rows = await asyncio.gather(
        assert_not_blocked(user.id, other_user_id),
        assert_user_capability(user.id, "messaging", db),
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
    if user.id == conversation["coach_id"]:
        try:
            previous_coach_messages, first_customer_messages = await asyncio.gather(
                db.select(
                    "messages", select="id", conversation_id=f"eq.{conversation_id}", sender_id=f"eq.{user.id}",
                    created_at=f"lt.{row['created_at']}", limit="1",
                ),
                db.select(
                    "messages", select="created_at", conversation_id=f"eq.{conversation_id}", sender_id=f"eq.{conversation['consumer_id']}",
                    order="created_at.asc", limit="1",
                ),
            )
            if not previous_coach_messages and first_customer_messages:
                first_at = datetime.fromisoformat(first_customer_messages[0]["created_at"].replace("Z", "+00:00"))
                response_at = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
                minutes = max(0, round((response_at - first_at).total_seconds() / 60))
                await db.upsert(
                    "coach_response_samples",
                    {
                        "conversation_id": conversation_id, "coach_id": user.id,
                        "first_customer_message_at": first_at.isoformat(), "first_coach_response_at": response_at.isoformat(),
                        "response_minutes": minutes,
                    },
                    "conversation_id",
                )
                samples = await db.select(
                    "coach_response_samples", select="response_minutes", coach_id=f"eq.{user.id}",
                    first_coach_response_at=f"gte.{(datetime.now(timezone.utc) - timedelta(days=90)).isoformat()}",
                )
                values = sorted(int(item["response_minutes"]) for item in samples)
                median = values[len(values) // 2] if len(values) % 2 else round((values[len(values) // 2 - 1] + values[len(values) // 2]) / 2)
                await db.upsert(
                    "reputation_summaries",
                    {"profile_id": user.id, "role": "coach", "median_response_minutes": median, "updated_at": datetime.now(timezone.utc).isoformat()},
                    "profile_id",
                )
        except Exception as exc:
            logger.warning("No se pudo actualizar la rapidez de respuesta del entrenador %s: %s", user.id, exc)
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
    background.add_task(
        schedule_chat_digest,
        conversation_id,
        other_user_id,
        sender_name,
        preview,
        row["created_at"],
        row["id"],
    )
    return row


@app.get("/api/v1/notifications", tags=["notifications"])
async def notifications(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    return await db.select("notifications", user_id=f"eq.{user.id}", order="created_at.desc")


@app.get("/api/v1/notification-preferences", tags=["notifications"])
async def notification_preferences(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    existing = await db.select("notification_preferences", user_id=f"eq.{user.id}", order="category.asc")
    existing_by_category = {item["category"]: item for item in existing}
    result = []
    for category in ("chat", "reminders", "reviews", "summaries"):
        if category not in existing_by_category:
            existing_by_category[category] = await db.upsert(
                "notification_preferences",
                {"user_id": user.id, "category": category, "email_enabled": True, "in_app_enabled": True},
                "user_id,category",
            )
        result.append(existing_by_category[category])
    return result


@app.patch("/api/v1/notification-preferences", tags=["notifications"])
async def update_notification_preference(
    payload: NotificationPreferenceUpdateRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    return await db.upsert(
        "notification_preferences",
        {"user_id": user.id, **payload.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()},
        "user_id,category",
    )


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
    reported_user_id = payload.reported_user_id
    message_row: dict[str, Any] | None = None
    if payload.message_id:
        messages_found = await db.select("messages", id=f"eq.{payload.message_id}")
        if not messages_found:
            raise HTTPException(404, "Mensaje no encontrado")
        message_row = messages_found[0]
        conversation_id = message_row["conversation_id"]
    if conversation_id:
        conversation = await assert_participant(conversation_id, user.id)
        inferred_user_id = conversation["coach_id"] if conversation["consumer_id"] == user.id else conversation["consumer_id"]
        if message_row:
            if message_row["sender_id"] == user.id:
                raise HTTPException(422, "No puedes denunciar tu propio mensaje")
            inferred_user_id = message_row["sender_id"]
        if reported_user_id and reported_user_id != inferred_user_id:
            raise HTTPException(422, "El usuario denunciado no pertenece a este contenido")
        reported_user_id = inferred_user_id
    elif not reported_user_id:
        raise HTTPException(422, "Indica la conversación, mensaje o usuario denunciado")
    if reported_user_id == user.id:
        raise HTTPException(422, "No puedes denunciarte a ti mismo")
    profiles = await db.select("profiles", select="id", id=f"eq.{reported_user_id}")
    if not profiles:
        raise HTTPException(404, "Usuario denunciado no encontrado")
    report = await db.insert(
        "reports",
        {
            "reporter_id": user.id,
            "conversation_id": conversation_id,
            "message_id": payload.message_id,
            "reported_user_id": reported_user_id,
            "reason": payload.reason.strip(),
            "details": payload.details.strip(),
        },
    )
    if payload.message_id:
        await db.update("messages", {"reported_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{payload.message_id}")
    return report


@app.get("/api/v1/blocks", tags=["moderation"])
async def blocks(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    rows = await db.select("blocked_users", blocker_id=f"eq.{user.id}", order="created_at.desc")
    blocked_ids = [item["blocked_id"] for item in rows]
    profiles = await db.select(
        "profiles", select="id,display_name,avatar_url,role", id=f"in.({','.join(blocked_ids)})",
    ) if blocked_ids else []
    profiles_by_id = {item["id"]: item for item in profiles}
    return [{**item, "profile": profiles_by_id.get(item["blocked_id"])} for item in rows]


@app.post("/api/v1/blocks", tags=["moderation"])
async def block_user(payload: BlockUserRequest, user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    if payload.user_id == user.id:
        raise HTTPException(422, "No puedes bloquearte a ti mismo")
    profiles = await db.select("profiles", select="id,display_name,avatar_url,role", id=f"eq.{payload.user_id}")
    if not profiles:
        raise HTTPException(404, "Usuario no encontrado")
    row = await db.upsert(
        "blocked_users",
        {"blocker_id": user.id, "blocked_id": payload.user_id},
        "blocker_id,blocked_id",
    )
    return {**row, "profile": profiles[0]}


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


@app.get("/api/v1/integrations", tags=["integrations"])
async def my_integrations(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    connections = await db.select(
        "integration_connections", select="id,provider,expires_at,metadata,calendar_enabled,calendar_id,updated_at",
        user_id=f"eq.{user.id}", order="provider.asc",
    )
    return {"providers": connections}


@app.delete("/api/v1/integrations/{provider}", tags=["integrations"])
async def disconnect_integration(provider: str, user: AuthUser = Depends(current_user)) -> dict[str, bool]:
    if provider not in {"google", "zoom"}:
        raise HTTPException(404, "Integración no disponible")
    rows = await db.delete("integration_connections", user_id=f"eq.{user.id}", provider=f"eq.{provider}")
    if not rows:
        raise HTTPException(404, "Integración no conectada")
    return {"disconnected": True}


@app.patch("/api/v1/integrations/google/calendar", tags=["integrations"])
async def update_google_calendar_preference(
    payload: CalendarPreferenceUpdateRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    rows = await db.update(
        "integration_connections",
        {
            "calendar_enabled": payload.enabled,
            "calendar_id": payload.calendar_id.strip(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        user_id=f"eq.{user.id}",
        provider="eq.google",
    )
    if not rows:
        raise HTTPException(404, "Conecta primero tu cuenta de Google")
    return rows[0]


@app.get("/api/v1/coach/integrations", tags=["integrations"])
async def coach_integrations(user: AuthUser = Depends(current_user)) -> dict[str, Any]:
    coaches = await db.select("coach_profiles", user_id=f"eq.{user.id}")
    connections = await db.select("integration_connections", user_id=f"eq.{user.id}")
    stripe_state = stripe_account_status(coaches[0].get("stripe_account_id") if coaches else None)
    return {
        "stripe": stripe_state["ready"],
        "stripe_status": stripe_state["status"],
        "stripe_requirements_due": stripe_state["requirements_due"],
        "providers": [connection["provider"] for connection in connections],
        "connections": [
            {
                "provider": connection["provider"],
                "calendar_enabled": connection.get("calendar_enabled", False),
                "calendar_id": connection.get("calendar_id", "primary"),
            }
            for connection in connections
        ],
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
    return RedirectResponse(f"{settings.frontend_url}/cuenta?integration={provider}")


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
    stripe_state = stripe_account_status(account_id)
    if stripe_state["status"] == "unavailable":
        raise HTTPException(502, "No se pudo consultar la cuenta de Stripe Connect")
    if stripe_state["ready"]:
        link = stripe.Account.create_login_link(account_id)
        return {"url": link.url}
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
        request_id = metadata.get("request_id")
        now_iso = datetime.now(timezone.utc).isoformat()
        if request_id:
            requests = await db.select("booking_requests", id=f"eq.{request_id}")
            if requests:
                booking_request = requests[0]
                await db.update("booking_requests", {"status": "awaiting_coach"}, id=f"eq.{request_id}")
                payment_filter = {"package_id": f"eq.{package_id}"} if package_id else {"booking_id": f"eq.{booking_id}"}
                await db.update(
                    "payments",
                    {"status": "authorized", "stripe_payment_intent_id": obj.get("payment_intent"), "updated_at": now_iso},
                    **payment_filter,
                )
                if booking_id:
                    await db.update(
                        "bookings",
                        {"status": "pending_payment", "stripe_payment_intent_id": obj.get("payment_intent"),
                         "request_expires_at": booking_request["expires_at"], "updated_at": now_iso},
                        id=f"eq.{booking_id}",
                    )
                else:
                    await db.update("booking_packages", {"status": "awaiting_coach"}, id=f"eq.{package_id}")
                    if booking_request.get("series_id"):
                        await db.update("booking_series", {"status": "awaiting_coach", "updated_at": now_iso}, id=f"eq.{booking_request['series_id']}")
                        await db.update(
                            "bookings",
                            {"status": "pending_payment", "request_expires_at": booking_request["expires_at"], "updated_at": now_iso},
                            series_id=f"eq.{booking_request['series_id']}",
                        )
                await publish_event(
                    "booking.request_submitted", "booking_request", request_id,
                    f"booking.request_submitted:{request_id}", actor_id=booking_request["consumer_id"],
                )
        elif booking_id:
            await db.update("bookings", {"status": "confirmed", "stripe_payment_intent_id": obj.get("payment_intent"), "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
            await db.update("payments", {"status": "paid", "stripe_payment_intent_id": obj.get("payment_intent"), "stripe_receipt_url": stripe_receipt_url(obj.get("payment_intent")), "updated_at": datetime.now(timezone.utc).isoformat()}, booking_id=f"eq.{booking_id}")
            bookings_found = await db.select("bookings", id=f"eq.{booking_id}")
            if bookings_found:
                await publish_event(
                    "booking.confirmed", "booking", booking_id, f"booking.confirmed:stripe:{event_id}",
                    actor_id=bookings_found[0]["consumer_id"], payload={"stripe_event_id": event_id},
                )
        elif package_id:
            await db.update("booking_packages", {"status": "active"}, id=f"eq.{package_id}")
            await db.update("payments", {"status": "paid", "stripe_payment_intent_id": obj.get("payment_intent"), "stripe_receipt_url": stripe_receipt_url(obj.get("payment_intent")), "updated_at": datetime.now(timezone.utc).isoformat()}, package_id=f"eq.{package_id}")
            packages_found = await db.select("booking_packages", id=f"eq.{package_id}")
            if packages_found:
                package = packages_found[0]
                if package.get("offer_type") == "recurring_plan":
                    series_found = await db.select("booking_series", package_id=f"eq.{package_id}")
                    if series_found:
                        await db.update("booking_series", {"status": "confirmed", "updated_at": now_iso}, id=f"eq.{series_found[0]['id']}")
                        series_bookings = await db.update("bookings", {"status": "confirmed", "updated_at": now_iso}, series_id=f"eq.{series_found[0]['id']}")
                        for item in series_bookings:
                            await publish_event(
                                "booking.confirmed", "booking", item["id"], f"booking.confirmed:stripe:{event_id}:{item['id']}",
                                actor_id=package["consumer_id"], payload={"stripe_event_id": event_id},
                            )
                else:
                    await ensure_package_credits(package)
                await publish_event(
                    "package.activated", "package", package_id, f"package.activated:stripe:{event_id}",
                    actor_id=package["consumer_id"], payload={"stripe_event_id": event_id},
                )
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
            series_found = await db.select("booking_series", package_id=f"eq.{package_id}")
            if series_found:
                await db.update("booking_series", {"status": "expired"}, id=f"eq.{series_found[0]['id']}")
                await db.update("bookings", {"status": "cancelled"}, series_id=f"eq.{series_found[0]['id']}")
        if metadata.get("request_id"):
            await db.update("booking_requests", {"status": "cancelled"}, id=f"eq.{metadata['request_id']}")
    elif event["type"] in {"charge.refunded", "refund.updated"}:
        payment_intent = obj.get("payment_intent")
        if payment_intent:
            changed_payments = await db.update("payments", {"status": "refunded"}, stripe_payment_intent_id=f"eq.{payment_intent}")
            for payment in changed_payments:
                if payment.get("booking_id"):
                    await publish_event(
                        "payment.refunded", "booking", payment["booking_id"], f"payment.refunded:{event_id}:{payment['id']}",
                        payload={"stripe_event_id": event_id},
                    )
    await db.update(
        "stripe_webhook_events",
        {"status": "processed", "processed_at": datetime.now(timezone.utc).isoformat()},
        id=f"eq.{event_id}",
    )
    background.add_task(process_communication_queue)
    return {"received": True}


@app.post("/api/v1/webhooks/resend", tags=["notifications"])
async def resend_webhook(request: Request) -> dict[str, bool]:
    if not settings.resend_webhook_secret:
        raise HTTPException(503, "Webhook de Resend no configurado")
    body = await request.body()
    webhook_id = request.headers.get("svix-id", "")
    timestamp = request.headers.get("svix-timestamp", "")
    signatures = request.headers.get("svix-signature", "")
    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise HTTPException(400, "Firma de Resend no válida") from exc
    if abs(datetime.now(timezone.utc).timestamp() - timestamp_value) > 300:
        raise HTTPException(400, "Webhook de Resend caducado")
    secret = settings.resend_webhook_secret.removeprefix("whsec_")
    try:
        secret_bytes = base64.b64decode(secret)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(503, "Secreto de webhook de Resend no válido") from exc
    signed = webhook_id.encode() + b"." + timestamp.encode() + b"." + body
    expected = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()
    provided = [item.split(",", 1)[1] for item in signatures.split() if item.startswith("v1,")]
    if not any(hmac.compare_digest(expected, item) for item in provided):
        raise HTTPException(400, "Firma de Resend no válida")
    if await db.select("resend_webhook_events", id=f"eq.{webhook_id}"):
        return {"received": True}
    try:
        payload = json.loads(body)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "Payload de Resend no válido") from exc
    event_type = payload.get("type", "unknown")
    await db.insert("resend_webhook_events", {"id": webhook_id, "event_type": event_type, "payload": payload})
    email_id = (payload.get("data") or {}).get("email_id")
    if email_id:
        deliveries = await db.select("communication_deliveries", provider_message_id=f"eq.{email_id}")
        if event_type == "email.delivered":
            await db.update("communication_deliveries", {"status": "delivered", "updated_at": datetime.now(timezone.utc).isoformat()}, provider_message_id=f"eq.{email_id}")
        elif event_type in {"email.bounced", "email.complained"}:
            await db.update("communication_deliveries", {"status": "dead", "last_error": event_type, "updated_at": datetime.now(timezone.utc).isoformat()}, provider_message_id=f"eq.{email_id}")
            for delivery in deliveries:
                if delivery.get("user_id"):
                    await db.upsert(
                        "email_suppressions",
                        {"user_id": delivery["user_id"], "reason": "complaint" if event_type == "email.complained" else "hard_bounce", "provider_event_id": webhook_id},
                        "user_id",
                    )
    await db.update("resend_webhook_events", {"processed_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{webhook_id}")
    return {"received": True}


@app.get("/api/v1/admin/credentials", tags=["admin"])
async def admin_credentials(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    documents = await db.select("credential_documents", status="eq.pending", order="created_at.asc")
    coach_ids = sorted({item["coach_id"] for item in documents})
    profiles = await db.select(
        "profiles",
        select="id,display_name",
        id=f"in.({','.join(coach_ids)})",
    ) if coach_ids else []
    profiles_by_id = {item["id"]: item for item in profiles}
    return [{**item, "profile": profiles_by_id.get(item["coach_id"])} for item in documents]


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
    await publish_event(
        "coach.verification", "coach", coach_id,
        f"coach.video:{coach_id}:{payload.status}:{datetime.now(timezone.utc).isoformat()}", actor_id=user.id,
        payload={"recipient_ids": [coach_id], "body": payload.note or f"El vídeo ha quedado {payload.status}.", "action_url": "/profesional?tab=validation"},
    )
    await process_communication_queue()
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
    await publish_event(
        "coach.verification", "coach", coach_id,
        f"coach.verification:{coach_id}:{payload.status}:{rows[0].get('updated_at')}", actor_id=user.id,
        payload={"recipient_ids": [coach_id], "body": payload.note or f"Tu validación profesional ha cambiado a {payload.status}.", "action_url": "/profesional?tab=validation"},
    )
    await process_communication_queue()
    return rows[0]


@app.get("/api/v1/admin/users", tags=["admin"])
async def admin_users(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    now_iso = datetime.now(timezone.utc).isoformat()
    profiles, coaches, auth_users, active_sanctions = await asyncio.gather(
        db.select("profiles", select="id,display_name,avatar_url,role,created_at,updated_at", order="created_at.desc"),
        db.select("coach_profiles", select="user_id,verification_status,verification_note"),
        auth_admin_list_users(),
        db.select(
            "moderation_sanctions",
            select="id,user_id,kind,reason,starts_at,expires_at,report_id,created_at",
            starts_at=f"lte.{now_iso}", expires_at=f"gt.{now_iso}", revoked_at="is.null",
            order="expires_at.asc",
        ),
    )
    profiles_by_id = {item["id"]: item for item in profiles}
    coaches_by_id = {item["user_id"]: item for item in coaches}
    auth_by_id = {item["id"]: item for item in auth_users}
    sanctions_by_user: dict[str, list[dict[str, Any]]] = {}
    for sanction in active_sanctions:
        sanctions_by_user.setdefault(sanction["user_id"], []).append(sanction)
    ordered_ids = [item["id"] for item in auth_users]
    ordered_ids.extend(item["id"] for item in profiles if item["id"] not in auth_by_id)
    result = []
    for user_id in ordered_ids:
        profile = profiles_by_id.get(user_id, {})
        auth_user = auth_by_id.get(user_id, {})
        banned_until = auth_user.get("banned_until")
        access_enabled = True
        if banned_until:
            try:
                access_enabled = datetime.fromisoformat(banned_until.replace("Z", "+00:00")) <= datetime.now(timezone.utc)
            except ValueError:
                access_enabled = False
        result.append({
            "id": user_id,
            "display_name": profile.get("display_name") or auth_user.get("email") or "Usuario",
            "email": auth_user.get("email"),
            "role": profile.get("role", "consumer"),
            "created_at": profile.get("created_at") or auth_user.get("created_at"),
            "last_sign_in_at": auth_user.get("last_sign_in_at"),
            "access_enabled": access_enabled and not any(item["kind"] == "account" for item in sanctions_by_user.get(user_id, [])),
            "coach": coaches_by_id.get(user_id),
            "active_sanctions": sanctions_by_user.get(user_id, []),
        })
    return result


@app.patch("/api/v1/admin/users/{target_user_id}/access", tags=["admin"])
async def admin_user_access(
    target_user_id: str,
    payload: UserAccessRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    if target_user_id == user.id and not payload.enabled:
        raise HTTPException(409, "No puedes revocar tu propia cuenta administradora")
    profiles = await db.select("profiles", select="id", id=f"eq.{target_user_id}")
    if not profiles:
        raise HTTPException(404, "Usuario no encontrado")
    await auth_admin_set_user_access(target_user_id, payload.enabled)
    await db.insert("audit_logs", {
        "actor_id": user.id,
        "action": "user.access.enabled" if payload.enabled else "user.access.revoked",
        "entity_type": "profile",
        "entity_id": target_user_id,
    })
    return {"id": target_user_id, "access_enabled": payload.enabled}


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
    reports = await db.select("reports", order="created_at.desc")
    profile_ids = sorted({profile_id for item in reports for profile_id in (item.get("reporter_id"), item.get("reported_user_id")) if profile_id})
    message_ids = sorted({item["message_id"] for item in reports if item.get("message_id")})
    report_ids = [item["id"] for item in reports]
    profiles, messages_found, sanctions = await asyncio.gather(
        db.select("profiles", select="id,display_name,avatar_url,role", id=f"in.({','.join(profile_ids)})") if profile_ids else asyncio.sleep(0, result=[]),
        db.select("messages", select="id,body,sender_id,created_at", id=f"in.({','.join(message_ids)})") if message_ids else asyncio.sleep(0, result=[]),
        db.select(
            "moderation_sanctions", select="id,user_id,kind,reason,starts_at,expires_at,revoked_at,report_id",
            report_id=f"in.({','.join(report_ids)})", order="created_at.desc",
        ) if report_ids else asyncio.sleep(0, result=[]),
    )
    profiles_by_id = {item["id"]: item for item in profiles}
    messages_by_id = {item["id"]: item for item in messages_found}
    sanctions_by_report: dict[str, list[dict[str, Any]]] = {}
    for sanction in sanctions:
        if sanction.get("report_id"):
            sanctions_by_report.setdefault(sanction["report_id"], []).append(sanction)
    return [
        {
            **item,
            "reporter": profiles_by_id.get(item["reporter_id"]),
            "reported_user": profiles_by_id.get(item.get("reported_user_id")),
            "message": messages_by_id.get(item.get("message_id")),
            "sanctions": sanctions_by_report.get(item["id"], []),
        }
        for item in reports
    ]


@app.get("/api/v1/admin/sanctions", tags=["admin"])
async def admin_sanctions(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    rows = await db.select("moderation_sanctions", order="created_at.desc")
    profile_ids = sorted({item["user_id"] for item in rows})
    profiles = await db.select(
        "profiles", select="id,display_name,avatar_url,role", id=f"in.({','.join(profile_ids)})",
    ) if profile_ids else []
    profiles_by_id = {item["id"]: item for item in profiles}
    return [{**item, "profile": profiles_by_id.get(item["user_id"])} for item in rows]


@app.post("/api/v1/admin/sanctions", tags=["admin"])
async def admin_create_sanction(
    payload: AdminSanctionCreateRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    if payload.user_id == user.id and payload.kind == "account":
        raise HTTPException(409, "No puedes suspender tu propia cuenta administradora")
    profiles = await db.select("profiles", select="id,display_name", id=f"eq.{payload.user_id}")
    if not profiles:
        raise HTTPException(404, "Usuario no encontrado")
    if payload.report_id:
        reports_found = await db.select("reports", id=f"eq.{payload.report_id}")
        if not reports_found:
            raise HTTPException(404, "Denuncia no encontrada")
        if reports_found[0].get("reported_user_id") != payload.user_id:
            raise HTTPException(422, "La sanción no corresponde al usuario denunciado")
    now = datetime.now(timezone.utc)
    existing = await db.select(
        "moderation_sanctions", select="id", user_id=f"eq.{payload.user_id}", kind=f"eq.{payload.kind}",
        expires_at=f"gt.{now.isoformat()}", revoked_at="is.null", limit="1",
    )
    if existing:
        raise HTTPException(409, "Este usuario ya tiene una restricción activa de ese tipo")
    expires_at = now + timedelta(hours=payload.duration_hours)
    row = await db.insert(
        "moderation_sanctions",
        {
            "user_id": payload.user_id,
            "kind": payload.kind,
            "reason": payload.reason.strip(),
            "starts_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "report_id": payload.report_id,
            "imposed_by": user.id,
        },
    )
    if payload.kind == "account":
        try:
            await auth_admin_set_user_ban_duration(payload.user_id, payload.duration_hours)
        except Exception:
            await db.update(
                "moderation_sanctions",
                {"revoked_at": datetime.now(timezone.utc).isoformat(), "revoked_by": user.id, "revocation_reason": "No se pudo aplicar en Supabase Auth"},
                id=f"eq.{row['id']}",
            )
            raise
    if payload.report_id:
        await db.update("reports", {"status": "reviewing"}, id=f"eq.{payload.report_id}")
    await db.insert("audit_logs", {
        "actor_id": user.id,
        "action": "moderation.sanction.created",
        "entity_type": "moderation_sanction",
        "entity_id": row["id"],
        "metadata": {"kind": payload.kind, "user_id": payload.user_id, "expires_at": expires_at.isoformat(), "report_id": payload.report_id},
    })
    await publish_event(
        "moderation.sanction", "moderation_sanction", row["id"], f"moderation.sanction:{row['id']}", actor_id=user.id,
        payload={
            "recipient_ids": [payload.user_id], "notify_operations": True,
            "body": f"CoachConnect ha restringido temporalmente {SANCTION_DETAILS_FOR_USER[payload.kind]} hasta el {expires_at.astimezone(ZoneInfo('Europe/Madrid')).strftime('%d/%m/%Y a las %H:%M')}.",
            "action_url": "/cuenta",
        },
    )
    await process_communication_queue()
    return {**row, "profile": profiles[0]}


@app.patch("/api/v1/admin/sanctions/{sanction_id}/revoke", tags=["admin"])
async def admin_revoke_sanction(
    sanction_id: str,
    payload: AdminSanctionRevokeRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    rows = await db.select("moderation_sanctions", id=f"eq.{sanction_id}")
    if not rows:
        raise HTTPException(404, "Restricción no encontrada")
    sanction = rows[0]
    if sanction.get("revoked_at"):
        raise HTTPException(409, "La restricción ya estaba revocada")
    if sanction["kind"] == "account":
        await auth_admin_set_user_ban_duration(sanction["user_id"], None)
    now_iso = datetime.now(timezone.utc).isoformat()
    updated = await db.update(
        "moderation_sanctions",
        {"revoked_at": now_iso, "revoked_by": user.id, "revocation_reason": payload.reason.strip()},
        id=f"eq.{sanction_id}", revoked_at="is.null",
    )
    if not updated:
        raise HTTPException(409, "La restricción ya estaba revocada")
    await db.insert("audit_logs", {
        "actor_id": user.id, "action": "moderation.sanction.revoked",
        "entity_type": "moderation_sanction", "entity_id": sanction_id,
        "metadata": {"kind": sanction["kind"], "user_id": sanction["user_id"]},
    })
    return updated[0]


@app.get("/api/v1/admin/session-disputes", tags=["admin"])
async def admin_session_disputes(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    await advance_training_lifecycle()
    disputes = await db.select(
        "bookings",
        select="*,coach_services(name,duration_minutes),session_reports(id,author_id,outcome,circumstances,note,created_at)",
        status="eq.disputed",
        order="starts_at.asc",
    )
    profile_ids = sorted({profile_id for item in disputes for profile_id in (item["consumer_id"], item["coach_id"])})
    profiles = await db.select("profiles", select="id,display_name,avatar_url", id=f"in.({','.join(profile_ids)})") if profile_ids else []
    profiles_by_id = {item["id"]: item for item in profiles}
    return [
        {
            **item,
            "consumer": profiles_by_id.get(item["consumer_id"]),
            "coach": profiles_by_id.get(item["coach_id"]),
        }
        for item in disputes
    ]


@app.patch("/api/v1/admin/session-disputes/{booking_id}", tags=["admin"])
async def admin_resolve_session_dispute(
    booking_id: str,
    payload: AdminOutcomeResolutionRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    rows = await db.select("bookings", id=f"eq.{booking_id}", status="eq.disputed")
    if not rows:
        raise HTTPException(404, "Incidencia de sesión no encontrada")
    booking = rows[0]
    restore_credit = payload.outcome in {"coach_no_show", "mutually_rescheduled", "technical_failure"}
    credits = await db.select("session_credits", booking_id=f"eq.{booking_id}")
    refund_id: str | None = None
    if restore_credit and not credits:
        payments = await db.select("payments", booking_id=f"eq.{booking_id}", status="eq.paid")
        payment = payments[0] if payments else None
        payment_intent_id = (payment or {}).get("stripe_payment_intent_id") or booking.get("stripe_payment_intent_id")
        if payment_intent_id:
            refund = refund_destination_payment(payment_intent_id, f"dispute-resolution:{booking_id}")
            refund_id = refund.get("id")
            if payment:
                await db.update("payments", {"status": "refunded", "stripe_refund_id": refund_id, "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{payment['id']}")
    if credits:
        credit = credits[0]
        credit_status = "available" if restore_credit else "consumed"
        await db.update(
            "session_credits",
            {"status": credit_status, "booking_id": None if restore_credit else booking_id, "updated_at": datetime.now(timezone.utc).isoformat()},
            id=f"eq.{credit['id']}",
        )
        if restore_credit and credit.get("package_id"):
            packages_found = await db.select("booking_packages", id=f"eq.{credit['package_id']}")
            if packages_found:
                await db.update(
                    "booking_packages",
                    {"used_sessions": max(0, int(packages_found[0]["used_sessions"]) - 1), "status": "active"},
                    id=f"eq.{credit['package_id']}",
                )
    now_iso = datetime.now(timezone.utc).isoformat()
    resolved = await db.update(
        "bookings",
        {"status": "completed", "outcome_status": payload.outcome, "outcome_finalized_at": now_iso, "updated_at": now_iso},
        id=f"eq.{booking_id}", status="eq.disputed",
    )
    if not resolved:
        raise HTTPException(409, "La incidencia ya fue resuelta")
    await db.insert("audit_logs", {
        "actor_id": user.id,
        "action": "booking.dispute.resolved",
        "entity_type": "booking",
        "entity_id": booking_id,
        "metadata": {"outcome": payload.outcome, "note": payload.note, "credit_restored": restore_credit and bool(credits), "refund_id": refund_id},
    })
    await publish_event(
        "booking.dispute_resolved", "booking", booking_id,
        f"booking.dispute_resolved:{booking_id}:{now_iso}", actor_id=user.id,
        payload={"notify_operations": True},
    )
    await process_communication_queue()
    await advance_training_lifecycle()
    return {**resolved[0], "credit_restored": restore_credit and bool(credits), "refund_id": refund_id}


@app.get("/api/v1/admin/bookings", tags=["admin"])
async def admin_bookings(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("bookings", select="*,coach_services(name)", order="created_at.desc")


@app.get("/api/v1/admin/payments", tags=["admin"])
async def admin_payments(user: AuthUser = Depends(current_user)) -> list[dict[str, Any]]:
    await assert_admin(user.id)
    return await db.select("payments", order="created_at.desc")


@app.patch("/api/v1/admin/reports/{report_id}", tags=["admin"])
async def admin_resolve_report(
    report_id: str,
    payload: AdminReportUpdateRequest,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    await assert_admin(user.id)
    now_iso = datetime.now(timezone.utc).isoformat()
    update_payload: dict[str, Any] = {
        "status": payload.status,
        "resolution_note": payload.resolution_note.strip(),
        "resolved_by": user.id if payload.status in {"resolved", "dismissed"} else None,
        "resolved_at": now_iso if payload.status in {"resolved", "dismissed"} else None,
    }
    rows = await db.update("reports", update_payload, id=f"eq.{report_id}")
    if not rows:
        raise HTTPException(404, "Denuncia no encontrada")
    await db.insert("audit_logs", {"actor_id": user.id, "action": "report.updated", "entity_type": "report", "entity_id": report_id, "metadata": {"status": payload.status}})
    return rows[0]
