from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CoachConnect API"
    environment: str = "development"
    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    platform_fee_percent: int = 15
    resend_api_key: str = ""
    email_from: str = ""
    oauth_client_id: str = ""
    oauth_client_secret: str = ""
    oauth_redirect_uris: str = ""
    oauth_state_ttl_seconds: int = 600
    token_encryption_key: str = ""
    zoom_client_id: str = ""
    zoom_client_secret: str = ""
    zoom_oauth_url: str = "https://zoom.us/oauth/authorize"
    zoom_redirect_uri: str = "http://localhost:8000/api/v1/integrations/zoom/callback"
    google_oauth_url: str = "https://accounts.google.com/o/oauth2/v2/auth"
    demo_mode: bool = True

    model_config = SettingsConfigDict(env_file=(".env", "api/.env"), extra="ignore")


settings = Settings()
