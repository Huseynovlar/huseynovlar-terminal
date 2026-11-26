import { useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";

import { AppLogo } from "@/components/app-logo";
import { APP_CONFIG } from "@/config/app-config";
import { useI18n } from "@/framework/i18n";

export const Route = createFileRoute("/(main)/auth/v2")({
  component: Layout,
});

/**
 * Institutional split-screen auth layout (#44, #47).
 * Right panel displays the real terminal screenshot (`/login-preview.png`) without AI marketing clutter.
 */
function Layout() {
  const { t } = useI18n();
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <main>
      <div className="grid h-dvh justify-center p-2 lg:grid-cols-2">
        <div className="bg-primary relative order-2 hidden h-full flex-col justify-between overflow-hidden rounded-2xl p-10 lg:flex">
          <div className="text-primary-foreground space-y-2">
            <div className="flex items-center gap-2.5">
              <AppLogo className="size-7" />
              <span className="border-primary-foreground/25 rounded border px-2 py-0.5 font-mono text-[11px] tracking-wide">
                {APP_CONFIG.domain}
              </span>
            </div>
            <h1 className="pt-2 text-2xl font-semibold tracking-tight">{t.auth.brandTitle}</h1>
            <p className="text-primary-foreground/80 max-w-md text-xs leading-relaxed">{t.auth.brandSubtitle}</p>
          </div>

          <div className="my-6 flex flex-1 items-center justify-center">
            {!imgFailed ? (
              <div className="w-full overflow-hidden rounded-xl border border-primary-foreground/20 bg-black/25 shadow-2xl">
                <img
                  src="/login-preview.png"
                  alt={APP_CONFIG.name}
                  className="h-auto max-h-[58vh] w-full object-cover object-top"
                  onError={() => setImgFailed(true)}
                />
              </div>
            ) : (
              <div className="flex h-64 w-full flex-col items-center justify-center rounded-xl border border-primary-foreground/20 bg-black/15 p-6 text-center text-primary-foreground/75">
                <AppLogo className="mb-3 size-10 opacity-80" />
                <div className="font-mono text-xs">{APP_CONFIG.name}</div>
                <div className="mt-1 text-[11px] opacity-70">{APP_CONFIG.domain}</div>
              </div>
            )}
          </div>

          <div className="text-primary-foreground/70 flex items-center justify-between border-t border-primary-foreground/15 pt-4 font-mono text-[11px]">
            <span>{APP_CONFIG.name}</span>
            <span>UTC • MULTI-ASSET DESK</span>
          </div>
        </div>
        <div className="relative order-1 flex h-full">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
