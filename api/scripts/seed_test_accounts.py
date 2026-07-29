r"""Create idempotent CoachConnect test accounts in the linked Supabase project.

Usage (PowerShell):
  $env:PYTHONPATH = "api"
  $env:COACHCONNECT_TEST_PASSWORD = "a-random-password"
  .venv\Scripts\python.exe api/scripts/seed_test_accounts.py

The script derives Gmail plus-aliases from the first existing Auth user. It
never stores or prints the password and refuses to run outside development.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from app.config import settings


ACCOUNTS = (
    {"alias": "coachconnect.consumer1", "name": "Lucía Prueba", "role": "consumer"},
    {"alias": "coachconnect.consumer2", "name": "Álvaro Prueba", "role": "consumer"},
    {
        "alias": "coachconnect.coach1",
        "name": "Marta Entrenadora",
        "role": "coach",
        "headline": "Fuerza funcional y movilidad",
        "bio": "Entrenadora de prueba para validar reservas, pagos y mensajería de CoachConnect.",
        "city": "Madrid",
        "mode": "hibrido",
        "category": "fitness",
        "service": "Sesión funcional individual",
        "price_cents": 3200,
    },
    {
        "alias": "coachconnect.coach2",
        "name": "David Entrenador",
        "role": "coach",
        "headline": "Boxeo técnico y acondicionamiento",
        "bio": "Entrenador de prueba para validar conversaciones simultáneas y aislamiento entre usuarios.",
        "city": "Madrid",
        "mode": "presencial",
        "category": "martial",
        "service": "Boxeo técnico individual",
        "price_cents": 2800,
    },
)


class SupabaseSeeder:
    def __init__(self) -> None:
        self.base = settings.supabase_url.rstrip("/")
        self.headers = {
            "apikey": settings.supabase_secret_key,
            "Authorization": f"Bearer {settings.supabase_secret_key}",
        }
        self.client = httpx.AsyncClient(timeout=30, headers=self.headers)

    async def close(self) -> None:
        await self.client.aclose()

    async def auth_users(self) -> list[dict[str, Any]]:
        response = await self.client.get(f"{self.base}/auth/v1/admin/users", params={"page": 1, "per_page": 1000})
        response.raise_for_status()
        return response.json().get("users", [])

    async def create_or_update_user(self, email: str, password: str, name: str, existing: dict[str, Any] | None) -> str:
        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": name, "locale": "es", "test_account": True},
        }
        if existing:
            response = await self.client.put(f"{self.base}/auth/v1/admin/users/{existing['id']}", json=payload)
        else:
            response = await self.client.post(f"{self.base}/auth/v1/admin/users", json=payload)
        response.raise_for_status()
        return response.json()["id"]

    async def rest(self, method: str, table: str, *, params: dict[str, str] | None = None, payload: Any = None, upsert: bool = False) -> Any:
        headers = {**self.headers, "Content-Type": "application/json", "Prefer": "return=representation"}
        if upsert:
            headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        response = await self.client.request(method, f"{self.base}/rest/v1/{table}", params=params, json=payload, headers=headers)
        response.raise_for_status()
        return response.json() if response.content else []


async def main() -> None:
    if settings.environment != "development":
        raise SystemExit("Este sembrado solo se puede ejecutar con ENVIRONMENT=development")
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise SystemExit("Faltan SUPABASE_URL y SUPABASE_SECRET_KEY")
    password = os.environ.get("COACHCONNECT_TEST_PASSWORD", "")
    if len(password) < 16:
        raise SystemExit("COACHCONNECT_TEST_PASSWORD debe tener al menos 16 caracteres")

    seed = SupabaseSeeder()
    try:
        users = await seed.auth_users()
        if not users:
            raise SystemExit("Se necesita un usuario Auth existente para derivar alias de correo")
        owner_email = users[0].get("email", "")
        local, separator, domain = owner_email.partition("@")
        if not separator or domain.casefold() not in {"gmail.com", "googlemail.com"}:
            raise SystemExit("El primer usuario debe usar Gmail para crear alias entregables")
        local = local.split("+", 1)[0]
        existing_by_email = {user.get("email", "").casefold(): user for user in users}
        category_rows = await seed.rest("GET", "categories", params={"select": "id,slug", "slug": "in.(fitness,martial)"})
        category_ids = {row["slug"]: row["id"] for row in category_rows}
        result: list[dict[str, str]] = []

        for account in ACCOUNTS:
            email = f"{local}+{account['alias']}@{domain}".casefold()
            user_id = await seed.create_or_update_user(email, password, account["name"], existing_by_email.get(email))
            await seed.rest(
                "POST",
                "profiles",
                params={"on_conflict": "id"},
                payload={"id": user_id, "display_name": account["name"], "role": account["role"], "locale": "es"},
                upsert=True,
            )

            if account["role"] == "coach":
                await seed.rest(
                    "POST",
                    "coach_profiles",
                    params={"on_conflict": "user_id"},
                    payload={
                        "user_id": user_id,
                        "headline": account["headline"],
                        "bio": account["bio"],
                        "city": account["city"],
                        "mode": account["mode"],
                        "verification_status": "verified",
                        "responds_now": True,
                        "rating": 5,
                        "review_count": 0,
                        "languages": ["es", "en"],
                        "years_experience": 5,
                        "preferred_video_provider": "custom",
                    },
                    upsert=True,
                )
                services = await seed.rest(
                    "GET",
                    "coach_services",
                    params={"select": "id", "coach_id": f"eq.{user_id}", "name": f"eq.{account['service']}"},
                )
                service_payload = {
                    "coach_id": user_id,
                    "category_id": category_ids[account["category"]],
                    "name": account["service"],
                    "description": "Servicio de prueba para el recorrido completo de CoachConnect.",
                    "mode": account["mode"],
                    "duration_minutes": 60,
                    "price_cents": account["price_cents"],
                    "package_size": 1,
                    "active": True,
                }
                if services:
                    await seed.rest("PATCH", "coach_services", params={"id": f"eq.{services[0]['id']}"}, payload=service_payload)
                else:
                    await seed.rest("POST", "coach_services", payload=service_payload)

                await seed.rest("DELETE", "availability_rules", params={"coach_id": f"eq.{user_id}"})
                await seed.rest(
                    "POST",
                    "availability_rules",
                    payload=[
                        {"coach_id": user_id, "weekday": weekday, "starts_at": "09:00", "ends_at": "20:00", "timezone": "Europe/Madrid"}
                        for weekday in range(7)
                    ],
                )
            result.append({"email": email, "role": account["role"], "name": account["name"], "id": user_id})

        print("Cuentas de prueba preparadas:")
        for account in result:
            print(f"- {account['role']}: {account['name']} <{account['email']}> ({account['id']})")
        print("La contraseña se recibió por variable de entorno y no se ha guardado.")
    finally:
        await seed.close()


if __name__ == "__main__":
    asyncio.run(main())
