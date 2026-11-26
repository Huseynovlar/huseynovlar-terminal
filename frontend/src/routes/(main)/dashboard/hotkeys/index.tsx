import { createFileRoute } from "@tanstack/react-router";
import { Keyboard, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { notify } from "@/components/ui/toast";
import { useI18n } from "@/framework/i18n";
import { DEFAULT_HOTKEYS, useTerminalStore } from "@/framework/terminal-store";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";

export const Route = createFileRoute("/(main)/dashboard/hotkeys/")({
  component: HotkeysPage,
});

function HotkeysPage() {
  const { t } = useI18n();
  const customHotkeys = useTerminalStore((s) => s.customHotkeys);
  const setHotkey = useTerminalStore((s) => s.setHotkey);
  const resetHotkeys = useTerminalStore((s) => s.resetHotkeys);

  const actionKeys = Object.keys(DEFAULT_HOTKEYS);

  return (
    <TerminalPageShell
      title={t.hotkeys.title}
      subtitle={t.hotkeys.subtitle}
      badge="KEYMAP"
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            resetHotkeys();
            notify.success(t.common.savedSuccess);
          }}
        >
          <RotateCcw className="mr-1.5 size-3.5" />
          {t.hotkeys.resetAll}
        </Button>
      }
    >
      <Card className="w-full">
        <CardContent className="grid grid-cols-1 gap-px bg-border/50 p-0 md:grid-cols-2">
          {actionKeys.map((actionId) => (
            <div key={actionId} className="bg-card flex items-center justify-between gap-4 px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 font-mono">
                <Keyboard className="size-3.5 text-muted-foreground" />
                <span>{actionId}</span>
              </div>
              <Input
                className="h-8 w-40 text-center font-mono text-xs"
                value={customHotkeys[actionId] ?? DEFAULT_HOTKEYS[actionId] ?? ""}
                onChange={(e) => setHotkey(actionId, e.target.value)}
                placeholder={t.hotkeys.recordHint}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
