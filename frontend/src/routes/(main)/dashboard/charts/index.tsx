import { useEffect, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import {
  type ChartBundleData,
  InteractiveChartCanvas,
} from "@/components/m5/InteractiveChartCanvas";
import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/charts/")({
  component: () => <LiveChartsDeskView symbol="XAUUSD" />,
});

interface AssetHubOption {
  code: string;
  name: string;
}

export function LiveChartsDeskView({ symbol }: { symbol: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [hubs, setHubs] = useState<AssetHubOption[]>([]);
  const [bundle, setBundle] = useState<ChartBundleData | null>(null);

  useEffect(() => {
    apiRequest<AssetHubOption[]>("/assets")
      .then((rows) => {
        if (Array.isArray(rows) && rows.length > 0) setHubs(rows);
      })
      .catch(() => {});
  }, []);

  const quickSymbols = hubs.length > 0
    ? hubs.map((h) => h.code)
    : ["XAUUSD", "USTEC", "SPX", "EURUSD", "BTCUSD"];

  const activeSym = (symbol || "XAUUSD").toUpperCase();
  const openPositions = bundle?.open_positions ?? [];
  const recentDeals = bundle?.deals ?? [];

  return (
    <TerminalPageShell
      title={t.charts.title}
      subtitle={t.charts.subtitle}
      badge={activeSym}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {quickSymbols.map((code) => (
            <Button
              key={code}
              size="sm"
              variant={activeSym === code ? "default" : "outline"}
              className="h-7 gap-1.5 px-2 font-mono text-xs"
              onClick={() => void navigate({ to: "/dashboard/charts/$symbol", params: { symbol: code } })}
            >
              <AssetLogo symbol={code} size={15} />
              {code}
            </Button>
          ))}
        </div>
      }
    >
      <InteractiveChartCanvas symbol={activeSym} mode="hub" height={460} onDataLoaded={setBundle} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t.charts.openPositions} ({openPositions.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-xs">
            {openPositions.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">{t.common.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono">
                  <thead className="border-b border-border/60 text-[11px] text-muted-foreground">
                    <tr>
                      <th className="py-1.5">Ticket</th>
                      <th className="py-1.5">Side</th>
                      <th className="py-1.5">Vol</th>
                      <th className="py-1.5">Open</th>
                      <th className="py-1.5 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.map((p, idx) => (
                      <tr key={String(p.position_ticket ?? idx)} className="border-b border-border/40">
                        <td className="py-1.5">#{String(p.position_ticket ?? "")}</td>
                        <td className="py-1.5">
                          <Badge variant={p.side === "BUY" ? "default" : "destructive"} className="text-[10px]">
                            {String(p.side ?? "")}
                          </Badge>
                        </td>
                        <td className="py-1.5">{Number(p.volume ?? 0).toFixed(2)}</td>
                        <td className="py-1.5">{Number(p.open_price ?? 0).toFixed(2)}</td>
                        <td
                          className={`py-1.5 text-right font-semibold ${
                            Number(p.profit_usd ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {formatSignedUsd(Number(p.profit_usd ?? 0), privacyMode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm">{t.charts.recentDeals} ({recentDeals.length})</CardTitle>
            <Link to="/dashboard/journal" className="text-xs text-primary hover:underline">
              {t.nav.journal} →
            </Link>
          </CardHeader>
          <CardContent className="pt-0 text-xs">
            {recentDeals.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">{t.common.noData}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono">
                  <thead className="border-b border-border/60 text-[11px] text-muted-foreground">
                    <tr>
                      <th className="py-1.5">Ticket</th>
                      <th className="py-1.5">Side</th>
                      <th className="py-1.5">Vol</th>
                      <th className="py-1.5">Price</th>
                      <th className="py-1.5 text-right">Net PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeals.slice(0, 12).map((d, idx) => (
                      <tr key={String(d.mt5_deal_ticket ?? idx)} className="border-b border-border/40">
                        <td className="py-1.5">#{String(d.mt5_deal_ticket ?? "")}</td>
                        <td className="py-1.5">{String(d.side ?? "")}</td>
                        <td className="py-1.5">{Number(d.volume ?? 0).toFixed(2)}</td>
                        <td className="py-1.5">{Number(d.price ?? 0).toFixed(2)}</td>
                        <td
                          className={`py-1.5 text-right font-semibold ${
                            Number(d.net_profit_usd ?? 0) >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {formatSignedUsd(Number(d.net_profit_usd ?? 0), privacyMode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </TerminalPageShell>
  );
}
