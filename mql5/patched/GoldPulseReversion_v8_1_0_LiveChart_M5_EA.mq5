//+------------------------------------------------------------------+
//|                 GoldPulseReversion_v8_1_0_LiveChart_M5_EA.mq5    |
//|                               Copyright 2026, GoldPulseReversion |
//|  v8.08 LiveChart: Verified v8.06 Core + Zero-Lag Chart Overlays  |
//|  (BB Channel, VWAP, Trigger Level) + Live 'Wait' HUD Checklist   |
//+------------------------------------------------------------------+
#property copyright   "Copyright 2026, GoldPulseReversion"
#property version     "8.10"
#property description "v8.08 LiveChart: Verified v8.06 HybridCore + Lightweight M5 Chart Overlays (BB 20,2.0 / Session VWAP / Trigger Level) & Live HUD Wait Checklist."
#property strict

#include <Trade/Trade.mqh>
#include <ExnessPanelHook.mqh> // Huseynovlar Terminal zero-overhead telemetry (0ms in Tester)
#include <Canvas/Canvas.mqh>

#define GPR_EA_NAME       "GoldPulse v8.10 Live"
#define GPR_EA_VERSION    "v8.10"
#define GPR_STATE_VER_NUM 81001
#define GPR_SPREAD_RING   40

//+------------------------------------------------------------------+
//| Enums                                                            |
//+------------------------------------------------------------------+
enum ENUM_GPR_LOT_MODE
  {
   GPR_LOT_DYNAMIC_RISK = 0,  // Clean Fractional Kelly Compounding
   GPR_LOT_EQUITY_STEP  = 1,  // Equity Step (0.01 per $X)
   GPR_LOT_FIXED        = 2   // Fixed Lot
  };

enum ENUM_GPR_DIR_MODE
  {
   GPR_DIR_BOTH      = 0,     // Buy & Sell (Auto H4+H1 Aligned)
   GPR_DIR_BUY_ONLY  = 1,     // Buy Only
   GPR_DIR_SELL_ONLY = 2      // Sell Only (Pure Bear Max Mode)
  };

enum ENUM_GPR_CORNER
  {
   GPR_CORNER_TOP_LEFT     = 0,
   GPR_CORNER_TOP_RIGHT    = 1,
   GPR_CORNER_BOTTOM_LEFT  = 2,
   GPR_CORNER_BOTTOM_RIGHT = 3
  };

//+------------------------------------------------------------------+
//| Input Parameters (v7.41 Markov-Kelly + All-Weather Hybrid)       |
//+------------------------------------------------------------------+
input group "=== 1. Dual-TF Macro (H4+H1) + M5 Sweep-Pullback ==="
input ENUM_TIMEFRAMES   InpSignalTf          = PERIOD_M5;            // Signal Timeframe (M5)
input ENUM_TIMEFRAMES   InpMacroTf           = PERIOD_H1;            // Primary Trend Timeframe (H1)
input bool              InpUseMacroTrend     = true;                 // Require H1 EMA20/50 Alignment
input int               InpMacroFastEma      = 20;                   // H1 Fast EMA Period
input int               InpMacroSlowEma      = 50;                   // H1 Slow EMA Period
input bool              InpUseH4Macro        = true;                 // Require H4 EMA20/50 Alignment
input ENUM_TIMEFRAMES   InpH4Tf              = PERIOD_H4;            // Higher Macro Timeframe (H4)
input int               InpH4FastEma         = 20;                   // H4 Fast EMA Period
input int               InpH4SlowEma         = 50;                   // H4 Slow EMA Period
input ENUM_GPR_DIR_MODE InpDirection         = GPR_DIR_BOTH;         // Direction (BOTH = All-Weather, SELL_ONLY = Bear)
input int               InpBbPeriod          = 20;                   // M5 Bollinger Bands Period
input double            InpBbDeviation       = 2.0;                  // M5 Bollinger Bands Deviation
input int               InpRsiPeriod         = 7;                    // M5 Fast RSI Period
input double            InpRsiOversold       = 32.0;                 // M5 RSI Oversold Threshold (Buy)
input double            InpRsiOverbought     = 68.0;                 // M5 RSI Overbought Threshold (Sell)
input bool              InpRequireRejCandle  = true;                 // Require Rejection Candle Close Inside BB
input int               InpCooldownSec       = 300;                  // Cooldown After Win Close (sec)
input int               InpLossCooldownSec   = 900;                  // Cooldown After Loss Close (sec, 900=15m)

input group "=== 1B. Quant Math Layer (Toggleable on v7.62 Core) ==="
input bool              InpUseKaufmanER      = true;                 // 1) H1 Kaufman Efficiency Ratio (Blocks Flat Chop)
input int               InpErPeriod          = 14;                   // Kaufman ER Lookback (H1 Closed Bars)
input double            InpMinH1Er           = 0.15;                 // Min H1 ER for Pullback (0.15 = Blocks Only Dead Chop)
input bool              InpUseVwapZScore     = true;                 // 2) Session VWAP Z-Score Anti-Chase Guard
input double            InpVwapMaxChaseZ     = 2.40;                 // Block Chasing Beyond +/- X Sigma from Session VWAP
input bool              InpUseVwapKnifeGuard = true;                 // 2B) VWAP Falling-Knife Guard (Blocks Intraday Reversal Flushes!)
input double            InpVwapMaxKnifeZ     = 1.35;                 // Block Counter-VWAP Dip/Rip Beyond +/- X Sigma (66% WR Edge)
input bool              InpUseVwapTrigger    = false;                // Legacy VWAP Dip Trigger (False = Pure High-WR Sweep)
input double            InpVwapPullbackZ     = 1.35;                 // Legacy VWAP Pullback Trigger (Used Only if Enabled)
input bool              InpUseParkinsonVol   = true;                 // 3) Blend Parkinson High-Low Vol (35%) with ATR (65%)
input int               InpParkinsonBars     = 14;                   // Parkinson Volatility Window (M5 Closed Bars)

input group "=== 1C. HybridCore Quant Engine (v8.06 - No v8.04 Overfit) ==="
input bool              InpBlockLiqTrap      = true;                 // 1) Block Pullbacks Into Asia/PDH/PDL Liquidity Traps (Symmetric)
input double            InpLiqTrapZoneAtr    = 0.25;                 // Liquidity Trap Detection Zone (x M5 ATR)
input bool              InpUseMultiSlice     = true;                 // 2) Multi-Slice Order Splitting Past Single-Order Lot Cap
input int               InpMaxSlices         = 200;                  // Max Parallel Slices Per Signal (Live: 5-15 | Tester Scale: 200+)
input double            InpTotalLotCap       = 20000.00;             // Total Combined Lot Cap Across All Slices (Auto-Capped by Broker Limit)
input bool              InpUseQuantKelly     = true;                 // 3) Adaptive Empirical Bayes Rolling Kelly + Vol-Shock (Zero-Overfit)
input int               InpKellyWindow       = 12;                   // Rolling Trade Window for Bayesian Kelly
input double            InpKellyMinMult      = 0.65;                 // Min Bayesian Risk Multiplier
input double            InpKellyMaxMult      = 1.50;                 // Max Bayesian Risk Multiplier
input double            InpVolShockRatio     = 1.45;                 // Vol-Shock Dampener Threshold (ATR5/ATR20)
input bool              InpUseSessionEdge    = false;                // [OFF = Zero-Overfit] Legacy Hour Multipliers (Disabled)
input double            InpPrime14Mult       = 1.00;                 // Legacy 14:00 UTC Mult (1.00 = Neutral)
input double            InpPrime17Mult       = 1.00;                 // Legacy 17:00 UTC Mult (1.00 = Neutral)
input double            InpPrime13Mult       = 1.00;                 // Legacy 13:00 UTC Mult (1.00 = Neutral)
input double            InpWeak12Mult        = 1.00;                 // Legacy 12:00 UTC Mult (1.00 = Neutral)
input double            InpWeak11Mult        = 1.00;                 // Legacy 11:00 UTC Mult (1.00 = Neutral)
input bool              InpUseAsymDirKelly   = false;                // [OFF = Zero-Overfit] Legacy Dir/Day-of-Week Tilt (Disabled)
input double            InpSellEdgeMult      = 1.00;                 // Legacy SELL Mult (1.00 = Symmetric)
input double            InpBuyEdgeMult       = 1.00;                 // Legacy BUY Mult (1.00 = Symmetric)
input double            InpMonEdgeMult       = 1.00;                 // Legacy Monday Mult (1.00 = Symmetric)
input double            InpMidWeekEdgeMult   = 1.00;                 // Legacy MidWeek Mult (1.00 = Symmetric)
input bool              InpSkipDeadPockets   = false;                // [OFF = Zero-Overfit] Legacy Hour/Dir Pocket Exclusion (Disabled)


input group "=== 2. High-Precision Volatility Gate + Unchoked Full-TP ==="
input double            InpMinAtrPct         = 0.115;                // Min M5 ATR (% of Price, Proven High-WR Gate)
input double            InpMaxAtrPct         = 0.650;                // Max M5 ATR (% of Price, Blocks Flash Crash)
input double            InpSlAtrMult         = 1.80;                 // Base Stop-Loss (x M5 ATR)
input double            InpMaxSlAtrMult      = 2.60;                 // Max Stop-Loss Behind Sweep Wick (x ATR)
input double            InpWickPadAtr        = 0.30;                 // Padding Beyond Sweep Wick (x ATR)
input double            InpTpAtrMult         = 1.40;                 // Base Take-Profit (x M5 ATR -> Unchoked TP)
input double            InpMinEntryRrRatio   = 0.62;                 // Min Entry TP/SL Ratio (Skips Negative-EV Wide-Wick Entries)
input double            InpMinTpSlRatio      = 0.00;                 // Adaptive TP Floor (0.0 = Clean Fixed 1.4x ATR TP)
input double            InpMaxTpAtrMult      = 1.90;                 // Max Adaptive TP Ceiling (x M5 ATR)
input double            InpMinSlSpreadMult   = 5.0;                  // Min SL Floor (x Spread)
input bool              InpUseLateBE         = false;                // Breakeven Disabled (Prevents Choking Full TPs!)
input double            InpBeTriggerAtr      = 1.25;                 // BE Trigger Profit (x ATR, if enabled)
input double            InpBeLockAtr         = 0.25;                 // Locked Net Profit at BE (x ATR, if enabled)
input bool              InpUseAtrTrail       = false;                // Optional ATR Trail (False = Clean Full TP)
input double            InpTrailStartAtr     = 1.25;                 // Trail Start (x ATR)
input double            InpTrailDistAtr      = 0.70;                 // Trail Distance (x ATR)
input int               InpMaxHoldBars       = 0;                    // Time Stop in Bars (0 = Disabled)

input group "=== 3. Clean Fractional Kelly Sizing + Optional Profit Bank ==="
input ENUM_GPR_LOT_MODE InpLotMode           = GPR_LOT_DYNAMIC_RISK; // Lot Sizing Mode
input double            InpBaseRiskPct       = 20.00;                // Fractional Kelly Base Risk % (Live Start: 3-5% | Growth: 15-20%)
input double            InpUnderwaterRiskPct = 10.00;                // Below-Start Base Risk % (Live Start: 2-3% | Growth: 10%)
input double            InpWin1Mult          = 1.00;                 // After 1 Win Mult (1.00 = Clean Symmetric Kelly)
input double            InpWin2Mult          = 1.00;                 // After 2 Wins Mult (1.00 = Clean Symmetric Kelly)
input double            InpWin3Mult          = 1.00;                 // After 3+ Wins Mult (1.00 = Clean Symmetric Kelly)
input double            InpLoss1Mult         = 1.00;                 // After 1 Loss Mult (1.00 = Keeps Recovery Power)
input double            InpLoss2Mult         = 1.00;                 // After 2+ Losses Mult (1.00 = Keeps Full Rebound Power)
input double            InpConfluenceBoost   = 1.00;                 // Double-Confluence Boost (1.00 = Disabled / Clean Kelly)
input double            InpMaxRiskCapPct     = 35.00;                // Hard Per-Trade Kelly Risk Ceiling (Live Start: 8-10% | Growth: 35%)
input double            InpSoftDdTier1Pct    = 30.0;                 // Soft DD Shield Tier 1 (% from Peak Bal -> 0.85x)
input double            InpSoftDdTier2Pct    = 50.0;                 // Soft DD Shield Tier 2 (% from Peak Bal -> 0.65x)
input bool              InpUsePrincipalLock  = false;                // Optional Principal Lock (Off = Unchoked Recovery)
input double            InpPrincipalActMult  = 1.45;                 // Activate Principal Lock at Peak >= X * Start (1.45x)
input double            InpPrincipalFloorPct = 100.0;                // Protected Start-Deposit Floor (% of Start, 100%=$1k)
input bool              InpUseProfitBank     = false;                // Optional Virtual Profit Bank (Off = Full Compounding)
input double            InpBankRatchetStart  = 2.50;                 // Continuous Ratchet: Start at Total Bal >= X * Start (2.5x)
input double            InpBankRatchetPct    = 10.0;                 // Continuous Ratchet Tier 1: % Skimmed (2.5x - 6.0x Start)
input double            InpBankRatchetHiMult = 6.00;                 // Progressive Ratchet Tier 2: Start at Total Bal >= X * Start (6.0x)
input double            InpBankRatchetHiPct  = 20.0;                 // Progressive Ratchet Tier 2: % of New High Skimmed Above 6.0x
input double            InpBankMinPeakMult   = 2.00;                 // Deep-Pullback Skim: Min Cycle Peak to Arm (x Cycle Start)
input double            InpBankPullbackPct   = 37.0;                 // Deep-Pullback Skim: Pullback % from Cycle Peak to Trigger
input double            InpBankSavePct       = 60.0;                 // Deep-Pullback Skim: % of Working Capital Locked Forever
input double            InpBankMinWorkUsd    = 1000.0;               // Min Working Capital Kept After Deep Skim ($0 = Pure % Split)
input bool              InpUseProfitVault    = false;                // Legacy High-Water Mark Vault (Used Only if Profit Bank = false)
input double            InpVaultActivateMult = 2.50;                 // Legacy Vault: Activate at Peak >= X * Start Balance
input double            InpVaultFloorPct     = 65.0;                 // Legacy Vault: Protected Peak Floor (% of Peak Balance)
input double            InpVaultTriggerDdPct = 25.0;                 // Legacy Vault: Start Smooth Risk Taper at DD% from Peak
input double            InpVaultMinRiskMult  = 0.35;                 // Principal Lock Min Risk Mult (0.35 Prevents 0.01-Lot Freeze)
input int               InpVaultRebaseDays   = 0;                    // Legacy Vault: Auto-Rebase After N Days Locked (0 = Off)
input double            InpEquityStepUsd     = 100.0;                // Equity per +0.01 Lot (Equity Step Mode)
input double            InpFixedLot          = 0.05;                 // Fixed Lot (Fixed Mode)
input double            InpMaxLotCap         = 200.00;               // Hard Max Lot Cap (Unblocks $500K-$1M+ Scaling)
input double            InpMaxMarginPct      = 75.0;                 // Max Free Margin Usage (%)

input group "=== 4. Non-Stop Daily Protection ==="
input double            InpDailyProfitCapPct = 0.0;                  // Optional Daily Profit Cap % (0 = Unlimited)
input double            InpMaxDailyLossPct   = 15.0;                 // Pause Until Next UTC Day at -X%
input int               InpMaxConsecLosses   = 2;                    // Pause Day After N Same-Day Losses (Stops 3rd Bleed)
input double            InpMaxEquityDdPct    = 0.0;                  // Peak Equity DD Circuit Breaker % (0 = Off, Soft Shield Active)
input int               InpDdPauseDays       = 7;                    // Cooldown Pause Days on Peak DD (0 = Permanent)
input double            InpHardStartLossPct  = 0.0;                  // Hard Permanent Stop % Below Start Deposit (0 = Off)
input int               InpMaxTradesPerDay   = 24;                   // Max Trades Per UTC Day (0 = Off)
input long              InpMagicNumber       = 20268010;             // EA Magic Number (v8.08 LiveChart)
input bool              InpAdoptLegacyMagic  = true;                 // Manage/Display Open Trades From v8.06/v8.07 (20268006/7)
input string            InpMemoryId          = "V810_01";            // State Memory ID (Auto-Isolates State Per Version / Reset)
input bool              InpResetMemoryOnInit = false;                // Reset Current Memory Slot on Startup (Set True Once -> False)
input bool              InpPurgeLegacyMemory = true;                 // Auto-Delete Old GPR*/GP_* Version GlobalVariables on Live Startup
input bool              InpRequireXauUsd     = true;                 // Live Safety: Require XAUUSD/GOLD Symbol (Blocks XAUAUD/XAUEUR)
input bool              InpRequireM5Chart    = true;                 // Live Safety: Require M5 Chart Timeframe (Blocks M10/M15/H1)

input group "=== 5. Liquidity Window, News Shock & Live Calendar ==="
input double            InpMaxSpreadPrice    = 0.60;                 // Max Allowed Spread (Quote Price, 0.60 XAUUSDc Ready)
input double            InpSpreadSpikeMult   = 2.00;                 // Block Spread Spikes (x Median)
input bool              InpUseNewsShockPause = true;                 // Pause Entries After Abnormal News Spike Bar
input double            InpShockBarMult      = 3.50;                 // Shock Bar Threshold (Range > X * ATR)
input int               InpShockPauseMin     = 15;                   // Pause Duration After Shock Bar (minutes)
input bool              InpUseMt5Calendar    = true;                 // Live/Demo Only: Block High-Impact USD News
input int               InpCalBeforeMin      = 15;                   // Minutes Before High-Impact USD Event
input int               InpCalAfterMin       = 15;                   // Minutes After High-Impact USD Event
input bool              InpUseSessionWindow  = true;                 // Trade Peak Liquid Hours Only (False = 24h)
input int               InpSessionStartUTC   = 9;                    // Main Window Start Hour (UTC, Skips 08:00 London Open Trap)
input int               InpSessionEndUTC     = 15;                   // Main Window End Hour (UTC, Skips 15:00 PM Fix / NY Reversal)
input bool              InpAllowLateNyWindow = true;                 // Allow Late NY Impulse Window (17:00-18:00 UTC)
input int               InpLateNyStartUTC    = 17;                   // Late NY Window Start Hour (UTC)
input int               InpLateNyEndUTC      = 18;                   // Late NY Window End Hour (UTC, Exclusive)
input bool              InpBlockRollover     = true;                 // Block UTC Rollover (20:55-23:05)
input bool              InpSkipTuesday       = true;                 // Skip Tuesday (Proven v7.69 Filter; Set False to Test OOS)
input bool              InpCloseOnFriday     = true;                 // Flatten Friday Before Weekend
input int               InpFridayFlatHourUTC = 19;                   // Friday Flatten Hour (UTC)

input group "=== 6. High-Contrast Crisp HUD (macOS/Retina Safe) ==="
input bool              InpShowHud           = true;                 // Show Live CCanvas Dashboard
input ENUM_GPR_CORNER   InpHudCorner         = GPR_CORNER_TOP_LEFT;  // HUD Corner
input double            InpHudScale          = 1.00;                 // HUD Size Scale (1.0 = Standard, 1.25 = Large)
input int               InpHudOffsetX        = 14;                   // Horizontal Offset (px)
input int               InpHudOffsetY        = 28;                   // Vertical Offset (px)
input int               InpHudRefreshMs      = 250;                  // HUD Redraw Throttle (ms)
input bool              InpShowChartOverlay  = true;                 // Draw BB(20,2.0) + Trigger + VWAP on Chart (New Bar Only)
input int               InpChartBbBars       = 288;                  // Chart BB Channel History Bars (288 = Full 24h M5 Day)
input bool              InpShowVwapLine      = true;                 // Show Session VWAP Reference Line on Chart

//+------------------------------------------------------------------+
//| Helper Math                                                      |
//+------------------------------------------------------------------+
double GPR_AlignPrice(const double price, const double tickSize, const int digits)
  {
   if(!MathIsValidNumber(price) || price <= 0.0) return 0.0;
   int d = (digits < 0) ? 0 : ((digits > 8) ? 8 : digits);
   if(!MathIsValidNumber(tickSize) || tickSize <= 0.0) return NormalizeDouble(price, d);
   return NormalizeDouble(MathRound(price / tickSize) * tickSize, d);
  }

double GPR_ClampVol(const double vol, const double vMin, const double vMax, const double vStep)
  {
   if(!MathIsValidNumber(vol) || vol <= 0.0) return 0.0;
   double mn = (vMin > 0.0) ? vMin : 0.01;
   double mx = (vMax >= mn) ? vMax : mn;
   double st = (vStep > 0.0) ? vStep : mn;
   double cl = MathMax(mn, MathMin(mx, vol));
   double steps = MathFloor((cl - mn) / st + 1e-9);
   if(steps < 0.0) steps = 0.0;
   double al = MathMax(mn, MathMin(mx, mn + steps * st));
   int d = 0; double probe = st;
   while(d < 8 && MathAbs(probe - MathRound(probe)) > 1e-7) { probe *= 10.0; d++; }
   return NormalizeDouble(al, d);
  }

//+------------------------------------------------------------------+
//| Structs                                                          |
//+------------------------------------------------------------------+
struct SGprSpecs
  {
   int    digits;
   double point, tickSize, tickValue, contractSize, volMin, volMax, volStep;
   long   stopsPts, freezePts, exeMode, fillMask;
   void Reset()
     {
      digits = 3; point = 0.001; tickSize = 0.001; tickValue = 0.0; contractSize = 100.0;
      volMin = 0.01; volMax = 100.0; volStep = 0.01; stopsPts = 0; freezePts = 0; exeMode = 0; fillMask = 0;
     }
   SGprSpecs() { Reset(); }
  };

struct SGprDaily
  {
   int    utcYear, utcDay, trades, wins, consecLoss, consecWins;
   double dayStartEq, peakBal, peakEq, closedPnl, floatingPnl;
   bool   blocked, killSwitch;
   string reason;
   void Reset()
     {
      utcYear = -1; utcDay = -1; trades = 0; wins = 0; consecLoss = 0; consecWins = 0;
      dayStartEq = 0.0; peakBal = 0.0; peakEq = 0.0; closedPnl = 0.0; floatingPnl = 0.0;
      blocked = false; killSwitch = false; reason = "";
     }
   SGprDaily() { Reset(); }
  };

struct SGprRect
  {
   int x1, y1, x2, y2;
   void Set(const int l, const int t, const int r, const int b) { x1 = l; y1 = t; x2 = r; y2 = b; }
   bool Contains(const int x, const int y) const { return (x >= x1 && x <= x2 && y >= y1 && y <= y2); }
   void Reset() { x1 = y1 = x2 = y2 = 0; }
   SGprRect() { Reset(); }
  };

//+------------------------------------------------------------------+
//| Rolling Spread & Spike Guard                                     |
//+------------------------------------------------------------------+
class CGprSpreadGuard
  {
private:
   double m_ring[GPR_SPREAD_RING];
   double m_sorted[GPR_SPREAD_RING];
   int    m_head, m_count;
public:
   double lastSpread, medianSpread;
   bool   spreadOk, spikeBlocked;

   CGprSpreadGuard() { Reset(); }
   void Reset()
     {
      m_head = 0; m_count = 0; lastSpread = 0.0; medianSpread = 0.0; spreadOk = false; spikeBlocked = false;
      for(int i = 0; i < GPR_SPREAD_RING; i++) { m_ring[i] = 0.0; m_sorted[i] = 0.0; }
     }
   void Update(const MqlTick &tk, const double maxSpread, const double spikeMult, const double pt)
     {
      if(!MathIsValidNumber(tk.bid) || !MathIsValidNumber(tk.ask) || tk.bid <= 0.0 || tk.ask < tk.bid)
        { spreadOk = false; spikeBlocked = true; return; }
      double sp = tk.ask - tk.bid;
      lastSpread = sp;
      m_ring[m_head] = sp;
      m_head = (m_head + 1) % GPR_SPREAD_RING;
      if(m_count < GPR_SPREAD_RING) m_count++;

      for(int i = 0; i < m_count; i++) m_sorted[i] = m_ring[i];
      for(int i = 1; i < m_count; i++)
        {
         double key = m_sorted[i]; int j = i - 1;
         while(j >= 0 && m_sorted[j] > key) { m_sorted[j + 1] = m_sorted[j]; j--; }
         m_sorted[j + 1] = key;
        }
      double med = ((m_count % 2) == 1) ? m_sorted[m_count / 2]
                                        : 0.5 * (m_sorted[m_count / 2 - 1] + m_sorted[m_count / 2]);
      medianSpread = med;
      double base  = MathMax(med, pt * 20.0);
      spikeBlocked = (m_count >= 5 && spikeMult > 0.0 && sp > spikeMult * base + 1e-12);
      spreadOk     = (!spikeBlocked && (maxSpread <= 0.0 || sp <= maxSpread + 1e-9));
     }
  };

//+------------------------------------------------------------------+
//| Crisp High-Contrast Single-Bitmap CCanvas HUD (macOS/Wine Safe)  |
//+------------------------------------------------------------------+
class CGprHud
  {
private:
   CCanvas         m_canvas;
   long            m_chartId;
   string          m_objName;
   ENUM_GPR_CORNER m_corner;
   int             m_offX, m_offY, m_x, m_y, m_w, m_hFull, m_hMin, m_hCur;
   double          m_scale;
   bool            m_created, m_min, m_confirmClose;
   datetime        m_confirmUntil;
   ulong           m_lastDrawMs;
   int             m_refreshMs;
   string          m_lastRenderSig;
   SGprRect        m_btnMin, m_btnPause, m_btnClose;

   uint Argb(const uchar a, const uchar r, const uchar g, const uchar b) const
     { return (((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | (uint)b); }
   int S(const int px) const
     { int v = (int)MathRound((double)px * m_scale); return (v < 1) ? 1 : v; }

   void ComputePos()
     {
      long cw = ChartGetInteger(m_chartId, CHART_WIDTH_IN_PIXELS, 0);
      long ch = ChartGetInteger(m_chartId, CHART_HEIGHT_IN_PIXELS, 0);
      if(cw <= 0) cw = 1280;
      if(ch <= 0) ch = 720;
      m_x = m_offX; m_y = m_offY;
      if(m_corner == GPR_CORNER_TOP_RIGHT)         m_x = (int)cw - m_w - m_offX;
      else if(m_corner == GPR_CORNER_BOTTOM_LEFT)  m_y = (int)ch - m_hCur - m_offY;
      else if(m_corner == GPR_CORNER_BOTTOM_RIGHT) { m_x = (int)cw - m_w - m_offX; m_y = (int)ch - m_hCur - m_offY; }
      if(m_x < 4) m_x = 4;
      if(m_y < 4) m_y = 4;
     }

   void FillRectSafe(const int x1, const int y1, const int x2, const int y2, const uint col)
     { if(x2 >= x1 && y2 >= y1) m_canvas.FillRectangle(x1, y1, x2, y2, col); }

   void DrawBorderSafe(const int x1, const int y1, const int x2, const int y2, const uint col)
     {
      if(x2 < x1 || y2 < y1) return;
      m_canvas.LineHorizontal(x1, x2, y1, col);
      m_canvas.LineHorizontal(x1, x2, y2, col);
      m_canvas.LineVertical(x1, y1, y2, col);
      m_canvas.LineVertical(x2, y1, y2, col);
     }

   // Trailing-space padding prevents macOS/Wine GDI glyph-width clipping
   void TextL(const int x, const int y, const string txt, const uint col)
     { m_canvas.TextOut(x, y, txt + "    ", col, TA_LEFT | TA_TOP); }

   void TextC(const int x, const int y, const string txt, const uint col)
     { m_canvas.TextOut(x, y, "  " + txt + "  ", col, TA_CENTER | TA_VCENTER); }

   void DrawPill(const int x1, const int y1, const int x2, const int y2,
                 const string label, const uint bg, const uint brd, const uint fg)
     {
      FillRectSafe(x1, y1, x2, y2, bg);
      DrawBorderSafe(x1, y1, x2, y2, brd);
      m_canvas.FontSet("Arial", -S(90), FW_BOLD);
      TextC((x1 + x2) / 2, (y1 + y2) / 2, label, fg);
     }

   void DrawButton(const SGprRect &rc, const string label, const uint bg, const uint brd, const uint fg)
     {
      FillRectSafe(rc.x1, rc.y1, rc.x2, rc.y2, bg);
      DrawBorderSafe(rc.x1, rc.y1, rc.x2, rc.y2, brd);
      m_canvas.FontSet("Arial", -S(95), FW_BOLD);
      TextC((rc.x1 + rc.x2) / 2, (rc.y1 + rc.y2) / 2, label, fg);
     }

public:
   CGprHud()
     {
      m_chartId = 0; m_objName = ""; m_corner = GPR_CORNER_TOP_LEFT;
      m_offX = 12; m_offY = 24; m_x = 12; m_y = 24;
      m_w = 416; m_hFull = 424; m_hMin = 36; m_hCur = 424;
      m_scale = 1.0; m_created = false; m_min = false; m_confirmClose = false;
      m_confirmUntil = 0; m_lastDrawMs = 0; m_refreshMs = 250; m_lastRenderSig = "";
     }

   bool Create(const long chartId, const string sym, const ENUM_GPR_CORNER corner,
               const double userScale, const int ox, const int oy, const int refreshMs)
     {
      m_chartId = chartId; m_corner = corner; m_offX = ox; m_offY = oy;
      m_refreshMs = (refreshMs < 100) ? 100 : refreshMs;
      int dpi = (int)TerminalInfoInteger(TERMINAL_SCREEN_DPI);
      if(dpi <= 0) dpi = 96;
      double dpiScale = MathMax(1.0, MathMin(1.30, (double)dpi / 96.0));
      double uScale   = MathMax(0.75, MathMin(1.50, userScale));
      m_scale = dpiScale * uScale;
      m_w = S(416); m_hFull = S(424); m_hMin = S(36); m_hCur = m_hFull;
      m_objName = "GPR810_HUD_" + sym;
      ComputePos();
      if(ObjectFind(m_chartId, m_objName) >= 0) ObjectDelete(m_chartId, m_objName);
      if(!m_canvas.CreateBitmapLabel(m_chartId, 0, m_objName, m_x, m_y, m_w, m_hCur, COLOR_FORMAT_ARGB_NORMALIZE))
         return false;
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_HIDDEN, true);
      m_created = true;
      return true;
     }

   void Destroy()
     {
      if(m_created) { m_canvas.Destroy(); m_created = false; }
      if(m_objName != "" && ObjectFind(m_chartId, m_objName) >= 0) ObjectDelete(m_chartId, m_objName);
     }

   void Reposition()
     {
      if(!m_created) return;
      int oldX = m_x, oldY = m_y;
      ComputePos();
      if(m_x == oldX && m_y == oldY) return;
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_XDISTANCE, m_x);
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_YDISTANCE, m_y);
     }

   void DrawCell(const int x, const int y, const string lbl, const string val, const uint valCol)
     {
      m_canvas.FontSet("Arial", -S(74), FW_BOLD);
      TextL(x, y + S(4), lbl, Argb(255, 158, 176, 204));
      m_canvas.FontSet("Arial", -S(98), FW_BOLD);
      TextL(x, y + S(17), val, valCol);
     }

   void Draw(const bool force, const string sym, const bool paused,
             const bool algoOn, const bool mktOpen, const bool isTester,
             const string statusTxt, const string biasTxt, const double rsiVal,
             const double erVal, const double vwapZVal, const double atrPctVal,
             const string riskModeTxt, const string waitTxt,
             const double riskPct, const double lotVal, const double spreadVal,
             const double ddPct, const double balVal, const double workCapVal,
             const double bankVal, const bool bankOn,
             const string memTxt, const bool memFresh,
             const int openPos, const int runWins, const int runLoss, const SGprDaily &dy)
     {
      if(!m_created) return;
      ulong nowMs = GetTickCount64();
      if(!force && (nowMs - m_lastDrawMs) < (ulong)m_refreshMs) return;
      if(m_confirmClose && TimeCurrent() > m_confirmUntil) m_confirmClose = false;
      string curSig = StringFormat("%d|%d|%d|%s|%s|%.1f|%.2f|%.2f|%.2f|%s|%s|%.1f|%.2f|%.2f|%.1f|%.0f|%.0f|%d|%d|%d|%d|%d",
                                   m_min ? 1 : 0, paused ? 1 : 0, algoOn ? 1 : 0,
                                   statusTxt, biasTxt, rsiVal, erVal, vwapZVal, atrPctVal,
                                   waitTxt, memTxt, riskPct, lotVal, spreadVal, ddPct,
                                   balVal, bankVal, openPos, runWins, runLoss, dy.trades, m_confirmClose ? 1 : 0);
      if(!force && curSig == m_lastRenderSig && (nowMs - m_lastDrawMs) < 2000) return;
      m_lastDrawMs    = nowMs;
      m_lastRenderSig = curSig;

      int tgtH = m_min ? m_hMin : m_hFull;
      if(tgtH != m_hCur)
        {
         m_hCur = tgtH;
         m_canvas.Resize(m_w, m_hCur);
         Reposition();
        }

      // Exact 1-to-1 Unified HUD Palette (100% opaque)
      uint cBg     = Argb(255, 11, 15, 24);
      uint cHdr    = Argb(255, 18, 28, 46);
      uint cCard   = Argb(255, 17, 24, 38);
      uint cBrd    = Argb(255, 62, 92, 134);
      uint cHair   = Argb(255, 42, 60, 88);
      uint cSky    = Argb(255, 86, 212, 255);
      uint cGold   = Argb(255, 255, 206, 68);
      uint cTxt    = Argb(255, 248, 250, 255);
      uint cMut    = Argb(255, 158, 176, 204);
      uint cGrn    = Argb(255, 58, 235, 148);
      uint cGrnBg  = Argb(255, 16, 56, 40);
      uint cRed    = Argb(255, 255, 96, 112);
      uint cRedBg  = Argb(255, 80, 20, 30);
      uint cAmb    = Argb(255, 255, 196, 64);
      uint cAmbBg  = Argb(255, 72, 52, 16);
      uint cBtnBg  = Argb(255, 32, 48, 76);

      m_canvas.Erase(cBg);
      FillRectSafe(0, 0, m_w - 1, m_hCur - 1, cBg);
      DrawBorderSafe(0, 0, m_w - 1, m_hCur - 1, cBrd);

      // Header bar
      int hdrH = S(36);
      FillRectSafe(1, 1, m_w - 2, hdrH, cHdr);
      m_canvas.LineHorizontal(1, m_w - 2, hdrH, cBrd);

      m_canvas.FontSet("Arial", -S(105), FW_BOLD);
      TextL(S(12), S(9), "GOLDPULSE " + GPR_EA_VERSION + "  " + sym + " M5", cSky);

      m_btnMin.Set(m_w - S(32), S(6), m_w - S(8), S(30));
      DrawButton(m_btnMin, m_min ? "+" : "-", cBtnBg, cBrd, cTxt);

      if(m_min) { m_canvas.Update(true); return; }

      int p = S(10);
      int y = hdrH + S(8);

      // Row 1: ALGO & MARKET pills
      int pillGap = S(8);
      int pillW   = (m_w - p * 2 - pillGap) / 2;
      int pillH   = S(24);
      string algoLbl = isTester ? "ALGO: TESTER" : (algoOn ? "ALGO: ON" : "ALGO: OFF!");
      DrawPill(p, y, p + pillW, y + pillH, algoLbl,
               (isTester || algoOn) ? cGrnBg : cRedBg,
               (isTester || algoOn) ? cGrn   : cRed,
               (isTester || algoOn) ? cGrn   : cRed);

      string mktLbl = mktOpen ? "MKT: OPEN" : "MKT: CLOSED";
      DrawPill(p + pillW + pillGap, y, m_w - p, y + pillH, mktLbl,
               mktOpen ? cGrnBg : cAmbBg,
               mktOpen ? cGrn   : cAmb,
               mktOpen ? cGrn   : cAmb);
      y += pillH + S(8);

      // Row 2: Clean standalone STATE line
      string stateShow = statusTxt;
      uint cStat = cGrn;
      if(!isTester && !algoOn)                                 { stateShow = "ENABLE ALGO TRADING"; cStat = cRed; }
      else if(StringFind(stateShow, "WRONG_SYMBOL") == 0 || StringFind(stateShow, "WRONG_TF") == 0) { cStat = cRed; }
      else if(!mktOpen)                                        { stateShow = "MARKET CLOSED";       cStat = cAmb; }
      else if(paused)                                          { cStat = cAmb; }
      else if(dy.blocked || stateShow == "HIGH_SPREAD" || stateShow == "SPREAD_SPIKE") { cStat = cRed; }
      else if(StringFind(stateShow, "OFF_SESSION") == 0 || StringFind(stateShow, "LOW_VOL") == 0 ||
              StringFind(stateShow, "TUE_SKIP") == 0    || StringFind(stateShow, "ROLLOVER") == 0 ||
              StringFind(stateShow, "NEWS_SHOCK") == 0  || StringFind(stateShow, "FRI_FLAT") == 0 ||
              StringFind(stateShow, "IN TRADE (DAY LOCK)") == 0) { cStat = cAmb; }

      m_canvas.FontSet("Arial", -S(98), FW_BOLD);
      TextL(p + S(2), y, "STATE: " + stateShow, cStat);
      y += S(21);

      // Card 1: 2-Column Market Telemetry Grid (3 rows x 38px)
      int c1H = S(114);
      int midX = m_w / 2;
      int col1 = p + S(10);
      int col2 = midX + S(10);
      FillRectSafe(p, y, m_w - p, y + c1H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c1H, cBrd);
      m_canvas.LineVertical(midX, y + S(6), y + c1H - S(6), cHair);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(38), cHair);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(76), cHair);

      uint cBias = (StringFind(biasTxt, "BULL") >= 0) ? cGrn : ((StringFind(biasTxt, "BEAR") >= 0) ? cSky : cAmb);
      DrawCell(col1, y + S(2),  "MACRO TREND", biasTxt, cBias);
      DrawCell(col2, y + S(2),  "RSI(7) / H1 ER", DoubleToString(rsiVal, 1) + " | " + DoubleToString(erVal, 2), cTxt);

      DrawCell(col1, y + S(40), "RISK / MODEL", DoubleToString(riskPct, 1) + "% | " + riskModeTxt, cGold);
      DrawCell(col2, y + S(40), "SPREAD / LAST LOT", "$" + DoubleToString(spreadVal, 2) + " | " + DoubleToString(lotVal, 2) + "L", cTxt);

      string streakStr = (runWins > 0) ? ("HOT W" + IntegerToString(runWins))
                                       : ((runLoss > 0) ? ("COLD L" + IntegerToString(runLoss)) : "FLAT");
      DrawCell(col1, y + S(78), "STREAK / OPEN", streakStr + " | " + IntegerToString(openPos) + " pos", cTxt);
      DrawCell(col2, y + S(78), "TRADES / ATR%", IntegerToString(dy.trades) + " (" + IntegerToString(dy.wins) + "W) | " + DoubleToString(atrPctVal, 2) + "%", cTxt);
      y += c1H + S(8);

      // Card 2: Capital & Day PnL Grid (2 rows x 38px)
      int c2H = S(76);
      FillRectSafe(p, y, m_w - p, y + c2H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c2H, cBrd);
      m_canvas.LineVertical(midX, y + S(6), y + c2H - S(6), cHair);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(38), cHair);

      bool isCentAcc = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
      string cPre    = isCentAcc ? ShortToString(0x00A2) : "$";
      string cSuf    = "";
      double totalDay = dy.closedPnl + dy.floatingPnl;
      uint cDay = (totalDay >= 0.0) ? cGrn : cRed;

      DrawCell(col1, y + S(2), "DAY P&L",
               ((totalDay >= 0.0) ? "+" : "-") + cPre + DoubleToString(MathAbs(totalDay), 2) + cSuf, cDay);
      DrawCell(col2, y + S(2), "DRAWDOWN (BAL)", DoubleToString(ddPct, 1) + "%", cTxt);

      DrawCell(col1, y + S(40), "BALANCE / WORK",
               cPre + DoubleToString(balVal, 0) + cSuf + " / " + cPre + DoubleToString(workCapVal, 0) + cSuf, cTxt);
      DrawCell(col2, y + S(40), "PROFIT BANK",
               bankOn ? (cPre + DoubleToString(bankVal, 0) + cSuf + " (LOCKED)") : (cPre + "0" + cSuf + " (WAIT)"),
               bankOn ? cGold : cMut);
      y += c2H + S(8);

      // Card 3: Next Entry Condition / Active Position Est. P&L
      int c3H = S(44);
      FillRectSafe(p, y, m_w - p, y + c3H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c3H, cBrd);
      m_canvas.FontSet("Arial", -S(74), FW_BOLD);
      TextL(p + S(10), y + S(5), (openPos > 0) ? "ACTIVE POSITION (EST. P&L)" : "NEXT ENTRY CONDITION", cSky);
      m_canvas.FontSet("Arial", -S(96), FW_BOLD);
      TextL(p + S(10), y + S(19), waitTxt, (openPos > 0) ? cGold : cTxt);
      y += c3H + S(8);

      // Action buttons
      int btnW = (m_w - p * 3) / 2;
      int btnH = S(32);
      m_btnPause.Set(p, y, p + btnW, y + btnH);
      m_btnClose.Set(p * 2 + btnW, y, m_w - p, y + btnH);

      DrawButton(m_btnPause, paused ? "RESUME" : "PAUSE",
                 paused ? cAmbBg : cBtnBg, paused ? cAmb : cBrd, cTxt);
      DrawButton(m_btnClose, m_confirmClose ? "CONFIRM?" : "CLOSE ALL",
                 m_confirmClose ? Argb(255, 185, 38, 52) : Argb(255, 130, 32, 44), cRed, cTxt);

      // Footer
      m_canvas.FontSet("Arial", -S(82), FW_NORMAL);
      TextL(p + S(2), y + btnH + S(7), "MEMORY: " + memTxt, memFresh ? cGrn : cMut);

      m_canvas.Update(true);
     }

   int HandleClick(const int cx, const int cy)
     {
      if(!m_created) return 0;
      int lx = cx - m_x, ly = cy - m_y;
      if(lx < 0 || ly < 0 || lx > m_w || ly > m_hCur) return 0;
      if(m_btnMin.Contains(lx, ly)) { m_min = !m_min; m_confirmClose = false; return 1; }
      if(m_min) return 0;
      if(m_btnPause.Contains(lx, ly)) { m_confirmClose = false; return 2; }
      if(m_btnClose.Contains(lx, ly))
        {
         if(!m_confirmClose) { m_confirmClose = true; m_confirmUntil = TimeCurrent() + 5; return 1; }
         m_confirmClose = false; return 3;
        }
      return 0;
     }
  };

//+------------------------------------------------------------------+
//| Globals                                                          |
//+------------------------------------------------------------------+
CTrade          g_trade;
SGprSpecs       g_spec;
SGprDaily       g_day;
CGprSpreadGuard g_spread;
CGprHud         g_hud;

int      g_hAtrSig         = INVALID_HANDLE;
int      g_hBbSig          = INVALID_HANDLE;
int      g_hRsiSig         = INVALID_HANDLE;
int      g_hEmaFastH1      = INVALID_HANDLE;
int      g_hEmaSlowH1      = INVALID_HANDLE;
int      g_hEmaFastH4      = INVALID_HANDLE;
int      g_hEmaSlowH4      = INVALID_HANDLE;

bool     g_paused          = false;
bool     g_isVisual        = true;
bool     g_isTester        = false;
int      g_prevOpenPos     = 0;
int      g_runConsecWins   = 0;     // Persistent multi-day Markov hot-streak counter
int      g_runConsecLoss   = 0;     // Persistent multi-day Markov cold-streak counter
datetime g_lastSigBar      = 0;
datetime g_lastCloseTime   = 0;
bool     g_lastTradeLoss   = false;
long     g_activeLogin     = 0;
string   g_activeCurrency  = "";
double   g_startBalance    = 0.0;
double   g_bankedProfit    = 0.0;
double   g_cycleStart      = 0.0;
double   g_hwmTotalBal     = 0.0;
int      g_bankSkimCount   = 0;
double   g_vaultFloorBal   = 0.0;
bool     g_vaultActive     = false;
datetime g_shockPauseUntil = 0;
datetime g_ddPauseUntil    = 0;
datetime g_vaultLockedSince = 0;
datetime g_lastCalCheck    = 0;
bool     g_calBlocked      = false;
double   g_lastAtrVal      = 0.0;
double   g_lastAtrPct      = 0.0;
double   g_lastRsiVal      = 50.0;
double   g_lastLotVal      = 0.0;
double   g_lastRiskPct     = 9.0;
double   g_lastDdPct       = 0.0;
double   g_lastShieldMult  = 1.0;
string   g_biasTxt         = "INIT";
string   g_volStatus       = "";
double   g_lastH1Er        = 0.0;
double   g_lastVwapZ       = 0.0;
double          g_batchPnl        = 0.0;
double          g_retRing[32];
int             g_retHead         = 0;
int             g_retCount        = 0;
double          g_lastEdgeMult    = 1.0;
double          g_lastVolMult     = 1.0;
bool            g_symbolOk        = true;
bool            g_tfOk            = true;
string          g_memBadge        = "FRESH";
int             g_memPurged       = 0;
string          g_waitTxt         = "Initializing...";
datetime        g_lastOverlayBar  = 0;
ulong           g_lastHudEvalMs   = 0;
ulong           g_lastChartChgMs  = 0;
string          g_lastSkipTxt     = "";
datetime        g_lastSkipUntil   = 0;

//+------------------------------------------------------------------+
//| Broker Specs & Filling                                           |
//+------------------------------------------------------------------+
bool RefreshSpecs()
  {
   g_spec.Reset();
   long dg = 0;
   if(!SymbolInfoInteger(_Symbol, SYMBOL_DIGITS, dg)) return false;
   g_spec.digits = (int)dg;
   if(!SymbolInfoDouble(_Symbol, SYMBOL_POINT, g_spec.point) || g_spec.point <= 0.0) return false;
   SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE,     g_spec.tickSize);
   SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE,    g_spec.tickValue);
   SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE, g_spec.contractSize);
   SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN,          g_spec.volMin);
   SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX,          g_spec.volMax);
   SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP,         g_spec.volStep);
   SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL,  g_spec.stopsPts);
   SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL, g_spec.freezePts);
   SymbolInfoInteger(_Symbol, SYMBOL_TRADE_EXEMODE,      g_spec.exeMode);
   SymbolInfoInteger(_Symbol, SYMBOL_FILLING_MODE,       g_spec.fillMask);
   if(g_spec.tickSize <= 0.0) g_spec.tickSize = g_spec.point;
   if(g_spec.volMin <= 0.0)   g_spec.volMin   = 0.01;
   if(g_spec.volMax < g_spec.volMin) g_spec.volMax = g_spec.volMin;
   if(g_spec.volStep <= 0.0)  g_spec.volStep  = g_spec.volMin;
   return true;
  }

void ConfigureFilling()
  {
   if((g_spec.fillMask & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      g_trade.SetTypeFilling(ORDER_FILLING_IOC);
   else if((g_spec.fillMask & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      g_trade.SetTypeFilling(ORDER_FILLING_FOK);
   else
      g_trade.SetTypeFilling(ORDER_FILLING_RETURN);
  }

bool IsOurMagic(const long mg)
  {
   if(mg == InpMagicNumber) return true;
   if(InpAdoptLegacyMagic && (mg == 20268006 || mg == 20268007 || mg == 20268008 || mg == 20268009)) return true;
   return false;
  }

int CountOurPositions(double &outFloatPnl)
  {
   outFloatPnl = 0.0;
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      cnt++;
      outFloatPnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   return cnt;
  }

void CloseAllOurPositions()
  {
   ConfigureFilling();
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(35);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      g_trade.PositionClose(tk);
     }
  }

//+------------------------------------------------------------------+
//| Live-Only MT5 Built-In Economic Calendar Guard (High-Impact USD) |
//+------------------------------------------------------------------+
bool IsMt5CalendarNewsWindow()
  {
   if(!InpUseMt5Calendar || g_isTester) return false;
   datetime nowSrv = TimeTradeServer();
   if(nowSrv <= 0) nowSrv = TimeCurrent();
   if(g_lastCalCheck > 0 && (nowSrv - g_lastCalCheck) < 60)
      return g_calBlocked;

   g_lastCalCheck = nowSrv;
   g_calBlocked   = false;

   datetime fromTm = nowSrv - MathMax(1, InpCalAfterMin) * 60;
   datetime toTm   = nowSrv + MathMax(1, InpCalBeforeMin) * 60;

   MqlCalendarValue vals[];
   int n = CalendarValueHistory(vals, fromTm, toTm, NULL, "USD");
   if(n <= 0) return false;

   for(int i = 0; i < n; i++)
     {
      MqlCalendarEvent ev;
      if(CalendarEventById(vals[i].event_id, ev))
        {
         if(ev.importance == CALENDAR_IMPORTANCE_HIGH)
           {
            g_calBlocked = true;
            return true;
           }
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Session & Rollover Guard (Proven v6/v7 Peak Liquidity Window)    |
//+------------------------------------------------------------------+
bool IsInTradingWindow(string &whyBlocked)
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int mins = dt.hour * 60 + dt.min;

   if(InpSkipTuesday && dt.day_of_week == 2)
     { whyBlocked = "TUE_SKIP"; return false; }

   if(InpCloseOnFriday && dt.day_of_week == 5 && dt.hour >= InpFridayFlatHourUTC)
     { whyBlocked = "FRI_FLAT"; return false; }

   if(InpBlockRollover && (mins >= 20 * 60 + 55 && mins <= 23 * 60 + 5))
     { whyBlocked = "ROLLOVER"; return false; }

   if(InpUseSessionWindow)
     {
      bool inMain   = (dt.hour >= InpSessionStartUTC && dt.hour < InpSessionEndUTC);
      bool inLateNy = (InpAllowLateNyWindow && dt.hour >= InpLateNyStartUTC && dt.hour < InpLateNyEndUTC);
      if(!inMain && !inLateNy)
        { whyBlocked = "OFF_SESSION"; return false; }
     }

   if(InpUseSessionEdge)
     {
      if(dt.hour == 12 && InpWeak12Mult <= 0.0) { whyBlocked = "H12_SKIP"; return false; }
      if(dt.hour == 11 && InpWeak11Mult <= 0.0) { whyBlocked = "H11_SKIP"; return false; }
     }

   whyBlocked = "";
   return true;
  }

//+------------------------------------------------------------------+
//| Quant Math 1: Kaufman Efficiency Ratio (ER) on H1                |
//+------------------------------------------------------------------+
bool ComputeKaufmanER(const ENUM_TIMEFRAMES tf, const int period, double &outEr)
  {
   outEr = 1.0;
   int n = MathMax(4, MathMin(100, period));
   double cls[];
   ArraySetAsSeries(cls, true);
   if(CopyClose(_Symbol, tf, 1, n + 1, cls) < (n + 1)) return false;

   double netMove = MathAbs(cls[0] - cls[n]);
   double sumPath = 0.0;
   for(int i = 0; i < n; i++)
      sumPath += MathAbs(cls[i] - cls[i + 1]);

   if(sumPath <= 1e-12) { outEr = 0.0; return true; }
   outEr = netMove / sumPath;
   return true;
  }

//+------------------------------------------------------------------+
//| Quant Math 2: Intraday Session VWAP & Z-Score (since 00:00 UTC)  |
//+------------------------------------------------------------------+
bool ComputeSessionVwapZ(const ENUM_TIMEFRAMES tf, double &outVwap, double &outZ)
  {
   outVwap = 0.0; outZ = 0.0;
   int barSec = PeriodSeconds(tf);
   if(barSec <= 0) barSec = 300;
   int maxBars = MathMin(300, MathMax(24, 86400 / barSec + 2));

   MqlRates rt[];
   ArraySetAsSeries(rt, true);
   int copied = CopyRates(_Symbol, tf, 1, maxBars, rt);
   if(copied < 6) return false;

   MqlDateTime curDt;
   TimeToStruct(rt[0].time, curDt);
   int curDay = curDt.day_of_year;
   int curYr  = curDt.year;

   double sumPV = 0.0, sumV = 0.0;
   int used = 0;
   for(int i = 0; i < copied; i++)
     {
      MqlDateTime bdt;
      TimeToStruct(rt[i].time, bdt);
      if(bdt.year != curYr || bdt.day_of_year != curDay) break;
      double tp = (rt[i].high + rt[i].low + rt[i].close) / 3.0;
      double v  = (rt[i].tick_volume > 0) ? (double)rt[i].tick_volume : 1.0;
      sumPV += tp * v;
      sumV  += v;
      used++;
     }

   if(used < 6 || sumV <= 0.0) return false;
   double vwap = sumPV / sumV;

   double sumVarV = 0.0;
   for(int i = 0; i < used; i++)
     {
      double tp   = (rt[i].high + rt[i].low + rt[i].close) / 3.0;
      double v    = (rt[i].tick_volume > 0) ? (double)rt[i].tick_volume : 1.0;
      double diff = tp - vwap;
      sumVarV    += diff * diff * v;
     }

   double sigma = MathSqrt(sumVarV / sumV);
   if(!MathIsValidNumber(sigma) || sigma <= g_spec.point * 10.0) return false;

   outVwap = vwap;
   outZ    = (rt[0].close - vwap) / sigma;
   return MathIsValidNumber(outZ);
  }

//+------------------------------------------------------------------+
//| Quant Math 3: Parkinson High-Low Volatility Estimator (Price)    |
//+------------------------------------------------------------------+
bool ComputeParkinsonVolPrice(const ENUM_TIMEFRAMES tf, const int period, const double refPrice, double &outVolPx)
  {
   outVolPx = 0.0;
   if(refPrice <= 0.0) return false;
   int n = MathMax(5, MathMin(60, period));
   MqlRates rt[];
   ArraySetAsSeries(rt, true);
   if(CopyRates(_Symbol, tf, 1, n, rt) < n) return false;

   double sumSq = 0.0;
   int valid = 0;
   for(int i = 0; i < n; i++)
     {
      if(rt[i].high <= 0.0 || rt[i].low <= 0.0 || rt[i].high < rt[i].low) continue;
      double lr = MathLog(rt[i].high / rt[i].low);
      sumSq += lr * lr;
      valid++;
     }
   if(valid < 5) return false;

   // Parkinson sigma scaled by sqrt(8/pi) ~= 1.5958 to match ATR range scale
   double sigmaRel = MathSqrt(sumSq / (4.0 * (double)valid * 0.69314718056));
   outVolPx = refPrice * sigmaRel * 1.595769;
   return (MathIsValidNumber(outVolPx) && outVolPx > 0.0);
  }

//+------------------------------------------------------------------+
//| Scale-Invariant High-Precision Volatility Gate (v6/v7)           |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| ApexEdge 1: Asia Session Box (00:00-08:00 UTC)                   |
//+------------------------------------------------------------------+
bool ComputeAsiaRange(double &outHi, double &outLo)
  {
   outHi = 0.0; outLo = 0.0;
   MqlRates m15[];
   ArraySetAsSeries(m15, true);
   int copied = CopyRates(_Symbol, PERIOD_M15, 1, 96, m15);
   if(copied < 12) return false;

   MqlDateTime nowDt;
   TimeToStruct(m15[0].time, nowDt);
   int curYr = nowDt.year, curDay = nowDt.day_of_year;

   double hi = -1e18, lo = 1e18;
   int cnt = 0;
   for(int i = 0; i < copied; i++)
     {
      MqlDateTime bdt;
      TimeToStruct(m15[i].time, bdt);
      if(bdt.year != curYr || bdt.day_of_year != curDay)
        {
         if(cnt > 0) break;
         continue;
        }
      if(bdt.hour >= 0 && bdt.hour < 8)
        {
         if(m15[i].high > hi) hi = m15[i].high;
         if(m15[i].low  < lo) lo = m15[i].low;
         cnt++;
        }
     }
   if(cnt < 8 || hi <= lo) return false;
   outHi = hi; outLo = lo;
   return true;
  }

//+------------------------------------------------------------------+
//| ApexEdge 1: Inverted Liquidity Trap Detector (Asia + PDH/PDL)    |
//+------------------------------------------------------------------+
bool IsLiquidityTrapSweep(const bool isBuy, const MqlRates &r[], const double atr)
  {
   if(!InpBlockLiqTrap || atr <= 0.0) return false;
   double zone = atr * MathMax(0.05, InpLiqTrapZoneAtr);

   double asiaHi = 0.0, asiaLo = 0.0;
   bool hasAsia = ComputeAsiaRange(asiaHi, asiaLo);
   double pdh = iHigh(_Symbol, PERIOD_D1, 1);
   double pdl = iLow(_Symbol, PERIOD_D1, 1);

   double barRng = MathMax(g_spec.point, r[0].high - r[0].low);

   if(isBuy)
     {
      double lowWick = (MathMin(r[0].open, r[0].close) - r[0].low) / barRng;
      double swpLo   = MathMin(r[0].low, r[1].low);
      bool sweptAsia = (hasAsia && swpLo <= asiaLo + zone && r[0].close >= asiaLo - zone * 0.5);
      bool sweptPdl  = (pdl > 0.0 && swpLo <= pdl + zone && r[0].close >= pdl - zone * 0.5);
      return ((sweptAsia || sweptPdl) && (lowWick >= 0.25 || r[0].close > r[0].open));
     }
   else
     {
      double upWick  = (r[0].high - MathMax(r[0].open, r[0].close)) / barRng;
      double swpHi   = MathMax(r[0].high, r[1].high);
      bool sweptAsia = (hasAsia && swpHi >= asiaHi - zone && r[0].close <= asiaHi + zone * 0.5);
      bool sweptPdh  = (pdh > 0.0 && swpHi >= pdh - zone && r[0].close <= pdh + zone * 0.5);
      return ((sweptAsia || sweptPdh) && (upWick >= 0.25 || r[0].close < r[0].open));
     }
  }

//+------------------------------------------------------------------+
//| ApexEdge 3A: Short/Long Volatility Shock Dampener                |
//+------------------------------------------------------------------+
double ComputeVolShockMult()
  {
   if(!InpUseQuantKelly) { g_lastVolMult = 1.0; return 1.0; }
   MqlRates rt[];
   ArraySetAsSeries(rt, true);
   if(CopyRates(_Symbol, InpSignalTf, 1, 22, rt) < 22) { g_lastVolMult = 1.0; return 1.0; }

   double sum5 = 0.0, sum20 = 0.0;
   for(int i = 0; i < 20; i++)
     {
      double tr = MathMax(rt[i].high - rt[i].low,
                  MathMax(MathAbs(rt[i].high - rt[i + 1].close),
                          MathAbs(rt[i].low  - rt[i + 1].close)));
      if(i < 5) sum5 += tr;
      sum20 += tr;
     }
   double atr5 = sum5 / 5.0, atr20 = sum20 / 20.0;
   if(atr20 <= 1e-9) { g_lastVolMult = 1.0; return 1.0; }

   double ratio = atr5 / atr20;
   double mult  = 1.0;
   if(ratio > InpVolShockRatio)
      mult = MathMax(0.72, 1.0 / MathSqrt(ratio));
   else if(ratio >= 0.85 && ratio <= 1.20)
      mult = 1.04;

   g_lastVolMult = mult;
   return mult;
  }

//+------------------------------------------------------------------+
//| ApexEdge 3B: Empirical Bayes Rolling Kelly Multiplier            |
//+------------------------------------------------------------------+
double ComputeBayesianEdgeMult()
  {
   if(!InpUseQuantKelly) { g_lastEdgeMult = 1.0; return 1.0; }

   double priorN    = 8.0;
   double priorW    = 5.68;
   double priorL    = priorN - priorW;
   double priorSumW = priorW * 13.0;
   double priorSumL = priorL * 16.5;
   double f0        = 0.71 - (0.29 / (13.0 / 16.5));

   int winLen = MathMax(4, MathMin(32, InpKellyWindow));
   int n      = MathMin(g_retCount, winLen);
   double obsW = 0.0, obsL = 0.0, sumW = 0.0, sumL = 0.0;
   for(int i = 0; i < n; i++)
     {
      int idx = (g_retHead - 1 - i + 3200) % 32;
      double r = g_retRing[idx];
      if(r >= 0.0) { obsW += 1.0; sumW += r; }
      else         { obsL += 1.0; sumL += MathAbs(r); }
     }

   double totN = priorN + (double)n;
   double totW = priorW + obsW;
   double totL = priorL + obsL;
   double pHat = totW / MathMax(1.0, totN);
   double avgW = (priorSumW + sumW) / MathMax(0.5, totW);
   double avgL = (priorSumL + sumL) / MathMax(0.5, totL);
   double bHat = avgW / MathMax(0.5, avgL);

   double fHat = pHat - ((1.0 - pHat) / MathMax(0.10, bHat));
   double mult = (f0 > 0.01) ? (fHat / f0) : 1.0;
   mult = MathMax(InpKellyMinMult, MathMin(InpKellyMaxMult, mult));
   g_lastEdgeMult = mult;
   return mult;
  }

void RecordKellyReturn(const double batchPnl)
  {
   double balAfter  = AccountInfoDouble(ACCOUNT_BALANCE);
   double balBefore = balAfter - batchPnl;
   if(balBefore <= 1.0) return;
   double retPct = 100.0 * (batchPnl / balBefore);
   retPct = MathMax(-40.0, MathMin(40.0, retPct));
   g_retRing[g_retHead] = retPct;
   g_retHead = (g_retHead + 1) % 32;
   if(g_retCount < 32) g_retCount++;
  }

bool IsVolatilityOptimal(const double atr, const double refPrice, double &outAtrPct, string &outReason)
  {
   if(!MathIsValidNumber(atr) || !MathIsValidNumber(refPrice) || atr <= 0.0 || refPrice <= 0.0)
     { outAtrPct = 0.0; outReason = "BAD_ATR"; return false; }

   outAtrPct = 100.0 * (atr / refPrice);

   if(InpMinAtrPct > 0.0 && outAtrPct < InpMinAtrPct)
     { outReason = "LOW_VOL_CHOP"; return false; }

   if(InpMaxAtrPct > 0.0 && outAtrPct > InpMaxAtrPct)
     { outReason = "EXTREME_VOL"; return false; }

   outReason = "";
   return true;
  }

//+------------------------------------------------------------------+
//| Daily Accounting & Closed-Balance Soft DD Shield (v7.00)         |
//+------------------------------------------------------------------+
double ComputeClosedBalanceDdPct(const double bal)
  {
   if(g_day.peakBal <= 0.0 || bal >= g_day.peakBal) return 0.0;
   return 100.0 * (g_day.peakBal - bal) / g_day.peakBal;
  }

double ComputeSoftShieldMult(const double ddPct, const double curBal)
  {
   g_vaultActive   = false;
   g_vaultFloorBal = 0.0;
   double minMult  = MathMax(0.02, MathMin(0.50, InpVaultMinRiskMult));

   // Stage 3: Legacy High-Water Mark Profit Vault (disabled when Cumulative Profit Bank is active)
   if(!InpUseProfitBank && InpUseProfitVault && g_startBalance > 0.0)
     {
      double actLevel = g_startBalance * MathMax(1.10, InpVaultActivateMult);
      if(g_day.peakBal >= actLevel)
        {
         g_vaultActive   = true;
         double floorPct = MathMax(30.0, MathMin(90.0, InpVaultFloorPct));
         g_vaultFloorBal = MathMax(g_startBalance, g_day.peakBal * (floorPct / 100.0));

         double maxDdLim = 100.0 - floorPct;                                      // e.g. 35% for 65% floor
         double trigDd   = MathMax(5.0, MathMin(maxDdLim - 1.0, InpVaultTriggerDdPct)); // e.g. 25%

         if(ddPct <= trigDd)   return 1.00;
         if(ddPct >= maxDdLim) return minMult;

         double prog = (ddPct - trigDd) / (maxDdLim - trigDd);
         return MathMax(minMult, 1.00 - prog * (1.00 - minMult));
        }
     }

   // Stage 2: Start-Capital Principal Lock (defends initial deposit before first Profit Bank skim)
   if(InpUsePrincipalLock && g_startBalance > 0.0 && (!InpUseProfitBank || g_bankedProfit <= 0.0))
     {
      double lockAct = g_startBalance * MathMax(1.15, InpPrincipalActMult);
      if(g_day.peakBal >= lockAct)
        {
         g_vaultActive   = true;
         double pFloor   = g_startBalance * (MathMax(50.0, MathMin(120.0, InpPrincipalFloorPct)) / 100.0);
         g_vaultFloorBal = pFloor;

         // Full 100% power above midpoint of (Peak - Floor); smooth taper to minMult as Balance approaches Floor
         double cushionPeak = MathMax(1.0, g_day.peakBal - pFloor);
         double taperStart  = pFloor + 0.50 * cushionPeak;
         if(curBal >= taperStart) return 1.00;
         if(curBal <= pFloor)     return minMult;

         double prog = (taperStart - curBal) / MathMax(1.0, taperStart - pFloor);
         return MathMax(minMult, 1.00 - prog * (1.00 - minMult));
        }
     }

   // Stage 1: Initial startup phase (before +45% cushion): proven v7.40 Soft DD Shield
   if(InpSoftDdTier2Pct > 0.0 && ddPct >= InpSoftDdTier2Pct) return 0.65;
   if(InpSoftDdTier1Pct > 0.0 && ddPct >= InpSoftDdTier1Pct) return 0.85;
   return 1.00;
  }

void SyncDailyAccounting()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq <= 0.0) eq = bal;

   double flt = 0.0;
   int curOpen = CountOurPositions(flt);

   // Stage A: Infinite Continuous Ratchet — skims a slice of every new closed-balance high forever
   if(InpUseProfitBank && curOpen == 0 && g_startBalance > 0.0 && bal > g_hwmTotalBal)
     {
      double rStart = g_startBalance * MathMax(1.05, InpBankRatchetStart);
      if(InpBankRatchetPct > 0.0 && bal >= rStart)
        {
         double prevBase = MathMax(g_hwmTotalBal, rStart);
         double newGain  = bal - prevBase;
         if(newGain > 0.0)
           {
            double hiLevel = g_startBalance * MathMax(InpBankRatchetStart + 0.5, InpBankRatchetHiMult);
            double activePct = (InpBankRatchetHiPct > 0.0 && bal >= hiLevel) ? InpBankRatchetHiPct : InpBankRatchetPct;
            double rFrac   = MathMax(1.0, MathMin(80.0, activePct)) / 100.0;
            double addBank = newGain * rFrac;
            if(addBank > 0.0)
              {
               g_bankedProfit += addBank;
               g_bankSkimCount++;
              }
           }
        }
      g_hwmTotalBal = bal;
     }

   double workBal = InpUseProfitBank ? MathMax(0.0, bal - g_bankedProfit) : bal;
   double workEq  = InpUseProfitBank ? MathMax(0.0, eq  - g_bankedProfit) : eq;

   if(g_day.utcYear != dt.year || g_day.utcDay != dt.day_of_year)
     {
      g_day.utcYear    = dt.year;
      g_day.utcDay     = dt.day_of_year;
      g_day.dayStartEq = workEq;
      if(g_day.peakBal < workBal) g_day.peakBal = workBal;
      if(g_day.peakEq  < workEq)  g_day.peakEq  = workEq;
      g_day.closedPnl  = 0.0;
      g_day.trades     = 0;
      g_day.wins       = 0;
      g_day.consecLoss = 0;
      g_day.consecWins = 0;
      if(!g_day.killSwitch && g_ddPauseUntil <= 0) { g_day.blocked = false; g_day.reason = ""; }
     }

   if(workBal > g_day.peakBal) g_day.peakBal = workBal;
   if(workEq  > g_day.peakEq)  g_day.peakEq  = workEq;
   g_day.floatingPnl = flt;

   double ddBalPct = ComputeClosedBalanceDdPct(workBal);

   // Stage B: Deep-Pullback Cycle Lock — locks major wave profit on real trend exhaustion (unlimited cycles)
   if(InpUseProfitBank && InpBankSavePct > 0.0 && curOpen == 0 && g_cycleStart > 0.0)
     {
      double minPeakMult = MathMax(1.25, InpBankMinPeakMult);
      double trigPbPct   = MathMax(5.0, MathMin(50.0, InpBankPullbackPct));
      if(g_day.peakBal >= g_cycleStart * minPeakMult && ddBalPct >= trigPbPct)
        {
         double saveFrac    = MathMax(10.0, MathMin(90.0, InpBankSavePct)) / 100.0;
         double desiredWork = workBal * (1.0 - saveFrac);
         if(InpBankMinWorkUsd > 0.0 && workBal > InpBankMinWorkUsd * 1.25)
            desiredWork = MathMax(desiredWork, InpBankMinWorkUsd);
         double skim = workBal - desiredWork;
         if(skim > 0.0)
           {
            g_bankedProfit  += skim;
            g_bankSkimCount++;
            workBal          = MathMax(0.0, bal - g_bankedProfit);
            workEq           = MathMax(0.0, eq  - g_bankedProfit);
            g_cycleStart     = MathMax(100.0, workBal);
            g_day.peakBal    = workBal;
            g_day.peakEq     = workEq;
            g_day.dayStartEq = workEq;
            g_runConsecLoss  = 0;
            g_ddPauseUntil   = 0;
            ddBalPct         = 0.0;
            if(!g_day.killSwitch) { g_day.blocked = false; g_day.reason = ""; }
            PrintFormat("GPR810 CYCLE SKIM #%d: +$%.2f locked | Total Bank=$%.2f | New WorkCap=$%.2f",
                        g_bankSkimCount, skim, g_bankedProfit, workBal);
           }
        }
     }

   g_lastDdPct      = ddBalPct;
   g_lastShieldMult = ComputeSoftShieldMult(ddBalPct, workBal);

   // Legacy Vault Cycle Auto-Rebase (only active if Profit Bank is disabled)
   datetime nowGmtSync = TimeGMT();
   if(!InpUseProfitBank && InpVaultRebaseDays > 0 && g_vaultActive && g_vaultFloorBal > 0.0 && bal <= g_vaultFloorBal * 1.01)
     {
      if(g_vaultLockedSince <= 0)
         g_vaultLockedSince = nowGmtSync;
      else if(curOpen == 0 && (nowGmtSync - g_vaultLockedSince) >= (datetime)InpVaultRebaseDays * 86400)
        {
         g_day.peakBal      = bal;
         g_day.peakEq       = eq;
         g_vaultLockedSince = 0;
         ddBalPct           = 0.0;
         g_lastDdPct        = 0.0;
         g_lastShieldMult   = ComputeSoftShieldMult(0.0, bal);
        }
     }
   else
     {
      g_vaultLockedSince = 0;
     }

   if(InpHardStartLossPct > 0.0 && g_startBalance > 0.0)
     {
      double startLossPct = (eq < g_startBalance) ? (100.0 * (g_startBalance - eq) / g_startBalance) : 0.0;
      if(startLossPct >= InpHardStartLossPct)
        {
         g_day.killSwitch = true;
         g_day.blocked    = true;
         g_day.reason     = "START_DD_STOP";
         return;
        }
     }

   // Untouchable Profit Bank hard floor: never risk banked profit if working capital is depleted
   if(InpUseProfitBank && g_bankedProfit > 0.0 && MathMin(workBal, workEq) <= 50.0)
     {
      g_day.blocked = true;
      g_day.reason  = "BANK_PROTECTED";
      return;
     }

   if(g_day.killSwitch) return;

   datetime nowGmt = TimeGMT();
   if(g_ddPauseUntil > 0)
     {
      if(nowGmt < g_ddPauseUntil)
        {
         g_day.blocked = true;
         g_day.reason  = "DD_PAUSE";
         return;
        }
      g_ddPauseUntil = 0;
      g_day.peakEq   = workEq;
      g_day.blocked  = false;
      g_day.reason   = "";
     }

   double eqDdPct = (g_day.peakEq > 0.0 && workEq < g_day.peakEq) ? (100.0 * (g_day.peakEq - workEq) / g_day.peakEq) : 0.0;
   if(InpMaxEquityDdPct > 0.0 && eqDdPct >= InpMaxEquityDdPct)
     {
      if(InpDdPauseDays <= 0)
        {
         g_day.killSwitch = true;
         g_day.blocked    = true;
         g_day.reason     = "MAX_EQ_DD";
         return;
        }
      g_ddPauseUntil = nowGmt + (datetime)InpDdPauseDays * 86400;
      g_day.blocked  = true;
      g_day.reason   = "DD_PAUSE";
      return;
     }

   double dayBase  = (g_day.dayStartEq > 0.0) ? g_day.dayStartEq : workEq;
   double dayTotal = g_day.closedPnl + flt;

   if(InpMaxDailyLossPct > 0.0 && dayTotal <= -(dayBase * InpMaxDailyLossPct / 100.0))
     { g_day.blocked = true; g_day.reason = "DAILY_LOSS"; return; }

   if(InpDailyProfitCapPct > 0.0 && g_day.closedPnl >= (dayBase * InpDailyProfitCapPct / 100.0))
     { g_day.blocked = true; g_day.reason = "DAY_PROFIT_LOCK"; return; }

   if(InpMaxConsecLosses > 0 && g_day.consecLoss >= InpMaxConsecLosses)
     { g_day.blocked = true; g_day.reason = "CONSEC_LOSS"; return; }

   if(InpMaxTradesPerDay > 0 && g_day.trades >= InpMaxTradesPerDay)
     { g_day.blocked = true; g_day.reason = "MAX_TRADES"; SaveLiveState(true); return; }

   static int    s_prevDay  = -1;
   static bool   s_prevBlk  = false;
   static double s_prevBank = -1.0;
   static double s_prevPeak = -1.0;
   if(!g_isTester && (s_prevDay != g_day.utcDay || s_prevBlk != g_day.blocked ||
      MathAbs(s_prevBank - g_bankedProfit) > 1e-6 || MathAbs(s_prevPeak - g_day.peakBal) > 1e-6))
     {
      s_prevDay  = g_day.utcDay;
      s_prevBlk  = g_day.blocked;
      s_prevBank = g_bankedProfit;
      s_prevPeak = g_day.peakBal;
      SaveLiveState(true);
     }
  }

//+------------------------------------------------------------------+
//| ApexTenM 4: Session-Edge Kelly Weighting (UTC Regime Allocator)  |
//+------------------------------------------------------------------+
double ComputeSessionEdgeMult()
  {
   if(!InpUseSessionEdge) return 1.0;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   if(dt.hour == 14) return MathMax(0.20, InpPrime14Mult);
   if(dt.hour == 17) return MathMax(0.20, InpPrime17Mult);
   if(dt.hour == 13) return MathMax(0.20, InpPrime13Mult);
   if(dt.hour == 12) return MathMax(0.05, InpWeak12Mult);
   if(dt.hour == 11) return MathMax(0.05, InpWeak11Mult);
   return 1.0;
  }

//+------------------------------------------------------------------+
//| Markov-Kelly Persistent Regime Risk & Lot Sizing (v6.01 + v7.00) |
//+------------------------------------------------------------------+
bool IsDeadPocket(const bool isBuy)
  {
   if(!InpSkipDeadPockets) return false;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   if(isBuy && dt.hour == 9)   return true; // BUY 09:00 UTC: 42.9% WR, -0.70% avg
   if(!isBuy && dt.hour == 11) return true; // SELL 11:00 UTC: 40.0% WR, -1.77% avg
   return false;
  }

double ComputeAsymDirDowMult(const ENUM_ORDER_TYPE ordType)
  {
   if(!InpUseAsymDirKelly) return 1.0;
   double dirM = (ordType == ORDER_TYPE_SELL) ? MathMax(0.25, InpSellEdgeMult) : MathMax(0.25, InpBuyEdgeMult);
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   double dowM = 1.0;
   if(dt.day_of_week == 1) dowM = MathMax(0.25, InpMonEdgeMult);
   else if(dt.day_of_week == 3 || dt.day_of_week == 4) dowM = MathMax(0.50, InpMidWeekEdgeMult);
   return dirM * dowM;
  }

double ComputeMarkovRiskPct(const ENUM_ORDER_TYPE ordType, const double sigMult = 1.0)
  {
   double curTotBal = AccountInfoDouble(ACCOUNT_BALANCE);
   bool   isUnderwater = (g_startBalance > 0.0 && curTotBal < g_startBalance);
   double rawBase   = isUnderwater ? InpUnderwaterRiskPct : InpBaseRiskPct;
   double base      = MathMax(0.25, rawBase);
   double r         = base;

   // Persistent multi-day Markov regime state (never resets at UTC midnight)
   if(g_runConsecLoss >= 2)
      r = base * MathMax(0.10, InpLoss2Mult);
   else if(g_runConsecLoss == 1)
      r = base * MathMax(0.15, InpLoss1Mult);
   else if(g_runConsecWins >= 3)
      r = base * MathMax(1.00, InpWin3Mult);
   else if(g_runConsecWins == 2)
      r = base * MathMax(1.00, InpWin2Mult);
   else if(g_runConsecWins == 1)
      r = base * MathMax(1.00, InpWin1Mult);

   r *= MathMax(0.50, sigMult);
   r *= g_lastShieldMult;

   if(InpUseQuantKelly)
      r *= ComputeBayesianEdgeMult() * ComputeVolShockMult();
   if(InpUseSessionEdge)
      r *= ComputeSessionEdgeMult();
   if(InpUseAsymDirKelly)
      r *= ComputeAsymDirDowMult(ordType);
   double hardCap = MathMax(base, InpMaxRiskCapPct);
   if(r > hardCap) r = hardCap;
   double minFloor = (g_vaultActive && g_lastShieldMult < 0.25) ? 0.10 : 0.25;
   if(r < minFloor) r = minFloor;
   return r;
  }

int GetEffectiveMaxSlices()
  {
   if(!InpUseMultiSlice || InpMaxSlices <= 1) return 1;
   int cap = MathMax(1, MathMin(5000, InpMaxSlices));
   int brokerLim = (int)AccountInfoInteger(ACCOUNT_LIMIT_ORDERS);
   if(brokerLim > 0)
     {
      int curOpen = PositionsTotal() + OrdersTotal();
      int avail   = MathMax(1, brokerLim - curOpen - 2);
      cap = MathMin(cap, avail);
     }
   return cap;
  }

double CalculateVolume(const ENUM_ORDER_TYPE ordType, const double entryPrice, const double slPrice, const double sigMult = 1.0)
  {
   double bal  = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq   = AccountInfoDouble(ACCOUNT_EQUITY);
   double free = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double rawBaseEq = (bal > 0.0) ? MathMin(bal, (eq > 0.0 ? eq : bal)) : eq;
   double baseEq    = InpUseProfitBank ? MathMax(0.0, rawBaseEq - g_bankedProfit) : rawBaseEq;
   if(baseEq <= 0.0) return 0.0;
   if(InpUseProfitBank && g_bankedProfit > 0.0 && baseEq <= 50.0) return 0.0;

   double rawLot = InpFixedLot;
   g_lastRiskPct = ComputeMarkovRiskPct(ordType, sigMult);

   if(InpLotMode == GPR_LOT_EQUITY_STEP)
     {
      double step = MathMax(10.0, InpEquityStepUsd);
      rawLot = MathFloor(baseEq / step) * 0.01;
      if(rawLot < g_spec.volMin) rawLot = g_spec.volMin;
     }
   else if(InpLotMode == GPR_LOT_DYNAMIC_RISK)
     {
      double riskUsd = baseEq * (g_lastRiskPct / 100.0);
      if(InpUseProfitBank && g_bankedProfit > 0.0)
         riskUsd = MathMin(riskUsd, baseEq * 0.25);
      double slDist  = MathAbs(entryPrice - slPrice);
      if(slDist <= g_spec.point) return 0.0;

      // Bulletproof broker-native loss calculation in exact account currency (USC / USD)
      double lossPerLot = 0.0;
      double calcPnl1   = 0.0;
      if(OrderCalcProfit(ordType, _Symbol, 1.0, entryPrice, slPrice, calcPnl1) && calcPnl1 < 0.0)
         lossPerLot = MathAbs(calcPnl1);
      else
        {
         double liveTickSz  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
         double liveTickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
         if(liveTickVal <= 0.0) liveTickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
         if(liveTickSz > 0.0 && liveTickVal > 0.0)
           {
            g_spec.tickSize  = liveTickSz;
            g_spec.tickValue = liveTickVal;
            lossPerLot       = (slDist / liveTickSz) * liveTickVal;
           }
        }
      // Never guess via raw contractSize (breaks 100x on USC cent accounts if tickValue is 0 at init)
      if(lossPerLot <= 0.0)
        {
         Print("GPR810 SAFE BLOCK: Broker tickValue/OrderCalcProfit unavailable — skipping trade.");
         return 0.0;
        }

      rawLot = riskUsd / lossPerLot;
     }

   double singleMax = MathMin(g_spec.volMax, MathMax(g_spec.volMin, InpMaxLotCap));
   double capMax    = singleMax;
   int effMaxSlices = GetEffectiveMaxSlices();
   if(effMaxSlices > 1)
     {
      double multiCeiling = singleMax * (double)effMaxSlices;
      capMax = MathMin(multiCeiling, MathMax(singleMax, InpTotalLotCap));
     }
   // Respect broker's total symbol volume limit on live accounts
   double symVolLimit = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_LIMIT);
   if(symVolLimit > 0.0)
     {
      double existingVol = 0.0;
      for(int p = PositionsTotal() - 1; p >= 0; p--)
        {
         if(PositionGetTicket(p) == 0) continue;
         if(PositionGetString(POSITION_SYMBOL) == _Symbol)
            existingVol += PositionGetDouble(POSITION_VOLUME);
        }
      double availVol = MathMax(0.0, symVolLimit - existingVol);
      if(availVol < g_spec.volMin) return 0.0;
      capMax = MathMin(capMax, availVol);
     }
   double lot = GPR_ClampVol(rawLot, g_spec.volMin, capMax, g_spec.volStep);
   if(lot <= 0.0) return 0.0;

   double marginReq = 0.0;
   bool gotMargin = OrderCalcMargin(ordType, _Symbol, lot, entryPrice, marginReq);
   if((!gotMargin || marginReq <= 0.0) && lot > singleMax)
     {
      double marginPerLot = 0.0;
      if(OrderCalcMargin(ordType, _Symbol, 1.0, entryPrice, marginPerLot) && marginPerLot > 0.0)
        {
         marginReq = marginPerLot * lot;
         gotMargin = true;
        }
     }
   if(gotMargin && marginReq > 0.0)
     {
      double maxAllow = free * (InpMaxMarginPct / 100.0);
      if(marginReq > maxAllow && maxAllow > 0.0)
        {
         double scaled = lot * (maxAllow / marginReq) * 0.96;
         lot = GPR_ClampVol(scaled, g_spec.volMin, capMax, g_spec.volStep);
        }
     }
   // Final hard risk-verification guard: never allow a lot whose SL loss exceeds allowed risk
   if(InpLotMode == GPR_LOT_DYNAMIC_RISK)
     {
      double verifyPnl = 0.0;
      double maxLossAllow = baseEq * (MathMin(g_lastRiskPct, InpMaxRiskCapPct) / 100.0) * 1.15;
      bool gotVerify = OrderCalcProfit(ordType, _Symbol, lot, entryPrice, slPrice, verifyPnl);
      if(!gotVerify && lot > singleMax)
        {
         double pnl1 = 0.0;
         if(OrderCalcProfit(ordType, _Symbol, 1.0, entryPrice, slPrice, pnl1) && pnl1 < 0.0)
           {
            verifyPnl = pnl1 * lot;
            gotVerify = true;
           }
        }
      if(gotVerify && verifyPnl < 0.0)
        {
         double actualLoss = MathAbs(verifyPnl);
         if(actualLoss > maxLossAllow && maxLossAllow > 0.0)
           {
            double safeLot = GPR_ClampVol(lot * (maxLossAllow / actualLoss) * 0.95, g_spec.volMin, capMax, g_spec.volStep);
            bool gotSafe = OrderCalcProfit(ordType, _Symbol, safeLot, entryPrice, slPrice, verifyPnl);
            if(!gotSafe && safeLot > singleMax)
              {
               double pnl1s = 0.0;
               if(OrderCalcProfit(ordType, _Symbol, 1.0, entryPrice, slPrice, pnl1s) && pnl1s < 0.0)
                 {
                  verifyPnl = pnl1s * safeLot;
                  gotSafe = true;
                 }
              }
            if(gotSafe && MathAbs(verifyPnl) <= maxLossAllow)
               lot = safeLot;
            else
              {
               PrintFormat("GPR810 SAFE BLOCK: SL loss %.2f exceeds max %.2f — aborting order.", actualLoss, maxLossAllow);
               g_lastSkipTxt   = StringFormat("Skipped: Min Lot SL %.1f > Cap %.1f", actualLoss, maxLossAllow);
               g_lastSkipUntil = TimeCurrent() + 600;
               return 0.0;
              }
           }
        }
     }
   g_lastLotVal = lot;
   return lot;
  }

//+------------------------------------------------------------------+
//| ApexEdge 2: Multi-Slice Order Execution Engine                   |
//+------------------------------------------------------------------+
bool ExecuteSlicedOrder(const bool isBuy, const double totalLot, const double entryPrice,
                        const double sl, const double tp, const string baseCmt)
  {
   double singleMax = MathMin(g_spec.volMax, MathMax(g_spec.volMin, InpMaxLotCap));
   int    maxSlices = GetEffectiveMaxSlices();

   double remaining = totalLot;
   int    sent      = 0;
   for(int s = 1; s <= maxSlices && remaining >= g_spec.volMin - 1e-9; s++)
     {
      double sliceLot = MathMin(remaining, singleMax);
      sliceLot = GPR_ClampVol(sliceLot, g_spec.volMin, singleMax, g_spec.volStep);
      if(sliceLot < g_spec.volMin) break;

      string cmt = (maxSlices > 1 && totalLot > singleMax + 1e-9)
                   ? StringFormat("%s_S%d", baseCmt, s)
                   : baseCmt;

      double execPx = entryPrice;
      if(!g_isTester && s > 1)
        {
         MqlTick tkSlice;
         if(!SymbolInfoTick(_Symbol, tkSlice)) break;
         double livePx   = isBuy ? tkSlice.ask : tkSlice.bid;
         double maxDrift = MathMax(g_spread.lastSpread * 2.5, g_spec.point * 50.0);
         double advDrift = isBuy ? (livePx - entryPrice) : (entryPrice - livePx);
         if(advDrift > maxDrift)
           {
            PrintFormat("GPR810 SLICE %d ABORT: Adverse drift %.3f > max %.3f (sent %d slices).",
                        s, advDrift, maxDrift, sent);
            break;
           }
         execPx = livePx;
        }

      bool ok = isBuy
                ? g_trade.Buy(sliceLot, _Symbol, execPx, sl, tp, cmt)
                : g_trade.Sell(sliceLot, _Symbol, execPx, sl, tp, cmt);
      if(ok)
        {
         sent++;
         remaining -= sliceLot;
        }
      else
        {
         PrintFormat("GPR810 %s S%d ERR: lot=%.2f ret=%u (%s)",
                     isBuy ? "BUY" : "SELL", s, sliceLot,
                     g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
         break;
        }
     }
   return (sent > 0);
  }

//+------------------------------------------------------------------+
//| Proven v6/v7 H4+H1 Aligned M5 Sweep Entry + News Shock Guard     |
//+------------------------------------------------------------------+
void TrySweepReversionEntry(const MqlTick &tk)
  {
   int activeCd = g_lastTradeLoss ? MathMax(InpCooldownSec, InpLossCooldownSec) : InpCooldownSec;
   if(g_lastCloseTime > 0 && (TimeCurrent() - g_lastCloseTime) < activeCd) return;

   double bAtr[2], bBbUp[3], bBbLo[3], bRsi[3], bH1F[2], bH1S[2], bH4F[2], bH4S[2];
   if(CopyBuffer(g_hAtrSig,    0, 1, 1, bAtr)  != 1) return;
   if(CopyBuffer(g_hBbSig,     1, 1, 2, bBbUp) != 2) return;
   if(CopyBuffer(g_hBbSig,     2, 1, 2, bBbLo) != 2) return;
   if(CopyBuffer(g_hRsiSig,    0, 1, 2, bRsi)  != 2) return;
   if(CopyBuffer(g_hEmaFastH1, 0, 1, 1, bH1F)  != 1) return;
   if(CopyBuffer(g_hEmaSlowH1, 0, 1, 1, bH1S)  != 1) return;
   if(CopyBuffer(g_hEmaFastH4, 0, 1, 1, bH4F)  != 1) return;
   if(CopyBuffer(g_hEmaSlowH4, 0, 1, 1, bH4S)  != 1) return;

   double atr = bAtr[0];
   if(!MathIsValidNumber(atr) || atr <= 0.0) return;

   // Quant Math 3: Blend Parkinson High-Low Vol (35%) with ATR(14) (65%)
   if(InpUseParkinsonVol)
     {
      double parkPx = 0.0;
      if(ComputeParkinsonVolPrice(InpSignalTf, InpParkinsonBars, tk.bid, parkPx))
         atr = 0.65 * atr + 0.35 * parkPx;
     }
   g_lastAtrVal = atr;

   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, InpSignalTf, 1, 3, r) < 3) return;

   if(InpUseNewsShockPause)
     {
      double barRange = r[0].high - r[0].low;
      if(barRange > atr * InpShockBarMult)
        {
         g_shockPauseUntil = TimeCurrent() + MathMax(5, InpShockPauseMin) * 60;
         g_volStatus = "NEWS_SHOCK";
         return;
        }
      if(g_shockPauseUntil > TimeCurrent())
        {
         g_volStatus = "NEWS_SHOCK";
         return;
        }
     }

   if(IsMt5CalendarNewsWindow())
     {
      g_volStatus = "USD_NEWS";
      return;
     }

   double atrPct = 0.0;
   string volWhy = "";
   bool volOk = IsVolatilityOptimal(atr, tk.bid, atrPct, volWhy);
   g_lastAtrPct = atrPct;
   g_volStatus  = volWhy;
   if(!volOk) return;

   double bbUp1 = bBbUp[1], bbUp2 = bBbUp[0];
   double bbLo1 = bBbLo[1], bbLo2 = bBbLo[0];
   double rsi1  = bRsi[1],  rsi2  = bRsi[0];
   g_lastRsiVal = rsi1;

   bool allowBuy  = (InpDirection == GPR_DIR_BOTH || InpDirection == GPR_DIR_BUY_ONLY);
   bool allowSell = (InpDirection == GPR_DIR_BOTH || InpDirection == GPR_DIR_SELL_ONLY);

   // Quant Math 1: H1 Kaufman Efficiency Ratio chop gate
   double h1ErVal = 1.0;
   bool   hasH1Er = ComputeKaufmanER(InpMacroTf, InpErPeriod, h1ErVal);
   if(hasH1Er) g_lastH1Er = h1ErVal;
   if(InpUseKaufmanER && InpMinH1Er > 0.0 && hasH1Er && h1ErVal < InpMinH1Er)
     { g_biasTxt = "H1 CHOP ER"; return; }

   int h1Dir = (bH1F[0] > bH1S[0]) ? 1 : ((bH1F[0] < bH1S[0]) ? -1 : 0);
   int h4Dir = (bH4F[0] > bH4S[0]) ? 1 : ((bH4F[0] < bH4S[0]) ? -1 : 0);

   if(InpUseMacroTrend && InpUseH4Macro)
     {
      if(h1Dir == 1 && h4Dir == 1)       { allowSell = false; g_biasTxt = "H4+H1 BULL"; }
      else if(h1Dir == -1 && h4Dir == -1){ allowBuy  = false; g_biasTxt = "H4+H1 BEAR"; }
      else                               { g_biasTxt = "H4/H1 SPLIT"; return; }
     }
   else if(InpUseMacroTrend)
     {
      if(h1Dir == 1)       { allowSell = false; g_biasTxt = "H1 BULL"; }
      else if(h1Dir == -1) { allowBuy  = false; g_biasTxt = "H1 BEAR"; }
      else                 { g_biasTxt = "H1 FLAT"; return; }
     }
   else if(InpUseH4Macro)
     {
      if(h4Dir == 1)       { allowSell = false; g_biasTxt = "H4 BULL"; }
      else if(h4Dir == -1) { allowBuy  = false; g_biasTxt = "H4 BEAR"; }
      else                 { g_biasTxt = "H4 FLAT"; return; }
     }
   else
     {
      g_biasTxt = "2-WAY";
     }

   // Quant Math 2: Session VWAP Z-Score (anti-chasing + falling-knife reversal guard)
   double sessVwap = 0.0, vwapZ = 0.0;
   bool hasVwap = (InpUseVwapZScore || InpUseVwapKnifeGuard || InpUseVwapTrigger) ? ComputeSessionVwapZ(InpSignalTf, sessVwap, vwapZ) : false;
   if(hasVwap) g_lastVwapZ = vwapZ;

   if(InpUseVwapZScore && hasVwap && InpVwapMaxChaseZ > 0.0)
     {
      if(vwapZ >  InpVwapMaxChaseZ) allowBuy  = false;
      if(vwapZ < -InpVwapMaxChaseZ) allowSell = false;
     }

   // Quant Math 2B: VWAP Falling-Knife Guard (blocks catching intraday trend-break flushes)
   if(InpUseVwapKnifeGuard && hasVwap && InpVwapMaxKnifeZ > 0.0)
     {
      if(vwapZ <= -InpVwapMaxKnifeZ) allowBuy  = false;
      if(vwapZ >=  InpVwapMaxKnifeZ) allowSell = false;
     }

   bool vwapBuyDip   = (InpUseVwapTrigger && hasVwap && InpVwapPullbackZ > 0.0 && vwapZ <= -InpVwapPullbackZ);
   bool vwapSellRip  = (InpUseVwapTrigger && hasVwap && InpVwapPullbackZ > 0.0 && vwapZ >=  InpVwapPullbackZ);

   bool coreBuySweep  = (r[0].low <= bbLo1 || r[1].low <= bbLo2 || rsi1 <= InpRsiOversold || rsi2 <= InpRsiOversold);
   bool buySweep      = (coreBuySweep || vwapBuyDip);
   bool buyDoubleConf = (coreBuySweep && vwapBuyDip);
   bool buyReject     = (!InpRequireRejCandle || (r[0].close > r[0].open && (r[0].close > bbLo1 || vwapBuyDip)));

   bool coreSellSweep  = (r[0].high >= bbUp1 || r[1].high >= bbUp2 || rsi1 >= InpRsiOverbought || rsi2 >= InpRsiOverbought);
   bool sellSweep      = (coreSellSweep || vwapSellRip);
   bool sellDoubleConf = (coreSellSweep && vwapSellRip);
   bool sellReject     = (!InpRequireRejCandle || (r[0].close < r[0].open && (r[0].close < bbUp1 || vwapSellRip)));

   ConfigureFilling();
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(25);

   double minSl  = MathMax(atr * InpSlAtrMult, g_spread.lastSpread * InpMinSlSpreadMult);
   double maxSl  = MathMax(minSl, atr * InpMaxSlAtrMult);
   double tpDist = MathMax(atr * InpTpAtrMult, g_spread.lastSpread * 4.0);

   if(allowBuy && buySweep && buyReject)
     {
      if(IsLiquidityTrapSweep(true, r, atr))
        {
         g_volStatus     = "LIQ_TRAP_BLK";
         g_lastSkipTxt   = "Skipped BUY: Liquidity Trap Zone";
         g_lastSkipUntil = TimeCurrent() + 600;
         return;
        }
      double swingLo   = MathMin(r[0].low, r[1].low);
      double wickSl    = (tk.ask - (swingLo - atr * InpWickPadAtr));
      double slDist    = MathMax(minSl, MathMin(maxSl, wickSl));
      double buyTpDist = tpDist;
      if(InpMinTpSlRatio > 0.0)
        {
         double rrTp  = slDist * InpMinTpSlRatio;
         double maxTp = atr * MathMax(InpTpAtrMult, InpMaxTpAtrMult);
         buyTpDist    = MathMax(tpDist, MathMin(rrTp, maxTp));
        }
      if(IsDeadPocket(true)) { g_volStatus = "DEAD_PKT_BLK"; return; }
      if(InpMinEntryRrRatio > 0.0 && slDist > 0.0 && (buyTpDist / slDist) < InpMinEntryRrRatio)
        {
         g_lastSkipTxt   = StringFormat("Skipped BUY: Wide Wick R:R %.2f < %.2f", buyTpDist / slDist, InpMinEntryRrRatio);
         g_lastSkipUntil = TimeCurrent() + 600;
         return;
        }
      double sigMult   = buyDoubleConf ? MathMax(1.0, InpConfluenceBoost) : 1.0;
      double sl        = GPR_AlignPrice(tk.ask - slDist, g_spec.tickSize, g_spec.digits);
      double tp        = GPR_AlignPrice(tk.ask + buyTpDist, g_spec.tickSize, g_spec.digits);
      double lot       = CalculateVolume(ORDER_TYPE_BUY, tk.ask, sl, sigMult);
      string cmt       = buyDoubleConf ? "GPR810_BUY_CONF" : "GPR810_BUY_SWEEP";
      if(lot >= g_spec.volMin && sl > 0.0 && tp > tk.ask)
        {
         g_batchPnl = 0.0;
         if(ExecuteSlicedOrder(true, lot, tk.ask, sl, tp, cmt))
           { g_lastSkipTxt = ""; g_lastSkipUntil = 0; SaveLiveState(true); }
         return;
        }
     }
   else if(allowSell && sellSweep && sellReject)
     {
      if(IsLiquidityTrapSweep(false, r, atr))
        {
         g_volStatus     = "LIQ_TRAP_BLK";
         g_lastSkipTxt   = "Skipped SELL: Liquidity Trap Zone";
         g_lastSkipUntil = TimeCurrent() + 600;
         return;
        }
      double swingHi    = MathMax(r[0].high, r[1].high);
      double wickSl     = ((swingHi + atr * InpWickPadAtr) - tk.bid);
      double slDist     = MathMax(minSl, MathMin(maxSl, wickSl));
      double sellTpDist = tpDist;
      if(InpMinTpSlRatio > 0.0)
        {
         double rrTp  = slDist * InpMinTpSlRatio;
         double maxTp = atr * MathMax(InpTpAtrMult, InpMaxTpAtrMult);
         sellTpDist   = MathMax(tpDist, MathMin(rrTp, maxTp));
        }
      if(IsDeadPocket(false)) { g_volStatus = "DEAD_PKT_BLK"; return; }
      if(InpMinEntryRrRatio > 0.0 && slDist > 0.0 && (sellTpDist / slDist) < InpMinEntryRrRatio)
        {
         g_lastSkipTxt   = StringFormat("Skipped SELL: Wide Wick R:R %.2f < %.2f", sellTpDist / slDist, InpMinEntryRrRatio);
         g_lastSkipUntil = TimeCurrent() + 600;
         return;
        }
      double sigMult    = sellDoubleConf ? MathMax(1.0, InpConfluenceBoost) : 1.0;
      double sl         = GPR_AlignPrice(tk.bid + slDist, g_spec.tickSize, g_spec.digits);
      double tp         = GPR_AlignPrice(tk.bid - sellTpDist, g_spec.tickSize, g_spec.digits);
      double lot        = CalculateVolume(ORDER_TYPE_SELL, tk.bid, sl, sigMult);
      string cmt        = sellDoubleConf ? "GPR810_SELL_CONF" : "GPR810_SELL_SWEEP";
      if(lot >= g_spec.volMin && tp > 0.0 && sl > tk.bid)
        {
         g_batchPnl = 0.0;
         if(ExecuteSlicedOrder(false, lot, tk.bid, sl, tp, cmt))
           { g_lastSkipTxt = ""; g_lastSkipUntil = 0; SaveLiveState(true); }
         return;
        }
     }

  }

//+------------------------------------------------------------------+
//| Manage Open Positions (Optional BE / Trail / TimeStop)           |
//+------------------------------------------------------------------+
void ManageOpenPositions(const MqlTick &tk)
  {
   if(!InpUseLateBE && !InpUseAtrTrail && InpMaxHoldBars <= 0) return;

   double atr     = (g_lastAtrVal > 0.0) ? g_lastAtrVal : (g_spread.lastSpread * 8.0);
   double minStop = (double)g_spec.stopsPts * g_spec.point;
   double minStep = MathMax(g_spec.tickSize * 5.0, g_spec.point * 10.0);
   int barSec     = PeriodSeconds(InpSignalTf);
   if(barSec <= 0) barSec = 300;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tkId = PositionGetTicket(i);
      if(tkId == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;

      long     pType  = PositionGetInteger(POSITION_TYPE);
      double   openPx = PositionGetDouble(POSITION_PRICE_OPEN);
      double   curSl  = PositionGetDouble(POSITION_SL);
      double   curTp  = PositionGetDouble(POSITION_TP);
      datetime oTm    = (datetime)PositionGetInteger(POSITION_TIME);
      double   curPnl = PositionGetDouble(POSITION_PROFIT);

      if(InpMaxHoldBars > 0 && curPnl <= 0.0 && (TimeCurrent() - oTm) >= (InpMaxHoldBars * barSec))
        {
         g_trade.PositionClose(tkId);
         continue;
        }

      double profitDist = (pType == POSITION_TYPE_BUY) ? (tk.bid - openPx) : (openPx - tk.ask);
      if(profitDist <= 0.0) continue;

      double newSl = curSl;

      if(InpUseLateBE && profitDist >= atr * InpBeTriggerAtr)
        {
         double bePx = (pType == POSITION_TYPE_BUY) ? (openPx + atr * InpBeLockAtr)
                                                    : (openPx - atr * InpBeLockAtr);
         if(pType == POSITION_TYPE_BUY  && (curSl <= 0.0 || bePx > curSl + minStep)) newSl = bePx;
         if(pType == POSITION_TYPE_SELL && (curSl <= 0.0 || bePx < curSl - minStep)) newSl = bePx;
        }

      if(InpUseAtrTrail && profitDist >= atr * InpTrailStartAtr)
        {
         double trPx = (pType == POSITION_TYPE_BUY) ? (tk.bid - atr * InpTrailDistAtr)
                                                    : (tk.ask + atr * InpTrailDistAtr);
         if(pType == POSITION_TYPE_BUY  && (newSl <= 0.0 || trPx > newSl + minStep)) newSl = trPx;
         if(pType == POSITION_TYPE_SELL && (newSl <= 0.0 || trPx < newSl - minStep)) newSl = trPx;
        }

      if(newSl != curSl && newSl > 0.0)
        {
         newSl = GPR_AlignPrice(newSl, g_spec.tickSize, g_spec.digits);
         bool valid = (pType == POSITION_TYPE_BUY) ? (newSl < tk.bid - minStop)
                                                   : (newSl > tk.ask + minStop);
         if(valid) g_trade.PositionModify(tkId, newSl, curTp);
        }
     }
  }

//+------------------------------------------------------------------+
//| Deal Accounting (OnTradeTransaction)                             |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong dealTk = trans.deal;
   if(dealTk == 0 || !HistoryDealSelect(dealTk)) return;

   // Handle live account deposits & withdrawals cleanly without requiring EA restart
   long dealType = HistoryDealGetInteger(dealTk, DEAL_TYPE);
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_CREDIT || dealType == DEAL_TYPE_BONUS || dealType == DEAL_TYPE_CORRECTION)
     {
      double amt = HistoryDealGetDouble(dealTk, DEAL_PROFIT);
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
      if(eq <= 0.0) eq = bal;
      if(amt > 0.0)
        {
         double prevBal = bal - amt;
         g_startBalance    = (prevBal <= 1.0) ? bal : (g_startBalance + amt);
         g_day.dayStartEq  = InpUseProfitBank ? MathMax(0.0, eq - g_bankedProfit) : eq;
         g_day.peakBal     = MathMax(g_day.peakBal, InpUseProfitBank ? MathMax(0.0, bal - g_bankedProfit) : bal);
         g_day.peakEq      = MathMax(g_day.peakEq, g_day.dayStartEq);
         g_day.closedPnl   = 0.0;
         g_day.consecLoss  = 0;
         g_day.blocked     = false;
         g_day.reason      = "";
         g_day.killSwitch  = false;
         g_ddPauseUntil    = 0;
         g_runConsecLoss   = 0;
         g_lastTradeLoss   = false;
         g_hwmTotalBal     = MathMax(g_hwmTotalBal, bal);
         g_cycleStart      = MathMax(g_cycleStart, bal);
         PrintFormat("GPR810 DEPOSIT +%.2f detected -> Daily locks & start balance reset (Bal=%.2f)", amt, bal);
        }
      else if(amt < 0.0)
        {
         double workBal = InpUseProfitBank ? MathMax(0.0, bal - g_bankedProfit) : bal;
         double workEq  = InpUseProfitBank ? MathMax(0.0, eq  - g_bankedProfit) : eq;
         g_day.peakBal    = MathMax(workBal, g_day.peakBal + amt);
         g_day.peakEq     = MathMax(workEq,  g_day.peakEq  + amt);
         g_day.dayStartEq = MathMax(1.0,     g_day.dayStartEq + amt);
         g_hwmTotalBal    = MathMax(bal,     g_hwmTotalBal + amt);
         PrintFormat("GPR810 WITHDRAWAL %.2f detected -> Peak/day baselines adjusted (Bal=%.2f)", amt, bal);
        }
      SaveLiveState(true);
      return;
     }

   if(HistoryDealGetString(dealTk, DEAL_SYMBOL) != _Symbol) return;
   if(!IsOurMagic(HistoryDealGetInteger(dealTk, DEAL_MAGIC))) return;

   long entry = HistoryDealGetInteger(dealTk, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) return;

   double pnl = HistoryDealGetDouble(dealTk, DEAL_PROFIT)
              + HistoryDealGetDouble(dealTk, DEAL_SWAP)
              + HistoryDealGetDouble(dealTk, DEAL_COMMISSION);

   g_day.closedPnl += pnl;
   g_batchPnl      += pnl;

   double remFlt = 0.0;
   int remOpen = CountOurPositions(remFlt);
   if(remOpen == 0)
     {
      double totalBatchPnl = g_batchPnl;
      g_batchPnl = 0.0;

      g_day.trades++;
      g_lastCloseTime = TimeCurrent();
      RecordKellyReturn(totalBatchPnl);

      if(totalBatchPnl >= 0.0)
        {
         g_day.wins++;
         g_day.consecWins++;
         g_day.consecLoss = 0;
         g_runConsecWins++;
         g_runConsecLoss = 0;
         g_lastTradeLoss = false;
        }
      else
        {
         g_day.consecLoss++;
         g_day.consecWins = 0;
         g_runConsecLoss++;
         g_runConsecWins = 0;
         g_lastTradeLoss = true;
        }
     }
   SaveLiveState(true);
  }

//+------------------------------------------------------------------+
//| Lifecycle: OnInit / OnDeinit / OnChartEvent / OnTick             |
//+------------------------------------------------------------------+
bool IsAlgoTradingOn()
  {
   if(g_isTester) return true;
   return ((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && (bool)MQLInfoInteger(MQL_TRADE_ALLOWED));
  }

bool IsMarketOpenNow()
  {
   if(g_isTester) return true;
   long mode = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE);
   if(mode == SYMBOL_TRADE_MODE_DISABLED || mode == SYMBOL_TRADE_MODE_CLOSEONLY)
      return false;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int secOfDay = dt.hour * 3600 + dt.min * 60 + dt.sec;
   datetime fromT = 0, toT = 0;
   bool hasAny = false, inSess = false;
   for(int s = 0; s < 5; s++)
     {
      if(!SymbolInfoSessionTrade(_Symbol, (ENUM_DAY_OF_WEEK)dt.day_of_week, s, fromT, toT)) break;
      hasAny = true;
      int fSec = (int)(fromT % 86400);
      int tSec = (int)(toT % 86400);
      if(tSec == 0) tSec = 86400;
      if(secOfDay >= fSec && secOfDay < tSec) { inSess = true; break; }
     }
   if(hasAny && !inSess) return false;
   if(!hasAny && (dt.day_of_week == 0 || dt.day_of_week == 6)) return false;
   return true;
  }

string FormatCountdownSec(long sec)
  {
   if(sec < 0) sec = 0;
   long h = sec / 3600;
   long m = (sec % 3600) / 60;
   long s = sec % 60;
   if(h >= 24)
     {
      long d = h / 24;
      h = h % 24;
      return StringFormat("%dd %02d:%02d", (int)d, (int)h, (int)m);
     }
   if(h > 0) return StringFormat("%02d:%02d:%02d", (int)h, (int)m, (int)s);
   return StringFormat("%02d:%02d", (int)m, (int)s);
  }

string BuildTimedStatus(const string baseStatus, const int openPos = 0)
  {
   if(g_isTester) return baseStatus;
   datetime nowCur = TimeCurrent();
   datetime nowGmt = TimeGMT();
   if(baseStatus == "NEWS_SHOCK" && g_shockPauseUntil > nowCur)
      return "NEWS_SHOCK (" + FormatCountdownSec((long)(g_shockPauseUntil - nowCur)) + ")";

   if(baseStatus == "DD_PAUSE" && g_ddPauseUntil > nowGmt)
      return "DD_PAUSE (" + FormatCountdownSec((long)(g_ddPauseUntil - nowGmt)) + ")";

   MqlDateTime dt;
   TimeToStruct(nowGmt, dt);
   int secDay = dt.hour * 3600 + dt.min * 60 + dt.sec;

   if(baseStatus == "ACTIVE")
     {
      string actLbl = (openPos > 0) ? "IN TRADE" : "SCANNING";
      if(InpUseSessionWindow)
        {
         long rem = 0;
         if(dt.hour >= InpSessionStartUTC && dt.hour < InpSessionEndUTC)
            rem = (long)InpSessionEndUTC * 3600 - secDay;
         else if(InpAllowLateNyWindow && dt.hour >= InpLateNyStartUTC && dt.hour < InpLateNyEndUTC)
            rem = (long)InpLateNyEndUTC * 3600 - secDay;
         if(rem > 0)
            return actLbl + " (win " + FormatCountdownSec(rem) + ")";
        }
      return actLbl;
     }

   if(baseStatus == "OFF_SESSION" || baseStatus == "TUE_SKIP" || baseStatus == "ROLLOVER")
     {
      // Find next active window start within next 72 hours (step by 1 minute for exactness)
      datetime baseMin = nowGmt - (nowGmt % 60) + 60;
      for(int step = 0; step < 4320; step++)
        {
         datetime probe = baseMin + (datetime)step * 60;
         MqlDateTime pd;
         TimeToStruct(probe, pd);
         if(pd.day_of_week == 0 || pd.day_of_week == 6) continue;
         if(InpSkipTuesday && pd.day_of_week == 2) continue;
         if(InpCloseOnFriday && pd.day_of_week == 5 && pd.hour >= InpFridayFlatHourUTC) continue;
         int pMin = pd.hour * 60 + pd.min;
         if(InpBlockRollover && (pMin >= 20 * 60 + 55 && pMin <= 23 * 60 + 5)) continue;
         if(InpUseSessionWindow)
           {
            bool inM = (pd.hour >= InpSessionStartUTC && pd.hour < InpSessionEndUTC);
            bool inN = (InpAllowLateNyWindow && pd.hour >= InpLateNyStartUTC && pd.hour < InpLateNyEndUTC);
            if(!inM && !inN) continue;
           }
         long waitSec = (long)(probe - nowGmt);
         if(waitSec > 0)
            return baseStatus + " (" + FormatCountdownSec(waitSec) + ")";
         break;
        }
     }
   return baseStatus;
  }

//+------------------------------------------------------------------+
//| Live State Persistence (Survives Terminal / VPS Reboots)         |
//+------------------------------------------------------------------+
string GprSanitizeTag(const string raw)
  {
   string out = "";
   int len = StringLen(raw);
   for(int i = 0; i < len && StringLen(out) < 8; i++)
     {
      ushort ch = StringGetCharacter(raw, i);
      bool ok = ((ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') ||
                 (ch >= 'a' && ch <= 'z') || ch == '_');
      if(ok) out += ShortToString(ch);
     }
   if(out == "") out = "V810";
   return out;
  }

bool IsAllowedGoldSymbol()
  {
   if(!InpRequireXauUsd) return true;
   string u = _Symbol;
   StringToUpper(u);
   if(StringFind(u, "XAUUSD") >= 0 || StringFind(u, "GOLD") >= 0) return true;
   return false;
  }

bool IsAllowedChartTf()
  {
   if(!InpRequireM5Chart) return true;
   return (_Period == InpSignalTf);
  }

string GprGvPrefix()
  {
   long login = (g_activeLogin > 0) ? g_activeLogin : AccountInfoInteger(ACCOUNT_LOGIN);
   return StringFormat("GPR810_%s_%I64d_%s_%I64d_",
                       GprSanitizeTag(InpMemoryId), login, _Symbol, InpMagicNumber);
  }

string GprGvKey(const string field)
  {
   string k = GprGvPrefix() + field;
   if(StringLen(k) > 62) k = StringSubstr(k, 0, 62);
   return k;
  }

void ResetCurrentMemorySlot()
  {
   if(g_isTester) return;
   string pref = GprGvPrefix();
   int deleted = 0;
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, pref) == 0)
        {
         if(GlobalVariableDel(nm)) deleted++;
        }
     }
   if(deleted > 0)
     {
      GlobalVariablesFlush();
      PrintFormat("GPR810 MEMORY RESET: Cleared %d keys for slot [%s].", deleted, pref);
     }
  }

int PurgeLegacyGprMemory()
  {
   if(g_isTester || !InpPurgeLegacyMemory) return 0;
   long login = (g_activeLogin > 0) ? g_activeLogin : AccountInfoInteger(ACCOUNT_LOGIN);
   string curPref  = GprGvPrefix();
   string acctTok  = StringFormat("_%I64d_%s_", login, _Symbol);
   string loginTok = StringFormat("_%I64d_", login);
   int purged = 0;
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      bool isGprKey = (StringFind(nm, "GPR") == 0 || StringFind(nm, "GP_") == 0);
      bool sameAcctSym = (StringFind(nm, acctTok) > 0 ||
                          (StringFind(nm, loginTok) > 0 && StringFind(nm, _Symbol) > 0));
      if(isGprKey && sameAcctSym && StringFind(nm, curPref) != 0)
        {
         if(GlobalVariableDel(nm)) purged++;
        }
     }
   if(purged > 0)
     {
      GlobalVariablesFlush();
      PrintFormat("GPR810 LEGACY MEMORY PURGED: Removed %d old-version keys for %s (login %I64d).",
                  purged, _Symbol, login);
     }
   return purged;
  }

int GprReasonToCode(const string rsn)
  {
   if(rsn == "DAILY_LOSS")      return 1;
   if(rsn == "CONSEC_LOSS")     return 2;
   if(rsn == "MAX_TRADES")      return 3;
   if(rsn == "MAX_EQ_DD")       return 4;
   if(rsn == "START_DD_STOP")   return 5;
   if(rsn == "DAY_PROFIT_LOCK") return 6;
   if(rsn == "DD_PAUSE")        return 7;
   if(rsn == "BANK_PROTECTED")  return 8;
   return 0;
  }

string GprCodeToReason(const int c)
  {
   if(c == 1) return "DAILY_LOSS";
   if(c == 2) return "CONSEC_LOSS";
   if(c == 3) return "MAX_TRADES";
   if(c == 4) return "MAX_EQ_DD";
   if(c == 5) return "START_DD_STOP";
   if(c == 6) return "DAY_PROFIT_LOCK";
   if(c == 7) return "DD_PAUSE";
   if(c == 8) return "BANK_PROTECTED";
   return "DAILY_LOCK";
  }

void SaveLiveState(const bool flushNow = false)
  {
   if(g_isTester) return;
   if(g_activeLogin > 0 && AccountInfoInteger(ACCOUNT_LOGIN) != g_activeLogin) return;
   if(g_activeCurrency != "" && AccountInfoString(ACCOUNT_CURRENCY) != g_activeCurrency) return;
   GlobalVariableSet(GprGvKey("verNum"),      (double)GPR_STATE_VER_NUM);
   GlobalVariableSet(GprGvKey("batchPnl"),    g_batchPnl);
   GlobalVariableSet(GprGvKey("isCent"),      (g_activeCurrency == "USC") ? 1.0 : 0.0);
   GlobalVariableSet(GprGvKey("paused"),      g_paused ? 1.0 : 0.0);
   GlobalVariableSet(GprGvKey("lastSigBar"),  (double)g_lastSigBar);
   GlobalVariableSet(GprGvKey("shockUntil"),  (double)g_shockPauseUntil);
   GlobalVariableSet(GprGvKey("startBal"),    g_startBalance);
   GlobalVariableSet(GprGvKey("banked"),      g_bankedProfit);
   GlobalVariableSet(GprGvKey("cycleStart"),  g_cycleStart);
   GlobalVariableSet(GprGvKey("hwmTot"),      g_hwmTotalBal);
   GlobalVariableSet(GprGvKey("skimCnt"),     (double)g_bankSkimCount);
   GlobalVariableSet(GprGvKey("runWin"),      (double)g_runConsecWins);
   GlobalVariableSet(GprGvKey("runLoss"),     (double)g_runConsecLoss);
   GlobalVariableSet(GprGvKey("lastClose"),   (double)g_lastCloseTime);
   GlobalVariableSet(GprGvKey("lastWasLoss"), g_lastTradeLoss ? 1.0 : 0.0);
   GlobalVariableSet(GprGvKey("utcYr"),       (double)g_day.utcYear);
   GlobalVariableSet(GprGvKey("utcDay"),      (double)g_day.utcDay);
   GlobalVariableSet(GprGvKey("dayStartEq"),  g_day.dayStartEq);
   GlobalVariableSet(GprGvKey("peakBal"),     g_day.peakBal);
   GlobalVariableSet(GprGvKey("peakEq"),      g_day.peakEq);
   GlobalVariableSet(GprGvKey("closedPnl"),   g_day.closedPnl);
   GlobalVariableSet(GprGvKey("dayTrd"),      (double)g_day.trades);
   GlobalVariableSet(GprGvKey("dayWin"),      (double)g_day.wins);
   GlobalVariableSet(GprGvKey("dayCLoss"),    (double)g_day.consecLoss);
   GlobalVariableSet(GprGvKey("dayBlocked"),  g_day.blocked ? 1.0 : 0.0);
   GlobalVariableSet(GprGvKey("dayKill"),     g_day.killSwitch ? 1.0 : 0.0);
   GlobalVariableSet(GprGvKey("dayReason"),   (double)GprReasonToCode(g_day.reason));
   GlobalVariableSet(GprGvKey("ddPause"),     (double)g_ddPauseUntil);
   if(flushNow) GlobalVariablesFlush();
  }

bool LoadLiveState()
  {
   if(g_isTester) return false;
   if(!GlobalVariableCheck(GprGvKey("verNum"))) return false;
   int savedVer = (int)MathRound(GlobalVariableGet(GprGvKey("verNum")));
   if(savedVer != GPR_STATE_VER_NUM)
     {
      PrintFormat("GPR810 STATE VERSION MISMATCH (saved=%d, cur=%d) -> Resetting state.",
                  savedVer, GPR_STATE_VER_NUM);
      ResetCurrentMemorySlot();
      return false;
     }
   if(!GlobalVariableCheck(GprGvKey("startBal"))) return false;

   // Never mix USC (cent) and USD state if account currency changed
   if(GlobalVariableCheck(GprGvKey("isCent")))
     {
      bool savedCent = (GlobalVariableGet(GprGvKey("isCent")) > 0.5);
      bool curCent   = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
      if(savedCent != curCent)
        {
         Print("GPR810 ACCOUNT CURRENCY CHANGED -> Ignoring old state and starting fresh.");
         return false;
        }
     }

   double savedStart = GlobalVariableGet(GprGvKey("startBal"));
   if(savedStart <= 0.0) return false;

   g_paused          = (GlobalVariableCheck(GprGvKey("paused"))     && GlobalVariableGet(GprGvKey("paused")) > 0.5);
   g_lastSigBar      = GlobalVariableCheck(GprGvKey("lastSigBar"))  ? (datetime)GlobalVariableGet(GprGvKey("lastSigBar")) : 0;
   datetime svShock  = GlobalVariableCheck(GprGvKey("shockUntil"))  ? (datetime)GlobalVariableGet(GprGvKey("shockUntil")) : 0;
   if(svShock > TimeCurrent()) { g_shockPauseUntil = svShock; g_volStatus = "NEWS_SHOCK"; }
   g_startBalance    = savedStart;
   g_bankedProfit    = GlobalVariableCheck(GprGvKey("banked"))      ? MathMax(0.0, GlobalVariableGet(GprGvKey("banked"))) : 0.0;
   g_cycleStart      = GlobalVariableCheck(GprGvKey("cycleStart"))  ? GlobalVariableGet(GprGvKey("cycleStart")) : g_startBalance;
   g_hwmTotalBal     = GlobalVariableCheck(GprGvKey("hwmTot"))      ? GlobalVariableGet(GprGvKey("hwmTot"))     : g_startBalance;
   g_bankSkimCount   = GlobalVariableCheck(GprGvKey("skimCnt"))     ? (int)GlobalVariableGet(GprGvKey("skimCnt")) : 0;
   g_runConsecWins   = GlobalVariableCheck(GprGvKey("runWin"))      ? (int)GlobalVariableGet(GprGvKey("runWin"))  : 0;
   g_runConsecLoss   = GlobalVariableCheck(GprGvKey("runLoss"))     ? (int)GlobalVariableGet(GprGvKey("runLoss")) : 0;
   g_lastCloseTime   = GlobalVariableCheck(GprGvKey("lastClose"))   ? (datetime)GlobalVariableGet(GprGvKey("lastClose")) : 0;
   g_lastTradeLoss   = (GlobalVariableCheck(GprGvKey("lastWasLoss")) && GlobalVariableGet(GprGvKey("lastWasLoss")) > 0.5);
   g_ddPauseUntil    = GlobalVariableCheck(GprGvKey("ddPause"))     ? (datetime)GlobalVariableGet(GprGvKey("ddPause")) : 0;
   g_batchPnl        = GlobalVariableCheck(GprGvKey("batchPnl"))    ? GlobalVariableGet(GprGvKey("batchPnl")) : 0.0;

   MqlDateTime nowDt;
   TimeToStruct(TimeGMT(), nowDt);
   int savedYr  = GlobalVariableCheck(GprGvKey("utcYr"))  ? (int)GlobalVariableGet(GprGvKey("utcYr"))  : -1;
   int savedDay = GlobalVariableCheck(GprGvKey("utcDay")) ? (int)GlobalVariableGet(GprGvKey("utcDay")) : -1;

   g_day.peakBal = GlobalVariableCheck(GprGvKey("peakBal")) ? GlobalVariableGet(GprGvKey("peakBal")) : 0.0;
   g_day.peakEq  = GlobalVariableCheck(GprGvKey("peakEq"))  ? GlobalVariableGet(GprGvKey("peakEq"))  : 0.0;

   if(savedYr == nowDt.year && savedDay == nowDt.day_of_year)
     {
      g_day.utcYear    = savedYr;
      g_day.utcDay     = savedDay;
      g_day.dayStartEq = GlobalVariableCheck(GprGvKey("dayStartEq")) ? GlobalVariableGet(GprGvKey("dayStartEq")) : 0.0;
      g_day.closedPnl  = GlobalVariableCheck(GprGvKey("closedPnl"))  ? GlobalVariableGet(GprGvKey("closedPnl"))  : 0.0;
      g_day.trades     = GlobalVariableCheck(GprGvKey("dayTrd"))     ? (int)GlobalVariableGet(GprGvKey("dayTrd"))  : 0;
      g_day.wins       = GlobalVariableCheck(GprGvKey("dayWin"))     ? (int)GlobalVariableGet(GprGvKey("dayWin"))  : 0;
      g_day.consecLoss = GlobalVariableCheck(GprGvKey("dayCLoss"))   ? (int)GlobalVariableGet(GprGvKey("dayCLoss")) : 0;
      g_day.blocked    = (GlobalVariableCheck(GprGvKey("dayBlocked")) && GlobalVariableGet(GprGvKey("dayBlocked")) > 0.5);
      g_day.killSwitch = (GlobalVariableCheck(GprGvKey("dayKill"))    && GlobalVariableGet(GprGvKey("dayKill"))    > 0.5);
      int rCode        = GlobalVariableCheck(GprGvKey("dayReason"))  ? (int)GlobalVariableGet(GprGvKey("dayReason")) : 0;
      if(g_day.blocked) g_day.reason = GprCodeToReason(rCode);
     }
   PrintFormat("GPR810 STATE RESTORED: Start=%.2f Bank=%.2f Peak=%.2f DayPnL=%.2f Paused=%s",
               g_startBalance, g_bankedProfit, g_day.peakBal, g_day.closedPnl, g_paused ? "YES" : "NO");
   return true;
  }


void ClearChartOverlay()
  {
   long cid = ChartID();
   ObjectsDeleteAll(cid, "GPR810_OV_");
   ChartRedraw(cid);
  }

void DrawOverlayTrendSeg(const long cid, const string name, const datetime t1, const double p1,
                         const datetime t2, const double p2, const color clr,
                         const ENUM_LINE_STYLE sty, const int width)
  {
   if(ObjectFind(cid, name) < 0)
     {
      if(!ObjectCreate(cid, name, OBJ_TREND, 0, t1, p1, t2, p2)) return;
      ObjectSetInteger(cid, name, OBJPROP_RAY_LEFT, false);
      ObjectSetInteger(cid, name, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(cid, name, OBJPROP_BACK, true);
      ObjectSetInteger(cid, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(cid, name, OBJPROP_HIDDEN, true);
     }
   else
     {
      ObjectSetInteger(cid, name, OBJPROP_TIME, 0, t1);
      ObjectSetDouble(cid,  name, OBJPROP_PRICE, 0, p1);
      ObjectSetInteger(cid, name, OBJPROP_TIME, 1, t2);
      ObjectSetDouble(cid,  name, OBJPROP_PRICE, 1, p2);
     }
   ObjectSetInteger(cid, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(cid, name, OBJPROP_STYLE, sty);
   ObjectSetInteger(cid, name, OBJPROP_WIDTH, width);
  }

void DrawOverlayHLine(const long cid, const string name, const double price,
                      const color clr, const ENUM_LINE_STYLE sty, const int width, const string tip)
  {
   if(price <= 0.0) { if(ObjectFind(cid, name) >= 0) ObjectDelete(cid, name); return; }
   if(ObjectFind(cid, name) < 0)
     {
      if(!ObjectCreate(cid, name, OBJ_HLINE, 0, 0, price)) return;
      ObjectSetInteger(cid, name, OBJPROP_BACK, true);
      ObjectSetInteger(cid, name, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(cid, name, OBJPROP_HIDDEN, true);
     }
   else
     {
      ObjectSetDouble(cid, name, OBJPROP_PRICE, 0, price);
     }
   ObjectSetInteger(cid, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(cid, name, OBJPROP_STYLE, sty);
   ObjectSetInteger(cid, name, OBJPROP_WIDTH, width);
   ObjectSetString(cid,  name, OBJPROP_TOOLTIP, tip);
  }

void DrawRightPricePill(const long cid, const string baseName, const int yCenter,
                        const string text, const color fgClr, const color brdClr, const color bgClr,
                        const int fixedW = 0)
  {
   string bgName  = baseName + "_BG";
   string txtName = baseName + "_TX";
   if(yCenter < 0 || text == "")
     {
      if(ObjectFind(cid, bgName)  >= 0) ObjectDelete(cid, bgName);
      if(ObjectFind(cid, txtName) >= 0) ObjectDelete(cid, txtName);
      return;
     }

   int pillW = (fixedW > 0) ? fixedW : MathMax(90, StringLen(text) * 7 + 16);
   int pillH = 19;
   int xDist = 2;
   int yTop  = yCenter - pillH / 2;

   if(ObjectFind(cid, bgName) < 0)
     {
      if(!ObjectCreate(cid, bgName, OBJ_RECTANGLE_LABEL, 0, 0, 0)) return;
      ObjectSetInteger(cid, bgName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
      ObjectSetInteger(cid, bgName, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(cid, bgName, OBJPROP_BACK, false);
      ObjectSetInteger(cid, bgName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(cid, bgName, OBJPROP_HIDDEN, true);
     }
   ObjectSetInteger(cid, bgName, OBJPROP_XDISTANCE, pillW + xDist);
   ObjectSetInteger(cid, bgName, OBJPROP_YDISTANCE, yTop);
   ObjectSetInteger(cid, bgName, OBJPROP_XSIZE, pillW);
   ObjectSetInteger(cid, bgName, OBJPROP_YSIZE, pillH);
   ObjectSetInteger(cid, bgName, OBJPROP_BGCOLOR, bgClr);
   ObjectSetInteger(cid, bgName, OBJPROP_COLOR, brdClr);

   if(ObjectFind(cid, txtName) < 0)
     {
      if(!ObjectCreate(cid, txtName, OBJ_LABEL, 0, 0, 0)) return;
      ObjectSetInteger(cid, txtName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
      ObjectSetInteger(cid, txtName, OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER);
      ObjectSetInteger(cid, txtName, OBJPROP_BACK, false);
      ObjectSetInteger(cid, txtName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(cid, txtName, OBJPROP_HIDDEN, true);
     }
   ObjectSetString(cid,  txtName, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(cid, txtName, OBJPROP_FONTSIZE, 9);
   ObjectSetInteger(cid, txtName, OBJPROP_XDISTANCE, 8);
   ObjectSetInteger(cid, txtName, OBJPROP_YDISTANCE, yTop + 2);
   ObjectSetString(cid,  txtName, OBJPROP_TEXT, text);
   ObjectSetInteger(cid, txtName, OBJPROP_COLOR, fgClr);
  }

void UpdateChartOverlay(const bool force = false)
  {
   if(!InpShowChartOverlay || !g_isVisual || g_isTester) return;
   datetime curBar = iTime(_Symbol, InpSignalTf, 0);
   if(curBar == 0) return;
   if(!force && curBar == g_lastOverlayBar) return;

   int bars = MathMax(20, MathMin(300, InpChartBbBars));
   double bUp[], bLo[], bMid[];
   datetime tm[];
   ArraySetAsSeries(bUp, true);
   ArraySetAsSeries(bLo, true);
   ArraySetAsSeries(bMid, true);
   ArraySetAsSeries(tm, true);

   int gotUp  = CopyBuffer(g_hBbSig, 1, 0, bars, bUp);
   int gotLo  = CopyBuffer(g_hBbSig, 2, 0, bars, bLo);
   int gotMid = CopyBuffer(g_hBbSig, 0, 0, bars, bMid);
   int gotTm  = CopyTime(_Symbol, InpSignalTf, 0, bars, tm);
   int nDraw  = MathMin(MathMin(gotUp, gotLo), MathMin(gotMid, gotTm));
   if(nDraw < 20) return;

   g_lastOverlayBar = (nDraw >= bars) ? curBar : 0;
   long cid = ChartID();

   bool isBear = (StringFind(g_biasTxt, "BEAR") >= 0);
   bool isBull = (StringFind(g_biasTxt, "BULL") >= 0);

   color cUp     = C'215,95,112';
   color cLo     = C'58,215,162';
   color cTrig   = C'255,148,40';
   color cMid    = C'115,135,165';
   color cVwap   = C'235,190,65';

   for(int i = 0; i < nDraw - 1; i++)
     {
      DrawOverlayTrendSeg(cid, "GPR810_OV_BBU_" + IntegerToString(i), tm[i+1], bUp[i+1], tm[i], bUp[i], cUp,  STYLE_SOLID, 3);
      DrawOverlayTrendSeg(cid, "GPR810_OV_BBL_" + IntegerToString(i), tm[i+1], bLo[i+1], tm[i], bLo[i], cLo,  STYLE_SOLID, 3);
      DrawOverlayTrendSeg(cid, "GPR810_OV_BBM_" + IntegerToString(i), tm[i+1], bMid[i+1], tm[i], bMid[i], cMid, STYLE_DOT,   1);
     }

   double trigPx = isBear ? bUp[1] : (isBull ? bLo[1] : 0.0);
   if(isBear)
      DrawOverlayHLine(cid, "GPR810_OV_TRIG", trigPx, cTrig, STYLE_DASH, 1, "Sell Entry Trigger");
   else if(isBull)
      DrawOverlayHLine(cid, "GPR810_OV_TRIG", trigPx, cTrig, STYLE_DASH, 1, "Buy Entry Trigger");
   else
      DrawOverlayHLine(cid, "GPR810_OV_TRIG", 0.0, cMid, STYLE_DASH, 1, "");

   double vwapPx = 0.0, vwapZ = 0.0;
   bool hasVw = (InpShowVwapLine && ComputeSessionVwapZ(InpSignalTf, vwapPx, vwapZ) && vwapPx > 0.0);
   if(hasVw)
      DrawOverlayHLine(cid, "GPR810_OV_VWAP", vwapPx, cVwap, STYLE_DASH, 1, "Daily Fair Price");
   else
      DrawOverlayHLine(cid, "GPR810_OV_VWAP", 0.0, clrNONE, STYLE_DOT, 1, "");

   // Active open position Entry / Stop Loss / Take Profit bold lines + exact Est. Profit
   double posEntry = 0.0, posSl = 0.0, posTp = 0.0, posVol = 0.0;
   double estTpProfit = 0.0, estSlLoss = 0.0;
   bool   hasPos = false;
   for(int p = PositionsTotal() - 1; p >= 0; p--)
     {
      ulong tkPos = PositionGetTicket(p);
      if(tkPos == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
        {
         ENUM_POSITION_TYPE pType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         ENUM_ORDER_TYPE    oType = (pType == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         double ePx = PositionGetDouble(POSITION_PRICE_OPEN);
         double sPx = PositionGetDouble(POSITION_SL);
         double tPx = PositionGetDouble(POSITION_TP);
         double v   = PositionGetDouble(POSITION_VOLUME);
         if(!hasPos) { posEntry = ePx; posSl = sPx; posTp = tPx; }
         posVol += v;
         hasPos = true;
         double pnlTmp = 0.0;
         if(tPx > 0.0 && OrderCalcProfit(oType, _Symbol, v, ePx, tPx, pnlTmp)) estTpProfit += pnlTmp;
         if(sPx > 0.0 && OrderCalcProfit(oType, _Symbol, v, ePx, sPx, pnlTmp)) estSlLoss   += pnlTmp;
        }
     }

   bool   ovCent = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
   string ovPre  = ovCent ? ShortToString(0x00A2) : "$";
   string ovSuf  = "";
   string tpTag  = (hasPos && posTp > 0.0) ? StringFormat(" (+%s%.2f%s)", ovPre, MathMax(0.0, estTpProfit), ovSuf) : "";
   string slTag  = (hasPos && posSl > 0.0) ? StringFormat(" (-%s%.2f%s)", ovPre, MathAbs(estSlLoss), ovSuf) : "";
   string entTag = hasPos ? StringFormat(" (%.2fL)", posVol) : "";

   color cEntry = clrDeepSkyBlue;
   color cSl    = clrTomato;
   color cTp    = clrMediumSeaGreen;
   DrawOverlayHLine(cid, "GPR810_OV_POS_ENT", hasPos ? posEntry : 0.0, cEntry, STYLE_SOLID, 2, "Open Position Entry");
   DrawOverlayHLine(cid, "GPR810_OV_POS_SL",  hasPos ? posSl    : 0.0, cSl,    STYLE_SOLID, 3, "Stop Loss (SL)");
   DrawOverlayHLine(cid, "GPR810_OV_POS_TP",  hasPos ? posTp    : 0.0, cTp,    STYLE_SOLID, 3, "Take Profit (TP)");

   // Convert prices to Y-pixels & dock crisp pills along the right price scale
   long chH = ChartGetInteger(cid, CHART_HEIGHT_IN_PIXELS, 0);
   if(chH <= 100) chH = 720;

   double pPrices[8];
   string pLabels[8];
   color  pFg[8], pBrd[8], pBg[8];
   int    pFixedW[8];
   string pNames[8] = {
      "GPR810_OV_P_BBU", "GPR810_OV_P_TRG", "GPR810_OV_P_VW", "GPR810_OV_P_MID",
      "GPR810_OV_P_BBL", "GPR810_OV_P_ENT", "GPR810_OV_P_SL", "GPR810_OV_P_TP"
   };
   int    pY[8];
   bool   pActive[8];

   pPrices[0] = bUp[0];   pLabels[0] = StringFormat("SELL ZONE %.2f", bUp[0]);
                          pBrd[0] = cUp;   pBg[0] = C'48,24,32'; pFg[0] = C'255,175,185'; pFixedW[0] = 0;   pActive[0] = true;
   pPrices[1] = trigPx;   pLabels[1] = StringFormat(isBear ? "SELL TRIG %.2f" : "BUY TRIG %.2f", trigPx);
                          pBrd[1] = cTrig; pBg[1] = C'54,32,14'; pFg[1] = C'255,200,120'; pFixedW[1] = 0;   pActive[1] = (trigPx > 0.0);
   pPrices[2] = vwapPx;   pLabels[2] = StringFormat("FAIR %.2f", vwapPx);
                          pBrd[2] = cVwap; pBg[2] = C'46,38,18'; pFg[2] = C'255,220,110'; pFixedW[2] = 0;   pActive[2] = hasVw;
   pPrices[3] = bMid[0];  pLabels[3] = StringFormat("MEAN %.2f", bMid[0]);
                          pBrd[3] = cMid;  pBg[3] = C'24,30,42'; pFg[3] = C'195,210,232'; pFixedW[3] = 0;   pActive[3] = true;
   pPrices[4] = bLo[0];   pLabels[4] = StringFormat("BUY ZONE %.2f", bLo[0]);
                          pBrd[4] = cLo;   pBg[4] = C'18,44,36'; pFg[4] = C'140,245,205'; pFixedW[4] = 0;   pActive[4] = true;
   pPrices[5] = posEntry; pLabels[5] = StringFormat("ORDER ENTRY %.2f%s", posEntry, entTag);
                          pBrd[5] = cEntry; pBg[5] = C'14,36,64'; pFg[5] = cEntry;        pFixedW[5] = 256; pActive[5] = (hasPos && posEntry > 0.0);
   pPrices[6] = posSl;    pLabels[6] = StringFormat("ORDER SL %.2f%s", posSl, slTag);
                          pBrd[6] = cSl;   pBg[6] = C'80,20,30'; pFg[6] = cSl;           pFixedW[6] = 256; pActive[6] = (hasPos && posSl > 0.0);
   pPrices[7] = posTp;    pLabels[7] = StringFormat("ORDER TP %.2f%s", posTp, tpTag);
                          pBrd[7] = cTp;   pBg[7] = C'16,56,40'; pFg[7] = cTp;           pFixedW[7] = 256; pActive[7] = (hasPos && posTp > 0.0);

   for(int k = 0; k < 8; k++)
     {
      pY[k] = -1;
      if(!pActive[k] || pPrices[k] <= 0.0) continue;
      int xTmp = 0, yTmp = 0;
      if(ChartTimePriceToXY(cid, 0, tm[0], pPrices[k], xTmp, yTmp))
        {
         if(yTmp < 16) yTmp = 16;
         if(yTmp > (int)chH - 18) yTmp = (int)chH - 18;
         pY[k] = yTmp;
        }
     }

   // Anti-collision pass (minimum 23px vertical spacing between right-edge pills)
   int order[8] = { 0, 1, 2, 3, 4, 5, 6, 7 };
   for(int a = 0; a < 8; a++)
     {
      for(int b = a + 1; b < 8; b++)
        {
         int ia = order[a], ib = order[b];
         if(pY[ib] >= 0 && (pY[ia] < 0 || pY[ib] < pY[ia]))
           { int tmp = order[a]; order[a] = order[b]; order[b] = tmp; }
        }
     }
   int lastY = -100;
   for(int idx = 0; idx < 8; idx++)
     {
      int k = order[idx];
      if(pY[k] < 0) continue;
      if(pY[k] - lastY < 23) pY[k] = lastY + 23;
      if(pY[k] > (int)chH - 16) pY[k] = (int)chH - 16;
      lastY = pY[k];
     }

   for(int k = 0; k < 8; k++)
      DrawRightPricePill(cid, pNames[k], pY[k], pLabels[k], pFg[k], pBrd[k], pBg[k], pFixedW[k]);
   ChartRedraw(cid);
  }

void RefreshHudMarketState()
  {
   if(g_isTester && !g_isVisual) return;
   double bAtr[1], bRsi[1], bH1F[1], bH1S[1], bH4F[1], bH4S[1];
   MqlTick tkHud;
   if(SymbolInfoTick(_Symbol, tkHud) && tkHud.bid > 0.0 && CopyBuffer(g_hAtrSig, 0, 1, 1, bAtr) == 1 && bAtr[0] > 0.0)
     {
      double atrHud = bAtr[0];
      if(InpUseParkinsonVol)
        {
         double parkHud = 0.0;
         if(ComputeParkinsonVolPrice(InpSignalTf, InpParkinsonBars, tkHud.bid, parkHud))
            atrHud = 0.65 * atrHud + 0.35 * parkHud;
        }
      g_lastAtrVal = atrHud;
      double atrPctHud = 0.0;
      string volWhyHud = "";
      IsVolatilityOptimal(atrHud, tkHud.bid, atrPctHud, volWhyHud);
      g_lastAtrPct = atrPctHud;
      if(g_shockPauseUntil <= TimeCurrent() && !IsMt5CalendarNewsWindow())
         g_volStatus = volWhyHud;
     }

   if(CopyBuffer(g_hRsiSig, 0, 1, 1, bRsi) == 1)
      g_lastRsiVal = bRsi[0];

   if(InpUseMacroTrend && (CopyBuffer(g_hEmaFastH1, 0, 1, 1, bH1F) != 1 || CopyBuffer(g_hEmaSlowH1, 0, 1, 1, bH1S) != 1))
     { g_biasTxt = "SYNC H1/H4..."; g_waitTxt = "Syncing H1/H4 history..."; return; }
   if(InpUseH4Macro && (CopyBuffer(g_hEmaFastH4, 0, 1, 1, bH4F) != 1 || CopyBuffer(g_hEmaSlowH4, 0, 1, 1, bH4S) != 1))
     { g_biasTxt = "SYNC H1/H4..."; g_waitTxt = "Syncing H1/H4 history..."; return; }

   double erVal = 1.0;
   bool   isErChop = false;
   if(InpUseKaufmanER && InpMinH1Er > 0.0 && ComputeKaufmanER(InpMacroTf, InpErPeriod, erVal))
     {
      g_lastH1Er = erVal;
      if(erVal < InpMinH1Er) isErChop = true;
     }

   int h1Dir = InpUseMacroTrend ? ((bH1F[0] > bH1S[0]) ? 1 : ((bH1F[0] < bH1S[0]) ? -1 : 0)) : 0;
   int h4Dir = InpUseH4Macro    ? ((bH4F[0] > bH4S[0]) ? 1 : ((bH4F[0] < bH4S[0]) ? -1 : 0)) : 0;

   if(isErChop)
      g_biasTxt = "H1 CHOP ER";
   else if(InpUseMacroTrend && InpUseH4Macro)
     {
      if(h1Dir == 1 && h4Dir == 1)       g_biasTxt = "H4+H1 BULL";
      else if(h1Dir == -1 && h4Dir == -1) g_biasTxt = "H4+H1 BEAR";
      else                               g_biasTxt = "H4/H1 SPLIT";
     }
   else if(InpUseMacroTrend)
      g_biasTxt = (h1Dir == 1) ? "H1 BULL" : ((h1Dir == -1) ? "H1 BEAR" : "H1 FLAT");
   else if(InpUseH4Macro)
      g_biasTxt = (h4Dir == 1) ? "H4 BULL" : ((h4Dir == -1) ? "H4 BEAR" : "H4 FLAT");
   else
      g_biasTxt = "2-WAY";

   // Live Wait Diagnostic (zero-cost HUD checklist)
   double bUp[2], bLo[2], rWait[2];
   double bbUp1 = (CopyBuffer(g_hBbSig, 1, 1, 2, bUp) == 2) ? bUp[1] : 0.0;
   double bbLo1 = (CopyBuffer(g_hBbSig, 2, 1, 2, bLo) == 2) ? bLo[1] : 0.0;
   bool hasR0   = (CopyClose(_Symbol, InpSignalTf, 1, 1, rWait) == 1);
   double vwapPx = 0.0, vwapZ = 0.0;
   bool hasVw    = (InpUseVwapZScore || InpUseVwapKnifeGuard) ? ComputeSessionVwapZ(InpSignalTf, vwapPx, vwapZ) : false;
   if(hasVw) g_lastVwapZ = vwapZ;

   string sessWhy = "";
   bool sessOk = IsInTradingWindow(sessWhy);
   double fltTmp = 0.0;
   int openCnt = CountOurPositions(fltTmp);

   if(!g_symbolOk)             g_waitTxt = "Switch chart to XAUUSD";
   else if(!g_tfOk)            g_waitTxt = "Switch chart timeframe to M5";
   else if(openCnt > 0)
     {
      double tTp = 0.0, tSl = 0.0, tVol = 0.0;
      bool isBuyPos = false;
      for(int p = PositionsTotal() - 1; p >= 0; p--)
        {
         ulong tkPos = PositionGetTicket(p);
         if(tkPos == 0) continue;
         if(PositionGetString(POSITION_SYMBOL) == _Symbol && IsOurMagic(PositionGetInteger(POSITION_MAGIC)))
           {
            ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
            isBuyPos = (pt == POSITION_TYPE_BUY);
            ENUM_ORDER_TYPE ot = isBuyPos ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
            double ep = PositionGetDouble(POSITION_PRICE_OPEN), sp = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP), v = PositionGetDouble(POSITION_VOLUME);
            tVol += v;
            double tmpP = 0.0;
            if(tp > 0.0 && OrderCalcProfit(ot, _Symbol, v, ep, tp, tmpP)) tTp += tmpP;
            if(sp > 0.0 && OrderCalcProfit(ot, _Symbol, v, ep, sp, tmpP)) tSl += tmpP;
           }
        }
      bool   hCent = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
      string hPre  = hCent ? ShortToString(0x00A2) : "$";
      string hSuf  = "";
      g_waitTxt = StringFormat("%s %.2fL | Est. TP: +%s%.2f%s | SL: -%s%.2f%s",
                               isBuyPos ? "BUY" : "SELL", tVol,
                               hPre, MathMax(0.0, tTp), hSuf,
                               hPre, MathAbs(tSl), hSuf);
     }
   else if(g_paused)           g_waitTxt = "Paused (click RESUME)";
   else if(g_day.blocked)      g_waitTxt = "Blocked: " + g_day.reason;
   else if(!sessOk)            g_waitTxt = "Session (" + sessWhy + ")";
   else if(!g_spread.spreadOk) g_waitTxt = "Spread <= $" + DoubleToString(InpMaxSpreadPrice, 2);
   else if(g_volStatus != "")  g_waitTxt = "Filter: " + g_volStatus;
   else if(g_biasTxt == "H1 CHOP ER")  g_waitTxt = StringFormat("H1 Chop Filter (ER %.2f < %.2f)", g_lastH1Er, InpMinH1Er);
   else if(g_biasTxt == "H4/H1 SPLIT") g_waitTxt = "H4 & H1 trend align";
   else if(g_lastSkipTxt != "" && TimeCurrent() < g_lastSkipUntil)
     {
      g_waitTxt = g_lastSkipTxt;
     }
   else if(StringFind(g_biasTxt, "BEAR") >= 0)
     {
      if(InpUseVwapKnifeGuard && hasVw && vwapZ >= InpVwapMaxKnifeZ)
         g_waitTxt = StringFormat("Crash Guard: Fair Price too high (%.2f SD)", vwapZ);
      else if(g_lastRsiVal >= InpRsiOverbought || (hasR0 && bbUp1 > 0.0 && rWait[0] >= bbUp1))
         g_waitTxt = StringFormat("Down candle close below Upper Band (%.2f)", bbUp1);
      else
        {
         double estTpPct = g_lastRiskPct * (InpTpAtrMult / MathMax(0.1, InpSlAtrMult));
         double estTpVal = AccountInfoDouble(ACCOUNT_BALANCE) * (estTpPct / 100.0);
         bool   hCent = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
         g_waitTxt = StringFormat("Bounce to %.2f / RSI>%.0f (Est TP +%s%.1f%s)", bbUp1, InpRsiOverbought, hCent ? ShortToString(0x00A2) : "$", estTpVal, "");
        }
     }
   else if(StringFind(g_biasTxt, "BULL") >= 0)
     {
      if(InpUseVwapKnifeGuard && hasVw && vwapZ <= -InpVwapMaxKnifeZ)
         g_waitTxt = StringFormat("Crash Guard: Fair Price too low (%.2f SD)", vwapZ);
      else if(g_lastRsiVal <= InpRsiOversold || (hasR0 && bbLo1 > 0.0 && rWait[0] <= bbLo1))
         g_waitTxt = StringFormat("Up candle close above Lower Band (%.2f)", bbLo1);
      else
        {
         double estTpPct = g_lastRiskPct * (InpTpAtrMult / MathMax(0.1, InpSlAtrMult));
         double estTpVal = AccountInfoDouble(ACCOUNT_BALANCE) * (estTpPct / 100.0);
         bool   hCent = (AccountInfoString(ACCOUNT_CURRENCY) == "USC");
         g_waitTxt = StringFormat("Drop to %.2f / RSI<%.0f (Est TP +%s%.1f%s)", bbLo1, InpRsiOversold, hCent ? ShortToString(0x00A2) : "$", estTpVal, "");
        }
     }
   else
      g_waitTxt = "Scanning M5 BB+RSI sweep";
  }

void RenderHud(const bool force, const string statusTxt, const int openPos)
  {
   if(!InpShowHud || !g_isVisual) return;
   double balVal = AccountInfoDouble(ACCOUNT_BALANCE);
   double workCap = balVal;
   if(InpUseProfitBank && g_bankedProfit > 0.0)
      workCap = MathMax(0.0, balVal - g_bankedProfit);
   double bankVal = InpUseProfitBank ? g_bankedProfit : g_vaultFloorBal;
   bool   bankOn  = InpUseProfitBank ? (g_bankedProfit > 0.0) : g_vaultActive;
   string riskModeTxt = (InpLotMode == GPR_LOT_DYNAMIC_RISK) ? (InpUseQuantKelly ? "B-KELLY" : "KELLY")
                        : ((InpLotMode == GPR_LOT_EQUITY_STEP) ? "EQ-STEP" : "FIXED");
   string memTxt   = g_memBadge + " | " + GprSanitizeTag(InpMemoryId) + " Ready";
   bool   memFresh = (g_memBadge != "SYNCED");
   g_hud.Draw(force, _Symbol, g_paused, IsAlgoTradingOn(), IsMarketOpenNow(), g_isTester,
              statusTxt, g_biasTxt, g_lastRsiVal, g_lastH1Er, g_lastVwapZ, g_lastAtrPct,
              riskModeTxt, g_waitTxt,
              g_lastRiskPct, g_lastLotVal,
              g_spread.lastSpread, g_lastDdPct, balVal, workCap, bankVal, bankOn,
              memTxt, memFresh,
              openPos, g_runConsecWins, g_runConsecLoss, g_day);
  }

int OnInit()
  {
   if(!RefreshSpecs())
     { Print("GPR810 ERROR: Failed to read symbol specs for ", _Symbol); return INIT_FAILED; }

   g_hAtrSig    = iATR(_Symbol, InpSignalTf, 14);
   g_hBbSig     = iBands(_Symbol, InpSignalTf, InpBbPeriod, 0, InpBbDeviation, PRICE_CLOSE);
   g_hRsiSig    = iRSI(_Symbol, InpSignalTf, InpRsiPeriod, PRICE_CLOSE);
   g_hEmaFastH1 = iMA(_Symbol, InpMacroTf, InpMacroFastEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaSlowH1 = iMA(_Symbol, InpMacroTf, InpMacroSlowEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaFastH4 = iMA(_Symbol, InpH4Tf, InpH4FastEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaSlowH4 = iMA(_Symbol, InpH4Tf, InpH4SlowEma, 0, MODE_EMA, PRICE_CLOSE);

   if(g_hAtrSig == INVALID_HANDLE || g_hBbSig == INVALID_HANDLE || g_hRsiSig == INVALID_HANDLE ||
      g_hEmaFastH1 == INVALID_HANDLE || g_hEmaSlowH1 == INVALID_HANDLE ||
      g_hEmaFastH4 == INVALID_HANDLE || g_hEmaSlowH4 == INVALID_HANDLE)
     { Print("GPR810 ERROR: Failed to initialize indicators"); return INIT_FAILED; }

   g_spread.Reset();
   g_day.Reset();
   g_paused          = false;
   g_isTester        = (bool)MQLInfoInteger(MQL_TESTER);
   g_prevOpenPos     = 0;
   g_runConsecWins   = 0;
   g_runConsecLoss   = 0;
   g_lastSigBar      = 0;
   g_lastCloseTime   = 0;
   g_lastTradeLoss   = false;
   g_activeLogin     = AccountInfoInteger(ACCOUNT_LOGIN);
   g_activeCurrency  = AccountInfoString(ACCOUNT_CURRENCY);
   g_startBalance    = AccountInfoDouble(ACCOUNT_BALANCE);
   g_bankedProfit    = 0.0;
   g_cycleStart      = g_startBalance;
   g_hwmTotalBal     = g_startBalance;
   g_bankSkimCount   = 0;
   g_vaultFloorBal   = 0.0;
   g_vaultActive     = false;
   g_batchPnl        = 0.0;
   g_retHead         = 0;
   g_retCount        = 0;
   g_lastEdgeMult    = 1.0;
   g_lastVolMult     = 1.0;
   ArrayInitialize(g_retRing, 0.0);
   g_shockPauseUntil = 0;
   g_ddPauseUntil    = 0;
   g_vaultLockedSince = 0;
   g_lastCalCheck    = 0;
   g_calBlocked      = false;
   g_lastRiskPct     = InpBaseRiskPct;
   g_lastDdPct       = 0.0;
   g_lastShieldMult  = 1.0;
   g_volStatus       = "";

   g_symbolOk  = IsAllowedGoldSymbol();
   if(!g_symbolOk)
      PrintFormat("GPR810 SYMBOL BLOCKED: Attached to %s — expected XAUUSD/GOLD! Switch chart to XAUUSDm or XAUUSDc.", _Symbol);
   g_tfOk      = IsAllowedChartTf();
   if(!g_tfOk)
      PrintFormat("GPR810 TIMEFRAME BLOCKED: Attached to %s — expected M5! Switch chart timeframe to M5.", EnumToString((ENUM_TIMEFRAMES)_Period));

   g_memPurged = PurgeLegacyGprMemory();
   if(InpResetMemoryOnInit)
     {
      ResetCurrentMemorySlot();
      g_memBadge = "RESET";
     }
   else if(LoadLiveState())
     {
      g_memBadge = (g_memPurged > 0) ? ("SYNCED/CLR:" + IntegerToString(g_memPurged)) : "SYNCED";
     }
   else
     {
      g_memBadge = (g_memPurged > 0) ? ("CLEANED(" + IntegerToString(g_memPurged) + ")") : "FRESH";
     }
   SyncDailyAccounting();
   SaveLiveState(true);

   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   g_isVisual  = (!g_isTester || visual);

   // Restore active NEWS_SHOCK pause across live restarts/recompiles from recent closed M5 bars
   if(!g_isTester && InpUseNewsShockPause)
     {
      int barSecInit = PeriodSeconds(InpSignalTf);
      if(barSecInit <= 0) barSecInit = 300;
      int lookBars = MathMax(3, MathMin(12, (MathMax(5, InpShockPauseMin) * 60) / barSecInit + 1));
      MqlRates rInit[];
      double   aInit[];
      ArraySetAsSeries(rInit, true);
      ArraySetAsSeries(aInit, true);
      if(CopyRates(_Symbol, InpSignalTf, 1, lookBars, rInit) == lookBars &&
         CopyBuffer(g_hAtrSig, 0, 1, lookBars, aInit) == lookBars)
        {
         datetime nowCur = TimeCurrent();
         for(int i = 0; i < lookBars; i++)
           {
            double barCloseTm = (double)(rInit[i].time + barSecInit);
            datetime expTm    = (datetime)(rInit[i].time + barSecInit + MathMax(5, InpShockPauseMin) * 60);
            if(expTm <= nowCur) continue;
            if(aInit[i] > 0.0 && (rInit[i].high - rInit[i].low) > aInit[i] * InpShockBarMult)
              {
               if(expTm > g_shockPauseUntil) g_shockPauseUntil = expTm;
               g_volStatus = "NEWS_SHOCK";
              }
           }
        }
     }

   if(InpShowHud && g_isVisual)
     {
      g_hud.Create(ChartID(), _Symbol, InpHudCorner, InpHudScale, InpHudOffsetX, InpHudOffsetY, InpHudRefreshMs);
      if(!g_isTester) EventSetMillisecondTimer(500);
      MqlTick tk0;
      if(SymbolInfoTick(_Symbol, tk0))
         g_spread.Update(tk0, InpMaxSpreadPrice, InpSpreadSpikeMult, g_spec.point);
      if(InpShowChartOverlay && !g_isTester && ChartGetInteger(ChartID(), CHART_SHIFT) == 0)
        {
         ChartSetInteger(ChartID(), CHART_SHIFT, true);
         ChartSetDouble(ChartID(), CHART_SHIFT_SIZE, 20.0);
        }
      ClearChartOverlay();
      RefreshHudMarketState();
      UpdateChartOverlay(true);
      string initSt = !g_symbolOk ? "WRONG_SYMBOL (NEED XAUUSD)" : (!g_tfOk ? "WRONG_TF (NEED M5)" : (g_volStatus != "" ? g_volStatus : "READY"));
      RenderHud(true, BuildTimedStatus(initSt), 0);
     }
   if(!g_isTester)
     {
      if(!InpShowHud || !g_isVisual) EventSetMillisecondTimer(1000);
      EP_RegisterRobot(InpMagicNumber, "GoldPulseReversion", "8.1.0", "{\"tf\":\"M5\",\"strategy\":\"sweep_reversion\"}");
     }
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
//| Huseynovlar Terminal — Zero-Overhead Telemetry (OnTimer only)    |
//+------------------------------------------------------------------+
void EP_EmitGoldTelemetry(const string statusTxt, const int openPos)
  {
   if(g_isTester) return;
   static ulong s_epLastMs = 0;
   ulong nowMs = GetTickCount64();
   if(nowMs - s_epLastMs < 1000) return;
   s_epLastMs = nowMs;

   double balVal = AccountInfoDouble(ACCOUNT_BALANCE);
   double workCap = (InpUseProfitBank && g_bankedProfit > 0.0) ? MathMax(0.0, balVal - g_bankedProfit) : balVal;
   double bankVal = InpUseProfitBank ? g_bankedProfit : g_vaultFloorBal;
   bool   bankOn  = InpUseProfitBank ? (g_bankedProfit > 0.0) : g_vaultActive;
   string riskModeTxt = (InpLotMode == GPR_LOT_DYNAMIC_RISK) ? (InpUseQuantKelly ? "B-KELLY" : "KELLY")
                        : ((InpLotMode == GPR_LOT_EQUITY_STEP) ? "EQ-STEP" : "FIXED");

   double bbMid = 0.0, bbUp = 0.0, bbLo = 0.0;
   double bM[1], bU[1], bL[1];
   if(g_hBbSig != INVALID_HANDLE)
     {
      if(CopyBuffer(g_hBbSig, 0, 0, 1, bM) == 1) bbMid = bM[0];
      if(CopyBuffer(g_hBbSig, 1, 0, 1, bU) == 1) bbUp  = bU[0];
      if(CopyBuffer(g_hBbSig, 2, 0, 1, bL) == 1) bbLo  = bL[0];
     }

   string payload = StringFormat(
      "{\"regime\":\"%s\",\"signal_bias\":\"%s\",\"wait_reason\":\"%s\",\"risk_mode\":\"%s\","
      "\"rsi_m5\":%.2f,\"er_h1\":%.4f,\"vwap_z\":%.3f,\"atr_pct\":%.4f,\"atr_val\":%.5f,"
      "\"bb_upper\":%.5f,\"bb_mid\":%.5f,\"bb_lower\":%.5f,"
      "\"spread\":%.5f,\"risk_pct\":%.2f,\"next_lot\":%.3f,"
      "\"edge_mult\":%.3f,\"vol_mult\":%.3f,\"shield_mult\":%.3f,"
      "\"balance\":%.2f,\"work_balance\":%.2f,\"bank_balance\":%.2f,\"bank_active\":%s,\"dd_pct\":%.2f,"
      "\"open_positions\":%d,\"day_pnl\":%.2f,\"day_trades\":%d,\"day_wins\":%d,"
      "\"day_blocked\":%s,\"day_reason\":\"%s\",\"consec_wins\":%d,\"consec_loss\":%d,"
      "\"paused\":%s,\"algo_enabled\":%s,\"market_open\":%s}",
      EP_EscapeJson(statusTxt), EP_EscapeJson(g_biasTxt), EP_EscapeJson(g_waitTxt), EP_EscapeJson(riskModeTxt),
      g_lastRsiVal, g_lastH1Er, g_lastVwapZ, g_lastAtrPct, g_lastAtrVal,
      bbUp, bbMid, bbLo,
      g_spread.lastSpread, g_lastRiskPct, g_lastLotVal,
      g_lastEdgeMult, g_lastVolMult, g_lastShieldMult,
      balVal, workCap, bankVal, bankOn ? "true" : "false", g_lastDdPct,
      openPos, g_day.closedPnl, g_day.trades, g_day.wins,
      g_day.blocked ? "true" : "false", EP_EscapeJson(g_day.reason), g_runConsecWins, g_runConsecLoss,
      g_paused ? "true" : "false", IsAlgoTradingOn() ? "true" : "false", IsMarketOpenNow() ? "true" : "false"
   );
   EP_ReportState(InpMagicNumber, payload);
  }

void OnDeinit(const int reason)
  {
   if(reason != REASON_ACCOUNT) SaveLiveState(true);
   if(!g_isTester) EventKillTimer();
   g_hud.Destroy();
   ClearChartOverlay();
   ChartRedraw(ChartID());
   if(g_hAtrSig    != INVALID_HANDLE) { IndicatorRelease(g_hAtrSig);    g_hAtrSig    = INVALID_HANDLE; }
   if(g_hBbSig     != INVALID_HANDLE) { IndicatorRelease(g_hBbSig);     g_hBbSig     = INVALID_HANDLE; }
   if(g_hRsiSig    != INVALID_HANDLE) { IndicatorRelease(g_hRsiSig);    g_hRsiSig    = INVALID_HANDLE; }
   if(g_hEmaFastH1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaFastH1); g_hEmaFastH1 = INVALID_HANDLE; }
   if(g_hEmaSlowH1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaSlowH1); g_hEmaSlowH1 = INVALID_HANDLE; }
   if(g_hEmaFastH4 != INVALID_HANDLE) { IndicatorRelease(g_hEmaFastH4); g_hEmaFastH4 = INVALID_HANDLE; }
   if(g_hEmaSlowH4 != INVALID_HANDLE) { IndicatorRelease(g_hEmaSlowH4); g_hEmaSlowH4 = INVALID_HANDLE; }
  }

void OnTimer()
  {
   if(g_isTester) return;
   MqlTick tk;
   if(SymbolInfoTick(_Symbol, tk))
      g_spread.Update(tk, InpMaxSpreadPrice, InpSpreadSpikeMult, g_spec.point);
   ulong nowMs = GetTickCount64();
   datetime curM5 = iTime(_Symbol, InpSignalTf, 0);
   if(curM5 != g_lastOverlayBar || (nowMs - g_lastHudEvalMs) >= 2000)
     {
      g_lastHudEvalMs = nowMs;
      RefreshHudMarketState();
      UpdateChartOverlay(false);
     }
   double flt = 0.0;
   int openPos = CountOurPositions(flt);
   string sessBlock = "";
   bool sessOk = IsInTradingWindow(sessBlock);
   string status = "ACTIVE";
   if(g_volStatus == "NEWS_SHOCK" && g_shockPauseUntil > 0 && TimeCurrent() >= g_shockPauseUntil)
      g_volStatus = "";
   if(!g_symbolOk)             status = "WRONG_SYMBOL (NEED XAUUSD)";
   else if(!g_tfOk)            status = "WRONG_TF (NEED M5)";
   else if(g_paused)           status = "PAUSED";
   else if(g_day.blocked)      status = (openPos > 0) ? "IN TRADE (DAY LOCK)" : g_day.reason;
   else if(!sessOk)            status = sessBlock;
   else if(!g_spread.spreadOk) status = g_spread.spikeBlocked ? "SPREAD_SPIKE" : "HIGH_SPREAD";
   else if(g_volStatus != "")  status = g_volStatus;
   string timedSt = BuildTimedStatus(status, openPos);
   RenderHud(false, timedSt, openPos);
   EP_EmitGoldTelemetry(timedSt, openPos);
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(!InpShowHud || !g_isVisual) return;
   if(id == CHARTEVENT_CHART_CHANGE)
     {
      g_hud.Reposition();
      ulong nowMs = GetTickCount64();
      if((nowMs - g_lastChartChgMs) >= 400)
        {
         g_lastChartChgMs = nowMs;
         UpdateChartOverlay(true);
        }
      return;
     }
   if(id == CHARTEVENT_CLICK)
     {
      int act = g_hud.HandleClick((int)lparam, (int)dparam);
      if(act == 2)      { g_paused = !g_paused; SaveLiveState(true); }
      else if(act == 3) { CloseAllOurPositions(); SaveLiveState(true); }
      if(act != 0)
        {
         double flt = 0.0;
         int pos = CountOurPositions(flt);
         RenderHud(true, g_paused ? "PAUSED" : "ACTIVE", pos);
        }
     }
  }

void OnTick()
  {
   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return;

   g_spread.Update(tk, InpMaxSpreadPrice, InpSpreadSpikeMult, g_spec.point);
   SyncDailyAccounting();

   double flt = 0.0;
   int openPos = CountOurPositions(flt);

   if(g_prevOpenPos != openPos)
      UpdateChartOverlay(true);
   if(g_prevOpenPos > 0 && openPos == 0)
     {
      g_lastCloseTime = TimeCurrent();
      g_lastSigBar    = iTime(_Symbol, InpSignalTf, 0);
     }
   g_prevOpenPos = openPos;

   if(openPos > 0) ManageOpenPositions(tk);

   string sessBlock = "";
   bool sessOk = IsInTradingWindow(sessBlock);

   if(sessBlock == "FRI_FLAT" && openPos > 0)
     {
      CloseAllOurPositions();
      openPos = 0; g_prevOpenPos = 0;
     }

   int activeCdTick = g_lastTradeLoss ? MathMax(InpCooldownSec, InpLossCooldownSec) : InpCooldownSec;
   bool cdReady     = (g_lastCloseTime <= 0 || (TimeCurrent() - g_lastCloseTime) >= activeCdTick);

   if(g_symbolOk && g_tfOk && IsAlgoTradingOn() && !g_paused && !g_day.blocked && sessOk && g_spread.spreadOk && openPos == 0 && cdReady)
     {
      datetime curBar = iTime(_Symbol, InpSignalTf, 0);
      if(curBar != 0 && curBar != g_lastSigBar)
        {
         g_lastSigBar = curBar;
         TrySweepReversionEntry(tk);
        }
     }

   if(g_volStatus == "NEWS_SHOCK" && g_shockPauseUntil > 0 && TimeCurrent() >= g_shockPauseUntil)
      g_volStatus = "";
   if(InpShowHud && g_isVisual && g_isTester)
     {
      string status = "ACTIVE";
      if(!g_symbolOk)             status = "WRONG_SYMBOL (NEED XAUUSD)";
      else if(!g_tfOk)            status = "WRONG_TF (NEED M5)";
      else if(g_paused)           status = "PAUSED";
      else if(g_day.blocked)      status = (openPos > 0) ? "IN TRADE (DAY LOCK)" : g_day.reason;
      else if(!sessOk)            status = sessBlock;
      else if(!g_spread.spreadOk) status = g_spread.spikeBlocked ? "SPREAD_SPIKE" : "HIGH_SPREAD";
      else if(g_volStatus != "")  status = g_volStatus;
      RenderHud(false, BuildTimedStatus(status, openPos), openPos);
     }
  }
//+------------------------------------------------------------------+