interface MarketSessionsTimelineProps {
  now: Date;
}

interface SessionSpec {
  code: string;
  name: string;
  openHour: number;
  closeHour: number;
}

const SESSIONS: SessionSpec[] = [
  { code: "SYD", name: "Sydney", openHour: 22, closeHour: 7 },
  { code: "TYO", name: "Tokyo", openHour: 0, closeHour: 9 },
  { code: "LDN", name: "London", openHour: 8, closeHour: 17 },
  { code: "NYC", name: "New York", openHour: 13, closeHour: 22 },
];

const HOURS_TICKS = [0, 6, 12, 18, 24];

export function MarketSessionsTimeline({ now }: MarketSessionsTimelineProps) {
  const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const day = now.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const isWeekend =
    day === 6 || (day === 0 && utcHour < 22) || (day === 5 && utcHour >= 22);
  const nowPct = (utcHour / 24) * 100;
  const isOverlapActive = !isWeekend && utcHour >= 13 && utcHour < 17;

  return (
    <div className="flex flex-col rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)]">
          Сессии (24h UTC)
        </span>
        <span
          className={`rounded-[3px] border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
            isOverlapActive
              ? "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]"
              : isWeekend
                ? "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
          }`}
        >
          {isOverlapActive
            ? "LDN + NYC Overlap"
            : isWeekend
              ? "FX Выходные"
              : "Overlap 13–17 UTC"}
        </span>
      </div>

      <div className="relative px-3 py-2">
        {/* Session rows */}
        <div className="space-y-1.5">
          {SESSIONS.map((s) => {
            const isOpen =
              !isWeekend &&
              (s.openHour < s.closeHour
                ? utcHour >= s.openHour && utcHour < s.closeHour
                : utcHour >= s.openHour || utcHour < s.closeHour);

            const segments =
              s.openHour < s.closeHour
                ? [{ start: s.openHour, end: s.closeHour }]
                : [
                    { start: s.openHour, end: 24 },
                    { start: 0, end: s.closeHour },
                  ];

            return (
              <div key={s.code} className="grid grid-cols-[72px_1fr_38px] items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: isOpen ? "var(--bull)" : "var(--text-muted)",
                    }}
                  />
                  <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">
                    {s.name}
                  </span>
                </div>

                {/* 24h bar */}
                <div className="relative h-3.5 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)]">
                  {/* London + NY Overlap band (13:00–17:00 UTC) */}
                  <div
                    className="pointer-events-none absolute inset-y-0 bg-[var(--accent-blue)]/15"
                    style={{
                      left: `${(13 / 24) * 100}%`,
                      width: `${(4 / 24) * 100}%`,
                    }}
                  />

                  {/* Session active blocks */}
                  {segments.map((seg, idx) => (
                    <div
                      key={idx}
                      className="absolute inset-y-[2px] rounded-[1px]"
                      style={{
                        left: `${(seg.start / 24) * 100}%`,
                        width: `${((seg.end - seg.start) / 24) * 100}%`,
                        backgroundColor: isOpen
                          ? "var(--bull)"
                          : "var(--border-strong)",
                        opacity: isOpen ? 0.72 : 0.55,
                      }}
                    />
                  ))}

                  {/* Live UTC current time vertical needle */}
                  <div
                    className="pointer-events-none absolute -inset-y-0.5 w-[1.5px] bg-[var(--accent-amber)]"
                    style={{ left: `${nowPct}%` }}
                  />
                </div>

                <span
                  className={`text-right text-[10px] font-semibold uppercase tabular-nums ${
                    isOpen ? "text-[var(--bull)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {isOpen ? "OPEN" : "OFF"}
                </span>
              </div>
            );
          })}
        </div>

        {/* UTC Hour Axis */}
        <div className="mt-1.5 grid grid-cols-[72px_1fr_38px] items-center gap-2">
          <span />
          <div className="flex items-center justify-between text-[9px] tabular-nums text-[var(--text-muted)]">
            {HOURS_TICKS.map((h) => (
              <span key={h}>{String(h).padStart(2, "0")}:00</span>
            ))}
          </div>
          <span />
        </div>
      </div>
    </div>
  );
}
