//+------------------------------------------------------------------+
//|                                            ExnessPanelBridge.mq5 |
//|     Huseynovlar Terminal — Real-Time WebSocket & 1s Telemetry EA |
//|                                    https://terminal.huseynovlar.org
//+------------------------------------------------------------------+
//| Attach to a dedicated 2nd chart tab (1 instance per MT5 account).|
//| Runs on its own MT5 chart thread — 0% latency impact on trading  |
//| robots (e.g. GoldPulseReversion, NasdaqPulse on Chart 1).        |
//|                                                                  |
//| IMPORTANT (MT5 Allowlist):                                       |
//|   Tools -> Options -> Expert Advisors ->                         |
//|   Allow WebRequest for listed URL:                               |
//|     http://ingest.terminal.local:8000                            |
//|     https://terminal.huseynovlar.org                             |
//+------------------------------------------------------------------+
#property copyright "Huseynovlar Terminal"
#property version   "2.20"
#property strict

#include <Trade\Trade.mqh>

#define EP_IPC_FOLDER "ep_ipc"

input string ApiBaseUrl            = "http://ingest.terminal.local:8000/api/v1/ingest"; // Internal Docker URL (<1ms) or https://...
input string AccountApiKey         = "";                                                // Generated in Huseynovlar Terminal UI
input string ChartSymbolOverride   = "";                                                // Empty = current chart symbol
input bool   UseWebSocketStream    = true;                                              // Native MQL5 WebSocket stream (auto HTTP fallback)
input int    SnapshotIntervalSec   = 1;                                                 // Real-time 1-second equity & HUD snapshot
input int    BarsSyncIntervalSec   = 2;                                                 // Live M1/M5 candle sync interval (seconds)
input int    InitialHistoryDays    = 90;                                                // Initial deal history lookback
input int    HttpTimeoutMs         = 2500;                                              // Non-blocking short timeout
input bool   AllowRemoteClose      = false;                                             // Safety fuse for emergency Kill-Switch

ulong    g_lastSyncedDealTicket = 0;
ulong    g_lastSnapshotTickMs   = 0;
ulong    g_lastFastBarsTickMs   = 0;
ulong    g_lastSlowBarsTickMs   = 0;
ulong    g_lastWsRetryTickMs    = 0;
long     g_lastTickMsc          = 0;
datetime g_last4014HintTime     = 0;
string   g_symbol               = "";

int      g_wsSocket             = INVALID_HANDLE;
bool     g_wsConnected          = false;

// Per-position MAE / MFE trackers (by position ticket)
ulong  g_posTickets[];
double g_posMae[];
double g_posMfe[];

// Persistent per-magic IPC telemetry states (from ExnessPanelHook.mqh / patched EAs)
long   g_ipcMagics[];
string g_ipcStatus[];
int    g_ipcExecMs[];
string g_ipcStateJson[];

CTrade g_trade;

//+------------------------------------------------------------------+
string EscapeJson(const string src)
  {
   string out = src;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\n", " ");
   StringReplace(out, "\r", " ");
   StringReplace(out, "\t", " ");
   return out;
  }

//+------------------------------------------------------------------+
string ExtractOrigin(const string url)
  {
   int scheme_pos = StringFind(url, "://");
   if(scheme_pos < 0)
      return url;
   int path_pos = StringFind(url, "/", scheme_pos + 3);
   if(path_pos < 0)
      return url;
   return StringSubstr(url, 0, path_pos);
  }

//+------------------------------------------------------------------+
string BuildEndpointUrl(const string endpoint)
  {
   string base = ApiBaseUrl;
   StringTrimLeft(base);
   StringTrimRight(base);
   while(StringLen(base) > 0 && StringGetCharacter(base, StringLen(base) - 1) == '/')
      base = StringSubstr(base, 0, StringLen(base) - 1);
   return base + endpoint;
  }

//+------------------------------------------------------------------+
bool ParseWsTarget(string &host_out, uint &port_out, string &path_out, bool &use_tls_out)
  {
   string base = ApiBaseUrl;
   StringTrimLeft(base);
   StringTrimRight(base);
   while(StringLen(base) > 0 && StringGetCharacter(base, StringLen(base) - 1) == '/')
      base = StringSubstr(base, 0, StringLen(base) - 1);

   use_tls_out = (StringFind(base, "https://") == 0 || StringFind(base, "wss://") == 0);
   int scheme_pos = StringFind(base, "://");
   string rest = (scheme_pos >= 0) ? StringSubstr(base, scheme_pos + 3) : base;

   int slash_pos = StringFind(rest, "/");
   string host_port = (slash_pos >= 0) ? StringSubstr(rest, 0, slash_pos) : rest;
   string base_path = (slash_pos >= 0) ? StringSubstr(rest, slash_pos) : "/api/v1/ingest";

   int colon_pos = StringFind(host_port, ":");
   if(colon_pos >= 0)
     {
      host_out = StringSubstr(host_port, 0, colon_pos);
      port_out = (uint)StringToInteger(StringSubstr(host_port, colon_pos + 1));
     }
   else
     {
      host_out = host_port;
      port_out = use_tls_out ? 443 : 80;
     }

   path_out = base_path + "/ws?api_key=" + AccountApiKey;
   return (host_out != "" && port_out > 0);
  }

//+------------------------------------------------------------------+
void CloseWsStream()
  {
   if(g_wsSocket != INVALID_HANDLE)
     {
      SocketClose(g_wsSocket);
      g_wsSocket = INVALID_HANDLE;
     }
   g_wsConnected = false;
  }

//+------------------------------------------------------------------+
bool EnsureWsConnected()
  {
   if(!UseWebSocketStream || AccountApiKey == "")
      return false;
   if(g_wsConnected && g_wsSocket != INVALID_HANDLE && SocketIsConnected(g_wsSocket))
      return true;

   CloseWsStream();

   ulong now_ms = GetTickCount64();
   if(now_ms - g_lastWsRetryTickMs < 10000 && g_lastWsRetryTickMs > 0)
      return false;
   g_lastWsRetryTickMs = now_ms;

   string host = "";
   uint   port = 8000;
   string path = "";
   bool   use_tls = false;
   if(!ParseWsTarget(host, port, path, use_tls))
      return false;

   int sock = SocketCreate();
   if(sock == INVALID_HANDLE)
      return false;

   if(!SocketConnect(sock, host, port, 1500))
     {
      SocketClose(sock);
      return false;
     }

   if(use_tls && !SocketTlsHandshake(sock, host))
     {
      SocketClose(sock);
      return false;
     }

   string req =
      "GET " + path + " HTTP/1.1\r\n" +
      "Host: " + host + ":" + IntegerToString((int)port) + "\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "X-Account-Api-Key: " + AccountApiKey + "\r\n\r\n";

   uchar req_bytes[];
   int req_len = StringToCharArray(req, req_bytes, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(req_len <= 0 || SocketSend(sock, req_bytes, (uint)req_len) != req_len)
     {
      SocketClose(sock);
      return false;
     }

   uchar resp_buf[];
   int rd = SocketRead(sock, resp_buf, 1024, 1500);
   if(rd <= 0)
     {
      SocketClose(sock);
      return false;
     }

   string resp_str = CharArrayToString(resp_buf, 0, rd, CP_UTF8);
   if(StringFind(resp_str, " 101 ") < 0)
     {
      SocketClose(sock);
      return false;
     }

   g_wsSocket = sock;
   g_wsConnected = true;
   PrintFormat("[ExnessPanelBridge] Real-time WebSocket stream connected (%s:%d)", host, port);
   return true;
  }

//+------------------------------------------------------------------+
bool WsSendJsonFrame(const string json_text)
  {
   if(!EnsureWsConnected())
      return false;

   uchar payload[];
   int plen = StringToCharArray(json_text, payload, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(plen <= 0 || plen > 65500)
      return false;

   uchar mask[4] = {0x37, 0xFA, 0x21, 0x3D};
   uchar frame[];
   int header_len = (plen < 126) ? 6 : 8;
   ArrayResize(frame, header_len + plen);

   frame[0] = 0x81; // FIN + Text opcode
   int mask_offset = 2;
   if(plen < 126)
     {
      frame[1] = (uchar)(0x80 | plen);
      mask_offset = 2;
     }
   else
     {
      frame[1] = (uchar)(0x80 | 126);
      frame[2] = (uchar)((plen >> 8) & 0xFF);
      frame[3] = (uchar)(plen & 0xFF);
      mask_offset = 4;
     }

   for(int m = 0; m < 4; m++)
      frame[mask_offset + m] = mask[m];

   int data_offset = mask_offset + 4;
   for(int i = 0; i < plen; i++)
      frame[data_offset + i] = (uchar)(payload[i] ^ mask[i & 3]);

   uint total_len = (uint)ArraySize(frame);
   if(SocketSend(g_wsSocket, frame, total_len) != (int)total_len)
     {
      CloseWsStream();
      return false;
     }

   // Drain incoming server acks / Kill-Switch commands non-blockingly
   uint avail = SocketIsReadable(g_wsSocket);
   if(avail > 0)
     {
      uchar in_buf[];
      int got = SocketRead(g_wsSocket, in_buf, MathMin(avail, 4096), 10);
      if(got > 2)
        {
         string msg = CharArrayToString(in_buf, 2, got - 2, CP_UTF8);
         if(AllowRemoteClose && StringFind(msg, "CLOSE_ALL") >= 0)
           {
            Print("[ExnessPanelBridge] Executing authorized WS Kill-Switch CLOSE_ALL");
            for(int p = PositionsTotal() - 1; p >= 0; p--)
              {
               ulong tk = PositionGetTicket(p);
               if(tk > 0) g_trade.PositionClose(tk);
              }
           }
        }
     }
   return true;
  }

//+------------------------------------------------------------------+
long DeterministicHash(const string text)
  {
   long h = 5381;
   int n = StringLen(text);
   for(int i = 0; i < n; i++)
      h = ((h * 33) + (long)StringGetCharacter(text, i)) & 0x7FFFFFFF;
   return h;
  }

//+------------------------------------------------------------------+
string TimeframeName(const ENUM_TIMEFRAMES tf)
  {
   switch(tf)
     {
      case PERIOD_M1:  return "M1";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_M30: return "M30";
      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
      case PERIOD_D1:  return "D1";
      case PERIOD_W1:  return "W1";
      default:         return EnumToString(tf);
     }
  }

//+------------------------------------------------------------------+
int FindPosIndex(const ulong ticket)
  {
   int n = ArraySize(g_posTickets);
   for(int i = 0; i < n; i++)
      if(g_posTickets[i] == ticket)
         return i;
   return -1;
  }

void UpdatePositionMaeMfe(const ulong ticket, const double floating_pnl)
  {
   int idx = FindPosIndex(ticket);
   if(idx < 0)
     {
      idx = ArraySize(g_posTickets);
      ArrayResize(g_posTickets, idx + 1);
      ArrayResize(g_posMae, idx + 1);
      ArrayResize(g_posMfe, idx + 1);
      g_posTickets[idx] = ticket;
      g_posMae[idx] = MathMin(0.0, floating_pnl);
      g_posMfe[idx] = MathMax(0.0, floating_pnl);
     }
   else
     {
      if(floating_pnl < g_posMae[idx]) g_posMae[idx] = floating_pnl;
      if(floating_pnl > g_posMfe[idx]) g_posMfe[idx] = floating_pnl;
     }
  }

//+------------------------------------------------------------------+
int FindIpcMagicIndex(const long magic)
  {
   int n = ArraySize(g_ipcMagics);
   for(int i = 0; i < n; i++)
      if(g_ipcMagics[i] == magic)
         return i;
   return -1;
  }

void UpsertIpcState(const long magic, const string status, const int exec_ms, const string state_json)
  {
   int idx = FindIpcMagicIndex(magic);
   if(idx < 0)
     {
      idx = ArraySize(g_ipcMagics);
      ArrayResize(g_ipcMagics, idx + 1);
      ArrayResize(g_ipcStatus, idx + 1);
      ArrayResize(g_ipcExecMs, idx + 1);
      ArrayResize(g_ipcStateJson, idx + 1);
      g_ipcMagics[idx] = magic;
     }
   g_ipcStatus[idx]    = (status != "") ? status : "RUNNING";
   g_ipcExecMs[idx]    = exec_ms;
   g_ipcStateJson[idx] = (state_json != "") ? state_json : "{}";
  }

//+------------------------------------------------------------------+
string ExtractJsonStringField(const string json, const string key)
  {
   string needle = "\"" + key + "\":\"";
   int p = StringFind(json, needle);
   if(p < 0)
      return "";
   int start = p + StringLen(needle);
   int end = StringFind(json, "\"", start);
   if(end < 0)
      return "";
   return StringSubstr(json, start, end - start);
  }

long ExtractJsonLongField(const string json, const string key, const long fallback = 0)
  {
   string needle = "\"" + key + "\":";
   int p = StringFind(json, needle);
   if(p < 0)
      return fallback;
   string sub = StringSubstr(json, p + StringLen(needle), 24);
   StringTrimLeft(sub);
   return StringToInteger(sub);
  }

string ExtractJsonPayloadObject(const string json)
  {
   string needle = "\"payload\":";
   int p = StringFind(json, needle);
   if(p < 0)
      return "{}";
   int start = p + StringLen(needle);
   int len = StringLen(json);
   if(start >= len || StringGetCharacter(json, start) != '{')
      return "{}";
   int end = len - 1;
   while(end > start && StringGetCharacter(json, end) != '}')
      end--;
   if(end > start && StringGetCharacter(json, end) == '}')
     {
      int inner_end = end - 1;
      while(inner_end >= start && StringGetCharacter(json, inner_end) != '}')
         inner_end--;
      if(inner_end >= start)
         return StringSubstr(json, start, inner_end - start + 1);
     }
   return "{}";
  }

//+------------------------------------------------------------------+
void ConsumeIpcEvents()
  {
   string filename = EP_IPC_FOLDER + "\\events_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ".jsonl";
   if(!FileIsExist(filename))
      return;

   int handle = FileOpen(
      filename,
      FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE
   );
   if(handle == INVALID_HANDLE)
      return;

   ulong fsize = FileSize(handle);
   if(fsize == 0)
     {
      FileClose(handle);
      return;
     }

   string lines[];
   int count = 0;
   while(!FileIsEnding(handle))
     {
      string ln = FileReadString(handle);
      StringTrimLeft(ln);
      StringTrimRight(ln);
      if(StringLen(ln) > 2)
        {
         ArrayResize(lines, count + 1);
         lines[count] = ln;
         count++;
        }
     }
   FileClose(handle);

   int trunc_h = FileOpen(
      filename,
      FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE
   );
   if(trunc_h != INVALID_HANDLE)
      FileClose(trunc_h);

   for(int i = 0; i < count; i++)
     {
      string ln = lines[i];
      long magic = ExtractJsonLongField(ln, "magic", 0);
      if(magic == 0)
         continue;
      string ev_type = ExtractJsonStringField(ln, "type");
      string sym     = ExtractJsonStringField(ln, "symbol");
      string payload = ExtractJsonPayloadObject(ln);
      int exec_ms    = (int)ExtractJsonLongField(payload, "execution_ms", 0);
      string status  = "RUNNING";
      if(ev_type == "error")
         status = "ERROR";
      else
        {
         string st = ExtractJsonStringField(payload, "status");
         if(st != "")
            status = st;
        }
      string wrapped = StringFormat(
         "{\"source\":\"ep_ipc\",\"event_type\":\"%s\",\"symbol\":\"%s\",\"telemetry\":%s}",
         EscapeJson(ev_type),
         EscapeJson(sym),
         payload
      );
      UpsertIpcState(magic, status, exec_ms, wrapped);
     }
  }

//+------------------------------------------------------------------+
long ResolveMagicForSymbol(const string sym, const string expert_name, const string tf_name)
  {
   long found_magic = 0;
   int distinct = 0;

   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      if(PositionGetString(POSITION_SYMBOL) != sym)
         continue;
      long m = PositionGetInteger(POSITION_MAGIC);
      if(m > 0 && m != found_magic)
        {
         found_magic = m;
         distinct++;
        }
     }
   if(distinct == 1 && found_magic > 0)
      return found_magic;

   return 100000 + (MathAbs(DeterministicHash(expert_name + ":" + sym + ":" + tf_name)) % 899999);
  }

//+------------------------------------------------------------------+
string BuildRobotStatesJson()
  {
   ConsumeIpcEvents();

   string items = "[";
   int emitted = 0;
   long seen_magics[];

   // 1. Emit IPC robot states first (highest fidelity)
   int ipc_n = ArraySize(g_ipcMagics);
   for(int i = 0; i < ipc_n; i++)
     {
      if(emitted > 0) items += ",";
      items += StringFormat(
         "{\"magic_number\":%I64d,\"status\":\"%s\",\"execution_ms\":%d,\"state_json\":%s}",
         g_ipcMagics[i],
         EscapeJson(g_ipcStatus[i]),
         g_ipcExecMs[i],
         g_ipcStateJson[i]
      );
      ArrayResize(seen_magics, emitted + 1);
      seen_magics[emitted] = g_ipcMagics[i];
      emitted++;
     }

   // 2. Auto-discover sibling-chart EAs
   long my_cid = ChartID();
   for(long cid = ChartFirst(); cid >= 0; cid = ChartNext(cid))
     {
      if(cid == my_cid)
         continue;

      string exp_name = ChartGetString(cid, CHART_EXPERT_NAME);
      StringTrimLeft(exp_name);
      StringTrimRight(exp_name);
      if(exp_name == "" || StringFind(exp_name, "ExnessPanelBridge") >= 0)
         continue;

      string c_sym = ChartSymbol(cid);
      string c_tf  = TimeframeName(ChartPeriod(cid));
      long magic   = ResolveMagicForSymbol(c_sym, exp_name, c_tf);

      bool dup = false;
      for(int s = 0; s < ArraySize(seen_magics); s++)
         if(seen_magics[s] == magic) { dup = true; break; }
      if(dup)
         continue;

      string status = "RUNNING";
      string hud_lines = "";
      int obj_total = ObjectsTotal(cid, 0, -1);
      int captured = 0;
      for(int k = 0; k < obj_total && captured < 16; k++)
        {
         string oname = ObjectName(cid, k, 0, -1);
         long otype = ObjectGetInteger(cid, oname, OBJPROP_TYPE);
         if(otype != OBJ_LABEL && otype != OBJ_BUTTON && otype != OBJ_EDIT)
            continue;
         string txt = ObjectGetString(cid, oname, OBJPROP_TEXT);
         StringTrimLeft(txt);
         StringTrimRight(txt);
         if(txt == "")
            continue;

         if(StringFind(txt, "ALGO: OFF") >= 0 || StringFind(txt, "ALGO:OFF") >= 0)
            status = "PAUSED";
         else if(StringFind(txt, "OFF_SESSION") >= 0)
            status = "OFF_SESSION";

         if(StringFind(txt, "STATE:") >= 0 || StringFind(txt, "Trend:") >= 0 ||
            StringFind(txt, "RSI:") >= 0   || StringFind(txt, "ER:") >= 0 ||
            StringFind(txt, "Risk:") >= 0  || StringFind(txt, "Seq:") >= 0 ||
            StringFind(txt, "Day:") >= 0   || StringFind(txt, "DD:") >= 0 ||
            StringFind(txt, "Bal:") >= 0   || StringFind(txt, "Work:") >= 0 ||
            StringFind(txt, "Bank:") >= 0  || StringFind(txt, "ALGO:") >= 0 ||
            StringFind(txt, "MKT:") >= 0)
           {
            if(hud_lines != "") hud_lines += " | ";
            hud_lines += txt;
            captured++;
           }
        }

      string state_obj = StringFormat(
         "{\"name\":\"%s\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"source\":\"chart_discovery\",\"telemetry\":{\"hud\":\"%s\"}}",
         EscapeJson(exp_name),
         EscapeJson(c_sym),
         EscapeJson(c_tf),
         EscapeJson(hud_lines)
      );

      if(emitted > 0) items += ",";
      items += StringFormat(
         "{\"magic_number\":%I64d,\"ea_name\":\"%s\",\"symbol\":\"%s\",\"status\":\"%s\",\"execution_ms\":0,\"state_json\":%s}",
         magic,
         EscapeJson(exp_name),
         EscapeJson(c_sym),
         EscapeJson(status),
         state_obj
      );
      ArrayResize(seen_magics, emitted + 1);
      seen_magics[emitted] = magic;
      emitted++;
     }

   items += "]";
   return items;
  }

//+------------------------------------------------------------------+
bool PostJson(const string endpoint, const string json_body, string &response_out)
  {
   if(AccountApiKey == "")
      return false;

   string url = BuildEndpointUrl(endpoint);
   string headers = "Content-Type: application/json\r\nX-Account-Api-Key: " + AccountApiKey + "\r\n";
   uchar post_data[];
   uchar result[];
   string result_headers = "";

   int len = StringToCharArray(json_body, post_data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0)
      ArrayResize(post_data, len - 1);

   ResetLastError();
   int status = WebRequest("POST", url, headers, HttpTimeoutMs, post_data, result, result_headers);
   int err = GetLastError();
   if(status < 200 || status >= 300)
     {
      if(status == -1 && err == 4014)
        {
         datetime now = TimeLocal();
         if(now - g_last4014HintTime >= 30)
           {
            g_last4014HintTime = now;
            string origin = ExtractOrigin(url);
            PrintFormat(
               "[ExnessPanelBridge] ERR 4014 (URL not whitelisted in MT5)! Add '%s' in MT5: Tools -> Options -> Expert Advisors -> Allow WebRequest for listed URL",
               origin
            );
           }
        }
      return false;
     }
   response_out = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return true;
  }

//+------------------------------------------------------------------+
void SendBootstrapAndSyncHistory()
  {
   string body = StringFormat(
      "{\"mt5_login\":\"%I64d\",\"mt5_server\":\"%s\",\"currency\":\"%s\",\"leverage\":%I64d,\"algo_trading_enabled\":%s,\"balance\":%.2f,\"equity\":%.2f,\"terminal_build\":%d}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      EscapeJson(AccountInfoString(ACCOUNT_SERVER)),
      EscapeJson(AccountInfoString(ACCOUNT_CURRENCY)),
      AccountInfoInteger(ACCOUNT_LEVERAGE),
      TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false",
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      TerminalInfoInteger(TERMINAL_BUILD)
   );

   string resp = "";
   if(PostJson("/bootstrap", body, resp))
     {
      int pos = StringFind(resp, "\"last_synced_deal_ticket\":");
      if(pos >= 0)
        {
         string sub = StringSubstr(resp, pos + 26);
         g_lastSyncedDealTicket = (ulong)StringToInteger(sub);
        }
      SyncDealsSinceCursor();
     }
  }

//+------------------------------------------------------------------+
void SyncDealsSinceCursor()
  {
   datetime from_dt = TimeCurrent() - InitialHistoryDays * 86400;
   if(!HistorySelect(from_dt, TimeCurrent() + 3600))
      return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0 || ticket <= g_lastSyncedDealTicket)
         continue;
      SendDealByTicket(ticket);
     }
  }

//+------------------------------------------------------------------+
void SendDealByTicket(const ulong ticket)
  {
   if(!HistoryDealSelect(ticket))
      return;

   long   deal_type  = HistoryDealGetInteger(ticket, DEAL_TYPE);
   long   entry_type = HistoryDealGetInteger(ticket, DEAL_ENTRY);
   long   magic      = HistoryDealGetInteger(ticket, DEAL_MAGIC);
   ulong  order_id   = (ulong)HistoryDealGetInteger(ticket, DEAL_ORDER);
   ulong  pos_id     = (ulong)HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
   long   time_msc   = HistoryDealGetInteger(ticket, DEAL_TIME_MSC);
   string sym        = HistoryDealGetString(ticket, DEAL_SYMBOL);
   string comment    = HistoryDealGetString(ticket, DEAL_COMMENT);
   double volume     = HistoryDealGetDouble(ticket, DEAL_VOLUME);
   double price      = HistoryDealGetDouble(ticket, DEAL_PRICE);
   double commission = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
   double swap       = HistoryDealGetDouble(ticket, DEAL_SWAP);
   double profit     = HistoryDealGetDouble(ticket, DEAL_PROFIT);
   double fee        = HistoryDealGetDouble(ticket, DEAL_FEE);

   string body = StringFormat(
      "{\"mt5_deal_ticket\":%I64u,\"order_ticket\":%I64u,\"position_id\":%I64u,\"magic_number\":%I64d,\"symbol\":\"%s\",\"deal_type\":%I64d,\"entry_type\":%I64d,\"volume\":%.4f,\"price\":%.5f,\"commission\":%.4f,\"swap\":%.4f,\"profit\":%.4f,\"fee\":%.4f,\"comment\":\"%s\",\"time_msc\":%I64d}",
      ticket, order_id, pos_id, magic, EscapeJson(sym), deal_type, entry_type,
      volume, price, commission, swap, profit, fee, EscapeJson(comment), time_msc
   );

   string resp = "";
   if(PostJson("/trade-event", body, resp))
     {
      if(ticket > g_lastSyncedDealTicket)
         g_lastSyncedDealTicket = ticket;
     }
  }

//+------------------------------------------------------------------+
void StreamRecentTicks()
  {
   MqlTick ticks[];
   int copied = 0;
   if(g_lastTickMsc == 0)
     {
      copied = CopyTicks(g_symbol, ticks, COPY_TICKS_INFO, 0, 60);
     }
   else
     {
      copied = CopyTicks(g_symbol, ticks, COPY_TICKS_INFO, (ulong)(g_lastTickMsc + 1), 60);
     }
   if(copied <= 0)
      return;

   int start_idx = MathMax(0, copied - 40);
   string arr_json = "[";
   int emitted = 0;
   for(int i = start_idx; i < copied; i++)
     {
      if(ticks[i].bid <= 0)
         continue;
      if(ticks[i].time_msc > g_lastTickMsc)
         g_lastTickMsc = ticks[i].time_msc;
      if(emitted > 0) arr_json += ",";
      arr_json += StringFormat(
         "{\"time_msc\":%I64d,\"bid\":%.5f,\"ask\":%.5f}",
         ticks[i].time_msc,
         ticks[i].bid,
         ticks[i].ask > 0 ? ticks[i].ask : ticks[i].bid
      );
      emitted++;
     }
   arr_json += "]";
   if(emitted == 0)
      return;

   string ws_msg = StringFormat(
      "{\"type\":\"ticks\",\"symbol\":\"%s\",\"ticks\":%s}",
      EscapeJson(g_symbol),
      arr_json
   );
   if(!WsSendJsonFrame(ws_msg))
     {
      string body = StringFormat(
         "{\"symbol\":\"%s\",\"ticks\":%s}",
         EscapeJson(g_symbol),
         arr_json
      );
      string resp = "";
      PostJson("/ticks", body, resp);
     }
  }

//+------------------------------------------------------------------+
void SendSnapshotAndProcessCommands()
  {
   int total_pos = PositionsTotal();
   string pos_json = "[";
   int emitted_pos = 0;
   for(int i = 0; i < total_pos; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket))
         continue;
      double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      UpdatePositionMaeMfe(ticket, pnl);
      int idx = FindPosIndex(ticket);
      double mae = idx >= 0 ? g_posMae[idx] : 0.0;
      double mfe = idx >= 0 ? g_posMfe[idx] : 0.0;

      if(emitted_pos > 0) pos_json += ",";
      pos_json += StringFormat(
         "{\"position_ticket\":%I64u,\"magic_number\":%I64d,\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%.4f,\"open_price\":%.5f,\"current_price\":%.5f,\"sl\":%.5f,\"tp\":%.5f,\"swap\":%.4f,\"profit\":%.4f,\"mae\":%.4f,\"mfe\":%.4f,\"open_time\":%I64d,\"comment\":\"%s\"}",
         ticket,
         PositionGetInteger(POSITION_MAGIC),
         EscapeJson(PositionGetString(POSITION_SYMBOL)),
         PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL",
         PositionGetDouble(POSITION_VOLUME),
         PositionGetDouble(POSITION_PRICE_OPEN),
         PositionGetDouble(POSITION_PRICE_CURRENT),
         PositionGetDouble(POSITION_SL),
         PositionGetDouble(POSITION_TP),
         PositionGetDouble(POSITION_SWAP),
         PositionGetDouble(POSITION_PROFIT),
         mae, mfe,
         PositionGetInteger(POSITION_TIME),
         EscapeJson(PositionGetString(POSITION_COMMENT))
      );
      emitted_pos++;
     }
   pos_json += "]";

   string robot_states_json = BuildRobotStatesJson();

   MqlTick tick;
   double bid = 0.0, ask = 0.0;
   int spread_pts = 0;
   if(SymbolInfoTick(g_symbol, tick))
     {
      bid = tick.bid;
      ask = tick.ask;
      spread_pts = (int)SymbolInfoInteger(g_symbol, SYMBOL_SPREAD);
     }

   long ping_ms = TerminalInfoInteger(TERMINAL_PING_LAST) / 1000;
   string core_fields = StringFormat(
      "\"balance\":%.4f,\"equity\":%.4f,\"floating_pnl\":%.4f,\"margin\":%.4f,\"free_margin\":%.4f,\"margin_level\":%.2f,\"algo_trading_enabled\":%s,\"terminal_connected\":%s,\"ping_ms\":%I64d,\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"spread_pts\":%d,\"open_positions\":%s,\"robot_states\":%s",
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_PROFIT),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),
      TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false",
      TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false",
      ping_ms,
      EscapeJson(g_symbol),
      bid, ask, spread_pts,
      pos_json,
      robot_states_json
   );

   if(WsSendJsonFrame("{\"type\":\"snapshot\"," + core_fields + "}"))
      return;

   string resp = "";
   if(PostJson("/snapshot", "{" + core_fields + "}", resp))
     {
      if(AllowRemoteClose && StringFind(resp, "\"CLOSE_ALL\"") >= 0)
        {
         Print("[ExnessPanelBridge] Executing authorized Kill-Switch CLOSE_ALL");
         for(int i = PositionsTotal() - 1; i >= 0; i--)
           {
            ulong t = PositionGetTicket(i);
            if(t > 0) g_trade.PositionClose(t);
           }
        }
     }
  }

//+------------------------------------------------------------------+
void SyncRecentBarsChunked(const ENUM_TIMEFRAMES tf, const string tf_name, const int total_count)
  {
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(g_symbol, tf, 0, total_count, rates);
   if(copied <= 0)
      return;

   int chunk_size = 250;
   for(int offset = 0; offset < copied; offset += chunk_size)
     {
      int end_idx = MathMin(copied, offset + chunk_size);
      string bars_json = "[";
      for(int i = offset; i < end_idx; i++)
        {
         if(i > offset) bars_json += ",";
         bars_json += StringFormat(
            "{\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%I64d}",
            (long)rates[i].time, rates[i].open, rates[i].high, rates[i].low, rates[i].close, rates[i].tick_volume
         );
        }
      bars_json += "]";

      string ws_frame = StringFormat(
         "{\"type\":\"bars\",\"symbol\":\"%s\",\"timeframe\":\"%s\",\"bars\":%s}",
         EscapeJson(g_symbol), tf_name, bars_json
      );
      if(!WsSendJsonFrame(ws_frame))
        {
         string body = StringFormat(
            "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"bars\":%s}",
            EscapeJson(g_symbol), tf_name, bars_json
         );
         string resp = "";
         PostJson("/bars", body, resp);
        }
     }
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER))
      return(INIT_SUCCEEDED);

   g_symbol = (ChartSymbolOverride != "") ? ChartSymbolOverride : _Symbol;

   // Auto-detect trading symbol from sibling chart if Bridge was attached to an idle FX chart
   if(ChartSymbolOverride == "")
     {
      long my_cid = ChartID();
      for(long cid = ChartFirst(); cid >= 0; cid = ChartNext(cid))
        {
         if(cid == my_cid) continue;
         string exp = ChartGetString(cid, CHART_EXPERT_NAME);
         if(exp != "" && StringFind(exp, "ExnessPanelBridge") < 0)
           {
            g_symbol = ChartSymbol(cid);
            break;
           }
        }
     }

   SendBootstrapAndSyncHistory();
   EnsureWsConnected();

   // Push deep multi-day / multi-week candle history (1000 bars per timeframe!)
   SyncRecentBarsChunked(PERIOD_M1,  "M1",  1000);
   SyncRecentBarsChunked(PERIOD_M5,  "M5",  1000);
   SyncRecentBarsChunked(PERIOD_M15, "M15", 1000);
   SyncRecentBarsChunked(PERIOD_M30, "M30", 600);
   SyncRecentBarsChunked(PERIOD_H1,  "H1",  1000);
   SyncRecentBarsChunked(PERIOD_H4,  "H4",  600);
   SyncRecentBarsChunked(PERIOD_D1,  "D1",  600);

   StreamRecentTicks();
   SendSnapshotAndProcessCommands();

   // 500ms sub-second timer on dedicated Bridge chart thread (0% impact on trading EA)
   EventSetMillisecondTimer(500);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   CloseWsStream();
  }

void OnTradeTransaction(
   const MqlTradeTransaction &trans,
   const MqlTradeRequest &request,
   const MqlTradeResult &result
)
  {
   if(MQLInfoInteger(MQL_TESTER))
      return;
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD && trans.deal > 0)
     {
      SendDealByTicket(trans.deal);
      SendSnapshotAndProcessCommands();
     }
  }

void OnTimer()
  {
   if(MQLInfoInteger(MQL_TESTER))
      return;

   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
        {
         double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         UpdatePositionMaeMfe(ticket, pnl);
        }
     }

   // 1. Sub-second (500ms) real broker Bid/Ask tick stream
   StreamRecentTicks();

   ulong now_ms = GetTickCount64();
   ulong snap_ms = (ulong)MathMax(1, SnapshotIntervalSec) * 1000;
   ulong fast_bars_ms = (ulong)MathMax(1, BarsSyncIntervalSec) * 1000;

   // 2. Every 1 second: full account Equity + Positions + Robot Live HUD
   if(now_ms - g_lastSnapshotTickMs >= snap_ms)
     {
      g_lastSnapshotTickMs = now_ms;
      SendSnapshotAndProcessCommands();
     }

   // 3. Every 2 seconds: live forming M1 & M5 candles
   if(now_ms - g_lastFastBarsTickMs >= fast_bars_ms)
     {
      g_lastFastBarsTickMs = now_ms;
      SyncRecentBarsChunked(PERIOD_M1, "M1", 3);
      SyncRecentBarsChunked(PERIOD_M5, "M5", 3);
     }

   // 4. Every 15 seconds: higher-timeframe candles
   if(now_ms - g_lastSlowBarsTickMs >= 15000)
     {
      g_lastSlowBarsTickMs = now_ms;
      SyncRecentBarsChunked(PERIOD_M15, "M15", 3);
      SyncRecentBarsChunked(PERIOD_H1,  "H1",  3);
      SyncRecentBarsChunked(PERIOD_H4,  "H4",  2);
     }
  }
//+------------------------------------------------------------------+
