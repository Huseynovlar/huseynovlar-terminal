import { useEffect, useState } from "react";

import { BadgeCheck, Clock, Newspaper } from "lucide-react";

import { apiRequest } from "@/framework/api-client";
import { useTerminalStore } from "@/framework/terminal-store";

interface LiveHeadline {
  id: string;
  source: string;
  title: string;
  is_verified_source?: boolean;
  affected_assets: string[];
}

function formatClock(tz: string): string {
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
  const [clock, setClock] = useState(() => formatClock(timezone));
  const [headlines, setHeadlines] = useState<LiveHeadline[]>([]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(formatClock(timezone)), 1000);
    return () => window.clearInterval(id);
  }, [timezone]);

  useEffect(() => {
    apiRequest<LiveHeadline[]>("/intelligence/news?verified_only=true&limit=12")
      .then((rows) => setHeadlines(rows))
      .catch(() => setHeadlines([]));
  }, []);

  if (!tickerEnabled) return null;

  const durationSec = tickerSpeed === "slow" ? 55 : tickerSpeed === "fast" ? 22 : 36;
  const doubled = headlines.length > 0 ? [...headlines, ...headlines] : [];

  return (
    <div className="bg-muted/40 relative flex h-8 w-full items-center overflow-hidden border-b border-border/60 text-xs select-none">
      {/* Live Session Clock Pill */}
      <div className="bg-background/95 z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-border/60 px-3 font-mono text-[11px] font-medium">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        <Clock className="text-muted-foreground size-3" />
        <span>{clock}</span>
        <span className="text-muted-foreground hidden sm:inline">({timezone})</span>
      </div>

      {/* Only render scrolling wire when real verified news exist — zero invented quotes */}
      {doubled.length > 0 ? (
        <div className="group flex flex-1 overflow-hidden">
          <div
            className="flex w-max items-center gap-6 px-4 group-hover:[animation-play-state:paused]"
            style={{
              animation: `ht-marquee ${durationSec}s linear infinite`,
            }}
          >
            {doubled.map((item, idx) => (
              <div key={`${item.id}-${idx}`} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <Newspaper className="text-muted-foreground size-3" />
                <span className="inline-flex items-center gap-0.5 font-semibold text-foreground">
                  {item.source}
                  {item.is_verified_source ? <BadgeCheck className="size-3 text-emerald-500" /> : null}
                </span>
                <span className="text-muted-foreground">{item.title}</span>
                <span className="text-border ml-3">•</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground px-3 font-mono text-[11px]">Huseynovlar Terminal • Live</div>
      )}

      <style>{`
        @keyframes ht-marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
