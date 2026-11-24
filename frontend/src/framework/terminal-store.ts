import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CurrencyMode = "USD" | "USC";
export type TimezoneMode = "Asia/Baku" | "UTC" | "Exness";
export type LanguageMode = "ru" | "en";
export type DensityMode = "comfortable" | "compact";
export type TickerSpeed = "slow" | "normal" | "fast";

export interface TerminalPreferencesState {
  currencyMode: CurrencyMode;
  privacyMode: boolean;
  timezone: TimezoneMode;
  language: LanguageMode;
  density: DensityMode;
  tickerEnabled: boolean;
  tickerSpeed: TickerSpeed;
  hiddenPageIds: string[];
  pinnedAssetCodes: string[];
  customHotkeys: Record<string, string>;

  toggleCurrencyMode: () => void;
  togglePrivacyMode: () => void;
  cycleTimezone: () => void;
  setLanguage: (lang: LanguageMode) => void;
  setDensity: (density: DensityMode) => void;
  setTickerEnabled: (enabled: boolean) => void;
  setTickerSpeed: (speed: TickerSpeed) => void;
  toggleHiddenPage: (pageId: string) => void;
  setHotkey: (actionId: string, combo: string) => void;
  resetHotkeys: () => void;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  "command.palette": "Mod+K",
  "privacy.toggle": "Shift+M",
  "currency.toggle": "Shift+C",
  "timezone.cycle": "Shift+T",
  "nav.overview": "G D",
  "nav.assets": "G A",
  "nav.heatmap": "G M",
  "nav.news": "G N",
  "nav.containers": "G C",
  "nav.instructions": "G I",
  "hotkeys.help": "?",
};

const TZ_ORDER: TimezoneMode[] = ["Asia/Baku", "UTC", "Exness"];

export const useTerminalStore = create<TerminalPreferencesState>()(
  persist(
    (set) => ({
      currencyMode: "USD",
      privacyMode: false,
      timezone: "Asia/Baku",
      language: "ru",
      density: "comfortable",
      tickerEnabled: true,
      tickerSpeed: "normal",
      hiddenPageIds: [],
      pinnedAssetCodes: ["XAUUSD", "USTEC"],
      customHotkeys: { ...DEFAULT_HOTKEYS },

      toggleCurrencyMode: () =>
        set((s) => ({ currencyMode: s.currencyMode === "USD" ? "USC" : "USD" })),
      togglePrivacyMode: () => set((s) => ({ privacyMode: !s.privacyMode })),
      cycleTimezone: () =>
        set((s) => {
          const idx = TZ_ORDER.indexOf(s.timezone);
          return { timezone: TZ_ORDER[(idx + 1) % TZ_ORDER.length] };
        }),
      setLanguage: (language) => set({ language }),
      setDensity: (density) => set({ density }),
      setTickerEnabled: (tickerEnabled) => set({ tickerEnabled }),
      setTickerSpeed: (tickerSpeed) => set({ tickerSpeed }),
      toggleHiddenPage: (pageId) =>
        set((s) => ({
          hiddenPageIds: s.hiddenPageIds.includes(pageId)
            ? s.hiddenPageIds.filter((id) => id !== pageId)
            : [...s.hiddenPageIds, pageId],
        })),
      setHotkey: (actionId, combo) =>
        set((s) => ({ customHotkeys: { ...s.customHotkeys, [actionId]: combo } })),
      resetHotkeys: () => set({ customHotkeys: { ...DEFAULT_HOTKEYS } }),
    }),
    { name: "huseynovlar-terminal-prefs-v1" },
  ),
);
