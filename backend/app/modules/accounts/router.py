from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_secret, generate_account_api_key
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.db.models import Deal, ExnessProfile, OpenPositionLive, Robot, TradingAccount, User

router = APIRouter(tags=["accounts"])


class ExnessProfileCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    notes: str = Field(default="", max_length=2000)
    external_api_key: str | None = None
    external_api_secret: str | None = None


class ExnessProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    external_api_key: str | None = None
    external_api_secret: str | None = None


class AccountCreate(BaseModel):
    profile_id: str | None = None
    primary_asset_id: str | None = None
    container_id: str | None = None
    name: str = Field(min_length=2, max_length=120)
    platform: str = Field(default="MT5", max_length=32)
    mt5_login: str = Field(min_length=2, max_length=64)
    mt5_server: str = Field(min_length=2, max_length=128)
    account_type: str = Field(default="PRO", max_length=32)
    currency: str = Field(default="USD", pattern="^(USD|USC|EUR)$")
    leverage: int = Field(default=2000, ge=0)
    is_demo: bool = False


class AccountUpdate(BaseModel):
    profile_id: str | None = None
    primary_asset_id: str | None = None
    container_id: str | None = None
    name: str | None = Field(default=None, min_length=2, max_length=120)
    platform: str | None = Field(default=None, max_length=32)
    mt5_server: str | None = Field(default=None, min_length=2, max_length=128)
    account_type: str | None = Field(default=None, max_length=32)
    currency: str | None = Field(default=None, pattern="^(USD|USC|EUR)$")
    leverage: int | None = Field(default=None, ge=0)
    is_demo: bool | None = None
    is_active: bool | None = None


class RobotCreate(BaseModel):
    account_id: str
    asset_id: str | None = None
    magic_number: int = Field(ge=0)
    name: str = Field(min_length=2, max_length=120)
    symbol: str = Field(default="", max_length=32)
    program_name: str = Field(default="", max_length=120)
    version: str = Field(default="1.0", max_length=32)
    strategy_notes: str = Field(default="", max_length=2000)
    params_json: dict[str, Any] = Field(default_factory=dict)


class RobotUpdate(BaseModel):
    asset_id: str | None = None
    name: str | None = Field(default=None, min_length=2, max_length=120)
    symbol: str | None = Field(default=None, max_length=32)
    program_name: str | None = Field(default=None, max_length=120)
    version: str | None = Field(default=None, max_length=32)
    strategy_notes: str | None = Field(default=None, max_length=2000)
    params_json: dict[str, Any] | None = None
    live_status: str | None = Field(default=None, max_length=64)
    is_active: bool | None = None


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


async def _resolve_account(db: AsyncSession, id_or_login: str) -> TradingAccount | None:
    account = await db.get(TradingAccount, id_or_login)
    if account:
        return account
    return (
        await db.execute(select(TradingAccount).where(TradingAccount.mt5_login == id_or_login.strip()))
    ).scalar_one_or_none()


def _serialize_profile(p: ExnessProfile, accounts_count: int = 0) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "notes": p.notes,
        "has_external_api": bool(p.external_api_key_enc),
        "accounts_count": accounts_count,
        "created_at": p.created_at.isoformat(),
    }


def _serialize_account(
    a: TradingAccount,
    plaintext_api_key: str | None = None,
    *,
    robots_count: int | None = None,
) -> dict[str, Any]:
    div = a.currency_divisor or 1.0
    data: dict[str, Any] = {
        "id": a.id,
        "profile_id": a.profile_id,
        "primary_asset_id": a.primary_asset_id,
        "container_id": a.container_id,
        "name": a.name,
        "platform": a.platform or "MT5",
        "mt5_login": a.mt5_login,
        "mt5_server": a.mt5_server,
        "account_type": a.account_type,
        "currency": a.currency,
        "currency_divisor": div,
        "leverage": a.leverage,
        "is_demo": a.is_demo,
        "is_active": a.is_active,
        "api_key_prefix": a.api_key_prefix,
        "has_encrypted_key": bool(a.api_key_enc),
        "algo_trading_enabled": a.algo_trading_enabled,
        "terminal_connected": getattr(a, "terminal_connected", False),
        "last_ping_ms": getattr(a, "last_ping_ms", 0),
        "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
        "last_balance": a.last_balance,
        "last_balance_usd": round(a.last_balance / div, 2),
        "last_equity": a.last_equity,
        "last_equity_usd": round(a.last_equity / div, 2),
        "last_floating_pnl": a.last_floating_pnl,
        "last_floating_pnl_usd": round(a.last_floating_pnl / div, 2),
        "last_margin_level": round(a.last_margin_level, 2),
        "created_at": a.created_at.isoformat(),
    }
    if robots_count is not None:
        data["robots_count"] = robots_count
    if plaintext_api_key is not None:
        data["api_key"] = plaintext_api_key
    return data


def _serialize_robot(r: Robot, account: TradingAccount | None = None) -> dict[str, Any]:
    hb = _as_utc(r.last_heartbeat_at)
    now = datetime.now(UTC)
    heartbeat_age_sec = int((now - hb).total_seconds()) if hb else None
    is_online = heartbeat_age_sec is not None and heartbeat_age_sec <= 60
    return {
        "id": r.id,
        "account_id": r.account_id,
        "account_name": account.name if account else "",
        "account_login": account.mt5_login if account else "",
        "account_currency": account.currency if account else "USD",
        "asset_id": r.asset_id,
        "magic_number": r.magic_number,
        "name": r.name,
        "symbol": r.symbol,
        "program_name": r.program_name,
        "version": r.version,
        "strategy_notes": r.strategy_notes,
        "params_json": r.params_json or {},
        "live_status": r.live_status or "IDLE",
        "live_state_json": r.live_state_json or {},
        "last_execution_ms": r.last_execution_ms,
        "last_heartbeat_at": hb.isoformat() if hb else None,
        "heartbeat_age_sec": heartbeat_age_sec,
        "is_online": is_online,
        "is_active": r.is_active,
        "created_at": r.created_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# Exness Profiles CRUD + View
# ---------------------------------------------------------------------------


@router.get("/profiles")
async def list_exness_profiles(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(ExnessProfile).order_by(ExnessProfile.created_at.asc()))).scalars().all()
    counts_q = await db.execute(
        select(TradingAccount.profile_id, func.count(TradingAccount.id)).group_by(TradingAccount.profile_id)
    )
    counts = {pid: int(cnt) for pid, cnt in counts_q.all()}
    return page.apply([_serialize_profile(p, accounts_count=counts.get(p.id, 0)) for p in rows])


@router.post("/profiles", status_code=status.HTTP_201_CREATED)
async def create_exness_profile(
    body: ExnessProfileCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    existing = (
        await db.execute(select(ExnessProfile).where(ExnessProfile.name == body.name.strip()))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Exness profile already exists")

    profile = ExnessProfile(
        name=body.name.strip(),
        notes=body.notes.strip(),
        external_api_key_enc=encrypt_secret(body.external_api_key, settings.vault_master_key)
        if body.external_api_key
        else None,
        external_api_secret_enc=(
            encrypt_secret(body.external_api_secret, settings.vault_master_key) if body.external_api_secret else None
        ),
    )
    db.add(profile)
    await db.flush()
    await record_audit(
        db,
        action="exness_profile.created",
        user_id=user.id,
        resource_type="exness_profile",
        resource_id=profile.id,
        ip_address=extract_client_ip(request),
        details={"name": profile.name},
    )
    await db.commit()
    return _serialize_profile(profile, accounts_count=0)


@router.get("/profiles/{profile_id}")
async def get_exness_profile(
    profile_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    profile = await db.get(ExnessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exness profile not found")
    accounts = (
        (
            await db.execute(
                select(TradingAccount)
                .where(TradingAccount.profile_id == profile.id)
                .order_by(TradingAccount.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return {
        **_serialize_profile(profile, accounts_count=len(accounts)),
        "accounts": [_serialize_account(a) for a in accounts],
    }


@router.patch("/profiles/{profile_id}")
async def update_exness_profile(
    profile_id: str,
    body: ExnessProfileUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    profile = await db.get(ExnessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exness profile not found")

    if body.name is not None:
        new_name = body.name.strip()
        dup = (
            await db.execute(
                select(ExnessProfile).where(ExnessProfile.name == new_name, ExnessProfile.id != profile.id)
            )
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Exness profile name already exists")
        profile.name = new_name
    if body.notes is not None:
        profile.notes = body.notes.strip()
    if body.external_api_key is not None:
        profile.external_api_key_enc = (
            encrypt_secret(body.external_api_key, settings.vault_master_key) if body.external_api_key.strip() else None
        )
    if body.external_api_secret is not None:
        profile.external_api_secret_enc = (
            encrypt_secret(body.external_api_secret, settings.vault_master_key)
            if body.external_api_secret.strip()
            else None
        )

    await record_audit(
        db,
        action="exness_profile.updated",
        user_id=user.id,
        resource_type="exness_profile",
        resource_id=profile.id,
        ip_address=extract_client_ip(request),
        details={"name": profile.name},
    )
    await db.commit()
    acc_cnt = int(
        (
            await db.execute(
                select(func.count(TradingAccount.id)).where(TradingAccount.profile_id == profile.id)
            )
        ).scalar_one()
        or 0
    )
    return _serialize_profile(profile, accounts_count=acc_cnt)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_exness_profile(
    profile_id: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    profile = await db.get(ExnessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exness profile not found")
    name = profile.name
    await db.delete(profile)
    await record_audit(
        db,
        action="exness_profile.deleted",
        user_id=user.id,
        resource_type="exness_profile",
        resource_id=profile_id,
        ip_address=extract_client_ip(request),
        details={"name": name},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Trading Accounts CRUD + View + Key Rotation
# ---------------------------------------------------------------------------


@router.get("/accounts")
async def list_accounts(
    q: str | None = Query(default=None),
    profile_id: str | None = None,
    asset_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(TradingAccount).order_by(TradingAccount.created_at.asc())
    if profile_id:
        stmt = stmt.where(TradingAccount.profile_id == profile_id)
    if asset_id:
        stmt = stmt.where(TradingAccount.primary_asset_id == asset_id)
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            TradingAccount.id.ilike(pat)
            | TradingAccount.name.ilike(pat)
            | TradingAccount.mt5_login.ilike(pat)
            | TradingAccount.mt5_server.ilike(pat)
            | TradingAccount.platform.ilike(pat)
        )
    rows = (await db.execute(stmt)).scalars().all()
    rc_q = await db.execute(select(Robot.account_id, func.count(Robot.id)).group_by(Robot.account_id))
    rc_map = {aid: int(cnt) for aid, cnt in rc_q.all()}
    return page.apply([_serialize_account(r, robots_count=rc_map.get(r.id, 0)) for r in rows])


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    profile: ExnessProfile | None = None
    if body.profile_id:
        profile = await db.get(ExnessProfile, body.profile_id)
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exness profile not found")
    else:
        profile = (await db.execute(select(ExnessProfile).order_by(ExnessProfile.created_at.asc()))).scalars().first()
        if not profile:
            profile = ExnessProfile(name="Exness Main", notes="Auto-created default broker profile")
            db.add(profile)
            await db.flush()

    dup = (
        await db.execute(
            select(TradingAccount).where(
                TradingAccount.mt5_login == body.mt5_login.strip(),
                TradingAccount.mt5_server == body.mt5_server.strip(),
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MT5 login + server already registered")

    plaintext_key, prefix, digest = generate_account_api_key()
    divisor = 100.0 if body.currency == "USC" else 1.0

    account = TradingAccount(
        profile_id=profile.id,
        primary_asset_id=body.primary_asset_id,
        container_id=body.container_id,
        name=body.name.strip(),
        platform=body.platform.strip().upper() or "MT5",
        mt5_login=body.mt5_login.strip(),
        mt5_server=body.mt5_server.strip(),
        account_type=body.account_type.strip().upper(),
        currency=body.currency,
        currency_divisor=divisor,
        leverage=body.leverage,
        is_demo=body.is_demo,
        api_key_prefix=prefix,
        api_key_hash=digest,
        api_key_enc=encrypt_secret(plaintext_key, settings.vault_master_key),
    )
    db.add(account)
    await db.flush()
    await record_audit(
        db,
        action="account.created",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=extract_client_ip(request),
        details={"mt5_login": account.mt5_login, "currency": account.currency},
    )
    await db.commit()
    return _serialize_account(account, plaintext_api_key=plaintext_key, robots_count=0)


# ---------------------------------------------------------------------------
# Robots CRUD + View (mounted on BOTH /robots AND /accounts/robots)
# NOTE: /accounts/robots routes MUST be declared BEFORE /accounts/{id_or_login}
# ---------------------------------------------------------------------------


@router.get("/robots")
@router.get("/accounts/robots")
async def list_robots(
    q: str | None = Query(default=None),
    account_id: str | None = None,
    asset_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    stmt = select(Robot).order_by(Robot.created_at.asc())
    if account_id:
        stmt = stmt.where(Robot.account_id == account_id)
    if asset_id:
        stmt = stmt.where(Robot.asset_id == asset_id)
    if q and q.strip():
        pat = f"%{q.strip()}%"
        stmt = stmt.where(
            Robot.id.ilike(pat) | Robot.name.ilike(pat) | Robot.symbol.ilike(pat) | Robot.strategy_label.ilike(pat)
        )
    rows = (await db.execute(stmt)).scalars().all()
    accounts = {a.id: a for a in (await db.execute(select(TradingAccount))).scalars().all()}
    return page.apply([_serialize_robot(r, accounts.get(r.account_id)) for r in rows])


@router.post("/robots", status_code=status.HTTP_201_CREATED)
@router.post("/accounts/robots", status_code=status.HTTP_201_CREATED)
async def create_robot(
    body: RobotCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await _resolve_account(db, body.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    dup = (
        await db.execute(
            select(Robot).where(Robot.account_id == account.id, Robot.magic_number == body.magic_number)
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MagicNumber already exists on this account")

    robot = Robot(
        account_id=account.id,
        asset_id=body.asset_id or account.primary_asset_id,
        magic_number=body.magic_number,
        name=body.name.strip(),
        symbol=body.symbol.strip().upper(),
        program_name=body.program_name.strip(),
        version=body.version.strip(),
        strategy_notes=body.strategy_notes.strip(),
        params_json=body.params_json,
    )
    db.add(robot)
    await db.flush()
    await record_audit(
        db,
        action="robot.created",
        user_id=user.id,
        resource_type="robot",
        resource_id=robot.id,
        ip_address=extract_client_ip(request),
        details={"magic_number": robot.magic_number, "symbol": robot.symbol},
    )
    await db.commit()
    return _serialize_robot(robot, account)


@router.get("/robots/{robot_id}")
@router.get("/accounts/robots/{robot_id}")
async def get_robot(
    robot_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    robot = await db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Robot not found")
    account = await db.get(TradingAccount, robot.account_id)

    open_positions = (
        (
            await db.execute(
                select(OpenPositionLive).where(
                    OpenPositionLive.account_id == robot.account_id,
                    OpenPositionLive.magic_number == robot.magic_number,
                )
            )
        )
        .scalars()
        .all()
    )
    recent_deals = (
        (
            await db.execute(
                select(Deal)
                .where(Deal.account_id == robot.account_id, Deal.magic_number == robot.magic_number)
                .order_by(Deal.time_msc.desc())
                .limit(25)
            )
        )
        .scalars()
        .all()
    )
    closed_deals = [d for d in recent_deals if d.entry_type in (1, 2)]
    net_pnl_usd = round(sum(d.net_profit_usd for d in closed_deals), 2)
    wins = sum(1 for d in closed_deals if d.net_profit_usd > 0)
    win_rate = round((wins / len(closed_deals)) * 100.0, 2) if closed_deals else 0.0

    return {
        **_serialize_robot(robot, account),
        "stats": {
            "open_positions_count": len(open_positions),
            "recent_closed_trades": len(closed_deals),
            "recent_net_pnl_usd": net_pnl_usd,
            "recent_win_rate_pct": win_rate,
        },
        "open_positions": [
            {
                "position_ticket": p.position_ticket,
                "symbol": p.symbol,
                "side": p.side,
                "volume": p.volume,
                "open_price": p.open_price,
                "current_price": p.current_price,
                "sl": p.sl,
                "tp": p.tp,
                "profit_usd": p.profit_usd,
                "open_time": p.open_time,
            }
            for p in open_positions
        ],
        "recent_deals": [
            {
                "id": d.id,
                "mt5_deal_ticket": d.mt5_deal_ticket,
                "symbol": d.symbol,
                "side": "BUY" if d.deal_type == 0 else "SELL",
                "entry": "IN" if d.entry_type == 0 else "OUT" if d.entry_type == 1 else "INOUT",
                "volume": d.volume,
                "price": d.price,
                "net_profit_usd": round(d.net_profit_usd, 2),
                "time_msc": d.time_msc,
            }
            for d in recent_deals
        ],
    }


@router.patch("/robots/{robot_id}")
@router.patch("/accounts/robots/{robot_id}")
async def update_robot(
    robot_id: str,
    body: RobotUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    robot = await db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Robot not found")

    if body.asset_id is not None:
        robot.asset_id = body.asset_id
    if body.name is not None:
        robot.name = body.name.strip()
    if body.symbol is not None:
        robot.symbol = body.symbol.strip().upper()
    if body.program_name is not None:
        robot.program_name = body.program_name.strip()
    if body.version is not None:
        robot.version = body.version.strip()
    if body.strategy_notes is not None:
        robot.strategy_notes = body.strategy_notes.strip()
    if body.params_json is not None:
        robot.params_json = body.params_json
    if body.live_status is not None:
        robot.live_status = body.live_status.strip()
    if body.is_active is not None:
        robot.is_active = body.is_active

    await record_audit(
        db,
        action="robot.updated",
        user_id=user.id,
        resource_type="robot",
        resource_id=robot.id,
        ip_address=extract_client_ip(request),
        details={"name": robot.name, "symbol": robot.symbol},
    )
    await db.commit()
    account = await db.get(TradingAccount, robot.account_id)
    return _serialize_robot(robot, account)


@router.delete("/robots/{robot_id}", status_code=status.HTTP_204_NO_CONTENT)
@router.delete("/accounts/robots/{robot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_robot(
    robot_id: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    robot = await db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Robot not found")
    name = robot.name
    await db.delete(robot)
    await record_audit(
        db,
        action="robot.deleted",
        user_id=user.id,
        resource_type="robot",
        resource_id=robot_id,
        ip_address=extract_client_ip(request),
        details={"name": name},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Trading Accounts Detail, Update, Delete & Key Rotation (UUID or mt5_login)
# ---------------------------------------------------------------------------


@router.get("/accounts/{id_or_login}")
async def get_account(
    id_or_login: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await _resolve_account(db, id_or_login)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    profile = await db.get(ExnessProfile, account.profile_id)
    robots = (
        (await db.execute(select(Robot).where(Robot.account_id == account.id).order_by(Robot.created_at.asc())))
        .scalars()
        .all()
    )
    open_pos_cnt = int(
        (
            await db.execute(select(func.count(OpenPositionLive.id)).where(OpenPositionLive.account_id == account.id))
        ).scalar_one()
        or 0
    )
    deals_cnt = int(
        (await db.execute(select(func.count(Deal.id)).where(Deal.account_id == account.id))).scalar_one() or 0
    )

    return {
        **_serialize_account(account, robots_count=len(robots)),
        "profile_name": profile.name if profile else "",
        "open_positions_count": open_pos_cnt,
        "deals_count": deals_cnt,
        "robots": [_serialize_robot(r, account) for r in robots],
    }


@router.patch("/accounts/{id_or_login}")
async def update_account(
    id_or_login: str,
    body: AccountUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await _resolve_account(db, id_or_login)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if body.profile_id is not None:
        profile = await db.get(ExnessProfile, body.profile_id)
        if not profile:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exness profile not found")
        account.profile_id = body.profile_id
    if body.primary_asset_id is not None:
        account.primary_asset_id = body.primary_asset_id or None
    if body.container_id is not None:
        account.container_id = body.container_id or None
    if body.name is not None:
        account.name = body.name.strip()
    if body.platform is not None:
        account.platform = body.platform.strip().upper() or "MT5"
    if body.mt5_server is not None:
        account.mt5_server = body.mt5_server.strip()
    if body.account_type is not None:
        account.account_type = body.account_type.strip().upper()
    if body.currency is not None:
        account.currency = body.currency
        account.currency_divisor = 100.0 if body.currency == "USC" else 1.0
    if body.leverage is not None:
        account.leverage = body.leverage
    if body.is_demo is not None:
        account.is_demo = body.is_demo
    if body.is_active is not None:
        account.is_active = body.is_active

    await record_audit(
        db,
        action="account.updated",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=extract_client_ip(request),
        details={"mt5_login": account.mt5_login, "currency": account.currency},
    )
    await db.commit()
    return _serialize_account(account)


@router.delete("/accounts/{id_or_login}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    id_or_login: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    account = await _resolve_account(db, id_or_login)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    acc_id = account.id
    login = account.mt5_login
    await db.delete(account)
    await record_audit(
        db,
        action="account.deleted",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=acc_id,
        ip_address=extract_client_ip(request),
        details={"mt5_login": login},
    )
    await db.commit()


@router.post("/accounts/{id_or_login}/rotate-key")
async def rotate_account_key(
    id_or_login: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    account = await _resolve_account(db, id_or_login)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    plaintext_key, prefix, digest = generate_account_api_key()
    account.api_key_prefix = prefix
    account.api_key_hash = digest
    account.api_key_enc = encrypt_secret(plaintext_key, settings.vault_master_key)
    await record_audit(
        db,
        action="account.api_key_rotated",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return _serialize_account(account, plaintext_api_key=plaintext_key)
