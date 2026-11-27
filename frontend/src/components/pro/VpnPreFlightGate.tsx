import { useCallback, useEffect, useState } from "react";

import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { checkVpnStatus, isTauriDesktop, type VpnStatusResult } from "@/services/tauriBridge";

interface VpnPreFlightGateProps {
  onStatusChange?: (status: VpnStatusResult) => void;
}

export function VpnPreFlightGate({ onStatusChange }: VpnPreFlightGateProps) {
  const [status, setStatus] = useState<VpnStatusResult | null>(null);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(async () => {
    setChecking(true);
    const res = await checkVpnStatus();
    setStatus(res);
    onStatusChange?.(res);
    setChecking(false);
  }, [onStatusChange]);

  useEffect(() => {
    // Only enforce pre-flight lock gate automatically inside Tauri v2 Desktop
    if (!isTauriDesktop()) return;
    void runCheck();
  }, [runCheck]);

  // Automatic 5-second reconnect loop while disconnected (15s background check if connected)
  useEffect(() => {
    if (!isTauriDesktop() || !status) return;
    const intervalMs = status.connected ? 15_000 : 5_000;
    const id = window.setInterval(() => {
      void runCheck();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [status, runCheck]);

  if (!isTauriDesktop() || !status || status.connected) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0B0E14] p-6 text-[#E2E8F0]">
      <div className="w-full max-w-md rounded-[4px] border border-[#263042] bg-[#11161F] p-6">
        <div className="mb-4 flex items-center gap-3">
          <AppLogo className="size-8 shrink-0" />
          <div>
            <div className="text-[14px] font-bold tracking-wide text-white">HUSEYNOVLAR TERMINAL</div>
            <div className="font-mono text-[10.5px] text-[#94A3B8]">VPN PRE-FLIGHT SECURITY GATE</div>
          </div>
        </div>

        <div className="mb-4 flex items-start gap-2.5 rounded-[4px] border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3 text-[12px] text-[#F59E0B]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">Нет доступа к закрытому серверу — проверьте подключение к VPN</div>
            <div className="mt-1 font-mono text-[10.5px] text-[#CBD5E1]">{status.message}</div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-[4px] border border-[#1E2634] bg-[#0B0E14] px-3 py-2 font-mono text-[11px]">
          <span className="text-[#94A3B8]">Туннель ОС</span>
          <span className={status.tunnel_detected ? "text-[#10B981]" : "text-[#F43F5E]"}>
            {status.tunnel_detected ? `● ${status.interface_name || "ACTIVE"}` : "○ НЕ ОБНАРУЖЕН"}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-[#64748B]">Автоповтор каждые 5 сек</span>
          <Button
            type="button"
            size="sm"
            onClick={() => void runCheck()}
            disabled={checking}
            className="h-8 gap-1.5 bg-[#3B82F6] text-white hover:bg-[#2563EB]"
          >
            {checking ? <RefreshCw className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Проверить снова
          </Button>
        </div>
      </div>
    </div>
  );
}
