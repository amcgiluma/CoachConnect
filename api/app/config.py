from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "CoachConnect API"
    environment: str = "development"
    frontend_url: str = "http://localhost:5173"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    platform_fee_percent: int = 15

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
