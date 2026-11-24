from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import encrypt_secret, generate_account_api_key
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.db.models import ExnessProfile, Robot, TradingAccount, User

router = APIRouter(tags=["accounts"])


class ExnessProfileCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    notes: str = Field(default="", max_length=2000)
    external_api_key: str | None = None
    external_api_secret: str | None = None


class AccountCreate(BaseModel):
    profile_id: str | None = None
    primary_asset_id: str | None = None
    container_id: str | None = None
    name: str = Field(min_length=2, max_length=120)
    mt5_login: str = Field(min_length=2, max_length=64)
    mt5_server: str = Field(min_length=2, max_length=128)
    account_type: str = Field(default="PRO", max_length=32)
    currency: str = Field(default="USD", pattern="^(USD|USC|EUR)$")
    leverage: int = Field(default=2000, ge=0)
    is_demo: bool = False


class RobotCreate(BaseModel):
    account_id: str
    asset_id: str | None = None
    magic_number: int = Field(ge=0)
    name: str = Field(min_length=2, max_length=120)
    symbol: str = Field(default="", max_length=32)
    program_name: str = Field(default="", max_length=120)
    version: str = Field(default="1.0", max_length=32)
    strategy_notes: str = Field(default="", max_length=2000)


def _serialize_account(a: TradingAccount, plaintext_api_key: str | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": a.id,
        "profile_id": a.profile_id,
        "primary_asset_id": a.primary_asset_id,
        "container_id": a.container_id,
        "name": a.name,
        "mt5_login": a.mt5_login,
        "mt5_server": a.mt5_server,
        "account_type": a.account_type,
        "currency": a.currency,
        "currency_divisor": a.currency_divisor,
        "leverage": a.leverage,
        "is_demo": a.is_demo,
        "is_active": a.is_active,
        "api_key_prefix": a.api_key_prefix,
        "algo_trading_enabled": a.algo_trading_enabled,
        "terminal_connected": getattr(a, "terminal_connected", False),
        "last_ping_ms": getattr(a, "last_ping_ms", None),
        "last_seen_at": a.last_seen_at.isoformat() if a.last_seen_at else None,
        "last_balance": a.last_balance,
        "last_balance_usd": round(a.last_balance / a.currency_divisor, 2),
        "last_equity": a.last_equity,
        "last_equity_usd": round(a.last_equity / a.currency_divisor, 2),
        "last_floating_pnl": a.last_floating_pnl,
        "last_floating_pnl_usd": round(a.last_floating_pnl / a.currency_divisor, 2),
        "created_at": a.created_at.isoformat(),
    }
    if plaintext_api_key is not None:
        data["api_key"] = plaintext_api_key
    return data


@router.get("/profiles")
async def list_exness_profiles(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (await db.execute(select(ExnessProfile).order_by(ExnessProfile.created_at.asc()))).scalars().all()
    return [
        {
            "id": p.id,
            "name": p.name,
            "notes": p.notes,
            "has_external_api": bool(p.external_api_key_enc),
            "created_at": p.created_at.isoformat(),
        }
        for p in rows
    ]


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
        ip_address=request.client.host if request.client else "",
        details={"name": profile.name},
    )
    await db.commit()
    return {
        "id": profile.id,
        "name": profile.name,
        "notes": profile.notes,
        "has_external_api": bool(profile.external_api_key_enc),
        "created_at": profile.created_at.isoformat(),
    }


@router.get("/accounts")
async def list_accounts(
    profile_id: str | None = None,
    asset_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(TradingAccount).order_by(TradingAccount.created_at.asc())
    if profile_id:
        stmt = stmt.where(TradingAccount.profile_id == profile_id)
    if asset_id:
        stmt = stmt.where(TradingAccount.primary_asset_id == asset_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize_account(r) for r in rows]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
        mt5_login=body.mt5_login.strip(),
        mt5_server=body.mt5_server.strip(),
        account_type=body.account_type.strip().upper(),
        currency=body.currency,
        currency_divisor=divisor,
        leverage=body.leverage,
        is_demo=body.is_demo,
        api_key_prefix=prefix,
        api_key_hash=digest,
    )
    db.add(account)
    await db.flush()
    await record_audit(
        db,
        action="account.created",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=request.client.host if request.client else "",
        details={"mt5_login": account.mt5_login, "currency": account.currency},
    )
    await db.commit()
    return _serialize_account(account, plaintext_api_key=plaintext_key)


@router.post("/accounts/{account_id}/rotate-key")
async def rotate_account_key(
    account_id: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await db.get(TradingAccount, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    plaintext_key, prefix, digest = generate_account_api_key()
    account.api_key_prefix = prefix
    account.api_key_hash = digest
    await record_audit(
        db,
        action="account.api_key_rotated",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
    return _serialize_account(account, plaintext_api_key=plaintext_key)


@router.get("/robots")
async def list_robots(
    account_id: str | None = None,
    asset_id: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(Robot).order_by(Robot.created_at.asc())
    if account_id:
        stmt = stmt.where(Robot.account_id == account_id)
    if asset_id:
        stmt = stmt.where(Robot.asset_id == asset_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "account_id": r.account_id,
            "asset_id": r.asset_id,
            "magic_number": r.magic_number,
            "name": r.name,
            "symbol": r.symbol,
            "program_name": r.program_name,
            "version": r.version,
            "strategy_notes": r.strategy_notes,
            "is_active": r.is_active,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/robots", status_code=status.HTTP_201_CREATED)
async def create_robot(
    body: RobotCreate,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    account = await db.get(TradingAccount, body.account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    dup = (
        await db.execute(
            select(Robot).where(Robot.account_id == body.account_id, Robot.magic_number == body.magic_number)
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="MagicNumber already exists on this account")

    robot = Robot(
        account_id=body.account_id,
        asset_id=body.asset_id or account.primary_asset_id,
        magic_number=body.magic_number,
        name=body.name.strip(),
        symbol=body.symbol.strip().upper(),
        program_name=body.program_name.strip(),
        version=body.version.strip(),
        strategy_notes=body.strategy_notes.strip(),
    )
    db.add(robot)
    await db.flush()
    await record_audit(
        db,
        action="robot.created",
        user_id=user.id,
        resource_type="robot",
        resource_id=robot.id,
        ip_address=request.client.host if request.client else "",
        details={"magic_number": robot.magic_number, "symbol": robot.symbol},
    )
    await db.commit()
    return {
        "id": robot.id,
        "account_id": robot.account_id,
        "asset_id": robot.asset_id,
        "magic_number": robot.magic_number,
        "name": robot.name,
        "symbol": robot.symbol,
        "program_name": robot.program_name,
        "version": robot.version,
        "strategy_notes": robot.strategy_notes,
        "is_active": robot.is_active,
        "created_at": robot.created_at.isoformat(),
    }
