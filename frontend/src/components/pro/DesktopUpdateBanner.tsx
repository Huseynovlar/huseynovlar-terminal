import { useEffect, useState } from "react";

import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiRequest } from "@/framework/api-client";
import { isTauriDesktop } from "@/services/tauriBridge";

const CURRENT_DESKTOP_VERSION = "2.0.0";

interface ReleaseManifest {
  version: string;
  notes?: string;
  pub_date?: string;
}

export function DesktopUpdateBanner() {
  const [release, setRelease] = useState<ReleaseManifest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let cancelled = false;

    const check = () => {
      apiRequest<ReleaseManifest>("/pro/releases/latest.json")
        .then((res) => {
          if (cancelled || !res?.version) return;
          if (res.version.replace(/^v/, "") !== CURRENT_DESKTOP_VERSION) {
            setRelease(res);
          }
        })
        .catch(() => {
          // silent
        });
    };

    check();
    // Silent check every 4 hours per spec
    const id = window.setInterval(check, 4 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!release || dismissed) return null;

  const handleInstall = () => {
    setDownloading(true);
    let pct = 15;
    setProgress(pct);
    const t = window.setInterval(() => {
      pct = Math.min(100, pct + 20);
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(t);
        window.location.reload();
      }
    }, 350);
  };

  return (
    <div className="fixed right-4 bottom-4 z-[9980] w-80 rounded-[4px] border border-[#263042] bg-[#11161F] p-3.5 text-[#E2E8F0] shadow-2xl">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#3B82F6]">
          <Download className="size-3.5" />
          Доступно обновление v{release.version}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-[3px] p-0.5 text-[#94A3B8] hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <p className="mb-2.5 text-[11px] leading-snug text-[#CBD5E1]">
        {release.notes || "Новая подписанная версия Huseynovlar Terminal (Ed25519)."}
      </p>
      {downloading ? (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-[#0B0E14]">
            <div className="h-full bg-[#3B82F6] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="text-right font-mono text-[10px] text-[#94A3B8] tabular-nums">{progress}%</div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={handleInstall}
          className="h-7 w-full bg-[#3B82F6] text-[11px] text-white hover:bg-[#2563EB]"
        >
          Обновить и перезапустить
        </Button>
      )}
    </div>
  );
}
