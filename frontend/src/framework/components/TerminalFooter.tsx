export function TerminalFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 font-mono text-[10px] text-[var(--text-muted)] select-none">
      <div className="flex min-w-0 items-center gap-2 truncate">
        <span className="font-semibold text-[var(--text-secondary)]">Huseynovlar Terminal</span>
        <span className="hidden text-[var(--border-strong)] sm:inline">|</span>
        <span className="hidden truncate sm:inline">Institutional Multi-Asset Desk</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span>
          Разработано{" "}
          <span className="font-semibold text-[var(--text-primary)]">Haji Huseynov</span>
        </span>
        <span className="text-[var(--border-strong)]">·</span>
        <span>© {year}</span>
      </div>
    </footer>
  );
}
