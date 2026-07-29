import asyncio
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from fastapi import HTTPException
from starlette.requests import Request

import app.main as main_module
from app.main import app
from app.schemas import AuthUser, MessageCreateRequest

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_categories_are_seeded() -> None:
    response = client.get("/api/v1/categories")
    assert response.status_code == 200
    assert len(response.json()) == 8


class DemoDatabase:
    ready = False


def test_matching_prioritises_selected_category(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "db", DemoDatabase())
    response = client.post("/api/v1/matching/search", json={"category": "martial", "city": "Madrid", "availability": "ahora"})
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "marcos-sanz"


def test_matching_applies_budget_as_eligibility_filter(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "db", DemoDatabase())
    response = client.post(
        "/api/v1/matching/search",
        json={"category": "running", "max_price": 25, "priority": "price"},
    )
    assert response.status_code == 200
    assert response.json()["items"]
    assert all(item["price_from"] <= 25 for item in response.json()["items"])


def test_protected_routes_require_a_bearer_token() -> None:
    response = client.get("/api/v1/me")
    assert response.status_code == 401


def test_checkout_keeps_local_auth_origin() -> None:
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/checkout",
        "headers": [(b"origin", b"http://127.0.0.1:5173")],
    })

    assert main_module.frontend_url_for_request(request) == "http://127.0.0.1:5173"


def test_checkout_rejects_untrusted_return_origin() -> None:
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/api/v1/checkout",
        "headers": [(b"origin", b"https://attacker.example")],
    })

    assert main_module.frontend_url_for_request(request) == main_module.settings.frontend_url.rstrip("/")


class ChatDatabase:
    def __init__(self, *, has_existing_message: bool = False) -> None:
        self.has_existing_message = has_existing_message
        self.inserted: list[tuple[str, dict]] = []

    async def select(self, table: str, select: str = "*", **filters):
        if table == "conversations":
            return [{"id": "conversation-1", "consumer_id": "consumer-1", "coach_id": "coach-1", "last_message_at": "2026-07-27T12:00:00Z"}]
        if table == "blocked_users":
            return []
        if table == "messages":
            return [{"id": "older-message"}] if self.has_existing_message else []
        if table == "profiles":
            if select == "display_name":
                return [{"display_name": "Lucía Prueba"}]
            return [
                {"id": "consumer-1", "display_name": "Lucía Prueba"},
                {"id": "coach-1", "display_name": "Marta Entrenadora"},
            ]
        return []

    async def insert(self, table: str, payload: dict):
        self.inserted.append((table, payload))
        return {
            "id": "message-1",
            **payload,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    async def update(self, table: str, payload: dict, **filters):
        return [{"id": filters.get("id", "row"), **payload}]


def test_conversations_resolve_both_participant_profiles(monkeypatch) -> None:
    database = ChatDatabase()
    monkeypatch.setattr(main_module, "db", database)

    rows = asyncio.run(main_module.conversations(AuthUser(id="consumer-1", email="consumer@example.com")))

    assert rows[0]["consumer"]["display_name"] == "Lucía Prueba"
    assert rows[0]["coach"]["display_name"] == "Marta Entrenadora"


def test_first_message_is_persisted_before_new_conversation_notification(monkeypatch) -> None:
    database = ChatDatabase()
    notifications: list[tuple] = []
    monkeypatch.setattr(main_module, "db", database)

    async def capture_notification(*args):
        notifications.append(args)

    monkeypatch.setattr(main_module, "notify_user", capture_notification)
    row = asyncio.run(main_module.send_message(
        "conversation-1",
        MessageCreateRequest(body="Hola Marta"),
        AuthUser(id="consumer-1", email="consumer@example.com"),
    ))

    assert row["body"] == "Hola Marta"
    assert database.inserted[0][0] == "messages"
    assert notifications[0][1:4] == ("conversation_started", "Nueva conversación", "Lucía Prueba: Hola Marta")


def test_notification_failure_does_not_turn_saved_message_into_failed_send(monkeypatch) -> None:
    database = ChatDatabase(has_existing_message=True)
    monkeypatch.setattr(main_module, "db", database)

    async def failed_notification(*_args):
        raise HTTPException(503, "Proveedor de correo no disponible")

    monkeypatch.setattr(main_module, "notify_user", failed_notification)
    row = asyncio.run(main_module.send_message(
        "conversation-1",
        MessageCreateRequest(body="Segundo mensaje"),
        AuthUser(id="coach-1", email="coach@example.com"),
    ))

    assert row["id"] == "message-1"
    assert len([entry for entry in database.inserted if entry[0] == "messages"]) == 1
