from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings, load_integrations_env
from app.core.crypto import decrypt_secret
from app.core.database import get_db
from app.core.deps import get_current_user, record_audit, require_operator
from app.core.ip_utils import extract_client_ip
from app.core.pagination import Page
from app.db.models import DockerContainer, PendingCommand, SecretVaultEntry, TradingAccount, User

router = APIRouter(prefix="/ops", tags=["ops"])

ALLOWED_MQL5_DOWNLOADS = {"ExnessPanelBridge.mq5", "ExnessPanelHook.mqh"}

_LOG_REDACT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"htk_[A-Za-z0-9_-]+"), "htk_***REDACTED***"),
    (re.compile(r"Bearer\s+\S+", re.IGNORECASE), "Bearer ***REDACTED***"),
    (re.compile(r"(AccountApiKey|password|secret|token)=\S+", re.IGNORECASE), r"\1=***REDACTED***"),
]


def _redact_logs(raw: str) -> str:
    redacted = raw
    for pattern, repl in _LOG_REDACT_PATTERNS:
        redacted = pattern.sub(repl, redacted)
    return redacted


def _allowed_names(settings: Settings) -> set[str]:
    return {c.strip() for c in settings.allowed_mt5_containers.split(",") if c.strip()}


def _has_managed_label(labels: dict[str, str], settings: Settings) -> bool:
    if "=" in settings.managed_container_label:
        k, v = settings.managed_container_label.split("=", 1)
        return labels.get(k.strip()) == v.strip()
    return False


def _is_container_allowed(name: str, labels: dict[str, str], settings: Settings) -> bool:
    clean = name.lstrip("/")
    if clean in _allowed_names(settings):
        return True
    return _has_managed_label(labels, settings)


def _docker_base_url() -> str:
    return os.getenv("DOCKER_HOST", "http://docker-proxy:2375").rstrip("/")


def _resolve_mql5_path(filename: str) -> Path:
    container_path = Path("/app/mql5") / filename
    if container_path.is_file():
        return container_path
    repo_path = Path(__file__).resolve().parents[4] / "mql5" / filename
    return repo_path


async def _resolve_account(db: AsyncSession, account_id_or_login: str) -> TradingAccount | None:
    stmt = select(TradingAccount).where(
        (TradingAccount.id == account_id_or_login) | (TradingAccount.mt5_login == account_id_or_login)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _resolve_container_record(db: AsyncSession, id_or_name: str) -> DockerContainer | None:
    stmt = select(DockerContainer).where(
        (DockerContainer.id == id_or_name) | (DockerContainer.container_name == id_or_name)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _authorize_container(
    container_name: str,
    db: AsyncSession,
    settings: Settings,
) -> tuple[bool, DockerContainer | None]:
    clean = container_name.lstrip("/")
    db_ref = (
        await db.execute(select(DockerContainer).where(DockerContainer.container_name == clean))
    ).scalar_one_or_none()
    if db_ref is not None:
        return True, db_ref
    if clean in _allowed_names(settings):
        return True, None
    try:
        async with httpx.AsyncClient(timeout=4.0) as http:
            insp = await http.get(f"{_docker_base_url()}/containers/{clean}/json")
            if insp.status_code == 200:
                labels = insp.json().get("Config", {}).get("Labels") or {}
                if _has_managed_label(labels, settings):
                    return True, None
    except Exception:
        pass
    return False, None


def _compute_docker_stats(stats_json: dict[str, Any]) -> dict[str, Any]:
    cpu_stats = stats_json.get("cpu_stats") or {}
    precpu_stats = stats_json.get("precpu_stats") or {}
    cpu_delta = (cpu_stats.get("cpu_usage") or {}).get("total_usage", 0) - (
        precpu_stats.get("cpu_usage") or {}
    ).get("total_usage", 0)
    sys_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)
    online_cpus = cpu_stats.get("online_cpus") or len((cpu_stats.get("cpu_usage") or {}).get("percpu_usage") or []) or 1
    cpu_percent = round((cpu_delta / sys_delta) * online_cpus * 100.0, 2) if sys_delta > 0 and cpu_delta > 0 else 0.0

    mem_stats = stats_json.get("memory_stats") or {}
    mem_usage = float(mem_stats.get("usage") or 0.0)
    mem_limit = float(mem_stats.get("limit") or 0.0)
    return {
        "cpu_percent": cpu_percent,
        "memory_mb": round(mem_usage / (1024 * 1024), 2),
        "memory_limit_mb": round(mem_limit / (1024 * 1024), 2),
    }


async def _resolve_integration_secret(
    db: AsyncSession,
    settings: Settings,
    *,
    settings_val: str,
    vault_key: str,
    env_names: tuple[str, ...],
) -> tuple[str, str]:
    """Return (value, source) prioritizing /etc integrations.env -> env -> SecretVaultEntry."""
    etc_values = load_integrations_env(settings.integrations_env_path)
    for key in env_names:
        if etc_values.get(key):
            return etc_values[key].strip(), "etc_integrations_env"
    if settings_val.strip():
        return settings_val.strip(), "environment"
    for key in env_names:
        val = os.getenv(key, "").strip()
        if val:
            return val, "environment"
    row = await db.get(SecretVaultEntry, vault_key)
    if row:
        try:
            decrypted = decrypt_secret(row.value_enc, settings.vault_master_key).strip()
            if decrypted:
                return decrypted, "vault"
        except Exception:
            pass
    return "", "unconfigured"


class KillSwitchRequest(BaseModel):
    confirm_text: str = Field(default="CLOSE ALL", min_length=1)


class TestAlertRequest(BaseModel):
    title: str = Field(default="Test Trading Alert", max_length=120)
    message: str = Field(default="Huseynovlar Terminal alert pipeline verified.", max_length=500)
    severity: str = Field(default="info", pattern="^(info|warning|critical)$")


class RegisterContainerRequest(BaseModel):
    container_name: str = Field(min_length=2, max_length=120, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_.-]+$")
    display_name: str = Field(min_length=2, max_length=120)
    host_label: str = Field(default="vps-main", max_length=64)
    is_restart_allowed: bool = True


class UpdateContainerRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=120)
    host_label: str | None = Field(default=None, max_length=64)
    is_restart_allowed: bool | None = None


@router.post("/containers", status_code=status.HTTP_201_CREATED)
async def register_mt5_container(
    body: RegisterContainerRequest,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Register a new MT5 Docker container in the terminal registry."""
    existing = (
        await db.execute(select(DockerContainer).where(DockerContainer.container_name == body.container_name))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Container '{body.container_name}' is already registered",
        )

    ref = DockerContainer(
        container_name=body.container_name,
        display_name=body.display_name.strip(),
        host_label=body.host_label.strip() or "vps-main",
        is_restart_allowed=body.is_restart_allowed,
    )
    db.add(ref)
    await db.flush()
    await record_audit(
        db,
        action="container.registered",
        user_id=user.id,
        resource_type="docker_container",
        resource_id=body.container_name,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {
        "id": ref.id,
        "name": ref.container_name,
        "container_name": ref.container_name,
        "display_name": ref.display_name,
        "host_label": ref.host_label,
        "is_restart_allowed": ref.is_restart_allowed,
        "network_cmd": f"sudo docker network connect exness_mt5_ingest {ref.container_name}",
    }


@router.get("/containers")
async def list_managed_containers(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    page: Page = Depends(),
) -> list[dict[str, Any]]:
    """List allowlisted, labeled (exness-panel.managed=true), or DB-registered MT5/OS containers."""
    registered = (await db.execute(select(DockerContainer))).scalars().all()
    reg_map = {r.container_name: r for r in registered}

    acc_stmt = select(TradingAccount).where(TradingAccount.container_id.is_not(None))
    accounts = (await db.execute(acc_stmt)).scalars().all()
    linked_by_cid: dict[str, list[dict[str, Any]]] = {}
    for acc in accounts:
        if acc.container_id:
            linked_by_cid.setdefault(acc.container_id, []).append(
                {"id": acc.id, "name": acc.name, "mt5_login": acc.mt5_login, "currency": acc.currency}
            )

    raw: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.get(f"{_docker_base_url()}/containers/json", params={"all": "1"})
            resp.raise_for_status()
            raw = resp.json()
    except Exception:
        raw = []

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in raw:
        names = c.get("Names") or []
        cname = (names[0] if names else c.get("Id", "")[:12]).lstrip("/")
        labels = c.get("Labels") or {}
        if not (_is_container_allowed(cname, labels, settings) or cname in reg_map):
            continue
        seen.add(cname)
        ref = reg_map.get(cname)
        out.append(
            {
                "id": ref.id if ref else c.get("Id", "")[:12],
                "docker_id": c.get("Id", "")[:12],
                "name": cname,
                "container_name": cname,
                "display_name": ref.display_name if ref else cname,
                "host_label": ref.host_label if ref else "vps-main",
                "is_restart_allowed": ref.is_restart_allowed if ref else True,
                "image": c.get("Image", ""),
                "state": c.get("State", "unknown"),
                "status": c.get("Status", ""),
                "registered": ref is not None,
                "linked_accounts": linked_by_cid.get(ref.id, []) if ref else [],
            }
        )

    for cname, ref in reg_map.items():
        if cname not in seen:
            out.append(
                {
                    "id": ref.id,
                    "docker_id": "",
                    "name": cname,
                    "container_name": cname,
                    "display_name": ref.display_name,
                    "host_label": ref.host_label,
                    "is_restart_allowed": ref.is_restart_allowed,
                    "image": "not found in docker-proxy yet",
                    "state": ref.last_status or "not_connected",
                    "status": "Registered — connect to exness_mt5_ingest & allowlist",
                    "registered": True,
                    "linked_accounts": linked_by_cid.get(ref.id, []),
                }
            )
    return page.apply(out)


@router.get("/containers/{id_or_name}")
async def get_container_detail(
    id_or_name: str,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    ref = await _resolve_container_record(db, id_or_name)
    cname = ref.container_name if ref else id_or_name.lstrip("/")
    if not ref and cname not in _allowed_names(settings):
        allowed, _ = await _authorize_container(cname, db, settings)
        if not allowed:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Container not found")

    linked_accounts: list[dict[str, Any]] = []
    if ref:
        accs = (await db.execute(select(TradingAccount).where(TradingAccount.container_id == ref.id))).scalars().all()
        linked_accounts = [
            {"id": a.id, "name": a.name, "mt5_login": a.mt5_login, "currency": a.currency, "is_active": a.is_active}
            for a in accs
        ]

    inspect_data: dict[str, Any] = {}
    stats_data: dict[str, Any] = {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as http:
            insp = await http.get(f"{_docker_base_url()}/containers/{cname}/json")
            if insp.status_code == 200:
                inspect_data = insp.json()
                st = await http.get(f"{_docker_base_url()}/containers/{cname}/stats", params={"stream": "false"})
                if st.status_code == 200:
                    stats_data = _compute_docker_stats(st.json())
    except Exception:
        pass

    state_obj = inspect_data.get("State") or {}
    config_obj = inspect_data.get("Config") or {}
    return {
        "id": ref.id if ref else inspect_data.get("Id", "")[:12] or cname,
        "name": cname,
        "container_name": cname,
        "display_name": ref.display_name if ref else cname,
        "host_label": ref.host_label if ref else "vps-main",
        "is_restart_allowed": ref.is_restart_allowed if ref else True,
        "registered": ref is not None,
        "state": state_obj.get("Status") or (ref.last_status if ref else "unknown"),
        "running": bool(state_obj.get("Running", False)),
        "started_at": state_obj.get("StartedAt", ""),
        "image": config_obj.get("Image", ""),
        "stats": stats_data,
        "linked_accounts": linked_accounts,
        "created_at": ref.created_at.isoformat() if ref else None,
    }


@router.patch("/containers/{id_or_name}")
async def update_container(
    id_or_name: str,
    body: UpdateContainerRequest,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ref = await _resolve_container_record(db, id_or_name)
    if not ref:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registered container not found")

    if body.display_name is not None:
        ref.display_name = body.display_name.strip()
    if body.host_label is not None:
        ref.host_label = body.host_label.strip() or "vps-main"
    if body.is_restart_allowed is not None:
        ref.is_restart_allowed = body.is_restart_allowed

    await record_audit(
        db,
        action="container.updated",
        user_id=user.id,
        resource_type="docker_container",
        resource_id=ref.container_name,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {
        "id": ref.id,
        "name": ref.container_name,
        "container_name": ref.container_name,
        "display_name": ref.display_name,
        "host_label": ref.host_label,
        "is_restart_allowed": ref.is_restart_allowed,
        "last_status": ref.last_status,
    }


@router.delete("/containers/{id_or_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_container(
    id_or_name: str,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> None:
    ref = await _resolve_container_record(db, id_or_name)
    if not ref:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registered container not found")

    linked = (await db.execute(select(TradingAccount).where(TradingAccount.container_id == ref.id))).scalars().all()
    for acc in linked:
        acc.container_id = None

    cname = ref.container_name
    await db.delete(ref)
    await record_audit(
        db,
        action="container.deleted",
        user_id=user.id,
        resource_type="docker_container",
        resource_id=cname,
        ip_address=extract_client_ip(request),
    )
    await db.commit()


@router.post("/containers/{container_name}/{action}")
async def control_managed_container(
    container_name: str,
    action: str,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if action not in {"restart", "start", "stop"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported container action")

    allowed, db_ref = await _authorize_container(container_name, db, settings)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Container '{container_name}' is not in allowlist, DB registry, or missing managed label",
        )

    if db_ref and not db_ref.is_restart_allowed and action in {"stop", "restart"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Container '{container_name}' has restart/stop disabled",
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

    if db_ref:
        db_ref.last_status = "exited" if action == "stop" else "running"

    await record_audit(
        db,
        action=f"container.{action}",
        user_id=user.id,
        resource_type="docker_container",
        resource_id=container_name,
        ip_address=extract_client_ip(request),
    )
    await db.commit()
    return {"status": "ok", "container": container_name, "action": action}


@router.get("/containers/{container_name}/logs")
async def get_container_logs(
    container_name: str,
    tail: int = Query(default=200, ge=10, le=1000),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    allowed, _ = await _authorize_container(container_name, db, settings)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Container not allowlisted")
    try:
        async with httpx.AsyncClient(timeout=6.0) as http:
            resp = await http.get(
                f"{_docker_base_url()}/containers/{container_name}/logs",
                params={"stdout": "1", "stderr": "1", "tail": str(tail)},
            )
            resp.raise_for_status()
            return {"container": container_name, "logs": _redact_logs(resp.text)}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Docker proxy error: {exc}"
        ) from exc


@router.post("/kill-switch/{account_id_or_login}")
async def trigger_kill_switch(
    account_id_or_login: str,
    body: KillSwitchRequest,
    request: Request,
    user: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Queue emergency CLOSE_ALL command. Accepts account UUID or mt5_login."""
    if body.confirm_text.strip().upper() != "CLOSE ALL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation text must be exactly 'CLOSE ALL'",
        )

    account = await _resolve_account(db, account_id_or_login)
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
        ip_address=extract_client_ip(request),
        details={"mt5_login": account.mt5_login},
    )
    await db.commit()
    return {
        "status": "queued",
        "command_id": cmd.id,
        "account_id": account.id,
        "mt5_login": account.mt5_login,
        "note": "Will execute on next MT5 Bridge heartbeat ONLY if AllowRemoteClose=true in MT5.",
    }


@router.get("/setup-wizard/{account_id_or_login}/bridge.set")
async def download_mt5_bridge_set(
    account_id_or_login: str,
    url_mode: str = Query(default="internal", pattern="^(internal|external)$"),
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> PlainTextResponse:
    """Generate MT5 .set preset (accepts UUID or mt5_login; supports Bearer, cookie, or dl_token)."""
    account = await _resolve_account(db, account_id_or_login)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    if url_mode == "external":
        api_base_url = f"https://{settings.terminal_domain}/api/v1/ingest"
    else:
        api_base_url = "http://ingest.terminal.local:8000/api/v1/ingest"

    api_key_line = f"PASTE_YOUR_KEY_STARTING_WITH_{account.api_key_prefix}"
    if account.api_key_enc:
        try:
            decrypted = decrypt_secret(account.api_key_enc, settings.vault_master_key).strip()
            if decrypted:
                api_key_line = decrypted
        except Exception:
            pass

    content = "\r\n".join(
        [
            "; Huseynovlar Terminal — ExnessPanelBridge.mq5 Preset",
            f"; Account: {account.name} (MT5 #{account.mt5_login} / {account.currency})",
            f"ApiBaseUrl={api_base_url}",
            f"AccountApiKey={api_key_line}",
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


@router.get("/downloads/{filename}")
async def download_mql5_file(
    filename: str,
    _: User = Depends(get_current_user),
) -> PlainTextResponse:
    """Download ExnessPanelBridge.mq5 or ExnessPanelHook.mqh (works with Bearer, cookie, or ?dl_token=)."""
    if filename not in ALLOWED_MQL5_DOWNLOADS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requested MQL5 file not found")

    file_path = _resolve_mql5_path(filename)
    if not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"MQL5 asset '{filename}' unavailable")

    content = file_path.read_text(encoding="utf-8")
    return PlainTextResponse(
        content=content,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/integrations/status")
async def get_integrations_status(
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Read-only status of /etc integrations.env, Gemini AI, Telegram Webhook, and YAML catalogs."""
    gemini_key, gemini_src = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.google_ai_api_key,
        vault_key="google_ai_api_key",
        env_names=("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"),
    )
    webhook_url, webhook_url_src = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.alerts_bot_webhook_url,
        vault_key="alerts_bot_webhook_url",
        env_names=("TELEGRAM_WEBHOOK_URL", "ALERTS_BOT_WEBHOOK_URL"),
    )
    webhook_secret, webhook_sec_src = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.alerts_bot_webhook_secret,
        vault_key="alerts_bot_webhook_secret",
        env_names=("TELEGRAM_WEBHOOK_SECRET", "ALERTS_BOT_WEBHOOK_SECRET"),
    )

    news_cfg = settings.load_yaml_config("news_sources.yaml")
    treemap_cfg = settings.load_yaml_config("treemap.yaml")
    assets_cfg = settings.load_yaml_config("assets.default.yaml")
    alerts_cfg = settings.load_yaml_config("alerts.default.yaml")

    parsed_wh = urlparse(webhook_url) if webhook_url else None
    etc_path = Path(settings.integrations_env_path)

    return {
        "integrations_env": {
            "path": settings.integrations_env_path,
            "exists": etc_path.is_file(),
        },
        "gemini": {
            "configured": bool(gemini_key),
            "source": gemini_src,
            "model": settings.google_ai_default_model,
        },
        "telegram_webhook": {
            "configured": bool(webhook_url and webhook_secret),
            "url_configured": bool(webhook_url),
            "secret_configured": bool(webhook_secret),
            "source": webhook_url_src if webhook_url else webhook_sec_src,
            "url_host": parsed_wh.netloc if parsed_wh else "",
            "auth_header": "X-Trading-Webhook-Secret",
        },
        "config_catalog": {
            "config_dir": str(settings.config_dir),
            "news_sources": len(news_cfg.get("rss_feeds") or news_cfg.get("sources") or []),
            "treemap_universes": len(treemap_cfg.get("universes") or {}),
            "default_assets": len(assets_cfg.get("assets") or []),
            "alert_rules": len(alerts_cfg.get("rules") or []),
        },
    }


@router.post("/alerts/test")
async def send_test_alert(
    body: TestAlertRequest = TestAlertRequest(),
    _: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Send test alert via huseynovlar-alerts-bot (/internal/webhooks/trading)."""
    webhook_url, _ = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.alerts_bot_webhook_url,
        vault_key="alerts_bot_webhook_url",
        env_names=("TELEGRAM_WEBHOOK_URL", "ALERTS_BOT_WEBHOOK_URL"),
    )
    webhook_secret, _ = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.alerts_bot_webhook_secret,
        vault_key="alerts_bot_webhook_secret",
        env_names=("TELEGRAM_WEBHOOK_SECRET", "ALERTS_BOT_WEBHOOK_SECRET"),
    )

    if not (webhook_url and webhook_secret):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Telegram alerts webhook is not configured in /opt/huseynovlar-terminal/.env or Vault",
        )

    delivered: list[str] = []
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=8.0) as http:
        try:
            r = await http.post(
                webhook_url,
                headers={
                    "X-Trading-Webhook-Secret": webhook_secret,
                    "X-Webhook-Secret": webhook_secret,
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

    return {"ok": bool(delivered and not errors), "delivered": delivered, "errors": errors, "configured": True}


@router.post("/integrations/gemini-test")
async def test_gemini_integration(
    _: User = Depends(require_operator),
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Verify Google Gemini API connectivity using /opt/huseynovlar-terminal/.env or Vault key."""
    gemini_key, _ = await _resolve_integration_secret(
        db,
        settings,
        settings_val=settings.google_ai_api_key,
        vault_key="google_ai_api_key",
        env_names=("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"),
    )
    if not gemini_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gemini API key is not configured in /opt/huseynovlar-terminal/.env or Vault",
        )

    model = settings.google_ai_default_model or "gemini-3.8-flash"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=6.0) as http:
            resp = await http.post(
                url,
                params={"key": gemini_key},
                json={"contents": [{"parts": [{"text": "Reply with OK only."}]}]},
            )
            latency_ms = int((time.perf_counter() - started) * 1000)
            if resp.status_code != 200:
                return {
                    "ok": False,
                    "model": model,
                    "latency_ms": latency_ms,
                    "reply": "",
                    "detail": f"Gemini HTTP {resp.status_code}",
                }
            data = resp.json()
            candidates = data.get("candidates") or []
            parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
            reply = str(parts[0].get("text", "")).strip() if parts else ""
            return {"ok": True, "model": model, "latency_ms": latency_ms, "reply": reply, "detail": "connected"}
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "model": model, "latency_ms": latency_ms, "reply": "", "detail": str(exc)}
