import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  Link2,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { AppLogo } from "@/components/app-logo";
import { soundEngine } from "@/framework/sound-engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { notify } from "@/components/ui/toast";
import { APP_CONFIG } from "@/config/app-config";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { buildSidebarItems } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { NavMain } from "./nav-main";

export interface CurrentTerminalUser {
  readonly id: string;
  readonly username?: string;
  readonly name: string;
  readonly email: string;
  readonly avatar: string;
  readonly role: string;
}

/**
 * Floating Sidebar with inline "Edit Menu" reordering (#1) and Custom Links (#2),
 * persisted on the server via user.preferences.
 */
export function AppSidebar({
  currentUser: _currentUser,
  ...props
}: React.ComponentProps<typeof Sidebar> & { readonly currentUser: CurrentTerminalUser }) {
  const { t } = useI18n();
  const hiddenPageIds = useTerminalStore((s) => s.hiddenPageIds);
  const sidebarOrder = useTerminalStore((s) => s.sidebarOrder);
  const setSidebarOrder = useTerminalStore((s) => s.setSidebarOrder);
  const customMenuLinks = useTerminalStore((s) => s.customMenuLinks);
  const addCustomMenuLink = useTerminalStore((s) => s.addCustomMenuLink);
  const removeCustomMenuLink = useTerminalStore((s) => s.removeCustomMenuLink);

  const [editMode, setEditMode] = useState(false);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [soundMuted, setSoundMuted] = useState(() => soundEngine.getConfig().muted);
  const [isLightTheme, setIsLightTheme] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.getAttribute("data-theme") === "light" : false,
  );

  useEffect(() => {
    const unsubSound = soundEngine.subscribe(() => setSoundMuted(soundEngine.getConfig().muted));
    const syncTheme = () => setIsLightTheme(document.documentElement.getAttribute("data-theme") === "light");
    const obs = new MutationObserver(syncTheme);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => {
      unsubSound();
      obs.disconnect();
    };
  }, []);

  function toggleTheme() {
    const nextLight = !isLightTheme;
    const root = document.documentElement;
    if (nextLight) {
      root.setAttribute("data-theme", "light");
      root.classList.remove("dark");
      root.classList.add("light");
    } else {
      root.setAttribute("data-theme", "dark");
      root.classList.remove("light");
      root.classList.add("dark");
    }
    setIsLightTheme(nextLight);
  }

  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : (props.variant ?? "floating");
  const collapsible = isSynced ? sidebarCollapsible : (props.collapsible ?? "icon");
  const items = useMemo(() => buildSidebarItems(t, hiddenPageIds, sidebarOrder), [t, hiddenPageIds, sidebarOrder]);

  function moveGroup(index: number, delta: -1 | 1) {
    const ids = items.map((g) => String(g.id));
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setSidebarOrder(ids);
  }

  function handleAddLink(e: FormEvent) {
    e.preventDefault();
    const title = linkTitle.trim();
    const url = linkUrl.trim();
    if (!title || !url) return;
    const isExternal = /^https?:\/\//i.test(url);
    addCustomMenuLink({ title, url, newTab: isExternal });
    setLinkTitle("");
    setLinkUrl("");
    notify.success(t.common.savedSuccess, title);
  }

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link to="/dashboard/home" />}>
              <AppLogo className="size-5 shrink-0" />
              <span className="text-sm font-semibold tracking-tight">{APP_CONFIG.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {editMode ? (
          <div className="space-y-2 px-2 py-1">
            <div className="text-muted-foreground px-1 text-[10px] font-semibold uppercase tracking-wider">
              Reorder sections
            </div>
            {items.map((group, idx) => (
              <div
                key={group.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-xs"
              >
                <span className="truncate font-medium">{group.label || group.id}</span>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={idx === 0}
                    onClick={() => moveGroup(idx, -1)}
                    aria-label="Move up"
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={idx === items.length - 1}
                    onClick={() => moveGroup(idx, 1)}
                    aria-label="Move down"
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="border-t border-border/60 pt-2">
              <div className="text-muted-foreground mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider">
                Custom links
              </div>
              <form onSubmit={handleAddLink} className="space-y-1.5">
                <Input
                  className="h-7 text-xs"
                  placeholder="Title (e.g. TradingView)"
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                />
                <Input
                  className="h-7 font-mono text-xs"
                  placeholder="https://... or /dashboard/..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
                <Button type="submit" size="xs" variant="secondary" className="w-full gap-1">
                  <Plus className="size-3" />
                  Add link
                </Button>
              </form>
              {customMenuLinks.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {customMenuLinks.map((lnk) => (
                    <div
                      key={lnk.id}
                      className="flex items-center justify-between gap-1 rounded border border-border/50 px-2 py-1 text-xs"
                    >
                      <span className="truncate">{lnk.title}</span>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => removeCustomMenuLink(lnk.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <NavMain items={items} />
            {customMenuLinks.length > 0 ? (
              <SidebarGroup>
                <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
                  Links
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {customMenuLinks.map((lnk) => {
                      const isExternal = lnk.newTab || /^https?:\/\//i.test(lnk.url);
                      return (
                        <SidebarMenuItem key={lnk.id}>
                          <SidebarMenuButton
                            tooltip={lnk.title}
                            render={
                              isExternal ? (
                                <a href={lnk.url} target="_blank" rel="noreferrer noopener" />
                              ) : (
                                <Link to={lnk.url as never} />
                              )
                            }
                          >
                            {isExternal ? <ExternalLink className="size-4" /> : <Link2 className="size-4" />}
                            <span>{lnk.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ) : null}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 p-2">
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={isLightTheme ? "Тёмная тема" : "Светлая тема"}
              onClick={toggleTheme}
            >
              {isLightTheme ? <Moon className="size-4" /> : <Sun className="size-4" />}
              <span>{isLightTheme ? "Тёмная тема" : "Светлая тема"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={soundMuted ? "Включить звук (Unmute)" : "Выключить звук (Mute)"}
              onClick={() => setSoundMuted(soundEngine.toggleMute())}
            >
              {soundMuted ? (
                <VolumeX className="size-4 text-[var(--text-muted)]" />
              ) : (
                <Volume2 className="size-4 text-[var(--bull)]" />
              )}
              <span>{soundMuted ? "Звук выключен" : "Звук включён"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-1 group-data-[collapsible=icon]:hidden">
          <Button
            type="button"
            size="xs"
            variant={editMode ? "default" : "ghost"}
            className="w-full justify-start gap-1.5 text-xs"
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editMode ? t.common.save : "Edit menu"}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
