# Huseynovlar Terminal — Master Roadmap & Progress Checklist

> **Репозиторий:** `Huseynovlar/huseynovlar-terminal` (монорепозиторий) + `Huseynovlar/server_telegram_bot`  
> **Домен:** `https://terminal.huseynovlar.org` (только внутри NetBird VPN, TLS через Caddy DNS-01)  
> **Фронтенд:** TanStack Start + TanStack Router + React 19 + TypeScript + Vite 8 + Nitro SSR + Tailwind v4 + shadcn/ui (`@base-ui/react`) + Zustand + Lightweight Charts v5 + Recharts v3  
> **Бэкенд / БД / Воркер:** Python 3.12 (FastAPI) + PostgreSQL 16 + Redis 7 + Async Worker  
> **Дизайн-стандарт:** `tangerine` preset + `floating` sidebar + Bloomberg-only compact density + реактивный `RU / EN / AZ` i18n

---

## Текущий статус
- **Активная фаза:** **Полная пересборка и модернизация M1–M6 завершена — все 36 пунктов спецификации (`F01`–`F36`) реализованы и верифицированы!**
- **Сводка верификации:**
  - **Backend (`huseynovlar-terminal/backend` + `worker/main.py`):** `ruff check` — 0 ошибок; `pytest -v` — полный проход включая `test_e2e_full_journey.py` (все 36 фич `F01`–`F36`).
  - **Frontend (`huseynovlar-terminal/frontend`):** `npx tsc --noEmit`, `npm test`, `npm run build` — без ошибок; 0 нативных `window.confirm`/`prompt`/`alert`; 0 демо-фолбеков (`PREVIEW_TREEMAP`, `demoEvents`).
  - **Infra & Configs:** `docker compose --env-file .env.example -f deploy/docker-compose.yml config --quiet`, PyYAML валидация всех 5 `config/*.yaml`, `bash -n deploy/scripts/*.sh` — OK.
  - **Alerts Bot (`server_telegram_bot`):** `ruff check .` — 0 ошибок; `pytest -q` — **164 passed** (включая fail-closed `POST /internal/webhooks/trading` в `DEFAULT_AUTH_SKIP_PATHS`).
- **Инструкция по ключам и подключению MT5:** см. [`docs/MT5_AND_KEYS_GUIDE_RU.md`](./MT5_AND_KEYS_GUIDE_RU.md).

---

## Полный реестр выполненных требований (`F01`–`F36`)

### Авторизация, сессии, безопасность и загрузки
- [x] **F01: WebAuthn Passkeys** — исправлена ошибка `TypeError` (`base64url <-> Uint8Array` и `serializeCredential`), Redis-хранилище challenge (`TTL=300s`), отображение `sign_count` и метаданных устройства.
- [x] **F09: Бесшовные Auth-куки, Refresh, Signed Downloads (`?dl_token=`) и инкогнито** — `ht_access_token` и `ht_refresh_token` (`HttpOnly; SameSite=Lax; Path=/`), `POST /api/v1/auth/download-token` (`TTL=900s`), `apiDownload()` blob-хелпер, поиск `bridge.set` по UUID или `mt5_login` (`253752700`), скачивание `.set`/`.mq5`/`.mqh`/`.csv`/`.xlsx` работает даже в инкогнито.
- [x] **F17: Управление пользователями (RBAC CRUD + View)** — `/api/v1/users` и `/dashboard/users` (`ADMIN / OPERATOR / VIEWER`) с защитой последнего администратора и запретом самоудаления.
- [x] **F30: Институциональный экран входа** — правая панель `/auth/v2/login` обновлена на мульти-активную институциональную концепцию (без привязки к XAUUSD/Asia/Baku) на `RU/EN/AZ`.
- [x] **F31: Выделенная страница безопасности (`/dashboard/security`)** — смена пароля Argon2id (`POST /auth/change-password`), 2FA TOTP мастер с inline SVG QR-кодом + 10 одноразовых backup-кодов + отключение 2FA, управление Passkeys.
- [x] **F32: Активные сессии, История входов, Аудит и реальный IP Geo** — `--forwarded-allow-ips=*` + извлечение реального клиентского/NetBird IP, отдельные страницы `/dashboard/sessions`, `/dashboard/login-history` (с картой IP), `/dashboard/audit` с детальными View-страницами.
- [x] **F35: Гарантированное удаление `UserSession` при `/auth/logout`** — claim `sid` в JWT access-токене, проверка активности сессии в `get_current_user`, отзыв/удаление `UserSession` по Bearer `sid` И/ИЛИ `ht_refresh_token` куке, очистка кук по всем путям.
- [x] **F36: Продлённый TTL токена (120 мин) + тихий `401 -> /auth/refresh` + мгновенный редирект на `/auth/v2/login`** — единый single-flight refresh в `api-client.ts` с автоматическим повтором запроса и чистым редиректом при истечении/отзыве сессии.

### UI/UX, дизайн-система, локализация и персистентность
- [x] **F02: Полная реактивная локализация `RU / EN / AZ`** — единые словари `useI18n()` во всём интерфейсе с серверной синхронизацией.
- [x] **F03: Только компактная плотность Bloomberg** — удалён переключатель плотности Apple/Comfortable, везде применён институциональный компактный режим (`tabular-nums`).
- [x] **F06: Shimmer-скелетоны (слева направо) и `<AsyncButton>` лоадеры** — анимированные скелетоны на загрузках и спиннеры с текстом прогресса на всех кнопках действий/сохранения/авторизации.
- [x] **F07: Toast-уведомления справа** — единые уведомления на каждое создание, сохранение, удаление, скачивание, копирование и ошибку API.
- [x] **F10: Дефолтная тема `tangerine` + `floating` сайдбар + `/dashboard/preferences`** — полная настройка темы, шрифта, сайдбара, языка, часового пояса (`UTC`), звука и тикера с сохранением на сервере.
- [x] **F11: Переработанная шапка, часы `1s` рядом с профилем, чистый сайдбар и Lock Screen** — убран выбор валюты и таймзоны из шапки, часы `1000ms` перенесены к профилю, убран `<NavUser>` из подвала сайдбара, добавлена блокировка экрана в меню профиля.
- [x] **F13: Звуковой отклик и единое поведение во всём UI** — воспроизведение тестового звукового сигнала при включении звука из любой точки интерфейса + превью звуков в настройках.
- [x] **F16: 5-групповая выделенная многостраничная архитектура** — раздельные страницы List / Create / View / Edit / Delete для каждой сущности (22 чистых модуля без «каши»).
- [x] **F26: Универсальная серверная персистентность** — настройки графиков (таймфрейм, индикаторы, линии/Фибоначчи) в `chart_states`, пользовательские фильтры/раскладки/хоткеи в `users.preferences`.
- [x] **F33: Полная зачистка демо-роутов Studio Admin + Markdown Wiki CRUD + Backup Script + Русское руководство** — удалены все 26 шаблонных демо-роутов и фейковые данные; реализован `/dashboard/wiki` с автосидированием.
- [x] **F34: Ноль нативных диалогов браузера** — 100% `window.confirm` / `window.prompt` / `alert` заменены на стилизованные shadcn `AlertDialog` / `Dialog`.

### Торговый деск, MT5 Bridge, Docker Ops и `/etc` интеграции
- [x] **F08: Доменный Docker-алиас `ingest.terminal.local:8000` и фикс `err=4014`** — алиас с точкой в сети `exness_mt5_ingest`, обновлённый дефолт и диагностика `4014` в `ExnessPanelBridge.mq5` и Setup Wizard.
- [x] **F12: Реальные MT5 Docker-контейнеры (`mt5-xau`, `mt5-ustec`) Ops CRUD + View** — `/dashboard/containers` (список, регистрация, просмотр инспекции/ресурсов/редактированных логов, правка, удаление, Start/Stop/Restart и Kill-Switch).
- [x] **F14: Профили Exness и Торговые счета Full CRUD + View + `api_key_enc`** — Fernet-шифрование ключа моста `htk_...` для автоподстановки в `bridge.set`, ротация ключа, чёткое разделение `AccountApiKey` и опционального Exness PA API.
- [x] **F15: Redis Pub/Sub WebSocket Live Hub (`terminal:live`)** — аутентифицированный `WS /api/v1/ws/live` с мгновенным `welcome`, `10s` `heartbeat`, `ping/pong` RTT-индикатором `WS LIVE • <N>ms` в шапке и live-обновлением балансов/позиций/роботов/графиков/новостей.
- [x] **F18: `/opt/huseynovlar-terminal/.env` и фикс `server_telegram_bot`** — загрузка `GEMINI_API_KEY`, `TELEGRAM_WEBHOOK_URL`, `TELEGRAM_WEBHOOK_SECRET` с хоста (с фолбеком `.env`), убраны лишние `bot_token`/`chat_id` из UI, добавлен `/internal/webhooks/trading` в `DEFAULT_AUTH_SKIP_PATHS` в `server_telegram_bot`, статус и тест-кнопки в `/dashboard/setup`.
- [x] **F23: Единый журнал сделок и Казначейство (Treasury CRUD + View)** — закрытые сделки, открытые позиции, заметки/теги к сделкам, `/dashboard/journal/deals/$dealId`, ручные/MT5 переводы и Exness Vault в `/dashboard/treasury`, экспорт `.csv` и `.xlsx`.
- [x] **F24: Выделенная страница роботов (`/dashboard/robots`) CRUD + View + `1s` таймер + MQL5 downloads** — двойной роутинг `/api/v1/robots` и `/api/v1/accounts/robots`, автообнаружение по `MagicNumber`, ровные секундные часы, скачивание `.mq5`/`.mqh`/`.set`.
- [x] **F25: Работа 2 советников в MT5 и IPC-мост `ExnessPanelHook.mqh`** — обнаружение соседних советников (`ChartFirst/ChartNext`) + безопасное чтение `ep_ipc\events_<login>.jsonl` без задержек для торгового робота.

### Рынки, Аналитика, Новости, Календарь и Gemini AI
- [x] **F04: Реальный Экономический календарь и календарь PnL + Event View** — сбор ForexFactory JSON / RSS в `worker` и `/api/v1/intelligence/calendar`, реальный UI `/dashboard/calendar` и `/dashboard/calendar/$eventId`.
- [x] **F05: Живая карта рынка (Market Treemap) и 100% рабочие фильтры** — `CONFIG_DIR=/app/config`, `panel_egress` + DNS, реальные котировки Yahoo Finance (`S&P 500`, `NASDAQ-100`, `Global`, `Gold & Commodities`, `Crypto`, `Forex`, периоды `1D/1W/1M/3M/YTD`), полноэкранный 2D squarified treemap с логотипами и детальной карточкой.
- [x] **F19: Динамическая лента мировых новостей (`/dashboard/news`) + Story View** — фильтрация по активам из БД, поиску, источнику, сентименту и верификации; детальная страница `/dashboard/news/$newsId`.
- [x] **F20: Выделенный Google AI (Gemini) Co-Pilot (`/dashboard/ai`)** — утренний брифинг, риск-аудит, разбор актива, Post-Mortem, кастомный промпт с живым контекстом портфеля, история брифингов.
- [x] **F21: Реестр проверенных источников новостей в БД (`/dashboard/news/sources`) CRUD + View** — автосидирование из `config/news_sources.yaml`, проверка фида (`POST /sources/{id}/test`) и строгая защита от SSRF (блокировка `127.0.0.1`, `169.254.169.254`, `10.0.0.0/8`, `file://`).
- [x] **F22: Хабы активов (`/dashboard/hubs`) с реальной сводкой новостей + Asset Explorer (`/dashboard/explorer`)** — мульти-счетная статистика, `news_digest`, глобальный поиск и фильтрация новостей на одном экране.
- [x] **F27: Флагманская главная страница (`/dashboard/home`)** — живые KPI портфеля по WS, кривая эквити, пульс счетов/роботов, `1s` мировые сессии, макро-лента с логотипами, мини-карта секторов, срочные новости и обратный отсчёт календаря.
- [x] **F28: Универсальные логотипы активов (`/api/v1/assets/logo/{symbol}`)** — same-origin SVG/кэш прокси с `200 OK` для любых символов (акции, индексы, металлы, валюты, крипто) и `<AssetLogo>`.
- [x] **F29: Глубокая аналитика и Risk Lab (`/dashboard/analytics`)** — исправлен делитель `USC / 100` для комиссий и свопов; 8 интерактивных графиков (Equity, Drawdown, Daily PnL, Hourly TCA, Symbol, Robot, Long/Short, MAE/MFE & Rolling Win-Rate) с серверным сохранением фильтров.

- [x] **W-A/B (2026-11): список из 42 пунктов, часть закрыта** — см. раздел «Статус выполнения» в `docs/HANDOFF_NEXT_CHAT.md` (passkey, пароль+2FA, аватар, пагинация, перевод аудита, сохранение настроек темы, команда подключения контейнеров).

---

## Бэклог развития (v3.0 — опционально)
- [ ] Мульти-брокерские адаптеры (дополнительные брокеры / криптобиржи сверх Exness MT5).
- [ ] Автоматический учёт дневного бюджета токенов Gemini AI и расширенное кэширование брифингов.
- [ ] Подключение SMTP для email-отчётов (отложено по решению владельца).
- [ ] Аппаратная интеграция с макропадом Stream Deck / QMK (`F13–F24` уже поддерживаются в редакторе хоткеев).
