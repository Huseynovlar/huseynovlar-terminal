import { useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, Volume2 } from "lucide-react";

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
import { buildSidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { SearchSelect } from "@/components/ui/search-select";

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
    sidebarOrder,
    setSidebarOrder,
  } = useTerminalStore();

  const [dragId, setDragId] = useState<string | null>(null);
  const orderedGroups = useMemo(() => buildSidebarItems(t, [], sidebarOrder), [t, sidebarOrder]);

  /** Move `id` to the slot of `targetId` (or by delta) inside its group, then persist the full flat order on the server. */
  function reorder(id: string, target: { delta: number } | { beforeId: string }) {
    const group = orderedGroups.find((g) => g.items.some((i) => i.id === id));
    if (!group) return;
    const ids = group.items.map((i) => i.id);
    const from = ids.indexOf(id);
    let to: number;
    if ("delta" in target) {
      to = from + target.delta;
    } else {
      to = ids.indexOf(target.beforeId);
      if (to < 0) return;
    }
    if (to < 0 || to >= ids.length || to === from) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const flat = orderedGroups.flatMap((g) => (g.id === group.id ? ids : g.items.map((i) => i.id)));
    setSidebarOrder(flat);
  }

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
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-mode">{t.preferences.themeMode}</Label>
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-font">{t.preferences.font}</Label>
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-sidebar">{t.preferences.sidebarStyle}</Label>
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-collapse">{t.preferences.sidebarCollapsible}</Label>
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pref-layout">{t.preferences.contentLayout}</Label>
              <SearchSelect
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
              </SearchSelect>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pref-navbar">{t.preferences.navbarStyle}</Label>
              <SearchSelect
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
              </SearchSelect>
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
                <SearchSelect
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
                </SearchSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref-tz">{t.preferences.timezone}</Label>
                <SearchSelect
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
                </SearchSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pref-time-format">Time Format (24h / 12h)</Label>
                <SearchSelect
                  id="pref-time-format"
                  value={useTerminalStore.getState().timeFormat}
                  onChange={(e) => {
                    const fmt = e.target.value === "12h" ? "12h" : "24h";
                    useTerminalStore.getState().setTimeFormat(fmt);
                    notify.success(t.common.savedSuccess, fmt.toUpperCase());
                  }}
                  className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm font-mono"
                >
                  <option value="24h">24h (14:30:00 UTC)</option>
                  <option value="12h">12h (02:30:00 PM)</option>
                </SearchSelect>
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
                <SearchSelect
                  value={tickerSpeed}
                  onChange={(e) => setTickerSpeed(e.target.value as TickerSpeed)}
                  className="border-input bg-background h-8 rounded-md border px-2 text-xs capitalize"
                >
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </SearchSelect>
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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.preferences.sidebarOrder}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedGroups.map((group) => (
            <div key={group.id} className="space-y-1.5">
              <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{group.label}</div>
              <ul className="space-y-1">
                {group.items.map((item, idx) => (
                  <li
                    key={item.id}
                    draggable
                    onDragStart={() => setDragId(item.id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragId && dragId !== item.id) reorder(dragId, { beforeId: item.id });
                      setDragId(null);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2 py-1.5 text-xs"
                  >
                    <GripVertical className="text-muted-foreground size-3.5 cursor-grab" />
                    <span className="flex-1 truncate">{item.title}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={idx === 0}
                      aria-label="up"
                      onClick={() => reorder(item.id, { delta: -1 })}
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={idx === group.items.length - 1}
                      aria-label="down"
                      onClick={() => reorder(item.id, { delta: 1 })}
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>
    </TerminalPageShell>
  );
}
