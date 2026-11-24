from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(24), nullable=False, default="ADMIN")  # ADMIN | OPERATOR | VIEWER
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Personal profile
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Owner")
    bio: Mapped[str] = mapped_column(Text, nullable=False, default="")
    avatar_url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    social_links: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)

    # 2FA TOTP (encrypted secret)
    totp_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # UI & Terminal preferences (sidebar, widgets, ticker, hotkeys, timezone, currency, language, density)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    webauthn_credentials: Mapped[list[WebAuthnCredential]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list[UserSession]] = relationship(back_populates="user", cascade="all, delete-orphan")


class WebAuthnCredential(Base):
    """FIDO2 / WebAuthn Passkeys (Face ID, Touch ID, Windows Hello, YubiKey)."""

    __tablename__ = "webauthn_credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    credential_id: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    device_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Passkey")
    transports: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="webauthn_credentials")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="sessions")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)


class ExnessProfile(Base):
    """Logical grouping for an Exness Personal Area (ЛК Exness) with optional encrypted external API keys."""

    __tablename__ = "exness_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    external_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_api_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    accounts: Mapped[list[TradingAccount]] = relationship(back_populates="profile", cascade="all, delete-orphan")


class DockerContainer(Base):
    """Allowlisted MT5 / OS Docker containers managed via docker-socket-proxy."""

    __tablename__ = "docker_containers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    container_name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    host_label: Mapped[str] = mapped_column(String(64), nullable=False, default="vps-main")
    is_restart_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class AssetHub(Base):
    """Asset grouping (XAUUSD, USTEC, or Watchlist assets) with broker aliases, news tags, and macro drivers."""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    group: Mapped[str] = mapped_column(String(48), nullable=False, default="other")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")  # active | watchlist | archived
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#3B82F6")
    icon: Mapped[str] = mapped_column(String(32), nullable=False, default="activity")
    broker_symbols: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    news_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    macro_drivers: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class TradingAccount(Base):
    """Exness MT5 account — supports multiple USD and USC accounts per asset inside one ExnessProfile."""

    __tablename__ = "trading_accounts"
    __table_args__ = (UniqueConstraint("mt5_login", "mt5_server", name="uq_account_login_server"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    profile_id: Mapped[str] = mapped_column(
        ForeignKey("exness_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    container_id: Mapped[str | None] = mapped_column(
        ForeignKey("docker_containers.id", ondelete="SET NULL"), nullable=True
    )
    primary_asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    mt5_login: Mapped[str] = mapped_column(String(64), nullable=False)
    mt5_server: Mapped[str] = mapped_column(String(128), nullable=False)
    account_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="PRO"
    )  # STANDARD|PRO|RAW_SPREAD|ZERO|STANDARD_CENT
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")  # USD | USC | EUR
    currency_divisor: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)  # 100.0 for USC, 1.0 for USD
    leverage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Ingestion auth: SHA-256 hash only; plaintext shown once at create/rotate
    api_key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)

    # Live terminal status
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    algo_trading_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_synced_deal_ticket: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    last_balance: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_equity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_floating_pnl: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_margin_level: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    profile: Mapped[ExnessProfile] = relationship(back_populates="accounts")
    robots: Mapped[list[Robot]] = relationship(back_populates="account", cascade="all, delete-orphan")


class Robot(Base):
    """Trading robot / EA identified by MagicNumber on a specific MT5 account."""

    __tablename__ = "robots"
    __table_args__ = (UniqueConstraint("account_id", "magic_number", name="uq_robot_account_magic"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[str | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    magic_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    program_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0")
    strategy_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    params_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)

    account: Mapped[TradingAccount] = relationship(back_populates="robots")


class SecretVaultEntry(Base):
    """Encrypted third-party integration keys (Google AI Gemini, Telegram Bot, Alerts Webhook)."""

    __tablename__ = "secret_vault"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_enc: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


Index("ix_audit_logs_action_created", AuditLog.action, AuditLog.created_at)
