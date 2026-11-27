import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";

interface TerminalDropdownProps {
  /** Controlled open state. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that opens the popover (wrapped in an inline-flex anchor). */
  trigger: ReactNode;
  /** Dropdown alignment relative to trigger. */
  align?: "left" | "right";
  /** Optional min/fixed width class (e.g. "w-44", "w-64"). */
  widthClassName?: string;
  children: ReactNode;
}

/**
 * Portal-based fixed-position institutional dropdown menu.
 * Renders directly in document.body so overflow-hidden / overflow-x-auto ancestors
 * (tables, scrollable toolbars, split panes) can NEVER clip the menu.
 * Automatically flips upward when near the bottom of the viewport.
 */
export function TerminalDropdown({
  open,
  onOpenChange,
  trigger,
  align = "left",
  widthClassName = "w-44",
  children,
}: TerminalDropdownProps) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; ready: boolean }>({
    top: 0,
    left: 0,
    ready: false,
  });

  useLayoutEffect(() => {
    if (!open) {
      setCoords((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }

    const updatePosition = () => {
      const tr = triggerRef.current?.getBoundingClientRect();
      if (!tr) return;
      const menuRect = menuRef.current?.getBoundingClientRect();
      const menuW = menuRect?.width || 192;
      const menuH = menuRect?.height || 180;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let left = align === "right" ? tr.right - menuW : tr.left;
      left = Math.max(8, Math.min(left, vw - menuW - 8));

      let top = tr.bottom + 4;
      if (top + menuH > vh - 8 && tr.top - menuH - 4 >= 8) {
        top = tr.top - menuH - 4;
      } else if (top + menuH > vh - 8) {
        top = Math.max(8, vh - menuH - 8);
      }

      setCoords({ top, left, ready: true });
    };

    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <>
      <div ref={triggerRef} className="inline-flex shrink-0">
        {trigger}
      </div>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                opacity: coords.ready ? 1 : 0,
              }}
              className={`z-[9999] rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-panel)] p-1 text-[11px] text-[var(--text-primary)] ${widthClassName}`}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
