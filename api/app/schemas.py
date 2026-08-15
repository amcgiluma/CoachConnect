from datetime import datetime, time
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ServiceMode(StrEnum):
    online = "online"
    in_person = "presencial"
    hybrid = "hibrido"


class Category(BaseModel):
    id: str
    name: str
    name_en: str
    subcategories: list[str] = []


class MatchRequest(BaseModel):
    category: str
    subcategory: str | None = None
    mode: ServiceMode | None = None
    city: str | None = None
    max_price: float | None = Field(default=None, gt=0)
    languages: list[str] = Field(default_factory=list)


class CoachSummary(BaseModel):
    id: str
    name: str
    avatar_url: str | None = None
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
    languages: list[str] = Field(default_factory=lambda: ["es"])
    specialties: list[str] = Field(default_factory=list)
    match_reasons: list[str] = []


class MatchResponse(BaseModel):
    items: list[CoachSummary]
    relaxed_filter: str | None = None


class AuthUser(BaseModel):
    id: str
    email: str | None = None


class ProfileUpdateRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=80)
    city: str | None = Field(default=None, min_length=2, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=2048)
    timezone: str = Field(default="Europe/Madrid", min_length=3, max_length=80)


class CoachOnboardingRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=80)
    headline: str = Field(min_length=5, max_length=120)
    bio: str = Field(min_length=20, max_length=1200)
    city: str = Field(min_length=2, max_length=80)
    mode: ServiceMode
    years_experience: int = Field(default=0, ge=0, le=70)
    languages: list[str] = ["es"]


class ServiceCreateRequest(BaseModel):
    category_id: str
    name: str = Field(min_length=3, max_length=100)
    description: str = Field(default="", max_length=500)
    mode: ServiceMode
    duration_minutes: int = Field(ge=20, le=240)
    price_cents: int = Field(ge=500, le=100000)
    package_size: int = Field(default=1, ge=1, le=24)
    offer_type: str = "single"
    booking_mode: str = "instant"
    expiry_days: int | None = Field(default=None, ge=30, le=365)
    cadence_weeks: int | None = None
    recurring_schedule_mode: str = "fixed"
    booking_window_days: int = Field(default=31, ge=7, le=365)
    available_weekdays: list[int] = Field(default_factory=lambda: list(range(7)), min_length=1, max_length=7)
    available_start_time: str = "09:00"
    available_end_time: str = "19:00"
    location_policy: Literal["fixed_private", "travel", "agreed"] = "agreed"
    public_area_label: str | None = Field(default=None, max_length=120)
    private_address_line: str | None = Field(default=None, max_length=240)
    private_locality: str | None = Field(default=None, max_length=120)
    private_postal_code: str = Field(default="", max_length=20)
    private_location_instructions: str = Field(default="", max_length=1000)

    @model_validator(mode="after")
    def validate_offer(self):
        if any(day < 0 or day > 6 for day in self.available_weekdays):
            raise ValueError("Los días disponibles no son válidos")
        self.available_weekdays = sorted(set(self.available_weekdays))
        try:
            starts_at = time.fromisoformat(self.available_start_time)
            ends_at = time.fromisoformat(self.available_end_time)
        except ValueError as exc:
            raise ValueError("Las horas del servicio no son válidas") from exc
        if ends_at <= starts_at:
            raise ValueError("La hora final del servicio debe ser posterior a la inicial")
        if self.offer_type not in {"single", "flex_pack", "recurring_plan"}:
            raise ValueError("Tipo de oferta no válido")
        if self.booking_mode not in {"instant", "request"}:
            raise ValueError("Modo de reserva no válido")
        if self.recurring_schedule_mode not in {"fixed", "flexible"}:
            raise ValueError("Modo de fechas no válido")
        if self.mode != ServiceMode.online and self.location_policy in {"fixed_private", "travel"} and not self.public_area_label:
            raise ValueError("Indica la zona pública aproximada del servicio presencial")
        if self.mode != ServiceMode.online and self.location_policy == "fixed_private":
            if not self.private_address_line or not self.private_locality:
                raise ValueError("La ubicación fija necesita dirección y localidad privadas")
        if self.offer_type == "single":
            if self.package_size != 1:
                raise ValueError("Una sesión individual debe incluir una sesión")
            self.expiry_days = None
            self.cadence_weeks = None
            self.recurring_schedule_mode = "fixed"
        elif self.offer_type == "flex_pack":
            if self.package_size < 2 or self.expiry_days is None:
                raise ValueError("El bono necesita entre 2 y 24 sesiones y caducidad")
            self.cadence_weeks = None
            self.recurring_schedule_mode = "fixed"
        else:
            if self.package_size < 2 or self.expiry_days is None:
                raise ValueError("El plan necesita sesiones y caducidad")
            if self.recurring_schedule_mode == "fixed" and self.cadence_weeks not in {1, 2}:
                raise ValueError("El patrón fijo necesita frecuencia semanal o quincenal")
            if self.recurring_schedule_mode == "flexible":
                self.cadence_weeks = None
        return self


class BookingSettingsRequest(BaseModel):
    min_booking_notice_minutes: int = Field(ge=0, le=10080)


class AvailabilityRuleRequest(BaseModel):
    weekday: int = Field(ge=0, le=6)
    starts_at: str
    ends_at: str
    timezone: str = "Europe/Madrid"

    @model_validator(mode="after")
    def validate_hours(self):
        if time.fromisoformat(self.ends_at) <= time.fromisoformat(self.starts_at):
            raise ValueError("La franja debe terminar después de empezar")
        return self


class AvailabilityExceptionRequest(BaseModel):
    starts_at: datetime
    ends_at: datetime
    available: bool = False
    label: str = Field(default="", max_length=120)

    @model_validator(mode="after")
    def validate_interval(self):
        if self.ends_at <= self.starts_at:
            raise ValueError("La excepción debe terminar después de empezar")
        return self


class RespondsNowRequest(BaseModel):
    enabled: bool


class CheckoutRequest(BaseModel):
    service_id: str
    starts_at: datetime
    notes: str = Field(default="", max_length=500)
    meeting_provider: str = "meet"

    @model_validator(mode="after")
    def validate_provider(self):
        if self.meeting_provider not in {"meet", "zoom", "custom"}:
            raise ValueError("Proveedor de videollamada no válido")
        return self


class CheckoutResponse(BaseModel):
    booking_id: str
    checkout_url: str | None
    status: str


class PackageCheckoutRequest(BaseModel):
    service_id: str
    starts_at: datetime | None = None
    occurrences: list[datetime] | None = Field(default=None, min_length=2, max_length=24)
    timezone: str = "Europe/Madrid"


class PackageCheckoutResponse(BaseModel):
    package_id: str
    checkout_url: str | None
    status: str


class PackageBookingRequest(BaseModel):
    package_id: str
    starts_at: datetime
    meeting_provider: str = "meet"


class ConversationCreateRequest(BaseModel):
    coach_id: str


class MessageCreateRequest(BaseModel):
    body: str = Field(default="", max_length=4000)
    attachment_path: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.body.strip() and not self.attachment_path:
            raise ValueError("El mensaje necesita texto o un archivo")
        return self


class ReportCreateRequest(BaseModel):
    conversation_id: str | None = None
    message_id: str | None = None
    reported_user_id: str | None = None
    reason: str = Field(min_length=3, max_length=120)
    details: str = Field(default="", max_length=1200)


class BlockUserRequest(BaseModel):
    user_id: str


class CategoryWriteRequest(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)
    name_es: str = Field(min_length=2, max_length=100)
    name_en: str = Field(min_length=2, max_length=100)
    parent_id: str | None = None
    sort_order: int = Field(default=0, ge=0, le=10000)
    active: bool = True


class CancellationRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


class ReviewCreateRequest(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1200)
    punctuality: int = Field(ge=1, le=5)
    communication: int = Field(ge=1, le=5)
    respect: int = Field(ge=1, le=5)
    quality: int | None = Field(default=None, ge=1, le=5)
    personalization: int | None = Field(default=None, ge=1, le=5)
    safety: int | None = Field(default=None, ge=1, le=5)
    commitment: int | None = Field(default=None, ge=1, le=5)


class SessionReportRequest(BaseModel):
    outcome: str
    circumstances: list[str] = Field(default_factory=list, max_length=8)
    note: str = Field(default="", max_length=1200)

    @model_validator(mode="after")
    def validate_outcome(self):
        allowed = {
            "attended", "attended_with_issues", "client_no_show", "coach_no_show",
            "mutually_rescheduled", "technical_failure",
        }
        allowed_circumstances = {"late_start", "shortened", "technical_issue", "location_issue", "other"}
        if self.outcome not in allowed:
            raise ValueError("Resultado de sesión no válido")
        if any(item not in allowed_circumstances for item in self.circumstances):
            raise ValueError("Circunstancia no válida")
        return self


class BookingDecisionRequest(BaseModel):
    decision: str
    reason_code: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_decision(self):
        if self.decision not in {"accept", "reject"}:
            raise ValueError("Decisión no válida")
        return self


class BookingLocationRequest(BaseModel):
    address_line: str = Field(min_length=3, max_length=240)
    locality: str = Field(min_length=2, max_length=120)
    postal_code: str = Field(default="", max_length=20)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    instructions: str = Field(default="", max_length=1000)


class BookingRescheduleCreateRequest(BaseModel):
    starts_at: datetime
    reason: str = Field(default="", max_length=500)


class BookingRescheduleDecisionRequest(BaseModel):
    decision: Literal["accept", "reject"]


class NotificationPreferenceUpdateRequest(BaseModel):
    category: Literal["reminders", "chat", "reviews", "summaries"]
    email_enabled: bool
    in_app_enabled: bool


class CalendarPreferenceUpdateRequest(BaseModel):
    enabled: bool
    calendar_id: str = Field(default="primary", min_length=1, max_length=240)


class ReviewReplyRequest(BaseModel):
    body: str = Field(min_length=1, max_length=1200)


class AdminOutcomeResolutionRequest(BaseModel):
    outcome: str
    note: str = Field(default="", max_length=1200)

    @model_validator(mode="after")
    def validate_resolution(self):
        if self.outcome not in {"attended", "attended_with_issues", "client_no_show", "coach_no_show", "mutually_rescheduled", "technical_failure"}:
            raise ValueError("Resolución no válida")
        return self


class CredentialCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    kind: str = "qualification"
    storage_path: str = Field(min_length=3, max_length=500)


class CoachVideoRequest(BaseModel):
    storage_path: str = Field(min_length=3, max_length=500)


class CustomVideoLinkRequest(BaseModel):
    url: str = Field(pattern=r"^https://", max_length=500)


class VideoReviewRequest(BaseModel):
    status: str
    note: str = Field(default="", max_length=1000)


class VerificationRequest(BaseModel):
    status: str
    note: str = Field(default="", max_length=1000)


class UserAccessRequest(BaseModel):
    enabled: bool


class AdminSanctionCreateRequest(BaseModel):
    user_id: str
    kind: Literal["account", "messaging", "training"]
    duration_hours: int = Field(ge=1, le=8760)
    reason: str = Field(min_length=3, max_length=500)
    report_id: str | None = None


class AdminSanctionRevokeRequest(BaseModel):
    reason: str = Field(default="Revocada manualmente por administración", max_length=500)


class AdminReportUpdateRequest(BaseModel):
    status: Literal["reviewing", "resolved", "dismissed"]
    resolution_note: str = Field(default="", max_length=1200)


class OAuthUrlResponse(BaseModel):
    provider: str
    url: str
