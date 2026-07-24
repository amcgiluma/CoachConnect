from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_categories_are_seeded() -> None:
    response = client.get("/api/v1/categories")
    assert response.status_code == 200
    assert len(response.json()) == 8


def test_matching_prioritises_selected_category() -> None:
    response = client.post("/api/v1/matching/search", json={"category": "martial", "city": "Madrid", "availability": "ahora"})
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "marcos-sanz"


def test_matching_applies_budget_as_eligibility_filter() -> None:
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
