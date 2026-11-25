import { useState } from "react";

const OFFLINE_SVG_MAP: Record<string, string> = {
  XAUUSD: "/logos/xau.svg",
  XAU: "/logos/xau.svg",
  GOLD: "/logos/xau.svg",
  USTEC: "/logos/ustec.svg",
  NAS100: "/logos/ustec.svg",
  NDX: "/logos/ustec.svg",
  QQQ: "/logos/ustec.svg",
  SPX: "/logos/spx.svg",
  US500: "/logos/spx.svg",
  SPY: "/logos/spx.svg",
  BTCUSD: "/logos/btc.svg",
  BTC: "/logos/btc.svg",
};

const FX_COUNTRY_MAP: Record<string, string> = {
  USD: "us",
  EUR: "eu",
  GBP: "gb",
  JPY: "jp",
  CHF: "ch",
  CAD: "ca",
  AUD: "au",
  NZD: "nz",
  TRY: "tr",
  AZN: "az",
  RUB: "ru",
};

function cleanSymbol(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(C|M|RAW|PRO)$/, "");
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) % 360;
  }
  return h;
}

export interface AssetLogoProps {
  symbol: string;
  size?: number;
  className?: string;
}

/**
 * Same-origin CSP-safe AssetLogo:
 * 1. Dual FX flags via bundled flags.css for 6-char FX pairs (EURUSD, GBPUSD, etc.)
 * 2. Crisp offline SVG badges in /public/logos/ for core indices/metals/crypto
 * 3. Same-origin /api/v1/assets/logo/{symbol} proxy for equities/ETFs/other symbols
 * 4. Clean deterministic monogram fallback if image fails to load
 */
export function AssetLogo({ symbol, size = 24, className = "" }: AssetLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const norm = cleanSymbol(symbol || "ASSET");

  // 1. Offline SVG badge
  const offlineUrl = OFFLINE_SVG_MAP[norm];
  if (offlineUrl && !imgFailed) {
    return (
      <img
        src={offlineUrl}
        alt={norm}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className={`inline-block shrink-0 rounded-md object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // 2. FX dual flag via local flags.css
  if (norm.length === 6) {
    const base = norm.slice(0, 3);
    const quote = norm.slice(3, 6);
    const baseCc = FX_COUNTRY_MAP[base];
    const quoteCc = FX_COUNTRY_MAP[quote];
    if (baseCc && quoteCc) {
      return (
        <span
          className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
          style={{ width: size, height: size }}
          title={norm}
        >
          <span
            className={`fi fi-${baseCc} fis rounded-full ring-1 ring-border`}
            style={{
              width: Math.round(size * 0.68),
              height: Math.round(size * 0.68),
              position: "absolute",
              left: 0,
              top: 0,
            }}
          />
          <span
            className={`fi fi-${quoteCc} fis rounded-full ring-1 ring-background`}
            style={{
              width: Math.round(size * 0.68),
              height: Math.round(size * 0.68),
              position: "absolute",
              right: 0,
              bottom: 0,
            }}
          />
        </span>
      );
    }
  }

  // 3. Same-origin backend logo proxy
  if (!imgFailed && norm.length > 0) {
    return (
      <img
        src={`/api/v1/assets/logo/${encodeURIComponent(norm)}`}
        alt={norm}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={`inline-block shrink-0 rounded-md object-contain bg-muted/40 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // 4. Deterministic monogram fallback
  const hue = hashHue(norm);
  const initials = norm.slice(0, 3);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.36)),
        backgroundColor: `hsl(${hue} 55% 32%)`,
      }}
      title={norm}
    >
      {initials}
    </span>
  );
}
