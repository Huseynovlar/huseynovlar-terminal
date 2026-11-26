import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchSelect } from "@/components/ui/search-select";
import { apiRequestPaged } from "@/framework/api-client";

export interface MarketTickerRecord {
  symbol: string;
  name: string;
  asset_class: string;
  exchange: string;
  source: string;
  logo_url: string;
  broker_symbols?: string[];
  news_keywords?: string[];
}

interface TickerSelectProps {
  id?: string;
  value: string;
  required?: boolean;
  placeholder?: string;
  assetClassFilter?: string;
  className?: string;
  onSelectTicker: (symbol: string, record?: MarketTickerRecord) => void;
}

const TICKER_PAGE_SIZE = 60;

export function TickerSelect({
  id,
  value,
  required,
  placeholder = "Выбери тикер (XAUUSD, USTEC, BTCUSD, NVDA...)",
  assetClassFilter,
  className,
  onSelectTicker,
}: TickerSelectProps) {
  const [items, setItems] = useState<MarketTickerRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchQ, setSearchQ] = useState("");
  const [loading, setLoading] = useState(false);

  const cacheMapRef = useRef<Map<string, MarketTickerRecord>>(new Map());
  const reqIdRef = useRef(0);

  const fetchPage = useCallback(
    async (qStr: string, targetPage: number, append: boolean) => {
      reqIdRef.current += 1;
      const myReq = reqIdRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (qStr.trim()) params.set("q", qStr.trim());
        if (assetClassFilter && assetClassFilter !== "all") params.set("asset_class", assetClassFilter);
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await apiRequestPaged<MarketTickerRecord>(
          `/assets/tickers${qs}`,
          targetPage,
          TICKER_PAGE_SIZE,
        );
        if (myReq !== reqIdRef.current) return;
        for (const row of res.items) {
          cacheMapRef.current.set(row.symbol, row);
        }
        setTotal(res.total);
        setPage(targetPage);
        setItems((prev) => {
          if (!append) return res.items;
          const seen = new Set(prev.map((x) => x.symbol));
          const merged = [...prev];
          for (const it of res.items) {
            if (!seen.has(it.symbol)) {
              seen.add(it.symbol);
              merged.push(it);
            }
          }
          return merged;
        });
      } catch {
        // keep current options on transient error
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false);
        }
      }
    },
    [assetClassFilter],
  );

  // Initial page 1 load (always contains XAUUSD, USTEC, EURUSD, BTCUSD, NVDA, AAPL at the top)
  useEffect(() => {
    void fetchPage("", 1, false);
  }, [fetchPage]);

  // Debounced server-side search across all 3,000+ tickers
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPage(searchQ, 1, false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchPage, searchQ]);

  const options = useMemo(
    () =>
      items.map((tk) => ({
        value: tk.symbol,
        label: `${tk.symbol} — ${tk.name} [${tk.asset_class.toUpperCase()}]`,
      })),
    [items],
  );

  const selectedRecord = value ? cacheMapRef.current.get(value) : undefined;
  const selectedLabel = selectedRecord
    ? `${selectedRecord.symbol} — ${selectedRecord.name}`
    : value || undefined;

  return (
    <SearchSelect
      id={id}
      required={required}
      value={value}
      selectedLabel={selectedLabel}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Поиск по 3000+ тикерам: XAUUSD, GOLD, USTEC, BTC, NVDA..."
      onSearchQueryChange={setSearchQ}
      onLoadMore={() => {
        if (!loading && items.length < total) {
          void fetchPage(searchQ, page + 1, true);
        }
      }}
      hasMore={items.length < total}
      loadingMore={loading}
      totalCount={total}
      className={className}
      onValueChange={(sym) => {
        onSelectTicker(sym, cacheMapRef.current.get(sym));
      }}
    />
  );
}
