import { formatTerminalDateTime } from "@/framework/use-utc-clock";
import { useCallback, useEffect, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Eye, FileSpreadsheet, RefreshCw } from "lucide-react";

import { formatSignedUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiDownload, apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";

export const Route = createFileRoute("/(main)/dashboard/journal/")({
  component: JournalPage,
});

export interface JournalDeal {
  id: string;
  account_id: string;
  account_name: string;
  currency: string;
  mt5_deal_ticket: number;
  position_id: number;
  magic_number: number;
  robot_name: string;
  symbol: string;
  side: string;
  entry: string;
  volume: number;
  price: number;
  profit_usd: number;
  commission_usd: number;
  swap_usd: number;
  net_profit_usd: number;
  time_sec?: number;
  timestamp?: string;
  notes?: string;
  tags?: string[];
}

interface LivePosition {
  position_ticket: number;
  account_name: string;
  symbol: string;
  side: string;
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit_usd: number;
  mae_usd: number;
  mfe_usd: number;
}

interface TransferOp {
  id: string;
  account_name: string;
  op_kind: string;
  amount_usd: number;
  comment: string;
  timestamp: string;
}

function JournalPage() {
  const { t } = useI18n();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const [tab, setTab] = useState<"deals" | "positions" | "transfers">("deals");
  const [deals, setDeals] = useState<JournalDeal[]>([]);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [transfers, setTransfers] = useState<TransferOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dRows, pRows, tRows] = await Promise.all([
        apiRequest<JournalDeal[]>("/journal/deals?limit=150").catch(() => [] as JournalDeal[]),
        apiRequest<LivePosition[]>("/journal/positions").catch(() => [] as LivePosition[]),
        apiRequest<TransferOp[]>("/treasury/operations?limit=100").catch(() => [] as TransferOp[]),
      ]);
      setDeals(Array.isArray(dRows) ? dRows : []);
      setPositions(Array.isArray(pRows) ? pRows : []);
      setTransfers(Array.isArray(tRows) ? tRows : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useLiveEvents(["trade_event", "snapshot"], () => {
    void loadAll();
  });

  async function handleExport(fmt: "csv" | "xlsx") {
    setExporting(fmt);
    try {
      const fn = await apiDownload(
        `/analytics/statement.${fmt}`,
        `huseynovlar_statement.${fmt}`,
      );
      notify.success(t.common.download, fn);
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }

  return (
    <TerminalPageShell
      title={t.journal.title}
      subtitle={t.journal.subtitle}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={exporting === "csv"}
            loadingText={t.common.loading}
            onClick={() => void handleExport("csv")}
          >
            <Download className="mr-1.5 size-3.5" />
            {t.journal.exportCsv}
          </AsyncButton>
          <AsyncButton
            size="sm"
            variant="outline"
            loading={exporting === "xlsx"}
            loadingText={t.common.loading}
            onClick={() => void handleExport("xlsx")}
          >
            <FileSpreadsheet className="mr-1.5 size-3.5" />
            {t.journal.exportXlsx}
          </AsyncButton>
          <Button size="sm" variant="outline" onClick={() => void loadAll()}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t.common.refresh}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={tab === "deals" ? "default" : "outline"} onClick={() => setTab("deals")}>
          {t.journal.tabDeals} ({deals.length})
        </Button>
        <Button size="sm" variant={tab === "positions" ? "default" : "outline"} onClick={() => setTab("positions")}>
          {t.journal.tabPositions} ({positions.length})
        </Button>
        <Button size="sm" variant={tab === "transfers" ? "default" : "outline"} onClick={() => setTab("transfers")}>
          {t.journal.tabTransfers} ({transfers.length})
        </Button>
      </div>

      {loading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : tab === "deals" ? (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Account / Robot</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Vol</th>
                  <th className="px-3 py-2 text-right">Net PnL</th>
                  <th className="px-3 py-2 text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {deals.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
                ) : (
                  deals.map((d) => (
                    <tr key={d.id} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono">
                        <Link to="/dashboard/journal/deals/$dealId" params={{ dealId: d.id }} className="text-primary hover:underline">
                          #{d.mt5_deal_ticket}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 font-mono font-semibold">
                          <AssetLogo symbol={d.symbol} size={16} />
                          {d.symbol}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{d.account_name}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">{d.robot_name}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={d.side === "BUY" ? "default" : "destructive"} className="font-mono text-[10px]">
                          {d.side} {d.entry}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">{d.volume.toFixed(2)}</td>
                      <td
                        className={`px-3 py-2 text-right font-mono font-semibold ${
                          d.net_profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                        }`}
                      >
                        {formatSignedUsd(d.net_profit_usd, privacyMode)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          to="/dashboard/journal/deals/$dealId"
                          params={{ dealId: d.id }}
                          className="inline-flex h-7 items-center rounded-md border border-input px-2 hover:bg-accent"
                        >
                          <Eye className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : tab === "positions" ? (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Vol</th>
                  <th className="px-3 py-2">Open / Current</th>
                  <th className="px-3 py-2">MAE / MFE</th>
                  <th className="px-3 py-2 text-right">Float PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
                ) : (
                  positions.map((p) => (
                    <tr key={p.position_ticket} className="border-b border-border/40">
                      <td className="px-3 py-2 font-mono">#{p.position_ticket}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 font-mono font-semibold">
                          <AssetLogo symbol={p.symbol} size={16} />
                          {p.symbol}
                        </div>
                      </td>
                      <td className="px-3 py-2"><Badge variant={p.side === "BUY" ? "default" : "destructive"}>{p.side}</Badge></td>
                      <td className="px-3 py-2 font-mono">{p.volume.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono">{p.open_price.toFixed(2)} → {p.current_price.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{formatSignedUsd(p.mae_usd, privacyMode)} / {formatSignedUsd(p.mfe_usd, privacyMode)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${p.profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {formatSignedUsd(p.profit_usd, privacyMode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/70">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/60 bg-muted/30 font-mono text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Comment</th>
                  <th className="px-3 py-2 text-right">Amount USD</th>
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
                ) : (
                  transfers.map((op) => (
                    <tr key={op.id} className="border-b border-border/40">
                      <td className="px-3 py-2 font-mono">{formatTerminalDateTime(op.timestamp)}</td>
                      <td className="px-3 py-2">{op.account_name}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="font-mono text-[10px]">{op.op_kind}</Badge></td>
                      <td className="px-3 py-2 text-muted-foreground">{op.comment || "—"}</td>
                      <td className={`px-3 py-2 text-right font-mono font-semibold ${op.amount_usd >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                        {formatSignedUsd(op.amount_usd, privacyMode)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </TerminalPageShell>
  );
}
