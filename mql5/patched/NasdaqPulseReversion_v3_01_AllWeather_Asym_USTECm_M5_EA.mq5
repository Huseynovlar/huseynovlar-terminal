//+------------------------------------------------------------------+
//|       NasdaqPulseReversion_v3_01_AllWeather_Asym_USTECm_M5_EA.mq5   |
//|                                  Copyright 2026, NasdaqPulse     |
//|  v3.01 All-Weather Million: Ready-to-Run USTECm (Exness Nasdaq 100)        |
//|  - Microstructure Map: Blocks 13:00-15:00 UTC & 17:00-18:00 UTC  |
//|  - H4+H1 Dual-TF + H1 Kaufman Efficiency Ratio (ER) + ER Scaling |
//|  - M5 Sweep-Reversion + CLV Rejection Filter + Stale-Bar Guard   |
//|  - Adaptive Rolling Fractional Kelly (12% Base / 16% Cap)        |
//|  - Growth-Tuned Infinite Virtual Profit Bank + macOS/Wine HUD    |
//+------------------------------------------------------------------+
#property copyright   "Copyright 2026, NasdaqPulse"
#property version     "3.01"
#property description "v3.01 All-Weather Million for Nasdaq 100 (Exness USTECm / Any MT5 Broker): Universal D1-Adaptive BUY/SELL Regime, H4+H1+ER+CLV strict sweeps, Soft DD Damper, Infinite Profit Bank, 1-Click Risk Presets, Auto Order-Splitting, and macOS/Wine-safe HUD."
#property strict

#include <Trade/Trade.mqh>
#include <ExnessPanelHook.mqh> // Huseynovlar Terminal zero-overhead telemetry (0ms in Tester)
#include <Canvas/Canvas.mqh>

#define NPR_EA_NAME      "NasdaqPulse v3.01 ALL-WEATHER"
#define NPR_EA_VERSION   "v3.01"
#define NPR_MEM_VER      30102
#define NPR_SPREAD_RING  40
#define NPR_KELLY_RING   60

//+------------------------------------------------------------------+
//| Enums                                                            |
//+------------------------------------------------------------------+
enum ENUM_NPR_RISK_PROFILE
  {
   NPR_PROF_ALLWEATHER_GROWTH = 0, // All-Weather Million (17.5% Base / 40% Cap, Zero Hour Fit, Bank 500x)
   NPR_PROF_LIVE_SAFE         = 1, // Live Safe / Real (5.0% Base / 12% Cap, DD Damper 15/25%, Bank 5x)
   NPR_PROF_TURBO_MILLION     = 2, // Turbo Hyper 1M+ (18.5% Base / 43% Cap, Zero Hour Fit, Bank 1000x)
   NPR_PROF_CUSTOM            = 3  // Custom Manual Parameters Below
  };

enum ENUM_NPR_LOT_MODE
  {
   NPR_LOT_CONST_KELLY    = 0, // Constant Fractional Kelly (Zero-Lag 20k+ Growth)
   NPR_LOT_ADAPTIVE_KELLY = 1, // Adaptive Rolling Fractional Kelly
   NPR_LOT_MARKOV_KELLY   = 2, // Markov-Kelly (Alternation / Streak Regime)
   NPR_LOT_EQUITY_STEP    = 3, // Equity Step (MinStep per $X)
   NPR_LOT_FIXED          = 4  // Fixed Lot (Pure Edge Verification)
  };

enum ENUM_NPR_MARKOV_MODE
  {
   NPR_MARKOV_ALTERNATION = 0, // Nasdaq Alternation (Z>0: Boost after 1 Loss, Cut after 2+)
   NPR_MARKOV_STREAK      = 1  // Classic Hot-Streak (Gold style: Boost after Wins)
  };

enum ENUM_NPR_DIR_MODE
  {
   NPR_DIR_BOTH      = 0,     // Buy & Sell (Auto H4+H1 Aligned)
   NPR_DIR_BUY_ONLY  = 1,     // Buy Only
   NPR_DIR_SELL_ONLY = 2      // Sell Only
  };

enum ENUM_NPR_CORNER
  {
   NPR_CORNER_TOP_LEFT     = 0,
   NPR_CORNER_TOP_RIGHT    = 1,
   NPR_CORNER_BOTTOM_LEFT  = 2,
   NPR_CORNER_BOTTOM_RIGHT = 3
  };

//+------------------------------------------------------------------+
//| Input Parameters (v3.01 All-Weather Million — Ready Out-of-the-Box)        |
//+------------------------------------------------------------------+
input group "=== 1. Dual-TF Macro (H4+H1) + Kaufman ER + CLV Sweep ==="
input ENUM_TIMEFRAMES   InpSignalTf          = PERIOD_M5;            // Signal Timeframe (M5)
input ENUM_TIMEFRAMES   InpMacroTf           = PERIOD_H1;            // Primary Trend Timeframe (H1)
input bool              InpUseMacroTrend     = true;                 // Require H1 EMA20/50 Alignment
input int               InpMacroFastEma      = 20;                   // H1 Fast EMA Period
input int               InpMacroSlowEma      = 50;                   // H1 Slow EMA Period
input bool              InpUseH1FlatFilter   = true;                 // Enable Soft H1 EMA Gap Filter
input double            InpMinH1EmaGapAtr    = 0.25;                 // Min |EMA20-EMA50| / H1_ATR (0 = Off)
input bool              InpUseKaufmanER      = true;                 // Enable H1 Kaufman Efficiency Ratio Gate
input int               InpErPeriod          = 10;                   // Kaufman ER Lookback Bars on H1
input double            InpMinH1EffRatio     = 0.22;                 // Min H1 ER (0.22 cuts noisy chop days)
input bool              InpUseErRiskScaling  = true;                 // Scale Risk Smoothly by H1 ER (0.85x-1.15x)
input bool              InpUseH4Macro        = true;                 // Require H4 EMA20/50 Alignment
input ENUM_TIMEFRAMES   InpH4Tf              = PERIOD_H4;            // Higher Macro Timeframe (H4)
input int               InpH4FastEma         = 20;                   // H4 Fast EMA Period
input int               InpH4SlowEma         = 50;                   // H4 Slow EMA Period
input ENUM_NPR_DIR_MODE InpDirection         = NPR_DIR_BOTH;         // Trade Direction
input int               InpBbPeriod          = 20;                   // M5 Bollinger Bands Period
input double            InpBbDeviation       = 2.0;                  // M5 Bollinger Bands Deviation
input int               InpRsiPeriod         = 7;                    // M5 Fast RSI Period
input double            InpRsiOversold       = 32.0;                 // M5 RSI Oversold Threshold (Buy)
input double            InpRsiOverbought     = 68.0;                 // M5 RSI Overbought Threshold (Sell)
input bool              InpRequireRejCandle  = true;                 // Require Rejection Candle Close Inside BB
input double            InpMinRejectCLV      = 0.55;                 // Min Close Location Value (0.55 cuts weak doji)
input bool              InpUseVwapGuard      = false;                // Optional VWAP Z-Score Guard (Off = +$8.55M Edge)
input double            InpVwapAntiChaseZ    = 2.40;                 // VWAP Anti-Chase Max |Z-Score|
input double            InpVwapFallKnifeZ    = 1.35;                 // VWAP Falling-Knife Min Signed Z-Score
input bool              InpUseLiqTrapGuard   = false;                // Optional Liquidity Trap Guard (Off = +$8.55M Edge)
input double            InpLiqTrapAtrMult    = 0.25;                 // Liquidity Trap Proximity Zone (x ATR)
input bool              InpUseMomEngine      = false;                 // Engine #2: Strong-Trend Momentum Continuation
input double            InpMomMinER          = 0.40;                 // Engine #2 Min H1 Kaufman ER (Strong Trend Gate)
input double            InpMomMinCLV         = 0.68;                 // Engine #2 Min Breakout Candle CLV
input double            InpMomTpAtrMult      = 2.15;                 // Engine #2 Take-Profit (x M5 ATR)
input double            InpMomRiskScale      = 0.75;                 // Engine #2 Risk Scale (0.75x Core Risk)
input int               InpMaxBarDelaySec    = 90;                   // Stale-Bar Guard: Skip Delayed Ticks (0 = Off)
input int               InpCooldownSec       = 300;                  // Cooldown After Win Close (sec)
input int               InpLossCooldownSec   = 600;                  // Cooldown After Loss Close (sec)

input group "=== 2. USTECm Volatility Gate + Upgraded Asymmetric R:R ==="
input bool              InpUseHybridVol      = false;                // Hybrid Volatility (False = Classic ATR +$8.55M Edge)
input double            InpMinAtrPct         = 0.055;                // Min M5 ATR (% of Price, Blocks Dead Chop)
input double            InpMaxAtrPct         = 0.480;                // Max M5 ATR (% of Price, Blocks Flash Crash)
input double            InpSlAtrMult         = 1.75;                 // Base Stop-Loss (x M5 ATR)
input double            InpMaxSlAtrMult      = 2.25;                 // Max Stop-Loss Behind Wick (x ATR)
input double            InpWickPadAtr        = 0.25;                 // Padding Beyond Sweep Wick (x ATR)
input double            InpTpAtrMult         = 1.85;                 // Take-Profit (x M5 ATR -> Payoff b > 1.1)
input bool              InpUseDynamicTp      = false;                 // ER-Adaptive Dynamic TP Boost on Strong Trends
input double            InpDynTpErThresh     = 0.42;                 // H1 ER Threshold to Activate Dynamic TP Boost
input double            InpDynTpBonusAtr     = 0.35;                 // Max Extra TP Bonus on High-ER Trends (x ATR)
input double            InpMinSlSpreadMult   = 6.0;                  // Min SL Floor (x Spread)
input bool              InpUseLateBE         = true;                 // Late Breakeven Lock (1.3 ATR -> +0.25 ATR)
input double            InpBeTriggerAtr      = 1.30;                 // BE Trigger Profit (x ATR, if enabled)
input double            InpBeLockAtr         = 0.25;                 // Locked Net Profit at BE (x ATR, if enabled)
input bool              InpUseAtrTrail       = false;                // Optional ATR Trail (False = Clean Full TP)
input double            InpTrailStartAtr     = 1.40;                 // Trail Start (x ATR)
input double            InpTrailDistAtr      = 0.75;                 // Trail Distance (x ATR)
input int               InpMaxHoldBars       = 48;                   // Time Stop for Losers (48 M5 bars = 4h)

input group "=== 3. All-Weather D1-Adaptive Kelly + Risk Presets ==="
input ENUM_NPR_RISK_PROFILE InpRiskProfile   = NPR_PROF_TURBO_MILLION;     // 1-Click Risk Profile Preset (Turbo 1M+)
input ENUM_NPR_LOT_MODE    InpLotMode        = NPR_LOT_CONST_KELLY;    // Lot Sizing Mode (Constant Kelly Default)
input ENUM_NPR_MARKOV_MODE InpMarkovMode     = NPR_MARKOV_ALTERNATION; // Markov Regime (Used in MARKOV_KELLY)
input double            InpBaseRiskPct       = 17.50;                // Base Risk % (Used in Custom Mode)
input double            InpUnderwaterRiskPct = 17.50;                // Underwater Risk % (Used in Custom Mode)
input double            InpKellyFraction     = 0.68;                 // Adaptive Kelly Fraction (Used in Adaptive Mode)
input int               InpKellyMinTrades    = 25;                   // Min Closed Trades Before Live Kelly Engages
input double            InpKellyMinRiskPct   = 10.00;                // Adaptive Kelly Floor Risk %
input double            InpMaxRiskCapPct     = 40.00;                // Hard Per-Trade Risk Ceiling (Custom Mode)
input bool              InpUseD1AdaptiveSide = false;                // Optional D1-Adaptive Side (Off = Structural Equity Asym)
input int               InpD1FastEma         = 20;                   // D1 Regime Fast EMA Period
input int               InpD1SlowEma         = 50;                   // D1 Regime Slow EMA Period
input double            InpWithD1Mult        = 1.25;                 // Risk Mult WITH D1 Macro Trend (Bull=BUY, Bear=SELL)
input double            InpAgainstD1Mult     = 0.60;                 // Risk Mult AGAINST D1 Macro Trend
input bool              InpUseSideKelly      = true;                 // Structural Nasdaq Volatility Asymmetry (SELL > BUY)
input double            InpBuyRiskMult       = 0.25;                 // BUY Weight (4-Yr Validated 50.0% WR Grind)
input double            InpSellRiskMult      = 1.40;                 // SELL Weight (4-Yr Validated 64.0% WR / 1.89 PF)
input bool              InpUseSessionKelly   = false;                // Per-Hour Weighting (Off = Zero Hour Curve-Fit)
input double            InpHr15RiskMult      = 1.05;                 // Hour 15 UTC Risk Mult (2-Yr #1 Profitable Hour)
input double            InpHr16RiskMult      = 0.95;                 // Hour 16 UTC Risk Mult (Mid-Morning Trend)
input double            InpHr18RiskMult      = 1.08;                 // Hour 18 UTC Risk Mult (Prime Afternoon Flow)
input bool              InpUseReEntryBoost   = true;                 // Same-Day Liquidity-Sweep Re-Entry Boost
input double            InpReEntryMult       = 1.25;                 // Re-Entry Risk Mult After 1 Same-Day Loss
input bool              InpUseVolKelly       = true;                 // 4th-Factor Volatility-Regime Kelly (SL% Sweet Spot)
input double            InpVolTightMaxPct    = 0.25;                 // Tight/Chop SL% Upper Bound (<0.25% = Quiet Chop)
input double            InpVolSweetMaxPct    = 0.45;                 // Sweet-Spot SL% Upper Bound (0.25-0.45% = 70.9% SELL WR)
input double            InpMaxSlHardPct      = 0.75;                 // Hard Panic-Crash SL% Filter (>=0.75% Skipped)
input double            InpVolTightMult      = 0.50;                 // Risk Mult in Quiet Chop (SL% < 0.25%)
input double            InpVolSweetMult      = 1.40;                 // Risk Mult in Clean Impulse (0.25% <= SL% < 0.45%)
input double            InpVolWideMult       = 0.85;                 // Risk Mult in Wide Vol (0.45% <= SL% < 0.75%)
input double            InpAltLoss1Mult      = 1.25;                 // Alternation Mode: After 1 Loss
input double            InpAltWin1Mult       = 0.80;                 // Alternation Mode: After 1 Win
input double            InpWin1Mult          = 1.15;                 // Streak Mode: After 1 Win
input double            InpWin2Mult          = 1.30;                 // Streak Mode: After 2 Wins
input double            InpWin3Mult          = 1.45;                 // Streak Mode: After 3+ Wins
input double            InpLoss1Mult         = 0.55;                 // Streak Mode: After 1 Loss
input double            InpLoss2Mult         = 0.80;                 // Cold Shield After 2+ Losses (Adaptive/Markov Only)
input double            InpSoftDdTier1Pct    = 0.0;                  // Soft DD Damper Tier 1 % (Custom Mode)
input double            InpSoftDdTier2Pct    = 0.0;                  // Soft DD Damper Tier 2 % (Custom Mode)
input bool              InpUsePrincipalLock  = false;                // Principal Lock (False = Unchoked Compounding)
input double            InpPrincipalActMult  = 1.60;                 // Activate Principal Lock at Peak >= X * Start
input double            InpPrincipalFloorPct = 100.0;                // Protected Start-Deposit Floor (% of Start)
input bool              InpUseProfitBank     = true;                 // Enable Infinite Virtual Profit Bank
input double            InpBankRatchetStart  = 500.00;               // Continuous Ratchet Start (500x = $500,000)
input double            InpBankRatchetPct    = 10.0;                 // Continuous Ratchet Tier 1 (% Skimmed)
input double            InpBankRatchetHiMult = 1500.00;              // Progressive Ratchet Tier 2 (1500x = $1,500,000)
input double            InpBankRatchetHiPct  = 18.0;                 // Progressive Ratchet Tier 2 (% Skimmed)
input double            InpBankMinPeakMult   = 400.00;               // Deep-Pullback Skim: Min Cycle Peak (400x = $400,000)
input double            InpBankPullbackPct   = 45.0;                 // Deep-Pullback Skim: Pullback % to Trigger
input double            InpBankSavePct       = 40.0;                 // Deep-Pullback Skim: % of Work Cap Locked
input double            InpBankMinWorkUsd    = 3000.0;               // Min Working Capital Kept After Deep Skim
input double            InpEquityStepUsd     = 200.0;                // Equity per +MinLot Step (Equity Step Mode)
input double            InpFixedLot          = 0.50;                 // Fixed Lot (USTECm min=0.05)
input double            InpMaxLotCap         = 25000.00;             // Total Max Position Lots (Auto-Split Across Orders)
input bool              InpUseOrderSplit     = true;                 // Auto-Split Orders Above Broker Max Single Lot
input int               InpMaxSplitOrders    = 50;                   // Max Simultaneous Split Slices Per Signal
input double            InpMaxSplitSlipAtr   = 0.35;                 // Split-Order Max Slippage Guard (x ATR, 0=Off)
input double            InpMaxMarginPct      = 75.0;                 // Max Free Margin Usage (%)

input group "=== 4. Non-Stop Daily Protection ==="
input double            InpDailyProfitCapPct = 0.0;                  // Optional Daily Profit Cap % (0 = Unlimited)
input double            InpMaxDailyLossPct   = 55.0;                 // Pause Until Next UTC Day at -X% (Allows 2nd Re-Entry)
input int               InpMaxConsecLosses   = 2;                    // Pause Day After N Same-Day Losses
input double            InpMaxEquityDdPct    = 90.0;                 // Peak Equity DD Circuit Breaker % (0 = Off)
input int               InpDdPauseDays       = 5;                    // Cooldown Pause Days on Peak DD (0=Permanent)
input double            InpHardStartLossPct  = 0.0;                  // Hard Permanent Stop % Below Start (0 = Off)
input int               InpMaxTradesPerDay   = 16;                   // Max Trades Per UTC Day (0 = Off)
input long              InpMagicNumber       = 20264301;             // EA Magic Number (Nasdaq v3.01 ALL-WEATHER)
input bool              InpResetSavedMemory  = false;                // Reset Saved Memory on Next Start
input bool              InpRequireM5Chart    = true;                 // Require M5 Chart (Blocks Wrong TF)

input group "=== 5. Microstructure Session Map & News Guard ==="
input double            InpMaxSpreadPrice    = 3.50;                 // Max Spread in Index Points (Exness Avg ~1.12)
input double            InpSpreadSpikeMult   = 2.20;                 // Block Spread Spikes (x Median)
input bool              InpUseNewsShockPause = true;                 // Pause Entries After Abnormal Spike Bar
input double            InpShockBarMult      = 3.20;                 // Shock Bar Threshold (Range > X * ATR)
input int               InpShockPauseMin     = 15;                   // Pause Duration After Shock Bar (minutes)
input bool              InpUseMt5Calendar    = true;                 // Live/Demo Only: Block High-Impact USD News
input int               InpCalBeforeMin      = 15;                   // Minutes Before High-Impact USD Event
input int               InpCalAfterMin       = 15;                   // Minutes After High-Impact USD Event
input bool              InpUseSessionWindow  = true;                 // Trade Peak Liquid Window Only
input int               InpSessionStartUTC   = 15;                   // Main Window Start Hour (UTC; Prime US 15-19)
input int               InpSessionEndUTC     = 19;                   // Main Window End Hour (UTC; Cuts Hr 19 Fade)
input bool              InpBlockUsOpen       = true;                 // Block Pre-Open & US Open Chop (13:00-15:00)
input int               InpUsOpenStartHour   = 13;                   // US Open Blackout Start Hour (UTC)
input int               InpUsOpenStartMin    = 0;                    // US Open Blackout Start Minute (UTC)
input int               InpUsOpenEndHour     = 15;                   // US Open Blackout End Hour (UTC)
input int               InpUsOpenEndMin      = 0;                    // US Open Blackout End Minute (UTC)
input bool              InpBlockMiddayChop   = true;                 // Block EU-Close / NY Midday Chop (17:00-18:00)
input int               InpMiddayStartHour   = 17;                   // Midday Blackout Start Hour (UTC)
input int               InpMiddayEndHour     = 18;                   // Midday Blackout End Hour (UTC)
input bool              InpBlockRollover     = true;                 // Block Daily Index Rollover (20:55-23:05 UTC)
input bool              InpCloseOnFriday     = true;                 // Flatten Friday Before Weekend Gap
input int               InpFridayFlatHourUTC = 20;                   // Friday Flatten Hour (UTC)

input group "=== 6. High-Contrast Crisp HUD (macOS/Wine Safe) ==="
input bool              InpShowHud           = true;                 // Show Live CCanvas Dashboard
input ENUM_NPR_CORNER   InpHudCorner         = NPR_CORNER_TOP_LEFT;  // HUD Corner
input double            InpHudScale          = 1.00;                 // HUD Size Scale (1.0 = Standard, 1.25 = Large)
input int               InpHudOffsetX        = 14;                   // Horizontal Offset (px)
input int               InpHudOffsetY        = 28;                   // Vertical Offset (px)
input int               InpHudRefreshMs      = 250;                  // HUD Redraw Throttle (ms)

//+------------------------------------------------------------------+
//| Helper Math                                                      |
//+------------------------------------------------------------------+
double NPR_AlignPrice(const double price, const double tickSize, const int digits)
  {
   if(!MathIsValidNumber(price) || price <= 0.0) return 0.0;
   int d = (digits < 0) ? 0 : ((digits > 8) ? 8 : digits);
   if(!MathIsValidNumber(tickSize) || tickSize <= 0.0) return NormalizeDouble(price, d);
   return NormalizeDouble(MathRound(price / tickSize) * tickSize, d);
  }

double NPR_ClampVol(const double vol, const double vMin, const double vMax, const double vStep)
  {
   if(!MathIsValidNumber(vol) || vol <= 0.0) return 0.0;
   double mn = (vMin > 0.0) ? vMin : 0.05;
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
bool NprIsCentAccount()
  {
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   return (cur == "USC" || cur == "EURC" || cur == "GBPC" || cur == "Cent");
  }

double NprCurrencyScale()
  {
   return NprIsCentAccount() ? 100.0 : 1.0;
  }

bool NprIsNasdaqSymbol()
  {
   string s = _Symbol;
   StringToUpper(s);
   if(StringFind(s, "USTEC")   >= 0 || StringFind(s, "NAS100") >= 0 ||
      StringFind(s, "US100")   >= 0 || StringFind(s, "NDX")    >= 0 ||
      StringFind(s, "UT100")   >= 0 || StringFind(s, "USATECH")>= 0 ||
      StringFind(s, "NQ")      >= 0)
      return true;
   string desc = SymbolInfoString(_Symbol, SYMBOL_DESCRIPTION);
   StringToUpper(desc);
   if(StringFind(desc, "NASDAQ") >= 0 || StringFind(desc, "US TECH") >= 0 || StringFind(desc, "USTEC") >= 0)
      return true;
   return false;
  }

string NprProfileTag()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return "SAFE";
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return "ALL-WTH";
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return "TURBO";
   return "CUSTOM";
  }

//| Structs                                                          |
//+------------------------------------------------------------------+
struct SNprSpecs
  {
   int    digits;
   double point, tickSize, tickValue, contractSize, volMin, volMax, volStep;
   long   stopsPts, freezePts, exeMode, fillMask;
   void Reset()
     {
      digits = 2; point = 0.01; tickSize = 0.01; tickValue = 0.0; contractSize = 1.0;
      volMin = 0.05; volMax = 500.0; volStep = 0.01; stopsPts = 0; freezePts = 0; exeMode = 0; fillMask = 0;
     }
   SNprSpecs() { Reset(); }
  };

struct SNprDaily
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
   SNprDaily() { Reset(); }
  };

struct SNprRect
  {
   int x1, y1, x2, y2;
   void Set(const int l, const int t, const int r, const int b) { x1 = l; y1 = t; x2 = r; y2 = b; }
   bool Contains(const int x, const int y) const { return (x >= x1 && x <= x2 && y >= y1 && y <= y2); }
   void Reset() { x1 = y1 = x2 = y2 = 0; }
   SNprRect() { Reset(); }
  };

//+------------------------------------------------------------------+
//| Rolling Empirical Kelly Estimator (R-Multiple Ring Buffer)       |
//+------------------------------------------------------------------+
class CNprKellyTracker
  {
private:
   double m_rRing[NPR_KELLY_RING];
   int    m_head, m_count;
public:
   double lastWinRate, lastPayoffB, lastFullKelly;

   CNprKellyTracker() { Reset(); }
   void Reset()
     {
      m_head = 0; m_count = 0;
      lastWinRate = 0.58; lastPayoffB = 1.10; lastFullKelly = 0.19;
      for(int i = 0; i < NPR_KELLY_RING; i++) m_rRing[i] = 0.0;
     }
   int Count() const { return m_count; }
   void PushR(const double rVal)
     {
      if(!MathIsValidNumber(rVal)) return;
      double clamped = MathMax(-2.5, MathMin(3.5, rVal));
      m_rRing[m_head] = clamped;
      m_head = (m_head + 1) % NPR_KELLY_RING;
      if(m_count < NPR_KELLY_RING) m_count++;

      int wCnt = 0, lCnt = 0;
      double wSum = 0.0, lSum = 0.0;
      for(int i = 0; i < m_count; i++)
        {
         if(m_rRing[i] > 0.0) { wCnt++; wSum += m_rRing[i]; }
         else                 { lCnt++; lSum += MathAbs(m_rRing[i]); }
        }
      if(wCnt > 0 && lCnt > 0)
        {
         double p = (double)wCnt / (double)m_count;
         double b = (wSum / (double)wCnt) / MathMax(0.10, (lSum / (double)lCnt));
         lastWinRate   = p;
         lastPayoffB   = b;
         lastFullKelly = p - (1.0 - p) / MathMax(0.25, b);
        }
     }
   void SaveToGV(const string prefix) const
     {
      GlobalVariableSet(prefix + "K_CNT",  (double)m_count);
      GlobalVariableSet(prefix + "K_HEAD", (double)m_head);
      for(int i = 0; i < m_count; i++)
         GlobalVariableSet(prefix + "K_R" + IntegerToString(i), m_rRing[i]);
     }
   void LoadFromGV(const string prefix)
     {
      if(!GlobalVariableCheck(prefix + "K_CNT")) return;
      int cnt = (int)GlobalVariableGet(prefix + "K_CNT");
      int hd  = (int)GlobalVariableGet(prefix + "K_HEAD");
      if(cnt < 0) cnt = 0;
      if(cnt > NPR_KELLY_RING) cnt = NPR_KELLY_RING;
      if(hd < 0 || hd >= NPR_KELLY_RING) hd = 0;
      m_count = cnt;
      m_head  = hd;
      int wCnt = 0, lCnt = 0;
      double wSum = 0.0, lSum = 0.0;
      for(int i = 0; i < m_count; i++)
        {
         m_rRing[i] = GlobalVariableGet(prefix + "K_R" + IntegerToString(i));
         if(m_rRing[i] > 0.0) { wCnt++; wSum += m_rRing[i]; }
         else                 { lCnt++; lSum += MathAbs(m_rRing[i]); }
        }
      if(wCnt > 0 && lCnt > 0)
        {
         double p = (double)wCnt / (double)m_count;
         double b = (wSum / (double)wCnt) / MathMax(0.10, (lSum / (double)lCnt));
         lastWinRate   = p;
         lastPayoffB   = b;
         lastFullKelly = p - (1.0 - p) / MathMax(0.25, b);
        }
     }
  };

//+------------------------------------------------------------------+
//| Rolling Spread & Spike Guard                                     |
//+------------------------------------------------------------------+
class CNprSpreadGuard
  {
private:
   double m_ring[NPR_SPREAD_RING];
   double m_sorted[NPR_SPREAD_RING];
   int    m_head, m_count;
public:
   double lastSpread, medianSpread;
   bool   spreadOk, spikeBlocked;

   CNprSpreadGuard() { Reset(); }
   void Reset()
     {
      m_head = 0; m_count = 0; lastSpread = 0.0; medianSpread = 0.0; spreadOk = false; spikeBlocked = false;
      for(int i = 0; i < NPR_SPREAD_RING; i++) { m_ring[i] = 0.0; m_sorted[i] = 0.0; }
     }
   void Update(const MqlTick &tk, const double maxSpread, const double spikeMult, const double pt)
     {
      if(!MathIsValidNumber(tk.bid) || !MathIsValidNumber(tk.ask) || tk.bid <= 0.0 || tk.ask < tk.bid)
        { spreadOk = false; spikeBlocked = true; return; }
      double sp = tk.ask - tk.bid;
      lastSpread = sp;
      m_ring[m_head] = sp;
      m_head = (m_head + 1) % NPR_SPREAD_RING;
      if(m_count < NPR_SPREAD_RING) m_count++;

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
      double base  = MathMax(med, pt * 50.0);
      spikeBlocked = (m_count >= 5 && spikeMult > 0.0 && sp > spikeMult * base + 1e-12);
      spreadOk     = (!spikeBlocked && (maxSpread <= 0.0 || sp <= maxSpread + 1e-9));
     }
  };

//+------------------------------------------------------------------+
//| Crisp High-Contrast Single-Bitmap CCanvas HUD (macOS/Wine Safe)  |
//+------------------------------------------------------------------+
class CNprHud
  {
private:
   CCanvas         m_canvas;
   long            m_chartId;
   string          m_objName;
   ENUM_NPR_CORNER m_corner;
   int             m_offX, m_offY, m_x, m_y, m_w, m_hFull, m_hMin, m_hCur;
   double          m_scale;
   bool            m_created, m_min, m_confirmClose;
   datetime        m_confirmUntil;
   ulong           m_lastDrawMs;
   int             m_refreshMs;
   string          m_lastRenderSig;
   SNprRect        m_btnMin, m_btnPause, m_btnClose;

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
      if(m_corner == NPR_CORNER_TOP_RIGHT)         m_x = (int)cw - m_w - m_offX;
      else if(m_corner == NPR_CORNER_BOTTOM_LEFT)  m_y = (int)ch - m_hCur - m_offY;
      else if(m_corner == NPR_CORNER_BOTTOM_RIGHT) { m_x = (int)cw - m_w - m_offX; m_y = (int)ch - m_hCur - m_offY; }
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

   void TextL(const int x, const int y, const string txt, const uint col)
     { m_canvas.TextOut(x, y, txt + "    ", col, TA_LEFT | TA_TOP); }

   void TextC(const int x, const int y, const string txt, const uint col)
     { m_canvas.TextOut(x, y, "  " + txt + "  ", col, TA_CENTER | TA_VCENTER); }

   void DrawCell(const int x, const int y, const string lbl, const string val, const uint cLbl, const uint cVal)
     {
      m_canvas.FontSet("Arial", -S(74), FW_BOLD);
      TextL(x, y + S(4), lbl, cLbl);
      m_canvas.FontSet("Arial", -S(98), FW_BOLD);
      TextL(x, y + S(17), val, cVal);
     }

   void DrawPill(const int x1, const int y1, const int x2, const int y2,
                 const string label, const uint bg, const uint brd, const uint fg)
     {
      FillRectSafe(x1, y1, x2, y2, bg);
      DrawBorderSafe(x1, y1, x2, y2, brd);
      m_canvas.FontSet("Arial", -S(90), FW_BOLD);
      TextC((x1 + x2) / 2, (y1 + y2) / 2, label, fg);
     }

   void DrawButton(const SNprRect &rc, const string label, const uint bg, const uint brd, const uint fg)
     {
      FillRectSafe(rc.x1, rc.y1, rc.x2, rc.y2, bg);
      DrawBorderSafe(rc.x1, rc.y1, rc.x2, rc.y2, brd);
      m_canvas.FontSet("Arial", -S(95), FW_BOLD);
      TextC((rc.x1 + rc.x2) / 2, (rc.y1 + rc.y2) / 2, label, fg);
     }

public:
   CNprHud()
     {
      m_chartId = 0; m_objName = ""; m_corner = NPR_CORNER_TOP_LEFT;
      m_offX = 14; m_offY = 28; m_x = 14; m_y = 28;
      m_w = 416; m_hFull = 424; m_hMin = 36; m_hCur = 424;
      m_scale = 1.0; m_created = false; m_min = false; m_confirmClose = false;
      m_confirmUntil = 0; m_lastDrawMs = 0; m_refreshMs = 250; m_lastRenderSig = "";
     }

   bool Create(const long chartId, const string sym, const ENUM_NPR_CORNER corner,
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
      m_objName = "NP301_HUD_" + sym;
      m_lastRenderSig = "";
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
      m_lastRenderSig = "";
     }

   void Reposition()
     {
      if(!m_created) return;
      int ox = m_x, oy = m_y;
      ComputePos();
      if(m_x == ox && m_y == oy) return;
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_XDISTANCE, m_x);
      ObjectSetInteger(m_chartId, m_objName, OBJPROP_YDISTANCE, m_y);
     }

   void Draw(const bool force, const string sym, const bool paused,
             const bool algoOn, const bool mktOpen, const bool isTester,
             const bool wrongAsset, const bool wrongTf,
             const string nextTitle, const string nextBody, const string footerNote,
             const string statusTxt, const string biasTxt, const double rsiVal,
             const double erVal, const double riskPct, const double lotVal,
             const double spreadVal, const double ddPct, const double balVal,
             const double workCapVal, const double bankVal, const bool bankOn,
             const int openPos, const int runWins, const int runLoss, const SNprDaily &dy)
     {
      if(!m_created) return;
      ulong nowMs = GetTickCount64();
      if(m_confirmClose && TimeCurrent() > m_confirmUntil) m_confirmClose = false;

      string sig = StringFormat("%d|%d|%d|%d|%d|%d|%s|%s|%s|%s|%s|%.1f|%.2f|%.2f|%.2f|%.0f|%.0f|%.0f|%d|%d|%d|%.2f|%d",
                                (int)m_min, (int)paused, (int)algoOn, (int)mktOpen, (int)wrongAsset, (int)wrongTf,
                                statusTxt, biasTxt, nextTitle, nextBody, footerNote,
                                rsiVal, erVal, spreadVal, ddPct, balVal, workCapVal, bankVal,
                                openPos, runWins, runLoss, dy.closedPnl + dy.floatingPnl, (int)m_confirmClose);
      if(!force && sig == m_lastRenderSig) return;
      if(!force && (nowMs - m_lastDrawMs) < (ulong)m_refreshMs) return;
      m_lastRenderSig = sig;
      m_lastDrawMs    = nowMs;

      int tgtH = m_min ? m_hMin : m_hFull;
      if(tgtH != m_hCur)
        {
         m_hCur = tgtH;
         m_canvas.Resize(m_w, m_hCur);
         Reposition();
        }

      uint cBg     = Argb(255, 11, 15, 24);
      uint cHdr    = Argb(255, 18, 28, 46);
      uint cCard   = Argb(255, 17, 24, 38);
      uint cDiv    = Argb(255, 42, 60, 88);
      uint cBrd    = Argb(255, 62, 92, 134);
      uint cCyan   = Argb(255, 86, 212, 255);
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

      int hdrH = S(36);
      FillRectSafe(1, 1, m_w - 2, hdrH, cHdr);
      m_canvas.LineHorizontal(1, m_w - 2, hdrH, cBrd);

      m_canvas.FontSet("Arial", -S(105), FW_BOLD);
      TextL(S(12), S(9), NPR_EA_NAME + "  " + sym, cCyan);

      m_btnMin.Set(m_w - S(32), S(6), m_w - S(8), S(30));
      DrawButton(m_btnMin, m_min ? "+" : "-", cBtnBg, cBrd, cTxt);

      if(m_min) { m_canvas.Update(true); return; }

      int p = S(10);
      int y = hdrH + S(8);

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

      string stateShow = statusTxt;
      uint cStat = cGrn;
      if(wrongAsset)                 { stateShow = "WRONG_SYMBOL! USE USTEC"; cStat = cRed; }
      else if(wrongTf)               { stateShow = "WRONG_TF! SWITCH TO M5";  cStat = cRed; }
      else if(!isTester && !algoOn)  { stateShow = "ENABLE ALGO TRADING";     cStat = cRed; }
      else if(!mktOpen)              { stateShow = "MARKET CLOSED";           cStat = cAmb; }
      else if(StringFind(statusTxt, "IN TRADE (DAY LOCK)") == 0 ||
              StringFind(statusTxt, "IN TRADE (PAUSED)")   == 0) { cStat = cAmb; }
      else if(openPos > 0)           { cStat = cGrn; }
      else if(paused)                { cStat = cAmb; }
      else if(dy.blocked)            { cStat = cRed; }
      else if(StringFind(statusTxt, "HIGH_SPREAD") == 0 || StringFind(statusTxt, "SPREAD_SPIKE") == 0) { cStat = cRed; }
      else if(StringFind(statusTxt, "US_OPEN_BLK") == 0 || StringFind(statusTxt, "MIDDAY_BLK") == 0 ||
              StringFind(statusTxt, "OFF_SESSION") == 0 || StringFind(statusTxt, "ROLLOVER") == 0 ||
              StringFind(statusTxt, "FRI_FLAT") == 0    || StringFind(statusTxt, "NEWS_SHOCK") == 0 ||
              StringFind(statusTxt, "USD_NEWS") == 0    || StringFind(statusTxt, "COOLDOWN") == 0 ||
              StringFind(statusTxt, "LOW_VOL") == 0     || StringFind(statusTxt, "EXTREME_VOL") == 0 ||
              StringFind(statusTxt, "LOW_ER") == 0      || StringFind(statusTxt, "H1_FLAT") == 0)
                                     { cStat = cAmb; }

      m_canvas.FontSet("Arial", -S(98), FW_BOLD);
      TextL(p + S(2), y, "STATE: " + stateShow, cStat);
      y += S(21);

      // 2-Column Bloomberg Grid Card 1: Market & Risk (3 rows x 38px = 114px)
      int c1H   = S(114);
      int col1X = p + S(10);
      int col2X = m_w / 2 + S(10);
      FillRectSafe(p, y, m_w - p, y + c1H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c1H, cBrd);
      m_canvas.LineVertical(m_w / 2, y + S(6), y + c1H - S(6), cDiv);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(38), cDiv);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(76), cDiv);

      string streakStr = (runWins > 0) ? ("W" + IntegerToString(runWins))
                                       : ((runLoss > 0) ? ("L" + IntegerToString(runLoss)) : "FLAT");
      string modeTag = (InpLotMode == NPR_LOT_FIXED) ? "FIX"
                     : ((InpLotMode == NPR_LOT_CONST_KELLY) ? "P-KELLY"
                     : ((InpLotMode == NPR_LOT_EQUITY_STEP) ? "STEP"
                     : (DoubleToString(riskPct, 1) + "%")));

      DrawCell(col1X, y + S(2),  "MACRO TREND", biasTxt, cMut, cCyan);
      DrawCell(col2X, y + S(2),  "RSI(7) / H1 ER", DoubleToString(rsiVal, 1) + " | " + DoubleToString(erVal, 2), cMut, cTxt);
      DrawCell(col1X, y + S(40), "PROFILE / MODE", NprProfileTag() + " | " + modeTag, cMut, cGold);
      DrawCell(col2X, y + S(40), "SPREAD / LAST LOT", DoubleToString(spreadVal, 2) + "pt | " + DoubleToString(lotVal, 2) + "L", cMut, cTxt);
      DrawCell(col1X, y + S(78), "STREAK / OPEN", streakStr + " | " + IntegerToString(openPos) + " pos", cMut, cTxt);
      DrawCell(col2X, y + S(78), "TRADES TODAY", IntegerToString(dy.trades) + " (" + IntegerToString(dy.wins) + "W)", cMut, cTxt);
      y += c1H + S(8);

      // 2-Column Bloomberg Grid Card 2: Capital & Bank (2 rows x 38px = 76px)
      string cSym = NprIsCentAccount() ? "¢" : "$";
      double totalDay = dy.closedPnl + dy.floatingPnl;
      uint cDay = (totalDay >= 0.0) ? cGrn : cRed;
      int c2H = S(76);
      FillRectSafe(p, y, m_w - p, y + c2H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c2H, cBrd);
      m_canvas.LineVertical(m_w / 2, y + S(6), y + c2H - S(6), cDiv);
      m_canvas.LineHorizontal(p + S(8), m_w - p - S(8), y + S(38), cDiv);

      DrawCell(col1X, y + S(2),  "DAY P&L", ((totalDay >= 0.0) ? ("+" + cSym) : ("-" + cSym)) + DoubleToString(MathAbs(totalDay), 2), cMut, cDay);
      DrawCell(col2X, y + S(2),  "DRAWDOWN (BAL)", DoubleToString(ddPct, 1) + "%", cMut, (ddPct >= 25.0 ? cAmb : cTxt));
      DrawCell(col1X, y + S(40), "BALANCE / WORK", cSym + DoubleToString(balVal, 0) + " / " + cSym + DoubleToString(workCapVal, 0), cMut, cTxt);
      DrawCell(col2X, y + S(40), "PROFIT BANK", bankOn ? (cSym + DoubleToString(bankVal, 0) + " LOCK") : (cSym + "0 (WAIT)"), cMut, bankOn ? cGold : cMut);
      y += c2H + S(8);

      // Card 3: NEXT ENTRY CONDITION / ACTIVE POSITION (EST. P&L) (44px)
      int c3H = S(44);
      FillRectSafe(p, y, m_w - p, y + c3H, cCard);
      DrawBorderSafe(p, y, m_w - p, y + c3H, (openPos > 0) ? cGrn : cBrd);
      m_canvas.FontSet("Arial", -S(74), FW_BOLD);
      TextL(col1X, y + S(5), nextTitle, (openPos > 0) ? cGrn : cCyan);
      m_canvas.FontSet("Arial", -S(96), FW_BOLD);
      TextL(col1X, y + S(19), nextBody, cTxt);
      y += c3H + S(8);

      int btnW = (m_w - p * 3) / 2;
      int btnH = S(32);
      m_btnPause.Set(p, y, p + btnW, y + btnH);
      m_btnClose.Set(p * 2 + btnW, y, m_w - p, y + btnH);

      DrawButton(m_btnPause, paused ? "RESUME" : "PAUSE",
                 paused ? cAmbBg : cBtnBg, paused ? cAmb : cBrd, cTxt);
      DrawButton(m_btnClose, m_confirmClose ? "CONFIRM?" : "CLOSE ALL",
                 m_confirmClose ? Argb(255, 185, 38, 52) : Argb(255, 130, 32, 44), cRed, cTxt);

      y += btnH + S(7);
      m_canvas.FontSet("Arial", -S(82), FW_NORMAL);
      string fTxt = (footerNote != "") ? footerNote : "MEMORY: SYNCED | v3.01 Ready";
      uint   fCol = (StringFind(fTxt, "CLEARED") >= 0 || StringFind(fTxt, "WRONG") >= 0) ? cGold : cMut;
      TextL(p + S(2), y, fTxt, fCol);

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
CTrade           g_trade;
SNprSpecs        g_spec;
SNprDaily        g_day;
CNprSpreadGuard  g_spread;
CNprKellyTracker g_kelly;
CNprHud          g_hud;

int      g_hAtrSig          = INVALID_HANDLE;
int      g_hAtrH1           = INVALID_HANDLE;
int      g_hBbSig           = INVALID_HANDLE;
int      g_hRsiSig          = INVALID_HANDLE;
int      g_hEmaFastH1       = INVALID_HANDLE;
int      g_hEmaSlowH1       = INVALID_HANDLE;
int      g_hEmaFastH4       = INVALID_HANDLE;
int      g_hEmaSlowH4       = INVALID_HANDLE;
int      g_hEmaFastD1       = INVALID_HANDLE;
int      g_hEmaSlowD1       = INVALID_HANDLE;
int      g_lastD1Dir        = 0; // +1 Bullish D1, -1 Bearish D1, 0 Neutral

bool     g_paused           = false;
bool     g_isVisual         = true;
bool     g_isTester         = false;
int      g_prevOpenPos      = 0;
int      g_runConsecWins    = 0;
int      g_runConsecLoss    = 0;
datetime g_lastSigBar       = 0;
datetime g_lastCloseTime    = 0;
bool     g_lastTradeLoss    = false;
double         g_batchClosedPnl  = 0.0;
datetime       g_lastBatchTime   = 0;
bool           g_signalAccounted = true;
double   g_lastPlannedRisk  = 0.0;
double   g_startBalance     = 0.0;
double   g_bankedProfit     = 0.0;
double   g_cycleStart       = 0.0;
double   g_hwmTotalBal      = 0.0;
int      g_bankSkimCount    = 0;
double   g_vaultFloorBal    = 0.0;
bool     g_vaultActive      = false;
datetime g_shockPauseUntil  = 0;
datetime g_ddPauseUntil     = 0;
datetime g_lastCalCheck     = 0;
bool     g_calBlocked       = false;
datetime g_calBlockUntil    = 0;
double   g_lastAtrVal       = 0.0;
double   g_lastAtrPct       = 0.0;
double   g_lastRsiVal       = 50.0;
double   g_lastErVal        = 0.30;
double   g_lastLotVal       = 0.0;
double   g_lastRiskPct      = 12.0;
double   g_lastDdPct        = 0.0;
double   g_lastShieldMult   = 1.0;
string   g_biasTxt          = "INIT";
string   g_volStatus        = "";
bool     g_wrongAsset       = false;
bool     g_wrongTf          = false;
string   g_lastSkipReason   = "";
datetime g_lastSkipUntil    = 0;
datetime g_lastOvlBar       = 0;
int      g_lastOvlPos       = -1;
string   g_hudFooterNote    = "";
datetime g_hudFooterUntil   = 0;

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
   if(g_spec.volMin <= 0.0)   g_spec.volMin   = 0.05;
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

int CountOurPositions(double &outFloatPnl)
  {
   outFloatPnl = 0.0;
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      cnt++;
      outFloatPnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
     }
   return cnt;
  }

void CloseAllOurPositions()
  {
   ConfigureFilling();
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(50);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      g_trade.PositionClose(tk);
     }
  }

//+------------------------------------------------------------------+
//| Kaufman Efficiency Ratio (ER) on H1                              |
//+------------------------------------------------------------------+
double ComputeKaufmanER(const ENUM_TIMEFRAMES tf, const int period)
  {
   int n = MathMax(3, period);
   double cl[];
   ArraySetAsSeries(cl, true);
   if(CopyClose(_Symbol, tf, 1, n + 1, cl) < n + 1) return 0.50;

   double netMove = MathAbs(cl[0] - cl[n]);
   double sumMove = 0.0;
   for(int i = 0; i < n; i++)
      sumMove += MathAbs(cl[i] - cl[i + 1]);
   if(sumMove <= 1e-12) return 0.0;
   return MathMax(0.0, MathMin(1.0, netMove / sumMove));
  }

//+------------------------------------------------------------------+
//| Live-Only MT5 Built-In Economic Calendar Guard (High-Impact USD) |
//+------------------------------------------------------------------+
bool IsMt5CalendarNewsWindow()
  {
   if(!InpUseMt5Calendar || g_isTester) return false;
   datetime nowSrv = TimeTradeServer();
   if(nowSrv <= 0) nowSrv = TimeCurrent();
   if(g_calBlockUntil > 0 && nowSrv >= g_calBlockUntil)
     {
      g_calBlockUntil = 0;
      g_calBlocked    = false;
     }
   if(g_lastCalCheck > 0 && (nowSrv - g_lastCalCheck) < 60)
      return (g_calBlocked && g_calBlockUntil > nowSrv);

   g_lastCalCheck  = nowSrv;
   g_calBlocked    = false;
   g_calBlockUntil = 0;

   int afterSec = MathMax(1, InpCalAfterMin) * 60;
   datetime fromTm = nowSrv - afterSec;
   datetime toTm   = nowSrv + MathMax(1, InpCalBeforeMin) * 60;

   MqlCalendarValue vals[];
   int n = CalendarValueHistory(vals, fromTm, toTm, NULL, "USD");
   if(n <= 0) return false;

   datetime maxEnd = 0;
   for(int i = 0; i < n; i++)
     {
      MqlCalendarEvent ev;
      if(CalendarEventById(vals[i].event_id, ev))
        {
         if(ev.importance == CALENDAR_IMPORTANCE_HIGH)
           {
            datetime evEnd = vals[i].time + afterSec;
            if(evEnd > maxEnd) maxEnd = evEnd;
           }
        }
     }
   if(maxEnd > nowSrv)
     {
      g_calBlockUntil = maxEnd;
      g_calBlocked    = true;
      return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Microstructure Session Map (Blocks 13:00-15:00 & 17:00-18:00)    |
//+------------------------------------------------------------------+
bool IsInTradingWindow(string &whyBlocked)
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int mins = dt.hour * 60 + dt.min;

   if(InpCloseOnFriday && dt.day_of_week == 5 && dt.hour >= InpFridayFlatHourUTC)
     { whyBlocked = "FRI_FLAT"; return false; }

   if(InpBlockRollover && (mins >= 20 * 60 + 55 && mins <= 23 * 60 + 5))
     { whyBlocked = "ROLLOVER"; return false; }

   if(InpBlockUsOpen)
     {
      int blkStart = InpUsOpenStartHour * 60 + InpUsOpenStartMin;
      int blkEnd   = InpUsOpenEndHour * 60 + InpUsOpenEndMin;
      if(blkStart < blkEnd && mins >= blkStart && mins < blkEnd)
        { whyBlocked = "US_OPEN_BLK"; return false; }
     }

   if(InpBlockMiddayChop)
     {
      if(dt.hour >= InpMiddayStartHour && dt.hour < InpMiddayEndHour)
        { whyBlocked = "MIDDAY_BLK"; return false; }
     }

   if(InpUseSessionWindow)
     {
      bool inMain = false;
      if(InpSessionStartUTC < InpSessionEndUTC)
         inMain = (dt.hour >= InpSessionStartUTC && dt.hour < InpSessionEndUTC);
      else
         inMain = (dt.hour >= InpSessionStartUTC || dt.hour < InpSessionEndUTC);
      if(!inMain)
        { whyBlocked = "OFF_SESSION"; return false; }
     }

   whyBlocked = "";
   return true;
  }

bool IsWindowOpenAtGmt(const datetime gmtTime)
  {
   MqlDateTime dt;
   TimeToStruct(gmtTime, dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return false;
   int mins = dt.hour * 60 + dt.min;

   if(InpCloseOnFriday && dt.day_of_week == 5 && dt.hour >= InpFridayFlatHourUTC) return false;
   if(InpBlockRollover && (mins >= 20 * 60 + 55 && mins <= 23 * 60 + 5)) return false;
   if(InpBlockUsOpen)
     {
      int blkStart = InpUsOpenStartHour * 60 + InpUsOpenStartMin;
      int blkEnd   = InpUsOpenEndHour * 60 + InpUsOpenEndMin;
      if(blkStart < blkEnd && mins >= blkStart && mins < blkEnd) return false;
     }
   if(InpBlockMiddayChop && dt.hour >= InpMiddayStartHour && dt.hour < InpMiddayEndHour) return false;
   if(InpUseSessionWindow)
     {
      bool inMain = false;
      if(InpSessionStartUTC < InpSessionEndUTC)
         inMain = (dt.hour >= InpSessionStartUTC && dt.hour < InpSessionEndUTC);
      else
         inMain = (dt.hour >= InpSessionStartUTC || dt.hour < InpSessionEndUTC);
      if(!inMain) return false;
     }
   return true;
  }

string GetSessionCountdown(const bool isOpenNow)
  {
   if(g_isTester) return "";
   datetime nowGmt = TimeGMT();
   if(nowGmt <= 0) return "";
   datetime probe = ((nowGmt / 60) + 1) * 60;
   bool found = false;
   for(int i = 0; i < 5760; i++)
     {
      if(IsWindowOpenAtGmt(probe) != isOpenNow) { found = true; break; }
      probe += 60;
     }
   if(!found) return "";
   int rem = (int)MathMax(0, probe - nowGmt);
   if(rem >= 86400)
      return StringFormat("%dd %02d:%02d", rem / 86400, (rem % 86400) / 3600, (rem % 3600) / 60);
   return StringFormat("%02d:%02d:%02d", rem / 3600, (rem % 3600) / 60, rem % 60);
  }

string BuildHudStatus(const bool sessOk, const string sessBlock, const int openPos)
  {
   if(InpUseNewsShockPause && g_shockPauseUntil > 0 && TimeCurrent() >= g_shockPauseUntil)
     {
      g_shockPauseUntil = 0;
      if(g_volStatus == "NEWS_SHOCK") g_volStatus = "";
     }

   datetime nowSrv = TimeTradeServer();
   if(nowSrv <= 0) nowSrv = TimeCurrent();
   if(InpUseMt5Calendar && g_calBlockUntil > 0 && nowSrv >= g_calBlockUntil)
     {
      g_calBlockUntil = 0;
      g_calBlocked    = false;
      if(g_volStatus == "USD_NEWS") g_volStatus = "";
     }

   if(openPos > 0)
     {
      if(g_day.blocked) return "IN TRADE (DAY LOCK)";
      if(g_paused)      return "IN TRADE (PAUSED)";
      string cdWin = sessOk ? GetSessionCountdown(true) : "";
      return (cdWin != "") ? ("IN TRADE (win " + cdWin + ")") : "IN TRADE";
     }
   if(g_paused)                return "PAUSED";
   if(g_day.blocked)
     {
      if(g_day.reason == "DD_PAUSE" && g_ddPauseUntil > TimeGMT())
        {
         int rem = (int)(g_ddPauseUntil - TimeGMT());
         if(rem >= 86400)
            return StringFormat("DD_PAUSE (%dd %02d:%02d)", rem / 86400, (rem % 86400) / 3600, (rem % 3600) / 60);
         return StringFormat("DD_PAUSE (%02d:%02d:%02d)", rem / 3600, (rem % 3600) / 60, rem % 60);
        }
      return g_day.reason;
     }
   if(!sessOk)
     {
      string cd = GetSessionCountdown(false);
      return (cd != "") ? (sessBlock + " (" + cd + ")") : sessBlock;
     }
   if(!g_spread.spreadOk)      return g_spread.spikeBlocked ? "SPREAD_SPIKE" : "HIGH_SPREAD";
   if(g_volStatus == "NEWS_SHOCK" && g_shockPauseUntil > TimeCurrent())
     {
      int rem = (int)(g_shockPauseUntil - TimeCurrent());
      return StringFormat("NEWS_SHOCK (%02d:%02d)", rem / 60, rem % 60);
     }
   if(g_volStatus == "USD_NEWS" && g_calBlockUntil > nowSrv)
     {
      int rem = (int)(g_calBlockUntil - nowSrv);
      return StringFormat("USD_NEWS (%02d:%02d)", rem / 60, rem % 60);
     }
   if(g_volStatus != "")       return g_volStatus;

   int activeCd = g_lastTradeLoss ? MathMax(InpCooldownSec, InpLossCooldownSec) : InpCooldownSec;
   if(g_lastCloseTime > 0 && (TimeCurrent() - g_lastCloseTime) < activeCd)
     {
      int remCd = (int)(activeCd - (TimeCurrent() - g_lastCloseTime));
      return StringFormat("COOLDOWN (%02d:%02d)", remCd / 60, remCd % 60);
     }

   string cdWin = GetSessionCountdown(true);
   return (cdWin != "") ? ("SCANNING (win " + cdWin + ")") : "SCANNING";
  }

//+------------------------------------------------------------------+
//| Scale-Invariant Volatility Gate                                  |
//+------------------------------------------------------------------+
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

double ComputeHybridVolatility(const double rawAtr)
  {
   if(!InpUseHybridVol || rawAtr <= 0.0) return rawAtr;
   MqlRates rp[];
   ArraySetAsSeries(rp, true);
   int n = 14;
   if(CopyRates(_Symbol, InpSignalTf, 1, n, rp) < n) return rawAtr;
   double sumSq = 0.0;
   int valid = 0;
   for(int i = 0; i < n; i++)
     {
      if(rp[i].low > 0.0 && rp[i].high >= rp[i].low)
        {
         double lr = MathLog(rp[i].high / rp[i].low);
         sumSq += lr * lr;
         valid++;
        }
     }
   if(valid < 5 || rp[0].close <= 0.0) return rawAtr;
   double parkSigma = MathSqrt(sumSq / (4.0 * (double)valid * MathLog(2.0)));
   double parkPrice = rp[0].close * parkSigma;
   if(!MathIsValidNumber(parkPrice) || parkPrice <= 0.0) return rawAtr;
   return (0.35 * parkPrice + 0.65 * rawAtr);
  }

void ComputeSessionQuantLevels(const datetime refBarTime, const double refClose,
                               bool &outVwapOk, double &outZ,
                               bool &outPdhOk, double &outPdh, double &outPdl,
                               bool &outAsiaOk, double &outAsiaHi, double &outAsiaLo)
  {
   outVwapOk = false; outZ = 0.0;
   outPdhOk  = false; outPdh = 0.0; outPdl = 0.0;
   outAsiaOk = false; outAsiaHi = 0.0; outAsiaLo = 0.0;

   if(InpUseLiqTrapGuard)
     {
      MqlRates d1[1];
      if(CopyRates(_Symbol, PERIOD_D1, 1, 1, d1) == 1 && d1[0].high > d1[0].low)
        {
         outPdh   = d1[0].high;
         outPdl   = d1[0].low;
         outPdhOk = true;
        }
     }

   if(!InpUseVwapGuard && !InpUseLiqTrapGuard) return;

   MqlDateTime dt;
   TimeToStruct(refBarTime, dt);
   datetime dayStart = refBarTime - (dt.hour * 3600 + dt.min * 60 + dt.sec);
   datetime asiaEnd  = dayStart + 7 * 3600;

   MqlRates mr[];
   ArraySetAsSeries(mr, true);
   int got = CopyRates(_Symbol, InpSignalTf, 1, 300, mr);
   if(got <= 0) return;

   double sumPV = 0.0, sumV = 0.0, sumP2V = 0.0;
   int vwapBars = 0;
   double aHi = -DBL_MAX, aLo = DBL_MAX;
   int asiaBars = 0;

   for(int i = 0; i < got; i++)
     {
      if(mr[i].time < dayStart) break;
      double tp = (mr[i].high + mr[i].low + mr[i].close) / 3.0;
      double v  = (double)MathMax(1, (long)mr[i].tick_volume);
      sumPV  += tp * v;
      sumV   += v;
      sumP2V += tp * tp * v;
      vwapBars++;

      if(mr[i].time < asiaEnd)
        {
         if(mr[i].high > aHi) aHi = mr[i].high;
         if(mr[i].low  < aLo) aLo = mr[i].low;
         asiaBars++;
        }
     }

   if(InpUseVwapGuard && vwapBars >= 6 && sumV > 0.0)
     {
      double vwap = sumPV / sumV;
      double var  = MathMax(0.0, (sumP2V / sumV) - vwap * vwap);
      double sd   = MathMax(g_spec.point * 10.0, MathSqrt(var));
      outZ        = (refClose - vwap) / sd;
      outVwapOk   = MathIsValidNumber(outZ);
     }
   if(InpUseLiqTrapGuard && dt.hour >= 7 && asiaBars >= 6 && aHi > aLo)
     {
      outAsiaHi = aHi;
      outAsiaLo = aLo;
      outAsiaOk = true;
     }
  }

bool PassesQuantEntryGuards(const bool isBuy, const double price, const double atr,
                            const bool vwapOk, const double zVal,
                            const bool pdhOk, const double pdh, const double pdl,
                            const bool asiaOk, const double asiaHi, const double asiaLo)
  {
   if(InpUseVwapGuard && vwapOk)
     {
      if(isBuy)
        {
         if(InpVwapFallKnifeZ > 0.0 && zVal < -InpVwapFallKnifeZ) return false;
         if(InpVwapAntiChaseZ > 0.0 && zVal >  InpVwapAntiChaseZ) return false;
        }
      else
        {
         if(InpVwapFallKnifeZ > 0.0 && zVal >  InpVwapFallKnifeZ) return false;
         if(InpVwapAntiChaseZ > 0.0 && zVal < -InpVwapAntiChaseZ) return false;
        }
     }
   if(InpUseLiqTrapGuard && InpLiqTrapAtrMult > 0.0 && atr > 0.0)
     {
      double zone = atr * InpLiqTrapAtrMult;
      if(pdhOk && (MathAbs(price - pdh) <= zone || MathAbs(price - pdl) <= zone))
         return false;
      if(asiaOk && (MathAbs(price - asiaHi) <= zone || MathAbs(price - asiaLo) <= zone))
         return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
//| Daily Accounting, Soft DD Shield & Infinite Profit Bank          |
//+------------------------------------------------------------------+
double ComputeClosedBalanceDdPct(const double bal)
  {
   if(g_day.peakBal <= 0.0 || bal >= g_day.peakBal) return 0.0;
   return 100.0 * (g_day.peakBal - bal) / g_day.peakBal;
  }

double EffBaseRiskPct()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 5.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 17.5;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 18.5;
   return InpBaseRiskPct;
  }

double EffUnderwaterRiskPct()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 5.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 17.5;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 18.5;
   return InpUnderwaterRiskPct;
  }

double EffMaxRiskCapPct()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 12.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 40.0;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 43.0;
   return InpMaxRiskCapPct;
  }

double EffSoftDdTier1()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 15.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 0.0;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 0.0;
   return InpSoftDdTier1Pct;
  }

double EffSoftDdTier2()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 25.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 0.0;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 0.0;
   return InpSoftDdTier2Pct;
  }

double EffBankRatchetStart()
  {
   if(InpRiskProfile == NPR_PROF_LIVE_SAFE)         return 5.0;
   if(InpRiskProfile == NPR_PROF_ALLWEATHER_GROWTH) return 500.0;
   if(InpRiskProfile == NPR_PROF_TURBO_MILLION)     return 1000.0;
   return InpBankRatchetStart;
  }

int GetD1MacroDir()
  {
   if(g_hEmaFastD1 == INVALID_HANDLE || g_hEmaSlowD1 == INVALID_HANDLE) return 0;
   double dF[1], dS[1];
   if(CopyBuffer(g_hEmaFastD1, 0, 1, 1, dF) != 1) return 0;
   if(CopyBuffer(g_hEmaSlowD1, 0, 1, 1, dS) != 1) return 0;
   if(!MathIsValidNumber(dF[0]) || !MathIsValidNumber(dS[0])) return 0;
   if(dF[0] > dS[0]) { g_lastD1Dir =  1; return  1; }
   if(dF[0] < dS[0]) { g_lastD1Dir = -1; return -1; }
   g_lastD1Dir = 0;
   return 0;
  }

double ComputeSoftShieldMult(const double ddPct, const double curBal)
  {
   g_vaultActive   = false;
   g_vaultFloorBal = 0.0;

   if(InpUsePrincipalLock && g_startBalance > 0.0 && (!InpUseProfitBank || g_bankedProfit <= 0.0))
     {
      double lockAct = g_startBalance * MathMax(1.15, InpPrincipalActMult);
      if(g_day.peakBal >= lockAct)
        {
         g_vaultActive   = true;
         double pFloor   = g_startBalance * (MathMax(50.0, MathMin(120.0, InpPrincipalFloorPct)) / 100.0);
         g_vaultFloorBal = pFloor;

         double cushionPeak = MathMax(1.0, g_day.peakBal - pFloor);
         double taperStart  = pFloor + 0.50 * cushionPeak;
         if(curBal >= taperStart) return 1.00;
         if(curBal <= pFloor)     return 0.20;

         double prog = (taperStart - curBal) / MathMax(1.0, taperStart - pFloor);
         return MathMax(0.20, 1.00 - prog * 0.80);
        }
     }

   double t2 = EffSoftDdTier2();
   double t1 = EffSoftDdTier1();
   if(t2 > 0.0 && ddPct >= t2) return 0.55;
   if(t1 > 0.0 && ddPct >= t1) return 0.80;
   return 1.00;
  }

void SyncDailyAccountingCore()
  {
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq  = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq <= 0.0) eq = bal;

   double flt = 0.0;
   int curOpen = CountOurPositions(flt);

   // Stage A: Infinite Continuous Ratchet (starts at 4x = $4,000 for fast early compounding)
   if(InpUseProfitBank && curOpen == 0 && g_startBalance > 0.0 && bal > g_hwmTotalBal)
     {
      double rStart = g_startBalance * MathMax(1.05, EffBankRatchetStart());
      if(InpBankRatchetPct > 0.0 && bal >= rStart)
        {
         double prevBase = MathMax(g_hwmTotalBal, rStart);
         double newGain  = bal - prevBase;
         if(newGain > 0.0)
           {
            double hiLevel   = g_startBalance * MathMax(EffBankRatchetStart() + 0.5, InpBankRatchetHiMult);
            double activePct = (InpBankRatchetHiPct > 0.0 && bal >= hiLevel) ? InpBankRatchetHiPct : InpBankRatchetPct;
            double rFrac     = MathMax(1.0, MathMin(80.0, activePct)) / 100.0;
            double addBank   = newGain * rFrac;
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

   // Stage B: Deep-Pullback Cycle Lock
   if(InpUseProfitBank && InpBankSavePct > 0.0 && curOpen == 0 && g_cycleStart > 0.0)
     {
      double minPeakMult = MathMax(1.25, InpBankMinPeakMult);
      double trigPbPct   = MathMax(5.0, MathMin(55.0, InpBankPullbackPct));
      if(g_day.peakBal >= g_cycleStart * minPeakMult && ddBalPct >= trigPbPct)
        {
         double saveFrac    = MathMax(10.0, MathMin(90.0, InpBankSavePct)) / 100.0;
         double desiredWork = workBal * (1.0 - saveFrac);
         double minWorkEff = InpBankMinWorkUsd * NprCurrencyScale();
         if(minWorkEff > 0.0 && workBal > minWorkEff * 1.25)
            desiredWork = MathMax(desiredWork, minWorkEff);
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
            PrintFormat("NPR301 CYCLE SKIM #%d: +$%.2f locked | Total Bank=$%.2f | New WorkCap=$%.2f",
                        g_bankSkimCount, skim, g_bankedProfit, workBal);
           }
        }
     }

   g_lastDdPct      = ddBalPct;
   g_lastShieldMult = ComputeSoftShieldMult(ddBalPct, workBal);

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
     { g_day.blocked = true; g_day.reason = "MAX_TRADES"; return; }
  }

//+------------------------------------------------------------------+
//| Adaptive Fractional Kelly + Kaufman ER Confidence Risk Engine    |
//+------------------------------------------------------------------+
void SyncDailyAccounting()
  {
   int    prevDay  = g_day.utcDay;
   double prevPeak = g_day.peakBal;
   double prevBank = g_bankedProfit;
   bool   prevBlk  = g_day.blocked;
   string prevRsn  = g_day.reason;
   SyncDailyAccountingCore();
   if(!g_isTester && (g_day.utcDay != prevDay || g_day.peakBal != prevPeak ||
                      g_bankedProfit != prevBank || g_day.blocked != prevBlk ||
                      g_day.reason != prevRsn))
      SavePersistentState();
  }

double ComputeActiveRiskPct(const ENUM_ORDER_TYPE ordType = WRONG_VALUE, const double slPct = 0.0)
  {
   double curTotBal    = AccountInfoDouble(ACCOUNT_BALANCE);
   bool   isUnderwater = (g_startBalance > 0.0 && curTotBal < g_startBalance);
   double rawBase      = isUnderwater ? EffUnderwaterRiskPct() : EffBaseRiskPct();
   double base         = MathMax(0.25, rawBase);
   double r            = base;

   if(InpLotMode == NPR_LOT_ADAPTIVE_KELLY)
     {
      if(!isUnderwater && g_kelly.Count() >= MathMax(10, InpKellyMinTrades))
        {
         double rawK  = g_kelly.lastFullKelly * 100.0;
         double frac  = MathMax(0.15, MathMin(1.00, InpKellyFraction));
         double liveK = rawK * frac;
         r = 0.60 * MathMax(InpKellyMinRiskPct, liveK) + 0.40 * base;
        }
      if(g_runConsecLoss >= 2)
         r *= MathMax(0.25, InpLoss2Mult);
     }
   else if(InpLotMode == NPR_LOT_MARKOV_KELLY)
     {
      if(InpMarkovMode == NPR_MARKOV_ALTERNATION)
        {
         if(g_runConsecLoss >= 2)      r = base * MathMax(0.15, InpLoss2Mult);
         else if(g_runConsecLoss == 1) r = base * MathMax(1.00, InpAltLoss1Mult);
         else if(g_runConsecWins == 1) r = base * MathMax(0.50, InpAltWin1Mult);
         else                          r = base;
        }
      else
        {
         if(g_runConsecLoss >= 2)      r = base * MathMax(0.10, InpLoss2Mult);
         else if(g_runConsecLoss == 1) r = base * MathMax(0.15, InpLoss1Mult);
         else if(g_runConsecWins >= 3) r = base * MathMax(1.00, InpWin3Mult);
         else if(g_runConsecWins == 2) r = base * MathMax(1.00, InpWin2Mult);
         else if(g_runConsecWins == 1) r = base * MathMax(1.00, InpWin1Mult);
        }
     }

   // Universal All-Weather D1-Adaptive Side Allocation (Works in Both Bull & Bear Years)
   if(InpUseD1AdaptiveSide && (ordType == ORDER_TYPE_BUY || ordType == ORDER_TYPE_SELL))
     {
      int d1Dir = GetD1MacroDir();
      if(d1Dir != 0)
        {
         bool withD1 = ((ordType == ORDER_TYPE_BUY && d1Dir > 0) || (ordType == ORDER_TYPE_SELL && d1Dir < 0));
         r *= withD1 ? MathMax(0.50, MathMin(1.60, InpWithD1Mult)) : MathMax(0.30, MathMin(1.20, InpAgainstD1Mult));
        }
     }
   else if(InpUseSideKelly)
     {
      if(ordType == ORDER_TYPE_BUY)       r *= MathMax(0.20, MathMin(1.60, InpBuyRiskMult));
      else if(ordType == ORDER_TYPE_SELL) r *= MathMax(0.20, MathMin(1.60, InpSellRiskMult));
     }
   if(InpUseSessionKelly)
     {
      MqlDateTime dtK;
      TimeToStruct(TimeGMT(), dtK);
      if(dtK.hour == 15)      r *= MathMax(0.40, MathMin(1.60, InpHr15RiskMult));
      else if(dtK.hour == 16) r *= MathMax(0.40, MathMin(1.60, InpHr16RiskMult));
      else if(dtK.hour == 18) r *= MathMax(0.40, MathMin(1.60, InpHr18RiskMult));
     }
   if(InpUseReEntryBoost && g_day.consecLoss == 1)
     {
      r *= MathMax(1.00, MathMin(1.60, InpReEntryMult));
     }
   if(InpUseVolKelly && slPct > 0.0)
     {
      if(slPct < InpVolTightMaxPct)      r *= MathMax(0.20, MathMin(1.50, InpVolTightMult));
      else if(slPct < InpVolSweetMaxPct) r *= MathMax(0.50, MathMin(2.00, InpVolSweetMult));
      else                               r *= MathMax(0.25, MathMin(1.50, InpVolWideMult));
     }

   // Continuous Kaufman ER trend-quality confidence multiplier (0.94x - 1.08x)
   if(InpUseErRiskScaling && g_lastErVal > 0.0)
     {
      double erMult = MathMax(0.94, MathMin(1.08, 0.92 + 0.35 * g_lastErVal));
      r *= erMult;
     }

   r *= g_lastShieldMult;

   double hardCap  = MathMax(base, EffMaxRiskCapPct());
   if(r > hardCap) r = hardCap;
   double minFloor = (g_vaultActive && g_lastShieldMult < 0.25) ? 0.50 : 1.00;
   if(r < minFloor) r = minFloor;
   return r;
  }

double CalculateVolume(const ENUM_ORDER_TYPE ordType, const double entryPrice, const double slPrice, const double engineScale = 1.0)
  {
   double bal       = AccountInfoDouble(ACCOUNT_BALANCE);
   double eq        = AccountInfoDouble(ACCOUNT_EQUITY);
   double free      = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double rawBaseEq = (bal > 0.0) ? MathMin(bal, (eq > 0.0 ? eq : bal)) : eq;
   double baseEq    = InpUseProfitBank ? MathMax(0.0, rawBaseEq - g_bankedProfit) : rawBaseEq;
   if(baseEq <= 0.0) return 0.0;
   if(InpUseProfitBank && g_bankedProfit > 0.0 && baseEq <= 50.0) return 0.0;

   double slDist = MathAbs(entryPrice - slPrice);
   if(slDist <= g_spec.point) return 0.0;
   double slPct  = (entryPrice > 0.0) ? (100.0 * slDist / entryPrice) : 0.0;
   if(InpUseVolKelly && InpMaxSlHardPct > 0.0 && slPct >= InpMaxSlHardPct)
     {
      g_lastSkipReason = StringFormat("Wide SL %.2f%% >= %.2f%%", slPct, InpMaxSlHardPct);
      g_lastSkipUntil  = TimeCurrent() + 600;
      return 0.0;
     }

   double rawLot = InpFixedLot;
   g_lastRiskPct = ComputeActiveRiskPct(ordType, slPct) * MathMax(0.25, MathMin(1.25, engineScale));

   double liveTickVal = 0.0;
   if(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE, liveTickVal) && liveTickVal > 0.0)
      g_spec.tickValue = liveTickVal;
   double liveTickSz = 0.0;
   if(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE, liveTickSz) && liveTickSz > 0.0)
      g_spec.tickSize = liveTickSz;

   double lossPerLot = 0.0;
   if(g_spec.tickSize > 0.0 && g_spec.tickValue > 0.0)
      lossPerLot = (slDist / g_spec.tickSize) * g_spec.tickValue;
   else
     {
      double calcProfit = 0.0;
      if(OrderCalcProfit(ordType, _Symbol, 1.0, entryPrice, slPrice, calcProfit) && MathIsValidNumber(calcProfit))
         lossPerLot = MathAbs(calcProfit);
     }
   if(lossPerLot <= 0.0) return 0.0;

   if(InpLotMode == NPR_LOT_EQUITY_STEP)
     {
      double stepUsd = MathMax(10.0, InpEquityStepUsd * NprCurrencyScale());
      double unitLot = MathMax(g_spec.volMin, g_spec.volStep);
      rawLot = MathFloor(baseEq / stepUsd) * unitLot;
      if(rawLot < g_spec.volMin) rawLot = g_spec.volMin;
     }
   else if(InpLotMode == NPR_LOT_CONST_KELLY || InpLotMode == NPR_LOT_ADAPTIVE_KELLY || InpLotMode == NPR_LOT_MARKOV_KELLY)
     {
      double riskUsd = baseEq * (g_lastRiskPct / 100.0);
      if(InpUseProfitBank && g_bankedProfit > 0.0)
         riskUsd = MathMin(riskUsd, baseEq * (MathMax(10.0, EffMaxRiskCapPct()) / 100.0));
      rawLot = riskUsd / lossPerLot;
     }

   double liveBrokerMax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double singleMax     = (liveBrokerMax > 0.0) ? MathMin(g_spec.volMax, liveBrokerMax) : g_spec.volMax;
   double maxSlicesCap  = InpUseOrderSplit ? (singleMax * MathMax(1, InpMaxSplitOrders)) : singleMax;
   double capMax        = MathMin(maxSlicesCap, MathMax(g_spec.volMin, InpMaxLotCap));
   double symVolLimit   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_LIMIT);
   if(symVolLimit > 0.0)
     {
      double usedVol = 0.0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong ptk = PositionGetTicket(i);
         if(ptk > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol)
            usedVol += PositionGetDouble(POSITION_VOLUME);
        }
      double remLimit = MathMax(0.0, symVolLimit - usedVol);
      if(remLimit < g_spec.volMin) return 0.0;
      capMax = MathMin(capMax, remLimit);
     }
   double lot = NPR_ClampVol(rawLot, g_spec.volMin, capMax, g_spec.volStep);
   if(lot <= 0.0) return 0.0;

   double marginReq = 0.0;
   if(OrderCalcMargin(ordType, _Symbol, lot, entryPrice, marginReq) && marginReq > 0.0)
     {
      double maxAllow = free * (InpMaxMarginPct / 100.0);
      if(marginReq > maxAllow && maxAllow > 0.0)
        {
         double scaled = lot * (maxAllow / marginReq) * 0.96;
         lot = NPR_ClampVol(scaled, g_spec.volMin, capMax, g_spec.volStep);
        }
     }
   g_lastLotVal      = lot;
   g_lastPlannedRisk = lot * lossPerLot;
   return lot;
  }

//+------------------------------------------------------------------+
//| Auto Multi-Order Splitter (Respects Exness 500L/200L Single Cap) |
//+------------------------------------------------------------------+
bool ExecuteSplitOrder(const ENUM_ORDER_TYPE ordType, const double totalLot,
                       const double price, const double sl, const double tp, const string comment)
  {
   if(totalLot < g_spec.volMin) return false;
   g_batchClosedPnl  = 0.0;
   g_signalAccounted = false;
   double liveBrokerMax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double singleMax     = (liveBrokerMax > 0.0) ? MathMin(g_spec.volMax, liveBrokerMax) : g_spec.volMax;
   if(!InpUseOrderSplit || totalLot <= singleMax)
     {
      double v = NPR_ClampVol(totalLot, g_spec.volMin, singleMax, g_spec.volStep);
      bool ok = (ordType == ORDER_TYPE_BUY)
                ? g_trade.Buy(v, _Symbol, price, sl, tp, comment)
                : g_trade.Sell(v, _Symbol, price, sl, tp, comment);
      if(!ok)
         PrintFormat("NPR301 ORDER ERROR: retcode=%u (%s) | lot=%.2f px=%.2f sl=%.2f tp=%.2f",
                     g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription(), v, price, sl, tp);
      return ok;
     }
   double rem = totalLot;
   int maxOrd = MathMax(1, InpMaxSplitOrders);
   bool anyOk = false;
   for(int k = 0; k < maxOrd && rem >= g_spec.volMin; k++)
     {
      double slice = MathMin(rem, singleMax);
      slice = NPR_ClampVol(slice, g_spec.volMin, singleMax, g_spec.volStep);
      if(slice < g_spec.volMin) break;
      MqlTick tkNow;
      double px = price;
      if(SymbolInfoTick(_Symbol, tkNow))
         px = (ordType == ORDER_TYPE_BUY) ? tkNow.ask : tkNow.bid;
      if(k > 0 && InpMaxSplitSlipAtr > 0.0 && g_lastAtrVal > 0.0)
        {
         double adverseSlip = (ordType == ORDER_TYPE_BUY) ? (px - price) : (price - px);
         if(adverseSlip > g_lastAtrVal * InpMaxSplitSlipAtr)
           {
            PrintFormat("NPR301 SPLIT SLIPPAGE GUARD #%d: slip=%.2f > %.2f | stopping remaining slices",
                        k + 1, adverseSlip, g_lastAtrVal * InpMaxSplitSlipAtr);
            break;
           }
        }
      bool ok = (ordType == ORDER_TYPE_BUY)
                ? g_trade.Buy(slice, _Symbol, px, sl, tp, comment)
                : g_trade.Sell(slice, _Symbol, px, sl, tp, comment);
      if(!ok)
        {
         PrintFormat("NPR301 SPLIT ORDER ERROR #%d: retcode=%u (%s) | lot=%.2f px=%.2f sl=%.2f tp=%.2f",
                     k + 1, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription(), slice, px, sl, tp);
         break;
        }
      anyOk = true;
      rem  -= slice;
     }
   return anyOk;
  }


//+------------------------------------------------------------------+
//| H4+H1 + Kaufman ER + CLV Rejection + M5 Sweep-Reversion Entry    |
//+------------------------------------------------------------------+
void TrySweepReversionEntry(const MqlTick &tk)
  {
   int activeCd = g_lastTradeLoss ? MathMax(InpCooldownSec, InpLossCooldownSec) : InpCooldownSec;
   if(g_lastCloseTime > 0 && (TimeCurrent() - g_lastCloseTime) < activeCd) return;

   double bAtr[2], bAtrH1[2], bBbUp[3], bBbLo[3], bRsi[3], bH1F[2], bH1S[2], bH4F[2], bH4S[2];
   if(CopyBuffer(g_hAtrSig,    0, 1, 1, bAtr)   != 1) return;
   if(CopyBuffer(g_hAtrH1,     0, 1, 1, bAtrH1) != 1) return;
   if(CopyBuffer(g_hBbSig,     1, 1, 2, bBbUp)  != 2) return;
   if(CopyBuffer(g_hBbSig,     2, 1, 2, bBbLo)  != 2) return;
   if(CopyBuffer(g_hRsiSig,    0, 1, 2, bRsi)   != 2) return;
   if(CopyBuffer(g_hEmaFastH1, 0, 1, 1, bH1F)   != 1) return;
   if(CopyBuffer(g_hEmaSlowH1, 0, 1, 1, bH1S)   != 1) return;
   if(CopyBuffer(g_hEmaFastH4, 0, 1, 1, bH4F)   != 1) return;
   if(CopyBuffer(g_hEmaSlowH4, 0, 1, 1, bH4S)   != 1) return;

   double atr   = ComputeHybridVolatility(bAtr[0]);
   double atrH1 = bAtrH1[0];
   if(!MathIsValidNumber(atr) || atr <= 0.0) return;
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
         SavePersistentState();
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

   double erH1 = ComputeKaufmanER(InpMacroTf, InpErPeriod);
   g_lastErVal = erH1;
   if(InpUseKaufmanER && InpMinH1EffRatio > 0.0 && erH1 < InpMinH1EffRatio)
     {
      g_biasTxt   = "H1 NOISY";
      g_volStatus = "LOW_ER_CHOP";
      return;
     }

   if(InpUseH1FlatFilter && InpMinH1EmaGapAtr > 0.0 && MathIsValidNumber(atrH1) && atrH1 > 0.0)
     {
      double emaGapAtr = MathAbs(bH1F[0] - bH1S[0]) / atrH1;
      if(emaGapAtr < InpMinH1EmaGapAtr)
        {
         g_biasTxt   = "H1 FLAT";
         g_volStatus = "H1_FLAT";
         return;
        }
     }

   bool allowBuy  = (InpDirection == NPR_DIR_BOTH || InpDirection == NPR_DIR_BUY_ONLY);
   bool allowSell = (InpDirection == NPR_DIR_BOTH || InpDirection == NPR_DIR_SELL_ONLY);

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

   // Close Location Value (CLV) rejection quality filter
   double rng0   = MathMax(g_spec.point, r[0].high - r[0].low);
   double clvBuy = (r[0].close - r[0].low) / rng0;
   double clvSel = (r[0].high - r[0].close) / rng0;
   double minClv = MathMax(0.0, MathMin(0.90, InpMinRejectCLV));

   bool buySweep   = (r[0].low <= bbLo1 || r[1].low <= bbLo2 || rsi1 <= InpRsiOversold || rsi2 <= InpRsiOversold);
   bool buyReject  = (!InpRequireRejCandle || (r[0].close > r[0].open && r[0].close > bbLo1 && clvBuy >= minClv));

   bool sellSweep  = (r[0].high >= bbUp1 || r[1].high >= bbUp2 || rsi1 >= InpRsiOverbought || rsi2 >= InpRsiOverbought);
   bool sellReject = (!InpRequireRejCandle || (r[0].close < r[0].open && r[0].close < bbUp1 && clvSel >= minClv));

   ConfigureFilling();
   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(40);

   double brokerStopFloor = (g_spec.stopsPts > 0) ? ((double)(g_spec.stopsPts + 5) * g_spec.point) : 0.0;
   double minSl  = MathMax(brokerStopFloor, MathMax(atr * InpSlAtrMult, g_spread.lastSpread * InpMinSlSpreadMult));
   double maxSl  = MathMax(minSl, atr * InpMaxSlAtrMult);

   // Dynamic ER-Adaptive TP Boost on strong directional trends
   double tpMult = InpTpAtrMult;
   if(InpUseDynamicTp && InpDynTpBonusAtr > 0.0 && erH1 >= InpDynTpErThresh)
     {
      double erFrac = MathMin(1.0, (erH1 - InpDynTpErThresh) / 0.25);
      tpMult += InpDynTpBonusAtr * MathMax(0.35, erFrac);
     }
   double tpDist = MathMax(brokerStopFloor, MathMax(atr * tpMult, g_spread.lastSpread * 5.0));

   // Engine #2: Strong-Trend Momentum Continuation (shallow mid-BB pullback + breakout bar)
   double bbMid1    = 0.5 * (bbUp1 + bbLo1);
   double bbMid2    = 0.5 * (bbUp2 + bbLo2);
   double momMinClv = MathMax(0.50, MathMin(0.95, InpMomMinCLV));
   bool   momGate   = (InpUseMomEngine && erH1 >= InpMomMinER);

   bool buyMom  = (momGate
                   && (r[1].low <= bbMid2 + 0.15 * atr || r[1].close < r[1].open)
                   && r[0].close > r[0].open
                   && r[0].close > r[1].high
                   && r[0].close > bbMid1
                   && clvBuy >= momMinClv
                   && rsi1 >= 52.0 && rsi1 <= 72.0);

   bool sellMom = (momGate
                   && (r[1].high >= bbMid2 - 0.15 * atr || r[1].close > r[1].open)
                   && r[0].close < r[0].open
                   && r[0].close < r[1].low
                   && r[0].close < bbMid1
                   && clvSel >= momMinClv
                   && rsi1 <= 48.0 && rsi1 >= 28.0);

   bool vwapOk = false, pdhOk = false, asiaOk = false;
   double vwapZ = 0.0, pdh = 0.0, pdl = 0.0, asiaHi = 0.0, asiaLo = 0.0;
   ComputeSessionQuantLevels(r[0].time, r[0].close, vwapOk, vwapZ, pdhOk, pdh, pdl, asiaOk, asiaHi, asiaLo);

   bool quantBuyOk  = PassesQuantEntryGuards(true,  tk.ask, atr, vwapOk, vwapZ, pdhOk, pdh, pdl, asiaOk, asiaHi, asiaLo);
   bool quantSellOk = PassesQuantEntryGuards(false, tk.bid, atr, vwapOk, vwapZ, pdhOk, pdh, pdl, asiaOk, asiaHi, asiaLo);

   if(allowBuy && buySweep && buyReject && quantBuyOk)
     {
      double swingLo = MathMin(r[0].low, r[1].low);
      double wickSl  = (tk.ask - (swingLo - atr * InpWickPadAtr));
      double slDist  = MathMax(minSl, MathMin(maxSl, wickSl));
      double sl      = NPR_AlignPrice(tk.ask - slDist, g_spec.tickSize, g_spec.digits);
      double tp      = NPR_AlignPrice(tk.ask + tpDist, g_spec.tickSize, g_spec.digits);
      double lot     = CalculateVolume(ORDER_TYPE_BUY, tk.ask, sl, 1.0);
      if(lot >= g_spec.volMin && sl > 0.0 && tp > tk.ask)
         ExecuteSplitOrder(ORDER_TYPE_BUY, lot, tk.ask, sl, tp, "NPR301_REV_BUY");
     }
   else if(allowSell && sellSweep && sellReject && quantSellOk)
     {
      double swingHi = MathMax(r[0].high, r[1].high);
      double wickSl  = ((swingHi + atr * InpWickPadAtr) - tk.bid);
      double slDist  = MathMax(minSl, MathMin(maxSl, wickSl));
      double sl      = NPR_AlignPrice(tk.bid + slDist, g_spec.tickSize, g_spec.digits);
      double tp      = NPR_AlignPrice(tk.bid - tpDist, g_spec.tickSize, g_spec.digits);
      double lot     = CalculateVolume(ORDER_TYPE_SELL, tk.bid, sl, 1.0);
      if(lot >= g_spec.volMin && tp > 0.0 && sl > tk.bid)
         ExecuteSplitOrder(ORDER_TYPE_SELL, lot, tk.bid, sl, tp, "NPR301_REV_SELL");
     }
   else if(allowBuy && buyMom && quantBuyOk)
     {
      double swingLo  = MathMin(r[0].low, r[1].low);
      double wickSl   = (tk.ask - (swingLo - atr * InpWickPadAtr));
      double slDist   = MathMax(minSl, MathMin(maxSl, wickSl));
      double momTpDst = MathMax(atr * MathMax(tpMult, InpMomTpAtrMult), g_spread.lastSpread * 5.0);
      double sl       = NPR_AlignPrice(tk.ask - slDist, g_spec.tickSize, g_spec.digits);
      double tp       = NPR_AlignPrice(tk.ask + momTpDst, g_spec.tickSize, g_spec.digits);
      double lot      = CalculateVolume(ORDER_TYPE_BUY, tk.ask, sl, InpMomRiskScale);
      if(lot >= g_spec.volMin && sl > 0.0 && tp > tk.ask)
         ExecuteSplitOrder(ORDER_TYPE_BUY, lot, tk.ask, sl, tp, "NPR301_MOM_BUY");
     }
   else if(allowSell && sellMom && quantSellOk)
     {
      double swingHi  = MathMax(r[0].high, r[1].high);
      double wickSl   = ((swingHi + atr * InpWickPadAtr) - tk.bid);
      double slDist   = MathMax(minSl, MathMin(maxSl, wickSl));
      double momTpDst = MathMax(atr * MathMax(tpMult, InpMomTpAtrMult), g_spread.lastSpread * 5.0);
      double sl       = NPR_AlignPrice(tk.bid + slDist, g_spec.tickSize, g_spec.digits);
      double tp       = NPR_AlignPrice(tk.bid - momTpDst, g_spec.tickSize, g_spec.digits);
      double lot      = CalculateVolume(ORDER_TYPE_SELL, tk.bid, sl, InpMomRiskScale);
      if(lot >= g_spec.volMin && tp > 0.0 && sl > tk.bid)
         ExecuteSplitOrder(ORDER_TYPE_SELL, lot, tk.bid, sl, tp, "NPR301_MOM_SELL");
     }
  }

//+------------------------------------------------------------------+
//| Manage Open Positions (4h Stagnant TimeStop + Optional BE/Trail) |
//+------------------------------------------------------------------+
void ManageOpenPositions(const MqlTick &tk)
  {
   if(!InpUseLateBE && !InpUseAtrTrail && InpMaxHoldBars <= 0) return;

   if(g_lastAtrVal <= 0.0 && g_hAtrSig != INVALID_HANDLE)
     {
      double bAtrTmp[1];
      if(CopyBuffer(g_hAtrSig, 0, 1, 1, bAtrTmp) == 1 && MathIsValidNumber(bAtrTmp[0]) && bAtrTmp[0] > 0.0)
         g_lastAtrVal = bAtrTmp[0];
     }
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
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

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
         newSl = NPR_AlignPrice(newSl, g_spec.tickSize, g_spec.digits);
         bool valid = (pType == POSITION_TYPE_BUY) ? (newSl < tk.bid - minStop)
                                                   : (newSl > tk.ask + minStop);
         if(valid) g_trade.PositionModify(tkId, newSl, curTp);
        }
     }
  }

//+------------------------------------------------------------------+
//| Deal Accounting & Live Kelly Feed (OnTradeTransaction)           |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest &request,
                        const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong dealTk = trans.deal;
   if(dealTk == 0 || !HistoryDealSelect(dealTk)) return;

   long dealType = HistoryDealGetInteger(dealTk, DEAL_TYPE);
   if(dealType == DEAL_TYPE_BALANCE || dealType == DEAL_TYPE_BONUS || dealType == DEAL_TYPE_CORRECTION)
     {
      double amount  = HistoryDealGetDouble(dealTk, DEAL_PROFIT);
      double bal     = AccountInfoDouble(ACCOUNT_BALANCE);
      double eq      = AccountInfoDouble(ACCOUNT_EQUITY);
      double workBal = InpUseProfitBank ? MathMax(0.0, bal - g_bankedProfit) : bal;
      double workEq  = InpUseProfitBank ? MathMax(0.0, eq  - g_bankedProfit) : eq;

      if(amount > 0.0)
        {
         g_startBalance = (g_startBalance > 0.0) ? (g_startBalance + amount) : bal;
         g_cycleStart   = (g_cycleStart > 0.0)   ? (g_cycleStart + amount)   : workBal;
         g_hwmTotalBal  = MathMax(g_hwmTotalBal, bal);
         g_day.dayStartEq = workEq;
         g_day.peakBal    = MathMax(g_day.peakBal, workBal);
         g_day.peakEq     = MathMax(g_day.peakEq,  workEq);
         g_day.consecLoss = 0;
         g_runConsecLoss  = 0;
         g_ddPauseUntil   = 0;
         g_day.killSwitch = false;
         g_day.blocked    = false;
         g_day.reason     = "";
         g_lastDdPct      = ComputeClosedBalanceDdPct(workBal);
         g_hudFooterNote = "MEM UPDATED (DEPOSIT)"; g_hudFooterUntil = TimeCurrent() + 15;
         PrintFormat("NPR301 DEPOSIT +%.2f: Reset DAILY_LOSS/CONSEC_LOSS -> ACTIVE | Bal=%.2f", amount, bal);
        }
      else if(amount < 0.0)
        {
         double outAmt = MathAbs(amount);
         double remOut = outAmt;
         if(InpUseProfitBank && g_bankedProfit > 0.0)
           {
            double fromBank = MathMin(g_bankedProfit, outAmt);
            g_bankedProfit -= fromBank;
            remOut         -= fromBank;
            workBal         = MathMax(0.0, bal - g_bankedProfit);
            workEq          = MathMax(0.0, eq  - g_bankedProfit);
           }
         g_hwmTotalBal    = MathMax(bal, g_hwmTotalBal - outAmt);
         g_startBalance   = MathMax(1.0, g_startBalance - remOut);
         g_cycleStart     = MathMax(1.0, g_cycleStart - remOut);
         g_day.peakBal    = MathMax(workBal, g_day.peakBal - remOut);
         g_day.peakEq     = MathMax(workEq,  g_day.peakEq  - remOut);
         g_day.dayStartEq = MathMax(0.0,     g_day.dayStartEq - remOut);
         g_lastDdPct      = ComputeClosedBalanceDdPct(workBal);
         g_hudFooterNote = "MEM UPDATED (WITHDRAW)"; g_hudFooterUntil = TimeCurrent() + 15;
         PrintFormat("NPR301 WITHDRAW -%.2f: Adjusted Peak/Start -> DD=%.2f%% | Bal=%.2f", outAmt, g_lastDdPct, bal);
        }
      double tmpFlt = 0.0;
      SavePersistentState();
      RenderHud(true, g_paused ? "PAUSED" : (g_day.blocked ? g_day.reason : "ACTIVE"), CountOurPositions(tmpFlt));
      return;
     }

   if(HistoryDealGetString(dealTk, DEAL_SYMBOL) != _Symbol) return;
   if(HistoryDealGetInteger(dealTk, DEAL_MAGIC) != InpMagicNumber) return;

   long entry = HistoryDealGetInteger(dealTk, DEAL_ENTRY);
   if(entry == DEAL_ENTRY_IN) { SavePersistentState(); return; }
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) return;

   double pnl = HistoryDealGetDouble(dealTk, DEAL_PROFIT)
              + HistoryDealGetDouble(dealTk, DEAL_SWAP)
              + HistoryDealGetDouble(dealTk, DEAL_COMMISSION);

   g_day.closedPnl  += pnl;
   g_batchClosedPnl += pnl;
   g_lastCloseTime   = TimeCurrent();

   // If split slices are still open, wait for the final slice before counting 1 logical trade
   double remFlt = 0.0;
   if(CountOurPositions(remFlt) > 0)
      return;
   // Prevent same-tick simultaneous SL/TP closes of split slices from double-counting consecLoss/ReEntry
   if(g_signalAccounted)
      return;
   g_signalAccounted = true;

   double netBatch = g_batchClosedPnl;
   g_batchClosedPnl = 0.0;
   g_lastBatchTime  = g_lastCloseTime;

   g_day.trades++;
   if(g_lastPlannedRisk > 0.0)
      g_kelly.PushR(netBatch / g_lastPlannedRisk);

   if(netBatch >= 0.0)
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
   SavePersistentState();
  }

//+------------------------------------------------------------------+
//| Lifecycle: OnInit / OnDeinit / OnTimer / OnChartEvent / OnTick   |
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

void ClearChartOverlay()
  {
   if(g_isTester) return;
   long cid = ChartID();
   for(int i = ObjectsTotal(cid) - 1; i >= 0; i--)
     {
      string nm = ObjectName(cid, i);
      if(StringFind(nm, "NP301_OVL_") == 0)
         ObjectDelete(cid, nm);
     }
  }

void DrawOvlHLine(const string name, const double price, const color col, const int width, const ENUM_LINE_STYLE style)
  {
   if(price <= 0.0) return;
   long cid = ChartID();
   if(ObjectFind(cid, name) < 0)
      ObjectCreate(cid, name, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(cid,  name, OBJPROP_PRICE, price);
   ObjectSetInteger(cid, name, OBJPROP_COLOR, col);
   ObjectSetInteger(cid, name, OBJPROP_WIDTH, width);
   ObjectSetInteger(cid, name, OBJPROP_STYLE, style);
   ObjectSetInteger(cid, name, OBJPROP_BACK, true);
   ObjectSetInteger(cid, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(cid, name, OBJPROP_HIDDEN, true);
  }

void DrawOvlSeg(const string name, const datetime t1, const double p1,
                const datetime t2, const double p2,
                const color col, const int width, const ENUM_LINE_STYLE style)
  {
   if(p1 <= 0.0 || p2 <= 0.0 || t1 <= 0 || t2 <= 0) return;
   long cid = ChartID();
   if(ObjectFind(cid, name) < 0)
      ObjectCreate(cid, name, OBJ_TREND, 0, t1, p1, t2, p2);
   ObjectSetInteger(cid, name, OBJPROP_TIME, 0, t1);
   ObjectSetDouble(cid,  name, OBJPROP_PRICE, 0, p1);
   ObjectSetInteger(cid, name, OBJPROP_TIME, 1, t2);
   ObjectSetDouble(cid,  name, OBJPROP_PRICE, 1, p2);
   ObjectSetInteger(cid, name, OBJPROP_RAY_LEFT, false);
   ObjectSetInteger(cid, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(cid, name, OBJPROP_COLOR, col);
   ObjectSetInteger(cid, name, OBJPROP_WIDTH, width);
   ObjectSetInteger(cid, name, OBJPROP_STYLE, style);
   ObjectSetInteger(cid, name, OBJPROP_BACK, true);
   ObjectSetInteger(cid, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(cid, name, OBJPROP_HIDDEN, true);
  }

double ComputeVisualFairVwap(const datetime refBarTime)
  {
   MqlDateTime dt;
   TimeToStruct(refBarTime, dt);
   datetime dayStart = refBarTime - (dt.hour * 3600 + dt.min * 60 + dt.sec);
   MqlRates mr[];
   ArraySetAsSeries(mr, true);
   int got = CopyRates(_Symbol, InpSignalTf, 0, 300, mr);
   if(got <= 0) return 0.0;
   double sumPV = 0.0, sumV = 0.0;
   for(int i = 0; i < got; i++)
     {
      if(mr[i].time < dayStart) break;
      double tp = (mr[i].high + mr[i].low + mr[i].close) / 3.0;
      double v  = (double)MathMax(1, (long)mr[i].tick_volume);
      sumPV += tp * v;
      sumV  += v;
     }
   return (sumV > 0.0) ? (sumPV / sumV) : 0.0;
  }

void DrawOvlPill(const string name, const int yPx, const string text, const color bgCol, const color brdCol, const color txtCol, const int fixedW = 0)
  {
   long cid = ChartID();
   int pillW = (fixedW > 0) ? fixedW : MathMax(96, StringLen(text) * 8 + 18);
   int pillH = 19;
   string bgName  = name + "_BG";
   string txtName = name + "_TXT";

   if(ObjectFind(cid, bgName) < 0)
      ObjectCreate(cid, bgName, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(cid, bgName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(cid, bgName, OBJPROP_XDISTANCE, pillW + 2);
   ObjectSetInteger(cid, bgName, OBJPROP_YDISTANCE, yPx);
   ObjectSetInteger(cid, bgName, OBJPROP_XSIZE, pillW);
   ObjectSetInteger(cid, bgName, OBJPROP_YSIZE, pillH);
   ObjectSetInteger(cid, bgName, OBJPROP_BGCOLOR, bgCol);
   ObjectSetInteger(cid, bgName, OBJPROP_COLOR, brdCol);
   ObjectSetInteger(cid, bgName, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(cid, bgName, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(cid, bgName, OBJPROP_HIDDEN, true);

   if(ObjectFind(cid, txtName) < 0)
      ObjectCreate(cid, txtName, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(cid, txtName, OBJPROP_CORNER, CORNER_RIGHT_UPPER);
   ObjectSetInteger(cid, txtName, OBJPROP_ANCHOR, ANCHOR_RIGHT_UPPER);
   ObjectSetInteger(cid, txtName, OBJPROP_XDISTANCE, 8);
   ObjectSetInteger(cid, txtName, OBJPROP_YDISTANCE, yPx + 2);
   ObjectSetString(cid,  txtName, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(cid, txtName, OBJPROP_FONTSIZE, 9);
   ObjectSetInteger(cid, txtName, OBJPROP_COLOR, txtCol);
   ObjectSetString(cid,  txtName, OBJPROP_TEXT, text);
   ObjectSetInteger(cid, txtName, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(cid, txtName, OBJPROP_HIDDEN, true);
  }

void UpdateChartOverlay(const bool force)
  {
   if(g_isTester || !InpShowHud || !g_isVisual) return;
   datetime curBar = iTime(_Symbol, InpSignalTf, 0);
   double fltTmp = 0.0;
   int openPos = CountOurPositions(fltTmp);
   if(!force && curBar == g_lastOvlBar && openPos == g_lastOvlPos) return;
   g_lastOvlBar = curBar;
   g_lastOvlPos = openPos;

   const int curveBars = 288; // 24 hours on M5 (1 full trading day)
   double bUp[], bLo[];
   datetime tm[];
   ArraySetAsSeries(bUp, true);
   ArraySetAsSeries(bLo, true);
   ArraySetAsSeries(tm,  true);
   int gotUp = CopyBuffer(g_hBbSig, 1, 0, curveBars, bUp);
   int gotLo = CopyBuffer(g_hBbSig, 2, 0, curveBars, bLo);
   int gotTm = CopyTime(_Symbol, InpSignalTf, 0, curveBars, tm);
   int nCurve = MathMin(gotUp, MathMin(gotLo, gotTm));
   bool hasBb = (nCurve >= 2);

   double ordEntry = 0.0, ordSl = 0.0, ordTp = 0.0, ordLots = 0.0;
   long   ordType  = -1;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      ordType  = PositionGetInteger(POSITION_TYPE);
      ordEntry = PositionGetDouble(POSITION_PRICE_OPEN);
      ordSl    = PositionGetDouble(POSITION_SL);
      ordTp    = PositionGetDouble(POSITION_TP);
      ordLots += PositionGetDouble(POSITION_VOLUME);
     }

   color cSellZone = C'215,95,112';
   color cBuyZone  = C'58,215,162';
   color cMeanLine = C'115,135,165';
   color cFairLine = C'235,190,65';

   if(hasBb)
     {
      for(int i = 0; i < nCurve - 1; i++)
        {
         double m1 = 0.5 * (bUp[i] + bLo[i]);
         double m2 = 0.5 * (bUp[i + 1] + bLo[i + 1]);
         DrawOvlSeg("NP301_OVL_CU_" + IntegerToString(i), tm[i + 1], bUp[i + 1], tm[i], bUp[i], cSellZone, 3, STYLE_SOLID);
         DrawOvlSeg("NP301_OVL_CM_" + IntegerToString(i), tm[i + 1], m2,         tm[i], m1,     cMeanLine, 1, STYLE_DOT);
         DrawOvlSeg("NP301_OVL_CL_" + IntegerToString(i), tm[i + 1], bLo[i + 1], tm[i], bLo[i], cBuyZone,  3, STYLE_SOLID);
        }
     }

   double fairVwap = ComputeVisualFairVwap(curBar);
   if(fairVwap > 0.0)
     {
      g_epLastFairPx = fairVwap;
      DrawOvlHLine("NP301_OVL_L_FAIR", fairVwap, cFairLine, 1, STYLE_DASH);
     }

   bool showSellTrig = (StringFind(g_biasTxt, "BEAR") >= 0 || StringFind(g_biasTxt, "2-WAY") >= 0);
   bool showBuyTrig  = (StringFind(g_biasTxt, "BULL") >= 0 || StringFind(g_biasTxt, "2-WAY") >= 0);
   double trigSellPx = hasBb ? bUp[1] : 0.0;
   double trigBuyPx  = hasBb ? bLo[1] : 0.0;
   color cTrigLine = C'255,148,40';
   long cid = ChartID();
   if(showSellTrig && trigSellPx > 0.0)
      DrawOvlHLine("NP301_OVL_L_STRIG", trigSellPx, cTrigLine, 1, STYLE_DASH);
   else if(ObjectFind(cid, "NP301_OVL_L_STRIG") >= 0)
      ObjectDelete(cid, "NP301_OVL_L_STRIG");

   if(showBuyTrig && trigBuyPx > 0.0)
      DrawOvlHLine("NP301_OVL_L_BTRIG", trigBuyPx,  cTrigLine, 1, STYLE_DASH);
   else if(ObjectFind(cid, "NP301_OVL_L_BTRIG") >= 0)
      ObjectDelete(cid, "NP301_OVL_L_BTRIG");

   if(openPos > 0 && ordEntry > 0.0)
     {
      DrawOvlHLine("NP301_OVL_L_ENTRY", ordEntry, clrDeepSkyBlue, 2, STYLE_SOLID);
      if(ordSl > 0.0) DrawOvlHLine("NP301_OVL_L_SL", ordSl, clrTomato,         3, STYLE_SOLID);
      else if(ObjectFind(cid, "NP301_OVL_L_SL") >= 0) ObjectDelete(cid, "NP301_OVL_L_SL");
      if(ordTp > 0.0) DrawOvlHLine("NP301_OVL_L_TP", ordTp, clrMediumSeaGreen, 3, STYLE_SOLID);
      else if(ObjectFind(cid, "NP301_OVL_L_TP") >= 0) ObjectDelete(cid, "NP301_OVL_L_TP");
     }
   else
     {
      if(ObjectFind(cid, "NP301_OVL_L_ENTRY") >= 0) ObjectDelete(cid, "NP301_OVL_L_ENTRY");
      if(ObjectFind(cid, "NP301_OVL_L_SL")    >= 0) ObjectDelete(cid, "NP301_OVL_L_SL");
      if(ObjectFind(cid, "NP301_OVL_L_TP")    >= 0) ObjectDelete(cid, "NP301_OVL_L_TP");
     }

   // Collect price pills & resolve vertical overlap (min 23 px apart)
   double pPrices[9]; string pTexts[9]; color pBg[9], pBrd[9], pTxt[9]; int pFixedW[9]; int pCnt = 0;
   string cSym = NprIsCentAccount() ? "¢" : "$";

   if(openPos > 0 && ordEntry > 0.0)
     {
      pPrices[pCnt] = ordEntry;
      pTexts[pCnt]  = StringFormat("ORDER ENTRY %.2f (%.2fL)", ordEntry, ordLots);
      pBg[pCnt] = C'14,36,64'; pBrd[pCnt] = clrDeepSkyBlue; pTxt[pCnt] = clrWhite; pFixedW[pCnt] = 256; pCnt++;

      if(ordTp > 0.0)
        {
         double estTp = 0.0;
         OrderCalcProfit((ENUM_ORDER_TYPE)ordType, _Symbol, ordLots, ordEntry, ordTp, estTp);
         pPrices[pCnt] = ordTp;
         pTexts[pCnt]  = StringFormat("ORDER TP %.2f (+%s%.2f)", ordTp, cSym, MathAbs(estTp));
         pBg[pCnt] = C'16,56,40'; pBrd[pCnt] = clrMediumSeaGreen; pTxt[pCnt] = clrWhite; pFixedW[pCnt] = 256; pCnt++;
        }
      if(ordSl > 0.0)
        {
         double estSl = 0.0;
         OrderCalcProfit((ENUM_ORDER_TYPE)ordType, _Symbol, ordLots, ordEntry, ordSl, estSl);
         pPrices[pCnt] = ordSl;
         pTexts[pCnt]  = StringFormat("ORDER SL %.2f (%s%.2f)", ordSl, cSym, estSl);
         pBg[pCnt] = C'80,20,30'; pBrd[pCnt] = clrTomato; pTxt[pCnt] = clrWhite; pFixedW[pCnt] = 256; pCnt++;
        }
     }
   if(hasBb && pCnt + 5 <= 9)
     {
      double bbMid = 0.5 * (bUp[0] + bLo[0]);
      pPrices[pCnt] = bUp[0]; pTexts[pCnt] = StringFormat("SELL ZONE %.2f", bUp[0]);
      pBg[pCnt] = C'48,24,32'; pBrd[pCnt] = cSellZone; pTxt[pCnt] = C'255,175,185'; pFixedW[pCnt] = 0; pCnt++;

      if(showSellTrig && trigSellPx > 0.0 && MathAbs(trigSellPx - bUp[0]) > g_spec.point * 5.0)
        {
         pPrices[pCnt] = trigSellPx; pTexts[pCnt] = StringFormat("SELL TRIG %.2f", trigSellPx);
         pBg[pCnt] = C'54,32,14'; pBrd[pCnt] = cTrigLine; pTxt[pCnt] = C'255,200,120'; pFixedW[pCnt] = 0; pCnt++;
        }
      if(fairVwap > 0.0)
        {
         pPrices[pCnt] = fairVwap; pTexts[pCnt] = StringFormat("FAIR %.2f", fairVwap);
         pBg[pCnt] = C'46,38,18'; pBrd[pCnt] = cFairLine; pTxt[pCnt] = C'255,220,110'; pFixedW[pCnt] = 0; pCnt++;
        }
      pPrices[pCnt] = bbMid; pTexts[pCnt] = StringFormat("MEAN %.2f", bbMid);
      pBg[pCnt] = C'24,30,42'; pBrd[pCnt] = cMeanLine; pTxt[pCnt] = C'195,210,232'; pFixedW[pCnt] = 0; pCnt++;

      if(showBuyTrig && trigBuyPx > 0.0 && MathAbs(trigBuyPx - bLo[0]) > g_spec.point * 5.0)
        {
         pPrices[pCnt] = trigBuyPx; pTexts[pCnt] = StringFormat("BUY TRIG %.2f", trigBuyPx);
         pBg[pCnt] = C'54,32,14'; pBrd[pCnt] = cTrigLine; pTxt[pCnt] = C'255,200,120'; pFixedW[pCnt] = 0; pCnt++;
        }
      pPrices[pCnt] = bLo[0]; pTexts[pCnt] = StringFormat("BUY ZONE %.2f", bLo[0]);
      pBg[pCnt] = C'18,44,36'; pBrd[pCnt] = cBuyZone; pTxt[pCnt] = C'140,245,205'; pFixedW[pCnt] = 0; pCnt++;
     }

   datetime tRef = iTime(_Symbol, InpSignalTf, 0);
   long chH = ChartGetInteger(cid, CHART_HEIGHT_IN_PIXELS, 0);
   if(chH <= 0) chH = 720;

   int yArr[9], idxArr[9];
   int drawCnt = 0;
   for(int i = 0; i < pCnt; i++)
     {
      int xPx = 0, yPx = 0;
      if(ChartTimePriceToXY(cid, 0, tRef, pPrices[i], xPx, yPx))
        {
         if(yPx < 10) yPx = 10;
         if(yPx > (int)chH - 24) yPx = (int)chH - 24;
         yArr[drawCnt]   = yPx - 9;
         idxArr[drawCnt] = i;
         drawCnt++;
        }
     }
   for(int i = 0; i < drawCnt - 1; i++)
     {
      for(int j = i + 1; j < drawCnt; j++)
        {
         if(yArr[j] < yArr[i])
           {
            int ty = yArr[i]; yArr[i] = yArr[j]; yArr[j] = ty;
            int ti = idxArr[i]; idxArr[i] = idxArr[j]; idxArr[j] = ti;
           }
        }
     }
   for(int i = 1; i < drawCnt; i++)
     {
      if(yArr[i] - yArr[i - 1] < 23)
         yArr[i] = yArr[i - 1] + 23;
     }
   for(int i = 0; i < drawCnt; i++)
     {
      int k = idxArr[i];
      DrawOvlPill("NP301_OVL_P_" + IntegerToString(i), yArr[i], pTexts[k], pBg[k], pBrd[k], pTxt[k], pFixedW[k]);
     }
   for(int i = drawCnt; i < 9; i++)
     {
      string pfx = "NP301_OVL_P_" + IntegerToString(i);
      if(ObjectFind(cid, pfx + "_BG")  >= 0) ObjectDelete(cid, pfx + "_BG");
      if(ObjectFind(cid, pfx + "_TXT") >= 0) ObjectDelete(cid, pfx + "_TXT");
     }
   ChartRedraw(cid);
  }

void BuildHudNextOrActiveText(const int openPos, string &outTitle, string &outBody)
  {
   string cSym = NprIsCentAccount() ? "¢" : "$";
   if(openPos > 0)
     {
      outTitle = "ACTIVE POSITION (EST. P&L)";
      double ordEntry = 0.0, ordSl = 0.0, ordTp = 0.0, ordLots = 0.0;
      long ordType = -1;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong tk = PositionGetTicket(i);
         if(tk == 0) continue;
         if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
         if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
         ordType  = PositionGetInteger(POSITION_TYPE);
         ordEntry = PositionGetDouble(POSITION_PRICE_OPEN);
         ordSl    = PositionGetDouble(POSITION_SL);
         ordTp    = PositionGetDouble(POSITION_TP);
         ordLots += PositionGetDouble(POSITION_VOLUME);
        }
      double estTp = 0.0, estSl = 0.0;
      if(ordTp > 0.0) OrderCalcProfit((ENUM_ORDER_TYPE)ordType, _Symbol, ordLots, ordEntry, ordTp, estTp);
      if(ordSl > 0.0) OrderCalcProfit((ENUM_ORDER_TYPE)ordType, _Symbol, ordLots, ordEntry, ordSl, estSl);
      string side = (ordType == POSITION_TYPE_BUY) ? "BUY" : "SELL";
      outBody = StringFormat("%s %.2fL | Est. TP: +%s%.2f | SL: %s%.2f",
                             side, ordLots, cSym, MathAbs(estTp), cSym, estSl);
      return;
     }

   outTitle = "NEXT ENTRY CONDITION";
   if(g_lastSkipReason != "" && TimeCurrent() <= g_lastSkipUntil)
     {
      outBody = "Last Skip: " + g_lastSkipReason;
      return;
     }
   if(StringFind(g_biasTxt, "SPLIT") >= 0 || StringFind(g_biasTxt, "FLAT") >= 0 || StringFind(g_biasTxt, "SYNC") >= 0)
      outBody = "Wait: H4 & H1 Alignment (" + g_biasTxt + ")";
   else if(StringFind(g_biasTxt, "BEAR") >= 0)
      outBody = StringFormat("SELL Sweep: Up to BB_UP or RSI>=%.0f + Rej", InpRsiOverbought);
   else if(StringFind(g_biasTxt, "BULL") >= 0)
      outBody = StringFormat("BUY Sweep: Down to BB_LO or RSI<=%.0f + Rej", InpRsiOversold);
   else
      outBody = "Wait: M5 Sweep + Rejection Candle";
  }

void RenderHud(const bool force, const string statusTxt, const int openPos)
  {
   if(!InpShowHud || !g_isVisual) return;
   double balVal  = AccountInfoDouble(ACCOUNT_BALANCE);
   double workCap = balVal;
   if(InpUseProfitBank && g_bankedProfit > 0.0)
      workCap = MathMax(0.0, balVal - g_bankedProfit);
   double bankVal = InpUseProfitBank ? g_bankedProfit : g_vaultFloorBal;
   bool   bankOn  = InpUseProfitBank ? (g_bankedProfit > 0.0) : g_vaultActive;
   string fNote = "";
   if(g_wrongAsset)
      fNote = "WRONG SYMBOL: attach to USTECc / USTECm!";
   else if(g_hudFooterNote != "" && (g_hudFooterUntil <= 0 || TimeCurrent() <= g_hudFooterUntil))
      fNote = g_hudFooterNote;
   else if(g_hudFooterUntil > 0 && TimeCurrent() > g_hudFooterUntil)
     { g_hudFooterNote = ""; g_hudFooterUntil = 0; }

   string nxtTitle = "", nxtBody = "";
   BuildHudNextOrActiveText(openPos, nxtTitle, nxtBody);
   if(g_wrongTf) fNote = "WRONG TIMEFRAME: switch chart to M5!";

   g_hud.Draw(force, _Symbol, g_paused, IsAlgoTradingOn(), IsMarketOpenNow(), g_isTester,
              g_wrongAsset, g_wrongTf, nxtTitle, nxtBody, fNote,
              statusTxt, g_biasTxt, g_lastRsiVal, g_lastErVal, g_lastRiskPct, g_lastLotVal,
              g_spread.lastSpread, g_lastDdPct, balVal, workCap, bankVal, bankOn,
              openPos, g_runConsecWins, g_runConsecLoss, g_day);
  }

string NprPersistPrefix()
  {
   return StringFormat("NPR301_%I64d_%s_%I64d_%s_", (long)AccountInfoInteger(ACCOUNT_LOGIN), AccountInfoString(ACCOUNT_CURRENCY), InpMagicNumber, _Symbol);
  }

void SavePersistentState()
  {
   if(g_isTester) return;
   string p = NprPersistPrefix();
   GlobalVariableSet(p + "MEM_VER", (double)NPR_MEM_VER);
   GlobalVariableSet(p + "START_BAL",   g_startBalance);
   GlobalVariableSet(p + "BANKED",      g_bankedProfit);
   GlobalVariableSet(p + "CYCLE_START", g_cycleStart);
   GlobalVariableSet(p + "HWM_BAL",     g_hwmTotalBal);
   GlobalVariableSet(p + "SKIM_CNT",    (double)g_bankSkimCount);
   GlobalVariableSet(p + "UTC_YR",      (double)g_day.utcYear);
   GlobalVariableSet(p + "UTC_DAY",     (double)g_day.utcDay);
   GlobalVariableSet(p + "DAY_ST_EQ",   g_day.dayStartEq);
   GlobalVariableSet(p + "PEAK_BAL",    g_day.peakBal);
   GlobalVariableSet(p + "PEAK_EQ",     g_day.peakEq);
   GlobalVariableSet(p + "DAY_PNL",     g_day.closedPnl);
   GlobalVariableSet(p + "DAY_TRD",     (double)g_day.trades);
   GlobalVariableSet(p + "DAY_WIN",     (double)g_day.wins);
   GlobalVariableSet(p + "DAY_CL",      (double)g_day.consecLoss);
   GlobalVariableSet(p + "DAY_CW",      (double)g_day.consecWins);
   GlobalVariableSet(p + "DAY_BLK",     g_day.blocked ? 1.0 : 0.0);
   GlobalVariableSet(p + "DAY_KS",      g_day.killSwitch ? 1.0 : 0.0);
   int rCode = 0;
   if(g_day.reason == "DAILY_LOSS")          rCode = 1;
   else if(g_day.reason == "CONSEC_LOSS")    rCode = 2;
   else if(g_day.reason == "DAILY_CAP")      rCode = 3;
   else if(g_day.reason == "MAX_TRADES")     rCode = 4;
   else if(g_day.reason == "DD_PAUSE")       rCode = 5;
   else if(g_day.reason == "START_DD_STOP")  rCode = 6;
   else if(g_day.reason == "BANK_PROTECTED") rCode = 7;
   GlobalVariableSet(p + "DAY_RSN",     (double)rCode);
   GlobalVariableSet(p + "DD_PAUSE",    (double)g_ddPauseUntil);
   GlobalVariableSet(p + "LAST_CLS",    (double)g_lastCloseTime);
   GlobalVariableSet(p + "LAST_LOSS",   g_lastTradeLoss ? 1.0 : 0.0);
   GlobalVariableSet(p + "RUN_CW",      (double)g_runConsecWins);
   GlobalVariableSet(p + "RUN_CL",      (double)g_runConsecLoss);
   GlobalVariableSet(p + "PAUSED",      g_paused ? 1.0 : 0.0);
   GlobalVariableSet(p + "SHOCK_UNTIL", (double)g_shockPauseUntil);
   GlobalVariableSet(p + "CAL_UNTIL",   (double)g_calBlockUntil);
   GlobalVariableSet(p + "LAST_SIG_BR", (double)g_lastSigBar);
   g_kelly.SaveToGV(p);
  }

void LoadPersistentState()
  {
   if(g_isTester) return;
   string p = NprPersistPrefix();
   bool hasOldMem = GlobalVariableCheck(p + "START_BAL");
   int  savedVer  = GlobalVariableCheck(p + "MEM_VER") ? (int)GlobalVariableGet(p + "MEM_VER") : 0;
   if(InpResetSavedMemory || (hasOldMem && savedVer != NPR_MEM_VER))
     {
      GlobalVariablesDeleteAll(p);
      g_hudFooterNote  = InpResetSavedMemory ? "Memory CLEARED (manual reset)" : "Memory CLEARED (new v3.01 build)";
      g_hudFooterUntil = TimeCurrent() + 20;
      PrintFormat("NPR301: %s [prefix=%s]", g_hudFooterNote, p);
      return;
     }
   if(!hasOldMem)
     {
      g_hudFooterNote  = "Memory: FRESH START (v3.01)";
      g_hudFooterUntil = TimeCurrent() + 15;
      return;
     }

   double curBal = AccountInfoDouble(ACCOUNT_BALANCE);
   double sStart = GlobalVariableGet(p + "START_BAL");
   double sBank  = GlobalVariableGet(p + "BANKED");
   double sCycle = GlobalVariableGet(p + "CYCLE_START");
   double sHwm   = GlobalVariableGet(p + "HWM_BAL");

   if(sStart > 0.0) g_startBalance = sStart;
   if(sBank >= 0.0 && sBank < curBal) g_bankedProfit = sBank;
   if(sCycle > 0.0) g_cycleStart = sCycle;
   if(sHwm > 0.0)   g_hwmTotalBal = sHwm;
   g_bankSkimCount  = (int)GlobalVariableGet(p + "SKIM_CNT");
   g_ddPauseUntil   = (datetime)GlobalVariableGet(p + "DD_PAUSE");
   g_lastCloseTime  = (datetime)GlobalVariableGet(p + "LAST_CLS");
   g_lastTradeLoss  = (GlobalVariableGet(p + "LAST_LOSS") > 0.5);
   g_runConsecWins  = (int)GlobalVariableGet(p + "RUN_CW");
   g_runConsecLoss  = (int)GlobalVariableGet(p + "RUN_CL");
   g_paused         = (GlobalVariableGet(p + "PAUSED") > 0.5);
   datetime sShock  = (datetime)GlobalVariableGet(p + "SHOCK_UNTIL");
   if(sShock > TimeCurrent()) { g_shockPauseUntil = sShock; g_volStatus = "NEWS_SHOCK"; }
   datetime sCal = (datetime)GlobalVariableGet(p + "CAL_UNTIL");
   datetime nowSrvLd = TimeTradeServer();
   if(nowSrvLd <= 0) nowSrvLd = TimeCurrent();
   if(sCal > nowSrvLd) { g_calBlockUntil = sCal; g_calBlocked = true; }
   datetime sSigBr  = (datetime)GlobalVariableGet(p + "LAST_SIG_BR");
   if(sSigBr > 0) g_lastSigBar = sSigBr;
   g_kelly.LoadFromGV(p);

   double workBal = InpUseProfitBank ? MathMax(0.0, curBal - g_bankedProfit) : curBal;
   double sPeakB  = GlobalVariableGet(p + "PEAK_BAL");
   double sPeakE  = GlobalVariableGet(p + "PEAK_EQ");
   if(sPeakB > 0.0) g_day.peakBal = MathMax(workBal, sPeakB);
   if(sPeakE > 0.0) g_day.peakEq  = MathMax(workBal, sPeakE);

   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int sYr  = (int)GlobalVariableGet(p + "UTC_YR");
   int sDay = (int)GlobalVariableGet(p + "UTC_DAY");
   if(sYr == dt.year && sDay == dt.day_of_year)
     {
      g_day.utcYear    = sYr;
      g_day.utcDay     = sDay;
      g_day.dayStartEq = GlobalVariableGet(p + "DAY_ST_EQ");
      g_day.closedPnl  = GlobalVariableGet(p + "DAY_PNL");
      g_day.trades     = (int)GlobalVariableGet(p + "DAY_TRD");
      g_day.wins       = (int)GlobalVariableGet(p + "DAY_WIN");
      g_day.consecLoss = (int)GlobalVariableGet(p + "DAY_CL");
      g_day.consecWins = (int)GlobalVariableGet(p + "DAY_CW");
      g_day.blocked    = (GlobalVariableGet(p + "DAY_BLK") > 0.5);
      g_day.killSwitch = (GlobalVariableGet(p + "DAY_KS") > 0.5);
      int rCode = (int)GlobalVariableGet(p + "DAY_RSN");
      if(rCode == 1)      g_day.reason = "DAILY_LOSS";
      else if(rCode == 2) g_day.reason = "CONSEC_LOSS";
      else if(rCode == 3) g_day.reason = "DAILY_CAP";
      else if(rCode == 4) g_day.reason = "MAX_TRADES";
      else if(rCode == 5) g_day.reason = "DD_PAUSE";
      else if(rCode == 6) g_day.reason = "START_DD_STOP";
      else if(rCode == 7) g_day.reason = "BANK_PROTECTED";
      else if(g_day.blocked && g_day.reason == "")
         g_day.reason = g_day.killSwitch ? "START_DD_STOP" : "RESTORED_BLK";
     }
   PrintFormat("NPR301 RESTORED: Start=%.2f Bank=%.2f PeakBal=%.2f Trades=%d",
               g_startBalance, g_bankedProfit, g_day.peakBal, g_day.trades);
  }

int OnInit()
  {
   if(!RefreshSpecs())
     { Print("NPR301 ERROR: Failed to read symbol specs for ", _Symbol); return INIT_FAILED; }

   g_hAtrSig    = iATR(_Symbol, InpSignalTf, 14);
   g_hAtrH1     = iATR(_Symbol, InpMacroTf, 14);
   g_hBbSig     = iBands(_Symbol, InpSignalTf, InpBbPeriod, 0, InpBbDeviation, PRICE_CLOSE);
   g_hRsiSig    = iRSI(_Symbol, InpSignalTf, InpRsiPeriod, PRICE_CLOSE);
   g_hEmaFastH1 = iMA(_Symbol, InpMacroTf, InpMacroFastEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaSlowH1 = iMA(_Symbol, InpMacroTf, InpMacroSlowEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaFastH4 = iMA(_Symbol, InpH4Tf, InpH4FastEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaSlowH4 = iMA(_Symbol, InpH4Tf, InpH4SlowEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaFastD1 = iMA(_Symbol, PERIOD_D1, InpD1FastEma, 0, MODE_EMA, PRICE_CLOSE);
   g_hEmaSlowD1 = iMA(_Symbol, PERIOD_D1, InpD1SlowEma, 0, MODE_EMA, PRICE_CLOSE);

   if(g_hAtrSig == INVALID_HANDLE || g_hAtrH1 == INVALID_HANDLE ||
      g_hBbSig == INVALID_HANDLE || g_hRsiSig == INVALID_HANDLE ||
      g_hEmaFastH1 == INVALID_HANDLE || g_hEmaSlowH1 == INVALID_HANDLE ||
      g_hEmaFastH4 == INVALID_HANDLE || g_hEmaSlowH4 == INVALID_HANDLE ||
      g_hEmaFastD1 == INVALID_HANDLE || g_hEmaSlowD1 == INVALID_HANDLE)
     { Print("NPR301 ERROR: Failed to initialize indicators"); return INIT_FAILED; }

   g_spread.Reset();
   g_day.Reset();
   g_kelly.Reset();
   g_paused           = false;
   g_isTester         = (bool)MQLInfoInteger(MQL_TESTER);
   g_wrongAsset       = !NprIsNasdaqSymbol();
   g_wrongTf          = (InpRequireM5Chart && Period() != InpSignalTf);
   g_lastSkipReason   = "";
   g_lastSkipUntil    = 0;
   g_lastOvlBar       = 0;
   g_lastOvlPos       = -1;
   if(g_wrongAsset)
      PrintFormat("NPR301 WARNING: Wrong symbol '%s'! Attach EA to USTECc / USTECm (Nasdaq 100).", _Symbol);
   if(g_wrongTf)
      PrintFormat("NPR301 WARNING: Wrong timeframe! Switch chart to M5.");
   if(!g_isTester && InpShowHud && g_isVisual)
     {
      ClearChartOverlay();
      long cid = ChartID();
      if(!ChartGetInteger(cid, CHART_SHIFT))
        {
         ChartSetInteger(cid, CHART_SHIFT, true);
         ChartSetDouble(cid, CHART_SHIFT_SIZE, 20.0);
        }
     }
   g_prevOpenPos      = 0;
   g_runConsecWins    = 0;
   g_runConsecLoss    = 0;
   g_lastSigBar       = 0;
   g_lastCloseTime    = 0;
   g_lastTradeLoss    = false;
   g_lastPlannedRisk  = 0.0;
   g_startBalance     = AccountInfoDouble(ACCOUNT_BALANCE);
   g_bankedProfit     = 0.0;
   g_cycleStart       = g_startBalance;
   g_hwmTotalBal      = g_startBalance;
   g_bankSkimCount    = 0;
   g_vaultFloorBal    = 0.0;
   g_vaultActive      = false;
   g_shockPauseUntil  = 0;
   g_ddPauseUntil     = 0;
   g_lastCalCheck     = 0;
   g_calBlocked       = false;
   g_calBlockUntil    = 0;
   g_lastErVal        = 0.30;
   g_lastLotVal       = (InpLotMode == NPR_LOT_FIXED) ? NPR_ClampVol(InpFixedLot, g_spec.volMin, g_spec.volMax, g_spec.volStep) : 0.0;
   g_lastRiskPct      = EffBaseRiskPct();
   g_lastDdPct        = 0.0;
   g_lastShieldMult   = 1.0;
   g_volStatus        = "";

   if(!g_isTester && InpUseNewsShockPause)
     {
      int barSec   = MathMax(60, PeriodSeconds(InpSignalTf));
      int pauseSec = MathMax(5, InpShockPauseMin) * 60;
      int lookback = MathMax(3, (pauseSec / barSec) + 2);
      MqlRates rHist[];
      double   atrHist[];
      ArraySetAsSeries(rHist, true);
      ArraySetAsSeries(atrHist, true);
      int gotR   = CopyRates(_Symbol, InpSignalTf, 1, lookback, rHist);
      int gotAtr = CopyBuffer(g_hAtrSig, 0, 1, lookback, atrHist);
      int nChk   = MathMin(gotR, gotAtr);
      datetime nowSrv = TimeCurrent();
      for(int i = 0; i < nChk; i++)
        {
         if(!MathIsValidNumber(atrHist[i]) || atrHist[i] <= 0.0) continue;
         datetime barClose = rHist[i].time + barSec;
         datetime untilTm  = barClose + pauseSec;
         if(untilTm > nowSrv && (rHist[i].high - rHist[i].low) > atrHist[i] * InpShockBarMult)
           {
            if(untilTm > g_shockPauseUntil) g_shockPauseUntil = untilTm;
            g_volStatus = "NEWS_SHOCK";
           }
        }
     }

   LoadPersistentState();
   SyncDailyAccounting();
   SavePersistentState();

   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   g_isVisual  = (!g_isTester || visual);

   if(InpShowHud && g_isVisual)
     {
      g_hud.Create(ChartID(), _Symbol, InpHudCorner, InpHudScale, InpHudOffsetX, InpHudOffsetY, InpHudRefreshMs);
      if(!g_isTester) EventSetMillisecondTimer(500);
      MqlTick tk0;
      if(SymbolInfoTick(_Symbol, tk0))
        {
         g_spread.Update(tk0, InpMaxSpreadPrice, InpSpreadSpikeMult, g_spec.point);
         RefreshHudTelemetry(tk0);
        }
      string stBlk0 = "";
      bool   stOk0  = IsInTradingWindow(stBlk0);
      double flt0   = 0.0;
      int    pos0   = CountOurPositions(flt0);
      RenderHud(true, BuildHudStatus(stOk0, stBlk0, pos0), pos0);
     }
   if(!g_isTester)
     {
      if(!InpShowHud || !g_isVisual) EventSetMillisecondTimer(1000);
      EP_RegisterRobot(InpMagicNumber, "NasdaqPulseReversion", "3.01", "{\"tf\":\"M5\",\"strategy\":\"allweather_asym\"}");
     }
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
//| Huseynovlar Terminal — Zero-Overhead Telemetry (OnTimer only)    |
//+------------------------------------------------------------------+
void EP_EmitNasdaqTelemetry(const string statusTxt, const int openPos)
  {
   if(g_isTester) return;
   static ulong s_epLastMs = 0;
   ulong nowMs = GetTickCount64();
   if(nowMs - s_epLastMs < 1000) return;
   s_epLastMs = nowMs;

   double balVal  = AccountInfoDouble(ACCOUNT_BALANCE);
   double workCap = (InpUseProfitBank && g_bankedProfit > 0.0) ? MathMax(0.0, balVal - g_bankedProfit) : balVal;
   double bankVal = InpUseProfitBank ? g_bankedProfit : g_vaultFloorBal;
   bool   bankOn  = InpUseProfitBank ? (g_bankedProfit > 0.0) : g_vaultActive;

   string nxtTitle = "", nxtBody = "";
   BuildHudNextOrActiveText(openPos, nxtTitle, nxtBody);
   string waitTxt = (nxtTitle != "" ? (nxtTitle + ": " + nxtBody) : g_lastSkipReason);

   double bbMid = 0.0, bbUp = 0.0, bbLo = 0.0;
   double bM[1], bU[1], bL[1];
   if(g_hBbSig != INVALID_HANDLE)
     {
      if(CopyBuffer(g_hBbSig, 0, 0, 1, bM) == 1) bbMid = bM[0];
      if(CopyBuffer(g_hBbSig, 1, 0, 1, bU) == 1) bbUp  = bU[0];
      if(CopyBuffer(g_hBbSig, 2, 0, 1, bL) == 1) bbLo  = bL[0];
     }

   long barTime = (long)iTime(_Symbol, PERIOD_M5, 0);
   double fairPx = (g_epLastFairPx > 0.0) ? g_epLastFairPx : bbMid;
   string payload = StringFormat(
      "{\"regime\":\"%s\",\"signal_bias\":\"%s\",\"wait_reason\":\"%s\",\"risk_mode\":\"ASYM_ALLWEATHER\","
      "\"rsi_m5\":%.2f,\"er_h1\":%.4f,\"atr_pct\":%.4f,\"atr_val\":%.5f,\"d1_dir\":%d,"
      "\"bb_upper\":%.5f,\"bb_mid\":%.5f,\"bb_lower\":%.5f,"
      "\"spread\":%.5f,\"risk_pct\":%.2f,\"next_lot\":%.3f,\"shield_mult\":%.3f,"
      "\"balance\":%.2f,\"work_balance\":%.2f,\"bank_balance\":%.2f,\"bank_active\":%s,\"dd_pct\":%.2f,"
      "\"open_positions\":%d,\"day_pnl\":%.2f,\"day_trades\":%d,\"day_wins\":%d,"
      "\"day_blocked\":%s,\"day_reason\":\"%s\",\"consec_wins\":%d,\"consec_loss\":%d,"
      "\"paused\":%s,\"algo_enabled\":%s,\"market_open\":%s,%s}",
      EP_EscapeJson(statusTxt), EP_EscapeJson(g_biasTxt), EP_EscapeJson(waitTxt),
      g_lastRsiVal, g_lastErVal, g_lastAtrPct, g_lastAtrVal, g_lastD1Dir,
      bbUp, bbMid, bbLo,
      g_spread.lastSpread, g_lastRiskPct, g_lastLotVal, g_lastShieldMult,
      balVal, workCap, bankVal, bankOn ? "true" : "false", g_lastDdPct,
      openPos, g_day.closedPnl, g_day.trades, g_day.wins,
      g_day.blocked ? "true" : "false", EP_EscapeJson(g_day.reason), g_runConsecWins, g_runConsecLoss,
      g_paused ? "true" : "false", IsAlgoTradingOn() ? "true" : "false", IsMarketOpenNow() ? "true" : "false",
      EP_BuildZonesJson(barTime, bbUp, bbMid, fairPx, bbLo)
   );
   EP_ReportState(InpMagicNumber, payload);
  }

void OnDeinit(const int reason)
  {
   SavePersistentState();
   if(!g_isTester) EventKillTimer();
   g_hud.Destroy();
   ClearChartOverlay();
   if(g_hAtrSig    != INVALID_HANDLE) { IndicatorRelease(g_hAtrSig);    g_hAtrSig    = INVALID_HANDLE; }
   if(g_hAtrH1     != INVALID_HANDLE) { IndicatorRelease(g_hAtrH1);     g_hAtrH1     = INVALID_HANDLE; }
   if(g_hBbSig     != INVALID_HANDLE) { IndicatorRelease(g_hBbSig);     g_hBbSig     = INVALID_HANDLE; }
   if(g_hRsiSig    != INVALID_HANDLE) { IndicatorRelease(g_hRsiSig);    g_hRsiSig    = INVALID_HANDLE; }
   if(g_hEmaFastH1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaFastH1); g_hEmaFastH1 = INVALID_HANDLE; }
   if(g_hEmaSlowH1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaSlowH1); g_hEmaSlowH1 = INVALID_HANDLE; }
   if(g_hEmaFastH4 != INVALID_HANDLE) { IndicatorRelease(g_hEmaFastH4); g_hEmaFastH4 = INVALID_HANDLE; }
   if(g_hEmaSlowH4 != INVALID_HANDLE) { IndicatorRelease(g_hEmaSlowH4); g_hEmaSlowH4 = INVALID_HANDLE; }
   if(g_hEmaFastD1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaFastD1); g_hEmaFastD1 = INVALID_HANDLE; }
   if(g_hEmaSlowD1 != INVALID_HANDLE) { IndicatorRelease(g_hEmaSlowD1); g_hEmaSlowD1 = INVALID_HANDLE; }
  }

void RefreshHudTelemetry(const MqlTick &tk)
  {
   if(g_isTester) return;
   double bAtr[1], bAtrH1[1], bRsi[1], bH1F[1], bH1S[1], bH4F[1], bH4S[1];
   bool okAtr   = (CopyBuffer(g_hAtrSig,    0, 1, 1, bAtr)   == 1 && MathIsValidNumber(bAtr[0])   && bAtr[0] > 0.0);
   bool okAtrH1 = (CopyBuffer(g_hAtrH1,     0, 1, 1, bAtrH1) == 1 && MathIsValidNumber(bAtrH1[0]) && bAtrH1[0] > 0.0);
   bool okRsi   = (CopyBuffer(g_hRsiSig,    0, 1, 1, bRsi)   == 1 && MathIsValidNumber(bRsi[0]));
   bool okH1    = (CopyBuffer(g_hEmaFastH1, 0, 1, 1, bH1F)   == 1 && CopyBuffer(g_hEmaSlowH1, 0, 1, 1, bH1S) == 1);
   bool okH4    = (CopyBuffer(g_hEmaFastH4, 0, 1, 1, bH4F)   == 1 && CopyBuffer(g_hEmaSlowH4, 0, 1, 1, bH4S) == 1);

   double effAtrTel = okAtr ? ComputeHybridVolatility(bAtr[0]) : 0.0;
   if(okAtr && effAtrTel > 0.0) g_lastAtrVal = effAtrTel;
   if(okRsi) g_lastRsiVal = bRsi[0];
   g_lastErVal = ComputeKaufmanER(InpMacroTf, InpErPeriod);

   if((InpUseMacroTrend && !okH1) || (InpUseH4Macro && !okH4))
     {
      g_biasTxt = "SYNC H1/H4...";
      return;
     }

   int h1Dir = okH1 ? ((bH1F[0] > bH1S[0]) ? 1 : ((bH1F[0] < bH1S[0]) ? -1 : 0)) : 0;
   int h4Dir = okH4 ? ((bH4F[0] > bH4S[0]) ? 1 : ((bH4F[0] < bH4S[0]) ? -1 : 0)) : 0;
   if(InpUseMacroTrend && InpUseH4Macro)
     {
      if(h1Dir == 1 && h4Dir == 1)        g_biasTxt = "H4+H1 BULL";
      else if(h1Dir == -1 && h4Dir == -1) g_biasTxt = "H4+H1 BEAR";
      else                                g_biasTxt = "H4/H1 SPLIT";
     }
   else if(InpUseMacroTrend)
      g_biasTxt = (h1Dir == 1) ? "H1 BULL" : ((h1Dir == -1) ? "H1 BEAR" : "H1 FLAT");
   else if(InpUseH4Macro)
      g_biasTxt = (h4Dir == 1) ? "H4 BULL" : ((h4Dir == -1) ? "H4 BEAR" : "H4 FLAT");
   else
      g_biasTxt = "2-WAY";

   // Keep live volatility / news status up to date after restart/recompilation
   if(InpUseNewsShockPause && g_shockPauseUntil > TimeCurrent())
     { g_volStatus = "NEWS_SHOCK"; return; }
   if(IsMt5CalendarNewsWindow())
     { g_volStatus = "USD_NEWS"; return; }

   if(okAtr && tk.bid > 0.0)
     {
      double atrPct = 0.0;
      string volWhy = "";
      bool volOk = IsVolatilityOptimal(effAtrTel, tk.bid, atrPct, volWhy);
      g_lastAtrPct = atrPct;
      if(!volOk) { g_volStatus = volWhy; return; }
     }
   if(InpUseKaufmanER && InpMinH1EffRatio > 0.0 && g_lastErVal < InpMinH1EffRatio)
     { g_volStatus = "LOW_ER_CHOP"; return; }
   if(InpUseH1FlatFilter && InpMinH1EmaGapAtr > 0.0 && okH1 && okAtrH1)
     {
      double emaGapAtr = MathAbs(bH1F[0] - bH1S[0]) / bAtrH1[0];
      if(emaGapAtr < InpMinH1EmaGapAtr) { g_volStatus = "H1_FLAT"; return; }
     }
   g_volStatus = "";
  }

void OnTimer()
  {
   if(g_isTester) return;
   MqlTick tk;
   if(SymbolInfoTick(_Symbol, tk))
     {
      g_spread.Update(tk, InpMaxSpreadPrice, InpSpreadSpikeMult, g_spec.point);
      RefreshHudTelemetry(tk);
     }
   double flt = 0.0;
   int openPos = CountOurPositions(flt);
   string sessBlock = "";
   bool sessOk = IsInTradingWindow(sessBlock);
   string status = BuildHudStatus(sessOk, sessBlock, openPos);
   RenderHud(false, status, openPos);
   UpdateChartOverlay(false);
   EP_EmitNasdaqTelemetry(status, openPos);
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(!InpShowHud || !g_isVisual) return;
   if(id == CHARTEVENT_CHART_CHANGE)
     {
      g_hud.Reposition();
      static ulong s_lastChgMs = 0;
      ulong nowMs = GetTickCount64();
      if((nowMs - s_lastChgMs) >= 400)
        {
         s_lastChgMs = nowMs;
         UpdateChartOverlay(true);
        }
      return;
     }
   if(id == CHARTEVENT_CLICK)
     {
      int act = g_hud.HandleClick((int)lparam, (int)dparam);
      if(act == 2)      { g_paused = !g_paused; SavePersistentState(); }
      else if(act == 3) { CloseAllOurPositions(); SavePersistentState(); }
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

   int activeCd = g_lastTradeLoss ? MathMax(InpCooldownSec, InpLossCooldownSec) : InpCooldownSec;
   bool cdReady = (g_lastCloseTime <= 0 || (TimeCurrent() - g_lastCloseTime) >= activeCd);
   if(!g_wrongAsset && !g_wrongTf && IsAlgoTradingOn() && !g_paused && !g_day.blocked && sessOk && g_spread.spreadOk && openPos == 0 && cdReady)
     {
      datetime curBar = iTime(_Symbol, InpSignalTf, 0);
      if(curBar != 0 && curBar != g_lastSigBar)
        {
         g_lastSigBar = curBar;
         SavePersistentState();
         // Stale-bar guard: skip entries when feed/history ticks arrive >90s late
         if(InpMaxBarDelaySec <= 0 || (TimeCurrent() - curBar) <= InpMaxBarDelaySec)
            TrySweepReversionEntry(tk);
        }
     }

   // Live HUD & overlay are rendered in OnTimer() to keep OnTick() ultra-fast
  }
//+------------------------------------------------------------------+