const KNOWN_BASES = new Set([
  "XAUUSD",
  "GOLD",
  "XAU",
  "XAGUSD",
  "SILVER",
  "XAG",
  "USTEC",
  "NAS100",
  "US100",
  "NDX",
  "US500",
  "SPX",
  "US30",
  "DJI",
  "DE40",
  "UK100",
  "JP225",
  "USOIL",
  "WTI",
  "UKOIL",
  "NGAS",
  "DXY",
  "VIX",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
  "AUDUSD",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "EURAUD",
  "EURCHF",
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "BNBUSD",
  "XRPUSD",
  "ADAUSD",
  "DOGEUSD",
  "TONUSD",
  "LTCUSD",
]);

const CANONICAL_ALIASES: Record<string, string> = {
  XAU: "XAUUSD",
  GOLD: "XAUUSD",
  XAUUSD: "XAUUSD",
  XAG: "XAGUSD",
  SILVER: "XAGUSD",
  XAGUSD: "XAGUSD",
  USTEC: "USTEC",
  NAS100: "USTEC",
  US100: "USTEC",
  NDX: "USTEC",
  NASDAQ: "USTEC",
  US500: "US500",
  SPX: "US500",
  SP500: "US500",
  US30: "US30",
  DJI: "US30",
  DJ30: "US30",
  WTI: "USOIL",
  XTIUSD: "USOIL",
  BRENT: "UKOIL",
  XBRUSD: "UKOIL",
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

export function normalizeCleanSymbol(raw: string): string {
  let trimmed = raw.trim();
  if (!trimmed) return "";
  // Strip explicit lowercase broker account suffix (e.g. XAUUSDc, USTECm, AAPLm)
  if (trimmed.length >= 5 && /[mcz]$/.test(trimmed) && /[A-Z0-9]$/.test(trimmed.slice(0, -1))) {
    trimmed = trimmed.slice(0, -1);
  }
  let up = trimmed
    .toUpperCase()
    .replace(/(\.[A-Z0-9]{1,4}|_[A-Z0-9]{1,3}|#+|=X)$/g, "")
    .replace(/[^A-Z0-9]/g, "");

  for (const suf of ["MICRO", "ZERO", "CENT", "PRO", "RAW", "ECN"]) {
    if (up.endsWith(suf) && up.length - suf.length >= 3) {
      up = up.slice(0, -suf.length);
      break;
    }
  }

  if (up.length >= 4 && /[CMZ]$/.test(up)) {
    const stem = up.slice(0, -1);
    if (stem.length >= 6 || KNOWN_BASES.has(stem)) {
      up = stem;
    }
  }
  return up;
}

/**
 * Maps broker/UI symbol aliases (e.g. XAUUSDc, XAUUSDm, GOLD, BTCUSDT, USTECm, NAS100) to the
 * canonical symbol broadcast by the server-side Market WS Hub over /api/v1/ws/live.
 */
export function canonicalMarketSymbol(raw: string): string {
  const norm = normalizeCleanSymbol(raw);
  return CANONICAL_ALIASES[norm] ?? norm;
}
