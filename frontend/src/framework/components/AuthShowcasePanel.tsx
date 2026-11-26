import { useState } from "react";

import { Activity, Cpu, ShieldCheck } from "lucide-react";

import { AppLogo } from "@/components/app-logo";
import { APP_CONFIG } from "@/config/app-config";
import { useI18n } from "@/framework/i18n";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

interface AuthShowcasePanelProps {
  footerRight?: string;
}

/**
 * Shared institutional right-side showcase panel for Login and Lock screens.
 * Displays the real dark/light terminal screenshot inside a polished terminal frame
 * with concise platform highlights underneath.
 */
export function AuthShowcasePanel({ footerRight }: AuthShowcasePanelProps) {
  const { t, language } = useI18n();
  const themeMode = usePreferencesStore((s) => s.values.theme_mode);
  const [imgFailed, setImgFailed] = useState(false);
  const isLight = themeMode === "light";
  const previewSrc = isLight ? "/login-preview-light.png" : "/login-preview-dark.png";

  const highlights =
    language === "en"
      ? [
          {
            icon: Activity,
            title: "Real-Time WebSocket",
            desc: "Live push stream for MT5, Exness API v1 & ticks — zero polling",
          },
          {
            icon: Cpu,
            title: "Zero-Overhead Robots",
            desc: "Live ER, VWAP Z-Score, BB & Vol-Shock telemetry with 0ms tick impact",
          },
          {
            icon: ShieldCheck,
            title: "Hardened Access",
            desc: "Passkeys (FIDO2), TOTP 2FA, Ed25519 signing & full session audit",
          },
        ]
      : language === "az"
        ? [
            {
              icon: Activity,
              title: "Real Vaxt WebSocket",
              desc: "MT5, Exness API v1 və tiklər üçün fasiləsiz canlı push axını",
            },
            {
              icon: Cpu,
              title: "Sıfır Yük Robotlar",
              desc: "ER, VWAP Z-Score, BB və Vol-Shock telemetriyası 0ms gecikmə ilə",
            },
            {
              icon: ShieldCheck,
              title: "Gücləndirilmiş Təhlükəsizlik",
              desc: "Passkeys (FIDO2), TOTP 2FA, Ed25519 imza və tam sessiya auditi",
            },
          ]
        : [
            {
              icon: Activity,
              title: "Реальное время (WS)",
              desc: "Мгновенный push-поток MT5, Exness API v1 и тиков без опросов",
            },
            {
              icon: Cpu,
              title: "Телеметрия роботов",
              desc: "ER, VWAP Z-Score, BB и Vol-Shock в реальном времени без нагрузки",
            },
            {
              icon: ShieldCheck,
              title: "Защита доступа",
              desc: "Passkeys (FIDO2), TOTP 2FA, подпись Ed25519 и аудит сессий",
            },
          ];

  return (
    <div className="bg-primary relative order-2 hidden h-full flex-col justify-between overflow-hidden rounded-2xl p-8 xl:p-10 lg:flex">
      {/* Subtle radial ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-emerald-400/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -left-24 size-96 rounded-full bg-sky-400/15 blur-3xl"
      />

      {/* Brand Header */}
      <div className="text-primary-foreground relative z-10 space-y-2">
        <div className="flex items-center gap-2.5">
          <AppLogo className="size-7" />
          <span className="border-primary-foreground/25 bg-primary-foreground/5 rounded-md border px-2 py-0.5 font-mono text-[11px] tracking-wide">
            {APP_CONFIG.domain}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-400/35 bg-emerald-400/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-emerald-300">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
            REAL-TIME WS
          </span>
        </div>
        <h1 className="pt-1.5 text-2xl font-semibold tracking-tight">{t.auth.brandTitle}</h1>
        <p className="text-primary-foreground/80 max-w-lg text-xs leading-relaxed">{t.auth.brandSubtitle}</p>
      </div>

      {/* Framed Real Screenshot Showcase */}
      <div className="relative z-10 my-5 flex flex-1 items-center justify-center">
        {!imgFailed ? (
          <div className="group relative w-full">
            {/* Ambient halo behind frame */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-tr from-emerald-400/25 via-primary-foreground/15 to-sky-400/25 opacity-80 blur-md transition-opacity duration-500 group-hover:opacity-100"
            />
            <div className="relative overflow-hidden rounded-xl border border-primary-foreground/25 bg-zinc-950/90 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.65)] ring-1 ring-white/10">
              {/* Sleek terminal window chrome */}
              <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/90 px-3.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-rose-500/80" />
                  <span className="size-2.5 rounded-full bg-amber-400/80" />
                  <span className="size-2.5 rounded-full bg-emerald-500/80" />
                </div>
                <div className="rounded bg-white/5 px-2.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  https://{APP_CONFIG.domain}/dashboard/home
                </div>
                <span className="font-mono text-[9px] tracking-wider text-emerald-400 uppercase">
                  {isLight ? "LIGHT" : "DARK"}
                </span>
              </div>
              <div className="relative overflow-hidden bg-zinc-950">
                <img
                  src={previewSrc}
                  alt={APP_CONFIG.name}
                  className="h-auto max-h-[44vh] w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.015]"
                  onError={() => setImgFailed(true)}
                />
                {/* Soft bottom vignette for smooth integration */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/35 to-transparent"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-56 w-full flex-col items-center justify-center rounded-xl border border-primary-foreground/20 bg-black/15 p-6 text-center text-primary-foreground/75">
            <AppLogo className="mb-3 size-10 opacity-80" />
            <div className="font-mono text-xs">{APP_CONFIG.name}</div>
            <div className="mt-1 text-[11px] opacity-70">{APP_CONFIG.domain}</div>
          </div>
        )}
      </div>

      {/* Bottom Highlights & Footer */}
      <div className="relative z-10 space-y-4">
        <div className="grid grid-cols-3 gap-2.5">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/[0.06] p-3 backdrop-blur-sm"
              >
                <div className="text-primary-foreground flex items-center gap-1.5 text-[11px] font-semibold">
                  <Icon className="size-3.5 shrink-0 text-emerald-300" />
                  <span className="truncate">{item.title}</span>
                </div>
                <p className="text-primary-foreground/75 mt-1 text-[10px] leading-snug">{item.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="text-primary-foreground/70 flex items-center justify-between border-t border-primary-foreground/15 pt-3 font-mono text-[11px]">
          <span>{APP_CONFIG.name}</span>
          <span className="tabular-nums">{footerRight ?? "UTC • MULTI-ASSET DESK"}</span>
        </div>
      </div>
    </div>
  );
}
