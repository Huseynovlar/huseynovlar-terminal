export function normalizeCleanSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");
}

const CANONICAL_ALIASES: Record<string, string> = {
  XAU: "XAUUSD",
  GOLD: "XAUUSD",
  XAUUSD: "XAUUSD",
  XAG: "XAGUSD",
  SILVER: "XAGUSD",
  XAGUSD: "XAGUSD",
  USTEC: "USTEC",
  NAS100: "USTEC",
  NDX: "USTEC",
  US500: "US500",
  SPX: "US500",
  US30: "US30",
  DJI: "US30",
  BTC: "BTCUSD",
  BTCUSDT: "BTCUSD",
  BTCUSD: "BTCUSD",
  ETH: "ETHUSD",
  ETHUSDT: "ETHUSD",
  ETHUSD: "ETHUSD",
  SOL: "SOLUSD",
  SOLUSDT: "SOLUSD",
  SOLUSD: "SOLUSD",
  BNB: "BNBUSD",
  BNBUSDT: "BNBUSD",
  BNBUSD: "BNBUSD",
  XRP: "XRPUSD",
  XRPUSDT: "XRPUSD",
  XRPUSD: "XRPUSD",
  ADA: "ADAUSD",
  ADAUSDT: "ADAUSD",
  ADAUSD: "ADAUSD",
  DOGE: "DOGEUSD",
  DOGEUSDT: "DOGEUSD",
  DOGEUSD: "DOGEUSD",
  TON: "TONUSD",
  TONUSDT: "TONUSD",
  TONUSD: "TONUSD",
  LTC: "LTCUSD",
  LTCUSDT: "LTCUSD",
  LTCUSD: "LTCUSD",
};

/**
 * Maps broker/UI symbol aliases (e.g. XAUUSDm, GOLD, BTCUSDT, NAS100) to the
 * canonical symbol broadcast by the server-side Market WS Hub over /api/v1/ws/live.
 */
export function canonicalMarketSymbol(raw: string): string {
  const norm = normalizeCleanSymbol(raw);
  return CANONICAL_ALIASES[norm] ?? norm;
}
