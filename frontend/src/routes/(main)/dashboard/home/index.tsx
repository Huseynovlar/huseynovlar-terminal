import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute, Link } from "@tanstack/react-router";

import {
  type FearGreedData,
  MarketMiniTreemap,
  type TreemapItem,
} from "@/components/dashboard/MarketMiniTreemap";
import { MarketSessionsTimeline } from "@/components/dashboard/MarketSessionsTimeline";
import {
  type EquityCurvePoint,
  type EquityPeriod,
  PortfolioEquityChart,
} from "@/components/dashboard/PortfolioEquityChart";
import {
  formatCountdown,
  formatSignedUsd,
  formatUsd,
} from "@/components/m5/chart-indicators";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents, useLiveSocket } from "@/framework/use-live-socket";
import { useMarketListStream } from "@/framework/use-market-list-stream";
import {
  type LiveNewsItem,
  stripHtmlSafe,
  useNewsStream,
} from "@/framework/use-news-stream";
import { formatTerminalClock, useUtcClock } from "@/framework/use-utc-clock";

export const Route = createFileRoute("/(main)/dashboard/home/")({
  component: HomeCommandCenterPage,
});

interface AccountPulse {
  id: string;
  name: string;
  mt5_login: string;
  currency: string;
  balance_usd: number;
  equity_usd: number;
  floating_pnl_usd: number;
  terminal_connected: boolean;
  algo_trading_enabled: boolean;
  last_seen_at: string | null;
}

interface RobotPulse {
  id: string;
  account_id: string;
  name: string;
  symbol: string;
  magic_number: number;
  live_status: string;
  is_active: boolean;
  seq: number;
  updated_at_utc: string;
  regime: string;
  rsi_m5: number | null;
  er_h1: number | null;
  day_pnl: number | null;
  last_heartbeat_at: string | null;
}

interface UpcomingEvent {
  id: string;
  title: string;
  currency: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
  event_time: string;
}

interface HomeSummary {
  server_time_utc: string;
  period: EquityPeriod;
  ticker_symbols: string[];
  kpis: {
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    today_pnl_usd: number;
    week_pnl_usd: number;
    month_pnl_usd: number;
    win_rate_30d_pct: number;
    profit_factor_30d: number;
    expectancy_30d_usd: number;
    accounts_count: number;
    connected_accounts_count: number;
    open_positions_count: number;
    active_robots_count: number;
    stale_robots_count: number;
  };
  equity_curve: EquityCurvePoint[];
  accounts_pulse: AccountPulse[];
  robots_pulse: RobotPulse[];
  treemap_us: TreemapItem[];
  treemap_crypto: TreemapItem[];
  fear_greed: FearGreedData | null;
  breaking_news: LiveNewsItem[];
  upcoming_events: UpcomingEvent[];
}

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CHF: "🇨🇭",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  NZD: "🇳🇿",
  CNY: "🇨🇳",
};

function formatTickerPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  if (price >= 10_000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
  if (price >= 100) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}

function formatAgeSec(isoStr: string | null | undefined, nowMs: number): {
  label: string;
  sec: number;
} {
  if (!isoStr) return { label: "—", sec: 99999 };
  const ts = Date.parse(isoStr);
  if (Number.isNaN(ts)) return { label: "—", sec: 99999 };
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return { label: `${sec}s`, sec };
  if (sec < 3600) return { label: `${Math.floor(sec / 60)}m`, sec };
  if (sec < 86400) return { label: `${Math.floor(sec / 3600)}h`, sec };
  return { label: `${Math.floor(sec / 86400)}d`, sec };
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3 font-sans">
      <div className="h-10 animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
      <div className="h-[34px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[56px] animate-pulse bg-[var(--bg-panel)]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
        <div className="h-[290px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-8" />
        <div className="flex flex-col gap-2 lg:col-span-4">
          <div className="h-[135px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
          <div className="h-[147px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-12">
        <div className="h-[250px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-4" />
        <div className="h-[250px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-4" />
        <div className="h-[250px] animate-pulse rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-4" />
      </div>
    </div>
  );
}

function HomeCommandCenterPage() {
  const [period, setPeriod] = useState<EquityPeriod>("7D");
  const [summary, setSummary] = useState<HomeSummary | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [curveLoading, setCurveLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const now = useUtcClock();
  const nowMs = now.getTime();

  const { connected: accountWsConnected, rttMs } = useLiveSocket();
  const livePortfolio = useTerminalStore((s) => s.livePortfolio);

  const tradeRefreshTimerRef = useRef<number | null>(null);

  // Single REST load on mount / period switch — ZERO periodic setInterval REST polling!
  const fetchSummary = useCallback(async (targetPeriod: EquityPeriod, silent: boolean) => {
    if (!silent) {
      setCurveLoading(true);
    }
    try {
      const data = await apiRequest<HomeSummary>(
        `/analytics/home-summary?period=${encodeURIComponent(targetPeriod)}`,
      );
      setSummary(data);
      setErrorMsg(null);
    } catch (err) {
      if (!silent) {
        setErrorMsg(err instanceof Error ? err.message : "Ошибка загрузки панели");
      }
    } finally {
      setInitialLoading(false);
      setCurveLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary(period, summary !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    return () => {
      if (tradeRefreshTimerRef.current !== null) {
        window.clearTimeout(tradeRefreshTimerRef.current);
      }
    };
  }, []);

  // Dedicated /ws/market subscription for Live Ticker Strip (auto-unsubscribes on unmount)
  const tickerSymbols = useMemo(
    () =>
      summary?.ticker_symbols?.length
        ? summary.ticker_symbols
        : ["BTCUSD", "XAUUSD", "USTEC", "EURUSD", "DXY", "US10Y"],
    [summary?.ticker_symbols],
  );
  const liveQuotes = useMarketListStream(tickerSymbols);
  const marketWsActive = Object.keys(liveQuotes).length > 0;

  // Dedicated /ws/news subscription (auto-unsubscribes on unmount)
  const handleLiveNews = useCallback((item: LiveNewsItem) => {
    setSummary((prev) => {
      if (!prev) return prev;
      if (prev.breaking_news.some((n) => n.id === item.id || n.title === item.title)) {
        return prev;
      }
      return {
        ...prev,
        breaking_news: [item, ...prev.breaking_news].slice(0, 12),
      };
    });
  }, []);
  const { connected: newsWsConnected } = useNewsStream(handleLiveNews);

  // Real-time /ws/account updates — patch in-memory state silently (zero flicker, zero polling)
  useLiveEvents(
    ["account_update", "robot_state", "robot_telemetry", "trade_event", "snapshot"],
    useCallback(
      (evt) => {
        const d = (evt.data ?? {}) as Record<string, unknown>;

        if (evt.type === "account_update" && d.account_id) {
          const accId = String(d.account_id);
          setSummary((prev) => {
            if (!prev) return prev;
            const nextAccounts = prev.accounts_pulse.map((a) =>
              a.id === accId
                ? {
                    ...a,
                    balance_usd:
                      d.balance_usd != null ? Number(d.balance_usd) : a.balance_usd,
                    equity_usd:
                      d.equity_usd != null ? Number(d.equity_usd) : a.equity_usd,
                    floating_pnl_usd:
                      d.floating_pnl_usd != null
                        ? Number(d.floating_pnl_usd)
                        : a.floating_pnl_usd,
                    terminal_connected:
                      d.terminal_connected != null
                        ? Boolean(d.terminal_connected)
                        : true,
                    last_seen_at: new Date().toISOString(),
                  }
                : a,
            );
            return { ...prev, accounts_pulse: nextAccounts };
          });
        }

        if (evt.type === "robot_state" || evt.type === "robot_telemetry") {
          const robotId = String(d.robot_id ?? d.id ?? "");
          if (robotId) {
            setSummary((prev) => {
              if (!prev) return prev;
              const nowIso = new Date().toISOString();
              const nextRobots = prev.robots_pulse.map((r) =>
                r.id === robotId
                  ? {
                      ...r,
                      live_status: d.live_status ? String(d.live_status) : r.live_status,
                      seq: d.seq != null ? Number(d.seq) : r.seq,
                      updated_at_utc: d.updated_at_utc
                        ? String(d.updated_at_utc)
                        : nowIso,
                      last_heartbeat_at: nowIso,
                      regime: d.regime ? String(d.regime) : r.regime,
                    }
                  : r,
              );
              return { ...prev, robots_pulse: nextRobots };
            });
          }
        }

        // Only refresh closed-deal stats silently when an actual deal closes
        if (evt.type === "trade_event") {
          if (tradeRefreshTimerRef.current !== null) {
            window.clearTimeout(tradeRefreshTimerRef.current);
          }
          tradeRefreshTimerRef.current = window.setTimeout(() => {
            void fetchSummary(period, true);
          }, 2000);
        }
      },
      [fetchSummary, period],
    ),
  );

  // Merge live WS portfolio metrics (all computed in USD on backend) without overriding closed-deal stats
  const kpis = useMemo(() => {
    const base = summary?.kpis;
    if (!base) return null;
    const totalBalance =
      livePortfolio && livePortfolio.accounts_count > 0
        ? livePortfolio.total_balance_usd
        : base.total_balance_usd;
    const totalEquity =
      livePortfolio && livePortfolio.accounts_count > 0
        ? livePortfolio.total_equity_usd
        : base.total_equity_usd;
    const totalFloating =
      livePortfolio && livePortfolio.accounts_count > 0
        ? livePortfolio.total_floating_pnl_usd
        : base.total_floating_pnl_usd;
    const openPositions =
      livePortfolio && livePortfolio.accounts_count > 0
        ? livePortfolio.open_positions_count
        : base.open_positions_count;

    return {
      ...base,
      total_balance_usd: totalBalance,
      total_equity_usd: totalEquity,
      total_floating_pnl_usd: totalFloating,
      open_positions_count: openPositions,
    };
  }, [summary?.kpis, livePortfolio]);

  // Live-patched equity curve tail point from WS equity
  const equityCurve = useMemo(() => {
    const pts = summary?.equity_curve ?? [];
    if (!pts.length || !kpis) return pts;
    const last = pts[pts.length - 1];
    if (Math.abs(last.equity_usd - kpis.total_equity_usd) < 0.005) return pts;
    const updatedLast: EquityCurvePoint = {
      ...last,
      equity_usd: kpis.total_equity_usd,
    };
    return [...pts.slice(0, -1), updatedLast];
  }, [summary?.equity_curve, kpis]);

  // Group robots by account_id for the Accounts & Robots Pulse panel
  const robotsByAccount = useMemo(() => {
    const map = new Map<string, RobotPulse[]>();
    for (const r of summary?.robots_pulse ?? []) {
      const list = map.get(r.account_id) ?? [];
      list.push(r);
      map.set(r.account_id, list);
    }
    return map;
  }, [summary?.robots_pulse]);

  // Compute live stale robots count based on current UTC clock (>15s without heartbeat)
  const liveStaleRobotsCount = useMemo(() => {
    let count = 0;
    for (const r of summary?.robots_pulse ?? []) {
      if (!r.is_active) continue;
      const age = formatAgeSec(r.last_heartbeat_at ?? r.updated_at_utc, nowMs);
      if (age.sec > 15 || r.live_status.toUpperCase().includes("ERR")) {
        count += 1;
      }
    }
    return count;
  }, [summary?.robots_pulse, nowMs]);

  const bridgeConnectedCount = useMemo(
    () => (summary?.accounts_pulse ?? []).filter((a) => a.terminal_connected).length,
    [summary?.accounts_pulse],
  );

  if (initialLoading && !summary) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="flex min-h-[calc(100vh-52px)] flex-col gap-2 bg-[var(--bg-canvas)] p-3 font-sans text-[var(--text-primary)]">
      {/* 1. HEADER (40px) */}
      <header className="flex h-10 shrink-0 items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">
            Главная панель
          </h1>
          <span className="h-3.5 w-px bg-[var(--border-subtle)]" />
          <span className="text-[12px] font-medium tabular-nums text-[var(--text-secondary)]">
            {(() => {
              const clk = formatTerminalClock(now);
              return `${clk.time} ${clk.label}`;
            })()}
          </span>
        </div>

        {/* Unified WS Channels Indicator with Tooltip */}
        <div className="group relative flex items-center gap-2">
          <div
            className="flex cursor-default items-center gap-1.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px] font-medium tabular-nums"
            title={`/ws/account: ${accountWsConnected ? "LIVE" : "OFF"} | /ws/market: ${marketWsActive ? "LIVE" : "SUB"} | /ws/news: ${newsWsConnected ? "LIVE" : "OFF"} | MT5 Bridge: ${bridgeConnectedCount}/${summary?.accounts_pulse.length ?? 0}`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: accountWsConnected
                  ? "var(--bull)"
                  : "var(--accent-amber)",
              }}
            />
            <span className="text-[var(--text-primary)]">
              {accountWsConnected ? "WS LIVE" : "WS SYNC"}
            </span>
            {rttMs != null && (
              <span className="text-[10px] text-[var(--text-muted)]">{rttMs}ms</span>
            )}
          </div>

          {/* Hover Channel Breakdown Popover */}
          <div className="pointer-events-none absolute right-0 top-full z-40 mt-1 hidden w-56 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2.5 text-[11px] group-hover:block">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Каналы телеметрии
            </div>
            <div className="space-y-1 tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/account</span>
                <span
                  className="font-semibold"
                  style={{
                    color: accountWsConnected ? "var(--bull)" : "var(--bear)",
                  }}
                >
                  {accountWsConnected ? "● LIVE" : "○ OFF"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/market</span>
                <span
                  className="font-semibold"
                  style={{
                    color: marketWsActive ? "var(--bull)" : "var(--accent-amber)",
                  }}
                >
                  {marketWsActive
                    ? `● ${Object.keys(liveQuotes).length} тик.`
                    : "● SUB"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/news</span>
                <span
                  className="font-semibold"
                  style={{
                    color: newsWsConnected ? "var(--bull)" : "var(--bear)",
                  }}
                >
                  {newsWsConnected ? "● LIVE" : "○ OFF"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">MT5 Bridge</span>
                <span
                  className="font-semibold"
                  style={{
                    color:
                      bridgeConnectedCount > 0 ? "var(--bull)" : "var(--text-muted)",
                  }}
                >
                  {bridgeConnectedCount}/{summary?.accounts_pulse.length ?? 0} онл.
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {errorMsg && (
        <div className="rounded-[4px] border border-[var(--bear)]/40 bg-[var(--bear)]/10 px-3 py-1.5 text-[11px] text-[var(--bear)]">
          {errorMsg}
        </div>
      )}

      {/* 2. LIVE TICKER STRIP (34px) — Real WS prices only, zero broken ASS stubs */}
      <section className="flex h-[34px] shrink-0 items-center gap-1 overflow-x-auto rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 [scrollbar-width:none]">
        {tickerSymbols.map((rawSym) => {
          const sym = canonicalMarketSymbol(rawSym);
          const q = liveQuotes[sym];
          const chg = q?.changePct ?? null;
          const chgColor =
            chg == null
              ? "var(--text-muted)"
              : chg > 0
                ? "var(--bull)"
                : chg < 0
                  ? "var(--bear)"
                  : "var(--text-secondary)";

          return (
            <Link
              key={sym}
              to="/dashboard/tickers/$symbol"
              params={{ symbol: sym }}
              className="flex shrink-0 items-center gap-1.5 rounded-[3px] border border-transparent px-2 py-1 text-[11px] tabular-nums transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]"
            >
              <AssetLogo symbol={sym} size={16} />
              <span className="font-semibold text-[var(--text-primary)]">{sym}</span>
              <span className="font-medium text-[var(--text-secondary)]">
                {q ? formatTickerPrice(q.price) : "—"}
              </span>
              {chg != null && (
                <span className="text-[10px] font-semibold" style={{ color: chgColor }}>
                  {chg >= 0 ? "+" : ""}
                  {chg.toFixed(2)}%
                </span>
              )}
            </Link>
          );
        })}
      </section>

      {/* 3. KPI STRIP (56px, 6 cells separated by 1px, strictly server-computed USD) */}
      {kpis && (
        <section className="grid shrink-0 grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-6">
          {/* 1. Баланс портфеля */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Баланс портфеля
            </span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="text-[16px] font-semibold leading-tight text-[var(--text-primary)]">
                {formatUsd(kpis.total_balance_usd)}
              </span>
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                {kpis.connected_accounts_count}/{kpis.accounts_count} счетов
              </span>
            </div>
          </div>

          {/* 2. Эквити (Live) */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Эквити (Live)
            </span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="text-[16px] font-semibold leading-tight text-[var(--text-primary)]">
                {formatUsd(kpis.total_equity_usd)}
              </span>
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                {kpis.open_positions_count} откр. поз.
              </span>
            </div>
          </div>

          {/* 3. Плавающий PnL */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Плавающий PnL
            </span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span
                className="text-[16px] font-semibold leading-tight"
                style={{
                  color:
                    kpis.total_floating_pnl_usd > 0
                      ? "var(--bull)"
                      : kpis.total_floating_pnl_usd < 0
                        ? "var(--bear)"
                        : "var(--text-primary)",
                }}
              >
                {formatSignedUsd(kpis.total_floating_pnl_usd)}
              </span>
              <span className="truncate text-[10px] text-[var(--bull)]">
                ● /ws/account
              </span>
            </div>
          </div>

          {/* 4. PnL сегодня / 7 дней */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              PnL сегодня / 7Д
            </span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span
                className="text-[16px] font-semibold leading-tight"
                style={{
                  color:
                    kpis.today_pnl_usd > 0
                      ? "var(--bull)"
                      : kpis.today_pnl_usd < 0
                        ? "var(--bear)"
                        : "var(--text-primary)",
                }}
              >
                {formatSignedUsd(kpis.today_pnl_usd)}
              </span>
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                7Д:{" "}
                <span
                  style={{
                    color:
                      kpis.week_pnl_usd >= 0 ? "var(--bull)" : "var(--bear)",
                  }}
                >
                  {formatSignedUsd(kpis.week_pnl_usd)}
                </span>
              </span>
            </div>
          </div>

          {/* 5. Винрейт / PF (30д) */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Винрейт / PF (30д)
            </span>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="text-[16px] font-semibold leading-tight text-[var(--text-primary)]">
                {kpis.win_rate_30d_pct.toFixed(1)}%
              </span>
              <span className="truncate text-[10px] text-[var(--text-muted)]">
                PF {kpis.profit_factor_30d.toFixed(2)} · Exp{" "}
                {formatSignedUsd(kpis.expectancy_30d_usd)}
              </span>
            </div>
          </div>

          {/* 6. Торговые роботы */}
          <div className="flex h-[56px] flex-col justify-center bg-[var(--bg-panel)] px-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
                Торговые роботы
              </span>
              <Link
                to="/dashboard/robots"
                className="text-[10px] font-medium text-[var(--accent-blue)] hover:underline"
              >
                Роботы →
              </Link>
            </div>
            <div className="flex items-baseline justify-between gap-2 tabular-nums">
              <span className="text-[16px] font-semibold leading-tight text-[var(--text-primary)]">
                {kpis.active_robots_count}{" "}
                <span className="text-[11px] font-normal text-[var(--text-muted)]">
                  акт.
                </span>
              </span>
              {liveStaleRobotsCount > 0 ? (
                <span className="rounded-[3px] border border-[var(--bear)]/40 bg-[var(--bear)]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[var(--bear)]">
                  STALE {liveStaleRobotsCount}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-[var(--bull)]">
                  ● OK
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 4. MIDDLE ROW: Equity Curve (66% / 8 cols) + Sessions & Macro Events (34% / 4 cols) */}
      <section className="grid grid-cols-1 gap-2 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <PortfolioEquityChart
            points={equityCurve}
            period={period}
            onPeriodChange={setPeriod}
            loading={curveLoading}
          />
        </div>

        <div className="flex flex-col gap-2 lg:col-span-4">
          {/* 24h UTC Sessions Timeline */}
          <MarketSessionsTimeline now={now} />

          {/* Top-3 Macro Events */}
          <div className="flex flex-1 flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Макро-события (Топ-3)
              </span>
              <Link
                to="/dashboard/calendar"
                className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
              >
                Календарь →
              </Link>
            </div>

            <div className="flex flex-1 flex-col divide-y divide-[var(--border-subtle)]">
              {(summary?.upcoming_events ?? []).length > 0 ? (
                (summary?.upcoming_events ?? []).slice(0, 3).map((ev) => {
                  const isHigh = ev.impact.toLowerCase().includes("high");
                  const flag = CURRENCY_FLAGS[ev.currency.toUpperCase()] ?? "🌐";
                  return (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-7 w-[3px] shrink-0 rounded-[1px]"
                          style={{
                            backgroundColor: isHigh
                              ? "var(--bear)"
                              : "var(--accent-amber)",
                          }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px]">{flag}</span>
                            <span className="text-[10px] font-semibold uppercase text-[var(--text-secondary)]">
                              {ev.currency}
                            </span>
                            <span className="truncate font-medium text-[var(--text-primary)]">
                              {stripHtmlSafe(ev.title)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-[var(--text-muted)]">
                            <span>F: {ev.forecast || "—"}</span>
                            <span>P: {ev.previous || "—"}</span>
                            {ev.actual && (
                              <span className="font-semibold text-[var(--text-primary)]">
                                A: {ev.actual}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right tabular-nums">
                        <div className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-amber)]">
                          T-{formatCountdown(ev.event_time, now)}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-1 items-center justify-center px-3 py-4 text-[11px] text-[var(--text-muted)]">
                  Нет ближайших макро-событий
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 5. BOTTOM ROW: 3 Columns (33% Accounts+Robots | 33% Mini-Treemap | 34% Breaking News) */}
      <section className="grid flex-1 grid-cols-1 gap-2 lg:grid-cols-12">
        {/* Col 1 (33% / 4 cols): Пульс счетов MT5 и Роботов */}
        <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
              Пульс счетов MT5 и Роботов
            </span>
            <Link
              to="/dashboard/accounts"
              className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
            >
              Счета →
            </Link>
          </div>

          <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto max-h-[300px]">
            {(summary?.accounts_pulse ?? []).length > 0 ? (
              (summary?.accounts_pulse ?? []).map((acc) => {
                const accRobots = robotsByAccount.get(acc.id) ?? [];
                const isCent = acc.currency.toUpperCase() === "USC";
                const accAge = formatAgeSec(acc.last_seen_at, nowMs);

                return (
                  <div key={acc.id} className="px-3 py-2">
                    {/* Account header row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: acc.terminal_connected
                              ? "var(--bull)"
                              : "var(--text-muted)",
                          }}
                        />
                        <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                          {acc.name}
                        </span>
                        {isCent && (
                          <span className="shrink-0 rounded-[3px] border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 px-1 py-0.2 text-[9px] font-semibold text-[var(--accent-blue)]">
                            USC → USD
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
                        <span className="font-semibold text-[var(--text-primary)]">
                          {formatUsd(acc.balance_usd)}
                        </span>
                        <span
                          className="font-medium"
                          style={{
                            color:
                              acc.floating_pnl_usd > 0
                                ? "var(--bull)"
                                : acc.floating_pnl_usd < 0
                                  ? "var(--bear)"
                                  : "var(--text-muted)",
                          }}
                        >
                          {formatSignedUsd(acc.floating_pnl_usd)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
                      <span>MT5 #{acc.mt5_login}</span>
                      <span>
                        Eq {formatUsd(acc.equity_usd)} · {accAge.label}
                      </span>
                    </div>

                    {/* Grouped Robots under this account */}
                    {accRobots.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-l-2 border-[var(--border-subtle)] pl-2">
                        {accRobots.map((r) => {
                          const age = formatAgeSec(
                            r.last_heartbeat_at ?? r.updated_at_utc,
                            nowMs,
                          );
                          const isStale =
                            age.sec > 15 ||
                            r.live_status.toUpperCase().includes("ERR");

                          return (
                            <div
                              key={r.id}
                              className="flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium text-[var(--text-secondary)]">
                                  {r.name}
                                </span>
                                <span className="rounded-[2px] bg-[var(--bg-canvas)] px-1 text-[10px] text-[var(--text-muted)]">
                                  {r.symbol}
                                </span>
                              </div>

                              <div className="flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
                                {isStale ? (
                                  <span className="rounded-[3px] border border-[var(--bear)]/40 bg-[var(--bear)]/15 px-1.5 py-0.5 font-semibold text-[var(--bear)]">
                                    STALE · {age.label}
                                  </span>
                                ) : (
                                  <span className="rounded-[3px] border border-[var(--bull)]/30 bg-[var(--bull)]/10 px-1.5 py-0.5 font-medium text-[var(--bull)]">
                                    ● WS · seq #{r.seq} · {age.label}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-8 text-[11px] text-[var(--text-muted)]">
                Нет подключённых MT5 счетов
              </div>
            )}
          </div>
        </div>

        {/* Col 2 (33% / 4 cols): Пульс рынка и секторов (ECharts Mini-Treemap + F&G) */}
        <div className="lg:col-span-4">
          <MarketMiniTreemap
            usItems={summary?.treemap_us ?? []}
            cryptoItems={summary?.treemap_crypto ?? []}
            fearGreed={summary?.fear_greed ?? null}
          />
        </div>

        {/* Col 3 (34% / 4 cols): Срочные новости (/ws/news, sanitized plain text) */}
        <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:col-span-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Срочные новости
              </span>
              <span
                className="text-[10px] font-medium tabular-nums"
                style={{
                  color: newsWsConnected ? "var(--bull)" : "var(--text-muted)",
                }}
              >
                {newsWsConnected ? "● /ws/news" : "○ /ws/news"}
              </span>
            </div>
            <Link
              to="/dashboard/news"
              className="text-[11px] font-medium text-[var(--accent-blue)] hover:underline"
            >
              Лента новостей →
            </Link>
          </div>

          <div className="flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto max-h-[300px]">
            {(summary?.breaking_news ?? []).length > 0 ? (
              (summary?.breaking_news ?? []).slice(0, 10).map((n) => {
                const sent = (n.sentiment || "").toUpperCase();
                const isBull = sent === "BULLISH" || sent === "BULL";
                const isBear = sent === "BEARISH" || sent === "BEAR";
                const isHigh = n.is_breaking || n.impact_score >= 7;
                const age = formatAgeSec(n.published_at, nowMs);

                return (
                  <div
                    key={n.id}
                    className="px-3 py-2 transition-colors hover:bg-[var(--bg-elevated)]/40"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <div className="flex items-center gap-1.5">
                        {isHigh && (
                          <span className="rounded-[2px] border border-[var(--bear)]/40 bg-[var(--bear)]/15 px-1 py-0.2 font-semibold uppercase text-[var(--bear)]">
                            HIGH
                          </span>
                        )}
                        {isBull && (
                          <span className="rounded-[2px] border border-[var(--bull)]/40 bg-[var(--bull)]/15 px-1 py-0.2 font-semibold uppercase text-[var(--bull)]">
                            BULL
                          </span>
                        )}
                        {isBear && (
                          <span className="rounded-[2px] border border-[var(--bear)]/40 bg-[var(--bear)]/15 px-1 py-0.2 font-semibold uppercase text-[var(--bear)]">
                            BEAR
                          </span>
                        )}
                        <span className="truncate font-medium text-[var(--text-muted)]">
                          {n.source}
                        </span>
                      </div>
                      <span className="shrink-0 tabular-nums text-[var(--text-muted)]">
                        {age.label} ago
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--text-primary)]">
                      {stripHtmlSafe(n.title)}
                    </p>
                  </div>
                );
              })
            ) : (
              <div className="flex h-full items-center justify-center px-3 py-8 text-[11px] text-[var(--text-muted)]">
                Ожидание новостей по /ws/news...
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
