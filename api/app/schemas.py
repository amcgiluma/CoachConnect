from enum import StrEnum

from pydantic import BaseModel, Field


class ServiceMode(StrEnum):
    online = "online"
    in_person = "presencial"
    hybrid = "hibrido"


class Category(BaseModel):
    id: str
    name: str
    name_en: str
    subcategories: list[str]


class MatchRequest(BaseModel):
    category: str
    goal: str | None = None
    mode: ServiceMode | None = None
    city: str | None = None
    availability: str | None = None
    max_price: float | None = Field(default=None, gt=0)


class CoachSummary(BaseModel):
    id: str
    name: str
    specialty: str
    category: str
    mode: ServiceMode
    city: str
    rating: float
    reviews: int
    price_from: float
    next_slot: str
    responds_now: bool
    verified: bool
    match_reasons: list[str] = []


class MatchResponse(BaseModel):
    items: list[CoachSummary]
    relaxed_filter: str | None = None
