from __future__ import annotations

import re
from typing import Any

from sqlalchemy import func

# Canonical instrument families so broker aliases (XAUUSDc, XAUUSDm, GOLD, USTECm, NAS100, etc.)
# always resolve to the same Asset Hub, Chart, Deals, Open Positions, and Robots.
_SYMBOL_FAMILIES: dict[str, tuple[str, ...]] = {
    "XAUUSD": ("XAUUSD", "GOLD", "XAU", "GC=F", "XAUUSD=X"),
    "XAGUSD": ("XAGUSD", "SILVER", "XAG", "SI=F", "XAGUSD=X"),
    "USTEC": ("USTEC", "NAS100", "US100", "NDX", "NASDAQ", "USTECH", "USTECH100", "^NDX"),
    "US500": ("US500", "SPX", "SPX500", "SP500", "USA500", "^GSPC"),
    "US30": ("US30", "DJI", "DJ30", "WS30", "USA30", "^DJI"),
    "DE40": ("DE40", "GER40", "DAX", "DAX40", "^GDAXI"),
    "UK100": ("UK100", "FTSE100", "^FTSE"),
    "JP225": ("JP225", "JPN225", "NI225", "^N225"),
    "DXY": ("DXY", "USDX", "DX-Y.NYB"),
    "VIX": ("VIX", "^VIX"),
    "US10Y": ("US10Y", "^TNX"),
    "USOIL": ("USOIL", "WTI", "XTIUSD", "USCRUDE", "CL=F"),
    "UKOIL": ("UKOIL", "BRENT", "XBRUSD", "UKBRENT", "BZ=F"),
    "NGAS": ("NGAS", "XNGUSD", "NATGAS", "NG=F"),
    "BTCUSD": ("BTCUSD", "BTCUSDT", "BTCUSDC", "BTC-USD", "XBTUSD", "BTC"),
    "ETHUSD": ("ETHUSD", "ETHUSDT", "ETHUSDC", "ETH-USD", "ETH"),
    "SOLUSD": ("SOLUSD", "SOLUSDT", "SOLUSDC", "SOL-USD", "SOL"),
    "BNBUSD": ("BNBUSD", "BNBUSDT", "BNB-USD", "BNB"),
    "XRPUSD": ("XRPUSD", "XRPUSDT", "XRP-USD", "XRP"),
    "ADAUSD": ("ADAUSD", "ADAUSDT", "ADA-USD", "ADA"),
    "DOGEUSD": ("DOGEUSD", "DOGEUSDT", "DOGE-USD", "DOGE"),
    "TONUSD": ("TONUSD", "TONUSDT", "TON-USD", "TON"),
    "LTCUSD": ("LTCUSD", "LTCUSDT", "LTC-USD", "LTC"),
    "AVAXUSD": ("AVAXUSD", "AVAXUSDT", "AVAX-USD", "AVAX"),
    "DOTUSD": ("DOTUSD", "DOTUSDT", "DOT-USD", "DOT"),
    "LINKUSD": ("LINKUSD", "LINKUSDT", "LINK-USD", "LINK"),
}

_ALIAS_TO_CANONICAL: dict[str, str] = {}
for _canon, _members in _SYMBOL_FAMILIES.items():
    _ALIAS_TO_CANONICAL[_canon] = _canon
    for _m in _members:
        _ALIAS_TO_CANONICAL[_m.upper()] = _canon

_KNOWN_SHORT_BASES: set[str] = set(_ALIAS_TO_CANONICAL.keys()) | {
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
    "CADJPY",
    "CHFJPY",
    "GBPAUD",
    "GBPCAD",
    "GBPCHF",
    "EURCAD",
    "EURNZD",
}

_BROKER_SUFFIXES: tuple[str, ...] = (
    "",
    "C",
    "M",
    "Z",
    "R",
    "E",
    "PRO",
    "RAW",
    "ECN",
    "ZERO",
    "CENT",
    "MICRO",
    ".A",
    ".I",
    "_I",
    ".M",
    ".C",
    ".PRO",
    ".RAW",
    "#",
)


def canonical_asset_code(raw: str | None) -> str:
    """Normalize any broker or exchange symbol (e.g. XAUUSDc, USTECm, GOLD, BTCUSDT) to canonical Asset Hub code."""
    if not raw:
        return ""
    s = raw.strip()
    if not s:
        return ""

    # Strip explicit lowercase broker account-type suffix (e.g. XAUUSDc, USTECm, AAPLm) before uppercasing
    if len(s) >= 5 and s[-1] in ("m", "c", "z") and s[:-1].isalnum() and s[-2].isupper():
        s = s[:-1]

    up = s.upper().replace(" ", "")
    if up in _ALIAS_TO_CANONICAL:
        return _ALIAS_TO_CANONICAL[up]

    # Strip FX Yahoo suffix
    if up.endswith("=X") and len(up) > 2:
        up = up[:-2]

    # Strip dot/underscore/hash broker suffixes (.a, .pro, _i, #)
    up = re.sub(r"(\.[A-Z0-9]{1,4}|_[A-Z0-9]{1,3}|#+)$", "", up)
    if up in _ALIAS_TO_CANONICAL:
        return _ALIAS_TO_CANONICAL[up]

    # Strip multi-letter broker account suffixes
    for suf in ("MICRO", "ZERO", "CENT", "PRO", "RAW", "ECN"):
        if up.endswith(suf) and len(up) - len(suf) >= 3:
            cand = up[: -len(suf)]
            return _ALIAS_TO_CANONICAL.get(cand, cand)

    # Strip USDT/USDC for crypto pairs
    for suf in ("USDT", "USDC"):
        if up.endswith(suf) and len(up) > len(suf) + 1:
            base = up[: -len(suf)]
            cand = f"{base}USD"
            return _ALIAS_TO_CANONICAL.get(cand, cand)

    # Strip single-letter MT5 account suffix (C/M/Z) when base >=6 chars or known base (USTECM)
    if len(up) >= 4 and up[-1] in ("C", "M", "Z"):
        stem = up[:-1]
        if len(stem) >= 6 or stem in _KNOWN_SHORT_BASES:
            return _ALIAS_TO_CANONICAL.get(stem, stem)

    return _ALIAS_TO_CANONICAL.get(up, up)


def expand_symbol_variants(code: str, extra_symbols: list[str] | None = None) -> list[str]:
    """Return all uppercase broker/feed symbol variants that belong to the given Asset Hub code."""
    canon = canonical_asset_code(code)
    seeds: set[str] = {code.strip().upper(), canon}
    if canon in _SYMBOL_FAMILIES:
        seeds.update(m.upper() for m in _SYMBOL_FAMILIES[canon])
    for ex in extra_symbols or []:
        if ex and ex.strip():
            ex_up = ex.strip().upper()
            seeds.add(ex_up)
            ex_canon = canonical_asset_code(ex_up)
            if ex_canon:
                seeds.add(ex_canon)
                if ex_canon in _SYMBOL_FAMILIES:
                    seeds.update(m.upper() for m in _SYMBOL_FAMILIES[ex_canon])

    variants: set[str] = set()
    for base in seeds:
        if not base:
            continue
        variants.add(base)
        # Only append MT5 broker suffixes to clean alphanumeric symbols
        if base.isalnum() and len(base) >= 3:
            for suf in _BROKER_SUFFIXES:
                variants.add(f"{base}{suf}")

    return sorted(variants)


def symbol_matches_asset(
    candidate_symbol: str | None,
    asset_code: str,
    broker_symbols: list[str] | None = None,
) -> bool:
    if not candidate_symbol or not candidate_symbol.strip():
        return False
    cand_up = candidate_symbol.strip().upper()
    variants = set(expand_symbol_variants(asset_code, broker_symbols))
    if cand_up in variants:
        return True
    return canonical_asset_code(cand_up) == canonical_asset_code(asset_code)


def sql_symbol_match(column: Any, asset_code: str, broker_symbols: list[str] | None = None) -> Any:
    """SQLAlchemy filter matching all broker/exchange symbol variants (case-insensitive)."""
    variants = expand_symbol_variants(asset_code, broker_symbols)
    return func.upper(column).in_(variants)


def asset_related_currencies(asset_code: str) -> list[str]:
    """Extract relevant macro/calendar currencies for an asset code (e.g. XAUUSD -> ['USD'])."""
    canon = canonical_asset_code(asset_code)
    known_ccy = {"USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "CNY"}
    found: list[str] = []
    if len(canon) == 6 and canon[:3] in known_ccy and canon[3:] in known_ccy:
        found.extend([canon[:3], canon[3:]])
    elif canon in ("DE40",):
        found.extend(["EUR", "USD"])
    elif canon in ("UK100",):
        found.extend(["GBP", "USD"])
    elif canon in ("JP225",):
        found.extend(["JPY", "USD"])
    else:
        for ccy in known_ccy:
            if ccy in canon and ccy not in found:
                found.append(ccy)
    if not found:
        found.append("USD")
    return found
