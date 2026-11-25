import { createStore } from "zustand/vanilla";

import { applyPreference } from "@/lib/preferences/preference-runtime";
import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  PREFERENCE_REGISTRY,
  type PreferenceKey,
  type PreferenceValueMap,
} from "@/lib/preferences/preferences-config";
import { persistPreference } from "@/lib/preferences/preferences-storage";
import type { ResolvedThemeMode } from "@/lib/preferences/theme";

export type PreferencesState = {
  values: PreferenceValueMap;
  resolvedThemeMode: ResolvedThemeMode;
  isSynced: boolean;
  setPreference: <K extends PreferenceKey>(key: K, value: PreferenceValueMap[K], options?: { skipServerSync?: boolean }) => void;
  hydrateFromServer: (partial: Partial<Record<PreferenceKey, string | null | undefined>>) => void;
  resetPreferences: () => void;
};

let serverSyncCallback: ((patch: Partial<PreferenceValueMap>) => void) | null = null;

export function registerPreferencesServerSync(cb: ((patch: Partial<PreferenceValueMap>) => void) | null) {
  serverSyncCallback = cb;
}

export const createPreferencesStore = (initialValues: Partial<PreferenceValueMap> = {}) => {
  const values: PreferenceValueMap = {
    ...PREFERENCE_DEFAULTS,
    ...initialValues,
  };

  return createStore<PreferencesState>()((set) => ({
    values,
    resolvedThemeMode: values.theme_mode === "dark" ? "dark" : "light",
    isSynced: false,

    setPreference: (key, value, options) => {
      const resolvedThemeMode = applyPreference(key, value);

      set((state) => ({
        values: {
          ...state.values,
          [key]: value,
        } as PreferenceValueMap,
        ...(resolvedThemeMode ? { resolvedThemeMode } : {}),
      }));

      void persistPreference(key, value);
      if (!options?.skipServerSync && serverSyncCallback) {
        serverSyncCallback({ [key]: value } as Partial<PreferenceValueMap>);
      }
    },

    hydrateFromServer: (partial) => {
      let resolvedThemeMode: ResolvedThemeMode | undefined;
      const nextPatch: Partial<PreferenceValueMap> = {};
      for (const key of PREFERENCE_KEYS) {
        const raw = partial[key];
        if (!raw) continue;
        const allowed = PREFERENCE_REGISTRY[key].values as readonly string[];
        if (!allowed.includes(raw)) continue;
        const val = raw as PreferenceValueMap[typeof key];
        const resolved = applyPreference(key, val);
        if (resolved) resolvedThemeMode = resolved;
        void persistPreference(key, val);
        (nextPatch as Record<string, string>)[key] = val;
      }
      if (Object.keys(nextPatch).length > 0) {
        set((state) => ({
          values: { ...state.values, ...nextPatch },
          ...(resolvedThemeMode ? { resolvedThemeMode } : {}),
          isSynced: true,
        }));
      }
    },

    resetPreferences: () => {
      let resolvedThemeMode: ResolvedThemeMode = "dark";

      for (const key of PREFERENCE_KEYS) {
        const value = PREFERENCE_DEFAULTS[key];
        const resolved = applyPreference(key, value);

        if (resolved) resolvedThemeMode = resolved;
        void persistPreference(key, value);
      }

      set({
        values: { ...PREFERENCE_DEFAULTS },
        resolvedThemeMode,
      });
      if (serverSyncCallback) {
        serverSyncCallback({ ...PREFERENCE_DEFAULTS });
      }
    },
  }));
};
