import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Command, ShieldCheck } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { APP_CONFIG } from "@/config/app-config";

export const Route = createFileRoute("/(main)/auth/v2")({
  component: Layout,
});

function Layout() {
  return (
    <main>
      <div className="grid h-dvh justify-center p-2 lg:grid-cols-2">
        <div className="bg-primary relative order-2 hidden h-full flex-col justify-between overflow-hidden rounded-3xl p-10 lg:flex">
          <div className="text-primary-foreground space-y-2">
            <div className="flex items-center gap-2.5">
              <Command className="size-8" />
              <span className="rounded-full border border-primary-foreground/20 px-2.5 py-0.5 font-mono text-xs">
                {APP_CONFIG.domain}
              </span>
            </div>
            <h1 className="pt-2 text-3xl font-semibold tracking-tight">{APP_CONFIG.name}</h1>
            <p className="text-primary-foreground/80 max-w-md text-sm">
              Персональный торговый и аналитический терминал для счетов и роботов Exness (MT5).
            </p>
          </div>

          <div className="text-primary-foreground/90 space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1.5 text-xs font-medium">
              <ShieldCheck className="size-4 text-emerald-400" />
              NetBird Private Mesh • Caddy Auto-TLS • FIDO2 Passkeys
            </div>

            <div className="flex w-full justify-between pt-2">
              <div className="text-primary-foreground flex-1 space-y-1">
                <h2 className="font-medium">Zero-Latency MT5</h2>
                <p className="text-primary-foreground/75 text-xs">
                  XAUUSD &amp; USTEC (USD / USC) в реальном времени без влияния на скорость роботов.
                </p>
              </div>
              <Separator orientation="vertical" className="mx-4 h-auto! bg-primary-foreground/20" />
              <div className="text-primary-foreground flex-1 space-y-1">
                <h2 className="font-medium">Bloomberg × Apple UX</h2>
                <p className="text-primary-foreground/75 text-xs">
                  Графики M1–W1, карта рынка, мировые новости, Google Gemini AI и Docker Ops.
                </p>
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
