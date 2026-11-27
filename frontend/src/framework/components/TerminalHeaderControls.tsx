import { useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Clock, Eye, EyeOff, Languages, Radio, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { useLiveSocket } from "@/framework/use-live-socket";
import { formatTerminalClock, useUtcClock } from "@/framework/use-utc-clock";

/**
 * Header live status pill + institutional quick controls.
 * Currency switcher (USD/USC) and clickable timezone cycler are removed per F11.
 */
export function TerminalHeaderControls() {
  const { t } = useI18n();
  const { status, rttMs } = useLiveSocket();
  const {
    privacyMode,
    language,
    tickerEnabled,
    soundEnabled,
    livePortfolio,
    wsTelemetry,
    togglePrivacyMode,
    toggleSound,
    cycleLanguage,
    setTickerEnabled,
  } = useTerminalStore();

  const pillRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; right: number } | null>(null);

  const openPopover = () => {
    const rect = pillRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopoverPos({
      top: rect.bottom + 6,
      right: Math.max(12, window.innerWidth - rect.right),
    });
  };
  const closePopover = () => setPopoverPos(null);

  const wsBadgeColor =
    status === "live"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      : status === "connecting" || status === "reconnecting"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
        : "border-destructive/30 bg-destructive/10 text-destructive";

  const wsDotColor =
    status === "live"
      ? "bg-emerald-500 animate-pulse"
      : status === "connecting" || status === "reconnecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-destructive";

  const livePhrase =
    language === "en" ? "Real-time" : language === "az" ? "Real vaxt" : "В реальном времени";

  const wsLabel =
    status === "live"
      ? `${livePhrase}${rttMs !== null ? ` • ${rttMs}ms` : ""}`
      : status === "connecting"
        ? t.header.wsConnecting
        : status === "reconnecting"
          ? t.header.wsReconnecting
          : t.header.wsOffline;

  const accountLive = status === "live";
  const bridgeOnline = wsTelemetry.bridgeTotal > 0 ? wsTelemetry.bridgeOnline : (livePortfolio?.accounts_count ?? 0);
  const bridgeTotal = wsTelemetry.bridgeTotal > 0 ? wsTelemetry.bridgeTotal : (livePortfolio?.accounts_count ?? 0);

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <div
        ref={pillRef}
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
        className={`inline-flex h-7 cursor-default items-center gap-1.5 rounded-full border px-2.5 font-sans text-[10px] font-semibold tracking-wide tabular-nums ${wsBadgeColor}`}
      >
        <span className="relative flex size-2">
          {status === "live" ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          ) : null}
          <span className={`relative inline-flex size-2 rounded-full ${wsDotColor}`} />
        </span>
        <span>{wsLabel}</span>
      </div>

      {popoverPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{ top: popoverPos.top, right: popoverPos.right }}
            className="pointer-events-none fixed z-[9999] w-60 rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-2.5 font-sans text-[11px]"
          >
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
              Каналы телеметрии
            </div>
            <div className="space-y-1.5 tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/account</span>
                <span
                  className="font-semibold"
                  style={{ color: accountLive ? "var(--bull)" : "var(--bear)" }}
                >
                  {accountLive ? "● LIVE" : "○ OFF"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/market</span>
                <span
                  className="font-semibold"
                  style={{
                    color:
                      wsTelemetry.marketActiveCount > 0
                        ? "var(--bull)"
                        : wsTelemetry.marketSubscribed
                          ? "var(--accent-amber)"
                          : "var(--text-muted)",
                  }}
                >
                  {wsTelemetry.marketActiveCount > 0
                    ? `● ${wsTelemetry.marketActiveCount} тик.`
                    : wsTelemetry.marketSubscribed
                      ? "● SUB"
                      : "○ IDLE"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">/ws/news</span>
                <span
                  className="font-semibold"
                  style={{ color: wsTelemetry.newsConnected ? "var(--bull)" : "var(--text-muted)" }}
                >
                  {wsTelemetry.newsConnected ? "● LIVE" : "○ IDLE"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">MT5 Bridge</span>
                <span
                  className="font-semibold"
                  style={{ color: bridgeOnline > 0 ? "var(--bull)" : "var(--text-muted)" }}
                >
                  {bridgeOnline}/{bridgeTotal} онл.
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <Button
        variant={privacyMode ? "secondary" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={togglePrivacyMode}
        title={`${privacyMode ? t.header.privacyOn : t.header.privacyOff} (Shift+M)`}
      >
        {privacyMode ? <EyeOff className="size-3.5 text-amber-500" /> : <Eye className="size-3.5" />}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={toggleSound}
        title={`${soundEnabled ? t.header.soundOn : t.header.soundOff} (Shift+S)`}
      >
        {soundEnabled ? (
          <Volume2 className="size-3.5 text-emerald-500" />
        ) : (
          <VolumeX className="size-3.5 text-muted-foreground" />
        )}
      </Button>

      <Button
        variant={tickerEnabled ? "ghost" : "outline"}
        size="sm"
        className="h-7 px-2"
        onClick={() => setTickerEnabled(!tickerEnabled)}
        title={t.header.tickerToggle}
      >
        <Radio className={`size-3.5 ${tickerEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px] font-semibold uppercase"
        onClick={cycleLanguage}
        title="RU / EN / AZ"
      >
        <Languages className="size-3" />
        <span>{language}</span>
      </Button>
    </div>
  );
}

/**
 * Smooth 1000ms read-only clock positioned directly next to the Profile avatar (F11).
 * Timezone is configured in /dashboard/preferences and synced to the server.
 */
export function HeaderUtcClock() {
  const timezone = useTerminalStore((s) => s.timezone);
  const now = useUtcClock(1000);
  const { time, label } = formatTerminalClock(now, timezone);

  return (
    <div
      className="hidden items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] font-medium tabular-nums select-none sm:inline-flex"
      title={`Server-synced timezone: ${timezone}`}
    >
      <Clock className="size-3 text-muted-foreground" />
      <span>{time}</span>
      <span className="text-muted-foreground text-[10px]">{label}</span>
    </div>
  );
}
