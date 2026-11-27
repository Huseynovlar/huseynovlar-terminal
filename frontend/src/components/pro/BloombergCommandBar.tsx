import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Terminal } from "lucide-react";

import { notify } from "@/components/ui/toast";
import { apiRequest } from "@/framework/api-client";
import { canonicalMarketSymbol } from "@/framework/open-market-ws";
import { soundEngine } from "@/framework/sound-engine";
import { useTerminalStore } from "@/framework/terminal-store";
import { useMarketListStream } from "@/framework/use-market-list-stream";
import {
  COMMAND_HINTS,
  loadCommandHistory,
  parseBloombergCommand,
  pushCommandHistory,
} from "@/services/commandParser";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

const AUTOCOMPLETE_TICKERS = [
  { symbol: "XAUUSD", name: "Gold / USD" },
  { symbol: "XAGUSD", name: "Silver / USD" },
  { symbol: "USTEC", name: "Nasdaq 100" },
  { symbol: "US500", name: "S&P 500" },
  { symbol: "US30", name: "Dow Jones 30" },
  { symbol: "BTCUSD", name: "Bitcoin / USD" },
  { symbol: "ETHUSD", name: "Ethereum / USD" },
  { symbol: "SOLUSD", name: "Solana / USD" },
  { symbol: "BNBUSD", name: "BNB / USD" },
  { symbol: "EURUSD", name: "Euro / USD" },
  { symbol: "GBPUSD", name: "British Pound / USD" },
  { symbol: "USDJPY", name: "USD / JPY" },
  { symbol: "USOIL", name: "WTI Crude Oil" },
  { symbol: "DXY", name: "US Dollar Index" },
];

interface BloombergCommandBarProps {
  onOpenCalc: (symbol?: string) => void;
  onOpenAlerts: () => void;
  onOpenHelp: () => void;
  onAlertCreated: () => void;
  onToggleAwake: (enabled: boolean) => void;
}

function fmtLivePrice(v?: number | null): string {
  if (!v || !Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 10) return v.toFixed(2);
  return v.toFixed(4);
}

export function BloombergCommandBar({
  onOpenCalc,
  onOpenAlerts,
  onOpenHelp,
  onAlertCreated,
  onToggleAwake,
}: BloombergCommandBarProps) {
  const navigate = useNavigate();
  const setSoundEnabled = useTerminalStore((s) => s.setSoundEnabled);
  const setPreference = usePreferencesStore((s) => s.setPreference);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadCommandHistory());
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const streamSymbols = useMemo(() => (focused ? AUTOCOMPLETE_TICKERS.map((t) => t.symbol) : []), [focused]);
  const liveQuotes = useMarketListStream(streamSymbols);

  // Sync dropdown position via portal so header overflow-hidden never clips it
  useEffect(() => {
    if (!focused) {
      setDropdownRect(null);
      return;
    }
    const updateRect = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDropdownRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 420) });
    };
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [focused]);

  // Global "/" and "Cmd/Ctrl + K" focus listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const suggestions = useMemo(() => {
    const q = value.trim().toUpperCase();
    const matchedTickers = AUTOCOMPLETE_TICKERS.filter(
      (t) => !q || t.symbol.includes(q) || t.name.toUpperCase().includes(q),
    ).slice(0, 5);
    const matchedCommands = COMMAND_HINTS.filter(
      (c) =>
        !q ||
        c.code.toUpperCase().includes(q) ||
        c.syntax.toUpperCase().includes(q) ||
        c.description.toUpperCase().includes(q),
    ).slice(0, 6);

    return [
      ...matchedTickers.map((t) => ({ kind: "ticker" as const, symbol: t.symbol, label: t.name })),
      ...matchedCommands.map((c) => ({ kind: "command" as const, code: c.code, syntax: c.syntax, desc: c.description })),
    ];
  }, [value]);

  const executeCommand = async (rawText: string, openInNewTab: boolean) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const nextHistory = pushCommandHistory(trimmed);
    setHistory(nextHistory);
    setHistoryIdx(-1);

    const parsed = parseBloombergCommand(trimmed);
    const goToPath = (path: string) => {
      if (openInNewTab) {
        window.open(path, "_blank", "noopener,noreferrer");
      } else {
        void navigate({ to: path as never });
      }
    };

    switch (parsed.kind) {
      case "ticker": {
        const qs = parsed.mode === "portfolio" ? "?mode=portfolio" : "";
        goToPath(`/dashboard/tickers/${encodeURIComponent(parsed.symbol)}${qs}`);
        break;
      }
      case "stat_arb": {
        const qs =
          parsed.symA && parsed.symB
            ? `?a=${encodeURIComponent(parsed.symA)}&b=${encodeURIComponent(parsed.symB)}`
            : "";
        goToPath(`/dashboard/stat-arb${qs}`);
        break;
      }
      case "news": {
        const qs = parsed.query ? `?q=${encodeURIComponent(parsed.query)}` : "";
        goToPath(`/dashboard/news${qs}`);
        break;
      }
      case "alert_price": {
        try {
          await apiRequest("/pro/alerts", {
            method: "POST",
            body: JSON.stringify({
              alert_type: "price_cross",
              symbol: parsed.symbol,
              condition: "above",
              threshold: parsed.price,
              channel_sound: true,
              channel_telegram: true,
              channel_os: true,
            }),
          });
          soundEngine.play("priceAlert");
          notify.success("Ценовой алерт создан", `${parsed.symbol} → ${parsed.price} (Звук + Telegram)`);
          onAlertCreated();
          onOpenAlerts();
        } catch (err) {
          notify.error("Ошибка создания алерта", err instanceof Error ? err.message : String(err));
        }
        break;
      }
      case "alert_arb": {
        try {
          await apiRequest("/pro/alerts", {
            method: "POST",
            body: JSON.stringify({
              alert_type: "stat_arb_z",
              symbol: parsed.symA,
              pair_symbol: parsed.symB,
              condition: "abs_gte",
              threshold: parsed.zScore,
              channel_sound: true,
              sound_tone: "mt5ZoneEnter",
              channel_telegram: true,
              channel_os: true,
            }),
          });
          soundEngine.play("mt5ZoneEnter");
          notify.success("Stat-Arb алерт создан", `${parsed.symA}/${parsed.symB} |Z| ≥ ${parsed.zScore}`);
          onAlertCreated();
          onOpenAlerts();
        } catch (err) {
          notify.error("Ошибка создания алерта", err instanceof Error ? err.message : String(err));
        }
        break;
      }
      case "alerts_open": {
        onOpenAlerts();
        break;
      }
      case "note": {
        try {
          await apiRequest("/pro/notes", {
            method: "POST",
            body: JSON.stringify({ symbol: parsed.symbol, text: parsed.text }),
          });
          soundEngine.play("levelClick");
          notify.success(`Заметка [${parsed.symbol}] сохранена`, parsed.text);
        } catch (err) {
          notify.error("Ошибка сохранения заметки", err instanceof Error ? err.message : String(err));
        }
        break;
      }
      case "route": {
        goToPath(parsed.path);
        break;
      }
      case "calc": {
        onOpenCalc(parsed.symbol);
        break;
      }
      case "scanner": {
        goToPath("/dashboard/tickers?tab=scanner");
        break;
      }
      case "theme": {
        setPreference("theme_mode", parsed.mode);
        notify.info("Тема переключена", parsed.mode === "dark" ? "Dark Mode" : "Light Mode");
        break;
      }
      case "mute": {
        setSoundEnabled(!parsed.muted);
        notify.info("SoundEngine", parsed.muted ? "Звук выключен (MUTE)" : "Звук включён (UNMUTE)");
        break;
      }
      case "awake": {
        onToggleAwake(parsed.enabled);
        break;
      }
      case "help": {
        onOpenHelp();
        break;
      }
      case "unknown": {
        notify.info("Неизвестная команда", `Введите HELP для списка команд («${parsed.raw}»)`);
        break;
      }
    }

    setValue("");
    setFocused(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!value.trim() && history.length > 0) {
        const nextIdx = Math.min(history.length - 1, historyIdx + 1);
        setHistoryIdx(nextIdx);
        setValue(history[nextIdx]);
      } else if (suggestions.length > 0) {
        setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx >= 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setValue(nextIdx >= 0 ? history[nextIdx] : "");
      } else if (suggestions.length > 0) {
        setActiveIdx((i) => (i + 1) % suggestions.length);
      }
      return;
    }
    if (e.key === "Tab" && suggestions[activeIdx]) {
      e.preventDefault();
      const item = suggestions[activeIdx];
      setValue(item.kind === "ticker" ? `${item.symbol} GP` : item.code);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (value.trim()) {
        void executeCommand(value, e.shiftKey);
      } else if (suggestions[activeIdx]) {
        const item = suggestions[activeIdx];
        void executeCommand(item.kind === "ticker" ? `${item.symbol} GP` : item.code, e.shiftKey);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative flex w-full max-w-[360px] items-center">
      <div
        className={`flex h-[30px] w-full items-center gap-1.5 rounded-[4px] border bg-[var(--bg-canvas)] px-2 font-mono text-[12px] transition-colors ${
          focused
            ? "border-[var(--accent-amber)] ring-1 ring-[var(--accent-amber)]/35"
            : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
        }`}
      >
        <Terminal className="size-3.5 shrink-0 text-[var(--accent-amber)]" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setHistoryIdx(-1);
            setActiveIdx(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            window.setTimeout(() => setFocused(false), 140);
          }}
          onKeyDown={handleKeyDown}
          placeholder="XAUUSD GP | ARB ETH BTC | CALC | HELP"
          aria-label="Bloomberg Command Bar"
          className="h-full w-full bg-transparent font-mono text-[11.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 py-0.5 font-mono text-[9px] text-[var(--text-muted)] sm:inline-block">
          /
        </kbd>
      </div>

      {focused &&
        dropdownRect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ top: dropdownRect.top, left: dropdownRect.left, width: dropdownRect.width }}
            className="fixed z-[9995] max-h-[380px] overflow-y-auto rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2.5 py-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="font-semibold uppercase tracking-[0.06em]">
                Bloomberg Command Bar
              </span>
              <span className="font-mono">Enter • Shift+Enter (новое окно) • ↑↓ история</span>
            </div>

            {suggestions.map((item, idx) => {
              const isSelected = idx === activeIdx;
              if (item.kind === "ticker") {
                const canon = canonicalMarketSymbol(item.symbol);
                const q = liveQuotes[canon];
                const online = Boolean(q?.price && q.price > 0);
                return (
                  <button
                    key={`tk-${item.symbol}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void executeCommand(`${item.symbol} GP`, e.shiftKey);
                    }}
                    className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                      isSelected ? "bg-[var(--accent-blue)]/15" : "hover:bg-[var(--bg-surface)]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-semibold text-[var(--text-primary)]">{item.symbol}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                      <span>{fmtLivePrice(q?.price)}</span>
                      <span
                        className={`rounded-[3px] px-1 py-0.5 text-[9px] font-semibold ${
                          online
                            ? "bg-[var(--bull)]/15 text-[var(--bull)]"
                            : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                        }`}
                      >
                        {online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </div>
                  </button>
                );
              }
              return (
                <button
                  key={`cmd-${item.code}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (item.syntax.includes("<")) {
                      setValue(`${item.code} `);
                      inputRef.current?.focus();
                    } else {
                      void executeCommand(item.code, e.shiftKey);
                    }
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11.5px] transition-colors ${
                    isSelected ? "bg-[var(--accent-blue)]/15" : "hover:bg-[var(--bg-surface)]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <code className="rounded-[3px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent-amber)]">
                      {item.syntax}
                    </code>
                    <span className="text-[11px] text-[var(--text-secondary)]">{item.desc}</span>
                  </div>
                  <CornerDownLeft className="size-3 shrink-0 text-[var(--text-muted)]" />
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
