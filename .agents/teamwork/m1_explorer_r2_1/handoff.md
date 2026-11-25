# `server_telegram_bot` Blueprint (`m1_explorer_r2_1`)

## 1. Exact Line-Level Edits
- **`app/common/web.py` (L18-23)**: Add `"/internal/webhooks/trading",` to `DEFAULT_AUTH_SKIP_PATHS` tuple (after `"/internal/webhooks/backup",`).
- **`.gitignore` (L15)**: Append `.agents/` so local teamwork state is never tracked in `server_telegram_bot`.
- **`deploy/docker-compose.yml` (L28)**: `TRADING_WEBHOOK_SECRET: ${TRADING_WEBHOOK_SECRET:-}` is ALREADY present on `core`! Also support optional override file cleanly in deploy script.
- **`scripts/server/deploy.sh` (L18-27)** & **`.github/workflows/deploy-production.yml` (L38-42)**:
  - `deploy-production.yml` L40-42: Copy `deploy/docker-compose.yml` into `bundle/docker-compose.yml` alongside `image.tar` so server compose stays in sync (`TRADING_WEBHOOK_SECRET` parity).
  - `scripts/server/deploy.sh`: If `[ -f "$TMP/docker-compose.yml" ] && [ ! -L "$TMP/docker-compose.yml" ]`, atomically update `$BASE/docker-compose.yml` (preserving permissions); in `dc()`, conditionally add `-f "$BASE/docker-compose.override.yml"` if present on VPS so cross-stack `huseynovlar_webhooks` bridge is preserved across deploys!

## 2. `POST /internal/webhooks/trading` Exact Contract (`app/core/main.py` L1122-1165, L1233-1293)
- **App factory**: `create_app(db_path: str | None = None, helper_url: str | None = None) -> web.Application` (uses `middlewares=[error_middleware, internal_auth_middleware()]`, registers `POST /internal/webhooks/trading` -> `trading_webhook`, manages `on_startup` `_monitor_loop` & `on_cleanup` `conn.close()`).
- **Secret check**: `_verify_webhook_secret(request, "TRADING_WEBHOOK_SECRET", ("X-Trading-Webhook-Secret", "X-Webhook-Secret"))` (also accepts `Authorization: Bearer <secret>` per shared helper; returns `503` if `TRADING_WEBHOOK_SECRET` env unset, `401`/`403` on missing/invalid secret — verify helper in `app/core/main.py` top if needed).
- **Payload (`_read_json_dict`)**:
  - Invalid JSON -> `400 {"error": "invalid_json", "message": "Invalid JSON payload"}` (via `error_middleware` / `_read_json_dict`).
  - Fields: `severity` (`info|warning|critical`, default `"info"`), `title` (default `"TRADING ALERT"`, max 140), `message` (optional `Details: ...`, max 1000), `source` (default `"huseynovlar-terminal"`, max 64).
  - Enqueues via `notif.enqueue_alert(category="services", severity=severity, title=f"[TRADING] {title}", body="\n".join(lines)[:1600], cooldown_seconds=0)`.
  - Response: `200` `{"enqueued": count, "status": "ok"}`.
- **Non-skip routes** (e.g. `POST /internal/alerts/test`): Without `X-Internal-Token` -> `401 {"error": "unauthorized", "message": "Invalid internal token"}` (or `503` if `INTERNAL_API_TOKEN` unset).

## 3. Quality Gates & Config (`pyproject.toml` & `.github/workflows/ci.yml`)
- Ruff: `line-length = 100`, `target-version = "py311"`, `select = ["E4", "E7", "E9", "F", "W", "UP", "B", "ASYNC", "C4", "PIE", "RET"]`.
- Commands in `/home/antigravity/Huseynovlar/server_telegram_bot`:
  - `ruff check .` && `ruff format --check .` (use `/home/antigravity/Huseynovlar/huseynovlar-terminal/backend/.venv/bin/ruff` or PATH `ruff` / `.venv` if `aiohttp` needed)
  - `pytest -q -W error::ResourceWarning`
  - `IMAGE_TAG=ci INTERNAL_API_TOKEN=ci CONTROL_BOT_TOKEN=ci ALERTS_BOT_TOKEN=ci docker compose -f deploy/docker-compose.yml config -q`
