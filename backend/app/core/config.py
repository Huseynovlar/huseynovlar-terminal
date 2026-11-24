from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Huseynovlar Terminal"
    app_version: str = "0.1.0"
    environment: str = Field(default="production", alias="ENVIRONMENT")

    terminal_domain: str = Field(default="terminal.huseynovlar.org", alias="TERMINAL_DOMAIN")
    terminal_origin: str = Field(default="https://terminal.huseynovlar.org", alias="TERMINAL_ORIGIN")
    webauthn_rp_id: str = Field(default="terminal.huseynovlar.org", alias="WEBAUTHN_RP_ID")
    webauthn_rp_name: str = Field(default="Huseynovlar Terminal", alias="WEBAUTHN_RP_NAME")
    default_timezone: str = Field(default="Asia/Baku", alias="DEFAULT_TIMEZONE")

    database_url: str = Field(
        default="postgresql+asyncpg://terminal_app:changeme@postgres:5432/huseynovlar_terminal",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://redis:6379/0", alias="REDIS_URL")

    jwt_secret_key: str = Field(default="dev-only-change-me-in-production-32bytes", alias="JWT_SECRET_KEY")
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    cookie_secure: bool = Field(default=True, alias="COOKIE_SECURE")

    vault_master_key: str = Field(default="dev-only-vault-master-key-change-me", alias="VAULT_MASTER_KEY")

    config_dir: Path = Field(default=Path(__file__).resolve().parents[3] / "config", alias="CONFIG_DIR")

    managed_container_label: str = Field(default="exness-panel.managed=true", alias="MANAGED_CONTAINER_LABEL")
    allowed_mt5_containers: str = Field(default="", alias="ALLOWED_MT5_CONTAINERS")

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
