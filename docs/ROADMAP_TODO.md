# Huseynovlar Terminal — Master Roadmap & Progress Checklist

> **Репозиторий:** `huseynovlar-terminal` (монорепозиторий)  
> **Домен:** `https://terminal.huseynovlar.org` (только внутри NetBird VPN, TLS через существующий Caddy)  
> **Дизайн-база фронтенда:** Studio Admin (`arhamkhnz` — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Table + Zustand)  
> **Бэкенд / БД / Воркер:** Python 3.12 (FastAPI) + PostgreSQL 16 + Redis 7 + Async Worker  
> **Правило ведения:** после каждого завершённого шага/группы шагов обновлять `[x]`, фиксировать ключевые файлы, конфиги и следующий шаг для бесшовного продолжения в любом чате.

---

## Текущий статус
- **Активная фаза:** Фаза 3 — Глубокая аналитика, Полный отчёт Exness (PDF/CSV/Excel) и Казначейство / Хранилище (Treasury)
- **Последнее действие:** Полностью завершена **Фаза 2 (MQL5 Zero-Latency + Ingestion/WS + Live Charts + Sound Engine)**:
  - **MQL5:** написаны `mql5/ExnessPanelBridge.mq5` (отдельный поток MT5, `OnInit` sync, `OnTradeTransaction`, `OnTimer` тики/свечи `M1`–`D1`/снэпшоты/MAE-MFE, предохранитель `AllowRemoteClose = false`) и безсетевой `mql5/ExnessPanelHook.mqh` (`< 0.05 мс`).
  - **Backend:** добавлены модели (`Deal`, `BalanceOperation`, `OpenPositionLive`, `EquitySnapshot`, `MarketBar`, `PendingCommand`), `ws_hub.py`, `ingest/router.py` (fail-closed `X-Account-Api-Key`, идемпотентность, `USC / 100`, отделение `DEAL_TYPE_BALANCE` / Exness Vault) и `charts/router.py` (`GET /api/v1/charts/{asset_code}` + `WS /api/v1/ws/live`). Прогнаны `ruff` и `pytest` (**5/5 PASSED**).
  - **Frontend:** интегрирован **TradingView Lightweight Charts** (`LiveAssetChart.tsx`: `M1`–`W1` + хоткеи `1`–`8`, линии активных ордеров `Entry`/`SL`/`TP`, маркеры истории входов/выходов на свечах, клик в таблице → фокус на графике, фильтр мульти-счетов `USD`+`USC`, панель DOM / Supply-Demand), добавлен **Web Audio Sound Engine** (`sound-engine.ts` с кнопкой звука в шапке).
- **Следующий шаг:** Начать **Фазу 3** — сводная аналитика (`analytics/router.py`), полный отчёт Exness (PDF/CSV/Excel), Казначейство/Хранилище и UI-страницы на `<TerminalPageShell>`.
- **Важные сквозные правила пользователя:**
  - Все команды для VPS выдавать **готовыми цельными copy-paste блоками**.
  - В Фазе 4 добавить **резервные мульти-источники мировых новостей и рыночных данных** (максимум информации без зависимости от одного источника).
  - В Фазе 6 повторить проверенную схему **GitHub Actions + NetBird SSH деплоя из `server_telegram_bot`**.

---

## Фаза 0: Инициализация репозитория, конфиги и Docker-топология
- [x] Создать структуру монорепозитория (`config/`, `backend/`, `worker/`, `frontend/`, `mql5/`, `deploy/`, `docs/`)
- [x] Перенести в репозиторий `docs/ARCHITECTURE.md` и `docs/ROADMAP_TODO.md`
- [x] Импортировать UI-базу **Studio Admin** (`arhamkhnz/tanstack-shadcn-admin-dashboard`) в `frontend/`
- [x] Создать централизованные YAML-конфиги:
  - [x] `config/assets.default.yaml` (`XAUUSD`, `USTEC`, Watchlist, алиасы, новостные теги)
  - [x] `config/news_sources.yaml` (бесплатные RSS/Atom, GDELT, ForexFactory JSON, макро-котировки)
  - [x] `config/treemap.yaml` (NASDAQ-100, S&P 500, Global Top, Gold & Commodities)
  - [x] `config/alerts.default.yaml` (шаблоны правил уведомлений)
- [x] Создать `deploy/docker-compose.yml` (6 изолированных контейнеров с security hardening: `terminal-frontend`, `terminal-backend`, `terminal-worker`, `terminal-postgres`, `terminal-redis`, `terminal-docker-proxy`)
- [x] Создать `deploy/caddy/terminal.Caddyfile` (`terminal.huseynovlar.org` под NetBird) и `deploy/nginx/terminal.conf`
- [x] Создать `deploy/scripts/backup-db.sh` (`pg_dump` → `${BACKUP_HOST_DIR}` под Google Drive `restic`) и `.env.example`
- [x] Настроить базовый CI (`.github/workflows/ci.yml`; `deploy-production.yml` по образцу `server_telegram_bot` добавим в Фазе 6)

## Фаза 1: Фундамент безопасности (FIDO2/WebAuthn), Профиль, Мини-фреймворк и CRUD
- [x] **Backend Core:** модульная архитектура (`backend/app/core/module_registry.py`), SQLAlchemy 2.0 async, Alembic env, AES-256-GCM шифрование секретов (`backend/app/core/crypto.py`)
- [x] **Схема БД (`backend/app/db/models.py`):** users, webauthn_credentials, sessions, preferences, audit_logs, exness_profiles, docker_containers, trading_accounts (`USD`/`USC` + `currency_divisor`), assets (+ Watchlist), robots, secret_vault
- [x] **Auth & Security (`backend/app/modules/auth/router.py`):** Argon2id + 2FA TOTP + **FIDO2 / WebAuthn Passkeys** (`RP_ID=terminal.huseynovlar.org`) + JWT / HttpOnly Refresh + Audit Log
- [x] **CRUD API (`profile`, `assets`, `accounts`, `audit`):** Exness-профили, мульти-счета (`USD` + `USC` на один актив), активы + Watchlist + YAML seed, роботы, генерация/ротация `X-Account-Api-Key` (SHA-256), профиль пользователя (аватар, био, соцсети, encrypted vault)
- [x] **Тесты Фазы 1A:** `ruff check` + `pytest -v` (4/4 PASSED) + `backend-check` в CI
- [x] **Frontend (Studio Admin + Mini-Framework — Фаза 1B):**
  - [x] Реализовать `frontend/src/framework/` (`pages.config.ts`, `terminal-store.ts`, `api-client.ts`, `<TerminalPageShell>` единый шаблон страниц)
  - [x] Реализовать Split-Screen страницу **Login / Bootstrap** (`auth/v2/login`: FIDO2 Passkey 1-click + пароль + 2FA TOTP)
  - [x] Реализовать **бегущую строку в шапке (`BloombergTickerTape`)** + `TerminalHeaderControls` (`USD/USC`, `Privacy Shift+M`, `Asia/Baku`, `RU/EN`, `Ticker`, звук) + `HotkeyEngine` (`Shift+M/C/T`, `G D/A/M/N/C/I`, `?`, готовность под `F13–F24`)
  - [x] Обновить левое меню под группы `Huseynovlar Terminal` (`Терминал`, `Хабы активов`, `Рынок и ИИ`, `Инфраструктура`, `Система`)
  - [x] Проверить `npm run build` (успешно, exit code 0) и обновить `docs/ROADMAP_TODO.md`

## Фаза 2: Zero-Latency MQL5 + Живые графики (`M1`–`W1`), Ордера на графике, DOM и Звук
- [x] **MQL5:** написан `mql5/ExnessPanelBridge.mq5` (отдельный поток, `OnInit` sync, `OnTradeTransaction`, `OnTimer` тики/свечи/снэпшоты/MAE-MFE, предохранитель `AllowRemoteClose = false`)
- [x] **MQL5 Hook:** написан `mql5/ExnessPanelHook.mqh` (0 сетевых вызовов, `< 0.05 мс` IPC для версии/пресета/задержки исполнения/ошибок)
- [x] **Ingestion API & Live Stream:** `backend/app/modules/ingest/router.py` (идемпотентность по `mt5_deal_ticket`, `USC / 100`, отделение `DEAL_TYPE_BALANCE` / Exness Vault) + `ws_hub.py` + `WS /api/v1/ws/live`
- [x] **Charts Engine (Frontend):** **TradingView Lightweight Charts** (`LiveAssetChart.tsx`: `M1`–`W1`, хоткеи `1`–`8`, Bid/Ask/Spread, **линии активных ордеров `Entry`/`SL`/`TP`**, **маркеры входов/выходов истории на свечах**, клик из таблицы ордеров → фокус на графике)
- [x] **DOM & Supply/Demand:** панель стакана / Bid-Ask Pressure / Session POC рядом с графиком
- [x] **Фильтр мульти-счетов (`USD` + `USC`):** переключение «Все счета по активу (USD + USC)» ↔ «Конкретный счёт» прямо над графиком
- [x] **Звуковой движок (Web Audio API):** `sound-engine.ts` (открытие ордера, прибыль, крупная прибыль, срочные новости, алерты + кнопка звука в шапке)
- [x] **Тесты Фазы 2:** `ruff check` + `pytest -v` (**5/5 PASSED**) + `npm run build`

## Фаза 3: Asset Hubs, Полный отчёт Exness, Аналитика и Казначейство (Treasury)
- [ ] **Global Overview Dashboard:** общая сводка по всем активам, профилям и счетам + настраиваемые виджеты
- [ ] **Asset Hubs (`XAUUSD`, `USTEC` + Watchlist):** объединённый экран (график + ордера + мульти-счета + новости + календарь)
- [ ] **Deep Analytics & Risk Lab:** TWR ROI %, Equity/Balance Curve, Underwater Drawdown, PnL Calendar Heatmap, Profit Factor, Expectancy, Sharpe/Sortino/Calmar, MAE/MFE, Execution Quality (TCA), Correlation Matrix, Stress Test & Monte Carlo
- [ ] **Полный отчёт Exness (Full Statement):** генерация и экспорт в **PDF / CSV / Excel**
- [ ] **Казначейство / Treasury:** автоматический учёт `DEAL_TYPE_BALANCE` (депозиты, выводы, внутренние переводы, Хранилище Exness) + цели фиксации прибыли + Дневник и аннотации на графике
- [ ] **Тесты Фазы 3:** математика TWR ROI, Drawdown, `USD`+`USC` сводок, отделение `DEAL_TYPE_BALANCE`

## Фаза 4: Market Treemap (StockCharts), Мировые новости, Календарь и Google AI (Gemini)
- [ ] **Market Treemap Heatmap:** `worker/app/treemap_collector.py` (`yfinance` + кэш Redis) + интерактивная карта в UI (NASDAQ-100, S&P 500, Global Top, Gold & Commodities) с периодами `1D`/`1W`/`1M`/`YTD`
- [ ] **World News & Calendar Worker:** бесплатные RSS (Kitco, FXStreet, CNBC, MarketWatch, Fed, Google News), GDELT 2.0, ForexFactory JSON календарь, макро-лента (`DXY`, `US10Y`, `VIX`, `SPX`), подача Breaking News в бегущую строку шапки
- [ ] **Google AI (Gemini) Co-Pilot:** настройка ключа и модели в UI, AI News Pulse (перевод + sentiment + impact 1–10), Morning/Evening Briefing, интерактивный Portfolio Risk Copilot, Weekly Trade Post-Mortem
- [ ] **Тесты Фазы 4:** парсинг фидов, дедупликация, мок-тесты Gemini и Treemap

## Фаза 5: Docker Ops, Kill-Switch, Telegram-алерты, Hotkeys/Macro-Pad и Setup Wizard / Wiki
- [ ] **Docker Containers Ops:** интеграция `docker-socket-proxy` (label `exness-panel.managed=true` + allowlist для отдельных MT5 compose-контейнеров), статус/CPU/RAM/логи, Restart/Start/Stop с подтверждением и Audit Log
- [ ] **Аварийный Kill-Switch:** opt-in закрытие позиции/счёта с двойной защитой (`AllowRemoteClose=true` в MT5 + Passkey/2FA в UI)
- [ ] **Центр уведомлений Telegram:** доставка через существующий `huseynovlar-alerts-bot` (webhook) и/или выделенный TG-бот, правила алертов, тихие часы, `Test Alert`
- [ ] **Visual Hotkey & Macro-Pad Editor:** перенастройка всех хоткеев, поддержка `F13`–`F24` (Stream Deck / QMK), экспорт/импорт JSON
- [ ] **Instructions & Setup Wizard:** мастер подключения счёта с автогенерацией `.set`-файла для `ExnessPanelBridge.mq5` + docker network команда + встроенная Markdown Wiki

## Фаза 6: Финальный Hardening, Google Drive Backup и Production Launch
- [ ] Полный прогон unit/integration/security тестов и проверка нагрузки WebSocket
- [ ] Проверка маршрутизации `https://terminal.huseynovlar.org` через существующий Caddy внутри NetBird (0 публичных портов)
- [ ] Настройка `BACKUP_HOST_DIR` и проверка связки `pg_dump` → Google Drive `restic` backup
- [ ] Подключение боевых MT5-контейнеров (`XAUUSD`, `USTEC`) и проверка Zero-Latency
