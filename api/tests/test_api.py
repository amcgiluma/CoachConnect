import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

import app.main as main_module
from app.main import app
from app.schemas import AuthUser, CoachSummary, MatchRequest, MessageCreateRequest, ServiceMode

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
    response = client.post("/api/v1/matching/search", json={"category": "martial", "city": "Madrid"})
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "marcos-sanz"


def test_matching_applies_budget_as_eligibility_filter(monkeypatch) -> None:
    monkeypatch.setattr(main_module, "db", DemoDatabase())
    response = client.post(
        "/api/v1/matching/search",
        json={"category": "running", "max_price": 25},
    )
    assert response.status_code == 200
    assert response.json()["items"]
    assert all(item["price_from"] <= 25 for item in response.json()["items"])


def test_matching_uses_fixed_rating_then_response_order() -> None:
    def coach(coach_id: str, *, rating: float, reviews: int, responds_now: bool) -> CoachSummary:
        return CoachSummary(
            id=coach_id,
            name=coach_id,
            specialty="Muay Thai",
            category="martial",
            mode=ServiceMode.in_person,
            city="Madrid",
            rating=rating,
            reviews=reviews,
            price_from=30,
            next_slot="Mañana",
            responds_now=responds_now,
            verified=True,
        )

    result = main_module.rank_coaches(
        [
            coach("fast-lower-rating", rating=4.8, reviews=100, responds_now=True),
            coach("slow-best-rating", rating=5.0, reviews=20, responds_now=False),
            coach("slow-tie", rating=4.9, reviews=30, responds_now=False),
            coach("fast-tie", rating=4.9, reviews=30, responds_now=True),
        ],
        MatchRequest(category="martial", subcategory="Muay Thai", city="Madrid"),
    )

    assert [item.id for item in result.items] == [
        "slow-best-rating",
        "fast-tie",
        "slow-tie",
        "fast-lower-rating",
    ]


class PublicCoachDatabase:
    ready = True

    def __init__(self) -> None:
        self.selects: list[tuple[str, str, dict]] = []

    async def select(self, table: str, select: str = "*", **filters):
        self.selects.append((table, select, filters))
        if table == "categories":
            return [
                {"id": "parent-fitness", "slug": "fitness", "parent_id": None},
                {"id": "child-strength", "slug": "strength", "parent_id": "parent-fitness"},
            ]
        if table == "coach_profiles":
            return [{
                "user_id": "coach-1",
                "headline": "Fuerza para principiantes",
                "bio": "Entrenamiento progresivo y adaptado.",
                "city": "Madrid",
                "mode": "hibrido",
                "verification_status": "verified",
                "responds_now": False,
                "rating": 4.8,
                "review_count": 12,
                "languages": ["es"],
                "profiles": {"display_name": "Marta Entrenadora", "avatar_url": None},
                "coach_services": [{
                    "id": "service-1",
                    "name": "Fuerza inicial",
                    "price_cents": 3000,
                    "active": True,
                    "categories": {"id": "child-strength", "slug": "strength", "parent_id": "parent-fitness"},
                }],
            }]
        return []


def test_remote_coach_uses_parent_category_and_only_verified_profiles(monkeypatch) -> None:
    database = PublicCoachDatabase()
    monkeypatch.setattr(main_module, "db", database)

    rows = asyncio.run(main_module.remote_coaches("fitness"))

    assert rows[0].category == "fitness"
    coach_query = next(item for item in database.selects if item[0] == "coach_profiles")
    assert coach_query[2]["verification_status"] == "eq.verified"
    assert "stripe_account_id" not in coach_query[1]
    assert not coach_query[1].startswith("*")


def test_public_coach_detail_uses_safe_projection(monkeypatch) -> None:
    database = PublicCoachDatabase()
    monkeypatch.setattr(main_module, "db", database)

    row = asyncio.run(main_module.coach_detail("coach-1"))

    assert row["user_id"] == "coach-1"
    coach_query = next(item for item in database.selects if item[0] == "coach_profiles")
    assert coach_query[1] == main_module.PUBLIC_COACH_SELECT
    assert coach_query[2]["verification_status"] == "eq.verified"


def test_coach_calendar_is_scoped_to_owner_and_range(monkeypatch) -> None:
    class CalendarDatabase:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict]] = []

        async def select(self, table: str, select: str = "*", **filters):
            self.calls.append((table, filters))
            return []

    database = CalendarDatabase()
    monkeypatch.setattr(main_module, "db", database)
    date_from = datetime(2026, 7, 27, tzinfo=timezone.utc)
    date_to = date_from + timedelta(days=7)

    result = asyncio.run(main_module.coach_calendar(date_from, date_to, AuthUser(id="coach-1")))

    assert result == {"bookings": [], "exceptions": []}
    assert all(filters["coach_id"] == "eq.coach-1" for _, filters in database.calls)
    assert database.calls[0][1]["starts_at"].startswith("lt.2026-08-03")


def test_suspended_coach_cannot_resubmit_credentials(monkeypatch) -> None:
    class SuspendedDatabase:
        inserted = False

        async def select(self, table: str, select: str = "*", **filters):
            return [{"verification_status": "suspended"}]

        async def insert(self, table: str, payload: dict):
            self.inserted = True
            return payload

    database = SuspendedDatabase()
    monkeypatch.setattr(main_module, "db", database)
    payload = main_module.CredentialCreateRequest(title="Título", storage_path="coach-1/title.pdf")

    with pytest.raises(HTTPException) as error:
        asyncio.run(main_module.record_credential(payload, AuthUser(id="coach-1")))

    assert error.value.status_code == 409
    assert database.inserted is False


def test_resubmitted_credential_supersedes_pending_document_and_restarts_review(monkeypatch) -> None:
    class CredentialDatabase:
        def __init__(self) -> None:
            self.updates: list[tuple[str, dict, dict]] = []

        async def select(self, table: str, select: str = "*", **filters):
            return [{"verification_status": "verified"}]

        async def update(self, table: str, payload: dict, **filters):
            self.updates.append((table, payload, filters))
            return [payload]

        async def insert(self, table: str, payload: dict):
            return {"id": "credential-2", **payload}

    database = CredentialDatabase()
    monkeypatch.setattr(main_module, "db", database)

    row = asyncio.run(main_module.record_credential(
        main_module.CredentialCreateRequest(title="Nuevo título", storage_path="coach-1/new.pdf"),
        AuthUser(id="coach-1"),
    ))

    assert row["title"] == "Nuevo título"
    assert database.updates[0][0] == "credential_documents"
    assert database.updates[0][2]["status"] == "eq.pending"
    assert database.updates[1][1]["verification_status"] == "credentials_submitted"


def test_admin_credentials_include_coach_identity_and_only_pending_items(monkeypatch) -> None:
    class AdminDatabase:
        def __init__(self) -> None:
            self.credential_filters = {}

        async def select(self, table: str, select: str = "*", **filters):
            if table == "profiles" and filters.get("role") == "eq.admin":
                return [{"id": "admin-1"}]
            if table == "credential_documents":
                self.credential_filters = filters
                return [{"id": "doc-1", "coach_id": "coach-1", "title": "Técnico deportivo"}]
            if table == "profiles":
                return [{"id": "coach-1", "display_name": "Marta Entrenadora"}]
            return []

    database = AdminDatabase()
    monkeypatch.setattr(main_module, "db", database)

    rows = asyncio.run(main_module.admin_credentials(AuthUser(id="admin-1")))

    assert database.credential_filters["status"] == "eq.pending"
    assert rows[0]["profile"]["display_name"] == "Marta Entrenadora"


def test_admin_user_directory_combines_auth_access_and_coach_validity(monkeypatch) -> None:
    class AdminDatabase:
        async def select(self, table: str, select: str = "*", **filters):
            if table == "profiles" and filters.get("role") == "eq.admin":
                return [{"id": "admin-1"}]
            if table == "profiles":
                return [{"id": "coach-1", "display_name": "Marta", "role": "coach", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"}]
            if table == "coach_profiles":
                return [{"user_id": "coach-1", "verification_status": "verified", "verification_note": None}]
            return []

    async def auth_users():
        return [{"id": "coach-1", "email": "marta@example.com", "banned_until": "2126-01-01T00:00:00Z"}]

    monkeypatch.setattr(main_module, "db", AdminDatabase())
    monkeypatch.setattr(main_module, "auth_admin_list_users", auth_users)

    rows = asyncio.run(main_module.admin_users(AuthUser(id="admin-1")))

    assert rows[0]["email"] == "marta@example.com"
    assert rows[0]["access_enabled"] is False
    assert rows[0]["coach"]["verification_status"] == "verified"


def test_credential_status_returns_latest_document_and_video_state(monkeypatch) -> None:
    class CredentialDatabase:
        async def select(self, table: str, select: str = "*", **filters):
            if table == "coach_profiles":
                return [{
                    "verification_status": "credentials_submitted",
                    "verification_note": None,
                    "video_path": "coach-1/video.mp4",
                    "video_status": "pending",
                    "video_review_note": None,
                    "updated_at": "2026-07-30T10:00:00Z",
                }]
            assert filters["order"] == "created_at.desc"
            assert filters["limit"] == "1"
            return [{"id": "doc-2", "title": "Título actualizado", "status": "pending"}]

    monkeypatch.setattr(main_module, "db", CredentialDatabase())

    row = asyncio.run(main_module.credential_status(AuthUser(id="coach-1")))

    assert row["video_status"] == "pending"
    assert row["credential"]["title"] == "Título actualizado"


def test_admin_can_revoke_user_access_but_not_their_own(monkeypatch) -> None:
    class AdminDatabase:
        def __init__(self) -> None:
            self.audit: list[dict] = []

        async def select(self, table: str, select: str = "*", **filters):
            if filters.get("role") == "eq.admin":
                return [{"id": "admin-1"}]
            return [{"id": "coach-1"}]

        async def insert(self, table: str, payload: dict):
            self.audit.append(payload)
            return payload

    changes: list[tuple[str, bool]] = []

    async def set_access(user_id: str, enabled: bool):
        changes.append((user_id, enabled))
        return {"id": user_id}

    database = AdminDatabase()
    monkeypatch.setattr(main_module, "db", database)
    monkeypatch.setattr(main_module, "auth_admin_set_user_access", set_access)

    row = asyncio.run(main_module.admin_user_access(
        "coach-1",
        main_module.UserAccessRequest(enabled=False),
        AuthUser(id="admin-1"),
    ))

    assert row == {"id": "coach-1", "access_enabled": False}
    assert changes == [("coach-1", False)]
    assert database.audit[0]["action"] == "user.access.revoked"

    with pytest.raises(HTTPException) as error:
        asyncio.run(main_module.admin_user_access(
            "admin-1",
            main_module.UserAccessRequest(enabled=False),
            AuthUser(id="admin-1"),
        ))
    assert error.value.status_code == 409


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

    async def send_and_deliver():
        background = BackgroundTasks()
        row = await main_module.send_message(
            "conversation-1",
            MessageCreateRequest(body="Hola Marta"),
            background,
            AuthUser(id="consumer-1", email="consumer@example.com"),
        )
        assert notifications == []
        await background()
        return row

    row = asyncio.run(send_and_deliver())

    assert row["body"] == "Hola Marta"
    assert database.inserted[0][0] == "messages"
    assert notifications[0][1:4] == ("conversation_started", "Nueva conversación", "Lucía Prueba: Hola Marta")


def test_notification_failure_does_not_turn_saved_message_into_failed_send(monkeypatch) -> None:
    database = ChatDatabase(has_existing_message=True)
    monkeypatch.setattr(main_module, "db", database)

    async def failed_notification(*_args):
        raise HTTPException(503, "Proveedor de correo no disponible")

    monkeypatch.setattr(main_module, "notify_user", failed_notification)

    async def send_and_deliver():
        background = BackgroundTasks()
        row = await main_module.send_message(
            "conversation-1",
            MessageCreateRequest(body="Segundo mensaje"),
            background,
            AuthUser(id="coach-1", email="coach@example.com"),
        )
        await background()
        return row

    row = asyncio.run(send_and_deliver())

    assert row["id"] == "message-1"
    assert len([entry for entry in database.inserted if entry[0] == "messages"]) == 1


def test_messages_returns_latest_page_in_chronological_order(monkeypatch) -> None:
    class MessageDatabase(ChatDatabase):
        async def select(self, table: str, select: str = "*", **filters):
            if table == "messages":
                assert filters["order"] == "created_at.desc"
                assert filters["limit"] == "200"
                return [{"id": "newest"}, {"id": "older"}]
            return await super().select(table, select, **filters)

    monkeypatch.setattr(main_module, "db", MessageDatabase())

    rows = asyncio.run(main_module.messages(
        "conversation-1",
        AuthUser(id="consumer-1", email="consumer@example.com"),
    ))

    assert [row["id"] for row in rows] == ["older", "newest"]
