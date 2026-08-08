from __future__ import annotations

from datetime import datetime, timedelta, timezone
import base64
from html import escape
import hashlib
import hmac
import logging
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import stripe
from cryptography.fernet import Fernet
from fastapi import HTTPException

from .config import settings


logger = logging.getLogger(__name__)


def platform_fee(amount_cents: int) -> int:
    return round(amount_cents * settings.platform_fee_percent / 100)


class SupabaseAdmin:
    def __init__(self) -> None:
        self.base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": settings.supabase_secret_key,
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
        if response.status_code >= 400:
            detail = response.json().get("message", response.text) if response.content else "Error de base de datos"
            raise HTTPException(response.status_code, detail)
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

    async def upsert(self, table: str, payload: dict[str, Any], on_conflict: str) -> dict[str, Any]:
        rows = await self.request(
            "POST", table, params={"on_conflict": on_conflict}, json=payload,
            prefer="resolution=merge-duplicates,return=representation",
        )
        return rows[0]

    async def update(self, table: str, payload: dict[str, Any], **filters: str) -> list[dict[str, Any]]:
        return await self.request("PATCH", table, params=filters, json=payload)

    async def rpc(self, function: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = await self.request("POST", f"rpc/{function}", json=payload)
        if not rows:
            raise HTTPException(502, f"La función {function} no devolvió datos")
        return rows[0]


db = SupabaseAdmin()


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
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.put(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
            headers=_auth_admin_headers(),
            json={"ban_duration": "none" if enabled else "876000h"},
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
    notification = await db.insert(
        "notifications",
        {"user_id": user_id, "kind": kind, "title": title, "body": body, "action_url": action_url},
    )
    if settings.resend_api_key:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(
                    f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                    headers={
                        "apikey": settings.supabase_secret_key,
                        "Authorization": f"Bearer {settings.supabase_secret_key}",
                    },
                )
            email = response.json().get("email") if response.status_code < 400 else None
            recipient = settings.email_test_recipient if settings.environment == "development" and settings.email_test_recipient else email
            await send_email(
                recipient,
                title,
                f"<h2>{escape(title)}</h2><p>{escape(body)}</p><p><a href='{settings.frontend_url.rstrip('/')}{escape(action_url, quote=True)}'>Abrir CoachConnect</a></p>",
            )
        except (httpx.HTTPError, HTTPException) as exc:
            logger.warning("No se pudo enviar la notificación por correo al usuario %s: %s", user_id, exc)
    return notification


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
    coaches = await db.select("coach_profiles", user_id=f"eq.{service['coach_id']}")
    if not coaches or coaches[0]["verification_status"] != "verified":
        raise HTTPException(409, "Este entrenador aún no puede aceptar reservas")
    normalized_start = starts_at if starts_at.tzinfo else starts_at.replace(tzinfo=timezone.utc)
    if normalized_start <= datetime.now(timezone.utc):
        raise HTTPException(422, "La reserva debe ser futura")
    amount = service["price_cents"]
    booking = await db.rpc(
        "create_pending_booking",
        {
            "p_consumer_id": user_id,
            "p_service_id": service_id,
            "p_starts_at": normalized_start.isoformat(),
            "p_notes": notes,
            "p_meeting_provider": provider,
            "p_platform_fee_percent": settings.platform_fee_percent,
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
        "metadata": {"booking_id": booking["id"]},
    }
    stripe_account = coaches[0].get("stripe_account_id")
    if stripe_account:
        checkout_args["payment_intent_data"] = {
            "application_fee_amount": platform_fee(amount),
            "transfer_data": {"destination": stripe_account},
        }
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
            "platform_fee_cents": platform_fee(amount),
        },
    )
    return {"booking_id": booking["id"], "checkout_url": session.url, "status": "pending_payment"}


async def create_package_checkout(user_id: str, service_id: str, frontend_url: str | None = None) -> dict[str, Any]:
    services = await db.select("coach_services", id=f"eq.{service_id}", active="eq.true")
    if not services:
        raise HTTPException(404, "Servicio no encontrado")
    service = services[0]
    if service["package_size"] <= 1:
        raise HTTPException(409, "Este servicio no es un bono")
    coaches = await db.select("coach_profiles", user_id=f"eq.{service['coach_id']}")
    if not coaches or coaches[0]["verification_status"] != "verified":
        raise HTTPException(409, "Este entrenador aún no puede aceptar pagos")
    stripe_account = coaches[0].get("stripe_account_id")
    if not stripe_account:
        raise HTTPException(409, "El entrenador no ha completado Stripe Connect")

    package = await db.insert(
        "booking_packages",
        {
            "consumer_id": user_id,
            "coach_id": service["coach_id"],
            "service_id": service_id,
            "total_sessions": service["package_size"],
            "amount_cents": service["price_cents"],
            "status": "pending",
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
            metadata={"package_id": package["id"]},
            payment_intent_data={
                "application_fee_amount": platform_fee(service["price_cents"]),
                "transfer_data": {"destination": stripe_account},
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
            "platform_fee_cents": platform_fee(service["price_cents"]),
        },
    )
    return {"package_id": package["id"], "checkout_url": session.url, "status": "pending"}


def oauth_url(provider: str, user_id: str) -> str:
    state = signed_oauth_state(user_id)
    if provider == "zoom":
        if not settings.zoom_client_id or not settings.zoom_client_secret:
            raise HTTPException(503, "Zoom no está configurado")
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
