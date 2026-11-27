import type { ReactNode } from "react";

import { cn } from "cn";

interface TerminalDataPanelProps {
  /** Optional toolbar row rendered above the panel body (search, category pills, sort controls). */
  toolbar?: ReactNode;
  /** Optional footer row rendered below the panel body (pagination, totals, hints). */
  footer?: ReactNode;
  /** Wrap children in a horizontal scroll container for dense data tables (default: true). */
  scrollable?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Unified institutional data panel container (Variant A):
 * Crisp 1px border, 4px radius, zero box-shadow, Light/Dark CSS-variable reactive,
 * and responsive horizontal overflow for tables at any viewport width.
 */
export function TerminalDataPanel({
  toolbar,
  footer,
  scrollable = true,
  className,
  bodyClassName,
  children,
}: TerminalDataPanelProps) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] tabular-nums",
        className,
      )}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3 py-2">
          {toolbar}
        </div>
      ) : null}
      <div className={cn(scrollable && "pro-scroll overflow-x-auto", bodyClassName)}>{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
