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
