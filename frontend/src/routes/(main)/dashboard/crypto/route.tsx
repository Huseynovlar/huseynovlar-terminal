import { createFileRoute } from "@tanstack/react-router";

import { LiveAssetChart } from "@/framework/components/LiveAssetChart";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/crypto")({
  component: TradingDeskPage,
});

function TradingDeskPage() {
  return (
    <TerminalPageShell
      title="Торговый терминал и хабы активов"
      subtitle="Живые графики Exness (M1–W1), активные ордера и история входов/выходов роботов на свечах (USD + USC)."
      badge="LIVE DESK"
    >
      <LiveAssetChart />
    </TerminalPageShell>
  );
}
