import { createFileRoute } from "@tanstack/react-router";

import { AssetTerminalView } from "@/components/terminal/AssetTerminalView";

export const Route = createFileRoute("/(main)/dashboard/hubs/$code/")({
  component: PortfolioAssetTerminalRoute,
});

function PortfolioAssetTerminalRoute() {
  const { code } = Route.useParams();
  return <AssetTerminalView symbol={code} mode="portfolio" />;
}
