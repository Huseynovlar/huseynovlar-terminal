import { InteractiveChartCanvas } from "@/components/m5/InteractiveChartCanvas";

export function LiveAssetChart({ assetCode = "XAUUSD" }: { assetCode?: string }) {
  return <InteractiveChartCanvas symbol={assetCode} mode="hub" height={420} />;
}
