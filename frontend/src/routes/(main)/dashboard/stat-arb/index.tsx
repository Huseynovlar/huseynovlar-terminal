import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/stat-arb/")({
  component: StatArbStubPage,
});

function StatArbStubPage() {
  return (
    <TerminalPageShell title="Стат. арбитраж и Спреды" badge="Z-Score · Cointegration">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
        Модуль парного трейдинга (BTC/ETH, XAU/XAG, USTEC/US500, базис, фандинг, Z-Score) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
