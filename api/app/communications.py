from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from html import escape
import logging
from typing import Any
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException

from .config import settings
from .services import db, decrypt_token, platform_fee, provision_meeting, refresh_oauth_connection


logger = logging.getLogger(__name__)

ESSENTIAL_CATEGORIES = {"booking", "payment", "security", "moderation"}
CALENDAR_EVENT_KINDS = {
    "booking.confirmed",
    "booking.credit_reserved",
    "booking.location_updated",
    "booking.reschedule_accepted",
    "booking.cancelled",
}
PREFERENCE_CATEGORY = {
    "booking.reminder_24h": "reminders",
    "booking.reminder_1h": "reminders",
    "booking.session_ended": "reviews",
    "booking.review_reminder": "reviews",
    "chat.digest": "chat",
}


def utc_iso(value: datetime | None = None) -> str:
    return (value or datetime.now(timezone.utc)).isoformat()


async def publish_event(
    kind: str,
    aggregate_type: str,
    aggregate_id: str | None,
    idempotency_key: str,
    *,
    actor_id: str | None = None,
    payload: dict[str, Any] | None = None,
    available_at: datetime | None = None,
) -> dict[str, Any]:
    """Persist an event before attempting any ancillary side effect."""
    existing = await db.select("communication_events", idempotency_key=f"eq.{idempotency_key}", limit="1")
    if existing:
        current = existing[0]
        if kind == "chat.digest":
            return current
        if current["status"] == "pending":
            merged_payload = payload or {}
            rows = await db.update(
                "communication_events",
                {"payload": merged_payload, "available_at": utc_iso(available_at)},
                id=f"eq.{current['id']}",
            )
            return rows[0] if rows else current
        return current
    if kind == "chat.digest":
        pending = await db.select(
            "communication_events", kind="eq.chat.digest", aggregate_type="eq.conversation",
            aggregate_id=f"eq.{aggregate_id}", status="eq.pending", order="created_at.desc", limit="10",
        )
        recipient_ids = (payload or {}).get("recipient_ids") or []
        current = next((item for item in pending if (item.get("payload") or {}).get("recipient_ids") == recipient_ids), None)
        if current:
            merged_payload = {
                **(current.get("payload") or {}), **(payload or {}),
                "message_count": int((current.get("payload") or {}).get("message_count") or 0) + 1,
            }
            rows = await db.update(
                "communication_events",
                {"payload": merged_payload, "available_at": utc_iso(available_at)},
                id=f"eq.{current['id']}", status="eq.pending",
            )
            return rows[0] if rows else current
    return await db.insert(
        "communication_events",
        {
            "kind": kind,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "actor_id": actor_id,
            "payload": payload or {},
            "idempotency_key": idempotency_key,
            "available_at": utc_iso(available_at),
        },
    )


async def _profile(user_id: str) -> dict[str, Any]:
    rows = await db.select("profiles", select="id,display_name,locale,timezone,role", id=f"eq.{user_id}")
    return rows[0] if rows else {"id": user_id, "display_name": "CoachConnect", "locale": "es", "timezone": "Europe/Madrid"}


async def _auth_email(user_id: str) -> str | None:
    if not settings.supabase_url or not settings.supabase_secret_key:
        return None
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
            headers={"apikey": settings.supabase_secret_key, "Authorization": f"Bearer {settings.supabase_secret_key}"},
        )
    if response.status_code >= 400:
        return None
    return response.json().get("email")


async def _booking_context(booking_id: str) -> dict[str, Any]:
    rows = await db.select(
        "bookings",
        select=(
            "*,coach_services(id,name,description,mode,duration_minutes,location_policy,public_area_label),"
            "payments(id,amount_cents,platform_fee_cents,currency,status,stripe_receipt_url),"
            "cancellations(reason,refund_cents,created_at)"
        ),
        id=f"eq.{booking_id}",
    )
    if not rows:
        raise HTTPException(404, "Reserva no encontrada")
    booking = rows[0]
    profiles = await db.select(
        "profiles", select="id,display_name,locale,timezone,role",
        id=f"in.({booking['consumer_id']},{booking['coach_id']})",
    )
    booking["participants"] = {item["id"]: item for item in profiles}
    private_locations = await db.select("booking_private_locations", booking_id=f"eq.{booking_id}")
    booking["private_location"] = private_locations[0] if private_locations else None
    return booking


async def _package_context(package_id: str) -> dict[str, Any]:
    rows = await db.select(
        "booking_packages",
        select="*,coach_services(id,name,description,mode,duration_minutes),payments(amount_cents,platform_fee_cents,currency,status,stripe_receipt_url)",
        id=f"eq.{package_id}",
    )
    if not rows:
        raise HTTPException(404, "Bono no encontrado")
    package = rows[0]
    profiles = await db.select(
        "profiles", select="id,display_name,locale,timezone,role",
        id=f"in.({package['consumer_id']},{package['coach_id']})",
    )
    package["participants"] = {item["id"]: item for item in profiles}
    return package


async def _request_context(request_id: str) -> dict[str, Any]:
    rows = await db.select("booking_requests", id=f"eq.{request_id}")
    if not rows:
        raise HTTPException(404, "Solicitud no encontrada")
    request = rows[0]
    request["participants"] = {
        item["id"]: item
        for item in await db.select(
            "profiles", select="id,display_name,locale,timezone,role",
            id=f"in.({request['consumer_id']},{request['coach_id']})",
        )
    }
    if request.get("booking_id"):
        request["booking"] = await _booking_context(request["booking_id"])
    if request.get("package_id"):
        request["package"] = await _package_context(request["package_id"])
    return request


async def _event_context(event: dict[str, Any]) -> dict[str, Any]:
    aggregate_type = event["aggregate_type"]
    aggregate_id = event.get("aggregate_id")
    if aggregate_type == "booking" and aggregate_id:
        return await _booking_context(aggregate_id)
    if aggregate_type == "package" and aggregate_id:
        return await _package_context(aggregate_id)
    if aggregate_type == "booking_request" and aggregate_id:
        return await _request_context(aggregate_id)
    return dict(event.get("payload") or {})


def _recipient_ids(event: dict[str, Any], context: dict[str, Any]) -> list[str]:
    explicit = (event.get("payload") or {}).get("recipient_ids")
    if explicit:
        return list(dict.fromkeys(explicit))
    if event["aggregate_type"] in {"booking", "package", "booking_request"}:
        return list(context.get("participants", {}).keys())
    return []


def _category(kind: str) -> str:
    if kind.startswith("chat."):
        return "chat"
    if kind.startswith("booking.") or kind.startswith("package."):
        return "booking"
    if kind.startswith("payment."):
        return "payment"
    if kind.startswith("moderation."):
        return "moderation"
    if kind.startswith("security."):
        return "security"
    return "transactional"


async def _preference(user_id: str, kind: str, channel: str) -> bool:
    preference_category = PREFERENCE_CATEGORY.get(kind)
    if not preference_category:
        return True
    rows = await db.select(
        "notification_preferences", user_id=f"eq.{user_id}", category=f"eq.{preference_category}", limit="1",
    )
    if not rows:
        return True
    return bool(rows[0][f"{channel}_enabled"])


async def _expand_event(event: dict[str, Any], context: dict[str, Any]) -> None:
    kind = event["kind"]
    if (
        event["aggregate_type"] == "booking"
        and kind in {"booking.confirmed", "booking.credit_reserved"}
        and context.get("meeting_provider") in {"zoom", "custom"}
        and not context.get("video_url")
    ):
        await provision_meeting(context["id"])
        context = await _booking_context(context["id"])
    recipients = _recipient_ids(event, context)
    for user_id in recipients:
        profile = context.get("participants", {}).get(user_id) or await _profile(user_id)
        locale = profile.get("locale") if profile.get("locale") in {"es", "en"} else "es"
        role = "coach" if user_id == context.get("coach_id") else "consumer"
        template_key = f"{kind}.{role}"
        if kind in CALENDAR_EVENT_KINDS and event["aggregate_type"] == "booking":
            await db.upsert(
                "communication_deliveries",
                {"event_id": event["id"], "user_id": user_id, "channel": "calendar", "template_key": template_key, "locale": locale},
                "event_id,user_id,channel,template_key",
            )
        if kind != "chat.digest" and await _preference(user_id, kind, "in_app"):
            await db.upsert(
                "communication_deliveries",
                {"event_id": event["id"], "user_id": user_id, "channel": "in_app", "template_key": template_key, "locale": locale},
                "event_id,user_id,channel,template_key",
            )
        if await _preference(user_id, kind, "email"):
            await db.upsert(
                "communication_deliveries",
                {"event_id": event["id"], "user_id": user_id, "channel": "email", "template_key": template_key, "locale": locale},
                "event_id,user_id,channel,template_key",
            )
    if (event.get("payload") or {}).get("notify_operations") and settings.operations_email:
        await db.upsert(
            "communication_deliveries",
            {"event_id": event["id"], "user_id": None, "channel": "operations", "template_key": kind, "locale": "es"},
            "event_id,user_id,channel,template_key",
        )


def _format_date(value: str, timezone_name: str, locale: str) -> str:
    moment = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZoneInfo(timezone_name or "Europe/Madrid"))
    weekdays = {
        "es": ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"],
        "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    }
    months = {
        "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
        "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    }
    if locale == "en":
        return f"{weekdays['en'][moment.weekday()]}, {months['en'][moment.month - 1]} {moment.day}, {moment.year} at {moment:%H:%M} ({moment.tzname()})"
    return f"{weekdays['es'][moment.weekday()]}, {moment.day} de {months['es'][moment.month - 1]} de {moment.year} a las {moment:%H:%M} ({moment.tzname()})"


def _money(cents: int | None, currency: str = "eur", locale: str = "es") -> str:
    value = (cents or 0) / 100
    number = f"{value:,.2f}"
    if locale == "es":
        number = number.replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{number} {currency.upper()}"


def _event_copy(event: dict[str, Any], context: dict[str, Any], user_id: str | None, locale: str) -> dict[str, Any]:
    kind = event["kind"]
    payload = event.get("payload") or {}
    participant = context.get("participants", {}).get(user_id or "", {})
    name = participant.get("display_name") or ("there" if locale == "en" else "")
    is_coach = user_id == context.get("coach_id")
    text = {
        "es": {
            "booking.confirmed": ("Reserva confirmada", "Tu entrenamiento está confirmado."),
            "booking.credit_reserved": ("Sesión reservada", "Tu sesión del bono está confirmada."),
            "booking.cancelled": ("Entrenamiento cancelado", "La reserva se ha cancelado correctamente."),
            "booking.location_updated": ("Ubicación confirmada", "Ya está disponible el lugar exacto del entrenamiento."),
            "booking.reschedule_proposed": ("Propuesta de nueva fecha", "La otra parte ha propuesto cambiar el horario."),
            "booking.reschedule_accepted": ("Nuevo horario confirmado", "La reprogramación ha sido aceptada."),
            "booking.reschedule_rejected": ("Cambio de horario rechazado", "La reserva mantiene su horario original."),
            "booking.reschedule_expired": ("Propuesta de cambio caducada", "La reserva mantiene su horario original."),
            "booking.reminder_24h": ("Tu entrenamiento es mañana", "Prepárate para tu próxima sesión."),
            "booking.reminder_1h": ("Tu entrenamiento empieza en una hora", "Todo listo para empezar."),
            "booking.session_ended": ("¿Cómo fue el entrenamiento?", "Confirma el resultado y deja tu valoración."),
            "booking.review_reminder": ("Tu valoración sigue pendiente", "Cuéntanos cómo fue la sesión."),
            "booking.outcome_required": ("Confirma cómo fue la sesión", "La otra parte ha registrado el resultado. Tienes 48 horas para responder."),
            "booking.request_submitted": ("Solicitud de reserva recibida", "La autorización está protegida mientras el entrenador decide."),
            "booking.request_reminder": ("Una solicitud caduca en 2 horas", "Revísala antes de que se libere la autorización."),
            "booking.request_rejected": ("Solicitud no aceptada", "La autorización se ha liberado sin realizar el cargo."),
            "booking.request_expired": ("La solicitud ha caducado", "La autorización se ha liberado sin realizar el cargo."),
            "package.activated": ("Bono activado", "Tu bono ya está disponible."),
            "chat.digest": ("Tienes mensajes sin leer", "Hay novedades en una conversación de CoachConnect."),
            "moderation.sanction": ("Medida temporal aplicada", payload.get("body") or "Revisa la medida aplicada a tu cuenta."),
            "booking.dispute_resolved": ("Incidencia resuelta", "Operaciones ha revisado y cerrado el resultado de la sesión."),
            "payment.refunded": ("Reembolso actualizado", "Stripe ha actualizado el estado económico de la reserva."),
            "coach.verification": ("Estado de validación actualizado", payload.get("body") or "Revisa el estado de tu perfil profesional."),
        },
        "en": {
            "booking.confirmed": ("Booking confirmed", "Your training session is confirmed."),
            "booking.credit_reserved": ("Session booked", "Your package session is confirmed."),
            "booking.cancelled": ("Training cancelled", "The booking has been cancelled."),
            "booking.location_updated": ("Location confirmed", "The exact training location is now available."),
            "booking.reschedule_proposed": ("New time proposed", "The other participant has proposed a new schedule."),
            "booking.reschedule_accepted": ("New schedule confirmed", "The reschedule request was accepted."),
            "booking.reschedule_rejected": ("Schedule change declined", "The booking keeps its original time."),
            "booking.reschedule_expired": ("Schedule proposal expired", "The booking keeps its original time."),
            "booking.reminder_24h": ("Your training is tomorrow", "Get ready for your next session."),
            "booking.reminder_1h": ("Your training starts in one hour", "Everything is ready to begin."),
            "booking.session_ended": ("How was your training?", "Confirm the outcome and leave a review."),
            "booking.review_reminder": ("Your review is still pending", "Tell us how the session went."),
            "booking.outcome_required": ("Confirm the session outcome", "The other participant submitted an outcome. You have 48 hours to respond."),
            "booking.request_submitted": ("Booking request received", "Your authorization is protected while the coach decides."),
            "booking.request_reminder": ("A request expires in 2 hours", "Review it before the authorization is released."),
            "booking.request_rejected": ("Request declined", "The authorization was released without a charge."),
            "booking.request_expired": ("Request expired", "The authorization was released without a charge."),
            "package.activated": ("Package activated", "Your package is ready to use."),
            "chat.digest": ("You have unread messages", "There are updates in a CoachConnect conversation."),
            "moderation.sanction": ("Temporary measure applied", payload.get("body") or "Review the measure applied to your account."),
            "booking.dispute_resolved": ("Issue resolved", "Operations reviewed and closed the session outcome."),
            "payment.refunded": ("Refund updated", "Stripe updated the financial status of the booking."),
            "coach.verification": ("Verification status updated", payload.get("body") or "Review your professional profile status."),
        },
    }
    title, intro = text[locale].get(kind, (payload.get("title") or "CoachConnect", payload.get("body") or ""))
    if kind == "booking.request_submitted" and is_coach:
        title = "Nueva solicitud de reserva" if locale == "es" else "New booking request"
        intro = "Revisa el perfil del cliente y responde antes de 12 horas." if locale == "es" else "Review the client profile and respond within 12 hours."
    details: list[tuple[str, str]] = []
    action_url = payload.get("action_url") or "/reservas"
    if event["aggregate_type"] == "booking":
        service = context.get("coach_services") or {}
        timezone_name = participant.get("timezone") or "Europe/Madrid"
        counterpart_id = context.get("consumer_id") if is_coach else context.get("coach_id")
        counterpart = context.get("participants", {}).get(counterpart_id, {}).get("display_name", "CoachConnect")
        details.extend([
            (("Entrenamiento" if locale == "es" else "Training"), service.get("name") or "CoachConnect"),
            (("Fecha" if locale == "es" else "Date"), _format_date(context["starts_at"], timezone_name, locale)),
            (("Cliente" if is_coach and locale == "es" else "Entrenador" if locale == "es" else "Client" if is_coach else "Coach"), counterpart),
            (("Modalidad" if locale == "es" else "Format"), service.get("mode") or "online"),
        ])
        location = context.get("private_location")
        if location:
            details.append((("Lugar" if locale == "es" else "Location"), f"{location['address_line']}, {location['locality']}"))
            if location.get("instructions"):
                details.append((("Indicaciones" if locale == "es" else "Directions"), location["instructions"]))
        elif service.get("mode") != "online":
            details.append((("Zona" if locale == "es" else "Area"), service.get("public_area_label") or ("Por acordar en el chat" if locale == "es" else "To be agreed in chat")))
        if context.get("video_url"):
            details.append((("Acceso online" if locale == "es" else "Online access"), context["video_url"]))
        payments = context.get("payments") or []
        payment = payments[0] if payments else {}
        if is_coach:
            amount = int(payment.get("amount_cents") or context.get("amount_cents") or 0)
            fee = int(payment.get("platform_fee_cents") or context.get("platform_fee_cents") or platform_fee(amount))
            details.extend([
                (("Importe" if locale == "es" else "Amount"), _money(amount, payment.get("currency", "eur"), locale)),
                (("Comisión" if locale == "es" else "Fee"), _money(fee, payment.get("currency", "eur"), locale)),
                (("Neto estimado" if locale == "es" else "Estimated net"), _money(amount - fee, payment.get("currency", "eur"), locale)),
            ])
        elif payment or context.get("amount_cents"):
            details.append((("Total" if locale == "es" else "Total"), _money(payment.get("amount_cents") or context.get("amount_cents"), payment.get("currency", "eur"), locale)))
            if payment.get("stripe_receipt_url"):
                details.append((("Recibo" if locale == "es" else "Receipt"), payment["stripe_receipt_url"]))
        if kind == "booking.cancelled":
            cancellations = context.get("cancellations") or []
            cancellation = cancellations[0] if cancellations else payload
            if cancellation.get("reason"):
                details.append((("Motivo" if locale == "es" else "Reason"), cancellation["reason"]))
            if cancellation.get("refund_cents"):
                details.append((("Reembolso" if locale == "es" else "Refund"), _money(cancellation["refund_cents"], "eur", locale)))
    elif event["aggregate_type"] == "package":
        service = context.get("coach_services") or {}
        payments = context.get("payments") or []
        payment = payments[0] if payments else {}
        amount = int(payment.get("amount_cents") or context.get("amount_cents") or 0)
        details.extend([
            (("Servicio" if locale == "es" else "Service"), service.get("name") or "CoachConnect"),
            (("Sesiones" if locale == "es" else "Sessions"), str(context.get("total_sessions") or "")),
            (("Importe" if locale == "es" else "Amount"), _money(amount, payment.get("currency", "eur"), locale)),
        ])
        if is_coach:
            fee = int(payment.get("platform_fee_cents") or platform_fee(amount))
            details.extend([(("Comisión" if locale == "es" else "Fee"), _money(fee, "eur", locale)), (("Neto estimado" if locale == "es" else "Estimated net"), _money(amount - fee, "eur", locale))])
    elif event["aggregate_type"] == "booking_request":
        requested_booking = context.get("booking")
        requested_package = context.get("package")
        if requested_booking:
            service = requested_booking.get("coach_services") or {}
            details.append((("Entrenamiento" if locale == "es" else "Training"), service.get("name") or "CoachConnect"))
            details.append((("Fecha" if locale == "es" else "Date"), _format_date(requested_booking["starts_at"], participant.get("timezone") or "Europe/Madrid", locale)))
            details.append((("Importe autorizado" if locale == "es" else "Authorized amount"), _money(requested_booking.get("amount_cents"), "eur", locale)))
        elif requested_package:
            service = requested_package.get("coach_services") or {}
            details.append((("Servicio" if locale == "es" else "Service"), service.get("name") or "CoachConnect"))
            details.append((("Sesiones" if locale == "es" else "Sessions"), str(requested_package.get("total_sessions") or "")))
            details.append((("Importe autorizado" if locale == "es" else "Authorized amount"), _money(requested_package.get("amount_cents"), "eur", locale)))
        if context.get("expires_at"):
            details.append((("Responder antes de" if locale == "es" else "Respond before"), _format_date(context["expires_at"], participant.get("timezone") or "Europe/Madrid", locale)))
        action_url = "/profesional?tab=requests" if is_coach else "/reservas"
    elif kind == "chat.digest":
        details.append((("De" if locale == "es" else "From"), payload.get("sender_name") or "CoachConnect"))
        details.append((("Mensajes" if locale == "es" else "Messages"), str(payload.get("message_count") or 1)))
        if payload.get("preview"):
            details.append((("Último mensaje" if locale == "es" else "Latest message"), payload["preview"]))
        action_url = f"/mensajes?conversation={payload.get('conversation_id', '')}"
    greeting = f"Hola {name}," if locale == "es" and name else f"Hi {name}," if name else "Hola,"
    return {"title": title, "subject": title, "greeting": greeting, "intro": intro, "details": details, "action_url": action_url}


def _render_email(copy: dict[str, Any], locale: str) -> tuple[str, str]:
    rows = "".join(
        f"<tr><td style='padding:8px 0;color:#697066;font-size:12px;vertical-align:top'>{escape(str(label))}</td>"
        f"<td style='padding:8px 0;text-align:right;font-size:13px;font-weight:700;word-break:break-word'>{escape(str(value))}</td></tr>"
        for label, value in copy["details"]
    )
    cta = "Abrir CoachConnect" if locale == "es" else "Open CoachConnect"
    footer = "Este es un correo transaccional relacionado con tu cuenta." if locale == "es" else "This is a transactional email related to your account."
    url = f"{settings.frontend_url.rstrip('/')}{copy['action_url']}"
    html = f"""<!doctype html><html><body style="margin:0;background:#f4f3ed;color:#11120f;font-family:Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">{escape(copy['intro'])}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #deddd5">
<tr><td style="padding:24px 30px;background:#11120f;color:#dfff00;font-size:20px;font-weight:900">COACHCONNECT</td></tr>
<tr><td style="padding:34px 30px"><p style="margin:0 0 18px">{escape(copy['greeting'])}</p><h1 style="margin:0 0 14px;font-size:30px;line-height:1">{escape(copy['title'])}</h1><p style="color:#555b52;line-height:1.6">{escape(copy['intro'])}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;border-top:1px solid #deddd5;border-bottom:1px solid #deddd5">{rows}</table>
<a href="{escape(url, quote=True)}" style="display:inline-block;background:#dfff00;color:#11120f;padding:14px 20px;text-decoration:none;font-size:13px;font-weight:800">{cta}</a></td></tr>
<tr><td style="padding:20px 30px;background:#f4f3ed;color:#72776f;font-size:11px;line-height:1.5">{footer}</td></tr></table></td></tr></table></body></html>"""
    detail_text = "\n".join(f"{label}: {value}" for label, value in copy["details"])
    text = f"{copy['greeting']}\n\n{copy['title']}\n{copy['intro']}\n\n{detail_text}\n\n{cta}: {url}\n"
    return html, text


def _ics_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _booking_ics(booking: dict[str, Any], cancelled: bool = False) -> str:
    service = booking.get("coach_services") or {}
    location = booking.get("private_location")
    location_text = f"{location['address_line']}, {location['locality']}" if location else service.get("public_area_label") or ""
    uid = f"booking-{booking['id']}@coachconnect.app"
    method = "CANCEL" if cancelled else "REQUEST"
    status = "CANCELLED" if cancelled else "CONFIRMED"
    starts = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ends = datetime.fromisoformat(booking["ends_at"].replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    description = booking.get("video_url") or settings.frontend_url.rstrip("/") + "/reservas"
    return "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CoachConnect//Training//ES", f"METHOD:{method}",
        "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART:{starts}", f"DTEND:{ends}", f"SUMMARY:{_ics_escape(service.get('name') or 'Sesión CoachConnect')}",
        f"DESCRIPTION:{_ics_escape(description)}", f"LOCATION:{_ics_escape(location_text)}", f"STATUS:{status}",
        "END:VEVENT", "END:VCALENDAR", "",
    ])


async def _send_email_delivery(delivery: dict[str, Any], event: dict[str, Any], context: dict[str, Any]) -> tuple[str, str | None]:
    user_id = delivery.get("user_id")
    if event["kind"] in {"booking.session_ended", "booking.review_reminder"} and user_id:
        reviews = await db.select("reviews", select="id", booking_id=f"eq.{event.get('aggregate_id')}", author_id=f"eq.{user_id}", limit="1")
        if reviews:
            return "skipped", None
    if event["kind"] == "chat.digest" and user_id:
        payload = event.get("payload") or {}
        reads = await db.select(
            "conversation_read_states", conversation_id=f"eq.{payload.get('conversation_id')}", user_id=f"eq.{user_id}", limit="1",
        )
        if reads and payload.get("message_created_at"):
            read_at = datetime.fromisoformat(reads[0]["last_read_at"].replace("Z", "+00:00"))
            message_at = datetime.fromisoformat(payload["message_created_at"].replace("Z", "+00:00"))
            if read_at >= message_at:
                return "skipped", None
    if not user_id:
        recipient = settings.operations_email
    else:
        suppressions = await db.select("email_suppressions", user_id=f"eq.{user_id}", limit="1")
        if suppressions:
            return "skipped", None
        recipient = await _auth_email(user_id)
    if settings.environment == "development" and settings.email_test_recipient:
        recipient = settings.email_test_recipient
    if not recipient or not settings.resend_api_key or not settings.email_from:
        return "skipped", None
    copy = _event_copy(event, context, user_id, delivery["locale"])
    html, text = _render_email(copy, delivery["locale"])
    payload: dict[str, Any] = {
        "from": settings.email_from,
        "to": [recipient],
        "subject": copy["subject"],
        "html": html,
        "text": text,
    }
    if settings.email_reply_to:
        payload["reply_to"] = settings.email_reply_to
    if event["aggregate_type"] == "booking" and event["kind"] in CALENDAR_EVENT_KINDS | {"booking.reminder_24h", "booking.reminder_1h"}:
        ics = _booking_ics(context, cancelled=event["kind"] == "booking.cancelled")
        payload["attachments"] = [{"filename": "entrenamiento-coachconnect.ics", "content": base64.b64encode(ics.encode()).decode()}]
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": f"communication/{delivery['id']}",
            },
            json=payload,
        )
    response.raise_for_status()
    return "sent", response.json().get("id")


async def _in_app_delivery(delivery: dict[str, Any], event: dict[str, Any], context: dict[str, Any]) -> None:
    if event["kind"] in {"booking.session_ended", "booking.review_reminder"}:
        reviews = await db.select("reviews", select="id", booking_id=f"eq.{event.get('aggregate_id')}", author_id=f"eq.{delivery['user_id']}", limit="1")
        if reviews:
            return
    copy = _event_copy(event, context, delivery["user_id"], delivery["locale"])
    await db.upsert(
        "notifications",
        {
            "event_id": event["id"], "user_id": delivery["user_id"], "kind": event["kind"],
            "category": _category(event["kind"]), "priority": "high" if _category(event["kind"]) in ESSENTIAL_CATEGORIES else "normal",
            "title": copy["title"], "body": copy["intro"], "action_url": copy["action_url"],
            "metadata": {"aggregate_type": event["aggregate_type"], "aggregate_id": event.get("aggregate_id")},
        },
        "event_id,user_id,kind",
    )


async def _calendar_delivery(delivery: dict[str, Any], event: dict[str, Any], booking: dict[str, Any]) -> str:
    user_id = delivery["user_id"]
    connections = await db.select(
        "integration_connections", user_id=f"eq.{user_id}", provider="eq.google", limit="1",
    )
    links = await db.select("calendar_event_links", booking_id=f"eq.{booking['id']}", user_id=f"eq.{user_id}", provider="eq.google")
    if not connections:
        return "skipped"
    # Existing coach connections must keep creating Meet links after the
    # calendar opt-in column is introduced. Consumer calendar sync stays opt-in.
    if not connections[0].get("calendar_enabled") and not links and not (
        user_id == booking.get("coach_id") and booking.get("meeting_provider") == "meet"
    ):
        return "skipped"
    connection = await refresh_oauth_connection(connections[0])
    token = decrypt_token(connection.get("encrypted_access_token"))
    if not token:
        raise HTTPException(409, "Reconecta Google Calendar")
    calendar_id = connection.get("calendar_id") or "primary"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if event["kind"] == "booking.cancelled":
        if links:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.delete(
                    f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events/{quote(links[0]['external_event_id'], safe='')}",
                    headers=headers,
                )
            if response.status_code not in {204, 404, 410}:
                response.raise_for_status()
            await db.update("calendar_event_links", {"sync_status": "deleted", "updated_at": utc_iso()}, booking_id=f"eq.{booking['id']}", user_id=f"eq.{user_id}", provider="eq.google")
        return "sent"
    if booking.get("meeting_provider") == "zoom" and not booking.get("video_url"):
        await provision_meeting(booking["id"])
        booking = await _booking_context(booking["id"])
    service = booking.get("coach_services") or {}
    location = booking.get("private_location")
    body: dict[str, Any] = {
        "summary": service.get("name") or "Sesión CoachConnect",
        "description": f"Detalles: {settings.frontend_url.rstrip('/')}/reservas"
        + (f"\nAcceso: {booking['video_url']}" if booking.get("video_url") else "")
        + (f"\nIndicaciones: {location['instructions']}" if location and location.get("instructions") else ""),
        "start": {"dateTime": booking["starts_at"]},
        "end": {"dateTime": booking["ends_at"]},
        "location": f"{location['address_line']}, {location['locality']}" if location else service.get("public_area_label") or "",
        "reminders": {"useDefault": True},
        "extendedProperties": {"private": {"coachconnectBookingId": booking["id"]}},
    }
    if user_id == booking.get("coach_id") and booking.get("meeting_provider") == "meet":
        body["conferenceData"] = {"createRequest": {"requestId": f"coachconnect-{booking['id']}", "conferenceSolutionKey": {"type": "hangoutsMeet"}}}
    params = {"conferenceDataVersion": "1", "sendUpdates": "none"}
    async with httpx.AsyncClient(timeout=20) as client:
        if links:
            response = await client.patch(
                f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events/{quote(links[0]['external_event_id'], safe='')}",
                params=params, headers=headers, json=body,
            )
        else:
            response = await client.post(
                f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar_id, safe='')}/events",
                params=params, headers=headers, json=body,
            )
    response.raise_for_status()
    google_event = response.json()
    video_url = google_event.get("hangoutLink")
    if video_url and video_url != booking.get("video_url"):
        await db.update("bookings", {"video_url": video_url, "updated_at": utc_iso()}, id=f"eq.{booking['id']}")
    await db.upsert(
        "calendar_event_links",
        {
            "booking_id": booking["id"], "user_id": user_id, "provider": "google",
            "external_event_id": google_event["id"], "calendar_id": calendar_id,
            "ical_uid": google_event.get("iCalUID") or f"booking-{booking['id']}@coachconnect.app",
            "sequence": int(google_event.get("sequence") or 0), "sync_status": "synced",
            "last_synced_at": utc_iso(), "last_error": None, "updated_at": utc_iso(),
        },
        "booking_id,user_id,provider",
    )
    return "sent"


async def process_communication_queue(max_events: int = 25, max_deliveries: int = 100) -> dict[str, int]:
    expanded = delivered = failed = 0
    for _ in range(max_events):
        event = await db.rpc("claim_communication_event", {})
        if not event:
            break
        try:
            context = await _event_context(event)
            await _expand_event(event, context)
            await db.rpc("finish_communication_event", {"p_event_id": event["id"], "p_error": None})
            expanded += 1
        except Exception as exc:
            await db.rpc("finish_communication_event", {"p_event_id": event["id"], "p_error": str(exc)[:1000]})
            failed += 1
    for _ in range(max_deliveries):
        delivery = await db.rpc("claim_communication_delivery", {})
        if not delivery:
            break
        try:
            events = await db.select("communication_events", id=f"eq.{delivery['event_id']}")
            if not events:
                raise HTTPException(404, "Evento de comunicación no encontrado")
            event = events[0]
            context = await _event_context(event)
            provider_id: str | None = None
            if delivery["channel"] == "in_app":
                await _in_app_delivery(delivery, event, context)
                status = "sent"
            elif delivery["channel"] in {"email", "operations"}:
                status, provider_id = await _send_email_delivery(delivery, event, context)
            else:
                status = await _calendar_delivery(delivery, event, context)
            await db.rpc(
                "finish_communication_delivery",
                {"p_delivery_id": delivery["id"], "p_status": status, "p_provider_message_id": provider_id, "p_error": None},
            )
            delivered += 1
        except Exception as exc:
            await db.rpc(
                "finish_communication_delivery",
                {"p_delivery_id": delivery["id"], "p_status": "failed", "p_provider_message_id": None, "p_error": str(exc)[:1000]},
            )
            if int(delivery.get("attempts") or 0) >= 5 and delivery.get("channel") != "operations":
                await publish_event(
                    "operations.delivery_failed",
                    "communication_delivery",
                    delivery["id"],
                    f"operations.delivery_failed:{delivery['id']}",
                    payload={
                        "notify_operations": True,
                        "title": "Entrega de comunicación agotada",
                        "body": f"Canal {delivery.get('channel')} · plantilla {delivery.get('template_key')} · {str(exc)[:500]}",
                        "delivery_id": delivery["id"],
                    },
                )
            failed += 1
    return {"expanded": expanded, "delivered": delivered, "failed": failed}


async def schedule_due_communications() -> int:
    now = datetime.now(timezone.utc)
    scheduled = 0
    windows = [
        ("booking.reminder_24h", now + timedelta(hours=23, minutes=50), now + timedelta(hours=24, minutes=5)),
        ("booking.reminder_1h", now + timedelta(minutes=50), now + timedelta(hours=1, minutes=5)),
    ]
    for kind, starts_from, starts_to in windows:
        bookings = await db.select(
            "bookings", select="id,starts_at", status="eq.confirmed",
            starts_at=f"gte.{starts_from.isoformat()}", order="starts_at.asc",
        )
        for booking in bookings:
            starts_at = datetime.fromisoformat(booking["starts_at"].replace("Z", "+00:00"))
            if starts_at > starts_to:
                continue
            await publish_event(
                kind, "booking", booking["id"], f"{kind}:{booking['id']}:{booking['starts_at']}",
                payload={"scheduled_for": booking["starts_at"]},
            )
            scheduled += 1
    requests = await db.select(
        "booking_requests", select="id,expires_at", status="eq.awaiting_coach",
        expires_at=f"gte.{(now + timedelta(hours=1, minutes=50)).isoformat()}", order="expires_at.asc",
    )
    for request in requests:
        expiry = datetime.fromisoformat(request["expires_at"].replace("Z", "+00:00"))
        if expiry <= now + timedelta(hours=2, minutes=5):
            await publish_event("booking.request_reminder", "booking_request", request["id"], f"booking.request_reminder:{request['id']}")
            scheduled += 1
    recently_completed = await db.select(
        "bookings", select="id,completed_at", status="eq.completed",
        completed_at=f"gte.{(now - timedelta(minutes=10)).isoformat()}", order="completed_at.asc",
    )
    for booking in recently_completed:
        await publish_event(
            "booking.session_ended", "booking", booking["id"], f"booking.session_ended:{booking['id']}",
        )
        scheduled += 1
    review_candidates = await db.select(
        "bookings", select="id,completed_at", status="eq.completed",
        completed_at=f"gte.{(now - timedelta(hours=72, minutes=10)).isoformat()}", order="completed_at.asc",
    )
    for booking in review_candidates:
        completed_at = datetime.fromisoformat(booking["completed_at"].replace("Z", "+00:00")) if booking.get("completed_at") else now
        if now - timedelta(hours=72, minutes=5) <= completed_at <= now - timedelta(hours=71, minutes=50):
            await publish_event(
                "booking.review_reminder", "booking", booking["id"], f"booking.review_reminder:{booking['id']}",
            )
            scheduled += 1
    pending_reschedules = await db.select("booking_reschedule_requests", status="eq.pending", expires_at=f"lte.{now.isoformat()}")
    for request in pending_reschedules:
        await db.update("booking_reschedule_requests", {"status": "expired", "updated_at": utc_iso()}, id=f"eq.{request['id']}", status="eq.pending")
        bookings = await db.select("bookings", id=f"eq.{request['booking_id']}")
        recipient_ids = [bookings[0]["consumer_id"], bookings[0]["coach_id"]] if bookings else []
        await publish_event(
            "booking.reschedule_expired", "booking", request["booking_id"], f"booking.reschedule_expired:{request['id']}",
            payload={"recipient_ids": recipient_ids, "request_id": request["id"]},
        )
        scheduled += 1
    return scheduled
