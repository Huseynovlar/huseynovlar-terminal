# Huseynovlar Terminal — Master Roadmap & Progress Checklist

> **Репозиторий:** `huseynovlar-terminal` (монорепозиторий)  
> **Домен:** `https://terminal.huseynovlar.org` (только внутри NetBird VPN, TLS через существующий Caddy)  
> **Дизайн-база фронтенда:** Studio Admin (`arhamkhnz` — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Table + Zustand)  
> **Бэкенд / БД / Воркер:** Python 3.12 (FastAPI) + PostgreSQL 16 + Redis 7 + Async Worker  
> **Правило ведения:** после каждого завершённого шага/группы шагов обновлять `[x]`, фиксировать ключевые файлы, конфиги и следующий шаг для бесшовного продолжения в любом чате.

---

## Текущий статус
- **Активная фаза:** Продакшн-релиз на VPS (`https://terminal.huseynovlar.org`) + Bloomberg-усиление!
- **Последнее действие:** Полностью завершены **Фаза 6 + все расширенные функции реального времени и безопасности**:
  - Исправлен `terminal-frontend` (Nitro SSR + unprivileged Nginx `user: 1000:1000` + корректный healthcheck `/auth/v2/login`).
  - **Безопасность и карта IP (`profile/route.tsx`, `auth/router.py`):** таблица активных сессий (с защитой текущей), интерактивная карта геолокации IP (OpenStreetMap + определение `NetBird VPN 100.104.x.x`), история входов, управление WebAuthn Passkeys с подтверждением **2FA TOTP** при удалении.
  - **Реестр проверенных источников новостей (`config/news_sources.yaml`, `intelligence/router.py`, `worker/main.py`, `chat/route.tsx`):** зелёная галочка `✓` только у доверенных первоисточников, автоматическая группировка и кросс-проверка новостей между СМИ («Подтверждено: N СМИ»), отдельный блок «Реестр проверенных источников».
  - **Bloomberg Pro Charts (`LiveAssetChart.tsx`, `charts/router.py`):** мгновенный поиск и просмотр графиков **любого мирового актива** без добавления в БД (`/charts/explore`), интерактивное рисование (`Уровень S/R`, `Тренд`, `Фибоначчи`) с сохранением в `localStorage`, индикаторы `EMA20 / EMA50 / EMA200 / BB(20,2)`.
  - **Живой пинг (`ms`), точные live-статусы роботов и мировые сессии (`default/route.tsx`)** + форма **«+ Добавить MT5 контейнер»** (`infrastructure/route.tsx`, `POST /ops/containers`).
  - Исправлен парсинг `.env` в `deploy/scripts/backup-db.sh` (безопасное чтение переменных с пробелами).
- **Бэклог на будущее (запланировано по запросу владельца):**
  - [ ] **Общий агрегированный баланс со всех счетов** (единый виджет Total Balance / Equity / Floating PnL в шапке и на странице счетов/аккаунта).
  - [ ] **Мульти-брокер / мульти-платформенная архитектура** (поддержка не только Exness/MT5, но и других брокеров/криптобирж через единый адаптер провайдеров).
  - [ ] **Оптимизация лимитов AI (Gemini):** кэширование ответов, дневной бюджет токенов/запросов, умный контекст без лишних вызовов.
  - [ ] **Kanban / Todo-лист / Watchlist-трекер** для отслеживания целевых активов, торговых идей и планов.
  - [ ] **Расширенный каталог активов + дополнительные круглосуточные новостные источники** (максимальное покрытие рынков и 24/7 свежих новостей с автообновлением).
  - [ ] **Единая конфигурация всех внешних провайдеров и URL** (как `IP_GEO_API_URL` — вынести все внешние API, провайдеры котировок, карт и новостей в конфиги для замены без правки кода).
  - [ ] Интеграция бэкапа `/var/backups/huseynovlar-terminal` в существующий **Google Drive (`restic`)** на VPS.
  - [ ] Подключение **SMTP** для email-уведомлений и отчётов (отложено по решению владельца).
  - [ ] Подключение физического макропада (Stream Deck / QMK `F13–F24`).

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
- [x] Настроить базовый CI (`.github/workflows/ci.yml` + `.github/workflows/deploy-production.yml`)

## Фаза 1: Фундамент безопасности (FIDO2/WebAuthn), Профиль, Мини-фреймворк и CRUD
- [x] **Backend Core:** модульная архитектура (`backend/app/core/module_registry.py`), SQLAlchemy 2.0 async, Alembic env, AES-256-GCM шифрование секретов (`backend/app/core/crypto.py`)
- [x] **Схема БД (`backend/app/db/models.py`):** users, webauthn_credentials, sessions, preferences, audit_logs, exness_profiles, docker_containers, trading_accounts (`USD`/`USC` + `currency_divisor` + `last_ping_ms`), assets (+ Watchlist), robots (`live_status`, `last_execution_ms`), secret_vault
- [x] **Auth & Security (`backend/app/modules/auth/router.py`):** Argon2id + 2FA TOTP + **FIDO2 / WebAuthn Passkeys** (`RP_ID=terminal.huseynovlar.org`) + JWT / HttpOnly Refresh + Активные сессии (завершение других, защита текущей) + История входов + Audit Log
- [x] **CRUD API (`profile`, `assets`, `accounts`, `audit`):** Exness-профили, мульти-счета (`USD` + `USC` на один актив), активы + Watchlist + YAML seed, роботы, генерация/ротация `X-Account-Api-Key` (SHA-256), профиль пользователя (аватар, био, соцсети, encrypted vault)
- [x] **Тесты Фазы 1A:** `ruff check` + `pytest -v` + `backend-check` в CI
- [x] **Frontend (Studio Admin + Mini-Framework — Фаза 1B):**
  - [x] Реализовать `frontend/src/framework/` (`pages.config.ts`, `terminal-store.ts`, `api-client.ts`, `<TerminalPageShell>` единый шаблон страниц)
  - [x] Реализовать Split-Screen страницу **Login / Bootstrap** (`auth/v2/login`: FIDO2 Passkey 1-click + пароль + 2FA TOTP)
  - [x] Реализовать **бегущую строку в шапке (`BloombergTickerTape`)** + `TerminalHeaderControls` (`USD/USC`, `Privacy Shift+M`, `UTC`, `RU/EN/AZ`, `Ticker`, звук) + `HotkeyEngine` (`Shift+M/C/T`, `G D/A/M/N/C/I`, `?`, готовность под `F13–F24`)
  - [x] Обновить левое меню под группы `Huseynovlar Terminal` (`Терминал`, `Хабы активов`, `Рынок и ИИ`, `Инфраструктура`, `Система`)
  - [x] Проверить `npm run build` (успешно, exit code 0) и обновить `docs/ROADMAP_TODO.md`

## Фаза 2: Zero-Latency MQL5 + Живые графики (`M1`–`W1`), Ордера на графике, DOM и Звук
- [x] **MQL5:** написан `mql5/ExnessPanelBridge.mq5` (отдельный поток, `OnInit` sync, `OnTradeTransaction`, `OnTimer` тики/свечи/снэпшоты/MAE-MFE/живой пинг `TERMINAL_PING_LAST`, предохранитель `AllowRemoteClose = false`)
- [x] **MQL5 Hook:** написан `mql5/ExnessPanelHook.mqh` (0 сетевых вызовов, `< 0.05 мс` IPC для версии/пресета/задержки исполнения/ошибок)
- [x] **Ingestion API & Live Stream:** `backend/app/modules/ingest/router.py` (идемпотентность по `mt5_deal_ticket`, `USC / 100`, отделение `DEAL_TYPE_BALANCE` / Exness Vault, `ping_ms` + `robot_states`) + `ws_hub.py` + `WS /api/v1/ws/live`
- [x] **Charts Engine (Frontend):** **TradingView Lightweight Charts** (`LiveAssetChart.tsx`: `M1`–`W1`, хоткеи `1`–`8`, Bid/Ask/Spread, **линии активных ордеров `Entry`/`SL`/`TP`**, **маркеры входов/выходов истории на свечах**, клик из таблицы ордеров → фокус на графике)
- [x] **DOM & Supply/Demand:** панель стакана / Bid-Ask Pressure / Session POC рядом с графиком
- [x] **Фильтр мульти-счетов (`USD` + `USC`):** переключение «Все счета по активу (USD + USC)» ↔ «Конкретный счёт» прямо над графиком
- [x] **Звуковой движок (Web Audio API):** `sound-engine.ts` (открытие ордера, прибыль, крупная прибыль, срочные новости, алерты + кнопка звука в шапке)
- [x] **Тесты Фазы 2:** `ruff check` + `pytest -v` + `npm run build`

## Фаза 3: Asset Hubs, Полный отчёт Exness, Аналитика и Казначейство (Treasury)
- [x] **Accounts & Robots UI (`default/route.tsx`):** мульти-счета `USD` + `USC`, статус `AlgoTrading`, Balance/Equity/Floating, API-ключ префикс
- [x] **Deep Analytics & Risk Lab (`analytics/router.py` + `analytics/route.tsx`):** Win Rate, Profit Factor, Expectancy, Payoff Ratio, Max Drawdown, Recovery Factor, Sharpe, Equity & Underwater Drawdown графики, Hourly Heatmap (00–23), Daily PnL Calendar, разрезы по активам (`XAUUSD`/`USTEC`) и счетам (`USD`/`USC`)
- [x] **Полный отчёт Exness (`GET /api/v1/analytics/statement.csv` + Print/PDF):** выгрузка Excel-совместимого UTF-8 BOM CSV и печать в PDF
- [x] **Казначейство / Treasury (`GET /api/v1/analytics/treasury` + `finance/route.tsx`):** учёт `DEAL_TYPE_BALANCE` (депозиты, выводы, внутренние переводы, Хранилище Exness) + индикатор цели фиксации прибыли в Хранилище
- [x] **Live WebSocket Hook (`use-live-socket.ts`):** автопереподключение `/api/v1/ws/live` + триггеры звуковых эффектов на сделки, крупную прибыль и срочные новости
- [x] **Тесты Фазы 3:** `ruff check` + `pytest -v` + `npm run build`

## Фаза 4: Market Treemap (StockCharts), Резервные мировые новости, Календарь и Google AI (Gemini)
- [x] **Market Treemap Heatmap:** `GET /api/v1/intelligence/treemap` + `MarketTreemap.tsx` (NASDAQ-100 `USTEC`, S&P 500, Gold & Commodities `XAUUSD`, периоды `1D`/`1W`/`1M`/`YTD`)
- [x] **Redundant World News & Calendar:** 12 резервных источников в `config/news_sources.yaml`, устойчивый RSS/Atom парсер с изоляцией сбоев, полями кросс-проверки (`corroborating_sources`, `verification_count`) и WS-рассылкой Breaking News (`intelligence/router.py`) + `worker/main.py`
- [x] **Google AI (Gemini) Co-Pilot:** `POST /api/v1/intelligence/ai/analyze` (зашифрованный ключ из Secret Vault, живой контекст портфеля/позиций/новостей) + UI `chat/route.tsx` (утренний брифинг, риск-анализ, интерактивный чат)
- [x] **Единое время `UTC` по умолчанию + 3 языка (`RU` / `EN` / `AZ`)**
- [x] **Тесты Фазы 4:** `ruff check` + `pytest -v` + `npm run build`

## Фаза 5: Docker Ops, Kill-Switch, Telegram-алерты, Hotkeys/Macro-Pad и Setup Wizard / Wiki
- [x] **Docker Containers Ops (`ops/router.py` + `infrastructure/route.tsx`):** интеграция `docker-socket-proxy` (label `exness-panel.managed=true` + allowlist), просмотр логов, подтверждаемый Restart/Start/Stop + Audit Log
- [x] **Аварийный Kill-Switch:** `POST /ops/kill-switch/{account_id}` с двойной защитой (`CLOSE ALL` + `AllowRemoteClose=true` в MT5)
- [x] **Центр уведомлений Telegram (`POST /ops/alerts/test` + `profile/route.tsx`):** интеграция с `huseynovlar-alerts-bot` (`/internal/webhooks/trading`) и/или выделенный TG-бот + кнопка `Test Telegram Alert`
- [x] **Visual Hotkey & Macro-Pad Editor (`roles/route.tsx`):** перенастройка хоткеев, поддержка `F13`–`F24`, экспорт JSON, конструктор левого меню, плотность Apple/Bloomberg, 3 языка `RU/EN/AZ`, единое время `UTC`
- [x] **Instructions & Setup Wizard (`GET /ops/setup-wizard/{id}/bridge.set` + `academy/route.tsx`):** автогенерация `.set`-файла для `ExnessPanelBridge.mq5` + docker network команда + пошаговая инструкция
- [x] **Тесты Фазы 5:** `ruff check` + `pytest -v` (**9/9 PASSED**) + `npm run build`

## Фаза 6: Финальный Hardening, Google Drive Backup и Production Launch
- [x] Production `frontend/Dockerfile` (multi-stage Node 22 → Nginx) + `backend/Dockerfile`
- [x] `deploy/scripts/deploy.sh` + `.github/workflows/deploy-production.yml` (точная схема NetBird `https://vpn.huseynovlar.org` → `100.104.116.58` с откатом при ошибке)
- [x] Добавлен fail-closed endpoint `POST /internal/webhooks/trading` в `server_telegram_bot` (`19a9ed7`)
- [x] Подготовлены цельные copy-paste блоки команд для запуска на VPS (Caddy, `.env`, `exness_mt5_ingest`, `deploy-bot`, Google Drive `restic` backup)
