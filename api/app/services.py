from __future__ import annotations

import asyncio
from datetime import datetime, time as datetime_time, timedelta, timezone
import base64
from html import escape
import hashlib
import hmac
import logging
import time
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import stripe
from cryptography.fernet import Fernet
from fastapi import HTTPException

from .config import settings


logger = logging.getLogger(__name__)


def platform_fee(amount_cents: int, rate_bps: int | None = None) -> int:
    effective_rate_bps = settings.platform_fee_percent * 100 if rate_bps is None else rate_bps
    return round(amount_cents * effective_rate_bps / 10000)


async def client_reward_terms(user_id: str) -> dict[str, Any]:
    rows = await db.select(
        "client_rewards",
        select="qualifying_review_count,tier,commission_discount_bps",
        consumer_id=f"eq.{user_id}",
        limit="1",
    )
    reward = rows[0] if rows else {}
    discount_bps = int(reward.get("commission_discount_bps") or 0)
    base_rate_bps = int(settings.platform_fee_percent) * 100
    return {
        "qualifying_review_count": int(reward.get("qualifying_review_count") or 0),
        "tier": reward.get("tier") or "standard",
        "commission_discount_bps": discount_bps,
        "platform_fee_rate_bps": max(0, base_rate_bps - discount_bps),
    }


def booking_notice_minutes(service: dict[str, Any], coach: dict[str, Any]) -> int:
    if service.get("booking_mode") == "request":
        return int(service.get("request_booking_notice_minutes") or 2160)
    return int(coach.get("min_booking_notice_minutes") or 0)


def validate_booking_schedule(
    service: dict[str, Any],
    coach: dict[str, Any],
    starts_at_values: list[datetime],
    timezone_name: str = "Europe/Madrid",
) -> None:
    """Enforce the same lead-time, weekday and horizon rules exposed as slots."""
    now = datetime.now(timezone.utc)
    earliest = now + timedelta(minutes=booking_notice_minutes(service, coach))
    latest = now + timedelta(days=int(service.get("booking_window_days") or 31))
    allowed_weekdays = set(service.get("available_weekdays") or range(7))
    service_start = datetime_time.fromisoformat(service.get("available_start_time") or "00:00")
    service_end = datetime_time.fromisoformat(service.get("available_end_time") or "23:59:59")
    try:
        local_zone = ZoneInfo(timezone_name)
    except Exception as exc:
        raise HTTPException(422, "Zona horaria no válida") from exc
    for value in starts_at_values:
        normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        normalized = normalized.astimezone(timezone.utc)
        if normalized < earliest:
            raise HTTPException(409, "Ese horario no cumple el margen mínimo de reserva aplicable al servicio")
        if normalized > latest:
            raise HTTPException(409, "Ese horario queda fuera del periodo de reserva de este servicio")
        if normalized.astimezone(local_zone).weekday() not in allowed_weekdays:
            raise HTTPException(409, "Este servicio no se ofrece ese día de la semana")
        local_value = normalized.astimezone(local_zone)
        local_end = local_value + timedelta(minutes=int(service.get("duration_minutes") or 0))
        if (
            local_value.time() < service_start
            or local_end.date() != local_value.date()
            or local_end.time() > service_end
        ):
            raise HTTPException(409, "Este servicio no se ofrece a esa hora")


def stripe_account_status(account_id: str | None) -> dict[str, Any]:
    """Return the usable Connect state, not merely whether an ID was saved."""
    if not account_id:
        return {"status": "not_connected", "ready": False, "requirements_due": 0}
    if not settings.stripe_secret_key:
        return {"status": "unavailable", "ready": False, "requirements_due": 0}

    stripe.api_key = settings.stripe_secret_key
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        logger.warning("No se pudo consultar la cuenta Connect %s: %s", account_id, exc)
        return {"status": "unavailable", "ready": False, "requirements_due": 0}

    requirements = account.get("requirements") or {}
    ready = bool(
        account.get("details_submitted")
        and account.get("charges_enabled")
        and account.get("payouts_enabled")
    )
    return {
        "status": "active" if ready else "pending",
        "ready": ready,
        "requirements_due": len(requirements.get("currently_due") or []),
    }


def require_ready_stripe_account(account_id: str | None) -> str:
    state = stripe_account_status(account_id)
    if state["status"] == "unavailable":
        raise HTTPException(503, "No se pudo comprobar Stripe Connect en este momento")
    if not state["ready"]:
        raise HTTPException(409, "El entrenador aún no ha completado Stripe Connect")
    return account_id or ""


def capture_payment_intent(payment_intent_id: str, idempotency_key: str) -> dict[str, Any]:
    if not settings.stripe_secret_key:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return {"id": payment_intent_id, "status": "succeeded"}
        raise HTTPException(503, "Stripe no está configurado")
    stripe.api_key = settings.stripe_secret_key
    try:
        return stripe.PaymentIntent.capture(payment_intent_id, idempotency_key=idempotency_key)
    except stripe.StripeError as exc:
        raise HTTPException(502, "Stripe no pudo capturar la autorización") from exc


def cancel_payment_intent(payment_intent_id: str, idempotency_key: str) -> dict[str, Any]:
    if not settings.stripe_secret_key:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return {"id": payment_intent_id, "status": "canceled"}
        raise HTTPException(503, "Stripe no está configurado")
    stripe.api_key = settings.stripe_secret_key
    try:
        return stripe.PaymentIntent.cancel(payment_intent_id, idempotency_key=idempotency_key)
    except stripe.StripeError as exc:
        raise HTTPException(502, "Stripe no pudo liberar la autorización") from exc


def refund_destination_payment(payment_intent_id: str, idempotency_key: str) -> dict[str, Any]:
    if not settings.stripe_secret_key:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return {"id": f"demo-refund-{payment_intent_id}", "status": "succeeded"}
        raise HTTPException(503, "Stripe no está configurado")
    stripe.api_key = settings.stripe_secret_key
    try:
        intent = stripe.PaymentIntent.retrieve(payment_intent_id)
        latest_charge = intent.get("latest_charge")
        if not latest_charge:
            raise HTTPException(409, "El pago todavía no tiene un cargo reembolsable")
        return stripe.Refund.create(
            charge=latest_charge,
            reverse_transfer=True,
            refund_application_fee=True,
            idempotency_key=idempotency_key,
        )
    except HTTPException:
        raise
    except stripe.StripeError as exc:
        raise HTTPException(502, "Stripe no pudo procesar el reembolso") from exc


def stripe_receipt_url(payment_intent_id: str | None) -> str | None:
    if not payment_intent_id or not settings.stripe_secret_key:
        return None
    stripe.api_key = settings.stripe_secret_key
    try:
        intent = stripe.PaymentIntent.retrieve(payment_intent_id, expand=["latest_charge"])
        charge = intent.get("latest_charge")
        return charge.get("receipt_url") if isinstance(charge, dict) else None
    except stripe.StripeError as exc:
        logger.warning("No se pudo obtener el recibo de %s: %s", payment_intent_id, exc)
        return None


class SupabaseAdmin:
    def __init__(self) -> None:
        self.base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": settings.supabase_secret_key,
            "Authorization": f"Bearer {settings.supabase_secret_key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        # Reusing one client keeps the TLS connection to PostgREST alive. Chat
        # sends perform several small requests, so reconnecting for every one
        # costs far more than the database work itself.
        self._client: httpx.AsyncClient | None = None

    def _http_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=15,
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
            )
        return self._client

    async def close(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()

    @property
    def ready(self) -> bool:
        if settings.environment in {"test", "testing"} and settings.demo_mode:
            return False
        return bool(settings.supabase_url and settings.supabase_secret_key)

    async def request(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self.ready:
            raise HTTPException(503, "La base de datos no está configurada")
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        response = await self._http_client().request(
            method,
            f"{self.base}/{table}",
            params=params,
            json=json,
            headers=headers,
        )
        if response.status_code >= 300:
            detail = response.json().get("message", response.text) if response.content else "Error de base de datos"
            # PostgREST uses HTTP 300 for ambiguous embedded relationships.
            # Treating that JSON error object as a successful row hides the real
            # database problem and later produces misleading KeyError failures.
            raise HTTPException(response.status_code if response.status_code >= 400 else 502, detail)
        if not response.content:
            return []
        data = response.json()
        return data if isinstance(data, list) else [data]

    async def select(self, table: str, select: str = "*", **filters: str) -> list[dict[str, Any]]:
        normalized = {("or" if key == "or_" else key): value for key, value in filters.items()}
        return await self.request("GET", table, params={"select": select, **normalized})

    async def insert(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = await self.request("POST", table, json=payload)
        return rows[0]

    async def insert_many(self, table: str, payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return await self.request("POST", table, json=payload)

    async def upsert(self, table: str, payload: dict[str, Any], on_conflict: str) -> dict[str, Any]:
        rows = await self.request(
            "POST", table, params={"on_conflict": on_conflict}, json=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
        return rows[0]

    async def update(self, table: str, payload: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        return await self.request("PATCH", table, params=filters, json=payload)

    async def delete(self, table: str, **filters: str) -> list[dict[str, Any]]:
        return await self.request("DELETE", table, params=filters)

    async def rpc(self, function: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = await self.request("POST", f"rpc/{function}", json=payload)
        if not rows:
            raise HTTPException(502, f"La función {function} no devolvió datos")
        return rows[0]


db = SupabaseAdmin()


SANCTION_DETAILS = {
    "account": "Tu cuenta está suspendida temporalmente por el equipo de CoachConnect",
    "messaging": "Tu acceso a la mensajería está suspendido temporalmente",
    "training": "Tu acceso a nuevos entrenamientos está suspendido temporalmente",
}


async def assert_user_capability(user_id: str, kind: str, database: Any | None = None) -> None:
    """Reject a capability while an administrator restriction is active."""
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = await (database or db).select(
        "moderation_sanctions",
        select="id,kind,expires_at",
        user_id=f"eq.{user_id}",
        kind=f"eq.{kind}",
        starts_at=f"lte.{now_iso}",
        expires_at=f"gt.{now_iso}",
        revoked_at="is.null",
        limit="1",
    )
    if rows:
        expires_at = datetime.fromisoformat(rows[0]["expires_at"].replace("Z", "+00:00"))
        formatted_expiry = expires_at.astimezone(ZoneInfo("Europe/Madrid")).strftime("%d/%m/%Y a las %H:%M")
        raise HTTPException(403, f"{SANCTION_DETAILS.get(kind, 'Esta acción está restringida')} hasta el {formatted_expiry}")


def _auth_admin_headers() -> dict[str, str]:
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise HTTPException(503, "Supabase Auth no está configurado")
    return {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }


async def auth_admin_list_users() -> list[dict[str, Any]]:
    """List Auth users from the trusted API layer without exposing the secret key."""
    users: list[dict[str, Any]] = []
    page = 1
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
                headers=_auth_admin_headers(),
                params={"page": page, "per_page": 1000},
            )
            if response.status_code >= 400:
                raise HTTPException(response.status_code, "No se pudo consultar el directorio de usuarios")
            payload = response.json()
            current_page = payload.get("users", []) if isinstance(payload, dict) else []
            users.extend(current_page)
            if len(current_page) < 1000:
                return users
            page += 1


async def auth_admin_set_user_access(user_id: str, enabled: bool) -> dict[str, Any]:
    """Ban or unban an Auth user using Supabase's server-only Admin API."""
    return await auth_admin_set_user_ban_duration(user_id, None if enabled else 876000)


async def auth_admin_set_user_ban_duration(user_id: str, duration_hours: int | None) -> dict[str, Any]:
    """Apply or clear an Auth ban for a bounded number of hours."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.put(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
            headers=_auth_admin_headers(),
            json={"ban_duration": "none" if duration_hours is None else f"{duration_hours}h"},
        )
    if response.status_code >= 400:
        detail = response.json().get("message", "No se pudo actualizar el acceso") if response.content else "No se pudo actualizar el acceso"
        raise HTTPException(response.status_code, detail)
    return response.json()


async def storage_signed_url(bucket: str, path: str, expires_in: int = 300) -> str:
    if not db.ready:
        raise HTTPException(503, "La base de datos no está configurada")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/sign/{bucket}/{path}",
            headers={
                "apikey": settings.supabase_secret_key,
                "Authorization": f"Bearer {settings.supabase_secret_key}",
                "Content-Type": "application/json",
            },
            json={"expiresIn": expires_in},
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "No se pudo abrir el archivo privado")
    signed_path = response.json().get("signedURL") or response.json().get("signedUrl")
    if not signed_path:
        raise HTTPException(502, "Supabase no devolvió una URL firmada")
    return signed_path if signed_path.startswith("http") else f"{settings.supabase_url.rstrip('/')}/storage/v1{signed_path}"


def _fernet() -> Fernet:
    material = settings.token_encryption_key
    if not material:
        if settings.environment not in {"development", "test", "testing"}:
            raise HTTPException(503, "TOKEN_ENCRYPTION_KEY no está configurada")
        material = "coachconnect-local-only"
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode()).digest())
    return Fernet(key)


def encrypt_token(value: str | None) -> str | None:
    return _fernet().encrypt(value.encode()).decode() if value else None


def decrypt_token(value: str | None) -> str | None:
    return _fernet().decrypt(value.encode()).decode() if value else None


def signed_oauth_state(user_id: str) -> str:
    secret = settings.supabase_secret_key or settings.oauth_client_secret or settings.zoom_client_secret
    if not secret:
        raise HTTPException(503, "OAuth no está configurado")
    issued_at = str(int(time.time()))
    message = f"{user_id}.{issued_at}"
    signature = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return f"{message}.{signature}"


def verify_oauth_state(state: str) -> str:
    try:
        user_id, issued_at_raw, signature = state.rsplit(".", 2)
        issued_at = int(issued_at_raw)
    except ValueError as exc:
        raise HTTPException(400, "Estado OAuth no válido") from exc
    if int(time.time()) - issued_at > settings.oauth_state_ttl_seconds or issued_at > int(time.time()) + 30:
        raise HTTPException(400, "El estado OAuth ha caducado")
    secret = settings.supabase_secret_key or settings.oauth_client_secret or settings.zoom_client_secret
    if not secret:
        raise HTTPException(503, "OAuth no está configurado")
    message = f"{user_id}.{issued_at_raw}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(400, "Estado OAuth no válido")
    return user_id


async def send_email(to: str | None, subject: str, html: str) -> bool:
    if not to or not settings.resend_api_key or not settings.email_from:
        return False
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}", "Content-Type": "application/json"},
            json={"from": settings.email_from, "to": [to], "subject": subject, "html": html},
        )
    response.raise_for_status()
    return True


async def notify_user(user_id: str, kind: str, title: str, body: str, action_url: str = "") -> dict[str, Any]:
    """Create an in-app notification only.

    Transactional email and calendar work is handled by the durable
    communications outbox. Keeping this helper channel-specific prevents a
    chat message from silently becoming an immediate email.
    """
    notification = await db.insert(
        "notifications",
        {"user_id": user_id, "kind": kind, "title": title, "body": body, "action_url": action_url},
    )
    return notification


async def snapshot_service_location(booking_id: str, service_id: str, coach_id: str) -> dict[str, Any] | None:
    """Copy a fixed private service location without exposing it to clients."""
    locations = await db.select("service_private_locations", service_id=f"eq.{service_id}")
    if not locations:
        return None
    source = locations[0]
    return await db.upsert(
        "booking_private_locations",
        {
            "booking_id": booking_id,
            "source": "service_snapshot",
            "address_line": source["address_line"],
            "locality": source["locality"],
            "postal_code": source.get("postal_code") or "",
            "latitude": source.get("latitude"),
            "longitude": source.get("longitude"),
            "instructions": source.get("instructions") or "",
            "confirmed_by": coach_id,
        },
        "booking_id",
    )


async def create_checkout(
    user_id: str,
    service_id: str,
    starts_at: datetime,
    notes: str,
    provider: str,
    frontend_url: str | None = None,
) -> dict[str, Any]:
    services = await db.select("coach_services", id=f"eq.{service_id}", active="eq.true")
    if not services:
        raise HTTPException(404, "Servicio no encontrado")
    service = services[0]
    if service["coach_id"] == user_id:
        raise HTTPException(409, "No puedes reservar un entrenamiento contigo mismo")
    await asyncio.gather(
        assert_user_capability(user_id, "training"),
        assert_user_capability(service["coach_id"], "training"),
    )
    coaches = await db.select("coach_profiles", user_id=f"eq.{service['coach_id']}")
    if not coaches or coaches[0]["verification_status"] != "verified":
        raise HTTPException(409, "Este entrenador aún no puede aceptar reservas")
    if settings.stripe_secret_key:
        require_ready_stripe_account(coaches[0].get("stripe_account_id"))
    normalized_start = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=timezone.utc)
    if normalized_start <= datetime.now(timezone.utc):
        raise HTTPException(422, "La reserva debe ser futura")
    validate_booking_schedule(service, coaches[0], [normalized_start])
    reward = await client_reward_terms(user_id)
    fee_rate_bps = int(reward["platform_fee_rate_bps"])
    amount = service["price_cents"]
    fee_cents = platform_fee(amount, fee_rate_bps)
    booking = await db.rpc(
        "create_pending_booking",
        {
            "p_consumer_id": user_id,
            "p_service_id": service_id,
            "p_starts_at": normalized_start.isoformat(),
            "p_notes": notes,
            "p_meeting_provider": provider,
            "p_platform_fee_percent": fee_rate_bps / 100,
        },
    )
    if service.get("location_policy") == "fixed_private":
        await snapshot_service_location(booking["id"], service_id, service["coach_id"])
    request_row: dict[str, Any] | None = None
    if service.get("booking_mode") == "request":
        request_row = await db.insert(
            "booking_requests",
            {
                "booking_id": booking["id"],
                "consumer_id": user_id,
                "coach_id": service["coach_id"],
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(),
            },
        )
    if not settings.stripe_secret_key:
        if not (settings.demo_mode and settings.environment in {"development", "test", "testing"}):
            await db.update("bookings", {"status": "cancelled"}, id=f"eq.{booking['id']}")
            raise HTTPException(503, "Stripe no está configurado")
        return {"booking_id": booking["id"], "checkout_url": None, "status": "pending_payment"}

    stripe.api_key = settings.stripe_secret_key
    return_url = (frontend_url or settings.frontend_url).rstrip("/")
    checkout_args: dict[str, Any] = {
        "mode": "payment",
        "line_items": [{
            "quantity": 1,
            "price_data": {
                "currency": "eur",
                "unit_amount": amount,
                "product_data": {"name": service["name"], "description": service.get("description") or "Sesión CoachConnect"},
            },
        }],
        "success_url": f"{return_url}/reservas?checkout=success&booking={booking['id']}",
        "cancel_url": f"{return_url}/entrenadores/{service['coach_id']}?checkout=cancelled",
        "metadata": {"booking_id": booking["id"], **({"request_id": request_row["id"]} if request_row else {})},
        "expires_at": int(time.time()) + 1800,
    }
    stripe_account = coaches[0].get("stripe_account_id")
    if stripe_account:
        checkout_args["payment_intent_data"] = {
            "application_fee_amount": fee_cents,
            "transfer_data": {"destination": stripe_account},
            **({"capture_method": "manual"} if request_row else {}),
        }
    if request_row:
        checkout_args["payment_method_types"] = ["card"]
    try:
        session = stripe.checkout.Session.create(**checkout_args)
    except stripe.StripeError as exc:
        await db.update("bookings", {"status": "cancelled"}, id=f"eq.{booking['id']}")
        raise HTTPException(502, "Stripe no pudo iniciar el pago") from exc
    await db.insert(
        "payments",
        {
            "booking_id": booking["id"],
            "consumer_id": user_id,
            "coach_id": service["coach_id"],
            "stripe_checkout_session_id": session.id,
            "amount_cents": amount,
            "platform_fee_cents": fee_cents,
            "platform_fee_rate_bps": fee_rate_bps,
            "client_reward_tier": reward["tier"],
            "capture_method": "manual" if request_row else "automatic",
            "authorization_expires_at": request_row.get("expires_at") if request_row else None,
            "idempotency_key": f"checkout:{booking['id']}",
        },
    )
    return {"booking_id": booking["id"], "checkout_url": session.url, "status": "pending_payment"}


async def create_package_checkout(
    user_id: str,
    service_id: str,
    frontend_url: str | None = None,
    starts_at: datetime | None = None,
    occurrences: list[datetime] | None = None,
    client_timezone: str = "Europe/Madrid",
) -> dict[str, Any]:
    services = await db.select("coach_services", id=f"eq.{service_id}", active="eq.true")
    if not services:
        raise HTTPException(404, "Servicio no encontrado")
    service = services[0]
    if service["coach_id"] == user_id:
        raise HTTPException(409, "No puedes comprar ni reservar tu propio servicio")
    await asyncio.gather(
        assert_user_capability(user_id, "training"),
        assert_user_capability(service["coach_id"], "training"),
    )
    if service["package_size"] <= 1 or service.get("offer_type", "flex_pack") == "single":
        raise HTTPException(409, "Este servicio no es un bono")
    coaches = await db.select("coach_profiles", user_id=f"eq.{service['coach_id']}")
    if not coaches or coaches[0]["verification_status"] != "verified":
        raise HTTPException(409, "Este entrenador aún no puede aceptar pagos")
    stripe_account = coaches[0].get("stripe_account_id")
    if not stripe_account:
        raise HTTPException(409, "El entrenador no ha completado Stripe Connect")
    if settings.stripe_secret_key:
        require_ready_stripe_account(stripe_account)
    reward = await client_reward_terms(user_id)
    fee_rate_bps = int(reward["platform_fee_rate_bps"])
    fee_cents = platform_fee(service["price_cents"], fee_rate_bps)

    series: dict[str, Any] | None = None
    if service.get("offer_type") == "recurring_plan":
        schedule_mode = service.get("recurring_schedule_mode", "fixed")
        if schedule_mode == "flexible":
            if not occurrences or len(occurrences) != int(service["package_size"]):
                raise HTTPException(422, f"Elige exactamente {service['package_size']} fechas para el plan")
            normalized_occurrences = [item if item.tzinfo else item.replace(tzinfo=timezone.utc) for item in occurrences]
            if len({item.astimezone(timezone.utc) for item in normalized_occurrences}) != len(normalized_occurrences):
                raise HTTPException(422, "No puedes repetir una fecha en el plan")
            occurrence_values = [item.astimezone(timezone.utc).isoformat() for item in sorted(normalized_occurrences)]
            schedule_values = sorted(normalized_occurrences)
        else:
            if starts_at is None:
                raise HTTPException(422, "Elige el primer horario del plan")
            normalized_start = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=timezone.utc)
            try:
                local_anchor = normalized_start.astimezone(ZoneInfo(client_timezone))
            except Exception as exc:
                raise HTTPException(422, "Zona horaria no válida") from exc
            cadence = int(service.get("cadence_weeks") or 1)
            occurrence_values = [
                (local_anchor + timedelta(weeks=index * cadence)).astimezone(timezone.utc).isoformat()
                for index in range(int(service["package_size"]))
            ]
            schedule_values = [datetime.fromisoformat(item) for item in occurrence_values]
        validate_booking_schedule(service, coaches[0], schedule_values)
        series = await db.rpc(
            "create_recurring_package_hold",
            {
                "p_consumer_id": user_id,
                "p_service_id": service_id,
                "p_starts_at": occurrence_values,
                "p_timezone": client_timezone,
                "p_meeting_provider": "meet",
            },
        )
        if service.get("location_policy") == "fixed_private":
            await asyncio.gather(*(
                snapshot_service_location(booking_id, service_id, service["coach_id"])
                for booking_id in series.get("booking_ids", [])
            ))
        packages = await db.select("booking_packages", id=f"eq.{series['package_id']}")
        package = packages[0]
    else:
        expiry = datetime.now(timezone.utc) + timedelta(days=int(service.get("expiry_days") or 90))
        package = await db.insert(
            "booking_packages",
            {
                "consumer_id": user_id,
                "coach_id": service["coach_id"],
                "service_id": service_id,
                "total_sessions": service["package_size"],
                "amount_cents": service["price_cents"],
                "status": "pending",
                "offer_type": "flex_pack",
                "expires_at": expiry.isoformat(),
                "terms_snapshot": {
                    "price_cents": service["price_cents"],
                    "session_count": service["package_size"],
                    "expiry_days": service.get("expiry_days") or 90,
                    "booking_mode": service.get("booking_mode") or "instant",
                    "client_reward_tier": reward["tier"],
                    "platform_fee_rate_bps": fee_rate_bps,
                },
            },
        )

    request_row: dict[str, Any] | None = None
    if service.get("booking_mode") == "request":
        request_row = await db.insert(
            "booking_requests",
            {
                "package_id": package["id"],
                "series_id": series["series_id"] if series else None,
                "consumer_id": user_id,
                "coach_id": service["coach_id"],
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(),
            },
        )
    if not settings.stripe_secret_key:
        if settings.demo_mode and settings.environment in {"development", "test", "testing"}:
            return {"package_id": package["id"], "checkout_url": None, "status": "pending"}
        raise HTTPException(503, "Stripe no está configurado")

    stripe.api_key = settings.stripe_secret_key
    return_url = (frontend_url or settings.frontend_url).rstrip("/")
    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "quantity": 1,
                "price_data": {
                    "currency": "eur",
                    "unit_amount": service["price_cents"],
                    "product_data": {
                        "name": service["name"],
                        "description": f"Bono de {service['package_size']} sesiones CoachConnect",
                    },
                },
            }],
            success_url=f"{return_url}/reservas?checkout=success&package={package['id']}",
            cancel_url=f"{return_url}/entrenadores/{service['coach_id']}?checkout=cancelled",
            metadata={"package_id": package["id"], **({"request_id": request_row["id"]} if request_row else {})},
            expires_at=int(time.time()) + 1800,
            **({"payment_method_types": ["card"]} if request_row else {}),
            payment_intent_data={
                "application_fee_amount": fee_cents,
                "transfer_data": {"destination": stripe_account},
                **({"capture_method": "manual"} if request_row else {}),
            },
        )
    except stripe.StripeError as exc:
        await db.update("booking_packages", {"status": "expired"}, id=f"eq.{package['id']}")
        raise HTTPException(502, "Stripe no pudo iniciar el pago") from exc

    await db.insert(
        "payments",
        {
            "package_id": package["id"],
            "consumer_id": user_id,
            "coach_id": service["coach_id"],
            "stripe_checkout_session_id": session.id,
            "amount_cents": service["price_cents"],
            "platform_fee_cents": fee_cents,
            "platform_fee_rate_bps": fee_rate_bps,
            "client_reward_tier": reward["tier"],
            "capture_method": "manual" if request_row else "automatic",
            "authorization_expires_at": request_row.get("expires_at") if request_row else None,
            "idempotency_key": f"checkout:{package['id']}",
        },
    )
    return {
        "package_id": package["id"],
        "checkout_url": session.url,
        "status": "pending",
        **({"series_id": series["series_id"], "booking_ids": series["booking_ids"]} if series else {}),
    }


def oauth_url(provider: str, user_id: str) -> str:
    state = signed_oauth_state(user_id)
    if provider == "zoom":
        if not settings.zoom_client_id or not settings.zoom_client_secret:
            raise HTTPException(503, "Zoom no está configurado")
        if not settings.zoom_redirect_uri.startswith("https://") or "localhost" in settings.zoom_redirect_uri:
            raise HTTPException(503, "Zoom requiere una URL de callback HTTPS no-localhost")
        query = urlencode({"response_type": "code", "client_id": settings.zoom_client_id, "redirect_uri": settings.zoom_redirect_uri, "state": state})
        return f"{settings.zoom_oauth_url}?{query}"
    if provider == "google":
        if not settings.oauth_client_id or not settings.oauth_client_secret:
            raise HTTPException(503, "Google Calendar no está configurado")
        redirect_uri = f"{settings.backend_url}/api/v1/integrations/google/callback"
        query = urlencode({
            "response_type": "code",
            "client_id": settings.oauth_client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid email https://www.googleapis.com/auth/calendar.events",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        })
        return f"{settings.google_oauth_url}?{query}"
    raise HTTPException(404, "Integración no disponible")


async def exchange_oauth_code(provider: str, code: str, state: str) -> str:
    user_id = verify_oauth_state(state)
    if provider == "zoom":
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://zoom.us/oauth/token",
                params={"grant_type": "authorization_code", "code": code, "redirect_uri": settings.zoom_redirect_uri},
                auth=(settings.zoom_client_id, settings.zoom_client_secret),
            )
    elif provider == "google":
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": settings.oauth_client_id,
                    "client_secret": settings.oauth_client_secret,
                    "redirect_uri": f"{settings.backend_url}/api/v1/integrations/google/callback",
                },
            )
    else:
        raise HTTPException(404, "Integración no disponible")
    if response.status_code >= 400:
        raise HTTPException(400, f"No se pudo conectar {provider}")
    token = response.json()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(token.get("expires_in", 3600)))
    await db.upsert(
        "integration_connections",
        {
            "user_id": user_id,
            "provider": provider,
            "encrypted_access_token": encrypt_token(token.get("access_token")),
            "encrypted_refresh_token": encrypt_token(token.get("refresh_token")),
            "expires_at": expires_at.isoformat(),
            "metadata": {"scope": token.get("scope", "")},
            "calendar_enabled": provider == "google",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        "user_id,provider",
    )
    return user_id


async def refresh_oauth_connection(connection: dict[str, Any]) -> dict[str, Any]:
    expires_at = connection.get("expires_at")
    if expires_at and datetime.fromisoformat(expires_at.replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(minutes=5):
        return connection
    refresh_token = decrypt_token(connection.get("encrypted_refresh_token"))
    if not refresh_token:
        raise HTTPException(409, f"Reconecta {connection['provider']} para crear la videollamada")

    provider = connection["provider"]
    async with httpx.AsyncClient(timeout=20) as client:
        if provider == "zoom":
            response = await client.post(
                "https://zoom.us/oauth/token",
                params={"grant_type": "refresh_token", "refresh_token": refresh_token},
                auth=(settings.zoom_client_id, settings.zoom_client_secret),
            )
        elif provider == "google":
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": settings.oauth_client_id,
                    "client_secret": settings.oauth_client_secret,
                },
            )
        else:
            return connection
    if response.status_code >= 400:
        raise HTTPException(502, f"No se pudo renovar la conexión de {provider}")
    token_data = response.json()
    updates = {
        "encrypted_access_token": encrypt_token(token_data["access_token"]),
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=token_data.get("expires_in", 3600))).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if token_data.get("refresh_token"):
        updates["encrypted_refresh_token"] = encrypt_token(token_data["refresh_token"])
    rows = await db.update("integration_connections", updates, id=f"eq.{connection['id']}")
    return rows[0]


async def provision_meeting(booking_id: str) -> str | None:
    rows = await db.select("bookings", id=f"eq.{booking_id}")
    if not rows:
        return None
    booking = rows[0]
    provider = booking.get("meeting_provider") or "meet"
    if provider == "custom":
        coaches = await db.select("coach_profiles", user_id=f"eq.{booking['coach_id']}")
        url = coaches[0].get("custom_video_url") if coaches else None
        if url:
            await db.update("bookings", {"video_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
        return url
    connections = await db.select(
        "integration_connections", user_id=f"eq.{booking['coach_id']}", provider=f"eq.{'google' if provider == 'meet' else provider}"
    )
    if not connections:
        return None
    connection = await refresh_oauth_connection(connections[0])
    token = decrypt_token(connection.get("encrypted_access_token"))
    if not token:
        return None
    starts_at = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00"))
    ends_at = datetime.fromisoformat(booking["ends_at"].replace("Z", "+00:00"))
    if provider == "zoom":
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://api.zoom.us/v2/users/me/meetings",
                headers={"Authorization": f"Bearer {token}"},
                json={"topic": "Sesión CoachConnect", "type": 2, "start_time": starts_at.isoformat(), "duration": round((ends_at - starts_at).total_seconds() / 60), "timezone": "Europe/Madrid"},
            )
        if response.status_code >= 400:
            return None
        url = response.json().get("join_url")
    else:
        request_id = f"coachconnect-{booking_id}"
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                params={"conferenceDataVersion": "1"},
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "summary": "Sesión CoachConnect",
                    "start": {"dateTime": starts_at.isoformat()},
                    "end": {"dateTime": ends_at.isoformat()},
                    "conferenceData": {"createRequest": {"requestId": request_id, "conferenceSolutionKey": {"type": "hangoutsMeet"}}},
                },
            )
        if response.status_code >= 400:
            return None
        entry_points = response.json().get("conferenceData", {}).get("entryPoints", [])
        url = next((item.get("uri") for item in entry_points if item.get("entryPointType") == "video"), None)
    if url:
        await db.update("bookings", {"video_url": url, "updated_at": datetime.now(timezone.utc).isoformat()}, id=f"eq.{booking_id}")
    return url
