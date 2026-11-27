import { useEffect } from "react";

import { Pause, Play, Scissors, StepForward, TrendingDown, TrendingUp, X } from "lucide-react";

import type { PaperTradeOverlay } from "./ChartCell";

export type ReplaySpeed = 0.5 | 1 | 3 | 5 | 10;

interface BarReplayBarProps {
  symbol: string;
  playing: boolean;
  pickingStart: boolean;
  speed: ReplaySpeed;
  barIndex: number;
  totalBars: number;
  currentPrice: number;
  currentTs: number | null;
  // Paper execution state
  balanceUsd: number;
  realizedPnlUsd: number;
  openTrade: PaperTradeOverlay | null;
  unrealizedPnlUsd: number;
  onTogglePickStart: () => void;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onChangeSpeed: (s: ReplaySpeed) => void;
  onPaperBuy: () => void;
  onPaperSell: () => void;
  onPaperClose: () => void;
  onExit: () => void;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 3, 5, 10];

export function BarReplayBar({
  symbol,
  playing,
  pickingStart,
  speed,
  barIndex,
  totalBars,
  currentPrice,
  currentTs,
  balanceUsd,
  realizedPnlUsd,
  openTrade,
  unrealizedPnlUsd,
  onTogglePickStart,
  onTogglePlay,
  onStepForward,
  onChangeSpeed,
  onPaperBuy,
  onPaperSell,
  onPaperClose,
  onExit,
}: BarReplayBarProps) {
  // Replay hotkeys: Space (Play/Pause), ArrowRight (+1 bar)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        onTogglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        onStepForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTogglePlay, onStepForward]);

  const totalEquity = balanceUsd + unrealizedPnlUsd;
  const totalPnl = realizedPnlUsd + unrealizedPnlUsd;

  return (
    <div className="fixed bottom-4 left-1/2 z-[9000] flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] text-[var(--text-primary)] shadow-2xl">
      <div className="flex items-center gap-1.5 border-r border-[var(--border-subtle)] pr-2">
        <span className="rounded-[3px] bg-[var(--accent-amber)]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--accent-amber)]">
          REPLAY
        </span>
        <span className="font-mono font-semibold">{symbol}</span>
        <span className="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
          {barIndex}/{totalBars}
        </span>
        {currentTs && (
          <span className="hidden font-mono text-[10px] text-[var(--text-muted)] tabular-nums md:inline">
            {new Date(currentTs).toISOString().slice(0, 16).replace("T", " ")} UTC
          </span>
        )}
      </div>

      {/* Transport Controls */}
      <div className="flex items-center gap-1 border-r border-[var(--border-subtle)] pr-2">
        <button
          type="button"
          onClick={onTogglePickStart}
          title="Выбрать точку старта (клик по свече)"
          className={`flex h-7 items-center gap-1 rounded-[3px] border px-2 font-medium transition-colors ${
            pickingStart
              ? "border-[var(--accent-amber)] bg-[var(--accent-amber)]/15 text-[var(--accent-amber)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Scissors className="size-3" />
          <span className="hidden sm:inline">Старт</span>
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          title="Play / Pause (Space)"
          className="flex h-7 w-7 items-center justify-center rounded-[3px] bg-[var(--accent-blue)] text-white hover:opacity-90"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>

        <button
          type="button"
          onClick={onStepForward}
          title="Шаг вперёд +1 свеча (→)"
          className="flex h-7 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 font-mono text-[10.5px] font-semibold hover:border-[var(--border-strong)]"
        >
          <StepForward className="size-3" />
          +1
        </button>

        <div className="flex rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChangeSpeed(s)}
              className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                speed === s ? "bg-[var(--accent-blue)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Paper Execution */}
      <div className="flex items-center gap-1.5 border-r border-[var(--border-subtle)] pr-2">
        <button
          type="button"
          onClick={onPaperBuy}
          disabled={Boolean(openTrade) || currentPrice <= 0}
          className="flex h-7 items-center gap-1 rounded-[3px] bg-[var(--bull)] px-2.5 font-mono text-[10.5px] font-bold text-white disabled:opacity-40"
        >
          <TrendingUp className="size-3" />
          BUY
        </button>
        <button
          type="button"
          onClick={onPaperSell}
          disabled={Boolean(openTrade) || currentPrice <= 0}
          className="flex h-7 items-center gap-1 rounded-[3px] bg-[var(--bear)] px-2.5 font-mono text-[10.5px] font-bold text-white disabled:opacity-40"
        >
          <TrendingDown className="size-3" />
          SELL
        </button>
        {openTrade && (
          <button
            type="button"
            onClick={onPaperClose}
            className="h-7 rounded-[3px] border border-[var(--accent-amber)] bg-[var(--accent-amber)]/15 px-2 font-mono text-[10.5px] font-semibold text-[var(--accent-amber)]"
          >
            CLOSE ({unrealizedPnlUsd >= 0 ? "+" : ""}
            ${unrealizedPnlUsd.toFixed(1)})
          </button>
        )}

        <div className="ml-1 flex flex-col font-mono text-[10px] leading-tight tabular-nums">
          <span className="text-[var(--text-muted)]">
            Bal: <strong className="text-[var(--text-primary)]">${totalEquity.toFixed(0)}</strong>
          </span>
          <span style={{ color: totalPnl >= 0 ? "var(--bull)" : "var(--bear)" }}>
            PnL: {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onExit}
        title="Выход из Replay (возврат к /ws/market)"
        className="flex h-7 items-center gap-1 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[10.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--bear)] hover:text-[var(--bear)]"
      >
        <X className="size-3" />
        Выход
      </button>
    </div>
  );
}
