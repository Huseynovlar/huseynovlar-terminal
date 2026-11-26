import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/multichart/")({
  component: MultichartStubPage,
});

function MultichartStubPage() {
  return (
    <TerminalPageShell title="Мультиграфик" badge="2×2 / 3×2 · KLineChart v10">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
        Модуль синхронизированных графиков (2×2 / 3×2 + Bar Replay) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
