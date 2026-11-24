import { Clock, Eye, EyeOff, Languages, Radio } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/framework/terminal-store";

export function TerminalHeaderControls() {
  const {
    currencyMode,
    privacyMode,
    timezone,
    language,
    tickerEnabled,
    toggleCurrencyMode,
    togglePrivacyMode,
    cycleTimezone,
    setLanguage,
    setTickerEnabled,
  } = useTerminalStore();

  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 font-mono text-[11px]"
        onClick={toggleCurrencyMode}
        title="Переключить валюту USD / USC (Shift+C)"
      >
        {currencyMode}
      </Button>

      <Button
        variant={privacyMode ? "secondary" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={togglePrivacyMode}
        title="Privacy Mode — скрыть суммы $ (Shift+M)"
      >
        {privacyMode ? <EyeOff className="size-3.5 text-amber-500" /> : <Eye className="size-3.5" />}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 font-mono text-[11px]"
        onClick={cycleTimezone}
        title="Сменить часовой пояс (Shift+T)"
      >
        <Clock className="size-3" />
        <span className="hidden xl:inline">{timezone}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-[11px] uppercase"
        onClick={() => setLanguage(language === "ru" ? "en" : "ru")}
        title="Переключить язык RU / EN"
      >
        <Languages className="size-3" />
        {language}
      </Button>

      <Button
        variant={tickerEnabled ? "ghost" : "outline"}
        size="sm"
        className="h-7 px-2"
        onClick={() => setTickerEnabled(!tickerEnabled)}
        title="Вкл/выкл бегущую строку новостей"
      >
        <Radio className={`size-3.5 ${tickerEnabled ? "text-emerald-500" : "text-muted-foreground"}`} />
      </Button>
    </div>
  );
}
