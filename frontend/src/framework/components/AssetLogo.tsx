import { useState } from "react";

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
  logoUrl?: string | null;
  className?: string;
}

/**
 * Same-origin CSP-safe AssetLogo:
 * 1. Dual FX flags via bundled flags.css for 6-char FX pairs (EURUSD, GBPUSD, USDJPY, etc.)
 * 2. Backend official logo proxy (`/api/v1/assets/logo/{symbol}`) which fetches & caches
 *    real brand PNG/SVG logos (NVDA, AAPL, TSLA, BTC, ETH, XAU, SPY, QQQ, etc.) from
 *    nvstly/icons, CoinCap & FMP without any browser CSP issues.
 * 3. Clean deterministic monogram fallback if image fails to load.
 */
export function AssetLogo({ symbol, size = 24, logoUrl, className = "" }: AssetLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const norm = cleanSymbol(symbol || "ASSET");

  // 1. FX dual country flags via local flags.css
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

  // 2. Same-origin backend official logo proxy (fetches & caches real PNG/SVG logos on server)
  const resolvedSrc =
    logoUrl && logoUrl.startsWith("/api/v1/assets/logo/")
      ? logoUrl
      : `/api/v1/assets/logo/${encodeURIComponent(norm)}`;

  if (!imgFailed && norm.length > 0) {
    return (
      <img
        src={resolvedSrc}
        alt={norm}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className={`inline-block shrink-0 rounded-md object-contain ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  // 3. Deterministic monogram fallback
  const hue = hashHue(norm);
  const label = norm.slice(0, 3);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold text-white select-none ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        background: `linear-gradient(135deg, hsl(${hue} 65% 42%), hsl(${(hue + 28) % 360} 65% 30%))`,
      }}
      title={norm}
    >
      {label}
    </span>
  );
}
