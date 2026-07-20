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
