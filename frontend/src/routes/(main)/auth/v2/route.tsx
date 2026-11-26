import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Activity, Command, Globe2, ShieldCheck } from "lucide-react";

import { APP_CONFIG } from "@/config/app-config";
import { useI18n } from "@/framework/i18n";

export const Route = createFileRoute("/(main)/auth/v2")({
  component: Layout,
});

/**
 * Institutional multi-asset login split-screen layout (F30).
 * Asset-agnostic copy translated in RU / EN / AZ.
 */
function Layout() {
  const { t } = useI18n();

  return (
    <main>
      <div className="grid h-dvh justify-center p-2 lg:grid-cols-2">
        <div className="bg-primary relative order-2 hidden h-full flex-col justify-between overflow-hidden rounded-3xl p-10 lg:flex">
          <div className="text-primary-foreground space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Command className="size-8" />
              <span className="rounded-full border border-primary-foreground/20 px-2.5 py-0.5 font-mono text-xs">
                {APP_CONFIG.domain}
              </span>
            </div>
            <h1 className="pt-2 text-3xl font-semibold tracking-tight">{t.auth.brandTitle}</h1>
            <p className="text-primary-foreground/85 max-w-lg text-sm leading-relaxed">{t.auth.brandSubtitle}</p>
          </div>

          <div className="text-primary-foreground/95 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-xs font-medium">
              <ShieldCheck className="size-4 text-emerald-300" />
              Zero-Trust Mesh • FIDO2 Passkeys • TOTP 2FA • Real-Time WebSocket
            </div>

            <TerminalPreview />

            <div className="grid grid-cols-1 gap-3 pt-2">
              <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Globe2 className="size-4" />
                  <span>{t.auth.pillar1Title}</span>
                </div>
                <p className="text-primary-foreground/80 mt-1 text-xs leading-relaxed">{t.auth.pillar1Desc}</p>
              </div>
              <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Activity className="size-4" />
                  <span>{t.auth.pillar2Title}</span>
                </div>
                <p className="text-primary-foreground/80 mt-1 text-xs leading-relaxed">{t.auth.pillar2Desc}</p>
              </div>
              <div className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/10 p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="size-4" />
                  <span>{t.auth.pillar3Title}</span>
                </div>
                <p className="text-primary-foreground/80 mt-1 text-xs leading-relaxed">{t.auth.pillar3Desc}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="relative order-1 flex h-full">
          <Outlet />
        </div>
      </div>
    </main>
  );
}

/** Static CSS rendition of the terminal workspace (no network data, purely decorative). */
function TerminalPreview() {
  const bars = [38, 52, 44, 61, 55, 70, 64, 78, 72, 86, 80, 92];
  // Illustrative layout only: no quotes or P&L figures are shown.
  const rows = ["EURUSD", "XAUUSD", "US500", "BTCUSD"];
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-primary-foreground/20 bg-black/25 shadow-2xl"
    >
      <div className="flex items-center gap-1.5 border-b border-primary-foreground/15 px-3 py-2">
        <span className="size-2 rounded-full bg-rose-400/80" />
        <span className="size-2 rounded-full bg-amber-300/80" />
        <span className="size-2 rounded-full bg-emerald-400/80" />
        <span className="text-primary-foreground/60 ml-2 font-mono text-[10px]">{APP_CONFIG.domain}/dashboard</span>
      </div>
      <div className="grid grid-cols-[1fr_9rem] gap-3 p-3">
        <div className="flex h-28 items-end gap-1.5">
          {bars.map((h, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: static decorative bars
              key={i}
              className="bg-primary-foreground/50 w-full rounded-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="space-y-1.5 font-mono text-[10px]">
          {rows.map((sym) => (
            <div key={sym} className="flex items-center justify-between rounded bg-primary-foreground/10 px-2 py-1">
              <span>{sym}</span>
              <span className="bg-primary-foreground/30 h-1.5 w-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
