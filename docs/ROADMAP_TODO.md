# Huseynovlar Terminal — Master Roadmap & Progress Checklist

> **Репозиторий:** `huseynovlar-terminal` (монорепозиторий)  
> **Домен:** `https://terminal.huseynovlar.org` (только внутри NetBird VPN, TLS через существующий Caddy)  
> **Дизайн-база фронтенда:** Studio Admin (`arhamkhnz` — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Table + Zustand)  
> **Бэкенд / БД / Воркер:** Python 3.12 (FastAPI) + PostgreSQL 16 + Redis 7 + Async Worker  
> **Правило ведения:** после каждого завершённого шага/группы шагов обновлять `[x]`, фиксировать ключевые файлы, конфиги и следующий шаг для бесшовного продолжения в любом чате.

---

## Текущий статус
- **Активная фаза:** Фаза 5 — Docker Ops (`docker-socket-proxy`), Kill-Switch, Telegram-уведомления, Редактор горячих клавиш (`F13–F24`) и Setup Wizard (`.set` генератор) / Wiki
- **Последнее действие:** Полностью завершена **Фаза 4 (Market Treemap Heatmap, Резервные мульти-источники мировых новостей, Календарь, Google AI Gemini Co-Pilot, UTC по умолчанию и 3 языка RU/EN/AZ)**:
  - **Config & Worker:** расширен `config/news_sources.yaml` (12 резервных мировых источников: Kitco, Investing, FXStreet, CNBC Finance/Tech, MarketWatch, Yahoo Finance, Fed, ECB, Google News, GDELT 2.0 + резервный календарь ForexFactory), создан `worker/main.py`.
  - **Backend:** добавлены `NewsItem`, `EconomicEvent`, `AiBriefing` и `backend/app/modules/intelligence/router.py` (`/news`, `/news/refresh` с изоляцией ошибок по каждому фиду и WS-рассылкой Breaking News, `/calendar`, `/treemap`, `/ai/analyze` для Google Gemini с живым контекстом портфеля). Прогнаны `ruff` и `pytest` (**8/8 PASSED**).
  - **Frontend:** создан `MarketTreemap.tsx` (StockCharts/Finviz тремап NASDAQ-100 / S&P 500 / Gold & Commodities с `1D/1W/1M/YTD`), страница `chat/route.tsx` (мировые новости + фильтры по активам + Google Gemini Co-Pilot с утренним брифингом и риск-анализом), часовой пояс по умолчанию переведён на **`UTC`**, добавлены **3 языка (`RU` / `EN` / `AZ`)**.
- **Следующий шаг:** Начать **Фазу 5** — `containers/router.py` (`docker-socket-proxy` allowlist + Restart/Start/Stop/Logs), аварийный Kill-Switch, `setup_wizard/router.py` (`.set` генератор MT5), Telegram-алерты и UI-страницы Containers Ops, Setup Wizard/Wiki, Profile/Vault и Visual Hotkey Editor (`F13–F24`).
- **Важные сквозные правила пользователя:**
  - Все команды для VPS выдавать **готовыми цельными copy-paste блоками**.
  - Единое живое время по умолчанию **`UTC`** (настраиваемое) и **3 языка (`RU` / `EN` / `AZ`)**.
  - В Фазе 6 повторить проверенную схему **GitHub Actions + NetBird SSH деплоя из `server_telegram_bot`**.

---

## Фаза 0: Инициализация репозитория, конфиги и Docker-топология
- [x] Создать структуру монорепозитория (`config/`, `backend/`, `worker/`, `frontend/`, `mql5/`, `deploy/`, `docs/`)
- [x] Перенести в репозиторий `docs/ARCHITECTURE.md` и `docs/ROADMAP_TODO.md`
- [x] Импортировать UI-базу **Studio Admin** (`arhamkhnz/tanstack-shadcn-admin-dashboard`) в `frontend/`
- [x] Создать централизованные YAML-конфиги:
  - [x] `config/assets.default.yaml` (`XAUUSD`, `USTEC`, Watchlist, алиасы, новостные теги)
  - [x] `config/news_sources.yaml` (12 резервных бесплатных источников RSS/Atom, GDELT, ForexFactory JSON, макро-котировки)
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
  - [x] Реализовать **бегущую строку в шапке (`BloombergTickerTape`)** + `TerminalHeaderControls` (`USD/USC`, `Privacy Shift+M`, `UTC`, `RU/EN/AZ`, `Ticker`, звук) + `HotkeyEngine` (`Shift+M/C/T`, `G D/A/M/N/C/I`, `?`, готовность под `F13–F24`)
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
- [x] **Accounts & Robots UI (`default/route.tsx`):** мульти-счета `USD` + `USC`, статус `AlgoTrading`, Balance/Equity/Floating, API-ключ префикс
- [x] **Deep Analytics & Risk Lab (`analytics/router.py` + `analytics/route.tsx`):** Win Rate, Profit Factor, Expectancy, Payoff Ratio, Max Drawdown, Recovery Factor, Sharpe, Equity & Underwater Drawdown графики, Hourly Heatmap (00–23), Daily PnL Calendar, разрезы по активам (`XAUUSD`/`USTEC`) и счетам (`USD`/`USC`)
- [x] **Полный отчёт Exness (`GET /api/v1/analytics/statement.csv` + Print/PDF):** выгрузка Excel-совместимого UTF-8 BOM CSV и печать в PDF
- [x] **Казначейство / Treasury (`GET /api/v1/analytics/treasury` + `finance/route.tsx`):** учёт `DEAL_TYPE_BALANCE` (депозиты, выводы, внутренние переводы, Хранилище Exness) + индикатор цели фиксации прибыли в Хранилище
- [x] **Live WebSocket Hook (`use-live-socket.ts`):** автопереподключение `/api/v1/ws/live` + триггеры звуковых эффектов на сделки, крупную прибыль и срочные новости
- [x] **Тесты Фазы 3:** `ruff check` + `pytest -v` (**6/6 PASSED**) + `npm run build`

## Фаза 4: Market Treemap (StockCharts), Резервные мировые новости, Календарь и Google AI (Gemini)
- [x] **Market Treemap Heatmap:** `GET /api/v1/intelligence/treemap` + `MarketTreemap.tsx` (NASDAQ-100 `USTEC`, S&P 500, Gold & Commodities `XAUUSD`, периоды `1D`/`1W`/`1M`/`YTD`)
- [x] **Redundant World News & Calendar:** 12 резервных источников в `config/news_sources.yaml`, устойчивый RSS/Atom парсер с изоляцией сбоев и WS-рассылкой Breaking News (`intelligence/router.py`) + `worker/main.py`
- [x] **Google AI (Gemini) Co-Pilot:** `POST /api/v1/intelligence/ai/analyze` (зашифрованный ключ из Secret Vault, живой контекст портфеля/позиций/новостей) + UI `chat/route.tsx` (утренний брифинг, риск-анализ, интерактивный чат)
- [x] **Единое время `UTC` по умолчанию + 3 языка (`RU` / `EN` / `AZ`)**
- [x] **Тесты Фазы 4:** `ruff check` + `pytest -v` (**8/8 PASSED**) + `npm run build`

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
