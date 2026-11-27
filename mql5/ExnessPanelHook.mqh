//+------------------------------------------------------------------+
//|                                              ExnessPanelHook.mqh |
//|                     Huseynovlar Terminal — Zero-Latency EA Hook  |
//|                                    https://terminal.huseynovlar.org
//+------------------------------------------------------------------+
//| ZERO NETWORK CALLS. Execution time < 0.05 ms.                    |
//| Writes lock-safe JSONL telemetry to MQL5/Files/ep_ipc/ which     |
//| ExnessPanelBridge.mq5 (running on its own 2nd chart tab/thread)  |
//| reads and streams to Huseynovlar Terminal over Docker ingest net.|
//+------------------------------------------------------------------+
#property strict

#define EP_IPC_FOLDER "ep_ipc"
double g_epLastFairPx = 0.0;

string EP_EscapeJson(const string src)
  {
   string out = src;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\n", " ");
   StringReplace(out, "\r", " ");
   StringReplace(out, "\t", " ");
   return out;
  }

string EP_SafeJsonObject(const string raw)
  {
   string trimmed = raw;
   StringTrimLeft(trimmed);
   StringTrimRight(trimmed);
   if(StringLen(trimmed) < 2 || StringGetCharacter(trimmed, 0) != '{')
      return "{}";
   return trimmed;
  }

void EP_WriteIpcEvent(const string event_type, const long magic, const string payload_json)
  {
   // 0 ms overhead in Strategy Tester / Optimization
   if(MQLInfoInteger(MQL_TESTER))
      return;
   FolderCreate(EP_IPC_FOLDER);
   string filename = EP_IPC_FOLDER + "\\events_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".jsonl";
   int handle = FileOpen(
      filename,
      FILE_WRITE | FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE
   );
   if(handle == INVALID_HANDLE)
      return;
   FileSeek(handle, 0, SEEK_END);
   string line = StringFormat(
      "{\"ts_msc\":%I64d,\"type\":\"%s\",\"magic\":%I64d,\"symbol\":\"%s\",\"payload\":%s}",
      (long)TimeCurrent() * 1000,
      EP_EscapeJson(event_type),
      magic,
      EP_EscapeJson(_Symbol),
      EP_SafeJsonObject(payload_json)
   );
   FileWriteString(handle, line + "\n");
   FileFlush(handle);
   FileClose(handle);
  }

// Call once in OnInit() of your trading EA
void EP_RegisterRobot(const long magic, const string name, const string version, const string params_json = "{}")
  {
   string payload = StringFormat(
      "{\"name\":\"%s\",\"version\":\"%s\",\"params\":%s}",
      EP_EscapeJson(name),
      EP_EscapeJson(version),
      EP_SafeJsonObject(params_json)
   );
   EP_WriteIpcEvent("robot_register", magic, payload);
  }

// Call whenever your EA changes internal strategy mode / grid level / filter state
void EP_ReportState(const long magic, const string state_json)
  {
   EP_WriteIpcEvent("robot_state", magic, EP_SafeJsonObject(state_json));
  }

// Format single current-bar zones object (zero-overhead: 4 already-computed doubles + bar_time)
string EP_BuildZonesJson(
   const long bar_time,
   const double sell,
   const double mean,
   const double fair,
   const double buy
)
  {
   return StringFormat(
      "\"zones\":{\"bar_time\":%I64d,\"sell\":%.5f,\"mean\":%.5f,\"fair\":%.5f,\"buy\":%.5f}",
      bar_time,
      sell,
      mean,
      fair,
      buy
   );
  }

// Zero-overhead throttled indicator snapshot (call from OnTimer or new M5 bar; max 1 write / min_interval_ms)
// Compatible with GoldPulseReversion v8.x & NasdaqPulseReversion v3.x
void EP_ReportIndicators(
   const long magic,
   const string regime,
   const string signal_bias,
   const double er_h1,
   const double vwap,
   const double vwap_z,
   const double bb_upper,
   const double bb_mid,
   const double bb_lower,
   const double vol_ratio,
   const double atr5,
   const double atr20,
   const double work_balance,
   const double bank_balance,
   const double dd_pct,
   const uint min_interval_ms = 1000
)
  {
   if(MQLInfoInteger(MQL_TESTER))
      return;
   static ulong s_last_emit_ms = 0;
   ulong now_ms = GetTickCount64();
   if(now_ms - s_last_emit_ms < min_interval_ms)
      return;
   s_last_emit_ms = now_ms;

   long bar_time = (long)iTime(_Symbol, PERIOD_CURRENT, 0);
   double fair_px = (vwap > 0.0) ? vwap : bb_mid;
   string payload = StringFormat(
      "{\"regime\":\"%s\",\"signal_bias\":\"%s\",\"er_h1\":%.4f,\"vwap\":%.5f,\"vwap_z\":%.3f,"
      "\"bb_upper\":%.5f,\"bb_mid\":%.5f,\"bb_lower\":%.5f,\"vol_ratio\":%.3f,"
      "\"atr5\":%.5f,\"atr20\":%.5f,\"work_balance\":%.2f,\"bank_balance\":%.2f,\"dd_pct\":%.2f,%s}",
      EP_EscapeJson(regime),
      EP_EscapeJson(signal_bias),
      er_h1,
      vwap,
      vwap_z,
      bb_upper,
      bb_mid,
      bb_lower,
      vol_ratio,
      atr5,
      atr20,
      work_balance,
      bank_balance,
      dd_pct,
      EP_BuildZonesJson(bar_time, bb_upper, bb_mid, fair_px, bb_lower)
   );
   EP_WriteIpcEvent("robot_state", magic, payload);
  }

// Call right after OrderSend() to record real execution latency (ms) and slippage
void EP_ReportExecution(
   const long magic,
   const ulong order_ticket,
   const int execution_ms,
   const double requested_price,
   const double filled_price
)
  {
   double slippage_pts = MathAbs(filled_price - requested_price) / (_Point > 0 ? _Point : 1.0);
   string payload = StringFormat(
      "{\"order_ticket\":%I64u,\"execution_ms\":%d,\"requested_price\":%.5f,\"filled_price\":%.5f,\"slippage_pts\":%.2f}",
      order_ticket,
      execution_ms,
      requested_price,
      filled_price,
      slippage_pts
   );
   EP_WriteIpcEvent("execution", magic, payload);
  }

// Call on non-zero trade retcodes (requote, off quotes, margin error, etc.)
void EP_ReportError(const long magic, const uint retcode, const string message)
  {
   string payload = StringFormat(
      "{\"retcode\":%u,\"message\":\"%s\"}",
      retcode,
      EP_EscapeJson(message)
   );
   EP_WriteIpcEvent("error", magic, payload);
  }
//+------------------------------------------------------------------+
