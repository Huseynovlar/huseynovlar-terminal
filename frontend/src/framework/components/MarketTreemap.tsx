import { useEffect, useState } from "react";

import { Grid2x2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";

interface TreemapItem {
  ticker: string;
  weight: number;
  change_pct: number;
}

interface TreemapSector {
  sector: string;
  items: TreemapItem[];
}

interface TreemapResponse {
  universe: string;
  name: string;
  linked_asset: string;
  period: string;
  sectors: TreemapSector[];
}

const PREVIEW_TREEMAP: TreemapResponse = {
  universe: "nasdaq100",
  name: "NASDAQ-100 (USTEC Drivers)",
  linked_asset: "USTEC",
  period: "1D",
  sectors: [
    {
      sector: "Semiconductors & AI",
      items: [
        { ticker: "NVDA", weight: 100, change_pct: 3.42 },
        { ticker: "AVGO", weight: 78, change_pct: 1.85 },
        { ticker: "AMD", weight: 58, change_pct: -0.94 },
        { ticker: "ASML", weight: 52, change_pct: 1.12 },
        { ticker: "QCOM", weight: 46, change_pct: 0.44 },
        { ticker: "MU", weight: 40, change_pct: 2.18 },
      ],
    },
    {
      sector: "Big Tech & Cloud",
      items: [
        { ticker: "AAPL", weight: 98, change_pct: 0.78 },
        { ticker: "MSFT", weight: 95, change_pct: 1.24 },
        { ticker: "AMZN", weight: 82, change_pct: 1.65 },
        { ticker: "META", weight: 74, change_pct: -0.45 },
        { ticker: "GOOGL", weight: 72, change_pct: 0.91 },
        { ticker: "NFLX", weight: 48, change_pct: -1.32 },
      ],
    },
    {
      sector: "Consumer & Auto",
      items: [
        { ticker: "TSLA", weight: 76, change_pct: 2.88 },
        { ticker: "COST", weight: 55, change_pct: 0.31 },
        { ticker: "PEP", weight: 44, change_pct: -0.62 },
        { ticker: "BKNG", weight: 38, change_pct: 0.54 },
      ],
    },
  ],
};

function tileColor(pct: number): string {
  if (pct >= 2.5) return "bg-emerald-600 text-white border-emerald-400/40";
  if (pct >= 1.0) return "bg-emerald-700/90 text-emerald-50 border-emerald-500/30";
  if (pct > 0) return "bg-emerald-900/75 text-emerald-100 border-emerald-500/20";
  if (pct <= -2.5) return "bg-rose-600 text-white border-rose-400/40";
  if (pct <= -1.0) return "bg-rose-700/90 text-rose-50 border-rose-500/30";
  if (pct < 0) return "bg-rose-900/75 text-rose-100 border-rose-500/20";
  return "bg-zinc-800 text-zinc-200 border-zinc-700";
}

export function MarketTreemap() {
  const [universe, setUniverse] = useState<"nasdaq100" | "sp500_top" | "gold_commodities">("nasdaq100");
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "YTD">("1D");
  const [data, setData] = useState<TreemapResponse>(PREVIEW_TREEMAP);

  useEffect(() => {
    apiRequest<TreemapResponse>(`/intelligence/treemap?universe=${universe}&period=${period}`)
      .then((res) => {
        if (res.sectors && res.sectors.length > 0) setData(res);
      })
      .catch(() => {});
  }, [universe, period]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <Grid2x2 className="size-4 text-emerald-500" />
          <CardTitle className="text-sm">Глобальная карта рынка (StockCharts / Finviz Treemap)</CardTitle>
          {data.linked_asset ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              Драйвер {data.linked_asset}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-muted/50 flex rounded-md border border-border/60 p-0.5">
            {(
              [
                ["nasdaq100", "NASDAQ-100 (USTEC)"],
                ["sp500_top", "S&P 500 / Мир"],
                ["gold_commodities", "Gold & Сырьё (XAUUSD)"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={universe === id ? "secondary" : "ghost"}
                className="h-6 px-2 text-[11px]"
                onClick={() => setUniverse(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="bg-muted/50 flex rounded-md border border-border/60 p-0.5">
            {(["1D", "1W", "1M", "YTD"] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? "secondary" : "ghost"}
                className="h-6 px-2 font-mono text-[10px]"
                onClick={() => setPeriod(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.sectors.map((sec) => (
          <div key={sec.sector} className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-2">
            <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">{sec.sector}</div>
            <div className="flex flex-wrap gap-1.5">
              {sec.items.map((item) => {
                const basisPct = Math.max(22, Math.min(48, Math.round(item.weight * 0.48)));
                return (
                  <div
                    key={item.ticker}
                    style={{ flexBasis: `${basisPct}%`, flexGrow: Math.max(1, Math.round(item.weight / 25)) }}
                    className={`flex min-h-14 flex-col items-center justify-center rounded border p-1.5 font-mono transition-transform hover:scale-[1.02] ${tileColor(
                      item.change_pct,
                    )}`}
                    title={`${item.ticker}: ${item.change_pct >= 0 ? "+" : ""}${item.change_pct}% (${period})`}
                  >
                    <span className="text-xs font-bold">{item.ticker}</span>
                    <span className="text-[11px]">
                      {item.change_pct >= 0 ? "+" : ""}
                      {item.change_pct.toFixed(2)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
