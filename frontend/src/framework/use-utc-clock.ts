import { useEffect, useState } from "react";

/**
 * Wall-clock-aligned 1000ms clock hook so every clock in Header, Login, and Robots
 * ticks smoothly on every exact second boundary without drift.
 */
export function useUtcClock(intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    if (typeof window === "undefined") return;
    let intervalId: number | undefined;

    const tick = () => setNow(new Date());
    const delayToNextSecond = intervalMs === 1000 ? 1000 - (Date.now() % 1000) : intervalMs;

    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, intervalMs);
    }, delayToNextSecond);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [intervalMs]);

  return now;
}

const VALID_TIMEZONE_MAP: Record<string, string> = {
  UTC: "UTC",
  Exness: "UTC",
  "Asia/Baku": "Asia/Baku",
  "America/New_York": "America/New_York",
  "Europe/London": "Europe/London",
  "Asia/Tokyo": "Asia/Tokyo",
  "Europe/Istanbul": "Europe/Istanbul",
  "Asia/Dubai": "Asia/Dubai",
};

export function resolveIanaTimezone(tz: string): string {
  return VALID_TIMEZONE_MAP[tz] ?? tz ?? "UTC";
}

export function formatTerminalClock(date: Date, timezone = "UTC"): { time: string; label: string } {
  const iana = resolveIanaTimezone(timezone);
  try {
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: iana,
    }).format(date);
    const label = timezone === "Asia/Baku" ? "AZT" : timezone === "America/New_York" ? "EST" : timezone === "Europe/London" ? "LDN" : timezone === "Asia/Tokyo" ? "TYO" : "UTC";
    return { time, label };
  } catch {
    return { time: date.toISOString().slice(11, 19), label: "UTC" };
  }
}

export function formatUptimeSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}
