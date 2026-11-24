//+------------------------------------------------------------------+
//|                                            ExnessPanelBridge.mq5 |
//|           Huseynovlar Terminal — Separate-Thread Telemetry EA    |
//|                                    https://terminal.huseynovlar.org
//+------------------------------------------------------------------+
//| Attach to a dedicated helper chart (1 instance per MT5 account). |
//| Runs on its own MT5 chart thread — 0% latency impact on trading  |
//| robots. Add your API base URL to MT5 Tools -> Options -> Experts |
//| -> Allow WebRequest for listed URL.                              |
//+------------------------------------------------------------------+
#property copyright "Huseynovlar Terminal"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

input string ApiBaseUrl            = "http://terminal-backend:8000/api/v1/ingest"; // Internal Docker network URL (<1ms)
input string AccountApiKey         = "";                                           // Generated in Huseynovlar Terminal UI
input string ChartSymbolOverride   = "";                                           // Empty = current chart symbol
input int    SnapshotIntervalSec   = 5;                                            // Heartbeat & equity snapshot interval
input int    BarsSyncIntervalSec   = 15;                                           // OHLCV bars sync interval
input int    InitialHistoryDays    = 90;                                           // Initial deal history lookback
input int    HttpTimeoutMs         = 2500;                                         // Non-blocking short timeout
input bool   AllowRemoteClose      = false;                                        // Safety fuse for emergency Kill-Switch

ulong  g_lastSyncedDealTicket = 0;
datetime g_lastSnapshotTime   = 0;
datetime g_lastBarsSyncTime   = 0;
string g_symbol               = "";

// Per-position MAE / MFE trackers (by position ticket)
ulong  g_posTickets[];
double g_posMae[];
double g_posMfe[];

CTrade g_trade;

//+------------------------------------------------------------------+
string EscapeJson(const string src)
  {
   string out = src;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\n", " ");
   StringReplace(out, "\r", " ");
   return out;
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
bool PostJson(const string endpoint, const string json_body, string &response_out)
  {
   if(AccountApiKey == "")
      return false;

   string url = ApiBaseUrl + endpoint;
   string headers = "Content-Type: application/json\r\nX-Account-Api-Key: " + AccountApiKey + "\r\n";
   uchar post_data[];
   uchar result[];
   string result_headers = "";

   int len = StringToCharArray(json_body, post_data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0)
      ArrayResize(post_data, len - 1); // strip trailing NUL

   ResetLastError();
   int status = WebRequest("POST", url, headers, HttpTimeoutMs, post_data, result, result_headers);
   if(status < 200 || status >= 300)
     {
      PrintFormat("[ExnessPanelBridge] POST %s failed: HTTP %d (err=%d)", endpoint, status, GetLastError());
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
void SendSnapshotAndProcessCommands()
  {
   int total_pos = PositionsTotal();
   string pos_json = "[";
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

      if(i > 0) pos_json += ",";
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
     }
   pos_json += "]";

   MqlTick tick;
   double bid = 0.0, ask = 0.0;
   int spread_pts = 0;
   if(SymbolInfoTick(g_symbol, tick))
     {
      bid = tick.bid;
      ask = tick.ask;
      spread_pts = (int)SymbolInfoInteger(g_symbol, SYMBOL_SPREAD);
     }

   string body = StringFormat(
      "{\"balance\":%.4f,\"equity\":%.4f,\"floating_pnl\":%.4f,\"margin\":%.4f,\"free_margin\":%.4f,\"margin_level\":%.2f,\"algo_trading_enabled\":%s,\"symbol\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"spread_pts\":%d,\"open_positions\":%s}",
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_PROFIT),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),
      TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false",
      EscapeJson(g_symbol),
      bid, ask, spread_pts,
      pos_json
   );

   string resp = "";
   if(PostJson("/snapshot", body, resp))
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
void SyncRecentBars(const ENUM_TIMEFRAMES tf, const string tf_name, const int count)
  {
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(g_symbol, tf, 0, count, rates);
   if(copied <= 0)
      return;

   string bars_json = "[";
   for(int i = 0; i < copied; i++)
     {
      if(i > 0) bars_json += ",";
      bars_json += StringFormat(
         "{\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"volume\":%I64d}",
         (long)rates[i].time, rates[i].open, rates[i].high, rates[i].low, rates[i].close, rates[i].tick_volume
      );
     }
   bars_json += "]";

   string body = StringFormat(
      "{\"symbol\":\"%s\",\"timeframe\":\"%s\",\"bars\":%s}",
      EscapeJson(g_symbol), tf_name, bars_json
   );
   string resp = "";
   PostJson("/bars", body, resp);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_symbol = (ChartSymbolOverride != "") ? ChartSymbolOverride : _Symbol;
   EventSetTimer(1);
   SendBootstrapAndSyncHistory();
   SyncRecentBars(PERIOD_M1, "M1", 120);
   SyncRecentBars(PERIOD_M5, "M5", 120);
   SyncRecentBars(PERIOD_M15, "M15", 120);
   SyncRecentBars(PERIOD_H1, "H1", 120);
   SyncRecentBars(PERIOD_H4, "H4", 120);
   SyncRecentBars(PERIOD_D1, "D1", 120);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTradeTransaction(
   const MqlTradeTransaction &trans,
   const MqlTradeRequest &request,
   const MqlTradeResult &result
)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD && trans.deal > 0)
     {
      SendDealByTicket(trans.deal);
      SendSnapshotAndProcessCommands();
     }
  }

void OnTimer()
  {
   // Continuously track in-memory MAE/MFE every second (zero network overhead)
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
        {
         double pnl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         UpdatePositionMaeMfe(ticket, pnl);
        }
     }

   datetime now = TimeCurrent();
   if(now - g_lastSnapshotTime >= SnapshotIntervalSec)
     {
      g_lastSnapshotTime = now;
      SendSnapshotAndProcessCommands();
     }

   if(now - g_lastBarsSyncTime >= BarsSyncIntervalSec)
     {
      g_lastBarsSyncTime = now;
      SyncRecentBars(PERIOD_M1, "M1", 5);
      SyncRecentBars(PERIOD_M5, "M5", 5);
      SyncRecentBars(PERIOD_M15, "M15", 3);
      SyncRecentBars(PERIOD_H1, "H1", 3);
     }
  }
//+------------------------------------------------------------------+
