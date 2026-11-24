//+------------------------------------------------------------------+
//|                                              ExnessPanelHook.mqh |
//|                     Huseynovlar Terminal — Zero-Latency EA Hook  |
//|                                    https://terminal.huseynovlar.org
//+------------------------------------------------------------------+
//| ZERO NETWORK CALLS. Execution time < 0.05 ms.                    |
//| Writes compact JSON telemetry lines to MQL5/Files/ep_ipc/ which  |
//| ExnessPanelBridge.mq5 (running on its own chart/thread) reads    |
//| and sends to Huseynovlar Terminal over internal Docker network.  |
//+------------------------------------------------------------------+
#property strict

#define EP_IPC_FOLDER "ep_ipc"

string EP_EscapeJson(const string src)
  {
   string out = src;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\n", " ");
   StringReplace(out, "\r", " ");
   return out;
  }

void EP_WriteIpcEvent(const string event_type, const long magic, const string payload_json)
  {
   string filename = EP_IPC_FOLDER + "\\events_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".jsonl";
   int handle = FileOpen(filename, FILE_WRITE | FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(handle == INVALID_HANDLE)
      return;
   FileSeek(handle, 0, SEEK_END);
   string line = StringFormat(
      "{\"ts_msc\":%I64d,\"type\":\"%s\",\"magic\":%I64d,\"symbol\":\"%s\",\"payload\":%s}",
      TimeCurrent() * 1000,
      EP_EscapeJson(event_type),
      magic,
      EP_EscapeJson(_Symbol),
      payload_json
   );
   FileWriteString(handle, line + "\n");
   FileClose(handle);
  }

// Call once in OnInit() of your trading EA
void EP_RegisterRobot(const long magic, const string name, const string version, const string params_json = "{}")
  {
   string payload = StringFormat(
      "{\"name\":\"%s\",\"version\":\"%s\",\"params\":%s}",
      EP_EscapeJson(name),
      EP_EscapeJson(version),
      params_json == "" ? "{}" : params_json
   );
   EP_WriteIpcEvent("robot_register", magic, payload);
  }

// Call whenever your EA changes internal strategy mode / grid level / filter state
void EP_ReportState(const long magic, const string state_json)
  {
   EP_WriteIpcEvent("robot_state", magic, state_json == "" ? "{}" : state_json);
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
