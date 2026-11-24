import { createFileRoute } from "@tanstack/react-router";
import { Download, Keyboard, RotateCcw, Sliders } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TERMINAL_PAGES } from "@/framework/registries/pages.config";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { useTerminalStore } from "@/framework/terminal-store";

export const Route = createFileRoute("/(main)/dashboard/roles")({
  component: SettingsAndHotkeysPage,
});

function SettingsAndHotkeysPage() {
  const {
    timezone,
    language,
    density,
    tickerEnabled,
    tickerSpeed,
    soundEnabled,
    hiddenPageIds,
    customHotkeys,
    cycleTimezone,
    setLanguage,
    setDensity,
    setTickerEnabled,
    setTickerSpeed,
    toggleSound,
    toggleHiddenPage,
    setHotkey,
    resetHotkeys,
  } = useTerminalStore();

  function exportKeymapJson() {
    const blob = new Blob([JSON.stringify(customHotkeys, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "huseynovlar-terminal-hotkeys.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <TerminalPageShell
      title="Настройки интерфейса, Левое меню и Хоткеи (Макропад F13–F24)"
      subtitle="Полная персонализация Bloomberg × Apple: плотность, единое время (по умолчанию UTC), 3 языка (RU/EN/AZ), бегущая строка и редактор клавиш."
      badge="CUSTOMIZER"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Global Terminal Preferences */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sliders className="size-4 text-blue-500" />
              Глобальные настройки интерфейса
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <span>Плотность интерфейса</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={density === "comfortable" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setDensity("comfortable")}
                >
                  Apple (Comfortable)
                </Button>
                <Button
                  size="sm"
                  variant={density === "compact" ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setDensity("compact")}
                >
                  Bloomberg (Compact)
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Язык интерфейса (RU / EN / AZ)</span>
              <div className="flex gap-1">
                {(["ru", "en", "az"] as const).map((lang) => (
                  <Button
                    key={lang}
                    size="sm"
                    variant={language === lang ? "default" : "outline"}
                    className="h-7 px-3 uppercase"
                    onClick={() => setLanguage(lang)}
                  >
                    {lang}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Единое время терминала (по умолчанию UTC)</span>
              <Button size="sm" variant="outline" className="h-7 font-mono text-xs" onClick={cycleTimezone}>
                {timezone} (сменить)
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <span>Бегущая строка новостей и скорость</span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={tickerEnabled ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setTickerEnabled(!tickerEnabled)}
                >
                  {tickerEnabled ? "ВКЛ" : "ВЫКЛ"}
                </Button>
                {(["slow", "normal", "fast"] as const).map((spd) => (
                  <Button
                    key={spd}
                    size="sm"
                    variant={tickerSpeed === spd ? "secondary" : "ghost"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => setTickerSpeed(spd)}
                  >
                    {spd}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span>Звуковые эффекты (сделки, крупная прибыль, новости)</span>
              <Button size="sm" variant={soundEnabled ? "default" : "outline"} className="h-7 text-xs" onClick={toggleSound}>
                {soundEnabled ? "Звук ВКЛ" : "Звук ВЫКЛ"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar Customizer */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Конструктор левого меню (Страницы из PageRegistry)</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs">
            {TERMINAL_PAGES.map((page) => {
              const hidden = hiddenPageIds.includes(page.id);
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => toggleHiddenPage(page.id)}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    hidden ? "border-border/40 bg-muted/10 text-muted-foreground opacity-60" : "border-border bg-muted/30"
                  }`}
                >
                  <span className="truncate font-medium">{page.titleRu}</span>
                  <Badge variant={hidden ? "outline" : "default"} className="text-[10px]">
                    {hidden ? "Скрыт" : "Показан"}
                  </Badge>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Visual Hotkey & Macro-Pad Editor (F13-F24 ready) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Keyboard className="size-4 text-emerald-500" />
            Редактор горячих клавиш и Макропада (Stream Deck / QMK / F13–F24)
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={exportKeymapJson}>
              <Download className="size-3" />
              Экспорт JSON
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={resetHotkeys}>
              <RotateCcw className="size-3" />
              Сбросить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(customHotkeys).map(([actionId, combo]) => (
            <div key={actionId} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2">
              <span className="truncate font-mono text-[11px]">{actionId}</span>
              <Input
                value={combo}
                onChange={(e) => setHotkey(actionId, e.target.value)}
                className="h-7 w-28 text-center font-mono text-xs"
                placeholder="F13 / Shift+M"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
