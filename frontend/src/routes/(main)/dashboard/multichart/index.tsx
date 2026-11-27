import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import type { KLineData } from "klinecharts";
import { Clock, Crosshair, History, Link2, Save, ZoomIn } from "lucide-react";

import { BarReplayBar, type ReplaySpeed } from "@/components/multichart/BarReplayBar";
import {
  ChartCell,
  type ChartCellConfig,
  type ChartTimeframe,
  type CrosshairSyncEvent,
  type PaperTradeOverlay,
  type ZoomSyncEvent,
} from "@/components/multichart/ChartCell";
import { SearchSelect } from "@/components/ui/search-select";
import { notify } from "@/components/ui/toast";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { soundEngine } from "@/framework/sound-engine";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export const Route = createFileRoute("/(main)/dashboard/multichart/")({
  component: MultiChartCockpitPage,
});

type LayoutId = "1x1" | "1x2" | "2x1" | "2x2" | "3x2" | "4x2";

interface LayoutDef {
  id: LayoutId;
  label: string;
  count: number;
  gridClass: string;
}

const LAYOUTS: LayoutDef[] = [
  { id: "1x1", label: "1×1", count: 1, gridClass: "grid-cols-1 grid-rows-1" },
  { id: "1x2", label: "1×2", count: 2, gridClass: "grid-cols-2 grid-rows-1" },
  { id: "2x1", label: "2×1", count: 2, gridClass: "grid-cols-1 grid-rows-2" },
  { id: "2x2", label: "2×2", count: 4, gridClass: "grid-cols-2 grid-rows-2" },
  { id: "3x2", label: "3×2", count: 6, gridClass: "grid-cols-3 grid-rows-2" },
  { id: "4x2", label: "4×2", count: 8, gridClass: "grid-cols-4 grid-rows-2" },
];

interface MultiChartPreset {
  id: string;
  label: string;
  layout: LayoutId;
  syncSymbol: boolean;
  syncTimeframe: boolean;
  syncCrosshair: boolean;
  cells: Array<{ symbol: string; timeframe: ChartTimeframe }>;
}

const BUILTIN_PRESETS: MultiChartPreset[] = [
  {
    id: "gold_mtf",
    label: "Gold Multi-TF (M5/M15/H1/H4)",
    layout: "2x2",
    syncSymbol: true,
    syncTimeframe: false,
    syncCrosshair: true,
    cells: [
      { symbol: "XAUUSD", timeframe: "M5" },
      { symbol: "XAUUSD", timeframe: "M15" },
      { symbol: "XAUUSD", timeframe: "H1" },
      { symbol: "XAUUSD", timeframe: "H4" },
    ],
  },
  {
    id: "indices_dxy",
    label: "Indices & DXY",
    layout: "2x2",
    syncSymbol: false,
    syncTimeframe: true,
    syncCrosshair: true,
    cells: [
      { symbol: "USTEC", timeframe: "M15" },
      { symbol: "US500", timeframe: "M15" },
      { symbol: "DXY", timeframe: "M15" },
      { symbol: "XAUUSD", timeframe: "M15" },
    ],
  },
  {
    id: "crypto_majors",
    label: "Crypto Majors",
    layout: "2x2",
    syncSymbol: false,
    syncTimeframe: true,
    syncCrosshair: true,
    cells: [
      { symbol: "BTCUSD", timeframe: "M15" },
      { symbol: "ETHUSD", timeframe: "M15" },
      { symbol: "SOLUSD", timeframe: "M15" },
      { symbol: "BNBUSD", timeframe: "M15" },
    ],
  },
];

const CUSTOM_PRESETS_KEY = "ht_multichart_presets_v1";
const DEFAULT_FILL_SYMBOLS = ["XAUUSD", "USTEC", "BTCUSD", "DXY", "ETHUSD", "US500", "EURUSD", "USOIL"];

function loadCustomPresets(): MultiChartPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildCellsForCount(
  count: number,
  seed: Array<{ symbol: string; timeframe: ChartTimeframe }>,
): ChartCellConfig[] {
  return Array.from({ length: count }, (_, idx) => {
    const src = seed[idx];
    return {
      id: `cell-${idx + 1}`,
      symbol: src?.symbol || DEFAULT_FILL_SYMBOLS[idx % DEFAULT_FILL_SYMBOLS.length],
      timeframe: src?.timeframe || "M15",
      indicators: [],
      showMt5Zones: false,
    };
  });
}

function parseInitialConfig() {
  if (typeof window === "undefined") {
    return {
      layout: "2x2" as LayoutId,
      cells: buildCellsForCount(4, BUILTIN_PRESETS[0].cells),
      syncSymbol: true,
      syncTimeframe: false,
      syncCrosshair: true,
      syncZoom: false,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const symsParam = params.get("symbols");
  const singleSym = params.get("symbol");
  const tfsParam = params.get("tfs");

  if (singleSym && tfsParam) {
    const tfs = tfsParam
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter((t): t is ChartTimeframe => ["M1", "M5", "M15", "H1", "H4", "D1"].includes(t));
    const count = Math.min(8, Math.max(1, tfs.length || 4));
    const layout: LayoutId = count <= 1 ? "1x1" : count <= 2 ? "1x2" : count <= 4 ? "2x2" : count <= 6 ? "3x2" : "4x2";
    return {
      layout,
      cells: buildCellsForCount(
        count,
        tfs.map((tf) => ({ symbol: singleSym.toUpperCase(), timeframe: tf })),
      ),
      syncSymbol: params.get("syncSymbol") !== "0",
      syncTimeframe: false,
      syncCrosshair: params.get("syncCrosshair") !== "0",
      syncZoom: false,
    };
  }

  if (symsParam) {
    const syms = symsParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const count = Math.min(8, Math.max(1, syms.length));
    const layout: LayoutId = count <= 1 ? "1x1" : count <= 2 ? "1x2" : count <= 4 ? "2x2" : count <= 6 ? "3x2" : "4x2";
    return {
      layout,
      cells: buildCellsForCount(
        count,
        syms.map((s) => ({ symbol: s, timeframe: "M15" as ChartTimeframe })),
      ),
      syncSymbol: false,
      syncTimeframe: true,
      syncCrosshair: true,
      syncZoom: false,
    };
  }

  return {
    layout: "2x2" as LayoutId,
    cells: buildCellsForCount(4, BUILTIN_PRESETS[0].cells),
    syncSymbol: true,
    syncTimeframe: false,
    syncCrosshair: true,
    syncZoom: false,
  };
}

function MultiChartCockpitPage() {
  const initial = useMemo(() => parseInitialConfig(), []);

  const [layout, setLayout] = useState<LayoutId>(initial.layout);
  const [cells, setCells] = useState<ChartCellConfig[]>(initial.cells);
  const [activeCellId, setActiveCellId] = useState<string>(initial.cells[0]?.id || "cell-1");
  const [maximizedCellId, setMaximizedCellId] = useState<string | null>(null);

  // Sync toggles
  const [syncCrosshair, setSyncCrosshair] = useState(initial.syncCrosshair);
  const [syncSymbol, setSyncSymbol] = useState(initial.syncSymbol);
  const [syncTimeframe, setSyncTimeframe] = useState(initial.syncTimeframe);
  const [syncZoom, setSyncZoom] = useState(initial.syncZoom);

  // Sync broadcast events
  const [crosshairEvent, setCrosshairEvent] = useState<CrosshairSyncEvent | null>(null);
  const [zoomEvent, setZoomEvent] = useState<ZoomSyncEvent | null>(null);

  // Presets
  const [customPresets, setCustomPresets] = useState<MultiChartPreset[]>(() => loadCustomPresets());
  const [selectedPresetId, setSelectedPresetId] = useState<string>("gold_mtf");

  // Bar Replay state
  const [replayActive, setReplayActive] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayPickingStart, setReplayPickingStart] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [replayBarIdx, setReplayBarIdx] = useState(0);
  const barsByCellRef = useRef<Record<string, KLineData[]>>({});

  // Paper Trading state inside Replay
  const [paperBalance, setPaperBalance] = useState(10_000);
  const [paperRealized, setPaperRealized] = useState(0);
  const [paperTrade, setPaperTrade] = useState<PaperTradeOverlay | null>(null);

  // Single /ws/market multiplexer for all unique symbols in the grid (auto-unsubscribes on unmount)
  const uniqueSymbols = useMemo(
    () => (replayActive ? [] : Array.from(new Set(cells.map((c) => c.symbol)))),
    [cells, replayActive],
  );
  const liveQuotes = useMarketListStream(uniqueSymbols);

  const activeCell = useMemo(
    () => cells.find((c) => c.id === activeCellId) ?? cells[0],
    [cells, activeCellId],
  );

  const activeBars = barsByCellRef.current[activeCell?.id || ""] || [];
  const replayCurrentBar = replayActive && activeBars.length > 0 ? activeBars[Math.min(replayBarIdx, activeBars.length - 1)] : null;
  const replayCursorTs = replayCurrentBar?.timestamp ?? null;
  const replayCurrentPrice = replayCurrentBar?.close ?? 0;

  const unrealizedPnlUsd = useMemo(() => {
    if (!paperTrade || replayCurrentPrice <= 0) return 0;
    const pctMove =
      paperTrade.side === "BUY"
        ? (replayCurrentPrice - paperTrade.entryPrice) / paperTrade.entryPrice
        : (paperTrade.entryPrice - replayCurrentPrice) / paperTrade.entryPrice;
    // Standardized $10,000 notional position for clean simulation feedback
    return pctMove * 10_000;
  }, [paperTrade, replayCurrentPrice]);

  // Automatic SL / TP hit check during Bar Replay stepping
  useEffect(() => {
    if (!replayActive || !paperTrade || !replayCurrentBar) return;
    const { high, low } = replayCurrentBar;
    let closedAt: number | null = null;
    let reason = "";
    if (paperTrade.side === "BUY") {
      if (low <= paperTrade.slPrice) {
        closedAt = paperTrade.slPrice;
        reason = "Stop-Loss";
      } else if (high >= paperTrade.tpPrice) {
        closedAt = paperTrade.tpPrice;
        reason = "Take-Profit";
      }
    } else {
      if (high >= paperTrade.slPrice) {
        closedAt = paperTrade.slPrice;
        reason = "Stop-Loss";
      } else if (low <= paperTrade.tpPrice) {
        closedAt = paperTrade.tpPrice;
        reason = "Take-Profit";
      }
    }
    if (closedAt !== null) {
      const pctMove =
        paperTrade.side === "BUY"
          ? (closedAt - paperTrade.entryPrice) / paperTrade.entryPrice
          : (paperTrade.entryPrice - closedAt) / paperTrade.entryPrice;
      const pnl = pctMove * 10_000;
      setPaperBalance((b) => b + pnl);
      setPaperRealized((r) => r + pnl);
      setPaperTrade(null);
      soundEngine.play(pnl >= 0 ? "tradeProfit" : "tradeLoss");
      notify.info(`Replay ${reason}`, `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
    }
  }, [replayActive, paperTrade, replayCurrentBar]);

  // Replay timer loop
  useEffect(() => {
    if (!replayActive || !replayPlaying) return;
    const delayMs = Math.max(80, Math.round(900 / replaySpeed));
    const timer = window.setInterval(() => {
      setReplayBarIdx((idx) => {
        const total = barsByCellRef.current[activeCell?.id || ""]?.length ?? 0;
        if (total === 0 || idx >= total - 1) {
          setReplayPlaying(false);
          return Math.max(0, total - 1);
        }
        return idx + 1;
      });
    }, delayMs);
    return () => window.clearInterval(timer);
  }, [replayActive, replayPlaying, replaySpeed, activeCell?.id]);

  const handleLayoutChange = (nextLayout: LayoutId) => {
    const def = LAYOUTS.find((l) => l.id === nextLayout);
    if (!def) return;
    setLayout(nextLayout);
    setMaximizedCellId(null);
    setCells((prev) =>
      buildCellsForCount(
        def.count,
        prev.map((c) => ({ symbol: c.symbol, timeframe: c.timeframe })),
      ),
    );
  };

  const handleChangeSymbol = (cellId: string, symbol: string) => {
    setCells((prev) =>
      prev.map((c) => (syncSymbol || c.id === cellId ? { ...c, symbol } : c)),
    );
  };

  const handleChangeTimeframe = (cellId: string, timeframe: ChartTimeframe) => {
    setCells((prev) =>
      prev.map((c) => (syncTimeframe || c.id === cellId ? { ...c, timeframe } : c)),
    );
  };

  const handleToggleIndicator = (cellId: string, ind: string) => {
    setCells((prev) =>
      prev.map((c) => {
        if (c.id !== cellId) return c;
        const exists = c.indicators.includes(ind);
        return {
          ...c,
          indicators: exists ? c.indicators.filter((x) => x !== ind) : [...c.indicators, ind],
        };
      }),
    );
  };

  const handleToggleMt5Zones = (cellId: string) => {
    setCells((prev) =>
      prev.map((c) => (c.id === cellId ? { ...c, showMt5Zones: !c.showMt5Zones } : c)),
    );
  };

  const handleCloseCell = (cellId: string) => {
    if (cells.length <= 1) return;
    const remaining = cells.filter((c) => c.id !== cellId);
    setCells(remaining);
    if (maximizedCellId === cellId) setMaximizedCellId(null);
    if (activeCellId === cellId && remaining[0]) setActiveCellId(remaining[0].id);
    const nextLayout: LayoutId =
      remaining.length <= 1 ? "1x1" : remaining.length <= 2 ? "1x2" : remaining.length <= 4 ? "2x2" : "3x2";
    setLayout(nextLayout);
  };

  const allPresets = useMemo(() => [...BUILTIN_PRESETS, ...customPresets], [customPresets]);

  const handleApplyPreset = (presetId: string) => {
    if (presetId === "__save__") {
      const name = `Custom ${layout} (${cells.map((c) => c.symbol).slice(0, 2).join("/")})`;
      const newPreset: MultiChartPreset = {
        id: `custom-${Date.now()}`,
        label: name,
        layout,
        syncSymbol,
        syncTimeframe,
        syncCrosshair,
        cells: cells.map((c) => ({ symbol: c.symbol, timeframe: c.timeframe })),
      };
      const next = [...customPresets, newPreset];
      setCustomPresets(next);
      setSelectedPresetId(newPreset.id);
      try {
        window.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      notify.success("Раскладка сохранена", name);
      return;
    }

    const found = allPresets.find((p) => p.id === presetId);
    if (!found) return;
    setSelectedPresetId(found.id);
    setLayout(found.layout);
    setMaximizedCellId(null);
    setSyncSymbol(found.syncSymbol);
    setSyncTimeframe(found.syncTimeframe);
    setSyncCrosshair(found.syncCrosshair);
    const def = LAYOUTS.find((l) => l.id === found.layout);
    setCells(buildCellsForCount(def?.count ?? 4, found.cells));
  };

  const handleToggleReplay = () => {
    if (replayActive) {
      setReplayActive(false);
      setReplayPlaying(false);
      setReplayPickingStart(false);
      setPaperTrade(null);
      notify.info("Bar Replay завершён", `Итоговый PnL: ${paperRealized >= 0 ? "+" : ""}$${paperRealized.toFixed(2)}`);
      return;
    }
    const bars = barsByCellRef.current[activeCell?.id || ""] || [];
    const startIdx = Math.max(20, Math.floor(bars.length * 0.6));
    setReplayBarIdx(Math.min(startIdx, Math.max(0, bars.length - 1)));
    setReplayActive(true);
    setReplayPlaying(false);
    setReplayPickingStart(false);
    setPaperBalance(10_000);
    setPaperRealized(0);
    setPaperTrade(null);
    soundEngine.play("levelClick");
  };

  const handleReplayBarsReady = useCallback((cellId: string, bars: KLineData[]) => {
    barsByCellRef.current[cellId] = bars;
  }, []);

  const handleReplayPickStart = useCallback(
    (ts: number) => {
      const bars = barsByCellRef.current[activeCell?.id || ""] || [];
      const foundIdx = bars.findIndex((b) => b.timestamp >= ts);
      if (foundIdx >= 5) {
        setReplayBarIdx(foundIdx);
        setReplayPickingStart(false);
        setReplayPlaying(false);
        notify.info("Точка старта выбрана", `Свеча #${foundIdx} из ${bars.length}`);
      }
    },
    [activeCell?.id],
  );

  const handleStepForward = useCallback(() => {
    setReplayBarIdx((idx) => {
      const total = barsByCellRef.current[activeCell?.id || ""]?.length ?? 0;
      return Math.min(Math.max(0, total - 1), idx + 1);
    });
  }, [activeCell?.id]);

  const openPaperPosition = (side: "BUY" | "SELL") => {
    if (replayCurrentPrice <= 0 || paperTrade) return;
    const slDist = replayCurrentPrice * 0.005;
    const tpDist = replayCurrentPrice * 0.01;
    setPaperTrade({
      side,
      entryPrice: replayCurrentPrice,
      slPrice: side === "BUY" ? replayCurrentPrice - slDist : replayCurrentPrice + slDist,
      tpPrice: side === "BUY" ? replayCurrentPrice + tpDist : replayCurrentPrice - tpDist,
    });
    soundEngine.play("orderOpened");
  };

  const closePaperPosition = () => {
    if (!paperTrade) return;
    const pnl = unrealizedPnlUsd;
    setPaperBalance((b) => b + pnl);
    setPaperRealized((r) => r + pnl);
    setPaperTrade(null);
    soundEngine.play(pnl >= 0 ? "tradeProfit" : "tradeLoss");
  };

  const currentLayoutDef = LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[3];
  const visibleCells = maximizedCellId ? cells.filter((c) => c.id === maximizedCellId) : cells;

  return (
    <div
      data-content-padding="false"
      className="flex h-[calc(100vh-88px)] min-h-[540px] w-full flex-col overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]"
    >
      {/* 40px Top Control Bar */}
      <div className="flex h-[40px] shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3">
        <div className="flex items-center gap-2">
          {/* Layout Picker */}
          <div className="flex items-center gap-0.5 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => handleLayoutChange(l.id)}
                className={`rounded-[3px] px-2 py-0.5 font-mono text-[10.5px] font-semibold transition-colors ${
                  layout === l.id
                    ? "bg-[var(--accent-blue)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Sync Controls */}
          <div className="hidden items-center gap-1 md:flex">
            {(
              [
                { key: "cross", label: "Crosshair", active: syncCrosshair, toggle: () => setSyncCrosshair((v) => !v), icon: Crosshair },
                { key: "sym", label: "Symbol", active: syncSymbol, toggle: () => setSyncSymbol((v) => !v), icon: Link2 },
                { key: "tf", label: "Timeframe", active: syncTimeframe, toggle: () => setSyncTimeframe((v) => !v), icon: Clock },
                { key: "zoom", label: "Zoom", active: syncZoom, toggle: () => setSyncZoom((v) => !v), icon: ZoomIn },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.toggle}
                  className={`flex h-7 items-center gap-1 rounded-[4px] border px-2 text-[10.5px] font-medium transition-colors ${
                    item.active
                      ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-[var(--text-primary)]"
                      : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon className="size-3" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Presets & Bar Replay */}
        <div className="flex items-center gap-2">
          <div className="w-52">
            <SearchSelect
              value={selectedPresetId}
              onValueChange={handleApplyPreset}
              options={[
                ...allPresets.map((p) => ({ value: p.id, label: p.label })),
                { value: "__save__", label: "+ Сохранить текущую раскладку" },
              ]}
              placeholder="Пресеты раскладки..."
              className="h-7 text-[11px]"
            />
          </div>

          <button
            type="button"
            onClick={() => handleApplyPreset("__save__")}
            title="Сохранить раскладку"
            className="hidden h-7 items-center gap-1 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] sm:inline-flex"
          >
            <Save className="size-3" />
          </button>

          <button
            type="button"
            onClick={handleToggleReplay}
            className={`flex h-7 items-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] font-semibold transition-colors ${
              replayActive
                ? "border-[var(--accent-amber)] bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-primary)] hover:border-[var(--accent-amber)]"
            }`}
          >
            <History className="size-3.5" />
            <span>Bar Replay</span>
          </button>
        </div>
      </div>

      {/* Zero-Scroll Chart Grid */}
      <div
        className={`grid min-h-0 flex-1 gap-1.5 p-1.5 ${
          maximizedCellId ? "grid-cols-1 grid-rows-1" : currentLayoutDef.gridClass
        }`}
      >
        {visibleCells.map((cell) => {
          const canon = canonicalMarketSymbol(cell.symbol);
          const q = liveQuotes[canon];
          return (
            <ChartCell
              key={cell.id}
              cell={cell}
              isActive={activeCell?.id === cell.id}
              isMaximized={maximizedCellId === cell.id}
              canClose={cells.length > 1 && !maximizedCellId}
              liveQuote={q ? { price: q.price, changePct: q.changePct, source: q.source } : undefined}
              syncCrosshair={syncCrosshair}
              syncZoom={syncZoom}
              crosshairEvent={crosshairEvent}
              zoomEvent={zoomEvent}
              onBroadcastCrosshair={setCrosshairEvent}
              onBroadcastZoom={setZoomEvent}
              replayActive={replayActive}
              replayPickingStart={replayPickingStart}
              replayCursorTs={replayCursorTs}
              paperTrade={paperTrade}
              onReplayBarsReady={handleReplayBarsReady}
              onReplayPickStart={handleReplayPickStart}
              onSelect={() => setActiveCellId(cell.id)}
              onChangeSymbol={(sym) => handleChangeSymbol(cell.id, sym)}
              onChangeTimeframe={(tf) => handleChangeTimeframe(cell.id, tf)}
              onToggleIndicator={(ind) => handleToggleIndicator(cell.id, ind)}
              onToggleMt5Zones={() => handleToggleMt5Zones(cell.id)}
              onToggleMaximize={() =>
                setMaximizedCellId((cur) => (cur === cell.id ? null : cell.id))
              }
              onClose={() => handleCloseCell(cell.id)}
            />
          );
        })}
      </div>

      {/* Floating Bar Replay Control Bar */}
      {replayActive && activeCell && (
        <BarReplayBar
          symbol={`${activeCell.symbol} · ${activeCell.timeframe}`}
          playing={replayPlaying}
          pickingStart={replayPickingStart}
          speed={replaySpeed}
          barIndex={replayBarIdx + 1}
          totalBars={activeBars.length}
          currentPrice={replayCurrentPrice}
          currentTs={replayCursorTs}
          balanceUsd={paperBalance}
          realizedPnlUsd={paperRealized}
          openTrade={paperTrade}
          unrealizedPnlUsd={unrealizedPnlUsd}
          onTogglePickStart={() => setReplayPickingStart((v) => !v)}
          onTogglePlay={() => setReplayPlaying((v) => !v)}
          onStepForward={handleStepForward}
          onChangeSpeed={setReplaySpeed}
          onPaperBuy={() => openPaperPosition("BUY")}
          onPaperSell={() => openPaperPosition("SELL")}
          onPaperClose={closePaperPosition}
          onExit={handleToggleReplay}
        />
      )}
    </div>
  );
}
