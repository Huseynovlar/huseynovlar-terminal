import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  MoreVertical,
  Pencil,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { formatSignedUsd, formatUsd } from "@/components/m5/chart-indicators";
import {
  type ChartBundleResponse,
  type ChartMarketStats,
  KLineChartPro,
  type Mt5ZoneLevels,
} from "@/components/terminal/KLineChartPro";
import {
  formatDynamicVolume,
  MicrostructurePanel,
} from "@/components/terminal/MicrostructurePanel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notify } from "@/components/ui/toast";
import { apiRequest, apiRequestPaged } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveEvents } from "@/framework/use-live-socket";
import {
  type MarketLiquidationEvent,
  type MarketOrderbookEvent,
  type MarketTickEvent,
  useMarketStream,
} from "@/framework/use-market-stream";
import { formatTerminalDateTime } from "@/framework/use-utc-clock";

interface PortfolioAccountRow {
  id: string;
  name: string;
  mt5_login: string;
  currency: string;
  last_balance_usd: number;
  last_equity_usd: number;
  last_floating_pnl_usd?: number;
  terminal_connected: boolean;
}

interface PortfolioRobotRow {
  id: string;
  account_id: string;
  account_name?: string;
  account_login?: string;
  account_currency?: string;
  name: string;
  program_name?: string;
  version?: string;
  magic_number: number;
  symbol: string;
  live_status?: string;
  live_state_json?: Record<string, unknown>;
  seq?: number;
  updated_at_utc?: string;
  last_execution_ms?: number;
  last_heartbeat_at?: string | null;
  is_active: boolean;
}

interface OpenPositionRow {
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

interface NewsRow {
  id: string;
  title: string;
  source: string;
  sentiment: string;
  verification_count?: number;
  verified_source_count?: number;
  published_at: string;
  url?: string;
}

interface CalendarRow {
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
  stats: {
    accounts_count: number;
    robots_count: number;
    open_positions_count: number;
    total_balance_usd: number;
    total_equity_usd: number;
    total_floating_pnl_usd: number;
    pnl_24h_usd?: number;
    pnl_7d_usd?: number;
    pnl_30d_usd?: number;
    total_trades: number;
    win_rate_pct: number;
    net_pnl_usd: number;
  };
  accounts: PortfolioAccountRow[];
  robots: PortfolioRobotRow[];
  open_positions?: OpenPositionRow[];
  calendar_events?: CalendarRow[];
  recent_news?: NewsRow[];
}

interface MarketTickerMeta {
  symbol: string;
  name: string;
  asset_class: string;
  exchange: string;
  broker_symbols?: string[];
  news_keywords?: string[];
}

type DockTab = "robots" | "positions" | "deals" | "news" | "calendar" | "derivatives";

const LS_RIGHT_W = "ht:asset-terminal:right-width";
const LS_DOCK_H = "ht:asset-terminal:dock-height";

function readNumStorage(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = Number(window.localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min && raw <= max) return raw;
  } catch {
    // ignore
  }
  return fallback;
}

function formatQuotePrice(p: number | null | undefined): string {
  if (!p || !Number.isFinite(p) || p <= 0) return "—";
  if (p < 10) return p.toFixed(5);
  if (p < 100) return p.toFixed(3);
  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatRelativeAge(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function extractTelemetryNum(state: Record<string, unknown> | undefined, key: string): number | null {
  if (!state) return null;
  const nested =
    state.telemetry && typeof state.telemetry === "object"
      ? (state.telemetry as Record<string, unknown>)
      : {};
  const val = nested[key] ?? state[key];
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export interface AssetTerminalViewProps {
  symbol: string;
  mode: "portfolio" | "market";
}

/**
 * Universal institutional Bloomberg-grade Asset Terminal View (`100vh` Cockpit Grid).
 * Reused across both:
 * - "Мои активы" (`mode="portfolio"`): server-computed USD KPIs, MT5 Zones, active MT5 robots strip & personal dock tabs.
 * - "Справочник рынков" (`mode="market"`): 24h market statistics, clean market chart & "★ Добавить в Мои активы" action.
 */
export function AssetTerminalView({ symbol, mode }: AssetTerminalViewProps) {
  const navigate = useNavigate();
  const privacyMode = useTerminalStore((s) => s.privacyMode);
  const canonSym = useMemo(() => canonicalMarketSymbol(symbol), [symbol]);

  // Resizable cockpit layout persisted in localStorage
  const [rightWidth, setRightWidth] = useState<number>(() => readNumStorage(LS_RIGHT_W, 290, 250, 420));
  const [dockHeight, setDockHeight] = useState<number>(() => readNumStorage(LS_DOCK_H, 200, 120, 420));
  const [dockCollapsed, setDockCollapsed] = useState(false);

  // Domain state
  const [hub, setHub] = useState<AssetHubDetail | null>(null);
  const [tickerMeta, setTickerMeta] = useState<MarketTickerMeta | null>(null);
  const [deals, setDeals] = useState<DealRow[]>([]);
  const [marketNews, setMarketNews] = useState<NewsRow[]>([]);
  const [marketCalendar, setMarketCalendar] = useState<CalendarRow[]>([]);
  const [marketStats, setMarketStats] = useState<ChartMarketStats | null>(null);
  const [derivativesData, setDerivativesData] = useState<{
    kind: string;
    sources: string[];
    metrics: Record<string, number>;
    cot: {
      report_date: string;
      market: string;
      open_interest: number;
      noncomm_long: number;
      noncomm_short: number;
      noncomm_net: number;
      comm_net: number;
    } | null;
    treasury: Array<{ security: string; rate_pct: number; date: string }>;
  } | null>(null);

  // Live market WS state
  const [latestTick, setLatestTick] = useState<MarketTickEvent | null>(null);
  const [latestOrderbook, setLatestOrderbook] = useState<MarketOrderbookEvent | null>(null);
  const [liquidations, setLiquidations] = useState<MarketLiquidationEvent[]>([]);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [priceFlash, setPriceFlash] = useState<"bull" | "bear" | null>(null);
  const prevPriceRef = useRef<number | null>(null);

  // UI controls
  const [selectedRobotId, setSelectedRobotId] = useState<string | null>(null);
  const [dockTab, setDockTab] = useState<DockTab>(mode === "portfolio" ? "robots" : "news");
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherQuery, setSwitcherQuery] = useState("");
  const [switcherOptions, setSwitcherOptions] = useState<Array<{ code: string; name: string; group: string }>>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const [inPortfolio, setInPortfolio] = useState(mode === "portfolio");

  // Load quick switcher options when opened
  useEffect(() => {
    if (!switcherOpen) return;
    let active = true;
    const q = switcherQuery.trim();
    if (mode === "portfolio") {
      apiRequestPaged<{ code: string; name: string; group: string }>(
        `/assets${q ? `?q=${encodeURIComponent(q)}` : ""}`,
        1,
        25,
      )
        .then((res) => {
          if (active) setSwitcherOptions(res.items ?? []);
        })
        .catch(() => {});
    } else {
      apiRequestPaged<{ symbol: string; name: string; asset_class: string }>(
        `/assets/tickers${q ? `?q=${encodeURIComponent(q)}` : ""}`,
        1,
        25,
      )
        .then((res) => {
          if (active) {
            setSwitcherOptions(
              (res.items ?? []).map((x) => ({ code: x.symbol, name: x.name, group: x.asset_class })),
            );
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [switcherOpen, switcherQuery, mode]);

  // AI Brief state (plain text + bullets only, no Markdown tables)
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModel, setAiModel] = useState("");
  const [aiText, setAiText] = useState<string | null>(null);

  // Reset dock tab if mode switches
  useEffect(() => {
    setDockTab(mode === "portfolio" ? "robots" : "news");
    setInPortfolio(mode === "portfolio");
    setDerivativesData(null);
  }, [mode, canonSym]);

  // Lazy-load live derivatives / CFTC COT / US Treasury when tab is active
  useEffect(() => {
    if (dockTab !== "derivatives" || !canonSym) return;
    let active = true;
    apiRequest<typeof derivativesData>(`/intelligence/derivatives/${encodeURIComponent(canonSym)}`)
      .then((res) => {
        if (active && res) setDerivativesData(res);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [dockTab, canonSym]);

  // Dedicated `/api/v1/ws/market` stream with automatic `unsubscribe` on symbol change / unmount
  const { health: feedHealth, provider: feedProvider, latencyMs: feedLatencyMs } = useMarketStream({
    symbol: canonSym,
    onTick: (tk) => {
      setLatestTick(tk);
      const nextP = tk.price > 0 ? tk.price : tk.bid;
      if (nextP > 0) {
        const prev = prevPriceRef.current;
        if (prev !== null && nextP !== prev) {
          setPriceFlash(nextP > prev ? "bull" : "bear");
          window.setTimeout(() => setPriceFlash(null), 160);
        }
        prevPriceRef.current = nextP;
        setLivePrice(nextP);
      }
    },
    onOrderbook: (ob) => {
      setLatestOrderbook(ob);
    },
    onLiquidation: (liq) => {
      setLiquidations((prev) => [liq, ...prev].slice(0, 40));
    },
  });

  // Load initial portfolio or market metadata (zero REST polling!)
  const loadData = useCallback(async () => {
    if (mode === "portfolio") {
      try {
        const [h, dRes] = await Promise.all([
          apiRequest<AssetHubDetail>(`/assets/${encodeURIComponent(symbol)}`),
          apiRequestPaged<DealRow>(`/journal/deals?symbol=${encodeURIComponent(symbol)}`, 1, 50).catch(() => ({
            items: [] as DealRow[],
            total: 0,
          })),
        ]);
        setHub(h);
        setDeals(dRes.items);
        setMarketNews(h.recent_news ?? []);
        setMarketCalendar(h.calendar_events ?? []);
      } catch (err) {
        notify.error("Ошибка загрузки актива", err instanceof Error ? err.message : String(err));
      }
    } else {
      try {
        const [tRes, nRes, cRes] = await Promise.all([
          apiRequest<MarketTickerMeta[]>(`/assets/tickers?q=${encodeURIComponent(canonSym)}&limit=5`).catch(() => []),
          apiRequest<NewsRow[]>(`/intelligence/news/explore?symbol=${encodeURIComponent(canonSym)}`).catch(() => []),
          apiRequestPaged<CalendarRow>("/intelligence/calendar", 1, 20).catch(() => ({ items: [] as CalendarRow[] })),
        ]);
        const list = Array.isArray(tRes) ? tRes : [];
        const exact = list.find((r) => r.symbol.toUpperCase() === canonSym) ?? list[0] ?? null;
        setTickerMeta(exact);
        setMarketNews(Array.isArray(nRes) ? nRes : []);
        setMarketCalendar(Array.isArray(cRes.items) ? cRes.items : []);
        // Check if already in portfolio silently
        apiRequest<AssetHubDetail>(`/assets/${encodeURIComponent(canonSym)}`)
          .then(() => setInPortfolio(true))
          .catch(() => setInPortfolio(false));
      } catch {
        // ignore
      }
    }
  }, [mode, symbol, canonSym]);

  useEffect(() => {
    setSelectedRobotId(null);
    setLatestTick(null);
    setLatestOrderbook(null);
    setLiquidations([]);
    setLivePrice(null);
    prevPriceRef.current = null;
    void loadData();
  }, [loadData]);

  // Live `/ws/account` (and `/ws/live`) telemetry updates in portfolio mode (zero polling)
  useLiveEvents(["snapshot", "robot_state", "robot_telemetry", "trade_event", "breaking_news"], (evt) => {
    if (mode !== "portfolio") return;
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
        const totalFl = Number(nextAccounts.reduce((s, a) => s + (a.last_floating_pnl_usd ?? 0), 0).toFixed(2));
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
      if (!rId && rSym !== canonSym) return;
      setHub((prev) => {
        if (!prev) return prev;
        const exists = prev.robots.some(
          (r) =>
            r.id === rId ||
            (d.magic_number &&
              r.magic_number === Number(d.magic_number) &&
              r.account_id === String(d.account_id ?? "")),
        );
        if (!exists && rSym === canonSym && rId) {
          const added: PortfolioRobotRow = {
            id: rId,
            account_id: String(d.account_id ?? ""),
            account_name: String(d.account_name ?? ""),
            account_login: String(d.account_login ?? ""),
            name: String(d.name ?? `EA #${String(d.magic_number ?? "")}`),
            magic_number: Number(d.magic_number ?? 0),
            symbol: String(d.symbol ?? prev.code),
            live_status: String(d.live_status ?? "RUNNING"),
            live_state_json:
              d.live_state_json && typeof d.live_state_json === "object"
                ? (d.live_state_json as Record<string, unknown>)
                : {},
            seq: Number(d.seq ?? 0),
            updated_at_utc: String(d.updated_at_utc ?? d.last_heartbeat_at ?? new Date().toISOString()),
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
        const nextRobots = prev.robots.map((r) => {
          const match =
            r.id === rId ||
            (d.magic_number &&
              r.magic_number === Number(d.magic_number) &&
              r.account_id === String(d.account_id ?? ""));
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
            seq: Number(d.seq ?? incomingState.seq ?? r.seq ?? 0),
            updated_at_utc: String(
              d.updated_at_utc ?? incomingState.updated_at_utc ?? d.last_heartbeat_at ?? r.updated_at_utc ?? "",
            ),
            last_execution_ms: Number(d.last_execution_ms ?? r.last_execution_ms ?? 0),
            last_heartbeat_at: String(d.last_heartbeat_at ?? r.last_heartbeat_at ?? ""),
          };
        });
        return { ...prev, robots: nextRobots };
      });
      return;
    }

    if (evt.type === "trade_event" || evt.type === "breaking_news") {
      void loadData();
    }
  });

  const handleBundleLoaded = useCallback((bundle: ChartBundleResponse) => {
    if (bundle.market_stats) {
      setMarketStats(bundle.market_stats);
      if (bundle.market_stats.price > 0 && prevPriceRef.current === null) {
        prevPriceRef.current = bundle.market_stats.price;
        setLivePrice(bundle.market_stats.price);
      }
    } else if (bundle.bars.length > 0) {
      const last = bundle.bars[bundle.bars.length - 1]!;
      if (last.close > 0 && prevPriceRef.current === null) {
        prevPriceRef.current = last.close;
        setLivePrice(last.close);
      }
    }
  }, []);

  const robots = hub?.robots ?? [];
  const openPositions = hub?.open_positions ?? [];

  const activeRobot = useMemo(() => {
    if (robots.length === 0) return null;
    if (selectedRobotId) {
      const f = robots.find((r) => r.id === selectedRobotId);
      if (f) return f;
    }
    return robots.find((r) => r.live_state_json && Object.keys(r.live_state_json).length > 0) ?? robots[0] ?? null;
  }, [robots, selectedRobotId]);

  const mt5Zones: Mt5ZoneLevels | null = useMemo(() => {
    if (mode !== "portfolio" || !activeRobot) return null;
    const st = activeRobot.live_state_json;
    const sellZone = extractTelemetryNum(st, "bb_upper");
    const fair = extractTelemetryNum(st, "vwap");
    const mean = extractTelemetryNum(st, "bb_mid");
    const buyZone = extractTelemetryNum(st, "bb_lower");
    return {
      sellZone: sellZone && sellZone > 0 ? sellZone : null,
      fair: fair && fair > 0 ? fair : null,
      mean: mean && mean > 0 ? mean : null,
      buyZone: buyZone && buyZone > 0 ? buyZone : null,
      label: activeRobot.name,
    };
  }, [mode, activeRobot]);

  // Interactive drag-resize handlers
  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;
    const onMove = (mv: MouseEvent) => {
      const next = Math.max(280, Math.min(460, startW + (startX - mv.clientX)));
      setRightWidth(next);
      try {
        window.localStorage.setItem(LS_RIGHT_W, String(Math.round(next)));
      } catch {
        // ignore
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDockResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDockCollapsed(false);
    const startY = e.clientY;
    const startH = dockHeight;
    const onMove = (mv: MouseEvent) => {
      const next = Math.max(120, Math.min(420, startH + (startY - mv.clientY)));
      setDockHeight(next);
      try {
        window.localStorage.setItem(LS_DOCK_H, String(Math.round(next)));
      } catch {
        // ignore
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  async function handleAiBrief() {
    setAiOpen(true);
    setAiLoading(true);
    try {
      const res = await apiRequest<{ response_md?: string; content_md?: string; summary?: string; model?: string }>(
        "/intelligence/ai/analyze",
        {
          method: "POST",
          body: JSON.stringify({
            mode: "asset_deep_dive",
            symbol: canonSym,
            prompt: `Сделай краткий обзор по активу ${canonSym} (${displayName}) за 24ч: ключевые уровни, новости, риски. Строго чистый текст и буллеты, без таблиц.`,
          }),
        },
      );
      setAiModel(res.model || "AI");
      setAiText(res.response_md || res.content_md || res.summary || "Анализ завершён.");
    } catch (err) {
      notify.error("Ошибка AI Обзора", err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleAddToPortfolio() {
    setAddingPortfolio(true);
    try {
      const created = await apiRequest<{ id: string; code: string }>("/assets", {
        method: "POST",
        body: JSON.stringify({
          code: canonSym,
          name: tickerMeta?.name || canonSym,
          group: tickerMeta?.asset_class || "markets",
          category: tickerMeta?.asset_class || "markets",
          broker_symbols: tickerMeta?.broker_symbols?.length ? tickerMeta.broker_symbols : [canonSym, `${canonSym}c`, `${canonSym}m`],
          news_tags: tickerMeta?.news_keywords?.length ? tickerMeta.news_keywords : [canonSym],
        }),
      });
      setInPortfolio(true);
      notify.success("Добавлено в «Мои активы»", created.code || canonSym);
      void navigate({ to: "/dashboard/hubs/$code", params: { code: created.code || canonSym } });
    } catch (err) {
      notify.error("Не удалось добавить актив", err instanceof Error ? err.message : String(err));
    } finally {
      setAddingPortfolio(false);
    }
  }

  async function handleDeletePortfolioAsset() {
    if (!hub) return;
    setDeleting(true);
    try {
      await apiRequest(`/assets/${encodeURIComponent(hub.code)}`, { method: "DELETE" });
      notify.success("Актив удалён", hub.code);
      void navigate({ to: "/dashboard/hubs" });
    } catch (err) {
      notify.error("Ошибка удаления", err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  const displayCode = hub?.code || canonSym;
  const displayName = hub?.name || tickerMeta?.name || canonSym;
  const displayClass = hub?.group || tickerMeta?.asset_class || "MARKET";
  const displayPrice = livePrice ?? marketStats?.price ?? null;
  const changePct = marketStats?.change_pct ?? 0;

  const dockTabs: Array<{ id: DockTab; label: string }> =
    mode === "portfolio"
      ? [
          { id: "robots", label: `Роботы (${robots.length})` },
          { id: "positions", label: `Открытые позиции (${openPositions.length})` },
          { id: "deals", label: `Сделки (${deals.length})` },
          { id: "news", label: `Новости (${marketNews.length})` },
          { id: "calendar", label: `Календарь (${marketCalendar.length})` },
          { id: "derivatives", label: "Деривативы / COT" },
        ]
      : [
          { id: "news", label: `Новости (${marketNews.length})` },
          { id: "calendar", label: `Календарь (${marketCalendar.length})` },
          { id: "derivatives", label: "Деривативы / COT" },
        ];

  return (
    <div
      data-content-padding="false"
      className="flex h-[calc(100vh-80px)] min-h-[600px] w-full flex-col overflow-hidden bg-[#0B0E14] text-[#F1F5F9]"
    >
      {/* 1. TOP BAR (48px) */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[#1E2634] bg-[#11161F] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            to={mode === "portfolio" ? "/dashboard/hubs" : "/dashboard/tickers"}
            className="flex size-7 shrink-0 items-center justify-center rounded-[4px] border border-[#1E2634] bg-[#0B0E14] text-[#94A3B8] transition-colors duration-75 hover:border-[#2C3649] hover:text-[#F1F5F9]"
            title={mode === "portfolio" ? "К списку «Мои активы»" : "К «Справочнику рынков»"}
          >
            <ArrowLeft className="size-3.5" />
          </Link>

          {/* Clickable Quick Ticker Switcher [Icon BTCUSD v] */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSwitcherOpen((v) => !v)}
              className="flex items-center gap-2 rounded-[4px] border border-transparent px-1.5 py-1 transition-colors duration-75 hover:border-[#2C3649] hover:bg-[#171E2B]"
              title="Быстрое переключение инструмента"
            >
              <AssetLogo symbol={displayCode} size={22} />
              <span className="font-mono text-[15px] font-semibold tracking-tight text-[#F1F5F9]">
                {displayCode}
              </span>
              <ChevronDown className="size-3.5 text-[#64748B]" />
            </button>
            {switcherOpen ? (
              <div className="absolute top-9 left-0 z-50 w-64 rounded-[4px] border border-[#2C3649] bg-[#11161F] p-1.5">
                <input
                  autoFocus
                  value={switcherQuery}
                  onChange={(e) => setSwitcherQuery(e.target.value)}
                  placeholder="Перейти к тикеру..."
                  className="mb-1.5 h-7 w-full rounded-[3px] border border-[#1E2634] bg-[#0B0E14] px-2 text-[11px] text-[#F1F5F9] placeholder-[#64748B] outline-none focus:border-[#3B82F6]"
                />
                <div className="pro-scroll max-h-56 overflow-y-auto">
                  {switcherOptions.map((opt) => (
                    <button
                      key={opt.code}
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        setSwitcherQuery("");
                        if (mode === "portfolio") {
                          void navigate({ to: "/dashboard/hubs/$code", params: { code: opt.code } });
                        } else {
                          void navigate({ to: "/dashboard/tickers/$symbol", params: { symbol: opt.code } });
                        }
                      }}
                      className="flex w-full items-center justify-between rounded-[2px] px-2 py-1.5 text-left text-[11px] hover:bg-[#171E2B]"
                    >
                      <span className="flex items-center gap-2">
                        <AssetLogo symbol={opt.code} size={16} />
                        <span className="font-mono font-semibold text-[#F1F5F9]">{opt.code}</span>
                      </span>
                      <span className="max-w-[110px] truncate text-[10px] text-[#64748B]">{opt.name}</span>
                    </button>
                  ))}
                  {switcherOptions.length === 0 ? (
                    <div className="px-2 py-3 text-center text-[11px] text-[#64748B]">Ничего не найдено</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <span className="hidden max-w-[150px] truncate text-[12px] text-[#94A3B8] xl:inline">
            {displayName}
          </span>
          <span className="rounded-[3px] border border-[#2C3649] bg-[#171E2B] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[#94A3B8]">
            {displayClass}
          </span>

          <div className="mx-1 h-5 w-px bg-[#1E2634]" />

          {/* Live Price + 24h % */}
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`rounded-[2px] px-1 text-[15px] font-semibold text-[#F1F5F9] ${
                priceFlash === "bull" ? "ht-flash-bull" : priceFlash === "bear" ? "ht-flash-bear" : ""
              }`}
            >
              {displayPrice !== null ? (
                formatQuotePrice(displayPrice)
              ) : (
                <span className="inline-block h-3.5 w-16 rounded-[2px] bg-[#171E2B] ht-shimmer-bar align-middle" />
              )}
            </span>
            <span
              className={`text-[12px] font-medium ${
                changePct >= 0 ? "text-[#10B981]" : "text-[#F43F5E]"
              }`}
            >
              {changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%
            </span>
          </div>

          <div className="mx-1 hidden h-5 w-px bg-[#1E2634] lg:block" />

          {/* Mode-specific 1-line KPIs or 24h Market Stats */}
          {mode === "portfolio" ? (
            <div className="hidden items-center gap-4 font-mono text-[11px] tabular-nums lg:flex">
              <KpiInline
                label="Эквити"
                value={hub ? formatUsd(hub.stats.total_equity_usd, privacyMode) : "—"}
              />
              <KpiInline
                label="PnL 24ч"
                value={hub ? formatSignedUsd(hub.stats.pnl_24h_usd ?? 0, privacyMode) : "—"}
                tone={hub ? ((hub.stats.pnl_24h_usd ?? 0) >= 0 ? "bull" : "bear") : "neutral"}
              />
              <KpiInline
                label="Win Rate"
                value={hub ? `${hub.stats.win_rate_pct.toFixed(1)}%` : "—"}
              />
              <KpiInline
                label="Роботы"
                value={hub ? `${hub.stats.robots_count}` : "—"}
              />
            </div>
          ) : (
            <div className="hidden items-center gap-4 font-mono text-[11px] tabular-nums lg:flex">
              <KpiInline label="24h High" value={formatQuotePrice(marketStats?.high_24h)} />
              <KpiInline label="24h Low" value={formatQuotePrice(marketStats?.low_24h)} />
              <KpiInline
                label="24h Vol"
                value={marketStats?.volume_24h ? formatDynamicVolume(marketStats.volume_24h) : "—"}
              />
              <KpiInline
                label="Spread"
                value={
                  marketStats?.spread_bps
                    ? `${marketStats.spread_bps.toFixed(1)} bps`
                    : "—"
                }
              />
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={aiLoading}
            onClick={() => void handleAiBrief()}
            className="inline-flex h-7 items-center rounded-[4px] border border-[#2C3649] bg-[#171E2B] px-2.5 text-[11px] font-medium text-[#F1F5F9] transition-colors duration-75 hover:border-[#3B82F6] hover:text-[#3B82F6] disabled:opacity-60"
          >
            {aiLoading ? "Анализ..." : "AI Обзор"}
          </button>

          {mode === "market" ? (
            inPortfolio ? (
              <Link
                to="/dashboard/hubs/$code"
                params={{ code: displayCode }}
                className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#10B981]/40 bg-[#10B981]/10 px-2.5 text-[11px] font-medium text-[#10B981] transition-colors duration-75 hover:bg-[#10B981]/20"
              >
                <Star className="size-3 fill-current" />
                В Моих активах
              </Link>
            ) : (
              <button
                type="button"
                disabled={addingPortfolio}
                onClick={() => void handleAddToPortfolio()}
                className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#3B82F6] bg-[#3B82F6] px-2.5 text-[11px] font-medium text-[#0B0E14] transition-colors duration-75 hover:bg-[#3B82F6]/90 disabled:opacity-60"
              >
                <Star className="size-3" />
                {addingPortfolio ? "Добавление..." : "Добавить в Мои активы"}
              </button>
            )
          ) : (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex size-7 items-center justify-center rounded-[4px] border border-[#1E2634] bg-[#0B0E14] text-[#94A3B8] transition-colors duration-75 hover:border-[#2C3649] hover:text-[#F1F5F9]"
                title="Действия актива"
              >
                <MoreVertical className="size-3.5" />
              </button>
              {menuOpen && hub ? (
                <div className="absolute top-8 right-0 z-50 w-48 rounded-[4px] border border-[#2C3649] bg-[#11161F] p-1 text-[11px]">
                  <Link
                    to="/dashboard/hubs/$code/edit"
                    params={{ code: hub.code }}
                    onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[#F1F5F9] hover:bg-[#171E2B]"
                  >
                    <Pencil className="size-3 text-[#94A3B8]" />
                    Редактировать
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(hub.id);
                      notify.success("UUID скопирован", hub.id);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 font-mono text-[10px] text-[#94A3B8] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
                    title={hub.id}
                  >
                    <Copy className="size-3" />
                    UUID: {hub.id.slice(0, 8)}...
                  </button>
                  <div className="my-1 h-px bg-[#1E2634]" />
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-[#F43F5E] hover:bg-[#F43F5E]/10"
                  >
                    <Trash2 className="size-3" />
                    Удалить актив
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* AI BRIEF INLINE PANEL (plain text & bullets only — strictly no Markdown tables) */}
      {aiOpen ? (
        <div className="shrink-0 border-b border-[#2C3649] bg-[#11161F] px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#F1F5F9]">AI Обзор 24ч — {displayCode}</span>
              {aiModel ? (
                <span className="rounded-[2px] border border-[#2C3649] bg-[#0B0E14] px-1.5 py-0.5 font-mono text-[10px] text-[#94A3B8]">
                  {aiModel}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setAiOpen(false)}
              className="flex size-5 items-center justify-center rounded-[2px] text-[#64748B] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="pro-scroll max-h-36 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-[#CBD5E1]">
            {aiLoading ? "Формирование сводки по рынку и новостям..." : aiText}
          </div>
        </div>
      ) : null}

      {/* 2. MAIN WORKSPACE: CHART (left) + 4px DRAG HANDLE + MICROSTRUCTURE (right) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1">
          <KLineChartPro
            symbol={displayCode}
            mode={mode}
            mt5Zones={mt5Zones}
            latestTick={latestTick}
            feedHealth={feedHealth}
            feedProvider={feedProvider}
            feedLatencyMs={feedLatencyMs}
            onBundleLoaded={handleBundleLoaded}
          />
        </div>

        {/* 4px horizontal resize handle */}
        <div
          onMouseDown={startRightResize}
          className="w-1 shrink-0 cursor-col-resize bg-[#1E2634] transition-colors duration-75 hover:bg-[#3B82F6]"
          title="Изменить ширину правой колонки"
        />

        {/* Right column (DOM + Tick Chart) */}
        <div className="min-h-0 shrink-0 overflow-hidden" style={{ width: rightWidth }}>
          <MicrostructurePanel
            symbol={displayCode}
            initialPrice={displayPrice}
            latestTick={latestTick}
            latestOrderbook={latestOrderbook}
            liquidations={liquidations}
            feedHealth={feedHealth}
            feedProvider={feedProvider}
            feedLatencyMs={feedLatencyMs}
          />
        </div>
      </div>

      {/* 3. ACTIVE MT5 ROBOTS COMPACT STRIP (36px) — STRICTLY ONLY IN mode="portfolio" */}
      {mode === "portfolio" ? (
        <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-t border-[#1E2634] bg-[#11161F] px-3 font-mono text-[11px] tabular-nums">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#64748B]">
            MT5 EA ({robots.length})
          </span>
          <div className="h-3.5 w-px shrink-0 bg-[#1E2634]" />
          {robots.length === 0 ? (
            <span className="text-[11px] text-[#64748B]">
              Активных роботов по {displayCode} не обнаружено (автоподключение через /ws/account)
            </span>
          ) : (
            robots.map((r) => {
              const isSelected = activeRobot?.id === r.id;
              const rsi = extractTelemetryNum(r.live_state_json, "rsi_m5");
              const er = extractTelemetryNum(r.live_state_json, "er_h1");
              const dayPnl = extractTelemetryNum(r.live_state_json, "day_pnl");
              const statusUpper = (r.live_status || "RUNNING").toUpperCase();
              const isRunning = statusUpper.includes("RUN") || statusUpper.includes("ACTIVE");
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedRobotId(r.id);
                    setDockTab("robots");
                    setDockCollapsed(false);
                  }}
                  className={`inline-flex h-6 shrink-0 items-center gap-2 rounded-[3px] border px-2 transition-colors duration-75 ${
                    isSelected
                      ? "border-[#3B82F6] bg-[#171E2B] text-[#F1F5F9]"
                      : "border-[#1E2634] bg-[#0B0E14] text-[#94A3B8] hover:border-[#2C3649] hover:text-[#F1F5F9]"
                  }`}
                >
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      isRunning ? "bg-[#10B981]" : "bg-[#F59E0B]"
                    }`}
                  />
                  <span className="font-semibold text-[#F1F5F9]">
                    {r.name} #{r.magic_number}
                  </span>
                  <span className="text-[#64748B]">
                    ({r.symbol || displayCode}
                    {r.account_login ? ` · MT5 ${r.account_login}` : ""} · {statusUpper}
                    {r.seq ? ` · seq #${r.seq}` : ""} · {formatRelativeAge(r.updated_at_utc || r.last_heartbeat_at)})
                  </span>
                  {rsi !== null ? <span className="text-[#94A3B8]">RSI {rsi.toFixed(1)}</span> : null}
                  {er !== null ? <span className="text-[#94A3B8]">ER {er.toFixed(2)}</span> : null}
                  {dayPnl !== null ? (
                    <span className={dayPnl >= 0 ? "text-[#10B981]" : "text-[#F43F5E]"}>
                      {formatSignedUsd(dayPnl, privacyMode)}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}

      {/* 4. 4px VERTICAL RESIZE HANDLE + BOTTOM DOCK */}
      <div
        onMouseDown={startDockResize}
        className="h-1 shrink-0 cursor-row-resize bg-[#1E2634] transition-colors duration-75 hover:bg-[#3B82F6]"
        title="Изменить высоту нижней панели"
      />

      <div
        className="flex shrink-0 flex-col bg-[#11161F]"
        style={{ height: dockCollapsed ? 36 : dockHeight }}
      >
        {/* Dock Tab Bar (36px) */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-[#1E2634] px-3">
          <div className="flex h-full items-center gap-4 overflow-x-auto">
            {dockTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setDockTab(tab.id);
                  setDockCollapsed(false);
                }}
                className={`flex h-full shrink-0 items-center border-b-2 text-[11px] font-medium transition-colors duration-75 ${
                  dockTab === tab.id && !dockCollapsed
                    ? "border-[#3B82F6] text-[#F1F5F9]"
                    : "border-transparent text-[#64748B] hover:text-[#94A3B8]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="flex size-6 items-center justify-center rounded-[3px] text-[#64748B] hover:bg-[#171E2B] hover:text-[#F1F5F9]"
            title={dockCollapsed ? "Развернуть нижнюю панель" : "Свернуть нижнюю панель"}
          >
            {dockCollapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>

        {/* Dock Content */}
        {!dockCollapsed ? (
          <div className="pro-scroll min-h-0 flex-1 overflow-auto bg-[#0B0E14]">
            {dockTab === "robots" && mode === "portfolio" ? (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[#64748B]">
                  <tr className="h-7">
                    <th className="px-3 text-left font-medium">Робот / Мост</th>
                    <th className="px-3 text-left font-medium">Символ</th>
                    <th className="px-3 text-left font-medium">Статус</th>
                    <th className="px-3 text-right font-medium">Seq / Возраст</th>
                    <th className="px-3 text-right font-medium">RSI (M5)</th>
                    <th className="px-3 text-right font-medium">ER (H1)</th>
                    <th className="px-3 text-right font-medium">VWAP / Z</th>
                    <th className="px-3 text-right font-medium">Day PnL (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {robots.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-center text-[#64748B]">
                        Нет подключённых роботов для {displayCode}
                      </td>
                    </tr>
                  ) : (
                    robots.map((r) => {
                      const rsi = extractTelemetryNum(r.live_state_json, "rsi_m5");
                      const er = extractTelemetryNum(r.live_state_json, "er_h1");
                      const vwapZ = extractTelemetryNum(r.live_state_json, "vwap_z");
                      const dayPnl = extractTelemetryNum(r.live_state_json, "day_pnl");
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelectedRobotId(r.id)}
                          className={`h-8 cursor-pointer transition-colors duration-75 hover:bg-[#171E2B] ${
                            activeRobot?.id === r.id ? "bg-[#171E2B]/70" : ""
                          }`}
                        >
                          <td className="px-3 text-left font-medium text-[#F1F5F9]">
                            {r.name} <span className="font-mono text-[#64748B]">#{r.magic_number}</span>
                            {r.account_name ? (
                              <span className="ml-1.5 text-[10px] text-[#64748B]">
                                · {r.account_name} ({r.account_login})
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 text-left font-mono text-[#94A3B8]">{r.symbol}</td>
                          <td className="px-3 text-left font-mono">
                            <span
                              className={
                                (r.live_status || "").toUpperCase().includes("RUN")
                                  ? "text-[#10B981]"
                                  : "text-[#F59E0B]"
                              }
                            >
                              {r.live_status || "RUNNING"}
                            </span>
                          </td>
                          <td className="px-3 text-right font-mono tabular-nums text-[#94A3B8]">
                            {r.seq ? `#${r.seq} · ` : ""}
                            {formatRelativeAge(r.updated_at_utc || r.last_heartbeat_at)}
                          </td>
                          <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                            {rsi !== null ? rsi.toFixed(1) : "—"}
                          </td>
                          <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                            {er !== null ? er.toFixed(3) : "—"}
                          </td>
                          <td className="px-3 text-right font-mono tabular-nums text-[#94A3B8]">
                            {vwapZ !== null ? `${vwapZ >= 0 ? "+" : ""}${vwapZ.toFixed(2)}σ` : "—"}
                          </td>
                          <td
                            className={`px-3 text-right font-mono tabular-nums ${
                              (dayPnl ?? 0) >= 0 ? "text-[#10B981]" : "text-[#F43F5E]"
                            }`}
                          >
                            {dayPnl !== null ? formatSignedUsd(dayPnl, privacyMode) : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : dockTab === "positions" && mode === "portfolio" ? (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[#64748B]">
                  <tr className="h-7">
                    <th className="px-3 text-left font-medium">Тикет</th>
                    <th className="px-3 text-left font-medium">Счёт</th>
                    <th className="px-3 text-left font-medium">Символ</th>
                    <th className="px-3 text-left font-medium">Сторона</th>
                    <th className="px-3 text-right font-medium">Лот</th>
                    <th className="px-3 text-right font-medium">Вход</th>
                    <th className="px-3 text-right font-medium">Текущая</th>
                    <th className="px-3 text-right font-medium">SL / TP</th>
                    <th className="px-3 text-right font-medium">PnL (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-4 text-center text-[#64748B]">
                        Нет открытых позиций по {displayCode}
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((p) => (
                      <tr key={p.position_ticket} className="h-8 hover:bg-[#171E2B]">
                        <td className="px-3 text-left font-mono text-[#94A3B8]">#{p.position_ticket}</td>
                        <td className="px-3 text-left text-[#F1F5F9]">{p.account_name}</td>
                        <td className="px-3 text-left font-mono text-[#F1F5F9]">{p.symbol}</td>
                        <td
                          className={`px-3 text-left font-mono font-semibold ${
                            p.side.toUpperCase() === "BUY" ? "text-[#10B981]" : "text-[#F43F5E]"
                          }`}
                        >
                          {p.side}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                          {p.volume.toFixed(2)}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#94A3B8]">
                          {formatQuotePrice(p.open_price)}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                          {formatQuotePrice(p.current_price)}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#64748B]">
                          {p.sl > 0 ? formatQuotePrice(p.sl) : "—"} / {p.tp > 0 ? formatQuotePrice(p.tp) : "—"}
                        </td>
                        <td
                          className={`px-3 text-right font-mono font-semibold tabular-nums ${
                            p.profit_usd >= 0 ? "text-[#10B981]" : "text-[#F43F5E]"
                          }`}
                        >
                          {formatSignedUsd(p.profit_usd, privacyMode)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : dockTab === "deals" && mode === "portfolio" ? (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[#64748B]">
                  <tr className="h-7">
                    <th className="px-3 text-left font-medium">Время (UTC)</th>
                    <th className="px-3 text-left font-medium">Символ</th>
                    <th className="px-3 text-left font-medium">Сторона</th>
                    <th className="px-3 text-right font-medium">Объём</th>
                    <th className="px-3 text-right font-medium">Цена</th>
                    <th className="px-3 text-right font-medium">Net PnL (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {deals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">
                        История сделок по {displayCode} пуста
                      </td>
                    </tr>
                  ) : (
                    deals.map((d) => (
                      <tr key={d.id} className="h-8 hover:bg-[#171E2B]">
                        <td className="px-3 text-left font-mono text-[#94A3B8]">
                          {formatTerminalDateTime(d.timestamp)}
                        </td>
                        <td className="px-3 text-left font-mono text-[#F1F5F9]">{d.symbol}</td>
                        <td
                          className={`px-3 text-left font-mono font-semibold ${
                            d.side.toUpperCase() === "BUY" ? "text-[#10B981]" : "text-[#F43F5E]"
                          }`}
                        >
                          {d.side} {d.entry ? `(${d.entry})` : ""}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                          {d.volume.toFixed(2)}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#94A3B8]">
                          {formatQuotePrice(d.price)}
                        </td>
                        <td
                          className={`px-3 text-right font-mono font-semibold tabular-nums ${
                            d.net_profit_usd >= 0 ? "text-[#10B981]" : "text-[#F43F5E]"
                          }`}
                        >
                          {formatSignedUsd(d.net_profit_usd, privacyMode)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : dockTab === "news" ? (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[#64748B]">
                  <tr className="h-7">
                    <th className="px-3 text-left font-medium">Время</th>
                    <th className="px-3 text-left font-medium">Источник</th>
                    <th className="px-3 text-left font-medium">Заголовок</th>
                    <th className="px-3 text-right font-medium">Тон</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {marketNews.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-[#64748B]">
                        Нет свежих новостей по {displayCode}
                      </td>
                    </tr>
                  ) : (
                    marketNews.map((n) => (
                      <tr key={n.id} className="h-8 hover:bg-[#171E2B]">
                        <td className="whitespace-nowrap px-3 text-left font-mono text-[#64748B]">
                          {formatTerminalDateTime(n.published_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 text-left font-mono text-[#94A3B8]">
                          {n.source}
                        </td>
                        <td className="px-3 text-left text-[#F1F5F9]">{n.title}</td>
                        <td
                          className={`whitespace-nowrap px-3 text-right font-mono uppercase ${
                            n.sentiment === "bullish"
                              ? "text-[#10B981]"
                              : n.sentiment === "bearish"
                                ? "text-[#F43F5E]"
                                : "text-[#64748B]"
                          }`}
                        >
                          {n.sentiment}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : dockTab === "calendar" ? (
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 border-b border-[#1E2634] bg-[#11161F] text-[#64748B]">
                  <tr className="h-7">
                    <th className="px-3 text-left font-medium">Время</th>
                    <th className="px-3 text-left font-medium">Валюта</th>
                    <th className="px-3 text-left font-medium">Событие</th>
                    <th className="px-3 text-right font-medium">Факт</th>
                    <th className="px-3 text-right font-medium">Прогноз</th>
                    <th className="px-3 text-right font-medium">Пред.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2634]/60">
                  {marketCalendar.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-[#64748B]">
                        Ближайших макрособытий не найдено
                      </td>
                    </tr>
                  ) : (
                    marketCalendar.map((ev) => (
                      <tr key={ev.id} className="h-8 hover:bg-[#171E2B]">
                        <td className="whitespace-nowrap px-3 text-left font-mono text-[#64748B]">
                          {formatTerminalDateTime(ev.event_time)}
                        </td>
                        <td className="px-3 text-left font-mono font-semibold text-[#F59E0B]">
                          {ev.currency}
                        </td>
                        <td className="px-3 text-left text-[#F1F5F9]">{ev.title}</td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#F1F5F9]">
                          {ev.actual || "—"}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#94A3B8]">
                          {ev.forecast || "—"}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-[#64748B]">
                          {ev.previous || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full flex-col justify-between px-3 py-2 font-mono text-[11px] tabular-nums">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E2634] pb-1.5">
                  <span className="font-semibold text-[#F1F5F9]">
                    Деривативы / Институциональные данные — {displayCode}
                  </span>
                  <span className="text-[10px] text-[#64748B]">
                    Источники: {derivativesData?.sources?.length ? derivativesData.sources.join(" · ") : "Загрузка..."}
                  </span>
                </div>

                {derivativesData?.kind === "crypto" ? (
                  <div className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-5">
                    <KpiInline
                      label="Open Interest"
                      value={
                        derivativesData.metrics.open_interest
                          ? formatDynamicVolume(derivativesData.metrics.open_interest)
                          : "—"
                      }
                    />
                    <KpiInline
                      label="Funding Rate"
                      value={
                        derivativesData.metrics.funding_rate_pct !== undefined
                          ? `${derivativesData.metrics.funding_rate_pct >= 0 ? "+" : ""}${derivativesData.metrics.funding_rate_pct.toFixed(4)}%`
                          : "—"
                      }
                      tone={(derivativesData.metrics.funding_rate_pct ?? 0) >= 0 ? "bull" : "bear"}
                    />
                    <KpiInline
                      label="Mark Price"
                      value={formatQuotePrice(derivativesData.metrics.mark_price)}
                    />
                    <KpiInline
                      label="Index Price"
                      value={formatQuotePrice(derivativesData.metrics.index_price)}
                    />
                    <KpiInline
                      label="Deribit HV"
                      value={
                        derivativesData.metrics.deribit_hv_pct
                          ? `${derivativesData.metrics.deribit_hv_pct.toFixed(1)}%`
                          : "—"
                      }
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 py-1.5 md:grid-cols-2">
                    <div className="rounded-[3px] border border-[#1E2634] bg-[#11161F] p-2">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-[#64748B]">
                        <span>CFTC COT Positioning</span>
                        <span>{derivativesData?.cot?.report_date || "—"}</span>
                      </div>
                      {derivativesData?.cot ? (
                        <div className="grid grid-cols-3 gap-2">
                          <KpiInline
                            label="Funds Net"
                            value={derivativesData.cot.noncomm_net.toLocaleString("en-US")}
                            tone={derivativesData.cot.noncomm_net >= 0 ? "bull" : "bear"}
                          />
                          <KpiInline
                            label="Comm Net"
                            value={derivativesData.cot.comm_net.toLocaleString("en-US")}
                            tone={derivativesData.cot.comm_net >= 0 ? "bull" : "bear"}
                          />
                          <KpiInline
                            label="Open Interest"
                            value={derivativesData.cot.open_interest.toLocaleString("en-US")}
                          />
                        </div>
                      ) : (
                        <div className="text-[10px] text-[#64748B]">Нет отчёта CFTC для {displayCode}</div>
                      )}
                    </div>

                    <div className="rounded-[3px] border border-[#1E2634] bg-[#11161F] p-2">
                      <div className="mb-1 text-[10px] text-[#64748B]">U.S. Treasury Yields (Fiscal Data)</div>
                      {derivativesData?.treasury?.length ? (
                        <div className="space-y-0.5 text-[10px]">
                          {derivativesData.treasury.slice(0, 3).map((t) => (
                            <div key={t.security} className="flex items-center justify-between">
                              <span className="truncate text-[#94A3B8]">{t.security}</span>
                              <span className="font-semibold text-[#F1F5F9]">{t.rate_pct.toFixed(3)}%</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[10px] text-[#64748B]">Загрузка доходностей США...</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Confirm Delete Modal (only in portfolio mode) */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Удалить актив из «Моих активов»?"
        description={`${displayCode} — ${displayName}`}
        loading={deleting}
        onConfirm={handleDeletePortfolioAsset}
      />
    </div>
  );
}

function KpiInline({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "neutral";
}) {
  const color =
    tone === "bull" ? "text-[#10B981]" : tone === "bear" ? "text-[#F43F5E]" : "text-[#F1F5F9]";
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] text-[#64748B]">{label}</span>
      <span className={`font-mono text-[12px] font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}
