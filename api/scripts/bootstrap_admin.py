"""Promote one existing Supabase user to CoachConnect admin.

Usage from the repository root:
    python api/scripts/bootstrap_admin.py admin@example.com
"""

from __future__ import annotations

import asyncio
import sys

import httpx

sys.path.insert(0, "api")

from app.config import settings  # noqa: E402


async def main(email: str) -> None:
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise SystemExit("Configura SUPABASE_URL y SUPABASE_SECRET_KEY en api/.env")

    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        users_response = await client.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
            headers=headers,
            params={"per_page": 1000},
        )
        users_response.raise_for_status()
        users = users_response.json().get("users", [])
        matches = [user for user in users if user.get("email", "").casefold() == email.casefold()]
        if len(matches) != 1:
            raise SystemExit(f"Se esperaba un usuario exacto para {email}; encontrados: {len(matches)}")

        profile_response = await client.patch(
            f"{settings.supabase_url.rstrip('/')}/rest/v1/profiles",
            headers={**headers, "Prefer": "return=representation"},
            params={"id": f"eq.{matches[0]['id']}"},
            json={"role": "admin"},
        )
        profile_response.raise_for_status()
        if len(profile_response.json()) != 1:
            raise SystemExit("No se actualizó exactamente un perfil")
        print(f"Administrador creado: {email}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python api/scripts/bootstrap_admin.py <email>")
    asyncio.run(main(sys.argv[1]))
