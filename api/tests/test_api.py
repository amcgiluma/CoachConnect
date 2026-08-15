import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

import app.main as main_module
import app.services as services_module
from app.main import app
from app.schemas import AuthUser, CancellationRequest, CoachSummary, MatchRequest, MessageCreateRequest, ReportCreateRequest, ReviewCreateRequest, ServiceCreateRequest, ServiceMode

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_flexible_recurring_service_does_not_require_a_fixed_cadence() -> None:
    service = ServiceCreateRequest(
        category_id="category-1", name="Plan flexible", mode=ServiceMode.online,
        duration_minutes=60, price_cents=12000, package_size=4,
        offer_type="recurring_plan", expiry_days=90,
        recurring_schedule_mode="flexible", cadence_weeks=None,
    )

    assert service.recurring_schedule_mode == "flexible"
    assert service.cadence_weeks is None


def test_service_normalizes_its_available_weekdays_and_horizon() -> None:
    service = ServiceCreateRequest(
        category_id="category-1", name="Fuerza de fin de semana", mode=ServiceMode.online,
        duration_minutes=60, price_cents=3500, booking_window_days=60,
        available_weekdays=[6, 5, 6],
    )

    assert service.available_weekdays == [5, 6]
    assert service.booking_window_days == 60


def test_service_validates_its_available_hours() -> None:
    with pytest.raises(ValueError, match="hora final"):
        ServiceCreateRequest(
            category_id="category-1", name="Fuerza de tarde", mode=ServiceMode.online,
            duration_minutes=60, price_cents=3500,
            available_start_time="19:00", available_end_time="18:00",
        )


def test_request_service_notice_is_configurable_and_covers_response_window() -> None:
    service = ServiceCreateRequest(
        category_id="category-1", name="Solicitud anticipada", mode=ServiceMode.online,
        duration_minutes=60, price_cents=3500, booking_mode="request",
        acceptance_window_hours=12, request_booking_notice_minutes=24 * 60,
    )

    assert service.request_booking_notice_minutes == 1440
    assert services_module.booking_notice_minutes(service.model_dump(), {"min_booking_notice_minutes": 30}) == 1440

    with pytest.raises(ValueError, match="plazo de respuesta"):
        ServiceCreateRequest(
            category_id="category-1", name="Solicitud demasiado próxima", mode=ServiceMode.online,
            duration_minutes=60, price_cents=3500, booking_mode="request",
            acceptance_window_hours=12, request_booking_notice_minutes=6 * 60,
        )


def test_client_reward_reduces_the_platform_fee_snapshot(monkeypatch) -> None:
    class RewardDatabase:
        async def select(self, table: str, select: str = "*", **filters):
            assert table == "client_rewards"
            return [{"qualifying_review_count": 25, "tier": "silver", "commission_discount_bps": 200}]

    monkeypatch.setattr(services_module, "db", RewardDatabase())
    reward = asyncio.run(services_module.client_reward_terms("consumer-1"))

    assert reward["tier"] == "silver"
    assert reward["platform_fee_rate_bps"] == 1300
    assert services_module.platform_fee(10_000, reward["platform_fee_rate_bps"]) == 1300


def test_booking_schedule_enforces_notice_horizon_and_weekday() -> None:
    now = datetime.now(timezone.utc)
    service = {"booking_window_days": 60, "available_weekdays": [now.weekday()]}
    coach = {"min_booking_notice_minutes": 120}

    with pytest.raises(HTTPException) as notice_error:
        services_module.validate_booking_schedule(service, coach, [now + timedelta(minutes=60)])
    assert notice_error.value.status_code == 409

    with pytest.raises(HTTPException) as horizon_error:
        services_module.validate_booking_schedule(service, coach, [now + timedelta(days=61)])
    assert horizon_error.value.status_code == 409


def test_booking_schedule_enforces_service_hours() -> None:
    local_zone = ZoneInfo("Europe/Madrid")
    starts_at = (datetime.now(local_zone) + timedelta(days=8)).replace(hour=8, minute=0, second=0, microsecond=0)
    service = {
        "booking_window_days": 60,
        "available_weekdays": [starts_at.weekday()],
        "available_start_time": "09:00",
        "available_end_time": "12:00",
        "duration_minutes": 60,
    }

    with pytest.raises(HTTPException) as time_error:
        services_module.validate_booking_schedule(service, {"min_booking_notice_minutes": 0}, [starts_at])

    assert time_error.value.status_code == 409
    assert "hora" in time_error.value.detail


def test_single_service_does_not_send_unmigrated_recurring_column(monkeypatch) -> None:
    class ServiceDatabase:
        async def insert(self, table: str, payload: dict):
            assert table == "coach_services"
            assert "recurring_schedule_mode" not in payload
            return {"id": "service-1", **payload}

    monkeypatch.setattr(main_module, "db", ServiceDatabase())
    payload = ServiceCreateRequest(
        category_id="tennis", name="Tenis con el lete", mode=ServiceMode.in_person,
        duration_minutes=20, price_cents=500,
    )

    result = asyncio.run(main_module.create_service(payload, AuthUser(id="coach-1")))

    assert result["name"] == "Tenis con el lete"


def test_coach_cannot_checkout_their_own_service(monkeypatch) -> None:
    class OwnServiceDatabase:
        async def select(self, table: str, select: str = "*", **filters):
            assert table == "coach_services"
            return [{"id": "service-1", "coach_id": "coach-1", "active": True}]

    monkeypatch.setattr(services_module, "db", OwnServiceDatabase())

    with pytest.raises(HTTPException) as error:
        asyncio.run(services_module.create_checkout(
            "coach-1", "service-1", datetime.now(timezone.utc) + timedelta(days=1), "", "meet",
        ))

    assert error.value.status_code == 409
    assert "contigo mismo" in error.value.detail


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


def test_matching_checks_every_active_service_specialty() -> None:
    coach = CoachSummary(
        id="juanma", name="Juanma el mejor", specialty="Soy el mejor",
        specialties=["Entrenamiento de calistenia", "Kung fu juanminator", "kung-fu"],
        category="martial", mode=ServiceMode.hybrid, city="Málaga", rating=0,
        reviews=0, price_from=10, next_slot="Consulta su agenda", responds_now=False,
        verified=True,
    )

    result = main_module.rank_coaches(
        [coach], MatchRequest(category="martial", subcategory="Kung Fu"),
    )

    assert [item.id for item in result.items] == ["juanma"]
    assert "Especialidad específica compatible" in result.items[0].match_reasons


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


def test_remote_database_errors_are_not_replaced_with_demo_coaches(monkeypatch) -> None:
    class BrokenRemoteDatabase:
        ready = True

        async def select(self, table: str, select: str = "*", **filters):
            raise HTTPException(400, "remote schema error")

    monkeypatch.setattr(main_module, "db", BrokenRemoteDatabase())

    with pytest.raises(HTTPException, match="remote schema error"):
        asyncio.run(main_module.remote_coaches("fitness"))


def test_public_coach_detail_uses_safe_projection(monkeypatch) -> None:
    database = PublicCoachDatabase()
    monkeypatch.setattr(main_module, "db", database)

    row = asyncio.run(main_module.coach_detail("coach-1"))

    assert row["user_id"] == "coach-1"
    assert "video_path" not in row
    assert "video_status" not in row
    coach_query = next(item for item in database.selects if item[0] == "coach_profiles")
    assert coach_query[1] == f"{main_module.PUBLIC_COACH_SELECT},video_path,video_status"
    assert coach_query[2]["verification_status"] == "eq.verified"


def test_public_coach_detail_exposes_only_an_approved_signed_video(monkeypatch) -> None:
    database = PublicCoachDatabase()
    original_select = database.select

    async def select(table: str, select: str = "*", **filters):
        rows = await original_select(table, select, **filters)
        if table == "coach_profiles" and rows:
            rows[0]["video_path"] = "coach-1/presentation.mp4"
            rows[0]["video_status"] = "approved"
        return rows

    async def signed_url(bucket: str, path: str, expires_in: int = 300):
        assert (bucket, path, expires_in) == ("coach-videos", "coach-1/presentation.mp4", 3600)
        return "https://storage.example/signed-video"

    database.select = select
    monkeypatch.setattr(main_module, "db", database)
    monkeypatch.setattr(main_module, "storage_signed_url", signed_url)

    row = asyncio.run(main_module.coach_detail("coach-1"))

    assert row["presentation_video_url"] == "https://storage.example/signed-video"
    assert "video_path" not in row
    assert "video_status" not in row


def test_account_profile_returns_email_and_keeps_coach_city_in_sync(monkeypatch) -> None:
    class ProfileDatabase:
        ready = False

        def __init__(self) -> None:
            self.updates: list[tuple[str, dict, dict]] = []

        async def update(self, table: str, payload: dict, **filters):
            self.updates.append((table, payload, filters))
            if table == "profiles":
                return [{"id": "coach-1", "role": "coach", **payload}]
            return [payload]

    database = ProfileDatabase()
    monkeypatch.setattr(main_module, "db", database)
    payload = main_module.ProfileUpdateRequest(display_name="Marta", city="Sevilla")

    row = asyncio.run(main_module.update_me(payload, AuthUser(id="coach-1", email="marta@example.com")))

    assert row["email"] == "marta@example.com"
    assert row["city"] == "Sevilla"
    assert database.updates[0][0] == "profiles"
    assert database.updates[1][0] == "coach_profiles"
    assert database.updates[1][1]["city"] == "Sevilla"


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


def test_coach_can_save_different_hours_for_each_weekday(monkeypatch) -> None:
    class AvailabilityDatabase:
        def __init__(self) -> None:
            self.rows: list[dict] = []

        async def request(self, method: str, table: str, **kwargs):
            assert (method, table) == ("DELETE", "availability_rules")
            return []

        async def insert(self, table: str, payload: dict):
            assert table == "availability_rules"
            self.rows.append(payload)
            return payload

    database = AvailabilityDatabase()
    monkeypatch.setattr(main_module, "db", database)
    rules = [
        main_module.AvailabilityRuleRequest(weekday=0, starts_at="07:00", ends_at="11:00"),
        main_module.AvailabilityRuleRequest(weekday=4, starts_at="16:00", ends_at="20:30"),
    ]

    asyncio.run(main_module.replace_availability(rules, AuthUser(id="coach-1")))

    assert [(row["weekday"], row["starts_at"], row["ends_at"]) for row in database.rows] == [
        (0, "07:00", "11:00"),
        (4, "16:00", "20:30"),
    ]


def test_coach_can_add_one_off_availability(monkeypatch) -> None:
    class ExceptionDatabase:
        async def insert(self, table: str, payload: dict):
            assert table == "availability_exceptions"
            return payload

    monkeypatch.setattr(main_module, "db", ExceptionDatabase())
    payload = main_module.AvailabilityExceptionRequest(
        starts_at=datetime(2026, 8, 30, 9, tzinfo=timezone.utc),
        ends_at=datetime(2026, 8, 30, 12, tzinfo=timezone.utc),
        available=True,
        label="Clase especial",
    )

    row = asyncio.run(main_module.create_availability_exception(payload, AuthUser(id="coach-1")))

    assert row["available"] is True
    assert row["coach_id"] == "coach-1"


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


def test_stripe_account_is_only_ready_when_charges_and_payouts_are_enabled(monkeypatch) -> None:
    monkeypatch.setattr(services_module.settings, "stripe_secret_key", "sk_test_example")
    monkeypatch.setattr(
        services_module.stripe.Account,
        "retrieve",
        lambda _: {
            "details_submitted": False,
            "charges_enabled": False,
            "payouts_enabled": False,
            "requirements": {"currently_due": ["external_account", "individual.id_number"]},
        },
    )

    state = services_module.stripe_account_status("acct_pending")

    assert state == {"status": "pending", "ready": False, "requirements_due": 2}


def test_supabase_admin_authenticates_database_calls_as_service_role(monkeypatch) -> None:
    monkeypatch.setattr(services_module.settings, "supabase_url", "http://127.0.0.1:54321")
    monkeypatch.setattr(services_module.settings, "supabase_secret_key", "service-role-test-key")

    database = services_module.SupabaseAdmin()

    assert database.headers["apikey"] == "service-role-test-key"
    assert database.headers["Authorization"] == "Bearer service-role-test-key"


def test_supabase_admin_surfaces_postgrest_multiple_choice_as_an_error(monkeypatch) -> None:
    monkeypatch.setattr(services_module.settings, "supabase_url", "http://127.0.0.1:54321")
    monkeypatch.setattr(services_module.settings, "supabase_secret_key", "service-role-test-key")

    class MultipleChoiceResponse:
        status_code = 300
        content = b'{"message":"Could not embed because more than one relationship was found"}'
        text = content.decode()

        def json(self):
            return {"message": "Could not embed because more than one relationship was found"}

    class FakeClient:
        is_closed = False

        async def request(self, *args, **kwargs):
            return MultipleChoiceResponse()

    database = services_module.SupabaseAdmin()
    database._client = FakeClient()

    with pytest.raises(HTTPException) as error:
        asyncio.run(database.select("bookings", select="*,profiles(display_name)"))

    assert error.value.status_code == 502
    assert "more than one relationship" in error.value.detail


def test_integrations_does_not_treat_a_saved_stripe_id_as_connected(monkeypatch) -> None:
    class IntegrationDatabase:
        async def select(self, table: str, select: str = "*", **filters):
            if table == "coach_profiles":
                return [{"stripe_account_id": "acct_pending", "custom_video_url": None}]
            return []

    monkeypatch.setattr(main_module, "db", IntegrationDatabase())
    monkeypatch.setattr(
        main_module,
        "stripe_account_status",
        lambda _: {"status": "pending", "ready": False, "requirements_due": 17},
    )

    result = asyncio.run(main_module.coach_integrations(AuthUser(id="coach-1")))

    assert result["stripe"] is False
    assert result["stripe_status"] == "pending"
    assert result["stripe_requirements_due"] == 17


def test_zoom_oauth_rejects_a_localhost_callback(monkeypatch) -> None:
    monkeypatch.setattr(services_module.settings, "zoom_client_id", "zoom-client")
    monkeypatch.setattr(services_module.settings, "zoom_client_secret", "zoom-secret")
    monkeypatch.setattr(
        services_module.settings,
        "zoom_redirect_uri",
        "http://localhost:8000/api/v1/integrations/zoom/callback",
    )
    monkeypatch.setattr(services_module, "signed_oauth_state", lambda _: "signed-state")

    with pytest.raises(HTTPException) as error:
        services_module.oauth_url("zoom", "coach-1")

    assert error.value.status_code == 503
    assert "HTTPS no-localhost" in error.value.detail


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


def test_conversation_report_infers_the_other_participant(monkeypatch) -> None:
    database = ChatDatabase()
    monkeypatch.setattr(main_module, "db", database)

    row = asyncio.run(main_module.create_report(
        ReportCreateRequest(
            conversation_id="conversation-1",
            reason="Comportamiento abusivo",
            details="Ha insistido después de pedirle que parase.",
        ),
        AuthUser(id="consumer-1", email="consumer@example.com"),
    ))

    assert row["reported_user_id"] == "coach-1"
    assert database.inserted[-1][0] == "reports"
    assert database.inserted[-1][1]["reporter_id"] == "consumer-1"


def test_active_messaging_sanction_prevents_sending(monkeypatch) -> None:
    class SanctionedChatDatabase(ChatDatabase):
        async def select(self, table: str, select: str = "*", **filters):
            if table == "moderation_sanctions":
                return [{
                    "id": "sanction-1", "kind": "messaging",
                    "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                }]
            return await super().select(table, select, **filters)

    database = SanctionedChatDatabase()
    monkeypatch.setattr(main_module, "db", database)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main_module.send_message(
            "conversation-1",
            MessageCreateRequest(body="Este mensaje no debe guardarse"),
            BackgroundTasks(),
            AuthUser(id="consumer-1", email="consumer@example.com"),
        ))

    assert error.value.status_code == 403
    assert "mensajería" in error.value.detail
    assert database.inserted == []


class CancellationDatabase:
    ready = False

    def __init__(self, starts_at: datetime) -> None:
        self.starts_at = starts_at
        self.updates: list[tuple[str, dict, dict]] = []

    async def select(self, table: str, select: str = "*", **filters):
        if table == "bookings":
            return [{
                "id": "booking-1", "consumer_id": "consumer-1", "coach_id": "coach-1",
                "status": "confirmed", "starts_at": self.starts_at.isoformat(), "amount_cents": 4000,
                "stripe_payment_intent_id": None,
            }]
        return []

    async def update(self, table: str, payload: dict, **filters):
        self.updates.append((table, payload, filters))
        return [{"id": filters.get("id", "row"), **payload}]

    async def insert(self, table: str, payload: dict):
        return {"id": "cancellation-1", **payload}


def test_client_cannot_cancel_inside_24_hour_window(monkeypatch) -> None:
    database = CancellationDatabase(datetime.now(timezone.utc) + timedelta(hours=23))
    monkeypatch.setattr(main_module, "db", database)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main_module.cancel_booking(
            "booking-1", CancellationRequest(reason="Cambio de planes"), AuthUser(id="consumer-1"),
        ))

    assert error.value.status_code == 409
    assert database.updates == []


def test_coach_cannot_cancel_inside_24_hour_window(monkeypatch) -> None:
    database = CancellationDatabase(datetime.now(timezone.utc) + timedelta(hours=2))
    monkeypatch.setattr(main_module, "db", database)

    with pytest.raises(HTTPException) as error:
        asyncio.run(main_module.cancel_booking(
            "booking-1", CancellationRequest(reason="Emergencia"), AuthUser(id="coach-1"),
        ))

    assert error.value.status_code == 409
    assert "ambas partes" in error.value.detail
    assert database.updates == []


def test_bilateral_reviews_stay_hidden_until_both_parties_submit(monkeypatch) -> None:
    class ReviewDatabase:
        ready = False

        def __init__(self) -> None:
            self.reviews = [{"id": "review-client", "author_id": "consumer-1"}]
            self.revealed = False

        async def select(self, table: str, select: str = "*", **filters):
            if table == "bookings":
                return [{
                    "id": "booking-1", "consumer_id": "consumer-1", "coach_id": "coach-1",
                    "status": "completed", "outcome_status": "attended", "ends_at": datetime.now(timezone.utc).isoformat(),
                    "outcome_finalized_at": datetime.now(timezone.utc).isoformat(),
                }]
            if table == "reviews":
                return self.reviews
            return []

        async def upsert(self, table: str, payload: dict, _conflict: str):
            row = {"id": "review-coach", **payload}
            self.reviews.append(row)
            return row

        async def update(self, table: str, payload: dict, **filters):
            self.revealed = bool(payload.get("revealed_at"))
            return self.reviews

    database = ReviewDatabase()
    monkeypatch.setattr(main_module, "db", database)
    payload = ReviewCreateRequest(
        rating=5, comment="Cliente comprometido", punctuality=5, communication=5, respect=5, commitment=5,
    )

    result = asyncio.run(main_module.create_review("booking-1", payload, AuthUser(id="coach-1")))

    assert result["target_role"] == "consumer"
    assert result["subject_id"] == "consumer-1"
    assert database.revealed is True
    assert result["revealed_at"] is not None


def test_user_can_review_after_confirming_own_attendance(monkeypatch) -> None:
    class AttendanceReviewDatabase:
        ready = False

        async def select(self, table: str, select: str = "*", **filters):
            if table == "bookings":
                return [{
                    "id": "booking-1", "consumer_id": "consumer-1", "coach_id": "coach-1",
                    "status": "completed", "outcome_status": None,
                    "ends_at": datetime.now(timezone.utc).isoformat(), "outcome_finalized_at": None,
                }]
            if table == "session_reports":
                return [{"author_id": "consumer-1", "outcome": "attended"}]
            if table == "reviews":
                return [{"id": "review-1", "author_id": "consumer-1"}]
            return []

        async def upsert(self, table: str, payload: dict, _conflict: str):
            return {"id": "review-1", **payload}

    monkeypatch.setattr(main_module, "db", AttendanceReviewDatabase())
    payload = ReviewCreateRequest(
        rating=5, comment="Buena sesión", punctuality=5, communication=5, respect=5,
        quality=5, personalization=5, safety=5,
    )

    result = asyncio.run(main_module.create_review("booking-1", payload, AuthUser(id="consumer-1")))

    assert result["target_role"] == "coach"
