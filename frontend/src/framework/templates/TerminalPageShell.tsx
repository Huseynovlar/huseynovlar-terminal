import type { ReactNode } from "react";

interface TerminalPageShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Unified Anti-AI Pro UI institutional page template.
 * Single-line 14-16px header, zero marketing subtitles, crisp 1px borders, tabular numbers.
 */
export function TerminalPageShell({ title, badge, actions, children }: TerminalPageShellProps) {
  return (
    <div className="space-y-3 tabular-nums">
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
          {badge ? (
            <span className="rounded-[3px] border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
