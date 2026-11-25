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
    LargeBinary,
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

    # 2FA TOTP (encrypted secret + hashed single-use backup codes)
    totp_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    totp_backup_hashes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    # UI & Terminal preferences (sidebar, widgets, ticker, hotkeys, timezone, currency, language, density)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

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
    logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="macro")
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
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="MT5")
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

    # Ingestion auth: SHA-256 hash + optional Fernet-encrypted copy for Setup Wizard .set pre-fill
    api_key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Live terminal status
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    algo_trading_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    terminal_connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_ping_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
    live_status: Mapped[str] = mapped_column(String(64), nullable=False, default="IDLE")
    live_state_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    last_execution_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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


class Deal(Base):
    """Idempotent MT5 trading deals (excludes DEAL_TYPE_BALANCE which goes to BalanceOperation)."""

    __tablename__ = "deals"
    __table_args__ = (UniqueConstraint("account_id", "mt5_deal_ticket", name="uq_deal_account_ticket"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mt5_deal_ticket: Mapped[int] = mapped_column(BigInteger, nullable=False)
    order_ticket: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    position_id: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, index=True)
    magic_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, index=True)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    deal_type: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0=BUY, 1=SELL
    entry_type: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0=IN, 1=OUT, 2=INOUT
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    commission: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    swap: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fee: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    net_profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    net_profit_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    comment: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    time_msc: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class BalanceOperation(Base):
    """Deposits, withdrawals, internal transfers, and Exness Vault movements separated from trading PnL."""

    __tablename__ = "balance_operations"
    __table_args__ = (UniqueConstraint("account_id", "mt5_deal_ticket", name="uq_balop_account_ticket"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    mt5_deal_ticket: Mapped[int] = mapped_column(BigInteger, nullable=False)
    op_kind: Mapped[str] = mapped_column(
        String(32), nullable=False, default="DEPOSIT"
    )  # DEPOSIT|WITHDRAWAL|INTERNAL_TRANSFER|EXNESS_VAULT|REBATE
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    amount_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    comment: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    time_msc: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class OpenPositionLive(Base):
    """Currently open positions per MT5 account with live MAE/MFE tracking."""

    __tablename__ = "open_positions_live"
    __table_args__ = (UniqueConstraint("account_id", "position_ticket", name="uq_openpos_account_ticket"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position_ticket: Mapped[int] = mapped_column(BigInteger, nullable=False)
    magic_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(8), nullable=False)  # BUY | SELL
    volume: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    open_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    current_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sl: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    tp: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    swap: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    mae_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    mfe_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    open_time: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    comment: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class EquitySnapshot(Base):
    __tablename__ = "equity_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    balance_usd: Mapped[float] = mapped_column(Float, nullable=False)
    equity_usd: Mapped[float] = mapped_column(Float, nullable=False)
    floating_pnl_usd: Mapped[float] = mapped_column(Float, nullable=False)
    margin_level: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    open_positions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)


class MarketBar(Base):
    """Exact Exness MT5 OHLCV candles (M1, M5, M15, M30, H1, H4, D1, W1)."""

    __tablename__ = "market_bars"
    __table_args__ = (UniqueConstraint("symbol", "timeframe", "bar_time", name="uq_bar_sym_tf_time"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    bar_time: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    open: Mapped[float] = mapped_column(Float, nullable=False)
    high: Mapped[float] = mapped_column(Float, nullable=False)
    low: Mapped[float] = mapped_column(Float, nullable=False)
    close: Mapped[float] = mapped_column(Float, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class PendingCommand(Base):
    """Queued emergency Kill-Switch commands consumed by ExnessPanelBridge.mq5 if AllowRemoteClose=true."""

    __tablename__ = "pending_commands"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(
        ForeignKey("trading_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    command: Mapped[str] = mapped_column(String(32), nullable=False)  # CLOSE_ALL | CLOSE_POSITION
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    consumed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class NewsItem(Base):
    """Deduplicated global financial news with asset tags and Google Gemini AI metadata."""

    __tablename__ = "news_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dedup_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="global")
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, default="")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    affected_assets: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    sentiment: Mapped[str] = mapped_column(String(16), nullable=False, default="neutral")  # bullish|bearish|neutral
    impact_score: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    is_breaking: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    corroborating_sources: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    verification_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ai_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)


class EconomicEvent(Base):
    """High/Medium/Low impact macroeconomic calendar events."""

    __tablename__ = "economic_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    dedup_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    impact: Mapped[str] = mapped_column(String(16), nullable=False, default="Medium")  # High|Medium|Low
    forecast: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    previous: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)


class AiBriefing(Base):
    """Stored Google Gemini AI briefings and portfolio risk analyses."""

    __tablename__ = "ai_briefings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="copilot")
    model_name: Mapped[str] = mapped_column(String(64), nullable=False, default="gemini-2.5-flash")
    prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    response_md: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, index=True)


class NewsSource(Base):
    """Database-backed registry of verified RSS / macro news sources."""

    __tablename__ = "news_sources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    category: Mapped[str] = mapped_column(String(48), nullable=False, default="global")
    trust_tier: Mapped[str] = mapped_column(String(24), nullable=False, default="custom")  # tier_1|tier_2|custom
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    asset_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    poll_interval_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    article_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class ChartState(Base):
    """Server-persisted chart layout, drawings, indicators, and filters per user & symbol."""

    __tablename__ = "chart_states"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_chart_state_user_symbol"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(16), nullable=False, default="H1")
    indicators_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    drawings_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    filters_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class WikiPage(Base):
    """Operational playbooks, runbooks, and trading desk documentation stored in Markdown."""

    __tablename__ = "wiki_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="runbook")
    content_md: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_by: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


class StoredFile(Base):
    """Private, authenticated binary uploads (avatars) served via /api/v1/files/{id}."""

    __tablename__ = "stored_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="avatar")
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class WikiCategory(Base):
    """Editable wiki category registry (CRUD) with auto-generated slug."""

    __tablename__ = "wiki_categories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow)


class MarketCache(Base):
    """Shared DB-backed cache between worker and backend for treemap, macro quotes, and market feeds."""

    __tablename__ = "market_cache"

    cache_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )


Index("ix_audit_logs_action_created", AuditLog.action, AuditLog.created_at)
Index("ix_market_bars_lookup", MarketBar.symbol, MarketBar.timeframe, MarketBar.bar_time)

