from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_operator
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.db.models import User, WikiCategory, WikiPage

router = APIRouter(prefix="/wiki", tags=["wiki"])

INITIAL_WIKI_PLAYBOOKS: list[dict[str, Any]] = [
    {
        "slug": "mt5-bridge-setup",
        "title": "MT5 Bridge & Dual-EA Setup Runbook",
        "category": "runbook",
        "is_pinned": True,
        "content_md": (
            "# MT5 Bridge & Dual-EA Setup Runbook\n\n"
            "## 1. Whitelist WebRequest URL (Fixes Error 4014)\n"
            "In MetaTrader 5: **Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL**:\n"
            "- Internal Docker network: `http://ingest.terminal.local:8000`\n"
            "- External VPN HTTPS: `https://terminal.huseynovlar.org`\n\n"
            "## 2. Running Two EAs Simultaneously\n"
            "MT5 allows one Expert Advisor per chart tab. Open a **second chart tab** for the same symbol:\n"
            "- **Chart 1**: Your trading robot (e.g., `NasdaqPulse v3.01`)\n"
            "- **Chart 2**: `ExnessPanelBridge.mq5` with the downloaded `.set` preset.\n\n"
            "Optionally `#include <ExnessPanelHook.mqh>` in your EA for millisecond IPC telemetry."
        ),
    },
    {
        "slug": "integrations-etc-secrets",
        "title": "Server Secrets (/opt/huseynovlar-terminal/.env)",
        "category": "operations",
        "is_pinned": True,
        "content_md": (
            "# Server-Managed Integrations (`/etc`)\n\n"
            "Gemini AI and Telegram Alerts Webhook credentials are loaded from "
            "`/opt/huseynovlar-terminal/.env` on the VPS host:\n\n"
            "```env\n"
            "GEMINI_API_KEY=your_google_ai_studio_key\n"
            "GEMINI_DEFAULT_MODEL=gemini-3.8-flash\n"
            "TELEGRAM_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading\n"
            "TELEGRAM_WEBHOOK_SECRET=your_shared_secret\n"
            "```\n\n"
            "Verify connectivity anytime from **Operations -> Setup Wizard -> Integrations Status**."
        ),
    },
    {
        "slug": "emergency-kill-switch-sop",
        "title": "Emergency Kill-Switch & Container Recovery SOP",
        "category": "risk",
        "is_pinned": False,
        "content_md": (
            "# Emergency Kill-Switch SOP\n\n"
            "1. Verify open exposure in **Journal -> Open Positions**.\n"
            "2. Trigger **Kill-Switch** (`CLOSE ALL`) from **Operations -> Containers** or **Accounts**.\n"
            "3. Ensure `AllowRemoteClose=true` is enabled in `ExnessPanelBridge.mq5` for remote liquidation.\n"
            "4. Inspect container logs (`mt5-xau`, `mt5-ustec`) before restarting any MT5 container."
        ),
    },
]


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", text.strip().lower()).strip("-")
    return slug[:120] or "page"


def _serialize_page(p: WikiPage) -> dict[str, Any]:
    return {
        "id": p.id,
        "slug": p.slug,
        "title": p.title,
        "category": p.category,
        "content_md": p.content_md,
        "is_pinned": p.is_pinned,
        "updated_by": p.updated_by,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat() if p.updated_at else p.created_at.isoformat(),
    }


async def seed_initial_wiki_pages(db: AsyncSession) -> int:
    """Idempotently seed initial operational playbooks when wiki_pages is empty."""
    existing = await db.scalar(select(func.count()).select_from(WikiPage))
    if existing and existing > 0:
        return 0
    created = 0
    for item in INITIAL_WIKI_PLAYBOOKS:
        db.add(
            WikiPage(
                slug=item["slug"],
                title=item["title"],
                category=item["category"],
                content_md=item["content_md"],
                is_pinned=item["is_pinned"],
                updated_by="system",
            )
        )
        created += 1
    await db.commit()
    return created


class WikiCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    slug: str | None = Field(default=None, max_length=120)
    category: str = Field(default="runbook", max_length=64)
    content_md: str = Field(default="")
    is_pinned: bool = False


class WikiUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    slug: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=64)
    content_md: str | None = None
    is_pinned: bool | None = None


async def _resolve_page(db: AsyncSession, slug_or_id: str) -> WikiPage | None:
    stmt = select(WikiPage).where((WikiPage.id == slug_or_id) | (WikiPage.slug == slug_or_id))
    return (await db.execute(stmt)).scalar_one_or_none()


@router.get("")
async def list_wiki_pages(
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    await seed_initial_wiki_pages(db)
    stmt = select(WikiPage).order_by(WikiPage.is_pinned.desc(), WikiPage.updated_at.desc())
    if category:
        stmt = stmt.where(WikiPage.category == category.strip())
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            WikiPage.id.ilike(pattern)
            | WikiPage.title.ilike(pattern)
            | WikiPage.slug.ilike(pattern)
            | WikiPage.category.ilike(pattern)
            | WikiPage.content_md.ilike(pattern)
        )
    pages = (await db.execute(stmt)).scalars().all()
    return page.apply([_serialize_page(p) for p in pages])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_wiki_page(
    body: WikiCreateRequest,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    slug = _slugify(body.slug or body.title)
    dup = (await db.execute(select(WikiPage).where(WikiPage.slug == slug))).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Wiki slug '{slug}' already exists")

    page = WikiPage(
        slug=slug,
        title=body.title.strip(),
        category=body.category.strip() or "runbook",
        content_md=body.content_md,
        is_pinned=body.is_pinned,
        updated_by=user.username,
    )
    db.add(page)
    await db.flush()
    await record_audit(
        db,
        action="wiki.created",
        user_id=user.id,
        resource_type="wiki_page",
        resource_id=page.slug,
        ip_address=extract_client_ip(request),
        details={"title": page.title},
    )
    await db.commit()
    await db.refresh(page)
    return _serialize_page(page)


class WikiCategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    slug: str | None = Field(default=None, max_length=64)
    description: str = Field(default="", max_length=500)
    sort_order: int = 0


class WikiCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    slug: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=500)
    sort_order: int | None = None


def _serialize_category(c: WikiCategory, pages_count: int = 0) -> dict[str, Any]:
    return {
        "id": c.id,
        "slug": c.slug,
        "name": c.name,
        "description": c.description,
        "sort_order": c.sort_order,
        "pages_count": pages_count,
        "created_at": c.created_at.isoformat(),
    }


async def _ensure_categories(db: AsyncSession) -> None:
    """Backfill the category registry from existing page categories (idempotent)."""
    known = {c.slug for c in (await db.execute(select(WikiCategory))).scalars().all()}
    used = (await db.execute(select(WikiPage.category).distinct())).scalars().all()
    added = False
    for raw in used:
        slug = _slugify(raw)[:64]
        if slug and slug not in known:
            db.add(WikiCategory(slug=slug, name=raw.strip().title() or slug))
            known.add(slug)
            added = True
    if added:
        await db.commit()


async def _category_pages_count(db: AsyncSession, slug: str) -> int:
    return int(await db.scalar(select(func.count()).select_from(WikiPage).where(WikiPage.category == slug)) or 0)


async def _resolve_category(db: AsyncSession, slug_or_id: str) -> WikiCategory | None:
    stmt = select(WikiCategory).where((WikiCategory.id == slug_or_id) | (WikiCategory.slug == slug_or_id))
    return (await db.execute(stmt)).scalar_one_or_none()


@router.get("/categories")
async def list_wiki_categories(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    await seed_initial_wiki_pages(db)
    await _ensure_categories(db)
    rows = (
        (await db.execute(select(WikiCategory).order_by(WikiCategory.sort_order.asc(), WikiCategory.name.asc())))
        .scalars()
        .all()
    )
    return page.apply([_serialize_category(c, await _category_pages_count(db, c.slug)) for c in rows])


@router.post("/categories", status_code=status.HTTP_201_CREATED)
async def create_wiki_category(
    body: WikiCategoryCreate,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    slug = _slugify(body.slug or body.name)[:64]
    if await _resolve_category(db, slug):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Wiki category '{slug}' already exists")
    cat = WikiCategory(
        slug=slug, name=body.name.strip(), description=body.description.strip(), sort_order=body.sort_order
    )
    db.add(cat)
    await db.flush()
    await record_audit(
        db,
        action="wiki_category.created",
        user_id=user.id,
        resource_type="wiki_category",
        resource_id=cat.slug,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat)


@router.get("/categories/{slug_or_id}")
async def get_wiki_category(
    slug_or_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cat = await _resolve_category(db, slug_or_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki category not found")
    return _serialize_category(cat, await _category_pages_count(db, cat.slug))


@router.patch("/categories/{slug_or_id}")
async def update_wiki_category(
    slug_or_id: str,
    body: WikiCategoryUpdate,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    cat = await _resolve_category(db, slug_or_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki category not found")
    old_slug = cat.slug
    if body.slug is not None:
        new_slug = _slugify(body.slug)[:64]
        dup = (
            await db.execute(select(WikiCategory).where(WikiCategory.slug == new_slug, WikiCategory.id != cat.id))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=f"Wiki category '{new_slug}' already exists"
            )
        cat.slug = new_slug
    if body.name is not None:
        cat.name = body.name.strip()
    if body.description is not None:
        cat.description = body.description.strip()
    if body.sort_order is not None:
        cat.sort_order = body.sort_order
    if cat.slug != old_slug:
        for p in (await db.execute(select(WikiPage).where(WikiPage.category == old_slug))).scalars().all():
            p.category = cat.slug
    await record_audit(
        db,
        action="wiki_category.updated",
        user_id=user.id,
        resource_type="wiki_category",
        resource_id=cat.slug,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    await db.refresh(cat)
    return _serialize_category(cat, await _category_pages_count(db, cat.slug))


@router.delete("/categories/{slug_or_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wiki_category(
    slug_or_id: str,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> None:
    cat = await _resolve_category(db, slug_or_id)
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki category not found")
    if await _category_pages_count(db, cat.slug):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Category still has wiki pages; move or delete them first"
        )
    slug = cat.slug
    await db.delete(cat)
    await record_audit(
        db,
        action="wiki_category.deleted",
        user_id=user.id,
        resource_type="wiki_category",
        resource_id=slug,
        ip_address=extract_client_ip(request),
    )
    await db.commit()


@router.get("/{slug_or_id}")
async def get_wiki_page(
    slug_or_id: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await seed_initial_wiki_pages(db)
    page = await _resolve_page(db, slug_or_id)
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki page not found")
    return _serialize_page(page)


@router.patch("/{slug_or_id}")
async def update_wiki_page(
    slug_or_id: str,
    body: WikiUpdateRequest,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    page = await _resolve_page(db, slug_or_id)
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki page not found")

    if body.slug is not None:
        new_slug = _slugify(body.slug)
        dup = (
            await db.execute(select(WikiPage).where(WikiPage.slug == new_slug, WikiPage.id != page.id))
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Wiki slug '{new_slug}' already exists")
        page.slug = new_slug
    if body.title is not None:
        page.title = body.title.strip()
    if body.category is not None:
        page.category = body.category.strip() or "runbook"
    if body.content_md is not None:
        page.content_md = body.content_md
    if body.is_pinned is not None:
        page.is_pinned = body.is_pinned
    page.updated_by = user.username

    await record_audit(
        db,
        action="wiki.updated",
        user_id=user.id,
        resource_type="wiki_page",
        resource_id=page.slug,
        ip_address=extract_client_ip(request),
        details={"title": page.title},
    )
    await db.commit()
    await db.refresh(page)
    return _serialize_page(page)


@router.delete("/{slug_or_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wiki_page(
    slug_or_id: str,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> None:
    page = await _resolve_page(db, slug_or_id)
    if not page:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wiki page not found")

    slug = page.slug
    await db.delete(page)
    await record_audit(
        db,
        action="wiki.deleted",
        user_id=user.id,
        resource_type="wiki_page",
        resource_id=slug,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
