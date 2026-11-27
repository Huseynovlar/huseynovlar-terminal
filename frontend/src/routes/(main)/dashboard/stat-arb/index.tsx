import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  Calculator,
  Grid2x2,
  LayoutPanelLeft,
  Maximize2,
  Pin,
  Plus,
  RefreshCw,
  Table2,
  X,
} from "lucide-react";

import {
  DistributionEquityChart,
  MiniZScoreSparkChart,
  OverlayPricesChart,
  RollingBetaCorrChart,
  StatArbMatrixChart,
  ZScoreSpreadChart,
} from "@/components/institutional/StatArbCharts";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { AssetLogo } from "@/framework/components/AssetLogo";
import { soundEngine } from "@/framework/sound-engine";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useMarketListStream } from "@/framework/use-market-list-stream";

export const Route = createFileRoute("/(main)/dashboard/stat-arb/")({
  component: StatArbCockpitPage,
});

interface ScreenerPair {
  pair_id: string;
  asset_a: string;
  asset_b: string;
  price_a: number;
  price_b: number;
  z_score: number;
  signal: string;
  corr: number;
  corr_delta_7d: number;
  adf_pvalue: number;
  half_life_bars: number;
  half_life_hours: number;
  hedge_ratio: number;
  alpha: number;
  spread_mean: number;
  spread_std: number;
  hurst: number;
  winrate_pct: number;
  sharpe: number;
  trades_count: number;
  total_return_pct: number;
  spark_z: number[];
}

interface PairAnalysisResponse extends ScreenerPair {
  percentile: number;
  timestamps: string[];
  z_series: number[];
  norm_a: number[];
  norm_b: number[];
  rolling_corr: Array<number | null>;
  rolling_beta: Array<number | null>;
  histogram: { bins: string[]; counts: number[]; current_bin: number; percentile: number };
  backtest: {
    equity_curve: Array<{ ts: string; equity: number }>;
    markers: Array<{ ts: string; z: number; side: string; action: string }>;
    winrate_pct: number;
    sharpe: number;
    total_return_pct: number;
    trades_count: number;
  };
}

interface MatrixResponse {
  assets: string[];
  correlation: Array<[number, number, number]>;
  cointegration: Array<[number, number, number]>;
  abs_zscore: Array<[number, number, number]>;
}

type LayoutPreset = "focus" | "grid4" | "matrix";
type UniverseId = "crypto" | "equities" | "fx_metals";
type TimeframeId = "M5" | "M15" | "H1" | "H4" | "D1";
type SortCol = "z_score" | "corr" | "adf_pvalue" | "half_life_bars" | "hedge_ratio" | "hurst" | "sharpe";

function signalColor(sig: string): string {
  if (sig === "LONG SPREAD") return "var(--bull)";
  if (sig === "SHORT SPREAD" || sig.startsWith("BROKEN")) return "var(--bear)";
  if (sig === "MEAN REVERTED") return "var(--accent-amber)";
  return "var(--text-muted)";
}

function StatArbCockpitPage() {
  const [preset, setPreset] = useState<LayoutPreset>("focus");
  const [universe, setUniverse] = useState<UniverseId>("crypto");
  const [tf, setTf] = useState<TimeframeId>("H1");
  const [lookback, setLookback] = useState<number>(200);
  const [entryZ, setEntryZ] = useState<number>(2.0);
  const [exitZ, setExitZ] = useState<number>(0.2);
  const [stopZ, setStopZ] = useState<number>(3.5);
  const [sortCol, setSortCol] = useState<SortCol>("z_score");
  const [sortAsc, setSortAsc] = useState(false);

  const [pairs, setPairs] = useState<ScreenerPair[]>([]);
  const [selectedPair, setSelectedPair] = useState<{ a: string; b: string }>({ a: "ETHUSD", b: "BTCUSD" });
  const [analysis, setAnalysis] = useState<PairAnalysisResponse | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<MatrixResponse | null>(null);
  const [matrixMode, setMatrixMode] = useState<"correlation" | "cointegration" | "abs_zscore">("correlation");
  const [distMode, setDistMode] = useState<"equity" | "histogram">("equity");

  // Dollar-Neutral Position Sizing Calculator
  const [capitalUsd, setCapitalUsd] = useState<number>(1000);

  // Custom Pair modal state
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customA, setCustomA] = useState("XAUUSD");
  const [customB, setCustomB] = useState("XAGUSD");

  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const alertedPairsRef = useRef<Set<string>>(new Set());

  const loadScreener = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams({
          universe,
          tf,
          lookback: String(lookback),
          entry_z: String(entryZ),
          exit_z: String(exitZ),
          stop_z: String(stopZ),
        });
        const res = await apiRequest<{ pairs: ScreenerPair[] }>(`/stat-arb/screener?${qs.toString()}`);
        const list = res.pairs ?? [];
        setPairs(list);
        if (list.length > 0) {
          setSelectedPair((prev) =>
            list.some((p) => p.asset_a === prev.a && p.asset_b === prev.b)
              ? prev
              : { a: list[0].asset_a, b: list[0].asset_b },
          );
          setPinnedIds((prev) => (prev.length > 0 ? prev : list.slice(0, 4).map((p) => p.pair_id)));
        }
      } catch (err) {
        if (!silent) notify.error("Ошибка сканера Stat-Arb", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [universe, tf, lookback, entryZ, exitZ, stopZ],
  );

  const loadAnalysis = useCallback(
    async (a: string, b: string, silent = false) => {
      if (!silent) setAnalyzing(true);
      try {
        const qs = new URLSearchParams({
          asset_a: a,
          asset_b: b,
          tf,
          lookback: String(lookback),
          entry_z: String(entryZ),
          exit_z: String(exitZ),
          stop_z: String(stopZ),
        });
        const res = await apiRequest<PairAnalysisResponse>(`/stat-arb/analyze?${qs.toString()}`);
        setAnalysis(res);
      } catch (err) {
        if (!silent) notify.error("Ошибка анализа пары", err instanceof Error ? err.message : String(err));
      } finally {
        if (!silent) setAnalyzing(false);
      }
    },
    [tf, lookback, entryZ, exitZ, stopZ],
  );

  const loadMatrix = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ universe, tf, lookback: String(lookback) });
      const res = await apiRequest<MatrixResponse>(`/stat-arb/matrix?${qs.toString()}`);
      setMatrix(res);
    } catch (err) {
      notify.error("Ошибка загрузки матрицы", err instanceof Error ? err.message : String(err));
    }
  }, [universe, tf, lookback]);

  useEffect(() => {
    void loadScreener(false);
  }, [loadScreener]);

  useEffect(() => {
    void loadAnalysis(selectedPair.a, selectedPair.b, false);
  }, [selectedPair.a, selectedPair.b, loadAnalysis]);

  useEffect(() => {
    if (preset === "matrix") void loadMatrix();
  }, [preset, loadMatrix]);

  // Live /ws/market streaming for all visible pair legs (zero REST polling!)
  const wsSymbols = useMemo(() => {
    const s = new Set<string>([selectedPair.a, selectedPair.b]);
    for (const p of pairs) {
      s.add(p.asset_a);
      s.add(p.asset_b);
    }
    return Array.from(s).slice(0, 30);
  }, [pairs, selectedPair.a, selectedPair.b]);

  const liveQuotes = useMarketListStream(wsSymbols);

  // Compute live Z-score from incoming /ws/market quotes (Spread = ln(A) - beta * ln(B))
  const computeLiveZ = useCallback(
    (pair: ScreenerPair): { z: number; pxA: number; pxB: number; signal: string } => {
      const pxA = liveQuotes[pair.asset_a]?.price ?? pair.price_a;
      const pxB = liveQuotes[pair.asset_b]?.price ?? pair.price_b;
      if (!(pxA > 0) || !(pxB > 0) || !(pair.spread_std > 0)) {
        return { z: pair.z_score, pxA: pair.price_a, pxB: pair.price_b, signal: pair.signal };
      }
      const sp = Math.log(pxA) - (pair.alpha + pair.hedge_ratio * Math.log(pxB));
      const z = Number(((sp - pair.spread_mean) / pair.spread_std).toFixed(3));
      const signal =
        Math.abs(z) >= stopZ
          ? "BROKEN (Stop)"
          : z <= -entryZ
            ? "LONG SPREAD"
            : z >= entryZ
              ? "SHORT SPREAD"
              : Math.abs(z) <= exitZ
                ? "MEAN REVERTED"
                : "NEUTRAL";
      return { z, pxA, pxB, signal };
    },
    [liveQuotes, entryZ, exitZ, stopZ],
  );

  // SoundEngine alert when a tracked pair crosses |Z| >= entryZ
  useEffect(() => {
    for (const p of pairs) {
      const live = computeLiveZ(p);
      if (Math.abs(live.z) >= entryZ && !alertedPairsRef.current.has(p.pair_id)) {
        alertedPairsRef.current.add(p.pair_id);
        soundEngine.play("priceAlert");
      }
    }
  }, [pairs, computeLiveZ, entryZ]);

  const sortedPairs = useMemo(() => {
    const arr = [...pairs];
    arr.sort((a, b) => {
      const va = sortCol === "z_score" ? Math.abs(computeLiveZ(a).z) : a[sortCol];
      const vb = sortCol === "z_score" ? Math.abs(computeLiveZ(b).z) : b[sortCol];
      return sortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [pairs, sortCol, sortAsc, computeLiveZ]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc((v) => !v);
    else {
      setSortCol(col);
      setSortAsc(col === "adf_pvalue" || col === "half_life_bars" || col === "hurst");
    }
  };

  const togglePin = (pairId: string) => {
    setPinnedIds((prev) =>
      prev.includes(pairId) ? prev.filter((id) => id !== pairId) : [...prev, pairId].slice(-6),
    );
  };

  async function handleSendAlert(pair: ScreenerPair) {
    const live = computeLiveZ(pair);
    soundEngine.play("priceAlert", true);
    try {
      const res = await apiRequest<{ ok: boolean; error?: string }>("/stat-arb/alert", {
        method: "POST",
        body: JSON.stringify({
          asset_a: pair.asset_a,
          asset_b: pair.asset_b,
          z_score: live.z,
          hedge_ratio: pair.hedge_ratio,
          adf_pvalue: pair.adf_pvalue,
          half_life_hours: pair.half_life_hours,
          signal: live.signal,
        }),
      });
      if (res.ok) notify.success("Алерт отправлен в Telegram", `${pair.asset_a}/${pair.asset_b}`);
      else notify.error("Ошибка Telegram", res.error || "Проверьте настройки Docker-сети huseynovlar_webhooks");
    } catch (err) {
      notify.error("Ошибка отправки алерта", err instanceof Error ? err.message : String(err));
    }
  }

  // Dollar-Neutral Sizing Calculation for selected pair
  const sizing = useMemo(() => {
    if (!analysis) return null;
    const live = computeLiveZ(analysis);
    const absBeta = Math.max(0.05, Math.abs(analysis.hedge_ratio));
    const cap = Math.max(10, capitalUsd);
    const usdA = cap / (1 + absBeta);
    const usdB = cap - usdA;
    const qtyA = live.pxA > 0 ? usdA / live.pxA : 0;
    const qtyB = live.pxB > 0 ? usdB / live.pxB : 0;
    const isLongSpread = live.z <= 0;
    return {
      sideA: isLongSpread ? "LONG" : "SHORT",
      sideB: isLongSpread ? "SHORT" : "LONG",
      usdA,
      usdB,
      qtyA,
      qtyB,
      liveZ: live.z,
      signal: live.signal,
    };
  }, [analysis, capitalUsd, computeLiveZ]);

  const liveZSeries = useMemo(() => {
    if (!analysis) return [];
    const live = computeLiveZ(analysis);
    if (analysis.z_series.length === 0) return [];
    return [...analysis.z_series.slice(0, -1), live.z];
  }, [analysis, computeLiveZ]);

  return (
    <TerminalPageShell
      title="Статистический арбитраж и Спреды"
      subtitle="Quant Engine (OLS / Engle-Granger ADF / Half-Life / Hurst / Backtest) · Живой Z-Score по /ws/market · Multi-Window"
      badge={analysis ? `${analysis.asset_a}/${analysis.asset_b} · Z ${sizing?.liveZ.toFixed(2) ?? analysis.z_score.toFixed(2)}σ` : "QUANT"}
      actions={
        <div className="flex items-center gap-1.5">
          {/* 3 Layout Presets */}
          <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
            {[
              { id: "focus", label: "Focus 3-Pane", icon: LayoutPanelLeft },
              { id: "grid4", label: "Multi-Chart 4-Grid", icon: Grid2x2 },
              { id: "matrix", label: "Matrix & Quant Lab", icon: Table2 },
            ].map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id as LayoutPreset)}
                  className={`inline-flex h-7 items-center gap-1 rounded-[3px] px-2.5 font-semibold ${
                    preset === p.id
                      ? "bg-[var(--accent-blue)] text-white"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{p.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setShowCustomModal((v) => !v)}
            className="inline-flex h-8 items-center gap-1 rounded-[4px] bg-[var(--accent-blue)] px-2.5 text-xs font-semibold text-white hover:opacity-90"
          >
            <Plus className="size-3.5" />
            Своя пара
          </button>
          <button
            type="button"
            onClick={() => void loadScreener(false)}
            className="inline-flex h-8 items-center rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            title="Пересчитать"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      }
    >
      <div className="space-y-2.5">
        {/* 44px Top Control & Filter Bar */}
        <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1.5 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Universe */}
            <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
              {[
                { id: "crypto", label: "Крипто" },
                { id: "equities", label: "Акции США" },
                { id: "fx_metals", label: "Форекс и Металлы" },
              ].map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setUniverse(u.id as UniverseId)}
                  className={`h-6 rounded-[3px] px-2 font-semibold ${
                    universe === u.id ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {u.label}
                </button>
              ))}
            </div>

            {/* Timeframe */}
            <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 tabular-nums">
              {(["M5", "M15", "H1", "H4", "D1"] as TimeframeId[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTf(t)}
                  className={`h-6 rounded-[3px] px-2 font-semibold ${
                    tf === t ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Lookback */}
            <select
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
              className="h-7 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] tabular-nums text-[var(--text-primary)]"
            >
              <option value={100}>100 баров</option>
              <option value={200}>200 баров</option>
              <option value={500}>500 баров</option>
              <option value={1000}>1000 баров</option>
            </select>
          </div>

          {/* Thresholds */}
          <div className="flex flex-wrap items-center gap-2 tabular-nums">
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              Вход |Z|≥
              <input
                type="number"
                step="0.1"
                value={entryZ}
                onChange={(e) => setEntryZ(Number(e.target.value) || 2.0)}
                className="h-6 w-12 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 text-center text-[11px] font-semibold text-[var(--text-primary)]"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              Выход |Z|≤
              <input
                type="number"
                step="0.1"
                value={exitZ}
                onChange={(e) => setExitZ(Number(e.target.value) || 0.2)}
                className="h-6 w-12 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 text-center text-[11px] font-semibold text-[var(--text-primary)]"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
              Стоп |Z|≥
              <input
                type="number"
                step="0.1"
                value={stopZ}
                onChange={(e) => setStopZ(Number(e.target.value) || 3.5)}
                className="h-6 w-12 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1 text-center text-[11px] font-semibold text-[var(--text-primary)]"
              />
            </label>
          </div>
        </div>

        {/* Inline Custom Pair Builder */}
        {showCustomModal ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[var(--accent-blue)] bg-[var(--bg-panel)] px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[var(--text-primary)]">Произвольная пара:</span>
              <input
                type="text"
                value={customA}
                onChange={(e) => setCustomA(e.target.value.toUpperCase())}
                placeholder="XAUUSD"
                className="h-7 w-28 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-semibold text-[var(--text-primary)]"
              />
              <span className="text-[var(--text-muted)]">vs</span>
              <input
                type="text"
                value={customB}
                onChange={(e) => setCustomB(e.target.value.toUpperCase())}
                placeholder="XAGUSD"
                className="h-7 w-28 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 font-semibold text-[var(--text-primary)]"
              />
              <button
                type="button"
                onClick={() => {
                  if (!customA.trim() || !customB.trim()) return;
                  setSelectedPair({ a: customA.trim(), b: customB.trim() });
                  setPreset("focus");
                  setShowCustomModal(false);
                }}
                className="h-7 rounded-[4px] bg-[var(--accent-blue)] px-3 font-semibold text-white"
              >
                Прогнать коинтеграцию
              </button>
            </div>
            <button type="button" onClick={() => setShowCustomModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X className="size-4" />
            </button>
          </div>
        ) : null}

        {/* PRESET 2: Multi-Chart 4-Grid (simultaneous 4-6 pairs) */}
        {preset === "grid4" ? (
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {pairs
              .filter((p) => pinnedIds.includes(p.pair_id))
              .concat(pairs.filter((p) => !pinnedIds.includes(p.pair_id)))
              .slice(0, 6)
              .map((p) => {
                const live = computeLiveZ(p);
                const spark = [...p.spark_z.slice(0, -1), live.z];
                return (
                  <div
                    key={p.pair_id}
                    className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between border-b border-[var(--border-subtle)] pb-1.5">
                      <div className="flex items-center gap-1.5">
                        <AssetLogo symbol={p.asset_a} size={15} />
                        <span className="text-xs font-semibold text-[var(--text-primary)]">
                          {p.asset_a} / {p.asset_b}
                        </span>
                        <span
                          className="rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${signalColor(live.signal)} 16%, transparent)`,
                            color: signalColor(live.signal),
                          }}
                        >
                          {live.signal}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 tabular-nums">
                        <span className="text-xs font-bold" style={{ color: signalColor(live.signal) }}>
                          {live.z >= 0 ? "+" : ""}
                          {live.z.toFixed(2)}σ
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPair({ a: p.asset_a, b: p.asset_b });
                            setPreset("focus");
                          }}
                          className="rounded-[3px] border border-[var(--border-subtle)] p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          title="Развернуть в Focus"
                        >
                          <Maximize2 className="size-3" />
                        </button>
                      </div>
                    </div>
                    <MiniZScoreSparkChart values={spark} entryZ={entryZ} stopZ={stopZ} />
                    <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-[var(--text-muted)]">
                      <span>β: {p.hedge_ratio.toFixed(3)}</span>
                      <span>ADF p: {p.adf_pvalue.toFixed(3)}</span>
                      <span>HL: {p.half_life_bars}b</span>
                      <span>H: {p.hurst.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : null}

        {/* PRESET 3: Matrix & Quant Lab */}
        {preset === "matrix" ? (
          <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <span className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                Матрица корреляции и коинтеграции (клик по ячейке → анализ пары)
              </span>
              <div className="inline-flex rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[11px]">
                {[
                  { id: "correlation", label: "Корреляция (Pearson)" },
                  { id: "cointegration", label: "Коинтеграция (ADF p)" },
                  { id: "abs_zscore", label: "Текущий |Z-Score|" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMatrixMode(m.id as typeof matrixMode)}
                    className={`rounded-[3px] px-2.5 py-0.5 font-semibold ${
                      matrixMode === m.id ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {matrix ? (
              <StatArbMatrixChart
                assets={matrix.assets}
                cells={matrix[matrixMode]}
                mode={matrixMode}
                onSelectPair={(a, b) => {
                  setSelectedPair({ a, b });
                  setPreset("focus");
                }}
              />
            ) : (
              <PageSkeleton />
            )}
          </div>
        ) : null}

        {/* PRESET 1: Focus 3-Pane (Screener + 4 Synced Charts + Dollar-Neutral Calculator) */}
        {preset === "focus" ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
            {/* Panel 1 — Quant Screener Table */}
            <div className="flex flex-col overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] xl:col-span-5">
              <div className="flex h-8 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                <span>Сканер коинтегрированных пар ({sortedPairs.length})</span>
                <span>Клик по строке → 4 графика</span>
              </div>
              <div className="max-h-[760px] overflow-x-auto overflow-y-auto">
                {loading && pairs.length === 0 ? (
                  <div className="p-3">
                    <PageSkeleton />
                  </div>
                ) : (
                  <table className="w-full border-collapse text-left text-[11px] tabular-nums">
                    <thead>
                      <tr className="h-7 border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[9px] uppercase text-[var(--text-muted)]">
                        <th className="px-2">Пара</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("z_score")}>Z-Score</th>
                        <th className="px-1.5">Сигнал</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("corr")}>Corr</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("adf_pvalue")}>ADF p</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("half_life_bars")}>HL</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("hedge_ratio")}>β</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("hurst")}>H</th>
                        <th className="cursor-pointer px-1.5 text-right" onClick={() => handleSort("sharpe")}>WR/Sh</th>
                        <th className="px-1.5 text-right">Действ.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {sortedPairs.map((p) => {
                        const live = computeLiveZ(p);
                        const isSel = selectedPair.a === p.asset_a && selectedPair.b === p.asset_b;
                        const isPinned = pinnedIds.includes(p.pair_id);
                        return (
                          <tr
                            key={p.pair_id}
                            onClick={() => setSelectedPair({ a: p.asset_a, b: p.asset_b })}
                            className={`h-9 cursor-pointer transition-colors ${
                              isSel ? "bg-[var(--bg-elevated)]" : "hover:bg-[var(--bg-elevated)]/40"
                            }`}
                          >
                            <td className="px-2 font-semibold text-[var(--text-primary)]">
                              <div className="flex items-center gap-1">
                                <AssetLogo symbol={p.asset_a} size={13} />
                                <span>
                                  {p.asset_a.replace("USD", "")}/{p.asset_b.replace("USD", "")}
                                </span>
                              </div>
                            </td>
                            <td className="px-1.5 text-right font-bold" style={{ color: signalColor(live.signal) }}>
                              {live.z >= 0 ? "+" : ""}
                              {live.z.toFixed(2)}
                            </td>
                            <td className="px-1.5">
                              <span
                                className="rounded-[2px] px-1 py-0.5 text-[9px] font-bold"
                                style={{
                                  backgroundColor: `color-mix(in srgb, ${signalColor(live.signal)} 15%, transparent)`,
                                  color: signalColor(live.signal),
                                }}
                              >
                                {live.signal.replace(" SPREAD", "")}
                              </span>
                            </td>
                            <td className="px-1.5 text-right text-[var(--text-secondary)]">
                              {p.corr.toFixed(2)}
                            </td>
                            <td className="px-1.5 text-right">
                              <span
                                className="rounded-[2px] px-1 py-0.5 text-[10px] font-semibold"
                                style={{
                                  color: p.adf_pvalue < 0.05 ? "var(--bull)" : "var(--text-muted)",
                                }}
                              >
                                {p.adf_pvalue.toFixed(3)}
                              </span>
                            </td>
                            <td className="px-1.5 text-right text-[var(--text-secondary)]">{p.half_life_bars}b</td>
                            <td className="px-1.5 text-right text-[var(--text-secondary)]">{p.hedge_ratio.toFixed(2)}</td>
                            <td
                              className="px-1.5 text-right font-semibold"
                              style={{ color: p.hurst < 0.5 ? "var(--bull)" : "var(--accent-amber)" }}
                            >
                              {p.hurst.toFixed(2)}
                            </td>
                            <td className="px-1.5 text-right text-[10px] text-[var(--text-secondary)]">
                              {p.winrate_pct.toFixed(0)}%/{p.sharpe.toFixed(1)}
                            </td>
                            <td className="px-1.5 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    togglePin(p.pair_id);
                                  }}
                                  className="rounded p-0.5 hover:bg-[var(--bg-canvas)]"
                                  style={{ color: isPinned ? "var(--accent-blue)" : "var(--text-muted)" }}
                                  title="Закрепить в 4-Grid"
                                >
                                  <Pin className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleSendAlert(p);
                                  }}
                                  className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--accent-amber)]"
                                  title="Отправить алерт в Telegram"
                                >
                                  <Bell className="size-3" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Panel 2 & 3 — 4 Synchronized Charts + Dollar-Neutral Sizing Calculator */}
            <div className="space-y-2.5 xl:col-span-7">
              {analyzing && !analysis ? (
                <PageSkeleton />
              ) : analysis ? (
                <>
                  {/* Window A: Live Z-Score */}
                  <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1.5 text-[11px]">
                      <span className="font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                        Окно А · Живой Z-Score ({analysis.asset_a} / {analysis.asset_b})
                      </span>
                      <div className="flex items-center gap-3 tabular-nums text-[10px] text-[var(--text-muted)]">
                        <span>ADF p: <b style={{ color: analysis.adf_pvalue < 0.05 ? "var(--bull)" : "var(--text-primary)" }}>{analysis.adf_pvalue.toFixed(4)}</b></span>
                        <span>Half-Life: <b className="text-[var(--text-primary)]">{analysis.half_life_bars}b ({analysis.half_life_hours}h)</b></span>
                        <span>Hurst: <b style={{ color: analysis.hurst < 0.5 ? "var(--bull)" : "var(--accent-amber)" }}>{analysis.hurst.toFixed(3)}</b></span>
                        <span>Перцентиль: <b className="text-[var(--accent-amber)]">{analysis.percentile.toFixed(1)}%</b></span>
                      </div>
                    </div>
                    <ZScoreSpreadChart
                      timestamps={analysis.timestamps}
                      zSeries={liveZSeries}
                      entryZ={entryZ}
                      stopZ={stopZ}
                      markers={analysis.backtest.markers}
                    />
                  </div>

                  {/* Window B + Window C */}
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
                      <div className="mb-1 border-b border-[var(--border-subtle)] pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                        Окно Б · Наложенные цены (Base = 100)
                      </div>
                      <OverlayPricesChart
                        timestamps={analysis.timestamps}
                        assetA={analysis.asset_a}
                        assetB={analysis.asset_b}
                        normA={analysis.norm_a}
                        normB={analysis.norm_b}
                      />
                    </div>

                    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
                      <div className="mb-1 border-b border-[var(--border-subtle)] pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                        Окно В · Rolling Correlation & Hedge Ratio (β)
                      </div>
                      <RollingBetaCorrChart
                        timestamps={analysis.timestamps}
                        rollingCorr={analysis.rolling_corr}
                        rollingBeta={analysis.rolling_beta}
                      />
                    </div>
                  </div>

                  {/* Window D + Panel 3 Dollar-Neutral Sizing */}
                  <div className="grid grid-cols-1 gap-2.5 md:grid-cols-12">
                    <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2.5 md:col-span-7">
                      <div className="mb-1 flex items-center justify-between border-b border-[var(--border-subtle)] pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                          Окно Г · {distMode === "equity" ? `Эквити бэктеста (${analysis.backtest.total_return_pct >= 0 ? "+" : ""}${analysis.backtest.total_return_pct}%)` : `Гистограмма Z (${analysis.percentile.toFixed(1)}th)`}
                        </span>
                        <div className="inline-flex rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5 text-[9px]">
                          <button
                            type="button"
                            onClick={() => setDistMode("equity")}
                            className={`rounded-[2px] px-1.5 py-0.5 font-semibold ${distMode === "equity" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"}`}
                          >
                            Эквити
                          </button>
                          <button
                            type="button"
                            onClick={() => setDistMode("histogram")}
                            className={`rounded-[2px] px-1.5 py-0.5 font-semibold ${distMode === "histogram" ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)]"}`}
                          >
                            Гистограмма
                          </button>
                        </div>
                      </div>
                      <DistributionEquityChart
                        mode={distMode}
                        histogram={analysis.histogram}
                        equityCurve={analysis.backtest.equity_curve}
                      />
                    </div>

                    {/* Panel 3: Dollar-Neutral Position Sizing Calculator */}
                    <div className="flex flex-col justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 md:col-span-5">
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] pb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
                          <Calculator className="size-3.5 text-[var(--accent-blue)]" />
                          Dollar-Neutral Sizing (β = {analysis.hedge_ratio.toFixed(3)})
                        </div>

                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-[var(--text-muted)]">Капитал ($ USD):</span>
                          <input
                            type="number"
                            min={10}
                            step={100}
                            value={capitalUsd}
                            onChange={(e) => setCapitalUsd(Number(e.target.value) || 1000)}
                            className="h-7 w-28 rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-right font-semibold tabular-nums text-[var(--text-primary)]"
                          />
                        </div>

                        {sizing ? (
                          <div className="space-y-1.5 text-[11px] tabular-nums">
                            <div className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
                              <span
                                className="font-bold"
                                style={{ color: sizing.sideA === "LONG" ? "var(--bull)" : "var(--bear)" }}
                              >
                                {sizing.sideA} {analysis.asset_a}
                              </span>
                              <span className="font-semibold text-[var(--text-primary)]">
                                ${sizing.usdA.toFixed(2)} ({sizing.qtyA.toFixed(4)})
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5">
                              <span
                                className="font-bold"
                                style={{ color: sizing.sideB === "LONG" ? "var(--bull)" : "var(--bear)" }}
                              >
                                {sizing.sideB} {analysis.asset_b}
                              </span>
                              <span className="font-semibold text-[var(--text-primary)]">
                                ${sizing.usdB.toFixed(2)} ({sizing.qtyB.toFixed(4)})
                              </span>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleSendAlert(analysis)}
                        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[4px] border border-[var(--accent-blue)] bg-[var(--accent-blue)]/15 text-xs font-semibold text-[var(--accent-blue)] hover:bg-[var(--accent-blue)] hover:text-white"
                      >
                        <Bell className="size-3.5" />
                        Отправить карточку в Telegram
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </TerminalPageShell>
  );
}
