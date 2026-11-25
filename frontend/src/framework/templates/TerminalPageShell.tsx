import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

interface TerminalPageShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Unified Bloomberg-compact institutional page template.
 * Guarantees consistent header alignment, tabular numbers, and compact spacing across every Terminal page.
 */
export function TerminalPageShell({ title, subtitle, badge, actions, children }: TerminalPageShellProps) {
  return (
    <div className="space-y-3 tabular-nums">
      <div className="flex flex-col gap-2.5 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
            {badge ? (
              <Badge variant="secondary" className="text-[10px] font-mono font-medium uppercase tracking-wider">
                {badge}
              </Badge>
            ) : null}
          </div>
          {subtitle ? <p className="text-muted-foreground text-xs sm:text-sm">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
