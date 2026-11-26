import * as React from "react";

import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { apiRequest } from "@/framework/api-client";
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { buildSidebarItems, type NavMainItem } from "@/navigation/sidebar/sidebar-items";

type SearchItem = {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  url: string;
  icon?: NavMainItem["icon"];
  disabled?: boolean;
  newTab?: boolean;
};

interface RemoteSearchResult {
  type: string;
  group: string;
  id: string;
  label: string;
  sublabel?: string;
  url: string;
}

function groupBy(items: SearchItem[]) {
  const groups = [...new Set(items.map((item) => item.group))];
  return groups.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  }));
}

export function SearchDialog() {
  const { t } = useI18n();
  const hiddenPageIds = useTerminalStore((s) => s.hiddenPageIds);
  const sidebarOrder = useTerminalStore((s) => s.sidebarOrder);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [remoteItems, setRemoteItems] = React.useState<SearchItem[]>([]);
  const [loadingRemote, setLoadingRemote] = React.useState(false);
  const navigate = useNavigate();

  const pageItems = React.useMemo<SearchItem[]>(() => {
    const navGroups = buildSidebarItems(t, hiddenPageIds, sidebarOrder);
    return navGroups.flatMap((group) =>
      group.items.flatMap((item) => {
        if (item.subItems) {
          return item.subItems.map((sub) => ({
            id: sub.id,
            group: group.label ?? "Terminal",
            label: sub.title,
            url: sub.url,
            icon: item.icon,
            disabled: sub.disabled,
            newTab: sub.newTab,
          }));
        }
        return [
          {
            id: item.id,
            group: group.label ?? "Terminal",
            label: item.title,
            url: item.url,
            icon: item.icon,
            disabled: item.disabled,
            newTab: item.newTab,
          },
        ];
      }),
    );
  }, [t, hiddenPageIds, sidebarOrder]);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "j") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounced global backend search across assets, hubs, accounts, robots, wiki, news, users (#42)
  React.useEffect(() => {
    const q = query.trim();
    if (!open || !q) {
      setRemoteItems([]);
      setLoadingRemote(false);
      return;
    }
    let cancelled = false;
    setLoadingRemote(true);
    const timer = window.setTimeout(() => {
      void apiRequest<{ results?: RemoteSearchResult[] }>(`/search?q=${encodeURIComponent(q)}&limit=6`)
        .then((res) => {
          if (cancelled) return;
          const rows = Array.isArray(res?.results) ? res.results : [];
          setRemoteItems(
            rows.map((r) => ({
              id: `${r.type}:${r.id}`,
              group: r.group,
              label: r.label,
              sublabel: r.sublabel,
              url: r.url,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setRemoteItems([]);
        })
        .finally(() => {
          if (!cancelled) setLoadingRemote(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      setQuery("");
      setRemoteItems([]);
    }
  };

  const handleSelect = (item: SearchItem) => {
    if (item.disabled) return;
    handleOpenChange(false);
    if (item.newTab || /^https?:\/\//i.test(item.url)) {
      window.open(item.url, "_blank", "noopener,noreferrer");
    } else {
      void navigate({ to: item.url as never });
    }
  };

  const filteredPages = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pageItems;
    return pageItems.filter(
      (item) => item.label.toLowerCase().includes(q) || item.group.toLowerCase().includes(q),
    );
  }, [pageItems, query]);

  const combinedGroups = React.useMemo(
    () => groupBy([...remoteItems, ...filteredPages]),
    [remoteItems, filteredPages],
  );

  return (
    <>
      <Button
        onClick={() => handleOpenChange(true)}
        variant="link"
        className="text-muted-foreground px-0! font-normal hover:no-underline"
      >
        <Search data-icon="inline-start" />
        {t.header.searchTrigger}
        <kbd className="bg-muted inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium select-none">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <Command shouldFilter={false}>
          <CommandInput placeholder={t.header.searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            {combinedGroups.length === 0 ? (
              <CommandEmpty>{loadingRemote ? t.common.loading : t.common.noData}</CommandEmpty>
            ) : null}
            {combinedGroups.map(({ group, items: groupItems }, index) => (
              <React.Fragment key={group}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group}>
                  {groupItems.map((item) => (
                    <CommandItem
                      disabled={item.disabled}
                      key={`${group}-${item.id}`}
                      value={`${item.group} ${item.label} ${item.sublabel ?? ""}`}
                      onSelect={() => handleSelect(item)}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {item.icon ? <item.icon className="size-4 shrink-0" /> : <ArrowUpRight className="size-3.5 shrink-0 opacity-60" />}
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.sublabel ? (
                        <span className="text-muted-foreground ml-2 shrink-0 font-mono text-[10px]">
                          {item.sublabel}
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
