import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/ownership/")({
  component: OwnershipStubPage,
});

function OwnershipStubPage() {
  return (
    <TerminalPageShell title="Владение и Фонды" badge="SEC EDGAR · 13F-HR · Form 4">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
        Модуль графа владений фондов (ECharts graph/chord по SEC EDGAR 13F-HR / 13D / Form 4) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
