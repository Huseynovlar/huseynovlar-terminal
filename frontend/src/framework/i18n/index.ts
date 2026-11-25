import { useEffect } from "react";

import { type LanguageMode, useTerminalStore } from "@/framework/terminal-store";

import { az } from "./az";
import { en } from "./en";
import { ru } from "./ru";

export const DICTIONARIES = {
  ru,
  en,
  az,
} as const;

export type TranslationDict = typeof en;

export function getDictionary(lang: LanguageMode): TranslationDict {
  return (DICTIONARIES[lang] ?? ru) as unknown as TranslationDict;
}

export function useI18n() {
  const language = useTerminalStore((s) => s.language);
  const setLanguage = useTerminalStore((s) => s.setLanguage);

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement.lang !== language) {
      document.documentElement.lang = language;
    }
  }, [language]);

  const dict = getDictionary(language);
  return {
    language,
    setLanguage,
    t: dict,
  };
}
