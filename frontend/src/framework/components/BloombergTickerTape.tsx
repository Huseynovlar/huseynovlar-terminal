import { useEffect, useState } from "react";

import { AlertTriangle, Clock, Newspaper, TrendingDown, TrendingUp } from "lucide-react";

import { useTerminalStore } from "@/framework/terminal-store";

interface TickerItem {
  id: string;
  kind: "quote" | "news" | "event";
  tag: string;
  text: string;
  delta?: string;
  positive?: boolean;
}

const DEMO_TICKER_ITEMS: TickerItem[] = [
  { id: "q1", kind: "quote", tag: "XAUUSD", text: "2,642.50", delta: "+0.84%", positive: true },
  { id: "q2", kind: "quote", tag: "USTEC", text: "20,845.20", delta: "+0.41%", positive: true },
  { id: "q3", kind: "quote", tag: "DXY", text: "104.12", delta: "-0.26%", positive: false },
  { id: "q4", kind: "quote", tag: "US10Y", text: "4.21%", delta: "-0.04", positive: false },
  { id: "q5", kind: "quote", tag: "VIX", text: "14.80", delta: "-3.1%", positive: false },
  {
    id: "e1",
    kind: "event",
    tag: "HIGH IMPACT",
    text: "US CPI Release • XAUUSD / USTEC • Forecast 2.9% (Prev 3.1%)",
  },
  {
    id: "n1",
    kind: "news",
    tag: "XAUUSD",
    text: "Central bank gold demand accelerates in Q4 amid softer Treasury yields",
    positive: true,
  },
  {
    id: "n2",
    kind: "news",
    tag: "USTEC",
    text: "Mega-cap AI chipmakers lead NASDAQ-100 futures higher ahead of NY session",
    positive: true,
  },
];

function formatBakuTime(tz: string): string {
  try {
    const timeZone = tz === "Asia/Baku" ? "Asia/Baku" : "UTC";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "--:--:--";
  }
}

export function BloombergTickerTape() {
  const tickerEnabled = useTerminalStore((s) => s.tickerEnabled);
  const tickerSpeed = useTerminalStore((s) => s.tickerSpeed);
  const timezone = useTerminalStore((s) => s.timezone);
  const [clock, setClock] = useState(() => formatBakuTime(timezone));

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatBakuTime(timezone)), 1000);
    return () => window.clearInterval(id);
  }, [timezone]);

  if (!tickerEnabled) return null;

  const durationSec = tickerSpeed === "slow" ? 55 : tickerSpeed === "fast" ? 22 : 36;
  const doubled = [...DEMO_TICKER_ITEMS, ...DEMO_TICKER_ITEMS];

  return (
    <div className="bg-muted/40 relative flex h-8 w-full items-center overflow-hidden border-b border-border/60 text-xs select-none">
      {/* Live Session Clock Pill */}
      <div className="bg-background/95 z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-border/60 px-3 font-mono text-[11px] font-medium">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        <Clock className="text-muted-foreground size-3" />
        <span>{clock}</span>
        <span className="text-muted-foreground hidden sm:inline">({timezone})</span>
      </div>

      {/* Smooth CSS Marquee — pauses automatically on hover */}
      <div className="group flex flex-1 overflow-hidden">
        <div
          className="flex w-max items-center gap-6 px-4 group-hover:[animation-play-state:paused]"
          style={{
            animation: `ht-marquee ${durationSec}s linear infinite`,
          }}
        >
          {doubled.map((item, idx) => (
            <div key={`${item.id}-${idx}`} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              {item.kind === "quote" ? (
                <>
                  <span className="font-semibold tracking-tight">{item.tag}</span>
                  <span className="font-mono text-foreground/90">{item.text}</span>
                  <span
                    className={`inline-flex items-center gap-0.5 font-mono text-[11px] ${
                      item.positive ? "text-emerald-500" : "text-rose-500"
                    }`}
                  >
                    {item.positive ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {item.delta}
                  </span>
                </>
              ) : item.kind === "event" ? (
                <>
                  <AlertTriangle className="size-3 text-amber-500" />
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-500">
                    {item.tag}
                  </span>
                  <span className="text-foreground/90">{item.text}</span>
                </>
              ) : (
                <>
                  <Newspaper className="text-muted-foreground size-3" />
                  <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                    {item.tag}
                  </span>
                  <span className="text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
                    {item.text}
                  </span>
                </>
              )}
              <span className="text-border ml-3">•</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes ht-marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
