from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_admin
from app.db.models import AssetHub, User

router = APIRouter(prefix="/assets", tags=["assets"])


class AssetCreateRequest(BaseModel):
    code: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=120)
    group: str = Field(default="other", max_length=48)
    status: str = Field(default="active", pattern="^(active|watchlist|archived)$")
    color: str = Field(default="#3B82F6", max_length=16)
    icon: str = Field(default="activity", max_length=32)
    broker_symbols: list[str] = Field(default_factory=list)
    news_tags: list[str] = Field(default_factory=list)
    macro_drivers: list[str] = Field(default_factory=list)
    notes: str = Field(default="", max_length=2000)


class AssetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    group: str | None = Field(default=None, max_length=48)
    status: str | None = Field(default=None, pattern="^(active|watchlist|archived)$")
    color: str | None = Field(default=None, max_length=16)
    icon: str | None = Field(default=None, max_length=32)
    broker_symbols: list[str] | None = None
    news_tags: list[str] | None = None
    macro_drivers: list[str] | None = None
    notes: str | None = None


def _serialize_asset(a: AssetHub) -> dict[str, Any]:
    return {
        "id": a.id,
        "code": a.code,
        "name": a.name,
        "group": a.group,
        "status": a.status,
        "color": a.color,
        "icon": a.icon,
        "broker_symbols": a.broker_symbols,
        "news_tags": a.news_tags,
        "macro_drivers": a.macro_drivers,
        "notes": a.notes,
        "created_at": a.created_at.isoformat(),
    }


@router.get("")
async def list_assets(
    status_filter: str | None = None,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(AssetHub).order_by(AssetHub.status.asc(), AssetHub.code.asc())
    if status_filter:
        stmt = stmt.where(AssetHub.status == status_filter)
    rows = (await db.execute(stmt)).scalars().all()
    return [_serialize_asset(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreateRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    code = body.code.strip().upper()
    existing = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Asset {code} already exists")

    asset = AssetHub(
        code=code,
        name=body.name.strip(),
        group=body.group.strip(),
        status=body.status,
        color=body.color,
        icon=body.icon,
        broker_symbols=body.broker_symbols or [code],
        news_tags=body.news_tags or [code],
        macro_drivers=body.macro_drivers,
        notes=body.notes.strip(),
    )
    db.add(asset)
    await db.flush()
    await record_audit(
        db,
        action="asset.created",
        user_id=user.id,
        resource_type="asset",
        resource_id=asset.id,
        ip_address=request.client.host if request.client else "",
        details={"code": asset.code, "status": asset.status},
    )
    await db.commit()
    return _serialize_asset(asset)


@router.patch("/{asset_id}")
async def update_asset(
    asset_id: str,
    body: AssetUpdateRequest,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    asset = await db.get(AssetHub, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    for field in ("name", "group", "status", "color", "icon", "broker_symbols", "news_tags", "macro_drivers", "notes"):
        val = getattr(body, field)
        if val is not None:
            setattr(asset, field, val)
    await db.commit()
    return _serialize_asset(asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: str,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    asset = await db.get(AssetHub, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await db.delete(asset)
    await db.commit()


@router.post("/seed-defaults")
async def seed_default_assets(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    cfg = settings.load_yaml_config("assets.default.yaml")
    created: list[str] = []
    for item in cfg.get("assets", []):
        code = str(item["code"]).strip().upper()
        exists = (await db.execute(select(AssetHub).where(AssetHub.code == code))).scalar_one_or_none()
        if exists:
            continue
        db.add(
            AssetHub(
                code=code,
                name=item.get("name", code),
                group=item.get("group", "other"),
                status=item.get("status", "active"),
                color=item.get("color", "#3B82F6"),
                icon=item.get("icon", "activity"),
                broker_symbols=item.get("broker_symbols", [code]),
                news_tags=item.get("news_tags", [code]),
                macro_drivers=item.get("macro_drivers", []),
            )
        )
        created.append(code)
    await db.commit()
    return {"seeded": created}
