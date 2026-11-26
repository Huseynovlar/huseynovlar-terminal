import { createFileRoute } from "@tanstack/react-router";

import { AssetTerminalView } from "@/components/terminal/AssetTerminalView";

export const Route = createFileRoute("/(main)/dashboard/tickers/$symbol")({
  component: MarketAssetTerminalRoute,
});

function MarketAssetTerminalRoute() {
  const { symbol } = Route.useParams();
  return <AssetTerminalView symbol={symbol} mode="market" />;
}
