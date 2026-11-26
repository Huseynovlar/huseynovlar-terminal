import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Calendar,
  ExternalLink,
  Layers,
  ListOrdered,
  Newspaper,
  Pencil,
  Trash2,
} from "lucide-react";

import {
  type ChartBundleData,
  InteractiveChartCanvas,
  type RobotZoneLevels,
} from "@/components/m5/InteractiveChartCanvas";
import { OrderBookAndTicks } from "@/components/m5/OrderBookAndTicks";
import { RobotTelemetryPanel } from "@/components/m5/RobotTelemetryPanel";
import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import { AsyncButton } from "@/components/ui/async-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DEFAULT_PAGE_SIZE, PagerBar } from "@/components/ui/pager-bar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { useI18n } from "@/framework/i18n";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/")({
  component: HubDetailPage,
});

interface HubAccountRow {
  id: string;
  name: string;
  mt5_login: string;
  currency: string;
  last_balance_usd: number;
  last_equity_usd: number;
  last_floating_pnl_usd?: number;
  terminal_connected: boolean;
}

interface HubRobotRow {
  id: string;
  account_id: string;
  account_name?: string;
  account_login?: string;
  name: string;
  program_name?: string;
  version?: string;
  magic_number: number;
  symbol: string;
  live_status?: string;
  live_state_json?: Record<string, unknown>;
  last_execution_ms?: number;
  last_heartbeat_at?: string | null;
  is_active: boolean;
}

interface HubOpenPositionRow {
  position_ticket: number;
  account_id: string;
  account_name: string;
  magic_number: number;
  symbol: string;
  side: string;
  volume: number;
  open_price: number;
  current_price: number;
  sl: number;
  tp: number;
  profit_usd: number;
  open_time: number;
}

interface CalRow {
  id: string;
  title: string;
  currency: string;
  impact: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  event_time: string;
}

interface AssetHubDetail {
  id: string;
  code: string;
  name: string;
  group: string;
  broker_symbols?: string[];
  resolved_symbols?: string[];
  stats: {
    accounts_count: number;
    robots_count: number;
    open_positions_count: number;
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    asset_floating_pnl_usd?: number;
    pnl_24h_usd?: number;
    pnl_7d_usd?: number;
    pnl_30d_usd?: number;
    total_trades: number;
    win_rate_pct: number;
    net_pnl_usd: number;
  };
  accounts: HubAccountRow[];
  robots: HubRobotRow[];
  open_positions?: HubOpenPositionRow[];
  calendar_events?: CalRow[];
  news_digest: {
    total_articles: number;
    breaking_count: number;
    corroborated_count: number;
    dominant_sentiment: string;
    sentiment_breakdown: { bullish: number; bearish: number; neutral: number };
  };
  recent_news: Array<{
    id: string;
    title: string;
    source: string;
    sentiment: string;
    verification_count: number;
    published_at: string;
  }>;
}

interface DealRow {
  id: string;
  mt5_deal_ticket?: number;
  account_name?: string;
  robot_name?: string;
  symbol: string;
  side: string;
  entry?: string;
  volume: number;
  price: number;
  net_profit_usd: number;
  timestamp: string;
}

function HubDetailPage() {
  const { code } = Route.useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);

  const [hub, setHub] = useState<AssetHubDetail | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [dealsTotal, setDealsTotal] = useState(0);
  const [dealsPage, setDealsPage] = useState(1);
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [latestChartPrice, setLatestChartPrice] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"orders" | "positions" | "robots" | "news" | "calendar">("orders");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canonCode = useMemo(() => canonicalMarketSymbol(code), [code]);

  // 100% WebSocket RPC load (zero HTTP fetch requests!)
  const loadHub = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [h, dRes] = await Promise.all([
          apiRequest<AssetHubDetail>(`/assets/${encodeURIComponent(code)}`),
          apiRequestPaged<DealRow>(
            `/journal/deals?symbol=${encodeURIComponent(code)}`,
            dealsPage,
            DEFAULT_PAGE_SIZE,
          ).catch(() => ({ items: [] as DealRow[], total: 0 })),
        ]);
        setHub(h);
        setDeals(dRes.items);
        setDealsTotal(dRes.total);
      } catch (err) {
        if (!silent) notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [code, dealsPage, t.common.errorTitle],
  );

  useEffect(() => {
    setSelectedRobotId(null);
    setLatestChartPrice(null);
  }, [code]);

  useEffect(() => {
    void loadHub(false);
  }, [loadHub]);

  // Live in-memory WebSocket updates for account equity & robot HUD telemetry (zero polling, zero extra requests)
  useLiveEvents(["snapshot", "robot_state", "robot_telemetry", "trade_event", "breaking_news"], (evt) => {
    const d = (evt.data ?? {}) as Record<string, unknown>;

    if (evt.type === "snapshot") {
      const accId = String(d.account_id ?? "");
      if (!accId) return;
      setHub((prev) => {
        if (!prev || !prev.accounts.some((a) => a.id === accId)) return prev;
        const nextAccounts = prev.accounts.map((a) =>
          a.id === accId
            ? {
                ...a,
                last_balance_usd: Number(d.balance_usd ?? a.last_balance_usd),
                last_equity_usd: Number(d.equity_usd ?? a.last_equity_usd),
                last_floating_pnl_usd: Number(d.floating_pnl_usd ?? a.last_floating_pnl_usd ?? 0),
                terminal_connected: Boolean(d.terminal_connected ?? a.terminal_connected),
              }
            : a,
        );
        const totalBal = Number(nextAccounts.reduce((s, a) => s + a.last_balance_usd, 0).toFixed(2));
        const totalEq = Number(nextAccounts.reduce((s, a) => s + a.last_equity_usd, 0).toFixed(2));
        const totalFl = Number(
          nextAccounts.reduce((s, a) => s + (a.last_floating_pnl_usd ?? 0), 0).toFixed(2),
        );
        return {
          ...prev,
          accounts: nextAccounts,
          stats: {
            ...prev.stats,
            total_balance_usd: totalBal,
            total_equity_usd: totalEq,
            total_floating_pnl_usd: totalFl,
          },
        };
      });
      return;
    }

    if (evt.type === "robot_state" || evt.type === "robot_telemetry") {
      const rId = String(d.robot_id ?? "");
      const rSym = canonicalMarketSymbol(String(d.symbol ?? ""));
      if (!rId && rSym !== canonCode) return;

      setHub((prev) => {
        if (!prev) return prev;
        const exists = prev.robots.some((r) => r.id === rId || (d.magic_number && r.magic_number === Number(d.magic_number) && r.account_id === String(d.account_id ?? "")));
        if (!exists) {
          if (rSym === canonCode && rId) {
            const added: HubRobotRow = {
              id: rId,
              account_id: String(d.account_id ?? ""),
              name: String(d.name ?? `EA #${String(d.magic_number ?? "")}`),
              magic_number: Number(d.magic_number ?? 0),
              symbol: String(d.symbol ?? prev.code),
              live_status: String(d.live_status ?? "RUNNING"),
              live_state_json:
                d.live_state_json && typeof d.live_state_json === "object"
                  ? (d.live_state_json as Record<string, unknown>)
                  : {},
              last_execution_ms: Number(d.last_execution_ms ?? 0),
              last_heartbeat_at: String(d.last_heartbeat_at ?? new Date().toISOString()),
              is_active: true,
            };
            const nextRobots = [...prev.robots, added];
            return {
              ...prev,
              robots: nextRobots,
              stats: { ...prev.stats, robots_count: nextRobots.length },
            };
          }
          return prev;
        }
        const nextRobots = prev.robots.map((r) => {
          const match =
            r.id === rId ||
            (d.magic_number && r.magic_number === Number(d.magic_number) && r.account_id === String(d.account_id ?? ""));
          if (!match) return r;
          const incomingState =
            d.live_state_json && typeof d.live_state_json === "object"
              ? (d.live_state_json as Record<string, unknown>)
              : {};
          return {
            ...r,
            symbol: String(d.symbol || r.symbol),
            live_status: String(d.live_status ?? r.live_status ?? "RUNNING"),
            live_state_json: { ...(r.live_state_json ?? {}), ...incomingState },
            last_execution_ms: Number(d.last_execution_ms ?? r.last_execution_ms ?? 0),
            last_heartbeat_at: String(d.last_heartbeat_at ?? r.last_heartbeat_at ?? ""),
          };
        });
        return { ...prev, robots: nextRobots };
      });
      return;
    }

    if (evt.type === "trade_event" || evt.type === "breaking_news") {
      void loadHub(true);
    }
  });

  const handleChartDataLoaded = useCallback((bundle: ChartBundleData) => {
    if (Array.isArray(bundle.bars) && bundle.bars.length > 0) {
      const last = bundle.bars[bundle.bars.length - 1];
      if (last && Number.isFinite(last.close) && last.close > 0) {
        setLatestChartPrice(last.close);
      }
    }
  }, []);

  const robots = hub?.robots ?? [];
  const openPositions = hub?.open_positions ?? [];
  const calEvents = hub?.calendar_events ?? [];

  const activeRobot = useMemo(() => {
    if (robots.length === 0) return null;
    if (selectedRobotId) {
      const found = robots.find((r) => r.id === selectedRobotId);
      if (found) return found;
    }
    return (
      robots.find((r) => r.live_state_json && Object.keys(r.live_state_json).length > 0) ??
      robots[0] ??
      null
    );
  }, [robots, selectedRobotId]);

  const robotZones: RobotZoneLevels | null = useMemo(() => {
    if (!activeRobot) return null;
    const outer = activeRobot.live_state_json ?? {};
    const nested =
      outer.telemetry && typeof outer.telemetry === "object"
        ? (outer.telemetry as Record<string, unknown>)
        : {};
    const merged: Record<string, unknown> = { ...outer, ...nested };
    const num = (k: string) => {
      const v = Number(merged[k]);
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    return {
      sellZone: num("bb_upper"),
      fair: num("vwap"),
      mean: num("bb_mid"),
      buyZone: num("bb_lower"),
      label: activeRobot.name,
    };
  }, [activeRobot]);

  async function handleAiAnalyze() {
    if (!hub) return;
    setAiLoading(true);
    try {
      const res = await apiRequest<{ response_md?: string; content_md?: string; summary?: string; model?: string }>(
        "/intelligence/ai/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "asset_deep_dive",
            symbol: hub.code,
            prompt: `Сделай обзор по активу ${hub.code} (${hub.name}) на основе новостей за последние 24 часа, данных графика (SELL ZONE / FAIR VWAP / BUY ZONE / RSI) и состояния роботов.`,
          }),
        },
      );
      setAiModel(res.model || "AI");
      setAiResult(res.response_md || res.content_md || res.summary || "Анализ завершён.");
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleDelete() {
    if (!hub) return;
    setBusy(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(hub.code)}`, { method: "DELETE" });
      notify.success(t.common.deletedSuccess, hub.code);
      void navigate({ to: "/dashboard/hubs" });
    } catch (err) {
      notify.error(t.common.errorTitle, err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !hub) return <PageSkeleton />;
  if (!hub) {
    return (
      <TerminalPageShell title={t.hubs.detailTitle}>
        <p className="text-xs text-muted-foreground">{t.common.noData}</p>
      </TerminalPageShell>
    );
  }

  const d1Pnl = hub.stats.pnl_24h_usd ?? 0;
  const d7Pnl = hub.stats.pnl_7d_usd ?? 0;
  const d30Pnl = hub.stats.pnl_30d_usd ?? 0;
  const floatingPnl = hub.stats.total_floating_pnl_usd ?? 0;

  return (
    <TerminalPageShell
      title={`${hub.code} — ${hub.name}`}
      subtitle={`ID: ${hub.id}`}
      badge={hub.group}
      actions={
        <>
          <AsyncButton
            size="sm"
            variant="default"
            loading={aiLoading}
            loadingText="Анализ..."
            onClick={() => void handleAiAnalyze()}
          >
            <Brain className="mr-1.5 size-3.5" />
            AI Обзор
          </AsyncButton>
          <Link
            to="/dashboard/hubs"
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <ArrowLeft className="mr-1.5 size-3.5" />
            {t.common.backToList}
          </Link>
          <Link
            to="/dashboard/hubs/$code/edit"
            params={{ code: hub.code }}
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-medium hover:bg-accent"
          >
            <Pencil className="mr-1.5 size-3.5" />
            {t.common.edit}
          </Link>
          <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-3.5" />
            {t.common.delete}
          </Button>
        </>
      }
    >
      {/* Top Accurate Server-Computed KPI Strip (#27) */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-6">
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3">
            <AssetLogo symbol={hub.code} size={32} />
            <div>
              <div className="text-[10px] text-muted-foreground">Счета / Роботы</div>
              <div className="font-mono text-sm font-bold tabular-nums">
                {hub.stats.accounts_count} / {hub.stats.robots_count}
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">
                Откр. поз.: {hub.stats.open_positions_count}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Эквити / Баланс</div>
            <div className="mt-0.5 font-mono text-sm font-bold tabular-nums">
              {formatUsd(hub.stats.total_equity_usd, privacyMode)}
            </div>
            <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
              Бал.: {formatUsd(hub.stats.total_balance_usd, privacyMode)}{" "}
              <span className={floatingPnl >= 0 ? "text-emerald-500" : "text-rose-500"}>
                ({formatSignedUsd(floatingPnl, privacyMode)})
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">PnL за 24ч</div>
            <div
              className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                d1Pnl >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {formatSignedUsd(d1Pnl, privacyMode)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">PnL 7Д / 30Д</div>
            <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums">
              <span className={d7Pnl >= 0 ? "text-emerald-500" : "text-rose-500"}>
                {formatSignedUsd(d7Pnl, privacyMode)}
              </span>
              {" / "}
              <span className={d30Pnl >= 0 ? "text-emerald-500" : "text-rose-500"}>
                {formatSignedUsd(d30Pnl, privacyMode)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Общий PnL ({hub.stats.total_trades} сд.)</div>
            <div
              className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                hub.stats.net_pnl_usd >= 0 ? "text-emerald-500" : "text-rose-500"
              }`}
            >
              {formatSignedUsd(hub.stats.net_pnl_usd, privacyMode)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground">Win Rate / Новостной фон</div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs font-bold tabular-nums">
              <span>{hub.stats.win_rate_pct.toFixed(1)}%</span>
              <Badge variant="outline" className="text-[9px] uppercase">
                {hub.news_digest.dominant_sentiment}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Contextual AI Market Brief Panel */}
      {aiResult ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Brain className="size-4 text-primary" />
              AI Обзор 24ч — {hub.code}
              {aiModel ? (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {aiModel}
                </Badge>
              ) : null}
            </CardTitle>
            <Button size="xs" variant="ghost" onClick={() => setAiResult(null)}>
              Закрыть
            </Button>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-xs leading-relaxed">{aiResult}</CardContent>
        </Card>
      ) : null}

      {/* Full-width Institutional Chart with MT5 Strategy Bands (SELL ZONE / FAIR / MEAN / BUY ZONE) (#40, #41) */}
      <InteractiveChartCanvas
        symbol={hub.code}
        mode="hub"
        height={460}
        robotZones={robotZones}
        onDataLoaded={handleChartDataLoaded}
      />

      {/* Linked Robots Selector + Real-Time MQL5 Robot Live HUD (#26, #40) */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bot className="size-4 text-emerald-500" />
            Торговые роботы актива {hub.code} ({robots.length})
          </CardTitle>
          <Link
            to="/dashboard/robots/new"
            className="inline-flex h-7 items-center rounded-md border border-input px-2.5 text-xs hover:bg-accent"
          >
            + Добавить робота
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {robots.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
              Роботы для символа <span className="font-mono font-semibold">{hub.code}</span> (включая{" "}
              <span className="font-mono">{hub.code}c / {hub.code}m</span>) пока не обнаружены. Как только советник в MT5
              отправит телеметрию или сделку, он появится здесь автоматически.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {robots.map((r) => {
                  const isSelected = activeRobot?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRobotId(r.id)}
                      className={`cursor-pointer rounded-lg border p-2.5 transition ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border/60 bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate font-semibold text-xs">{r.name}</div>
                        <Badge
                          variant={r.is_active ? "default" : "secondary"}
                          className="shrink-0 font-mono text-[9px]"
                        >
                          {r.live_status || (r.is_active ? "RUNNING" : "OFF")}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-1 font-mono text-[10px] text-muted-foreground">
                        <span>
                          {r.symbol || hub.code} • Magic #{r.magic_number}
                        </span>
                        {r.account_name ? <span>{r.account_name}</span> : null}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[10px]">
                        <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
                          <Activity className="size-3 text-emerald-500" />
                          {r.last_execution_ms ? `${r.last_execution_ms} ms` : "Live WS"}
                        </span>
                        <Link
                          to="/dashboard/robots/$robotId"
                          params={{ robotId: r.id }}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          Карточка
                          <ExternalLink className="size-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeRobot ? (
                <RobotTelemetryPanel
                  state={activeRobot.live_state_json}
                  title={`${activeRobot.name} (${activeRobot.symbol || hub.code} • Magic #${activeRobot.magic_number}) — Live HUD`}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Live WebSocket Order Book (DOM) & Single Combined Buy/Sell Tick Chart (#25) */}
      <OrderBookAndTicks symbol={hub.code} initialPrice={latestChartPrice} />

      {/* Tabbed Institutional Bottom Desk */}
      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="xs"
              variant={activeTab === "orders" ? "default" : "outline"}
              onClick={() => setActiveTab("orders")}
            >
              <ListOrdered className="mr-1 size-3.5" />
              Сделки ({dealsTotal})
            </Button>
            <Button
              size="xs"
              variant={activeTab === "positions" ? "default" : "outline"}
              onClick={() => setActiveTab("positions")}
            >
              <Layers className="mr-1 size-3.5" />
              Открытые позиции ({openPositions.length})
            </Button>
            <Button
              size="xs"
              variant={activeTab === "robots" ? "default" : "outline"}
              onClick={() => setActiveTab("robots")}
            >
              <Bot className="mr-1 size-3.5" />
              Роботы ({robots.length})
            </Button>
            <Button
              size="xs"
              variant={activeTab === "news" ? "default" : "outline"}
              onClick={() => setActiveTab("news")}
            >
              <Newspaper className="mr-1 size-3.5" />
              Новости ({hub.news_digest.total_articles})
            </Button>
            <Button
              size="xs"
              variant={activeTab === "calendar" ? "default" : "outline"}
              onClick={() => setActiveTab("calendar")}
            >
              <Calendar className="mr-1 size-3.5" />
              Календарь ({calEvents.length})
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
            <Badge variant="outline" className="text-emerald-500">
              Bull: {hub.news_digest.sentiment_breakdown.bullish}
            </Badge>
            <Badge variant="outline" className="text-rose-500">
              Bear: {hub.news_digest.sentiment_breakdown.bearish}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0 text-xs">
          {activeTab === "orders" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Тикет / ID</th>
                    <th className="px-3 py-2 font-medium">Время (UTC)</th>
                    <th className="px-3 py-2 font-medium">Символ</th>
                    <th className="px-3 py-2 font-medium">Тип</th>
                    <th className="px-3 py-2 font-medium">Лот</th>
                    <th className="px-3 py-2 font-medium">Цена</th>
                    <th className="px-3 py-2 font-medium">Робот</th>
                    <th className="px-3 py-2 text-right font-medium">Net PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {deals.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        {t.common.noData}
                      </td>
                    </tr>
                  ) : (
                    deals.map((d) => (
                      <tr key={d.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">{d.mt5_deal_ticket || d.id.slice(0, 8)}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{formatTerminalDateTime(d.timestamp)}</td>
                        <td className="px-3 py-2 font-mono">{d.symbol}</td>
                        <td className="px-3 py-2 font-mono uppercase">
                          <span className={d.side === "BUY" ? "text-emerald-500" : "text-rose-500"}>
                            {d.side}
                          </span>
                          {d.entry ? ` (${d.entry})` : ""}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{d.volume}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">{d.price}</td>
                        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                          {d.robot_name || "—"}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                            d.net_profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {formatSignedUsd(d.net_profit_usd, privacyMode)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PagerBar page={dealsPage} pageSize={DEFAULT_PAGE_SIZE} total={dealsTotal} onPage={setDealsPage} />
            </div>
          ) : activeTab === "positions" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border/60 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Тикет</th>
                    <th className="px-3 py-2 font-medium">Счёт</th>
                    <th className="px-3 py-2 font-medium">Символ</th>
                    <th className="px-3 py-2 font-medium">Сторона</th>
                    <th className="px-3 py-2 font-medium">Лот</th>
                    <th className="px-3 py-2 font-medium">Открытие / Тек.</th>
                    <th className="px-3 py-2 font-medium">SL / TP</th>
                    <th className="px-3 py-2 text-right font-medium">Плавающий PnL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-muted-foreground">
                        Открытых позиций по {hub.code} сейчас нет
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((p) => (
                      <tr key={p.position_ticket} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">#{p.position_ticket}</td>
                        <td className="px-3 py-2">{p.account_name || p.account_id.slice(0, 8)}</td>
                        <td className="px-3 py-2 font-mono">{p.symbol}</td>
                        <td
                          className={`px-3 py-2 font-mono font-semibold ${
                            p.side === "BUY" ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {p.side}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums">{p.volume}</td>
                        <td className="px-3 py-2 font-mono tabular-nums">
                          {p.open_price} → {p.current_price}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                          {p.sl || "—"} / {p.tp || "—"}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${
                            p.profit_usd >= 0 ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {formatSignedUsd(p.profit_usd, privacyMode)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : activeTab === "robots" ? (
            <div className="divide-y divide-border/50">
              {robots.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t.common.noData}</div>
              ) : (
                robots.map((r) => (
                  <Link
                    key={r.id}
                    to="/dashboard/robots/$robotId"
                    params={{ robotId: r.id }}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40"
                  >
                    <div>
                      <div className="font-semibold">{r.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {r.symbol || hub.code} • Magic #{r.magic_number}
                        {r.account_name ? ` • ${r.account_name} (${r.account_login})` : ""}
                      </div>
                    </div>
                    <Badge variant={r.is_active ? "default" : "secondary"}>
                      {r.live_status || (r.is_active ? "RUNNING" : "OFF")}
                    </Badge>
                  </Link>
                ))
              )}
            </div>
          ) : activeTab === "calendar" ? (
            <div className="divide-y divide-border/50">
              {calEvents.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">{t.common.noData}</div>
              ) : (
                calEvents.map((ev) => (
                  <Link
                    key={ev.id}
                    to="/dashboard/calendar/$eventId"
                    params={{ eventId: ev.id }}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-muted/40"
                  >
                    <div>
                      <div className="font-medium">{ev.title}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {ev.currency} • {ev.impact}
                        {ev.forecast ? ` • Прогноз: ${ev.forecast}` : ""}
                        {ev.actual ? ` • Факт: ${ev.actual}` : ""}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                      {formatTerminalDateTime(ev.event_time)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {hub.recent_news.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground">{t.common.noData}</p>
              ) : (
                hub.recent_news.map((item) => (
                  <Link
                    key={item.id}
                    to="/dashboard/news/$newsId"
                    params={{ newsId: item.id }}
                    className="block rounded-md border border-border/50 p-2.5 transition hover:border-primary/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {item.sentiment}
                      </Badge>
                    </div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {item.source} • {formatTerminalDateTime(item.published_at)}
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t.common.delete}
        description={`Удалить хаб актива ${hub.code} (${hub.name})?`}
        loading={busy}
        onConfirm={handleDelete}
      />
    </TerminalPageShell>
  );
}
