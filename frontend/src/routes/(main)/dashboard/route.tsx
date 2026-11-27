import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Calculator, PanelRight, Sun } from "lucide-react";

import { cn } from "cn";

import { BloombergCommandBar } from "@/components/pro/BloombergCommandBar";
import { HotkeysHelpModal } from "@/components/pro/HotkeysHelpModal";
import { Mt5RiskCalcModal } from "@/components/pro/Mt5RiskCalcModal";
import { WatchlistAlertsDock } from "@/components/pro/WatchlistAlertsDock";
import { WorkspacesBar } from "@/components/pro/WorkspacesBar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { apiRequest, authApi, clearAccessToken, getAccessToken } from "@/framework/api-client";
import { BloombergTickerTape } from "@/framework/components/BloombergTickerTape";
import { HotkeyEngine } from "@/framework/components/HotkeyEngine";
import { LockScreenOverlay } from "@/framework/components/LockScreenOverlay";
import { HeaderUtcClock, TerminalHeaderControls } from "@/framework/components/TerminalHeaderControls";
import { TerminalFooter } from "@/framework/components/TerminalFooter";
import { queueServerPreferenceSync, useTerminalStore } from "@/framework/terminal-store";
import { LiveSocketProvider } from "@/framework/use-live-socket";
import { getDashboardLayout } from "@/server/server-actions";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { registerPreferencesServerSync } from "@/stores/preferences/preferences-store";

import { AccountSwitcher } from "./-components/header/account-switcher";
import { ThemeSwitcher } from "./-components/header/theme-switcher";
import { AppSidebar, type CurrentTerminalUser } from "./-components/sidebar/app-sidebar";

export const Route = createFileRoute("/(main)/dashboard")({
  loader: () => getDashboardLayout(),
  component: DashboardLayout,
});

function DashboardLayout() {
  const { defaultOpen, variant, collapsible } = Route.useLoaderData();
  const [tokenReady, setTokenReady] = useState<boolean>(() => Boolean(getAccessToken()));
  const [currentUser, setCurrentUser] = useState<CurrentTerminalUser | null>(null);
  const hydrateTerminal = useTerminalStore((s) => s.hydrateFromServer);
  const toggleSound = useTerminalStore((s) => s.toggleSound);
  const hydratePreferences = usePreferencesStore((s) => s.hydrateFromServer);
  const themeMode = usePreferencesStore((s) => s.values.theme_mode);
  const setPreference = usePreferencesStore((s) => s.setPreference);

  // Pro Terminal shell state
  const [dockOpen, setDockOpen] = useState(false);
  const [dockTab, setDockTab] = useState<"watchlist" | "alerts">("watchlist");
  const [alertsRefresh, setAlertsRefresh] = useState(0);
  const [calcOpen, setCalcOpen] = useState(false);
  const [calcSymbol, setCalcSymbol] = useState<string | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

  const handleToggleAwake = useCallback(async (nextState: boolean) => {
    setKeepAwake(nextState);
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      };
      if (nextState && nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request("screen");
      } else if (!nextState && wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // fallback state only
    }
    notify.info(
      "Режим «Не гасить экран»",
      nextState ? "Keep-Awake включён (экран активен)" : "Keep-Awake выключен",
    );
  }, []);

  // Global Pro Hotkeys: Cmd/Ctrl+M (Mute), Cmd/Ctrl+Shift+L (Theme), Cmd/Ctrl+Shift+A (Keep-Awake), ? (Help), Esc
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (e.key === "Escape") {
        if (calcOpen) {
          setCalcOpen(false);
          return;
        }
        if (helpOpen) {
          setHelpOpen(false);
          return;
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleSound();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        const up = e.key.toUpperCase();
        if (up === "L") {
          e.preventDefault();
          const nextTheme = themeMode === "light" ? "dark" : "light";
          setPreference("theme_mode", nextTheme);
          notify.info("Тема переключена", nextTheme === "dark" ? "Dark Mode" : "Light Mode");
          return;
        }
        if (up === "A") {
          e.preventDefault();
          void handleToggleAwake(!keepAwake);
          return;
        }
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey && !inInput) {
        e.preventDefault();
        setHelpOpen((o) => !o);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calcOpen, helpOpen, keepAwake, themeMode, toggleSound, setPreference, handleToggleAwake]);

  useEffect(() => {
    registerPreferencesServerSync((patch) => {
      queueServerPreferenceSync(patch as Record<string, unknown>);
    });
    return () => {
      registerPreferencesServerSync(null);
    };
  }, []);

  useEffect(() => {
    if (tokenReady) return;
    let cancelled = false;
    authApi
      .refresh()
      .then((tok) => {
        if (cancelled) return;
        if (!tok) {
          clearAccessToken();
          window.location.replace("/auth/v2/login");
          return;
        }
        setTokenReady(true);
      })
      .catch(() => {
        clearAccessToken();
        if (!cancelled) {
          window.location.replace("/auth/v2/login");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    let cancelled = false;
    async function verifySession() {
      try {
        const profile = await apiRequest<{
          id: string;
          username: string;
          email: string;
          display_name: string;
          avatar_url: string;
          role: string;
          preferences?: Record<string, unknown>;
        }>("/profile/me");

        let serverPrefs = profile.preferences;
        if (!serverPrefs) {
          try {
            const res = await apiRequest<{ preferences?: Record<string, unknown> }>("/profile/preferences");
            serverPrefs = res.preferences;
          } catch {
            // optional fallback
          }
        }

        if (!cancelled) {
          if (serverPrefs && typeof serverPrefs === "object") {
            hydrateTerminal(serverPrefs);
            hydratePreferences(serverPrefs as Record<string, string | null | undefined>);
          }
          setCurrentUser({
            id: profile.id,
            username: profile.username,
            name: profile.display_name || profile.username,
            email: profile.email || "",
            avatar: profile.avatar_url || "",
            role: profile.role || "ADMIN",
          });
        }
      } catch {
        clearAccessToken();
        if (!cancelled) {
          window.location.replace("/auth/v2/login");
        }
      }
    }
    void verifySession();
    return () => {
      cancelled = true;
    };
  }, [tokenReady, hydrateTerminal, hydratePreferences]);

  if (!tokenReady) {
    return (
      <div className="bg-background min-h-dvh w-full p-6">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <LiveSocketProvider>
      {!currentUser ? (
        <div className="bg-background min-h-dvh w-full p-6">
          <PageSkeleton />
        </div>
      ) : (
        <SidebarProvider
          defaultOpen={defaultOpen}
          style={
            {
              "--sidebar-width": "calc(var(--spacing) * 68)",
            } as CSSProperties
          }
        >
          <HotkeyEngine />
          <LockScreenOverlay user={currentUser} />
          <Mt5RiskCalcModal
            open={calcOpen}
            initialSymbol={calcSymbol}
            onClose={() => setCalcOpen(false)}
          />
          <HotkeysHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
          <AppSidebar
            variant={variant === "floating" ? "sidebar" : (variant ?? "sidebar")}
            collapsible={collapsible ?? "icon"}
            currentUser={currentUser}
          />
          <SidebarInset
            className={cn(
              "[html[data-content-layout=centered]_&>*]:mx-auto",
              "[html[data-content-layout=centered]_&>*]:w-full",
              "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
              "peer-data-[variant=inset]:border",
              "[--dashboard-header-height:--spacing(11)]",
              "min-w-0 overflow-x-clip bg-background",
            )}
          >
            <BloombergTickerTape />
            <header
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-11",
                "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden",
              )}
            >
              <div className="flex w-full items-center justify-between gap-2 px-3">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <SidebarTrigger className="-ml-1 shrink-0" />
                  <Separator
                    orientation="vertical"
                    className="mx-1 shrink-0 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
                  />
                  <BloombergCommandBar
                    onOpenCalc={(sym) => {
                      setCalcSymbol(sym);
                      setCalcOpen(true);
                    }}
                    onOpenAlerts={() => {
                      setDockTab("alerts");
                      setDockOpen(true);
                    }}
                    onOpenHelp={() => setHelpOpen(true)}
                    onAlertCreated={() => setAlertsRefresh((n) => n + 1)}
                    onToggleAwake={(en) => void handleToggleAwake(en)}
                  />
                  <WorkspacesBar dockOpen={dockOpen} onSetDockOpen={setDockOpen} />
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {keepAwake && (
                    <button
                      type="button"
                      onClick={() => void handleToggleAwake(false)}
                      title="Keep-Awake активен (Cmd/Ctrl+Shift+A)"
                      className="hidden h-7 items-center gap-1 rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-2 font-mono text-[10px] font-semibold text-amber-500 lg:inline-flex"
                    >
                      <Sun className="size-3" />
                      AWAKE
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 font-mono text-[11px] font-semibold"
                    onClick={() => {
                      setCalcSymbol(undefined);
                      setCalcOpen(true);
                    }}
                    title="Калькулятор риска и лота MT5 (CALC)"
                  >
                    <Calculator className="size-3.5 text-[var(--accent-blue)]" />
                    <span className="hidden sm:inline">CALC</span>
                  </Button>
                  <Button
                    type="button"
                    variant={dockOpen ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1 px-2 text-[11px]"
                    onClick={() => setDockOpen((o) => !o)}
                    title="Watchlist и Центр алертов"
                  >
                    <PanelRight className="size-3.5" />
                  </Button>
                  <TerminalHeaderControls />
                  <Separator
                    orientation="vertical"
                    className="mx-0.5 hidden data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center md:block"
                  />
                  <ThemeSwitcher />
                  <HeaderUtcClock />
                  <AccountSwitcher user={currentUser} />
                </div>
              </div>
            </header>
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 has-data-[content-padding=false]:p-0">
                <Outlet />
              </div>
              <WatchlistAlertsDock
                open={dockOpen}
                activeTab={dockTab}
                onTabChange={setDockTab}
                onClose={() => setDockOpen(false)}
                refreshSignal={alertsRefresh}
              />
            </div>
            <TerminalFooter />
          </SidebarInset>
        </SidebarProvider>
      )}
    </LiveSocketProvider>
  );
}

