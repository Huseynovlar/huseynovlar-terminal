import type { ReactNode } from "react";

import { TerminalDataPanel } from "./TerminalDataPanel";
import { TerminalPageShell } from "./TerminalPageShell";

interface TerminalSectionPlaceholderProps {
  title: string;
  badge: string;
  description: string;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Unified institutional module page template for upcoming / configurable terminal sections.
 */
export function TerminalSectionPlaceholder({
  title,
  badge,
  description,
  actions,
  children,
}: TerminalSectionPlaceholderProps) {
  return (
    <TerminalPageShell title={title} badge={badge} actions={actions}>
      <TerminalDataPanel scrollable={false} bodyClassName="p-4">
        <p className="text-[12px] leading-relaxed text-[var(--text-secondary)]">{description}</p>
        {children ? <div className="mt-3">{children}</div> : null}
      </TerminalDataPanel>
    </TerminalPageShell>
  );
}
