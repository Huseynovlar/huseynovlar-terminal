import { createFileRoute } from "@tanstack/react-router";

import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/macro/")({
  component: MacroStubPage,
});

function MacroStubPage() {
  return (
    <TerminalPageShell title="Макро, Облигации и COT" badge="FRED · U.S. Treasury · CFTC · Polymarket">
      <div className="rounded-[4px] border border-[#1E2634] bg-[#11161F] px-3 py-2.5 font-mono text-[12px] text-[#94A3B8]">
        Модуль кривой доходностей США (GC/YAS), отчётов CFTC COT и вероятностей ставки ФРС (Polymarket CLOB) — ожидает детальное ТЗ.
      </div>
    </TerminalPageShell>
  );
}
