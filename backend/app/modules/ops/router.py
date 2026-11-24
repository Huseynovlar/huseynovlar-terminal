from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.crypto import decrypt_secret
from app.core.database import get_db
from app.core.deps import record_audit, require_admin
from app.db.models import PendingCommand, SecretVaultEntry, TradingAccount, User

router = APIRouter(prefix="/ops", tags=["ops"])


def _allowed_names(settings: Settings) -> set[str]:
    return {c.strip() for c in settings.allowed_mt5_containers.split(",") if c.strip()}


def _is_container_allowed(name: str, labels: dict[str, str], settings: Settings) -> bool:
    clean = name.lstrip("/")
    if clean in _allowed_names(settings):
        return True
    if "=" in settings.managed_container_label:
        k, v = settings.managed_container_label.split("=", 1)
        if labels.get(k.strip()) == v.strip():
            return True
    return False


def _docker_base_url() -> str:
    return os.getenv("DOCKER_HOST", "http://docker-proxy:2375").rstrip("/")


class KillSwitchRequest(BaseModel):
    confirm_text: str = Field(min_length=1)


class TestAlertRequest(BaseModel):
    title: str = Field(default="Test Trading Alert", max_length=120)
    message: str = Field(default="Huseynovlar Terminal alert pipeline verified.", max_length=500)
    severity: str = Field(default="info", pattern="^(info|warning|critical)$")


@router.get("/containers")
async def list_managed_containers(
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> list[dict[str, Any]]:
    """List ONLY allowlisted or labeled (exness-panel.managed=true) MT5/OS containers via docker-socket-proxy."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.get(f"{_docker_base_url()}/containers/json", params={"all": "1"})
            resp.raise_for_status()
            raw = resp.json()
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for c in raw:
        names = c.get("Names") or []
        cname = (names[0] if names else c.get("Id", "")[:12]).lstrip("/")
        labels = c.get("Labels") or {}
        if not _is_container_allowed(cname, labels, settings):
            continue
        out.append(
            {
                "id": c.get("Id", "")[:12],
                "name": cname,
                "image": c.get("Image", ""),
                "state": c.get("State", "unknown"),
                "status": c.get("Status", ""),
            }
        )
    return out


@router.post("/containers/{container_name}/{action}")
async def control_managed_container(
    container_name: str,
    action: str,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if action not in {"restart", "start", "stop"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported container action")

    # Verify container is explicitly allowlisted before calling docker-socket-proxy
    allowed = _allowed_names(settings)
    if container_name not in allowed:
        # Also verify via live label check if docker-proxy is reachable
        managed = False
        try:
            async with httpx.AsyncClient(timeout=4.0) as http:
                insp = await http.get(f"{_docker_base_url()}/containers/{container_name}/json")
                if insp.status_code == 200:
                    labels = insp.json().get("Config", {}).get("Labels") or {}
                    managed = _is_container_allowed(container_name, labels, settings)
        except Exception:
            managed = False
        if not managed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Container '{container_name}' is not in allowlist or missing managed label",
            )

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(f"{_docker_base_url()}/containers/{container_name}/{action}")
            if resp.status_code not in (200, 204, 304):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Docker proxy HTTP {resp.status_code}"
                )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Docker proxy unreachable: {exc}"
        ) from exc

    await record_audit(
        db,
        action=f"container.{action}",
        user_id=user.id,
        resource_type="docker_container",
        resource_id=container_name,
        ip_address=request.client.host if request.client else "",
    )
    await db.commit()
    return {"status": "ok", "container": container_name, "action": action}


@router.get("/containers/{container_name}/logs")
async def get_container_logs(
    container_name: str,
    tail: int = Query(default=80, ge=10, le=400),
    _: User = Depends(require_admin),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if container_name not in _allowed_names(settings):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Container not allowlisted")
    try:
        async with httpx.AsyncClient(timeout=6.0) as http:
            resp = await http.get(
                f"{_docker_base_url()}/containers/{container_name}/logs",
                params={"stdout": "1", "stderr": "1", "tail": str(tail)},
            )
            resp.raise_for_status()
            return {"container": container_name, "logs": resp.text}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Docker proxy error: {exc}"
        ) from exc


@router.post("/kill-switch/{account_id}")
async def trigger_kill_switch(
    account_id: str,
    body: KillSwitchRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Queue emergency CLOSE_ALL command. Requires explicit confirmation + MT5 AllowRemoteClose=true fuse."""
    if body.confirm_text.strip().upper() != "CLOSE ALL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation text must be exactly 'CLOSE ALL'",
        )

    account = await db.get(TradingAccount, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    cmd = PendingCommand(account_id=account.id, command="CLOSE_ALL", payload={"requested_by": user.username})
    db.add(cmd)
    await record_audit(
        db,
        action="ops.kill_switch_queued",
        user_id=user.id,
        resource_type="trading_account",
        resource_id=account.id,
        ip_address=request.client.host if request.client else "",
        details={"mt5_login": account.mt5_login},
    )
    await db.commit()
    return {
        "status": "queued",
        "command_id": cmd.id,
        "account_id": account.id,
        "note": "Will execute on next MT5 Bridge heartbeat ONLY if AllowRemoteClose=true in MT5.",
    }


@router.post("/alerts/test")
async def send_test_alert(
    body: TestAlertRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Send test alert via huseynovlar-alerts-bot (/internal/webhooks/trading) and/or dedicated Telegram bot."""

    async def _vault_or_env(vault_key: str, env_name: str) -> str:
        row = await db.get(SecretVaultEntry, vault_key)
        if row:
            return decrypt_secret(row.value_enc, settings.vault_master_key)
        return os.getenv(env_name, "").strip()

    webhook_url = await _vault_or_env("alerts_bot_webhook_url", "ALERTS_BOT_WEBHOOK_URL")
    webhook_secret = await _vault_or_env("alerts_bot_webhook_secret", "ALERTS_BOT_WEBHOOK_SECRET")
    tg_token = await _vault_or_env("telegram_bot_token", "TELEGRAM_BOT_TOKEN")
    tg_chat = await _vault_or_env("telegram_chat_id", "TELEGRAM_CHAT_ID")

    delivered: list[str] = []
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=8.0) as http:
        if webhook_url and webhook_secret:
            try:
                r = await http.post(
                    webhook_url,
                    headers={
                        "X-Webhook-Secret": webhook_secret,
                        "X-Trading-Webhook-Secret": webhook_secret,
                    },
                    json={
                        "category": "trading",
                        "severity": body.severity,
                        "title": body.title,
                        "message": body.message,
                        "source": "huseynovlar-terminal",
                    },
                )
                r.raise_for_status()
                delivered.append("huseynovlar-alerts-bot")
            except Exception as exc:
                errors.append(f"webhook: {exc}")

        if tg_token and tg_chat:
            try:
                r = await http.post(
                    f"https://api.telegram.org/bot{tg_token}/sendMessage",
                    json={"chat_id": tg_chat, "text": f"[{body.severity.upper()}] {body.title}\n{body.message}"},
                )
                r.raise_for_status()
                delivered.append("telegram-bot")
            except Exception as exc:
                errors.append(f"telegram: {exc}")

    return {"delivered": delivered, "errors": errors, "configured": bool(delivered or errors)}


@router.get("/setup-wizard/{account_id}/bridge.set")
async def download_mt5_bridge_set(
    account_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PlainTextResponse:
    """Generate ready-to-import MT5 .set preset file for ExnessPanelBridge.mq5."""
    account = await db.get(TradingAccount, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    content = "\r\n".join(
        [
            "; Huseynovlar Terminal — ExnessPanelBridge.mq5 Preset",
            f"; Account: {account.name} (MT5 #{account.mt5_login} / {account.currency})",
            "ApiBaseUrl=http://terminal-backend:8000/api/v1/ingest",
            f"AccountApiKey=PASTE_YOUR_KEY_STARTING_WITH_{account.api_key_prefix}",
            "ChartSymbolOverride=",
            "SnapshotIntervalSec=5",
            "BarsSyncIntervalSec=15",
            "InitialHistoryDays=90",
            "HttpTimeoutMs=2500",
            "AllowRemoteClose=false",
            "",
        ]
    )
    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="ExnessPanelBridge_{account.mt5_login}.set"'},
    )
