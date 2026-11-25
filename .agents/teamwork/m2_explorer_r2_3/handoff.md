# M2 Partition 3 Handoff (`ops`, `audit`, `wiki`, `config`, `mql5`)

## 1. Existing State & Signatures
- **`backend/app/modules/ops/router.py` (L1–366)**: `APIRouter(prefix="/ops", tags=["ops"])`. Imports `decrypt_secret(ciphertext, master_key)` (`app.core.crypto`), `get_db`, `record_audit`, `require_admin`. Note: `POST /containers` (L57–99) currently upserts instead of `409` on duplicate; `POST /containers/{name}/{action}` (L158–212) & `GET /containers/{name}/logs` (L215–236) ignore `docker_containers` DB rows (`403` unless in `ALLOWED_MT5_CONTAINERS`); `POST /kill-switch/{account_id}` (L238–275) & `GET /setup-wizard/{account_id}/bridge.set` (L336–366) only call `db.get(TradingAccount, account_id)` (UUID only, fails on `mt5_login` `253752700`), emit `http://terminal-backend:8000/api/v1/ingest`, and output literal `PASTE_YOUR_KEY_STARTING_WITH_...`.
- **`backend/app/modules/audit/router.py` (L1–36)**: `APIRouter(prefix="/audit", tags=["audit"])`, only `GET ""` (`limit=50`).
- **`backend/app/modules/wiki/`**: **Does NOT exist yet** — create `__init__.py` + `router.py` (`prefix="/wiki"`) and mount in `app/main.py`.
- **`mql5/` (read-only)**: `ExnessPanelBridge.mq5` (`13284 B`), `ExnessPanelHook.mqh` (`3461 B`). Resolve path via `/app/mql5/<name>` if exists else `Path(__file__).resolve().parents[4] / "mql5" / <name>`.
- **`config/` YAML Exact Top-Level Keys (read-only)**:
  - `news_sources.yaml`: `rss_feeds` (`list`, 12; also fallback `sources` if M1 adds alias), `economic_calendar` (`dict`), `macro_quotes` (`dict`)
  - `treemap.yaml`: `universes` (`dict`, 3), `periods` (`list`, 4), `refresh_interval_sec` (`int`)
  - `assets.default.yaml`: `assets` (`list`, 4)
  - `alerts.default.yaml`: `rules` (`list`, 8)

## 2. Existing Tests to Preserve (`DO NOT BREAK`)
- `tests/test_ops_and_wizard.py`: `POST /api/v1/ops/containers/some-random-db/restart` -> `403`; `GET .../some-random-db/logs` -> `403`; `POST /api/v1/ops/kill-switch/{acc['id']}` (`confirm_text="yes"` -> `400`, `"CLOSE ALL"` -> `200` with `status=="queued"`, `command_id`, `account_id`); `GET /api/v1/ops/setup-wizard/{acc['id']}/bridge.set` -> `200` `.set` text (`ExnessPanelBridge`, `AccountApiKey=`).
- `tests/test_auth_and_crud.py:157`: `GET /api/v1/audit` MUST return a JSON **`list[dict]`** (not `{items: ...}`) with `"action"` key on each row!

## 3. Implementation Blueprint
1. **Role Guard**: Allow `OPERATOR` + `ADMIN` on mutating `ops`/`wiki` routes and `get_current_user` (which accepts Bearer, `ht_access_token` cookie, OR `?dl_token=`) on `GET` downloads (`bridge.set`, `.mq5`, `.mqh`) and read views (`wiki`, `containers` read). Keep `audit` `ADMIN` (or `get_current_user` per `deps.py` conventions; preserve `test_auth_and_crud.py` admin call). Always pass `extract_client_ip(request)` to `record_audit`.
2. **`ops` Unified 3-Way Container Auth + CRUD**: Authorize container if `name in _allowed_names(settings)` OR Docker label `exness-panel.managed=true` OR `DockerContainer.container_name == name` in DB (`some-random-db` stays `403`!).
   - `GET /ops/containers`: merge DB `DockerContainer` + live Docker `/containers/json?all=1` + linked `TradingAccount` list (`container_id == ref.id`).
   - `POST /ops/containers`: `409` if `container_name` exists (check `test_ops_and_wizard.py` first before changing upsert -> if not called twice in existing tests, enforce `409`).
   - `GET /ops/containers/{id_or_name}`: lookup by `id` or `container_name` (or allowlist); fetch `/containers/{name}/json` + `/containers/{name}/stats?stream=false` (compute CPU% & RAM MB safely when reachable) + linked accounts; `404` if unknown.
   - `PATCH /ops/containers/{id_or_name}` & `DELETE /ops/containers/{id_or_name}` (unlink `TradingAccount.container_id = None` before delete).
   - `POST /ops/containers/{name}/{start|stop|restart}`: enforce `is_restart_allowed` (`403` on `stop|restart` if `False`), update `last_status`, audit.
   - `GET /ops/containers/{name}/logs?tail=200`: allow `tail` `10..1000` (default `200`), redact `htk_[A-Za-z0-9_-]+`, `Bearer \S+`, `(AccountApiKey|password)=\S+`.
3. **Kill-Switch, `.set` & MQL5 Downloads**:
   - Helper `_resolve_account(db, key)` matching `(TradingAccount.id == key) | (TradingAccount.mt5_login == key)`. Use in `POST /ops/kill-switch/{key}` (keep optional `KillSwitchRequest(confirm_text="CLOSE ALL")` default or required if body passed; preserve `400` when `confirm_text != "CLOSE ALL"`) and `GET /ops/setup-wizard/{key}/bridge.set?url_mode=internal|external`.
   - In `bridge.set`: `url_mode="internal"` -> `ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest`; `"external"` -> `https://terminal.huseynovlar.org/api/v1/ingest`. If `account.api_key_enc`: `decrypt_secret(account.api_key_enc, settings.vault_master_key)` -> real `AccountApiKey=htk_...`, else `PASTE_YOUR_KEY_STARTING_WITH_{account.api_key_prefix}`.
   - `GET /ops/downloads/{filename}` (`ExnessPanelBridge.mq5` | `ExnessPanelHook.mqh` ONLY, `404` otherwise) with `Content-Disposition: attachment; filename="{filename}"`.
4. **`/etc` Integrations (`ops`)**:
   - `GET /ops/integrations/status`: return `gemini`, `telegram_webhook` (`auth_header: "X-Trading-Webhook-Secret"`), and `config_catalog` counting `len(news.get("rss_feeds") or news.get("sources") or [])`, `len(treemap.get("universes") or {})`, `len(assets.get("assets") or [])`, `len(alerts.get("rules") or [])`.
   - `POST /ops/alerts/test`: resolve `/etc` -> `env` -> `SecretVaultEntry`; `POST` with `X-Trading-Webhook-Secret` & `X-Webhook-Secret`; keep backward compatibility with `delivered`/`errors`/`configured` fields if asserted, or `400` when unconfigured (verify `test_ops_and_wizard.py` does not call `/alerts/test` — confirmed by grep!).
   - `POST /ops/integrations/gemini-test`: `400` if no key; `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}` (`timeout=6.0`), return `{ok, model, latency_ms, reply, detail}`.
5. **`audit` & `wiki`**:
   - `GET /api/v1/audit?action=&resource_type=&user_id=&limit=100`: outer-join `User` to include `"username"`, return `list[dict]`; add `GET /api/v1/audit/{audit_id}` (`404` if missing).
   - `backend/app/modules/wiki/router.py`: `GET /wiki?category=&q=` (order `is_pinned.desc(), updated_at.desc()`), `POST /wiki` (auto-slugify `title` if `slug` omitted, `409` on duplicate slug), `GET /wiki/{slug_or_id}`, `PATCH /wiki/{slug_or_id}`, `DELETE /wiki/{slug_or_id}` (`AuditLog` on all writes).
