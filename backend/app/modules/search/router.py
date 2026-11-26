"""Global cross-entity search endpoint for Ctrl+K command palette (#42)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.db.models import AssetHub, NewsItem, Robot, TradingAccount, User, WikiPage

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
async def global_search(
    q: str = Query(default="", min_length=0, max_length=120),
    limit: int = Query(default=6, ge=1, le=20),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    term = q.strip()
    if not term:
        return {"query": "", "results": []}

    pat = f"%{term}%"
    results: list[dict[str, Any]] = []

    # 1. Asset Hubs
    hubs = (
        (
            await db.execute(
                select(AssetHub)
                .where(
                    AssetHub.code.ilike(pat)
                    | AssetHub.name.ilike(pat)
                    | AssetHub.category.ilike(pat)
                    | AssetHub.id.ilike(pat)
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    seen_codes: set[str] = set()
    for h in hubs:
        seen_codes.add(h.code.upper())
        results.append(
            {
                "type": "hub",
                "group": "Asset Hubs",
                "id": h.id,
                "label": f"{h.code} — {h.name}",
                "sublabel": h.category or h.group or "hub",
                "url": f"/dashboard/hubs/{h.code}",
            }
        )

    # 2. Catalog / Treemap / Default Assets (so searching NVDA, AAPL, XAUUSD, BTC always matches!)
    term_lo = term.lower()
    treemap_cfg = settings.load_yaml_config("treemap.yaml")
    for uname, ucfg in (treemap_cfg.get("universes") or {}).items():
        for sec in ucfg.get("sectors") or []:
            for item in sec.get("items") or []:
                sym = str(item.get("symbol") or item.get("ticker") or "").upper()
                name = str(item.get("name") or sym)
                if not sym or sym in seen_codes:
                    continue
                if term_lo in sym.lower() or term_lo in name.lower():
                    seen_codes.add(sym)
                    results.append(
                        {
                            "type": "asset",
                            "group": "Market Assets",
                            "id": sym,
                            "label": f"{sym} — {name}",
                            "sublabel": str(sec.get("name") or uname),
                            "url": f"/dashboard/explorer?symbol={sym}",
                        }
                    )
                    if len(results) >= limit * 3:
                        break

    # 3. Trading Accounts
    accounts = (
        (
            await db.execute(
                select(TradingAccount)
                .where(
                    TradingAccount.name.ilike(pat)
                    | TradingAccount.mt5_login.ilike(pat)
                    | TradingAccount.mt5_server.ilike(pat)
                    | TradingAccount.id.ilike(pat)
                )
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for acc in accounts:
        results.append(
            {
                "type": "account",
                "group": "Trading Accounts",
                "id": acc.id,
                "label": f"{acc.name} (#{acc.mt5_login})",
                "sublabel": f"{acc.platform} • {acc.currency}",
                "url": f"/dashboard/accounts/{acc.id}",
            }
        )

    # 4. Robots
    robots = (
        (
            await db.execute(
                select(Robot)
                .where(Robot.name.ilike(pat) | Robot.symbol.ilike(pat) | Robot.id.ilike(pat))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for rob in robots:
        results.append(
            {
                "type": "robot",
                "group": "Trading Robots",
                "id": rob.id,
                "label": f"{rob.name} ({rob.symbol})",
                "sublabel": f"Magic {rob.magic_number}",
                "url": f"/dashboard/robots/{rob.id}",
            }
        )

    # 5. Wiki
    wikis = (
        (
            await db.execute(
                select(WikiPage)
                .where(WikiPage.title.ilike(pat) | WikiPage.category.ilike(pat) | WikiPage.slug.ilike(pat))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for w in wikis:
        results.append(
            {
                "type": "wiki",
                "group": "Wiki",
                "id": w.id,
                "label": w.title,
                "sublabel": w.category,
                "url": f"/dashboard/wiki/{w.slug}",
            }
        )

    # 6. News
    news = (
        (
            await db.execute(
                select(NewsItem)
                .where(NewsItem.title.ilike(pat) | NewsItem.source.ilike(pat))
                .order_by(NewsItem.published_at.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for n in news:
        results.append(
            {
                "type": "news",
                "group": "News",
                "id": n.id,
                "label": n.title,
                "sublabel": n.source,
                "url": f"/dashboard/news/{n.id}",
            }
        )

    # 7. Users (Admin only)
    if user.role == "ADMIN":
        users = (
            (
                await db.execute(
                    select(User)
                    .where(
                        User.username.ilike(pat)
                        | User.display_name.ilike(pat)
                        | User.email.ilike(pat)
                        | User.id.ilike(pat)
                    )
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        for u in users:
            results.append(
                {
                    "type": "user",
                    "group": "Users",
                    "id": u.id,
                    "label": f"{u.display_name or u.username} (@{u.username})",
                    "sublabel": u.role,
                    "url": f"/dashboard/users/{u.id}",
                }
            )

    return {"query": term, "results": results}
