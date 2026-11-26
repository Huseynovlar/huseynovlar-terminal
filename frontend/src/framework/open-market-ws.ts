export type OpenWsProvider = "binance" | "deriv";

export interface OpenWsMapping {
  provider: OpenWsProvider;
  streamSym: string;
  label: string;
}

export function normalizeCleanSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");
}

const BINANCE_CRYPTO_MAP: Record<string, { sym: string; label: string }> = {
  BTCUSD: { sym: "btcusdt", label: "Binance BTC/USDT WS" },
  BTCUSDT: { sym: "btcusdt", label: "Binance BTC/USDT WS" },
  BTC: { sym: "btcusdt", label: "Binance BTC/USDT WS" },
  ETHUSD: { sym: "ethusdt", label: "Binance ETH/USDT WS" },
  ETHUSDT: { sym: "ethusdt", label: "Binance ETH/USDT WS" },
  ETH: { sym: "ethusdt", label: "Binance ETH/USDT WS" },
  SOLUSD: { sym: "solusdt", label: "Binance SOL/USDT WS" },
  SOLUSDT: { sym: "solusdt", label: "Binance SOL/USDT WS" },
  SOL: { sym: "solusdt", label: "Binance SOL/USDT WS" },
  BNBUSD: { sym: "bnbusdt", label: "Binance BNB/USDT WS" },
  BNBUSDT: { sym: "bnbusdt", label: "Binance BNB/USDT WS" },
  BNB: { sym: "bnbusdt", label: "Binance BNB/USDT WS" },
  XRPUSD: { sym: "xrpusdt", label: "Binance XRP/USDT WS" },
  XRPUSDT: { sym: "xrpusdt", label: "Binance XRP/USDT WS" },
  XRP: { sym: "xrpusdt", label: "Binance XRP/USDT WS" },
  ADAUSD: { sym: "adausdt", label: "Binance ADA/USDT WS" },
  ADA: { sym: "adausdt", label: "Binance ADA/USDT WS" },
  DOGEUSD: { sym: "dogeusdt", label: "Binance DOGE/USDT WS" },
  DOGE: { sym: "dogeusdt", label: "Binance DOGE/USDT WS" },
  TONUSD: { sym: "tonusdt", label: "Binance TON/USDT WS" },
  TON: { sym: "tonusdt", label: "Binance TON/USDT WS" },
  LTCUSD: { sym: "ltcusdt", label: "Binance LTC/USDT WS" },
  LTC: { sym: "ltcusdt", label: "Binance LTC/USDT WS" },
};

const DERIV_FX_METALS_INDICES_MAP: Record<string, { sym: string; label: string }> = {
  XAUUSD: { sym: "frxXAUUSD", label: "Deriv Spot Gold (XAU/USD) WS" },
  XAU: { sym: "frxXAUUSD", label: "Deriv Spot Gold (XAU/USD) WS" },
  GOLD: { sym: "frxXAUUSD", label: "Deriv Spot Gold (XAU/USD) WS" },
  XAGUSD: { sym: "frxXAGUSD", label: "Deriv Spot Silver (XAG/USD) WS" },
  XAG: { sym: "frxXAGUSD", label: "Deriv Spot Silver (XAG/USD) WS" },
  SILVER: { sym: "frxXAGUSD", label: "Deriv Spot Silver (XAG/USD) WS" },
  USTEC: { sym: "OTC_NDX", label: "Deriv US Tech 100 (NDX) WS" },
  NAS100: { sym: "OTC_NDX", label: "Deriv US Tech 100 (NDX) WS" },
  NDX: { sym: "OTC_NDX", label: "Deriv US Tech 100 (NDX) WS" },
  US500: { sym: "OTC_SPC", label: "Deriv S&P 500 (SPX) WS" },
  SPX: { sym: "OTC_SPC", label: "Deriv S&P 500 (SPX) WS" },
  US30: { sym: "OTC_DJI", label: "Deriv Wall St 30 (DJI) WS" },
  DJI: { sym: "OTC_DJI", label: "Deriv Wall St 30 (DJI) WS" },
  EURUSD: { sym: "frxEURUSD", label: "Deriv EUR/USD Spot WS" },
  GBPUSD: { sym: "frxGBPUSD", label: "Deriv GBP/USD Spot WS" },
  USDJPY: { sym: "frxUSDJPY", label: "Deriv USD/JPY Spot WS" },
  USDCHF: { sym: "frxUSDCHF", label: "Deriv USD/CHF Spot WS" },
  USDCAD: { sym: "frxUSDCAD", label: "Deriv USD/CAD Spot WS" },
  AUDUSD: { sym: "frxAUDUSD", label: "Deriv AUD/USD Spot WS" },
  NZDUSD: { sym: "frxNZDUSD", label: "Deriv NZD/USD Spot WS" },
  EURGBP: { sym: "frxEURGBP", label: "Deriv EUR/GBP Spot WS" },
  EURJPY: { sym: "frxEURJPY", label: "Deriv EUR/JPY Spot WS" },
  GBPJPY: { sym: "frxGBPJPY", label: "Deriv GBP/JPY Spot WS" },
  AUDJPY: { sym: "frxAUDJPY", label: "Deriv AUD/JPY Spot WS" },
  EURAUD: { sym: "frxEURAUD", label: "Deriv EUR/AUD Spot WS" },
  EURCHF: { sym: "frxEURCHF", label: "Deriv EUR/CHF Spot WS" },
};

/**
 * Routes any terminal symbol to a free, unauthenticated, real-time public WebSocket:
 * - Crypto -> Binance Spot WS (L2 depth10@100ms + bookTicker + aggTrade)
 * - Forex / Gold (XAUUSD) / Silver (XAGUSD) / Indices (USTEC, US500, US30) -> Deriv Public WS (app_id=1089)
 */
export function mapSymbolToOpenWs(rawSymbol: string): OpenWsMapping | null {
  const s = normalizeCleanSymbol(rawSymbol);
  const crypto = BINANCE_CRYPTO_MAP[s];
  if (crypto) {
    return { provider: "binance", streamSym: crypto.sym, label: crypto.label };
  }
  const fx = DERIV_FX_METALS_INDICES_MAP[s];
  if (fx) {
    return { provider: "deriv", streamSym: fx.sym, label: fx.label };
  }
  return null;
}

export const DERIV_PUBLIC_WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";
