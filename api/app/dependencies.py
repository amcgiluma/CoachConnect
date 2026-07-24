import httpx
from fastapi import Header, HTTPException, status

from .config import settings
from .schemas import AuthUser


async def current_user(authorization: str | None = Header(default=None)) -> AuthUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inicia sesión para continuar")

    token = authorization.split(" ", 1)[1].strip()
    if settings.environment in {"test", "testing"} and token == "coachconnect-test-token":
        return AuthUser(id="00000000-0000-0000-0000-000000000001", email="test@coachconnect.local")

    if not settings.supabase_url:
        raise HTTPException(status_code=503, detail="Supabase no está configurado")

    api_key = settings.supabase_publishable_key or settings.supabase_secret_key
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers={"apikey": api_key, "Authorization": f"Bearer {token}"},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sesión no válida o caducada")
    payload = response.json()
    return AuthUser(id=payload["id"], email=payload.get("email"))
