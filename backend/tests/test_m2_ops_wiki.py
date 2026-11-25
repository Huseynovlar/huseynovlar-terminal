from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.crypto import encrypt_secret
from app.core.database import get_db
from app.db.models import TradingAccount
from app.modules.ops.router import _redact_logs


async def _bootstrap_admin(client: AsyncClient) -> dict[str, str]:
    resp = await client.post(
        "/api/v1/auth/bootstrap",
        json={
            "username": "owner",
            "email": "owner@huseynovlar.org",
            "password": "VeryStrongPassword!2026",
        },
    )
    assert resp.status_code == 201
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_ops_containers_crud_permissions_and_log_redaction(client: AsyncClient) -> None:
    h = await _bootstrap_admin(client)

    # Create container
    c1 = await client.post(
        "/api/v1/ops/containers",
        headers=h,
        json={"container_name": "mt5-xau", "display_name": "MT5 Gold", "host_label": "vps-main"},
    )
    assert c1.status_code == 201
    cid = c1.json()["id"]

    # Duplicate container returns 409
    dup = await client.post(
        "/api/v1/ops/containers",
        headers=h,
        json={"container_name": "mt5-xau", "display_name": "Duplicate"},
    )
    assert dup.status_code == 409

    # List & Detail by UUID and by name
    listed = (await client.get("/api/v1/ops/containers", headers=h)).json()
    assert any(item["name"] == "mt5-xau" for item in listed)

    det_id = await client.get(f"/api/v1/ops/containers/{cid}", headers=h)
    assert det_id.status_code == 200 and det_id.json()["display_name"] == "MT5 Gold"

    det_name = await client.get("/api/v1/ops/containers/mt5-xau", headers=h)
    assert det_name.status_code == 200 and det_name.json()["id"] == cid

    # Patch is_restart_allowed=False -> stop/restart must return 403
    upd = await client.patch(
        f"/api/v1/ops/containers/{cid}",
        headers=h,
        json={"display_name": "MT5 XAU Live", "is_restart_allowed": False},
    )
    assert upd.status_code == 200 and upd.json()["is_restart_allowed"] is False

    blocked_restart = await client.post("/api/v1/ops/containers/mt5-xau/restart", headers=h)
    assert blocked_restart.status_code == 403

    # Delete container
    deleted = await client.delete(f"/api/v1/ops/containers/{cid}", headers=h)
    assert deleted.status_code == 204
    assert (await client.get(f"/api/v1/ops/containers/{cid}", headers=h)).status_code == 404

    # Log secret redaction check
    sample = "POST /snapshot Bearer eyJabc.def.ghi AccountApiKey=htk_secret12345 password=topsecret"
    redacted = _redact_logs(sample)
    assert "htk_secret12345" not in redacted
    assert "eyJabc.def.ghi" not in redacted
    assert "topsecret" not in redacted


@pytest.mark.asyncio
async def test_ops_bridge_set_by_login_dl_token_and_mql5_downloads(
    client: AsyncClient,
    test_settings: Settings,
) -> None:
    h = await _bootstrap_admin(client)

    prof = (await client.post("/api/v1/profiles", headers=h, json={"name": "Exness Main"})).json()
    acc = (
        await client.post(
            "/api/v1/accounts",
            headers=h,
            json={
                "profile_id": prof["id"],
                "name": "USTEC Cent",
                "mt5_login": "253752700",
                "mt5_server": "Exness-MT5Real10",
                "currency": "USC",
            },
        )
    ).json()

    # Populate api_key_enc to test real key pre-fill in bridge.set
    override_db = client._transport.app.dependency_overrides[get_db]  # type: ignore[union-attr]
    async for db in override_db():
        assert isinstance(db, AsyncSession)
        row = (await db.execute(select(TradingAccount).where(TradingAccount.id == acc["id"]))).scalar_one()
        row.api_key_enc = encrypt_secret(acc["api_key"], test_settings.vault_master_key)
        await db.commit()
        break

    # Kill-switch works by mt5_login
    ks = await client.post("/api/v1/ops/kill-switch/253752700", headers=h, json={"confirm_text": "CLOSE ALL"})
    assert ks.status_code == 200 and ks.json()["mt5_login"] == "253752700"

    # Issue signed download token
    dl_resp = await client.post("/api/v1/auth/download-token", headers=h)
    assert dl_resp.status_code == 200
    dl_token = dl_resp.json()["dl_token"]
    assert dl_resp.json()["expires_in"] == 900

    # Clear cookies (simulate incognito browser direct link with ?dl_token= ONLY)
    client.cookies.clear()

    # bridge.set by mt5_login (internal mode + decrypted real api_key_enc)
    preset_int = await client.get(f"/api/v1/ops/setup-wizard/253752700/bridge.set?dl_token={dl_token}")
    assert preset_int.status_code == 200
    assert "ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest" in preset_int.text
    assert f"AccountApiKey={acc['api_key']}" in preset_int.text

    # bridge.set external mode
    preset_ext = await client.get(
        f"/api/v1/ops/setup-wizard/253752700/bridge.set?url_mode=external&dl_token={dl_token}"
    )
    assert preset_ext.status_code == 200
    assert "ApiBaseUrl=https://terminal.huseynovlar.org/api/v1/ingest" in preset_ext.text

    # MQL5 downloads work with ?dl_token= and block arbitrary files
    mq5 = await client.get(f"/api/v1/ops/downloads/ExnessPanelBridge.mq5?dl_token={dl_token}")
    assert mq5.status_code == 200
    assert "ExnessPanelBridge" in mq5.text

    mqh = await client.get(f"/api/v1/ops/downloads/ExnessPanelHook.mqh?dl_token={dl_token}")
    assert mqh.status_code == 200

    traversal = await client.get(f"/api/v1/ops/downloads/secrets.env?dl_token={dl_token}")
    assert traversal.status_code == 404


@pytest.mark.asyncio
async def test_ops_integrations_status_and_unconfigured_tests(client: AsyncClient) -> None:
    h = await _bootstrap_admin(client)

    st = await client.get("/api/v1/ops/integrations/status", headers=h)
    assert st.status_code == 200
    body = st.json()
    assert body["telegram_webhook"]["auth_header"] == "X-Trading-Webhook-Secret"
    assert body["config_catalog"]["news_sources"] >= 1
    assert body["config_catalog"]["treemap_universes"] >= 1

    # Unconfigured tests fail cleanly with 400
    assert (await client.post("/api/v1/ops/alerts/test", headers=h, json={})).status_code == 400
    assert (await client.post("/api/v1/ops/integrations/gemini-test", headers=h)).status_code == 400


@pytest.mark.asyncio
async def test_wiki_auto_seed_crud_and_rbac(client: AsyncClient) -> None:
    h = await _bootstrap_admin(client)

    # Auto-seeds initial operational playbooks on first GET
    pages = (await client.get("/api/v1/wiki", headers=h)).json()
    assert len(pages) >= 3
    slugs = {p["slug"] for p in pages}
    assert "mt5-bridge-setup" in slugs

    # Create new page
    created = await client.post(
        "/api/v1/wiki",
        headers=h,
        json={
            "title": "XAUUSD News Playbook",
            "category": "strategy",
            "content_md": "# Gold CPI Rules\nFlatten before NFP.",
            "is_pinned": True,
        },
    )
    assert created.status_code == 201
    slug = created.json()["slug"]
    assert slug == "xauusd-news-playbook"

    # Duplicate slug -> 409
    dup = await client.post(
        "/api/v1/wiki",
        headers=h,
        json={"title": "Another", "slug": slug, "content_md": "x"},
    )
    assert dup.status_code == 409

    # Get by slug & update & delete
    got = await client.get(f"/api/v1/wiki/{slug}", headers=h)
    assert got.status_code == 200 and "Gold CPI Rules" in got.json()["content_md"]

    upd = await client.patch(f"/api/v1/wiki/{slug}", headers=h, json={"title": "Updated Gold Playbook"})
    assert upd.status_code == 200 and upd.json()["title"] == "Updated Gold Playbook"

    # Viewer can read wiki but cannot create/delete
    await client.post(
        "/api/v1/users",
        headers=h,
        json={
            "username": "viewer1",
            "email": "viewer1@huseynovlar.org",
            "password": "ViewerPassword!2026",
            "role": "VIEWER",
        },
    )
    v_tok = (
        await client.post("/api/v1/auth/login", json={"username": "viewer1", "password": "ViewerPassword!2026"})
    ).json()["access_token"]
    v_h = {"Authorization": f"Bearer {v_tok}"}
    assert (await client.get(f"/api/v1/wiki/{slug}", headers=v_h)).status_code == 200
    assert (await client.post("/api/v1/wiki", headers=v_h, json={"title": "Blocked"})).status_code == 403

    assert (await client.delete(f"/api/v1/wiki/{slug}", headers=h)).status_code == 204
    assert (await client.get(f"/api/v1/wiki/{slug}", headers=h)).status_code == 404
