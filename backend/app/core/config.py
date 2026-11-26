from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _resolve_default_config_dir() -> Path:
    env_dir = os.environ.get("CONFIG_DIR", "").strip()
    if env_dir:
        return Path(env_dir)
    container_dir = Path("/app/config")
    if container_dir.exists() and container_dir.is_dir():
        return container_dir
    return Path(__file__).resolve().parents[3] / "config"


def load_integrations_env(path: str | Path) -> dict[str, str]:
    """Parse a dotenv-style /opt/huseynovlar-terminal/.env file safely."""
    file_path = Path(path)
    if not file_path.is_file():
        return {}
    try:
        raw = file_path.read_text(encoding="utf-8")
    except OSError:
        return {}

    parsed: dict[str, str] = {}
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("export "):
            stripped = stripped[7:].strip()
        if "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and ((value[0] == '"' and value[-1] == '"') or (value[0] == "'" and value[-1] == "'")):
            value = value[1:-1]
        if key:
            parsed[key] = value
    return parsed


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Huseynovlar Terminal"
    app_version: str = "0.2.0"
    environment: str = Field(default="production", alias="ENVIRONMENT")

    terminal_domain: str = Field(default="terminal.huseynovlar.org", alias="TERMINAL_DOMAIN")
    terminal_origin: str = Field(default="https://terminal.huseynovlar.org", alias="TERMINAL_ORIGIN")
    webauthn_rp_id: str = Field(default="terminal.huseynovlar.org", alias="WEBAUTHN_RP_ID")
    webauthn_rp_name: str = Field(default="Huseynovlar Terminal", alias="WEBAUTHN_RP_NAME")
    default_timezone: str = Field(default="UTC", alias="DEFAULT_TIMEZONE")

    database_url: str = Field(
        default="postgresql+asyncpg://terminal_app:changeme@postgres:5432/huseynovlar_terminal",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://redis:6379/0", alias="REDIS_URL")

    jwt_secret_key: str = Field(default="dev-only-change-me-in-production-32bytes", alias="JWT_SECRET_KEY")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=120, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_days: int = Field(default=14, alias="REFRESH_TOKEN_EXPIRE_DAYS")
    cookie_secure: bool = Field(default=True, alias="COOKIE_SECURE")

    vault_master_key: str = Field(default="dev-only-vault-master-key-change-me", alias="VAULT_MASTER_KEY")

    config_dir: Path = Field(default_factory=_resolve_default_config_dir, alias="CONFIG_DIR")

    managed_container_label: str = Field(default="exness-panel.managed=true", alias="MANAGED_CONTAINER_LABEL")
    allowed_mt5_containers: str = Field(default="", alias="ALLOWED_MT5_CONTAINERS")

    # External integrations (loaded from env and overridden/populated by /opt/huseynovlar-terminal/.env)
    integrations_env_path: str = Field(
        default="/opt/huseynovlar-terminal/.env",
        alias="INTEGRATIONS_ENV_PATH",
    )
    google_ai_api_key: str = Field(default="", alias="GOOGLE_AI_API_KEY")
    google_ai_default_model: str = Field(default="gemini-3.8-flash", alias="GOOGLE_AI_DEFAULT_MODEL")
    alerts_bot_webhook_url: str = Field(default="", alias="ALERTS_BOT_WEBHOOK_URL")
    alerts_bot_webhook_secret: str = Field(default="", alias="ALERTS_BOT_WEBHOOK_SECRET")
    ip_geo_api_url: str = Field(default="https://ipwho.is/{ip}", alias="IP_GEO_API_URL")

    # Market-data WebSocket & REST providers (loaded from /opt/huseynovlar-terminal/.env)
    alpaca_endpoint: str = Field(default="https://paper-api.alpaca.markets/v2", alias="ALPACA_ENDPOINT")
    alpaca_api_key: str = Field(default="", alias="ALPACA_API_KEY")
    alpaca_api_secret: str = Field(default="", alias="ALPACA_API_SECRET")
    tiingo_api_key: str = Field(default="", alias="TIINGO_API_KEY")
    finnhub_api_key: str = Field(default="", alias="FINNHUB_API_KEY")
    kraken_api_key: str = Field(default="", alias="KRAKEN_API_KEY")
    kraken_private_key: str = Field(default="", alias="KRAKEN_PRIVATE_KEY")

    def model_post_init(self, __context: Any) -> None:
        # Support alternative env names if primary aliases are empty
        if not self.google_ai_api_key:
            self.google_ai_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if self.google_ai_default_model == "gemini-3.8-flash":
            alt_model = os.getenv("GEMINI_DEFAULT_MODEL", "").strip()
            if alt_model:
                self.google_ai_default_model = alt_model
        if not self.alerts_bot_webhook_url:
            self.alerts_bot_webhook_url = os.getenv("TELEGRAM_WEBHOOK_URL", "").strip()
        if not self.alerts_bot_webhook_secret:
            self.alerts_bot_webhook_secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()

        # Populate/override from /opt/huseynovlar-terminal/.env if readable
        etc_values = load_integrations_env(self.integrations_env_path)
        if etc_values:
            gemini_key = etc_values.get("GEMINI_API_KEY") or etc_values.get("GOOGLE_AI_API_KEY")
            if gemini_key:
                self.google_ai_api_key = gemini_key.strip()

            gemini_model = etc_values.get("GEMINI_DEFAULT_MODEL") or etc_values.get("GOOGLE_AI_DEFAULT_MODEL")
            if gemini_model:
                self.google_ai_default_model = gemini_model.strip()

            webhook_url = etc_values.get("TELEGRAM_WEBHOOK_URL") or etc_values.get("ALERTS_BOT_WEBHOOK_URL")
            if webhook_url:
                self.alerts_bot_webhook_url = webhook_url.strip()

            webhook_secret = etc_values.get("TELEGRAM_WEBHOOK_SECRET") or etc_values.get("ALERTS_BOT_WEBHOOK_SECRET")
            if webhook_secret:
                self.alerts_bot_webhook_secret = webhook_secret.strip()

            ip_geo = etc_values.get("IP_GEO_API_URL")
            if ip_geo:
                self.ip_geo_api_url = ip_geo.strip()

            for env_key, attr_name in (
                ("ALPACA_ENDPOINT", "alpaca_endpoint"),
                ("ALPACA_API_KEY", "alpaca_api_key"),
                ("ALPACA_API_SECRET", "alpaca_api_secret"),
                ("TIINGO_API_KEY", "tiingo_api_key"),
                ("FINNHUB_API_KEY", "finnhub_api_key"),
                ("KRAKEN_API_KEY", "kraken_api_key"),
                ("KRAKEN_PRIVATE_KEY", "kraken_private_key"),
            ):
                val = etc_values.get(env_key)
                if val:
                    setattr(self, attr_name, val.strip())

    def load_yaml_config(self, filename: str) -> dict[str, Any]:
        path = self.config_dir / filename
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        return data if isinstance(data, dict) else {}


@lru_cache
def get_settings() -> Settings:
    return Settings()
