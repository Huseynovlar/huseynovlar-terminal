import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { useTerminalStore } from "@/framework/terminal-store";

interface TerminalPageShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Unified Apple-clean × Bloomberg page template.
 * Guarantees consistent header alignment, density mode, and layout across every Terminal page.
 */
export function TerminalPageShell({ title, subtitle, badge, actions, children }: TerminalPageShellProps) {
  const density = useTerminalStore((s) => s.density);
  const gapClass = density === "compact" ? "space-y-3" : "space-y-5";

  return (
    <div className={gapClass}>
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            {badge ? (
              <Badge variant="secondary" className="text-[11px] font-medium uppercase tracking-wider">
                {badge}
              </Badge>
            ) : null}
          </div>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={gapClass}>{children}</div>
    </div>
  );
}
