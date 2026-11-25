import { create } from "zustand";
import { persist } from "zustand/middleware";

import { apiRequest, getAccessToken } from "@/framework/api-client";
import { soundEngine } from "@/framework/sound-engine";

export type CurrencyMode = "USD" | "USC";
export type TimezoneMode = "UTC" | "Asia/Baku" | "America/New_York" | "Europe/London" | "Asia/Tokyo" | "Europe/Istanbul" | "Asia/Dubai" | "Exness";
export type LanguageMode = "ru" | "en" | "az";
export type DensityMode = "bloomberg";
export type TickerSpeed = "slow" | "normal" | "fast";

export interface TerminalPreferencesState {
  currencyMode: CurrencyMode;
  privacyMode: boolean;
  timezone: TimezoneMode;
  language: LanguageMode;
  density: DensityMode;
  tickerEnabled: boolean;
  tickerSpeed: TickerSpeed;
  soundEnabled: boolean;
  hiddenPageIds: string[];
  sidebarOrder: string[];
  pinnedAssetCodes: string[];
  customHotkeys: Record<string, string>;
  vaultTargetUsd: number;
  analyticsFilters: Record<string, unknown>;
  treemapFilters: Record<string, unknown>;
  screenLocked: boolean;
  serverHydrated: boolean;

  toggleCurrencyMode: () => void;
  togglePrivacyMode: () => void;
  setPrivacyMode: (enabled: boolean) => void;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setTimezone: (tz: TimezoneMode) => void;
  cycleTimezone: () => void;
  cycleLanguage: () => void;
  setLanguage: (lang: LanguageMode) => void;
  setDensity: (_density?: string) => void;
  setTickerEnabled: (enabled: boolean) => void;
  setTickerSpeed: (speed: TickerSpeed) => void;
  toggleHiddenPage: (pageId: string) => void;
  setSidebarOrder: (order: string[]) => void;
  setHotkey: (actionId: string, combo: string) => void;
  resetHotkeys: () => void;
  setVaultTargetUsd: (amount: number) => void;
  setAnalyticsFilters: (filters: Record<string, unknown>) => void;
  setTreemapFilters: (filters: Record<string, unknown>) => void;
  setScreenLocked: (locked: boolean) => void;
  hydrateFromServer: (prefs: Record<string, unknown>) => void;
}

export const DEFAULT_HOTKEYS: Record<string, string> = {
  "command.palette": "Mod+K",
  "privacy.toggle": "Shift+M",
  "sound.toggle": "Shift+S",
  "screen.lock": "Shift+L",
  "nav.home": "G H",
  "nav.overview": "G D",
  "nav.assets": "G A",
  "nav.heatmap": "G M",
  "nav.news": "G N",
  "nav.containers": "G C",
  "nav.instructions": "G I",
  "nav.wiki": "G W",
  "nav.preferences": "G P",
  "hotkeys.help": "?",
};

const TZ_ORDER: TimezoneMode[] = ["UTC", "Asia/Baku", "America/New_York", "Europe/London"];
const LANG_ORDER: LanguageMode[] = ["ru", "en", "az"];

let pendingPatch: Record<string, unknown> = {};
let syncTimer: number | undefined;

export function queueServerPreferenceSync(patch: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!getAccessToken() && !window.location.pathname.startsWith("/dashboard")) return;

  pendingPatch = { ...pendingPatch, ...patch };
  if (syncTimer !== undefined) {
    window.clearTimeout(syncTimer);
  }
  syncTimer = window.setTimeout(() => {
    const payload = { ...pendingPatch };
    pendingPatch = {};
    syncTimer = undefined;
    void apiRequest("/profile/preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).catch(() => {
      // Ignore transient offline sync errors; local persist retains state.
    });
  }, 300);
}

export const useTerminalStore = create<TerminalPreferencesState>()(
  persist(
    (set, get) => ({
      currencyMode: "USD",
      privacyMode: false,
      timezone: "UTC",
      language: "ru",
      density: "bloomberg",
      tickerEnabled: true,
      tickerSpeed: "normal",
      soundEnabled: true,
      hiddenPageIds: [],
      sidebarOrder: [],
      pinnedAssetCodes: ["XAUUSD", "USTEC", "SPX", "BTCUSD"],
      customHotkeys: { ...DEFAULT_HOTKEYS },
      vaultTargetUsd: 100000,
      analyticsFilters: {},
      treemapFilters: {},
      screenLocked: false,
      serverHydrated: false,

      toggleCurrencyMode: () =>
        set((s) => ({ currencyMode: s.currencyMode === "USD" ? "USC" : "USD" })),

      togglePrivacyMode: () => {
        const next = !get().privacyMode;
        set({ privacyMode: next });
        queueServerPreferenceSync({ privacy_mode: next });
      },

      setPrivacyMode: (privacyMode) => {
        set({ privacyMode });
        queueServerPreferenceSync({ privacy_mode: privacyMode });
      },

      toggleSound: () => {
        const next = !get().soundEnabled;
        set({ soundEnabled: next });
        if (next) {
          soundEngine.confirmEnable(true);
        }
        queueServerPreferenceSync({ sound_enabled: next });
      },

      setSoundEnabled: (enabled) => {
        set({ soundEnabled: enabled });
        if (enabled) {
          soundEngine.confirmEnable(true);
        }
        queueServerPreferenceSync({ sound_enabled: enabled });
      },

      setTimezone: (timezone) => {
        set({ timezone });
        queueServerPreferenceSync({ timezone });
      },

      cycleTimezone: () => {
        const current = get().timezone;
        const idx = TZ_ORDER.indexOf(current);
        const next = TZ_ORDER[(idx + 1) % TZ_ORDER.length] ?? "UTC";
        set({ timezone: next });
        queueServerPreferenceSync({ timezone: next });
      },

      cycleLanguage: () => {
        const current = get().language;
        const idx = LANG_ORDER.indexOf(current);
        const next = LANG_ORDER[(idx + 1) % LANG_ORDER.length] ?? "ru";
        set({ language: next });
        if (typeof document !== "undefined") {
          document.documentElement.lang = next;
        }
        queueServerPreferenceSync({ language: next });
      },

      setLanguage: (language) => {
        set({ language });
        if (typeof document !== "undefined") {
          document.documentElement.lang = language;
        }
        queueServerPreferenceSync({ language });
      },

      // Bloomberg-only compact density (F03) — normalize any legacy value to "bloomberg"
      setDensity: () => {
        set({ density: "bloomberg" });
        queueServerPreferenceSync({ density: "bloomberg" });
      },

      setTickerEnabled: (tickerEnabled) => {
        set({ tickerEnabled });
        queueServerPreferenceSync({ ticker_enabled: tickerEnabled });
      },

      setTickerSpeed: (tickerSpeed) => {
        set({ tickerSpeed });
        queueServerPreferenceSync({ ticker_speed: tickerSpeed });
      },

      toggleHiddenPage: (pageId) => {
        const current = get().hiddenPageIds;
        const next = current.includes(pageId)
          ? current.filter((id) => id !== pageId)
          : [...current, pageId];
        set({ hiddenPageIds: next });
        queueServerPreferenceSync({ hidden_page_ids: next });
      },

      setSidebarOrder: (sidebarOrder) => {
        set({ sidebarOrder });
        queueServerPreferenceSync({ sidebar_order: sidebarOrder });
      },

      setHotkey: (actionId, combo) => {
        const next = { ...get().customHotkeys, [actionId]: combo };
        set({ customHotkeys: next });
        queueServerPreferenceSync({ custom_hotkeys: next });
      },

      resetHotkeys: () => {
        const next = { ...DEFAULT_HOTKEYS };
        set({ customHotkeys: next });
        queueServerPreferenceSync({ custom_hotkeys: next });
      },

      setVaultTargetUsd: (vaultTargetUsd) => {
        set({ vaultTargetUsd });
        queueServerPreferenceSync({ vault_target_usd: vaultTargetUsd });
      },

      setAnalyticsFilters: (analyticsFilters) => {
        set({ analyticsFilters });
        queueServerPreferenceSync({ analytics_filters: analyticsFilters });
      },

      setTreemapFilters: (treemapFilters) => {
        set({ treemapFilters });
        queueServerPreferenceSync({ treemap_filters: treemapFilters });
      },

      setScreenLocked: (screenLocked) => set({ screenLocked }),

      hydrateFromServer: (prefs) => {
        if (!prefs || typeof prefs !== "object") return;
        const patch: Partial<TerminalPreferencesState> = {
          density: "bloomberg",
          serverHydrated: true,
        };
        if (typeof prefs.privacy_mode === "boolean") patch.privacyMode = prefs.privacy_mode;
        if (typeof prefs.timezone === "string" && prefs.timezone) {
          patch.timezone = prefs.timezone as TimezoneMode;
        }
        if (prefs.language === "ru" || prefs.language === "en" || prefs.language === "az") {
          patch.language = prefs.language;
          if (typeof document !== "undefined") {
            document.documentElement.lang = prefs.language;
          }
        }
        if (typeof prefs.ticker_enabled === "boolean") patch.tickerEnabled = prefs.ticker_enabled;
        if (prefs.ticker_speed === "slow" || prefs.ticker_speed === "normal" || prefs.ticker_speed === "fast") {
          patch.tickerSpeed = prefs.ticker_speed;
        }
        if (typeof prefs.sound_enabled === "boolean") patch.soundEnabled = prefs.sound_enabled;
        if (Array.isArray(prefs.hidden_page_ids)) {
          patch.hiddenPageIds = prefs.hidden_page_ids.map(String);
        }
        if (Array.isArray(prefs.sidebar_order)) {
          patch.sidebarOrder = prefs.sidebar_order.map(String);
        }
        if (Array.isArray(prefs.pinned_asset_codes)) {
          patch.pinnedAssetCodes = prefs.pinned_asset_codes.map(String);
        }
        if (prefs.custom_hotkeys && typeof prefs.custom_hotkeys === "object") {
          patch.customHotkeys = {
            ...DEFAULT_HOTKEYS,
            ...(prefs.custom_hotkeys as Record<string, string>),
          };
        }
        if (typeof prefs.vault_target_usd === "number" && Number.isFinite(prefs.vault_target_usd)) {
          patch.vaultTargetUsd = prefs.vault_target_usd;
        }
        if (prefs.analytics_filters && typeof prefs.analytics_filters === "object") {
          patch.analyticsFilters = prefs.analytics_filters as Record<string, unknown>;
        }
        if (prefs.treemap_filters && typeof prefs.treemap_filters === "object") {
          patch.treemapFilters = prefs.treemap_filters as Record<string, unknown>;
        }
        set(patch);
      },
    }),
    {
      name: "huseynovlar-terminal-prefs-v2",
      partialize: (state) => ({
        currencyMode: state.currencyMode,
        privacyMode: state.privacyMode,
        timezone: state.timezone,
        language: state.language,
        density: "bloomberg" as DensityMode,
        tickerEnabled: state.tickerEnabled,
        tickerSpeed: state.tickerSpeed,
        soundEnabled: state.soundEnabled,
        hiddenPageIds: state.hiddenPageIds,
        sidebarOrder: state.sidebarOrder,
        pinnedAssetCodes: state.pinnedAssetCodes,
        customHotkeys: state.customHotkeys,
        vaultTargetUsd: state.vaultTargetUsd,
        analyticsFilters: state.analyticsFilters,
        treemapFilters: state.treemapFilters,
      }),
    },
  ),
);
