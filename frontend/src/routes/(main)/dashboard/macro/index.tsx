import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/macro/")({
  component: MacroStubPage,
});

function MacroStubPage() {
  return (
    <TerminalPageShell title="Макро, Облигации и COT" badge="FRED · U.S. Treasury · CFTC · Polymarket">
      <div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
        Модуль кривой доходностей США (GC/YAS), отчётов CFTC COT и вероятностей ставки ФРС (Polymarket CLOB) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
