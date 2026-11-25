# Инструкция: Ключи интеграций, настройка VPS и подключение 2 советников в MT5

Краткое практическое руководство по настройке ключей в `/opt/huseynovlar-terminal/.env`, запуску стека на VPS и подключению `ExnessPanelBridge.mq5` рядом с торговыми роботами в контейнерах `mt5-xau` и `mt5-ustec` (с решением ошибки `err=4014`).

---

## 1. Какие ключи нужны, где их получить и куда добавить

### 1.1. Google AI (Gemini) — для AI Co-Pilot (`/dashboard/ai`)
- **Переменная:** `GEMINI_API_KEY` (опционально `GEMINI_DEFAULT_MODEL=gemini-3.8-flash`)
- **Где получить:** [Google AI Studio — API Keys](https://aistudio.google.com/apikey) → кнопка **Create API key**.
- **Куда добавить:** в файл `/opt/huseynovlar-terminal/.env` на VPS (см. скрипт в разделе 2). В интерфейсе панели вводить ключ не нужно — он подхватывается автоматически с хоста и отображается в статусе `/dashboard/setup`.

### 1.2. Telegram-уведомления — через ваш `server_telegram_bot`
- **Переменные в `/opt/huseynovlar-terminal/.env`:**
  - `TELEGRAM_WEBHOOK_URL=http://huseynovlar-core:8080/internal/webhooks/trading`
  - `TELEGRAM_WEBHOOK_SECRET=<ваш_секрет>`
- **Важно:** значение `TELEGRAM_WEBHOOK_SECRET` **должно в точности совпадать** с переменной `TRADING_WEBHOOK_SECRET` в `.env` вашего `server_telegram_bot` (`/opt/huseynovlar-bot/.env`).
- **Почему `telegram_bot_token` и `telegram_chat_id` НЕ нужны в терминале:** панель не ходит в Telegram API напрямую и не хранит токен бота. Она отправляет защищённый webhook-запрос (`X-Trading-Webhook-Secret`) в локальный контейнер `huseynovlar-core`, а уже `server_telegram_bot` сам доставляет `[TRADING]`-алерты нужным пользователям.

### 1.3. Ключ моста `AccountApiKey` (`htk_...`) vs API-ключ личного кабинета Exness
- **`AccountApiKey` (`htk_...`)** — это **внутренний ключ самой панели Huseynovlar Terminal**. Он генерируется **автоматически** при создании торгового счёта в `/dashboard/accounts/new` (и при ротации ключа), хранится в зашифрованном виде (`api_key_enc`) и **автоматически подставляется** в скачиваемый файл `bridge.set`.
- **API-ключ личного кабинета Exness (Partnership / Internal Transfers)** — **НЕ обязателен** для работы MT5-терминала, графиков, роботов, сделок и аналитики. Все данные по счетам MT5 поступают напрямую от `ExnessPanelBridge.mq5` по ключу `htk_...`.

---

## 2. Готовый скрипт для VPS (`/opt/huseynovlar-terminal/.env` + Docker-сети + перезапуск)

Выполните на VPS один самодостаточный блок (замените `PASTE_YOUR_GEMINI_API_KEY` на ваш ключ из Google AI Studio; если `TELEGRAM_WEBHOOK_SECRET` уже задан в `/opt/huseynovlar-bot/.env`, скрипт автоматически считает его оттуда, либо сгенерирует новый):

```bash
sudo bash << 'SCRIPT'
set -euo pipefail

TERMINAL_DIR="/opt/huseynovlar-terminal"
ENV_FILE="${TERMINAL_DIR}/.env"
BOT_DIR="/opt/huseynovlar-bot"

# 1. Вставьте ваш ключ Google AI Studio (или оставьте пустым, чтобы заполнить позже)
GEMINI_KEY="${GEMINI_KEY:-PASTE_YOUR_GEMINI_API_KEY}"
if [[ "$GEMINI_KEY" == "PASTE_YOUR_GEMINI_API_KEY" ]]; then
  GEMINI_KEY=""
fi

# 2. Считываем TRADING_WEBHOOK_SECRET из server_telegram_bot (или генерируем новый)
WEBHOOK_SECRET=""
if [[ -f "${BOT_DIR}/.env" ]]; then
  WEBHOOK_SECRET="$(grep -E '^TRADING_WEBHOOK_SECRET=' "${BOT_DIR}/.env" | tail -n1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)"
fi
if [[ -z "$WEBHOOK_SECRET" ]]; then
  WEBHOOK_SECRET="$(openssl rand -hex 32)"
  echo "[!] Сгенерирован новый TELEGRAM_WEBHOOK_SECRET — добавьте его в ${BOT_DIR}/.env как TRADING_WEBHOOK_SECRET=${WEBHOOK_SECRET}"
fi

# 3. Добавляем недостающие ключи в /opt/huseynovlar-terminal/.env (существующие значения не затираются)
touch "$ENV_FILE"
set_kv() {  # set_kv KEY VALUE: заменить значение, если KEY уже есть, иначе дописать
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV_FILE"; then
    if [[ -n "$v" ]]; then sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"; fi
  else
    echo "${k}=${v}" >> "$ENV_FILE"
  fi
}
set_kv GEMINI_API_KEY "$GEMINI_KEY"
set_kv GEMINI_DEFAULT_MODEL gemini-3.8-flash
set_kv TELEGRAM_WEBHOOK_URL http://huseynovlar-core:8080/internal/webhooks/trading
set_kv TELEGRAM_WEBHOOK_SECRET "$WEBHOOK_SECRET"
chmod 640 "$ENV_FILE"
echo "[OK] Обновлён ${ENV_FILE} (chmod 640)"

# 4. Проверяем/создаём внутренние Docker-сети и подключаем mt5-xau и mt5-ustec
docker network inspect exness_mt5_ingest >/dev/null 2>&1 || docker network create exness_mt5_ingest --internal
docker network inspect huseynovlar_webhooks >/dev/null 2>&1 || docker network create huseynovlar_webhooks --internal

for c in mt5-xau mt5-ustec; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    docker network connect exness_mt5_ingest "$c" 2>/dev/null || true
    echo "[OK] Контейнер ${c} подключён к сети exness_mt5_ingest"
  else
    echo "[WARN] Контейнер ${c} не найден на этом хосте"
  fi
done

# 5. Перезапускаем стек Huseynovlar Terminal
cd "$TERMINAL_DIR"
docker compose -p huseynovlar-terminal --env-file "${TERMINAL_DIR}/.env" -f deploy/docker-compose.yml up -d --force-recreate backend worker

# 6. Проверяем сетевой алиас ingest.terminal.local внутри exness_mt5_ingest
echo "[CHECK] Участники сети exness_mt5_ingest:"
docker network inspect exness_mt5_ingest --format '{{range .Containers}} - {{.Name}} ({{.IPv4Address}}){{"\n"}}{{end}}'
SCRIPT
```

После запуска откройте в терминале **`/dashboard/setup`** и нажмите **«Проверить Telegram»** и **«Проверить Gemini»** — оба индикатора должны стать зелёными.

---

## 3. Пошаговое подключение 2 советников в MT5 (`mt5-xau` и `mt5-ustec`) и исправление `err=4014`

### Шаг 1. Исправляем ошибку `err=4014` (`ERR_FUNCTION_NOT_ALLOWED`)
Ошибка `POST /snapshot failed: HTTP -1 (err=4014)` возникает, когда базовый URL не добавлен в белый список WebRequest внутри MT5.

> **Почему не работал `http://terminal-backend:8000`:** встроенная валидация диалога WebRequest в MetaTrader 5 **отклоняет хосты без точки** (`terminal-backend`). Поэтому в `deploy/docker-compose.yml` для `terminal-backend` добавлен сетевой алиас с точкой: **`http://ingest.terminal.local:8000`**.

В каждом терминале MT5 (`mt5-xau` и `mt5-ustec`):
1. Откройте меню **`Сервис → Настройки → Советники`** (`Tools → Options → Expert Advisors`).
2. Поставьте галочку **`Разрешить алгоритмическую торговлю`**.
3. Поставьте галочку **`Разрешить WebRequest для следующих URL:`** и добавьте:
   - `http://ingest.terminal.local:8000` *(рекомендуемый внутренний Docker-канал `< 1 мс`, без выхода в интернет)*
   - `https://terminal.huseynovlar.org` *(опционально, если подключаете MT5 снаружи через NetBird)*
4. Нажмите **OK**.

---

### Шаг 2. Как запустить торговый робот и мост одновременно в одном MT5

В MetaTrader 5 на **одну вкладку графика** можно повесить только **один** советник (`.ex5`), но в одном терминале можно открыть **сколько угодно вкладок одного и того же символа**.

#### Способ 1 (рекомендуемый — без единой правки вашего торгового робота)
1. **Вкладка графика №1** (например, `USTECc, M5` или `XAUUSDc, M5`):
   - На ней **как обычно продолжает работать ваш торговый робот** (`NasdaqPulse` / XAU EA). Ничего менять в нём не нужно.
2. **Вкладка графика №2** (откройте второй график того же символа: `Файл → Новый график → USTECc` или `XAUUSDc`):
   - Скачайте из `/dashboard/setup` (или `/dashboard/robots`) файлы **`ExnessPanelBridge.mq5`** и персональный **`bridge.set`** для нужного счёта.
   - Поместите `ExnessPanelBridge.mq5` в `MQL5/Experts/`, скомпилируйте в MetaEditor (`F7`).
   - Перетащите **`ExnessPanelBridge`** на **вкладку графика №2**.
   - Во вкладке **Входные параметры** нажмите **Загрузить** и выберите скачанный **`bridge.set`** — поля `ApiBaseUrl=http://ingest.terminal.local:8000/api/v1/ingest` и `AccountApiKey=htk_...` уже заполнены автоматически!
   - Убедитесь, что `AllowRemoteClose = false` (предохранитель Kill-Switch по умолчанию выключен) и нажмите **OK**.
3. **Результат:**
   - Мост работает в отдельном потоке графика №2, **не создаёт задержек** для торгового робота на графике №1, автоматически обнаруживает соседние советники через `ChartFirst() / ChartNext()` и в течение 1–2 секунд появляется в `/dashboard/robots` и `/dashboard/home`.

#### Способ 2 (опционально — расширенная IPC-телеметрия через `ExnessPanelHook.mqh`)
Если вы хотите передавать из собственного `.mq5` робота внутреннее состояние стратегии (режим рынка, пресет, точное время исполнения ордера в мс, внутренние ошибки) с нулевыми сетевыми вызовами (`< 0.05 мс`):
1. Скачайте **`ExnessPanelHook.mqh`** из `/dashboard/setup` и положите в `MQL5/Include/ExnessPanelHook.mqh`.
2. Добавьте в начало вашего торгового `.mq5`:
   ```mql5
   #include <ExnessPanelHook.mqh>
   ```
3. В нужных точках стратегии (`OnInit` / `OnTick` / после сделки) вызывайте хелпер из `ExnessPanelHook.mqh` — он атомарно дописывает JSONL-событие в локальный файл **`MQL5/Files/ep_ipc/events_<login>.jsonl`**.
4. **`ExnessPanelBridge.mq5`** на вкладке графика №2 сам вычитывает `ep_ipc\events_<login>.jsonl` и отправляет обогащённую телеметрию робота в панель.
