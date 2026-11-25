import { useEffect, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { Keyboard } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";

export function HotkeyEngine() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const togglePrivacyMode = useTerminalStore((s) => s.togglePrivacyMode);
  const toggleSound = useTerminalStore((s) => s.toggleSound);
  const setScreenLocked = useTerminalStore((s) => s.setScreenLocked);
  const customHotkeys = useTerminalStore((s) => s.customHotkeys);
  const [helpOpen, setHelpOpen] = useState(false);

  const shortcutList = [
    { combo: customHotkeys["command.palette"] ?? "Mod+K", label: t.header.searchTrigger },
    { combo: customHotkeys["privacy.toggle"] ?? "Shift+M", label: t.header.privacyOn },
    { combo: customHotkeys["sound.toggle"] ?? "Shift+S", label: t.header.soundOn },
    { combo: customHotkeys["screen.lock"] ?? "Shift+L", label: t.header.lockScreen },
    { combo: customHotkeys["nav.overview"] ?? "G D", label: t.nav.charts },
    { combo: customHotkeys["nav.heatmap"] ?? "G M", label: t.nav.treemap },
    { combo: customHotkeys["nav.news"] ?? "G N", label: t.nav.news },
    { combo: customHotkeys["nav.containers"] ?? "G C", label: t.nav.containers },
    { combo: customHotkeys["nav.instructions"] ?? "G I", label: t.nav.setup },
    { combo: customHotkeys["nav.wiki"] ?? "G W", label: t.nav.wiki },
    { combo: customHotkeys["nav.preferences"] ?? "G P", label: t.nav.preferences },
    { combo: customHotkeys["hotkeys.help"] ?? "?", label: t.hotkeys.title },
  ];

  useEffect(() => {
    let awaitingGo = false;
    let goTimer: number | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }

      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const upper = e.key.toUpperCase();
        if (upper === "M") {
          e.preventDefault();
          togglePrivacyMode();
          return;
        }
        if (upper === "S") {
          e.preventDefault();
          toggleSound();
          return;
        }
        if (upper === "L") {
          e.preventDefault();
          setScreenLocked(true);
          return;
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const lower = e.key.toLowerCase();
        if (lower === "g" && !awaitingGo) {
          awaitingGo = true;
          window.clearTimeout(goTimer);
          goTimer = window.setTimeout(() => {
            awaitingGo = false;
          }, 900);
          return;
        }

        if (awaitingGo) {
          awaitingGo = false;
          window.clearTimeout(goTimer);
          const routeMap: Record<string, string> = {
            h: "/dashboard/crypto",
            d: "/dashboard/crypto",
            a: "/dashboard/default",
            m: "/dashboard/treemap",
            n: "/dashboard/chat",
            c: "/dashboard/containers",
            i: "/dashboard/setup",
            w: "/dashboard/wiki",
            p: "/dashboard/preferences",
          };
          const dest = routeMap[lower];
          if (dest) {
            e.preventDefault();
            void navigate({ to: dest as never });
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(goTimer);
    };
  }, [navigate, togglePrivacyMode, toggleSound, setScreenLocked]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" />
            {t.hotkeys.title}
          </DialogTitle>
          <DialogDescription>{t.hotkeys.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60 text-sm">
          {shortcutList.map((item) => (
            <div key={item.combo + item.label} className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">{item.label}</span>
              <kbd className="bg-muted rounded border border-border px-2 py-0.5 font-mono text-xs font-medium">
                {item.combo}
              </kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
