import { useEffect, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { Keyboard } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTerminalStore } from "@/framework/terminal-store";

const SHORTCUT_LIST = [
  { combo: "Shift + M", label: "Privacy Mode (скрыть суммы $)" },
  { combo: "Shift + C", label: "Переключить USD ↔ USC" },
  { combo: "Shift + T", label: "Сменить часовой пояс (Asia/Baku / UTC / Exness)" },
  { combo: "G → D", label: "Перейти в Общую сводку (Dashboard)" },
  { combo: "G → A", label: "Перейти в Хабы активов (XAUUSD / USTEC)" },
  { combo: "G → M", label: "Перейти в Карту рынка / Аналитику" },
  { combo: "G → N", label: "Перейти в Мировые новости и Gemini AI" },
  { combo: "G → C", label: "Перейти в Контейнеры MT5 / ОС" },
  { combo: "G → I", label: "Перейти в Инструкции и Setup Wizard" },
  { combo: "F13 – F24", label: "Готово для аппаратного макропада (Stream Deck / QMK)" },
  { combo: "?", label: "Открыть / закрыть карту горячих клавиш" },
];

export function HotkeyEngine() {
  const navigate = useNavigate();
  const togglePrivacyMode = useTerminalStore((s) => s.togglePrivacyMode);
  const toggleCurrencyMode = useTerminalStore((s) => s.toggleCurrencyMode);
  const cycleTimezone = useTerminalStore((s) => s.cycleTimezone);
  const [helpOpen, setHelpOpen] = useState(false);

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
        if (upper === "C") {
          e.preventDefault();
          toggleCurrencyMode();
          return;
        }
        if (upper === "T") {
          e.preventDefault();
          cycleTimezone();
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
            d: "/dashboard/crypto",
            a: "/dashboard/crypto",
            m: "/dashboard/analytics",
            n: "/dashboard/chat",
            c: "/dashboard/infrastructure",
            i: "/dashboard/academy",
          };
          const dest = routeMap[lower];
          if (dest) {
            e.preventDefault();
            navigate({ to: dest as never });
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(goTimer);
    };
  }, [navigate, togglePrivacyMode, toggleCurrencyMode, cycleTimezone]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" />
            Горячие клавиши Huseynovlar Terminal
          </DialogTitle>
          <DialogDescription>
            Bloomberg-навигация с клавиатуры. Поддерживается привязка клавиш F13–F24 для Stream Deck / QMK макропада.
          </DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/60 text-sm">
          {SHORTCUT_LIST.map((item) => (
            <div key={item.combo} className="flex items-center justify-between py-2">
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
