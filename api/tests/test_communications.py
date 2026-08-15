import asyncio
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json

import app.communications as communications
import app.main as main_module
from starlette.requests import Request


def booking_context() -> dict:
    starts = datetime(2026, 9, 2, 16, 0, tzinfo=timezone.utc)
    return {
        "id": "booking-1",
        "consumer_id": "consumer-1",
        "coach_id": "coach-1",
        "starts_at": starts.isoformat(),
        "ends_at": (starts + timedelta(hours=1)).isoformat(),
        "meeting_provider": "meet",
        "video_url": "https://meet.google.com/example",
        "amount_cents": 5000,
        "coach_services": {"name": "Fuerza inicial", "mode": "presencial", "duration_minutes": 60},
        "private_location": {
            "address_line": "Calle Mayor 1",
            "locality": "Madrid",
            "instructions": "Pregunta en recepción por Marta",
        },
        "payments": [{"amount_cents": 5000, "platform_fee_cents": 750, "currency": "eur", "stripe_receipt_url": "https://stripe.example/receipt"}],
        "participants": {
            "consumer-1": {"id": "consumer-1", "display_name": "Ana", "timezone": "Europe/Madrid"},
            "coach-1": {"id": "coach-1", "display_name": "Marta", "timezone": "Europe/Madrid"},
        },
    }


def test_booking_email_copy_is_role_specific_and_contains_private_logistics() -> None:
    event = {"kind": "booking.confirmed", "aggregate_type": "booking", "payload": {}}
    context = booking_context()
    consumer = communications._event_copy(event, context, "consumer-1", "es")
    coach = communications._event_copy(event, context, "coach-1", "es")

    consumer_details = dict(consumer["details"])
    coach_details = dict(coach["details"])
    assert consumer_details["Lugar"] == "Calle Mayor 1, Madrid"
    assert consumer_details["Indicaciones"] == "Pregunta en recepción por Marta"
    assert consumer_details["Total"] == "50,00 EUR"
    assert consumer_details["Recibo"] == "https://stripe.example/receipt"
    assert coach_details["Comisión"] == "7,50 EUR"
    assert coach_details["Neto estimado"] == "42,50 EUR"


def test_calendar_attachment_has_stable_uid_access_and_location() -> None:
    ics = communications._booking_ics(booking_context())
    assert "UID:booking-booking-1@coachconnect.app" in ics
    assert "DTSTART:20260902T160000Z" in ics
    assert r"LOCATION:Calle Mayor 1\, Madrid" in ics
    assert "https://meet.google.com/example" in ics


def test_email_template_escapes_user_controlled_details(monkeypatch) -> None:
    monkeypatch.setattr(communications.settings, "frontend_url", "https://coachconnect.test")
    html, text = communications._render_email(
        {
            "title": "Reserva <confirmada>", "greeting": "Hola Ana,", "intro": "Todo listo",
            "details": [("Nota", "<script>alert(1)</script>")], "action_url": "/cuenta",
        },
        "es",
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "https://coachconnect.test/cuenta" in text


def test_chat_digest_coalesces_pending_messages(monkeypatch) -> None:
    class Database:
        def __init__(self):
            self.updated = None
            self.select_count = 0

        async def select(self, *_args, **_kwargs):
            self.select_count += 1
            if self.select_count == 1:
                return []
            return [{
                "id": "event-1", "status": "pending",
                "payload": {"recipient_ids": ["consumer-1"], "message_count": 2, "preview": "Anterior"},
            }]

        async def update(self, _table, payload, **_filters):
            self.updated = payload
            return [{"id": "event-1", **payload}]

    database = Database()
    monkeypatch.setattr(communications, "db", database)
    result = asyncio.run(communications.publish_event(
        "chat.digest", "conversation", "conversation-1", "digest-key",
        payload={"recipient_ids": ["consumer-1"], "preview": "Nuevo", "message_count": 1},
    ))
    assert result["payload"]["message_count"] == 3
    assert result["payload"]["preview"] == "Nuevo"


def test_resend_bounce_webhook_is_verified_and_suppresses_email(monkeypatch) -> None:
    class Database:
        def __init__(self):
            self.suppression = None

        async def select(self, table, **_filters):
            if table == "resend_webhook_events":
                return []
            if table == "communication_deliveries":
                return [{"id": "delivery-1", "user_id": "consumer-1"}]
            return []

        async def insert(self, _table, payload):
            return payload

        async def update(self, _table, payload, **_filters):
            return [payload]

        async def upsert(self, table, payload, _conflict):
            if table == "email_suppressions":
                self.suppression = payload
            return payload

    database = Database()
    secret_bytes = b"resend-signing-secret"
    secret = "whsec_" + base64.b64encode(secret_bytes).decode()
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    webhook_id = "msg_test"
    body = json.dumps({"type": "email.bounced", "data": {"email_id": "email-1"}}).encode()
    signed = webhook_id.encode() + b"." + timestamp.encode() + b"." + body
    signature = base64.b64encode(hmac.new(secret_bytes, signed, hashlib.sha256).digest()).decode()

    headers = [(b"svix-id", webhook_id.encode()), (b"svix-timestamp", timestamp.encode()), (b"svix-signature", f"v1,{signature}".encode())]
    consumed = False

    async def receive():
        nonlocal consumed
        if consumed:
            return {"type": "http.request", "body": b"", "more_body": False}
        consumed = True
        return {"type": "http.request", "body": body, "more_body": False}

    request = Request({"type": "http", "method": "POST", "path": "/api/v1/webhooks/resend", "headers": headers}, receive)
    monkeypatch.setattr(main_module, "db", database)
    monkeypatch.setattr(main_module.settings, "resend_webhook_secret", secret)
    assert asyncio.run(main_module.resend_webhook(request)) == {"received": True}
    assert database.suppression == {
        "user_id": "consumer-1", "reason": "hard_bounce", "provider_event_id": webhook_id,
    }
