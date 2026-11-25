# Original User Request

## Initial Request — 2026-11-24T20:31:07Z
passkey добавить невозомжно, ошибка Type error

язык интерфейса не меняется

Плотность интерфейса удали пусть останется bloomberg только

календарь не работает

опять там глобальные рынки и так далее фейк по ходу дает не знаю то есть кнопки sp500 и так нажимаются но эффекта ноль, надо полностью сделать так чтобы все кнопки в интерфейсе работали

потом надо добавить скелетон везде, загрузку, когда там идет сохранение данных, авторизация и так далее (можно на кнопке сохранить сделать лоадер и слово идет загрузка или что-то такое)

потом toast уведомление если там я сохранил и так далее, красивый с правой стороны

не получается добавить там url http://terminal-backend:8000 просит нгормальный url надо будет дать ему нормальный url или внутренний url, чтобы можно было его в программу добавить

https://terminal.huseynovlar.org/api/v1/ops/setup-wizard/253752700/bridge.set не качается пишет {"detail":"Authentication required"} и другие тоже так делает, тот же экспорт excel, надо сделть чтобы джаже в инкогнито все работало

кстати theme preset сделай tangerine он лучше смотрится и зашей в систему также и slidebar style сделай floating, также можно чтобы в настрйоках можно было менять этот theme, font, и все что было в preferences

также переделай сам header menu там добавь и удали, что надо, что не надо

удали тестовые mt5-xau mt5-ustec если они тоже тестовые, ну или же если они реальные, то не работает никакая кнопка (Invalid or expired token)

звуковой эффект при включение звука чеерз найтрсоки нет, обрати на это внимание, и в целом, надо сделать чтобы если в одном месте так то и в других метсах точно также и должно быть

по поводу api ключа счета exness, что будем делать ? заново создовать счет ?


короче придется походу переделывать всю систему, чтобы она полностью стало рабочей, мне надо чтобы я просто зашел и все с первого раза, чтобы я каждый раз не отправлял тебе ошибки, сам посотмри свой же код и выяви все ошибки и исправь

WebSocket Connection Established	1795546543.078971 не понятно работает ли он или нет

время не надо чтобы на панели можно было менять для этого есть настройки (UTC), надо чтобы все, что мы меняем сохранялась на сервере

время тоже можешь отпустить рядом с профилем

убери также в меню пользователя, он там не нужен, он уже есть в верхней панели

экран входа зачем нам ? там отдельный пункт, типа блокировка экрана ? может его перенести в таб профиля в верхнем ?

надо добавить детальный просотмр всего от историй входа до аналитики и всего у всего должен быть view, также должен быть тут если мы реализовали добавление нового пользователя то управление пользователями и так далее

как получить gemini api key, webook url там какой указать в settings webhook secret и так далее, это все можно перенести в etc думаю, тут они лишние chatid не нужен так как там идет через нашего бота, bot token тоже не нужен, нужен только telegram url endpoint и так далее

переделай профиль и безопасность отдельно чтобы было редактирование профиля история входов и так далее, то есть отдельные страницы того, что надо отдели, чтобы отдельно было, также и везде сделай так, чтобы все было отдельно, все, что надо было на разных страницах, чтобы каши не было

Лента мировых новостей и кросс-проверка надо чтобы было по добавленным или по поиску, а не стандартные
Google AI (Gemini) Co-Pilot отдельно лучше
Реестр проверенных источников пуст почему-то

также на странице хабы, там в прсмотре надо чтобы была сводка новостей да и в целом были новости, все там было из реальных данных

даже в journal была исотрия переводов и так далее

также надо ли будет давать api key самого профиля enxess ?

думаю мы можем пересоздать счета, чтобы получить api key, это не проблема, но надо отточить добавление редактирвоание и удаление всего этого в панели

также я сейчас посомтерл и попробовал создать счет, там не показывается api key именно trade account api key, можно создать только api key самого аккаунта exness и там есть выбор: Scopes



Full access
Manage rebates and view partnership history

Read-only
View partnership history


Internal transfers
Move funds between your own accounts only

Partner transfers
Transfer rebates to your clients. Can be used with partnership only

allowed ips
Limit API access to specific IPs to protect your account. Enter up to 10 addresses, separated by commas.
я понял почему, так как у меня тип счета mt5 и api ключ не нужен для самих счетов

в конце дай инстуркцию, какие ключи и где надо получить и как добавить


пройдись по каждому пункту, а также по списку todo и по всем инстуркциям и спискам и сделай все нормально

такс, во первых невозожно добавить два робота одновременно в mt5, ну или же я не знаю как это сделать, во вторых для теста я добавил отдельно и ошибка 4014 2026.11.24 19:34:00.998	ee (USTECc,M5)	[ExnessPanelBridge] POST /snapshot failed: HTTP -1 (err=4014)
2026.11.24 19:34:00.999	ee (USTECc,M5)	[ExnessPanelBridge] POST /bars failed: HTTP -1 (err=4014)
2026.11.24 19:34:00.999	ee (USTECc,M5)	[ExnessPanelBridge] POST /bars failed: HTTP -1 (err=4014)


надо сделать список роботов в отдельной странице и добавлние и просомтр и редактирование и удаление чтобы тоже были, короче полный пярм должен быть все, также и должно быть там скачивание файла mq5 или как он там

мне надо чтобы страницы просмотра, добавление, редактирование, удаление были для всего, что можно

также чтобы настройки chart и графиков там показ и так далее сохранялся на сервере, короче мне надо чтобы все сохранялось на сервере

по поводу тогО, что mqh может его как-то добавить в работающий робот или не надо ? так как я прикрепил тебе в скрине, что делает мой робот, если что я могу отпрвить и файл, чтобы ты понял как работать с этим

надо сделать еще главную страницу красивую там тоже выводить

отдельно страница поисков активов просмотр новостей на том же окне (через фильтры, что будет указано либо автоматом, либо же в ручную)

Мне надо полнаценная система bloomberg и других компаний вместевзятых, самые лучшие experience у всех

также секунды там идут не ровно на странице роботов, не каждую секунду, а каждые несколько

Короче пересоздай все страницы, добавь максимальное коичество нужных страниц, чтобы на каждой странице было все, что надо и все, что предназначено конкретно для этой страницы

карту рынка сделай прям крупным там чтобы в фильтрах выбирать параметры, чтобы как у всех было

также будет прекрасно, если ты будешь подгружать логотипы всех активов, там также и рынков и акций по типу sp500 и так далее, надо найти библиотеки все

много важных и нужных графиков должны быть с параметрами и фильтрами, что будет точно работать

новости не подружаются все пусто, короче система просто не работает, надо будет сделать полностью рабочую систему полнлостью прям

про красивый скелетон слева направо и с анимацией не забудь и везде добавь websoket где надо, даже баланс чтобы через него отображался думаю, короче все

выбор валюты тоже не нужен в header menu

короче надеюсь ты меня понял, что надо полностью переделать систему, от и до, чтобы она стала работать нормально и безотказно, я даже не знаю, что там происходит под капотом (в том смысле, что если во фронте все так, то там еще хуже), надо будет и его исправить

мне надо чтобы ты представил себя как команду опытных разработчиков с опытом работы как минмум 20 лет в bloomberg и в NewYork StockExchange, с пониманием полностью системы и как разрабатывать системы такого уровня, чтобы как под капотом так и во фронте чтобы все работало прям идеально, чтобы мне не на, что было нарекаться

также на странице входа надо в правой части написать другой текст не связанный конкретно к XAUSD и другим, там должно быть более лучшая информация

короче всю систему надо собирать заново, прям все, по одному прям проходить и сделать так, чтобы все заработало, тщательно

---
### Attached Files & Earlier Conversation Context (Quoted for the Team)

Attached files from the user's latest message:
- `/home/antigravity/image.png`
- `/home/antigravity/image_2.png`

> **Repositories & Production Environment:**
> - Primary monorepo: `/home/antigravity/Huseynovlar/huseynovlar-terminal` (`Huseynovlar/huseynovlar-terminal` on GitHub — push to `main` automatically triggers `.github/workflows/deploy-production.yml` over NetBird VPN `https://vpn.huseynovlar.org` to `deploy-bot@100.104.116.58`, running `/usr/local/bin/huseynovlar-terminal-deploy`).
> - Secondary alerts bot repo: `/home/antigravity/Huseynovlar/server_telegram_bot` (`Huseynovlar/server_telegram_bot`, has `POST /internal/webhooks/trading` guarded by `TRADING_WEBHOOK_SECRET`).
> - Live production URL (NetBird VPN only, `100.104.0.0/16`, Caddy Cloudflare DNS-01 TLS -> `127.0.0.1:18443`): `https://terminal.huseynovlar.org`.
> - Living Roadmap & Architecture docs in repo:
>   - `/home/antigravity/Huseynovlar/huseynovlar-terminal/docs/ROADMAP_TODO.md`
>   - `/home/antigravity/Huseynovlar/huseynovlar-terminal/docs/ARCHITECTURE.md`
> - Artifacts directory: `/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p_devbox/27cefa70-23c2-4840-8260-b53b7c3ef106/`
> - Real MT5 Docker containers running on the user's VPS (`sudo docker ps`):
>   - `mt5-xau` (`mt5-exness:rdp`, Up 25 hours)
>   - `mt5-ustec` (`mt5-exness:rdp`, Up 25 hours)
> - Key technical context on issues the user encountered:
>   1. User also requested `/plan` (thorough planning before execution) and communicates in **Russian** (concise GitHub markdown, clickable `file://` links, safe self-contained `sudo bash << 'SCRIPT'` blocks for any VPS commands).
>   2. WebAuthn `navigator.credentials.create` threw `TypeError` because `webauthn_register_options` returns JSON strings for `challenge` and `user.id` instead of converting base64url strings into `Uint8Array` / `ArrayBuffer` on the client (and `credential` response needs proper JSON serialization back).
>   3. Direct browser links (`bridge.set`, `statement.csv`, `.mq5` downloads) failed with `{"detail":"Authentication required"}` because `api-client.ts` only kept `access_token` in `sessionStorage` + `Authorization: Bearer`, while direct `<a href>` / browser downloads only send cookies (`ht_refresh_token` had `path="/api/v1/auth"` instead of an HttpOnly access/session cookie valid across `/api/v1`, or signed download tokens / `fetch` blob downloads). Also check why `Invalid or expired token` occurred on container actions.
>   4. MT5 WebRequest URL validation & `err=4014`: MetaTrader 5's Tools -> Options -> Expert Advisors WebRequest dialog rejects hostnames without a dot (`http://terminal-backend:8000` is rejected by MT5 UI validation — it requires a domain with a dot like `https://terminal.huseynovlar.org` or a dotted alias on the Docker network e.g. `http://ingest.terminal.local:8000`), and `ERR_FUNCTION_NOT_ALLOWED (4014)` in MQL5 `WebRequest` happens when the exact base URL is not whitelisted in MT5 Options -> Expert Advisors -> Allow WebRequest for listed URL! Also clarify how to run two EAs in MT5 (opening a second chart tab for the same symbol in MT5 so the trading EA stays on Chart 1 and `ExnessPanelBridge` runs on Chart 2, OR integrating `ExnessPanelHook.mqh` into the user's `.mq5` robot shown in the attached screenshot).
>   5. `terminal-worker` container in `deploy/docker-compose.yml` only had `networks: [panel_internal]` (`internal: true`, no internet access!), which prevented `worker` (and `backend` if not on `panel_egress` where needed) from reaching external RSS feeds, Yahoo Finance, and GeoIP! Check `networks` for `backend` and `worker` in `deploy/docker-compose.yml`.
>   6. Exness API keys distinction: Exness Personal Area API keys (Partnership / Internal Transfers) vs Huseynovlar Terminal's internal `X-Account-Api-Key` (`htk_...`) generated by our panel for `ExnessPanelBridge.mq5`. Explain clearly in UI & instructions.
>   7. User wants full CRUD + View pages for every entity (Home dashboard, Asset Hubs & Explorer with logos + news, Accounts CRUD+View, Robots CRUD+View + `.mq5`/`.set` download, Deals/Orders & Transfer Journal View, Market Treemap full-page with rich filters, Deep Analytics & Risk Lab charts with working filters, Calendar, News Wire & Verified Sources Registry, Gemini AI Co-Pilot on its own page, Docker Containers Ops, Separate Profile Edit / Security & 2FA & Passkeys / Active Sessions / Login History with IP Geo Map / Users Management / System & Layout Preferences `tangerine` + `floating` sidebar persisted on the server), shimmer skeletons left-to-right, right-side toast notifications, full `RU/EN/AZ` i18n working everywhere, real-time WebSocket updates everywhere (including balances & 1-second clock), sound test feedback when toggling sound, and zero fake/demo data anywhere.

## Follow-up — 2026-11-24T21:04:35Z
URGENT USER UPDATE (conserve token/compute budget & wrap up inspection quickly!):

1. **Speed & Resource Limit:** The user explicitly said they have limited resources/quota ("у меня не так уж и много ресурсов и лимита, чтобы делать работу, надо сохранять лимит ))") — please finish the audit/planning phase FAST, avoid spawning excessive subagents or burning tokens on redundant exploration, and consolidate execution efficiently!
2. **Additional Mandatory Fixes to include right away:**
   - **Beautiful UI Dialogs / Modals (`AlertDialog` / `Dialog` from shadcn/ui):** Replace ALL native browser `window.confirm` / `window.prompt` / `alert` calls across the entire app with clean, styled shadcn modal dialogs.
   - **Proper Session Deletion on Logout:** When logging out (`/auth/logout`), the active `UserSession` in PostgreSQL MUST be deleted/revoked reliably (even if cookie path differed or access token was used — pass/read both Bearer token `sid` / user session AND refresh cookie with consistent cookie `path="/"` or `/api/v1` so the session disappears from Active Sessions immediately on logout).
   - **Session Lifetime & Smooth Auto-Refresh + Instant Redirect inside Terminal:** Currently the access token expires very quickly (~15 min) and `apiRequest` in `frontend/src/framework/api-client.ts` does NOT automatically call `/auth/refresh` on `401 Unauthorized` nor redirect cleanly to `/auth/v2/login` when refresh expires! Fix both:
     - Increase access token lifetime reasonably (or silently auto-refresh via `/auth/refresh` inside `apiRequest` on `401` and retry the failed request seamlessly without interrupting the user);
     - If refresh token is expired/revoked/missing, clear auth state and immediately redirect to `/auth/v2/login` cleanly from anywhere inside the terminal (so buttons never silently fail with `Invalid or expired token`).

Please report current status and deliver the concise plan / next action immediately!

## Follow-up — 2026-11-25T05:48:27Z
у тебя был запущен teamwork, мне над чтобы ты продолжил с ним
продолжи, но мне надо чтобы результат наконец-то был

---
### Earlier Conversation & Previous Teamwork State Context (Quoted for the Team)

> **CRITICAL RESUME CONTEXT (DO NOT RE-AUDIT FROM SCRATCH — CONSERVE QUOTA!):**
> - A previous `teamwork` session had **already completed the full codebase audit and architecture/execution plan**, saving its state on disk:
>   - Architecture & Wave Plan: `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md`
>   - Recorded Request & Directives: `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` (and any other files in `/home/antigravity/.agents/teamwork/`)
> - That previous `teamwork` session hit a quota/environment restart right as **Wave 1** began (`git status` in `/home/antigravity/Huseynovlar/huseynovlar-terminal` shows `?? PROJECT.md` and clean tracked files; `/home/antigravity/Huseynovlar/server_telegram_bot` is clean).
> - **User's strict resource constraint:** "у меня не так уж и много ресурсов и лимита, чтобы делать работу, надо сохранять лимит ))" — resume directly from `PROJECT.md` and `.agents/teamwork/`, minimize subagent overhead, execute Wave 1 -> Wave 2 -> Victory Audit + `git commit` & `git push origin main` (which auto-deploys to `https://terminal.huseynovlar.org` via GitHub Actions NetBird SSH) so the user gets a 100% working production result!
>
> **Summary of All Mandatory User Requirements (also in `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` and `PROJECT.md`):**
> 1. **Infra, Docker, MQL5 & Telegram Bot (`M1`):**
>    - Give `backend` and `worker` outbound internet (`panel_egress` + DNS) + `CONFIG_DIR=/app/config` in `deploy/docker-compose.yml` so RSS news, Verified Sources Registry, Yahoo Finance live quotes/treemap/explorer, and GeoIP work.
>    - Add dotted Docker network alias `ingest.terminal.local` (`http://ingest.terminal.local:8000`) on `exness_mt5_ingest` so MT5 WebRequest UI accepts the URL and fixes `err=4014`.
>    - Update `ExnessPanelBridge.mq5` / `ExnessPanelHook.mqh` + instructions on running alongside an existing trading EA on `mt5-xau` and `mt5-ustec`.
>    - Allow `/internal/webhooks/trading` in `DEFAULT_AUTH_SKIP_PATHS` in `/home/antigravity/Huseynovlar/server_telegram_bot` if needed.
>    - Support `/etc/huseynovlar-terminal/integrations.env` for Gemini API key and Telegram Alerts Webhook URL/Secret (remove unused `chat_id` and `bot_token` from UI).
> 2. **Auth, Sessions, Passkeys, Downloads & Dialogs (`M2` + `M4`):**
>    - Fix WebAuthn Passkeys (`TypeError` — convert base64url `challenge` / `user.id` / `excludeCredentials` to `ArrayBuffer` on client and serialize `PublicKeyCredential` properly).
>    - Fix session deletion on Logout (`/api/v1/auth/logout` must reliably revoke/delete `UserSession` in PostgreSQL via both Bearer token `sid` and refresh cookie with consistent cookie path).
>    - Extend token TTL + add silent `401 -> /api/v1/auth/refresh -> retry` in `frontend/src/framework/api-client.ts`, with immediate clean redirect to `/auth/v2/login` when session is expired/revoked (fixes `Invalid or expired token` on `mt5-xau`/`mt5-ustec` container buttons and everywhere inside terminal).
>    - Make `.set`, `.csv`/Excel, and `.mq5` file downloads work even in incognito / direct links (HttpOnly access cookie on `/api/v1` and/or signed download tokens).
>    - Replace ALL native `window.confirm` / `window.prompt` / `alert` with styled shadcn `AlertDialog` / `Dialog` modals.
> 3. **UI/UX, Theme, Header, Sidebar & i18n (`M4`):**
>    - Default theme preset `tangerine`, sidebar style `floating`, density `bloomberg` only (remove density switcher), allow changing theme/font/layout in Settings, and persist all settings (including chart settings and `RU/EN/AZ` language) on the server (`/api/v1/profile/preferences`).
>    - Reactive `RU/EN/AZ` i18n working across the entire UI.
>    - Redesign Header (remove currency selector, move smooth 1-second UTC clock next to profile, remove user block from sidebar footer, move Lock/Login screen link to top profile menu, show live WebSocket status clearly, play test sound effect when enabling sound).
>    - Update Login split-screen right panel copy (institutional multi-asset text, not tied to XAUUSD).
>    - Left-to-right animated shimmer skeletons everywhere, loading spinners + text on Save/Auth buttons, right-side toast notifications on save/actions, real-time WebSocket updates (including balances).
>    - Purge all remaining template demo pages/data.
> 4. **Dedicated Full CRUD + Detailed View Pages (`M3` + `M5`):**
>    - Separate dedicated pages (no clutter) with Create / View / Edit / Delete + Detailed View for everything:
>      - Home Dashboard;
>      - Accounts CRUD + View (clarify Exness Personal Area API keys vs internal Bridge key);
>      - Robots dedicated page: CRUD + View + `.mq5` & `.set` downloads;
>      - Asset Hubs (with real news summary) & Asset Search/Explorer (with asset/stock/index logos + filtered news on the same screen);
>      - Large full-screen Market Map (Treemap) with working universe/period/sector filters & live data (`S&P 500`, `NASDAQ-100`, `Gold & Commodities`);
>      - Deep Analytics & Risk Lab with working filters & charts;
>      - Deals & Transfers Journal (including internal transfers / deposits / withdrawals) + Order View;
>      - Working Economic Calendar;
>      - News Wire (filtered by added assets or search) + populated Verified Sources Registry with `✓` checkmarks;
>      - Separate Google AI (Gemini) Co-Pilot page;
>      - Separate pages for: Edit Profile, Security (Password Change + 2FA QR + Passkeys), Active Sessions, Login History (with View + IP Geo Map), Users Management, System Settings & `/etc` Integrations, MT5 Docker Containers (`mt5-xau`, `mt5-ustec`).
> 5. **Final Delivery (`M6`):**
>    - Run backend `ruff` + `pytest` and frontend `npm run build`, commit & push to `main`, update `docs/ROADMAP_TODO.md`, and provide clear Russian instructions on what keys to obtain where and how to connect MT5 + two EAs.
>    - Attached user screenshots from earlier are at `/home/antigravity/image.png` and `/home/antigravity/image_2.png`.

## Follow-up — 2026-11-25T05:57:20Z
USER REQUIREMENT — PERSIST ALL TEAMWORK STATE FILES TO GITHUB REPO (`Huseynovlar/huseynovlar-terminal`):

The user requested:
"мне надо чтобы на github также был сохранен все файлы teamwork чтобы я там если что смог передать и другому чату, когда лимит тут завершится, чтобы он продолжил"

Action required immediately and after each completed wave / milestone:
1. Ensure ALL teamwork state & planning files (`PROJECT.md`, `.agents/teamwork/**`, or a mirrored `.teamwork/` / `.agents/teamwork/` directory inside `/home/antigravity/Huseynovlar/huseynovlar-terminal/` — NOT ignored by `.gitignore`, and scrubbed of any secrets) are synced into the git repository `/home/antigravity/Huseynovlar/huseynovlar-terminal`.
2. Commit and push `PROJECT.md` + `.agents/teamwork/` (all `ORIGINAL_REQUEST.md`, `SCOPE.md`, `BRIEFING.md`, `progress.md`, survey reports, wave checklists) to `Huseynovlar/huseynovlar-terminal` on GitHub **after Wave 1 AND after Wave 2 / M6** (and right away for the current planning/state files if safe without triggering a broken half-built deploy — e.g., commit `.agents/teamwork` + `PROJECT.md` when code is in a buildable state or on each wave commit) so that if quota runs out at any moment, another chat cloning `Huseynovlar/huseynovlar-terminal` from GitHub has 100% of the teamwork files and progress to resume seamlessly!

## Follow-up — 2026-11-25T06:02:16Z
USER IS ASKING: "когда он уже наконец-то начнет редактировать файлы и все добавлять ?"

Stop writing extra planning/scope markdowns if Wave 1 hasn't started editing repo files yet — ensure the Wave 1 workers (`M1`, `M2`, `M4`) are actively modifying the actual codebase files (`deploy/`, `backend/`, `frontend/`, `mql5/`) RIGHT NOW, and sync `.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/`. Report exact active subagents and which repo files are being edited!

## Follow-up — 2026-11-25T10:52:03Z
Первым делом залей на github, что уже сделано по агентам

и уже наконец-то быстро дай мне результат всех исправлений

---
### Critical Resume & Quota-Safe Execution Context (Quoted from Earlier Conversation)

> **STEP 0 (DO THIS FIRST BEFORE ANYTHING ELSE!):**
> 1. Immediately inspect `git status` in `/home/antigravity/Huseynovlar/huseynovlar-terminal` and `/home/antigravity/Huseynovlar/server_telegram_bot`, plus `/home/antigravity/.agents/teamwork/`.
> 2. Sync `/home/antigravity/.agents/teamwork/` into `/home/antigravity/Huseynovlar/huseynovlar-terminal/.agents/teamwork/` (ensure no secrets and not gitignored) alongside `PROJECT.md` (and any already-completed clean code changes from the previous interrupted Wave 1 run).
> 3. **Commit and push** `PROJECT.md` + `.agents/teamwork/` (and any verified clean changes) to GitHub (`Huseynovlar/huseynovlar-terminal` `origin main`) **FIRST THING** so the user's teamwork state is safely backed up on GitHub right now! (Also push `server_telegram_bot` if it has clean changes.)
>
> **CRITICAL QUOTA / RATE-LIMIT GUARD (WHY PREVIOUS TWO RUNS STOPPED):**
> - Both previous teamwork runs hit `generic::resource_exhausted: Individual quota reached` because spawning 4+ concurrent sub-orchestrators + parallel workers simultaneously spiked the user's quota/rate limit!
> - **To guarantee you finish and deliver the actual result without hitting quota again:**
>   - **DO NOT re-audit or rewrite `PROJECT.md` / `SCOPE.md`** — `PROJECT.md` (`F01`–`F36`) and `.agents/teamwork/` are already complete on disk!
>   - **Keep parallelism VERY LOW (max 1–2 workers at a time, or direct sequential execution per module)** and skip verbose intermediate markdowns/cron bloat.
>   - Focus straight on **modifying the actual codebase files** (`M1` -> `M2` -> `M3` -> `M4` -> `M5` -> `M6`), verifying with `ruff` + `pytest` + `npm run build`, syncing `.agents/teamwork/` after each milestone, and pushing working commits to `Huseynovlar/huseynovlar-terminal` `main` (which auto-deploys to `https://terminal.huseynovlar.org`).
>
> **Repositories & Live Environment:**
> - Primary repo: `/home/antigravity/Huseynovlar/huseynovlar-terminal` (`Huseynovlar/huseynovlar-terminal`)
> - Alerts bot repo: `/home/antigravity/Huseynovlar/server_telegram_bot` (`Huseynovlar/server_telegram_bot`)
> - Live URL: `https://terminal.huseynovlar.org` (NetBird `100.104.116.58`, Caddy -> `127.0.0.1:18443`)
> - Real MT5 Docker containers on VPS: `mt5-xau` and `mt5-ustec` (`mt5-exness:rdp`)
> - Full 36-point specification is already in `/home/antigravity/Huseynovlar/huseynovlar-terminal/PROJECT.md` and `/home/antigravity/.agents/teamwork/ORIGINAL_REQUEST.md` (including `AlertDialog`/`Dialog` replacing native `confirm`/`prompt`/`alert`, proper session deletion on `/auth/logout`, extended token TTL + silent `401 -> /auth/refresh` + redirect to `/auth/v2/login`, WebAuthn Passkey `TypeError` fix, `ingest.terminal.local:8000` MT5 dotted alias fixing `err=4014`, `panel_egress` + `CONFIG_DIR=/app/config` for `backend`/`worker`, `tangerine` + `floating` + `bloomberg`, reactive `RU/EN/AZ`, right-side toasts, shimmer skeletons, button loaders, full CRUD+View pages, live Treemap/Calendar/News/Verified Sources/Logos, separate Gemini AI page, `/etc` integrations, and final Russian guide on keys + connecting 2 MT5 EAs).
