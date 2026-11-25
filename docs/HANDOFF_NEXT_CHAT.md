# HANDOFF — продолжение в новом чате

> Вставь в новый чат: «Прочитай `docs/HANDOFF_NEXT_CHAT.md`, `PROJECT.md`, `.agents/teamwork/ORIGINAL_REQUEST.md` в репо Huseynovlar/huseynovlar-terminal и продолжи с раздела "Осталось". Экономь лимит: максимум 1 воркер за раз, коммить после каждой волны.»

## Состояние (2026-11-25)
- База в проде: `acca678` (M1–M6, F01–F36).
- Коммит WIP `[skip ci]` (этот): бэкенд-волна по 42 пунктам, **не задеплоено**, фронт ещё не начат.
  - Новое: `backend/app/core/{audit_events,market_data,pagination}.py`, `backend/app/modules/files/` (приватные файлы/аватары), изменения в auth/profile/wiki/users/audit/charts/intelligence/analytics/accounts/ops, `setup-vps-integrations.sh`, i18n.
  - `ruff check` — OK. `pytest` не прогнан (в VM нет httpx: `pip install -r backend/requirements.txt` сначала).
- VPS: `/opt/huseynovlar-terminal/.env` (терминал), `/opt/huseynovlar-bot/.env` (бот, `TRADING_WEBHOOK_SECRET`).
- `server_telegram_bot`: деплой падает — протух секрет `NETBIRD_SETUP_KEY` в GitHub Secrets репо бота → обновить.

## 42 пункта (статус: B = бэкенд сделан в WIP, ? = проверить, — = не начато)
| # | Задача | Статус |
|---|---|---|
| 1 | Логин: убрать `owner` по умолчанию | — |
| 2 | Логин: справа скриншот терминала | — |
| 3 | Палитра: банковский синий (navy/royal) | — |
| 4 | Хоткеи: 2 равные колонки | — |
| 5 | Сайдбар: активный пункт на view/edit/new | — |
| 6 | Шрифт: IBM Plex Sans/Mono, tabular-nums | — |
| 7 | Тикер `slow` ещё медленнее | — |
| 8 | Убрать время из тикера | — |
| 9 | Перестановка пунктов меню (сохранять на сервере) | — |
| 10 | Отчёт по ROADMAP_TODO | см. ниже |
| 11 | Все CRUD-списки: первая колонка ID, кликабельна | — |
| 12 | Аудит: перевод ключей событий RU/EN/AZ | B (`audit_events.py`) + фронт — |
| 13 | Аудит detail: широкий информативный вид | — |
| 14 | История входов: карта + тёмные тайлы | — |
| 15 | Пагинация во всех списках | B (`pagination.py`), фронт — |
| 16 | Активные сессии: карта + перекрёстные ссылки | ? |
| 17 | Passkey: `undefined is not an object (e.user)` | ? |
| 18 | 2FA QR обрезан наполовину | — |
| 19 | Настройки темы сбрасываются после перезагрузки | ? |
| 20 | Смена пароля требует TOTP при 2FA | B |
| 21 | Аватар: загрузка файлов, `/api/v1/files/{id}` с auth | B, фронт — |
| 22 | Политика сильных паролей | B (`security.py`), фронт — |
| 23 | Все `<select>` → свой combobox с поиском | — |
| 24 | RBAC user view: `last_login_at` | B, фронт — |
| 25 | Wiki: категории CRUD + авто-slug | B, фронт — |
| 26 | Контейнеры: статус + команда подключения к `exness_mt5_ingest` | ? |
| 27 | Новости: пагинация, полный поток | B?, фронт — |
| 28 | Yahoo 429: кэш + фолбеки (Stooq/Binance/Frankfurter) | B (`market_data.py`) |
| 29 | Treemap 0% | B? |
| 30 | Пакет иконок активов на сервере | — |
| 31 | Explorer: каталог сначала + поиск | — |
| 32 | Asset Hub: несколько счетов, новости, AI, роботы | — |
| 33 | Откуда Treasury/Transfers | см. ниже |
| 34 | Нужен ли ExnessPanelHook.mqh | см. ниже |
| 35 | Live Charts + Hubs → единый Asset Hub | — |
| 36 | Падение главной `/dashboard` | ? |
| 37 | API key Exness vs Bridge key | см. ниже |
| 38 | WebSocket live для графиков | — |
| 39 | Без мерцания при обновлении | — |
| 40 | Webhook-секрет Telegram на VPS | см. ниже |
| 41 | Путь интеграций `/opt/huseynovlar-terminal/.env` | B (скрипт) |
| 42 | Журнал сделок пуст | ? |
| 43 (новое) | Авто-перевод излишка при балансе ≥ 29 000 на резервный счёт | — (см. ниже) |
| 44 (новое) | Новый ExnessPanelHook по 4 правилам | — (см. ниже) |

## Ответы владельцу
**#10 ROADMAP:** F01–F36 закрыты в `acca678`. Новый список (42+2) — в таблице выше; бэклог v3 (мульти-брокер, бюджет токенов Gemini, SMTP, Stream Deck) не начат.

**#33 Treasury/Transfers:** берётся из MT5 через бридж — сделки `DEAL_TYPE_BALANCE` (депозит/вывод/внутренний перевод) из `HistoryDealsSelect`, плюс ручные записи в Treasury. Exness API для этого не требуется.

**#34 ExnessPanelHook.mqh:** не обязателен. Бридж сам видит счёт, сделки, позиции и соседних советников. Hook нужен только для внутреннего состояния робота (state/wait/rsi/…, тайминги исполнения). Требования — п. 44.

**#37 Ключи:** `htk_...` (ключ моста) обязателен — им `ExnessPanelBridge` авторизуется в `/api/v1/ingest`, вся история (сделки, позиции, балансы) идёт через мост. API Exness Personal Area опционален (переводы между счетами и данные ЛК, см. п. 43).

**#40 Webhook Telegram (VPS):**
```bash
sudo bash << 'SCRIPT'
set -e
S=$(grep -E '^TRADING_WEBHOOK_SECRET=' /opt/huseynovlar-bot/.env | cut -d= -f2-)
[ -z "$S" ] && S=$(openssl rand -hex 32) && echo "TRADING_WEBHOOK_SECRET=$S" >> /opt/huseynovlar-bot/.env
F=/opt/huseynovlar-terminal/.env
sed -i '/^TELEGRAM_WEBHOOK_SECRET=/d;/^TELEGRAM_WEBHOOK_URL=/d' $F
echo "TELEGRAM_WEBHOOK_SECRET=$S" >> $F
echo "TELEGRAM_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading" >> $F
cd /opt/huseynovlar-terminal && docker compose -f deploy/docker-compose.yml up -d backend worker
echo OK
SCRIPT
```
(Бот тоже перезапустить, если секрет только что создан: `cd /opt/huseynovlar-bot && docker compose up -d`.) Сеть терминала должна видеть `huseynovlar-core`.

**#41:** все интеграции читаются из `/opt/huseynovlar-terminal/.env`; `/etc/...` больше не используется.

## П. 43 — правило «29 000» (спроектировать)
- Настройка на счёт: `cap_balance` (по умолчанию 29 000), `reserve_account_id`, `mode` = `alert` | `auto`.
- Воркер: если `balance - открытая маржа/плавающий PnL ≥ cap` и нет открытых позиций (или свободная маржа достаточна) → перевод излишка `balance - cap` на резервный счёт через Exness PA API (internal transfer), запись в Treasury + аудит + уведомление в Telegram.
- Цель: рабочий счёт не растёт выше лимита (риск/лот не раздувается), прибыль накапливается на резерве. Сначала режим `alert` с кнопкой «Перевести» и подтверждением, потом `auto`.
- Нужно уточнить: точный эндпоинт перевода в Exness PA API и права ключа.

## П. 44 — требования к новому ExnessPanelHook.mqh (от владельца)
1. В тестере ничего не пишем: `if(MQLInfoInteger(MQL_TESTER)) return;` прямо внутри `EP_WriteIpcEvent`.
2. `robot_state` пакетом: только при изменении (`lastStateJson`) или смене STATE/Wait/Pos, либо не чаще раза в 5–10 с из `OnTimer()` (не из `OnTick()`). В одном JSON: state, wait, trend, rsi, er, vwap_z, atr_pct, spread, risk_pct, lot, bal, work, bank, day_pnl, dd_pct, seq, pos, trades, mem_status.
3. Исполнение: в `ExecuteSlicedOrder` замерять `GetTickCount64()` до/после `OrderSend()`, результаты в буфер, а `EP_ReportExecution()/EP_ReportError()` вызывать после цикла слайсов.
4. `ExnessPanelBridge.mq5`: читать `events_<login>.jsonl` с сохранённым смещением (`FileSeek`), раз в сутки архивировать/обрезать файл.
- Владелец пришлёт код робота: встраивать hook с этими правилами, бэкенд `ingest` должен принимать новые поля `robot_state`.

## Порядок работ дальше (экономно)
1. `pip install -r backend/requirements.txt`, `pytest backend/tests -q`, починить.
2. Фронт волна A: 1–9, 11, 13, 18, 23 (UI/тема/шрифт/сайдбар/селекты).
3. Фронт волна B: 12, 14–17, 19–22, 24, 25, 27 (безопасность/CRUD).
4. Волна C: 26, 28–32, 35, 36, 38, 39, 42 (рынки/Asset Hub/WS).
5. Волна D: 43, 44 + бридж.
6. `tsc --noEmit`, `npm test`, `npm run build`, push в `main` без `[skip ci]` → деплой.
