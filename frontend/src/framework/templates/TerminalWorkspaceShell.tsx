import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

interface TerminalWorkspaceShellProps {
  /** 48px single-line top bar (ticker switcher, price, KPIs, actions). */
  topBar: ReactNode;
  /** Optional inline banner below top bar (e.g. AI Brief). */
  banner?: ReactNode;
  /** Primary left workspace pane (e.g. KLineChartPro). */
  mainPane: ReactNode;
  /** Optional right side pane (e.g. MicrostructurePanel: DOM + Tick Chart). */
  sidePane?: ReactNode;
  /** Desktop pixel width for the right side pane (clamped to 280px..38vw). */
  sideWidth?: number;
  /** Drag handler for resizing the right side pane on desktop. */
  onSideResizeStart?: (e: ReactMouseEvent) => void;
  /** Optional compact strip above bottom dock (e.g. active MT5 robots). */
  strip?: ReactNode;
  /** Optional bottom dock content. */
  bottomDock?: ReactNode;
  /** Desktop pixel height for the bottom dock (clamped to max 42vh). */
  dockHeight?: number;
  /** Whether the bottom dock is collapsed to its 36px tab bar. */
  dockCollapsed?: boolean;
  /** Drag handler for resizing the bottom dock vertically. */
  onDockResizeStart?: (e: ReactMouseEvent) => void;
  /** Optional modals/dialogs rendered inside the workspace root. */
  overlays?: ReactNode;
}

/**
 * Unified edge-to-edge full-viewport trading workspace template.
 * Adapts cleanly across all viewport widths and heights:
 * - Desktop (>= 1024px): locked 100dvh split layout with clamped side pane (min 280px, max 38vw)
 *   and clamped bottom dock (max 42vh) so the chart is never crushed on short screens.
 * - Tablet / Narrow (< 1024px): smooth vertical stack (Chart -> Side Pane -> Bottom Dock).
 */
export function TerminalWorkspaceShell({
  topBar,
  banner,
  mainPane,
  sidePane,
  sideWidth = 300,
  onSideResizeStart,
  strip,
  bottomDock,
  dockHeight = 200,
  dockCollapsed = false,
  onDockResizeStart,
  overlays,
}: TerminalWorkspaceShellProps) {
  return (
    <div
      data-content-padding="false"
      className="flex min-h-[calc(100dvh-72px)] w-full flex-col bg-[var(--bg-canvas)] text-[var(--text-primary)] lg:h-[calc(100dvh-72px)] lg:min-h-[480px] lg:overflow-hidden"
    >
      {/* 1. TOP BAR */}
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-1.5 lg:h-12 lg:flex-nowrap lg:py-0">
        {topBar}
      </div>

      {/* OPTIONAL INLINE BANNER */}
      {banner}

      {/* 2. MAIN WORKSPACE: CHART + RESIZE HANDLE + SIDE PANE */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:overflow-hidden">
        <div className="h-[440px] min-h-[340px] min-w-0 shrink-0 lg:h-auto lg:min-h-0 lg:flex-1 lg:shrink">
          {mainPane}
        </div>

        {sidePane ? (
          <>
            {onSideResizeStart ? (
              <div
                onMouseDown={onSideResizeStart}
                className="hidden w-1 shrink-0 cursor-col-resize bg-[var(--border-subtle)] transition-colors duration-75 hover:bg-[var(--accent-blue)] lg:block"
                title="Изменить ширину правой колонки"
              />
            ) : (
              <div className="hidden w-px shrink-0 bg-[var(--border-subtle)] lg:block" />
            )}

            <div
              className="h-[440px] min-h-0 w-full shrink-0 overflow-hidden border-t border-[var(--border-subtle)] lg:h-auto lg:w-[var(--ws-side-w)] lg:min-w-[280px] lg:max-w-[38vw] lg:border-t-0"
              style={{ ["--ws-side-w" as string]: `${sideWidth}px` }}
            >
              {sidePane}
            </div>
          </>
        ) : null}
      </div>

      {/* 3. OPTIONAL COMPACT STRIP */}
      {strip}

      {/* 4. VERTICAL RESIZE HANDLE + BOTTOM DOCK */}
      {bottomDock ? (
        <>
          {onDockResizeStart ? (
            <div
              onMouseDown={onDockResizeStart}
              className="hidden h-1 shrink-0 cursor-row-resize bg-[var(--border-subtle)] transition-colors duration-75 hover:bg-[var(--accent-blue)] lg:block"
              title="Изменить высоту нижней панели"
            />
          ) : (
            <div className="h-px shrink-0 bg-[var(--border-subtle)]" />
          )}

          <div
            className="flex shrink-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] lg:max-h-[42vh] lg:border-t-0"
            style={{ height: dockCollapsed ? 36 : dockHeight }}
          >
            {bottomDock}
          </div>
        </>
      ) : null}

      {overlays}
    </div>
  );
}
