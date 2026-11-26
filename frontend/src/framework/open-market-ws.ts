export interface OpenWsMapping {
  streamSym: string;
  label: string;
  isProxy?: boolean;
}

/**
 * Maps terminal asset symbols to free, unauthenticated, real-time public WebSocket streams.
 * Zero API keys required, zero polling.
 */
export function mapSymbolToOpenWs(rawSymbol: string): OpenWsMapping | null {
  const s = rawSymbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");

  if (s === "BTCUSD" || s === "BTCUSDT" || s === "BTC") return { streamSym: "btcusdt", label: "Binance BTC/USDT" };
  if (s === "ETHUSD" || s === "ETHUSDT" || s === "ETH") return { streamSym: "ethusdt", label: "Binance ETH/USDT" };
  if (s === "SOLUSD" || s === "SOLUSDT" || s === "SOL") return { streamSym: "solusdt", label: "Binance SOL/USDT" };
  if (s === "BNBUSD" || s === "BNBUSDT" || s === "BNB") return { streamSym: "bnbusdt", label: "Binance BNB/USDT" };
  if (s === "XRPUSD" || s === "XRPUSDT" || s === "XRP") return { streamSym: "xrpusdt", label: "Binance XRP/USDT" };
  if (s === "XAUUSD" || s === "XAU" || s === "GOLD") {
    return { streamSym: "paxgusdt", label: "PAXG/USDT (Spot Gold WS)", isProxy: true };
  }
  if (s === "EURUSD") return { streamSym: "eurusdt", label: "EUR/USDT Live WS" };
  if (s === "GBPUSD") return { streamSym: "gbpusdt", label: "GBP/USDT Live WS" };
  if (s === "AUDUSD") return { streamSym: "audusdt", label: "AUD/USDT Live WS" };
  return null;
}

export function normalizeCleanSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");
}
