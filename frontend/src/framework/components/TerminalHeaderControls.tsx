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
    togglePrivacyMode,
    toggleSound,
    cycleLanguage,
    setTickerEnabled,
  } = useTerminalStore();

  const wsBadgeColor =
    status === "live"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      : status === "connecting" || status === "reconnecting"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
        : "border-destructive/30 bg-destructive/10 text-destructive";

  const wsDotColor =
    status === "live"
      ? "bg-emerald-500"
      : status === "connecting" || status === "reconnecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-destructive";

  const wsLabel =
    status === "live"
      ? `${t.header.wsLive}${rttMs !== null ? ` • ${rttMs}ms` : ""}`
      : status === "connecting"
        ? t.header.wsConnecting
        : status === "reconnecting"
          ? t.header.wsReconnecting
          : t.header.wsOffline;

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <div
        className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[10px] font-semibold tracking-wider tabular-nums ${wsBadgeColor}`}
        title={wsLabel}
      >
        <span className={`size-1.5 rounded-full ${wsDotColor}`} />
        <span>{wsLabel}</span>
      </div>

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
