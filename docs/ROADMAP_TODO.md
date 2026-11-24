# Huseynovlar Terminal — Master Roadmap & Progress Checklist

> **Репозиторий:** `huseynovlar-terminal` (монорепозиторий)  
> **Домен:** `https://terminal.huseynovlar.org` (только внутри NetBird VPN, TLS через существующий Caddy)  
> **Дизайн-база фронтенда:** Studio Admin (`arhamkhnz` — React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui + TanStack Table + Zustand)  
> **Бэкенд / БД / Воркер:** Python 3.12 (FastAPI) + PostgreSQL 16 + Redis 7 + Async Worker  
> **Правило ведения:** после каждого завершённого шага/группы шагов обновлять `[x]`, фиксировать ключевые файлы, конфиги и следующий шаг для бесшовного продолжения в любом чате.

---

## Текущий статус
- **Активная фаза:** Фаза 1 — Фундамент безопасности (FIDO2/WebAuthn), Профиль, Мини-фреймворк и CRUD
- **Последнее действие:** Полностью завершена **Фаза 0**: создана структура монорепозитория, скопирован шаблон **Studio Admin** (`arhamkhnz/tanstack-shadcn-admin-dashboard`, Vite + React 19 + TS + Tailwind v4 + shadcn/ui + TanStack Table + Zustand + dnd-kit + cmdk) в `frontend/`, добавлены YAML-конфиги (`config/*.yaml`), hardened `deploy/docker-compose.yml` (проверен `docker compose config`), `deploy/caddy/terminal.Caddyfile`, `deploy/nginx/terminal.conf`, `deploy/scripts/backup-db.sh`, `.env.example` и `.github/workflows/ci.yml`.
- **Следующий шаг:** Начать **Фазу 1** — поднять `backend/` (FastAPI + SQLAlchemy 2.0 + Alembic + FIDO2/WebAuthn + 2FA + AES-256-GCM + CRUD) и интегрировать наш config-driven мини-фреймворк (`frontend/src/framework/`) + бегущую строку новостей в `frontend/`.

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
- [x] Настроить базовый CI (`.github/workflows/ci.yml`; `deploy-production.yml` добавим в Фазе 6)

## Фаза 1: Фундамент безопасности (FIDO2/WebAuthn), Профиль, Мини-фреймворк и CRUD
- [ ] **Backend Core:** модульная архитектура (`app/core/module_registry.py`), SQLAlchemy 2.0 async, Alembic, AES-256-GCM шифрование секретов
- [ ] **Миграция БД `001_init`:** users, webauthn_credentials, totp, sessions, preferences, audit_logs, exness_profiles, docker_containers, trading_accounts (`USD`/`USC` + `currency_divisor`), assets (+ Watchlist), robots
- [ ] **Auth & Security:** Argon2id + 2FA TOTP + **FIDO2 / WebAuthn Passkeys** (`RP_ID=terminal.huseynovlar.org`) + JWT / HttpOnly Refresh + уведомление в Telegram о входе с нового IP
- [ ] **CRUD API:** Exness-профили, мульти-счета (`USD` + `USC` на один актив), активы + Watchlist, роботы, генерация/ротация `X-Account-Api-Key` (SHA-256), профиль пользователя (аватар, био, соцсети)
- [ ] **Frontend (Studio Admin + Mini-Framework):**
  - [ ] Развернуть дизайн-систему `Studio Admin` на React 19 + TS + Vite + Tailwind v4 + shadcn/ui
  - [ ] Реализовать `frontend/src/framework/` (`pages.config.ts`, `widgets.config.ts`, `hotkeys.config.ts`, `<TerminalPageShell>`)
  - [ ] Реализовать **бегущую строку в шапке (Bloomberg Live Ticker Tape)** + `Cmd+K` Command Palette + переключатели `USD/USC`, `Privacy Mode (Shift+M)`, таймзоны (`Asia/Baku`), i18n (`RU`/`EN`)
  - [ ] Реализовать **Конструктор левого меню** (drag-and-drop, группировки, скрытие, закрепление активов) и страницу **Профиля** (аватар, соцсети, Passkeys/2FA)
- [ ] **Тесты Фазы 1:** unit/security тесты Auth/WebAuthn, AES-256-GCM, CRUD, `npm run build`

## Фаза 2: Zero-Latency MQL5 + Живые графики (`M1`–`W1`), Ордера на графике и DOM
- [ ] **MQL5:** написать `mql5/ExnessPanelBridge.mq5` (отдельный поток, `OnInit` sync, `OnTradeTransaction`, `OnTimer` тики/свечи/снэпшоты/MAE-MFE/`MarketBookGet`, предохранитель `AllowRemoteClose = false`)
- [ ] **MQL5 Hook:** написать `mql5/ExnessPanelHook.mqh` (0 сетевых вызовов, `< 0.05 мс` IPC для версии/пресета/задержки исполнения/ошибок)
- [ ] **Ingestion API & Live Stream:** `/api/v1/ingest/*` (идемпотентность по `mt5_deal_ticket`), Redis Pub/Sub → WebSocket hub `/api/v1/ws/live`
- [ ] **Charts Engine (Frontend):** TradingView Lightweight Charts (`M1`–`W1`, хоткеи `1`–`8`), live-тики Bid/Ask/Spread, **линии активных ордеров (`Entry`/`SL`/`TP`)**, **маркеры входов/выходов истории на свечах**, клик из таблицы ордеров → фокус на графике
- [ ] **DOM & Supply/Demand:** стакан (`MarketBookGet`), Bid/Ask Pressure Gauge, Session Volume Profile (VPVR/POC), авто-зоны Supply/Demand
- [ ] **Фильтр мульти-счетов (`USD` + `USC`):** переключение «Все счета по активу» ↔ «Конкретный счёт» ↔ «Конкретный робот» прямо на графике
- [ ] **Тесты Фазы 2:** идемпотентность Ingestion API, нормализация `USC / 100`, WebSocket broadcast

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
