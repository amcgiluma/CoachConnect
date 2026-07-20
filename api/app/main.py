from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .schemas import Category, MatchRequest, MatchResponse
from .seed import CATEGORIES, COACHES

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="API del marketplace CoachConnect.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}


@app.get("/api/v1/categories", response_model=list[Category], tags=["catalog"])
async def list_categories() -> list[Category]:
    return CATEGORIES


@app.post("/api/v1/matching/search", response_model=MatchResponse, tags=["matching"])
async def match_coaches(request: MatchRequest) -> MatchResponse:
    ranked = []
    for coach in COACHES:
        score = 0
        reasons: list[str] = []
        if coach.category == request.category:
            score += 65
            reasons.append("Coincide con tu especialidad")
        if request.mode and (coach.mode == request.mode or coach.mode.value == "hibrido"):
            score += 10
            reasons.append("Modalidad compatible")
        if request.city and coach.city.casefold() == request.city.casefold():
            score += 10
            reasons.append("En tu zona")
        if request.availability and coach.responds_now:
            score += 10
            reasons.append("Responde ahora")
        score += coach.rating
        ranked.append((score, coach.model_copy(update={"match_reasons": reasons})))

    ranked.sort(key=lambda item: item[0], reverse=True)
    items = [coach for _, coach in ranked]
    exact = any(coach.category == request.category for coach in items)
    return MatchResponse(items=items, relaxed_filter=None if exact else "especialidad")
