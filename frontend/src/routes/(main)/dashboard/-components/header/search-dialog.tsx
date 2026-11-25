import * as React from "react";

import { useNavigate } from "@tanstack/react-router";

import { Search } from "lucide-react";

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
import { useI18n } from "@/framework/i18n";
import { useTerminalStore } from "@/framework/terminal-store";
import { buildSidebarItems, type NavMainItem } from "@/navigation/sidebar/sidebar-items";

type SearchItem = {
  id: string;
  group: string;
  label: string;
  url: string;
  icon?: NavMainItem["icon"];
  disabled?: boolean;
  newTab?: boolean;
};

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
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const navigate = useNavigate();

  const searchItems = React.useMemo<SearchItem[]>(() => {
    const navGroups = buildSidebarItems(t, hiddenPageIds);
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
  }, [t, hiddenPageIds]);

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

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) setQuery("");
  };

  const handleSelect = (item: SearchItem) => {
    if (item.disabled) return;
    handleOpenChange(false);
    if (item.newTab) {
      window.open(item.url, "_blank", "noopener,noreferrer");
    } else {
      void navigate({ to: item.url as never });
    }
  };

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
        <Command>
          <CommandInput placeholder={t.header.searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{t.common.noData}</CommandEmpty>
            {groupBy(searchItems).map(({ group, items: groupItems }, index) => (
              <React.Fragment key={group}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={group}>
                  {groupItems.map((item) => (
                    <CommandItem
                      disabled={item.disabled}
                      key={`${group}-${item.id}`}
                      value={`${item.group} ${item.label}`}
                      onSelect={() => handleSelect(item)}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {item.icon && <item.icon />}
                        <span className="truncate">{item.label}</span>
                      </span>
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
