import { Clock, Eye, EyeOff, Languages, Radio, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { soundEngine } from "@/framework/sound-engine";
import { useTerminalStore } from "@/framework/terminal-store";

export function TerminalHeaderControls() {
  const {
    currencyMode,
    privacyMode,
    timezone,
    language,
    tickerEnabled,
    soundEnabled,
    toggleCurrencyMode,
    togglePrivacyMode,
    toggleSound,
    cycleTimezone,
    cycleLanguage,
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
        className="h-7 px-2"
        onClick={() => {
          const next = !soundEnabled;
          toggleSound();
          if (next) soundEngine.tradeOpen(true);
        }}
        title="Звуковые эффекты (сделки, прибыль, срочные новости)"
      >
        {soundEnabled ? <Volume2 className="size-3.5 text-emerald-500" /> : <VolumeX className="size-3.5 text-muted-foreground" />}
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
        onClick={cycleLanguage}
        title="Переключить язык RU / EN / AZ"
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
