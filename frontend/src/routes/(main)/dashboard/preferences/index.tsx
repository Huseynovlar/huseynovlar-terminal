import { createFileRoute } from "@tanstack/react-router";
import { RotateCcw, Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { notify } from "@/components/ui/toast";
import { useI18n } from "@/framework/i18n";
import { TERMINAL_PAGES } from "@/framework/registries/pages.config";
import { type SoundCueName, soundEngine } from "@/framework/sound-engine";
import { type LanguageMode, type TickerSpeed, type TimezoneMode, useTerminalStore } from "@/framework/terminal-store";
import { TerminalPageShell } from "@/framework/templates/TerminalPageShell";
import { fontKeys, fontRegistry } from "@/lib/fonts/registry";
import {
  CONTENT_LAYOUT_VALUES,
  NAVBAR_STYLE_VALUES,
  SIDEBAR_COLLAPSIBLE_VALUES,
  SIDEBAR_VARIANT_VALUES,
} from "@/lib/preferences/layout";
import { THEME_MODE_VALUES, THEME_PRESET_VALUES } from "@/lib/preferences/theme";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

export const Route = createFileRoute("/(main)/dashboard/preferences/")({
  component: PreferencesPage,
});

const TIMEZONE_OPTIONS: TimezoneMode[] = [
  "UTC",
  "Asia/Baku",
  "America/New_York",
  "Europe/London",
  "Asia/Tokyo",
  "Europe/Istanbul",
  "Asia/Dubai",
];

const SOUND_CUES: { id: SoundCueName; label: string }[] = [
  { id: "confirm", label: "Confirm Chime" },
  { id: "tradeOpen", label: "Trade Open" },
  { id: "tradeProfit", label: "Trade Profit" },
  { id: "bigProfit", label: "Big Profit" },
  { id: "breakingNews", label: "Breaking News" },
  { id: "alertWarn", label: "Alert Warning" },
];

function PreferencesPage() {
  const { t } = useI18n();
  const prefValues = usePreferencesStore((s) => s.values);
  const setPreference = usePreferencesStore((s) => s.setPreference);
  const resetPreferences = usePreferencesStore((s) => s.resetPreferences);

  const {
    language,
    timezone,
    soundEnabled,
    tickerEnabled,
    tickerSpeed,
    hiddenPageIds,
    setLanguage,
    setTimezone,
    setSoundEnabled,
    setTickerEnabled,
    setTickerSpeed,
    toggleHiddenPage,
  } = useTerminalStore();

  function handleResetAll() {
    resetPreferences();
    setLanguage("ru");
    setTimezone("UTC");
    notify.success(t.common.savedSuccess, "Tangerine / Floating / Bloomberg / UTC");
  }

  return (
    <TerminalPageShell
      title={t.preferences.title}
      subtitle={t.preferences.subtitle}
      badge="SERVER SYNC"
      actions={
        <Button size="sm" variant="outline" onClick={handleResetAll}>
          <RotateCcw className="mr-1.5 size-3.5" />
          {t.preferences.resetDefaults}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.preferences.appearance}</CardTitle>
            <CardDescription>{t.preferences.densityLocked}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pref-preset">{t.preferences.themePreset}</Label>
              <select
                id="pref-preset"
                value={prefValues.theme_preset}
                onChange={(e) => {
                  setPreference("theme_preset", e.target.value as (typeof THEME_PRESET_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {THEME_PRESET_VALUES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-mode">{t.preferences.themeMode}</Label>
              <select
                id="pref-mode"
                value={prefValues.theme_mode}
                onChange={(e) => {
                  setPreference("theme_mode", e.target.value as (typeof THEME_MODE_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {THEME_MODE_VALUES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-font">{t.preferences.font}</Label>
              <select
                id="pref-font"
                value={prefValues.font}
                onChange={(e) => {
                  setPreference("font", e.target.value as (typeof fontKeys)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
              >
                {fontKeys.map((fk) => (
                  <option key={fk} value={fk}>
                    {fontRegistry[fk].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-sidebar">{t.preferences.sidebarStyle}</Label>
              <select
                id="pref-sidebar"
                value={prefValues.sidebar_variant}
                onChange={(e) => {
                  setPreference("sidebar_variant", e.target.value as (typeof SIDEBAR_VARIANT_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {SIDEBAR_VARIANT_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-collapse">{t.preferences.sidebarCollapsible}</Label>
              <select
                id="pref-collapse"
                value={prefValues.sidebar_collapsible}
                onChange={(e) => {
                  setPreference("sidebar_collapsible", e.target.value as (typeof SIDEBAR_COLLAPSIBLE_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {SIDEBAR_COLLAPSIBLE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-layout">{t.preferences.contentLayout}</Label>
              <select
                id="pref-layout"
                value={prefValues.content_layout}
                onChange={(e) => {
                  setPreference("content_layout", e.target.value as (typeof CONTENT_LAYOUT_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {CONTENT_LAYOUT_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pref-navbar">{t.preferences.navbarStyle}</Label>
              <select
                id="pref-navbar"
                value={prefValues.navbar_style}
                onChange={(e) => {
                  setPreference("navbar_style", e.target.value as (typeof NAVBAR_STYLE_VALUES)[number]);
                  notify.success(t.common.savedSuccess, e.target.value);
                }}
                className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {NAVBAR_STYLE_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.preferences.localization}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pref-lang">{t.preferences.language}</Label>
                <select
                  id="pref-lang"
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value as LanguageMode);
                    notify.success(t.common.savedSuccess, e.target.value.toUpperCase());
                  }}
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="ru">Русский (RU)</option>
                  <option value="en">English (EN)</option>
                  <option value="az">Azərbaycan (AZ)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref-tz">{t.preferences.timezone}</Label>
                <select
                  id="pref-tz"
                  value={timezone}
                  onChange={(e) => {
                    setTimezone(e.target.value as TimezoneMode);
                    notify.success(t.common.savedSuccess, e.target.value);
                  }}
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm font-mono"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.preferences.soundAndTicker}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pref-sound"
                    checked={soundEnabled}
                    onCheckedChange={(v) => {
                      const next = Boolean(v);
                      setSoundEnabled(next);
                      notify.info(next ? t.header.soundOn : t.header.soundOff);
                    }}
                  />
                  <Label htmlFor="pref-sound">{t.preferences.soundToggle}</Label>
                </div>
                <Badge variant={soundEnabled ? "default" : "secondary"}>
                  {soundEnabled ? t.common.enabled : t.common.disabled}
                </Badge>
              </div>

              <div className="space-y-1.5">
                <div className="text-muted-foreground text-xs font-medium">{t.preferences.soundPreviewTitle}</div>
                <div className="flex flex-wrap gap-1.5">
                  {SOUND_CUES.map((cue) => (
                    <Button
                      key={cue.id}
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => soundEngine.previewCue(cue.id)}
                    >
                      <Volume2 className="mr-1 size-3 text-emerald-500" />
                      {cue.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pref-ticker"
                    checked={tickerEnabled}
                    onCheckedChange={(v) => {
                      setTickerEnabled(Boolean(v));
                      notify.success(t.common.savedSuccess);
                    }}
                  />
                  <Label htmlFor="pref-ticker">{t.preferences.tickerToggle}</Label>
                </div>
                <select
                  value={tickerSpeed}
                  onChange={(e) => setTickerSpeed(e.target.value as TickerSpeed)}
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs capitalize"
                >
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </select>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.preferences.sidebarVisibility}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {TERMINAL_PAGES.map((page) => {
            const visible = !hiddenPageIds.includes(page.id);
            const title = language === "en" ? page.titleEn : language === "az" ? page.titleAz : page.titleRu;
            return (
              <label
                key={page.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs hover:bg-muted/40"
              >
                <Checkbox checked={visible} onCheckedChange={() => toggleHiddenPage(page.id)} />
                <span className="truncate">{title}</span>
              </label>
            );
          })}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
