# M1 Explorer 3 Handoff — MQL5 Dual-EA Bridge & Ingest Contracts

## 1. Backward-Compatible `.set` Input Parameters (`ExnessPanelBridge.mq5:17-24`, `ops/router.py:351-358`)
Keep exact `input` identifiers/types; ONLY update `ApiBaseUrl` default:
- `input string ApiBaseUrl = "http://ingest.terminal.local:8000/api/v1/ingest";`
- `input string AccountApiKey = "";`, `input string ChartSymbolOverride = "";`
- `input int SnapshotIntervalSec = 5;`, `BarsSyncIntervalSec = 15;`, `InitialHistoryDays = 90;`, `HttpTimeoutMs = 2500;`
- `input bool AllowRemoteClose = false;` (strip trailing `/` on `ApiBaseUrl` before appending `/bootstrap`, `/snapshot`, `/trade-event`, `/bars`).

## 2. Exact Ingest Schemas (`backend/app/modules/ingest/router.py:41-126`)
- Auth header: `X-Account-Api-Key: <AccountApiKey>`.
- `POST /snapshot` (`SnapshotPayload`): `balance`, `equity`, `floating_pnl`, `margin`, `free_margin`, `margin_level`, `algo_trading_enabled`, `terminal_connected`, `ping_ms`, `symbol`, `bid`, `ask`, `spread_pts`, `open_positions` (`OpenPositionItem[]`), `robot_states` (`RobotLiveStateItem[]`).
- `RobotLiveStateItem`: `{"magic_number": int, "status": str (<=64 chars, e.g. "RUNNING"|"OFF_SESSION"|"PAUSED"|"ERROR"), "execution_ms": int, "state_json": dict}` (`state_json` MUST be a valid JSON object `{...}`, never a string; include `"name"`, `"symbol"`, `"timeframe"`, `"source"`, `"telemetry"` inside `state_json`).
- `POST /bootstrap`, `POST /trade-event`, `POST /bars` (`timeframe` regex `^(M1|M5|M15|M30|H1|H4|D1|W1)$`) remain unchanged.

## 3. Lock-Safe IPC (`ExnessPanelHook.mqh` <-> `ExnessPanelBridge.mq5`)
- File path: `ep_ipc\\events_<ACCOUNT_LOGIN>.jsonl`. Escape `\\`, `\"`, `\n`, `\r`, `\t` in both `EP_EscapeJson()` and `EscapeJson()`.
- Hook (`ExnessPanelHook.mqh:25-42`): open `FILE_WRITE|FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE`, `FileSeek(h, 0, SEEK_END)`, write `{"ts_msc":...,"type":"robot_register|robot_state|execution|error","magic":...,"symbol":"...","payload":{...}}\n`, `FileClose(h)`.
- Bridge consumer: if `FileIsExist(path)`, open `FILE_READ|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE`; if `FileSize(h) > 0`, read all lines via `FileReadString(h)`, close, then truncate via `FileOpen(path, FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_SHARE_READ|FILE_SHARE_WRITE)` + immediate `FileClose()`.
- Persist latest per-`magic` state in Bridge arrays (`g_ipcMagics[]`, `g_ipcStatus[]`, `g_ipcExecMs[]`, `g_ipcStateJson[]`) so every `POST /snapshot` sends active robot states even between IPC writes.

## 4. `err=4014` Diagnostic & Sibling-Chart `NasdaqPulse` Scraping (`ExnessPanelBridge.mq5`)
- **`err=4014` (`ERR_FUNCTION_NOT_ALLOWED`)**: in `PostJson()`, capture `int err = GetLastError();`. When `status == -1 && err == 4014`, extract origin `scheme://host[:port]` (substring up to first `/` after `://`) from `ApiBaseUrl` and `PrintFormat` a clear RU+EN message: add exact `<origin>` in `Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL` / `Сервис -> Настройки -> Советники -> Разрешить WebRequest для следующих URL` (throttled e.g. once per 30s to avoid log spam).
- **Chart Discovery & Scraping**: iterate `for(long cid = ChartFirst(); cid >= 0; cid = ChartNext(cid))` skipping `cid == ChartID()`. Read `exp = ChartGetString(cid, CHART_EXPERT_NAME)`; skip `""` or `"ExnessPanelBridge"`.
- Scan `ObjectsTotal(cid, 0, -1)`: for `OBJ_LABEL`, `OBJ_BUTTON`, `OBJ_EDIT`, inspect `ObjectGetString(cid, name, OBJPROP_TEXT)` (trimmed). Capture tokens matching `STATE:`, `Trend:`, `RSI:`, `ER:`, `Risk:`, `Seq:`, `Day:`, `DD:`, `Bal:`, `Work:`, `Bank:`, `ALGO:`, `MKT:` (and split pipe-delimited segments like `Trend: H4+H1 BEAR | RSI: 41.1 | ER: 0.23`).
- Derive `status` (`"PAUSED"` if `ALGO: OFF`, `"OFF_SESSION"` if `STATE: OFF_SESSION`, else `"RUNNING"`). Match `magic_number` from open positions/recent deals on `ChartSymbol(cid)` if non-zero and unique, else deterministic hash `100000 + (MathAbs(StringHash(exp + ":" + ChartSymbol(cid) + ":" + EnumToString(ChartPeriod(cid)))) % 899999)`. Merge with IPC `g_ipcMagics[]` (deduping by `magic_number`, IPC taking precedence on `magic` match while enriching `telemetry`) into `"robot_states":[...]` in `POST /snapshot`.
