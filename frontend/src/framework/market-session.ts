export interface MarketSessionStatus {
  isOpen: boolean;
  label: string;
  detail: string;
  tone: "live" | "extended" | "closed";
}

const CRYPTO_HINTS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "ADA",
  "DOGE",
  "TON",
  "LTC",
  "AVAX",
  "LINK",
  "DOT",
  "MATIC",
  "PAXG",
]);

/**
 * Pure UTC trading-session status evaluator (zero network calls).
 * Tells the trader immediately when a market is closed (weekend / off-hours / pre/post-market)
 * so they know why live ticks are paused.
 */
export function getMarketSessionStatus(
  assetClassRaw: string | null | undefined,
  symbolRaw: string | null | undefined,
  now: Date = new Date(),
): MarketSessionStatus {
  const sym = (symbolRaw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const cls = (assetClassRaw ?? "").trim().toUpperCase();

  // 1. Crypto trades 24/7/365
  const isCrypto =
    cls.includes("CRYPTO") ||
    Array.from(CRYPTO_HINTS).some((c) => sym === c || sym === `${c}USD` || sym === `${c}USDT`);
  if (isCrypto) {
    return { isOpen: true, label: "24/7", detail: "Крипторынок открыт круглосуточно", tone: "live" };
  }

  const day = now.getUTCDay(); // 0=Sun .. 6=Sat
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();

  // 2. Forex / Metals / Commodities: Sun 22:00 UTC -> Fri 22:00 UTC
  const isFxOrMetal =
    cls.includes("FOREX") ||
    cls.includes("FX") ||
    cls.includes("METAL") ||
    cls.includes("COMMOD") ||
    sym.startsWith("XAU") ||
    sym.startsWith("XAG") ||
    sym.includes("OIL") ||
    sym.includes("NATGAS") ||
    /^(EUR|GBP|USD|AUD|NZD|CAD|CHF|JPY){2}$/.test(sym);

  if (isFxOrMetal) {
    const isWeekend =
      day === 6 || (day === 5 && mins >= 22 * 60) || (day === 0 && mins < 22 * 60);
    if (isWeekend) {
      return {
        isOpen: false,
        label: "Рынок закрыт · Выходные",
        detail: "Торги откроются в воскресенье 22:00 UTC",
        tone: "closed",
      };
    }
    if (mins >= 21 * 60 + 55 && mins <= 22 * 60 + 5) {
      return {
        isOpen: false,
        label: "Клиринг · 22:00 UTC",
        detail: "Ежедневный банковский ролловер (5–10 мин)",
        tone: "extended",
      };
    }
    return { isOpen: true, label: "LIVE", detail: "Межбанковская сессия активна", tone: "live" };
  }

  // 3. US Equities / ETFs / Indices: Mon-Fri 13:30-20:00 UTC (regular), 08:00-13:30 (pre), 20:00-24:00 (post)
  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      label: "Биржа закрыта · Выходные",
      detail: "Основная сессия США: Пн–Пт 13:30–20:00 UTC",
      tone: "closed",
    };
  }
  if (mins >= 13 * 60 + 30 && mins < 20 * 60) {
    return { isOpen: true, label: "LIVE · US", detail: "Основная торговая сессия США", tone: "live" };
  }
  if (mins >= 8 * 60 && mins < 13 * 60 + 30) {
    return {
      isOpen: false,
      label: "Премаркет",
      detail: "Основная сессия откроется в 13:30 UTC",
      tone: "extended",
    };
  }
  if (mins >= 20 * 60 && mins < 24 * 60) {
    return {
      isOpen: false,
      label: "Постмаркет",
      detail: "Внебиржевые торги после закрытия основной сессии",
      tone: "extended",
    };
  }
  return {
    isOpen: false,
    label: "Биржа закрыта · Ночь",
    detail: "Премаркет откроется в 08:00 UTC, основная сессия в 13:30 UTC",
    tone: "closed",
  };
}
