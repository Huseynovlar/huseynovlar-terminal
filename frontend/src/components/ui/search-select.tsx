import * as React from "react";

import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, Loader2Icon, SearchIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterOptions, moveHighlight, type SelectOption } from "@/lib/select-options";

type ChangeLike = { target: { value: string; id?: string; name?: string }; currentTarget: { value: string } };

const LOCAL_PAGE_STEP = 60;

export interface SearchSelectProps {
  value?: string;
  selectedLabel?: string;
  onChange?: (event: ChangeLike) => void;
  onValueChange?: (value: string) => void;
  options?: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Optional server-side search & infinite-scroll pagination hooks */
  onSearchQueryChange?: (query: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  totalCount?: number;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children?: React.ReactNode;
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

/** Flatten <option>/<optgroup>/fragments (drop-in for native <select> children) into option records. */
export function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  const visit = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean };
      if (child.type === "option") {
        const label = textOf(props.children);
        out.push({ value: props.value !== undefined ? String(props.value) : label, label, disabled: props.disabled });
      } else {
        visit(props.children);
      }
    });
  };
  visit(children);
  return out;
}

/**
 * Custom searchable combobox with automatic scroll pagination (both client-side and server-side).
 * Replaces every native <select> in the app so even thousands of options render smoothly and load on scroll.
 */
export function SearchSelect({
  value = "",
  selectedLabel,
  onChange,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Поиск…",
  emptyText = "Ничего не найдено",
  onSearchQueryChange,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
  totalCount,
  id,
  name,
  disabled,
  className,
  title,
  children,
  ...rest
}: SearchSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [visibleLimit, setVisibleLimit] = React.useState(LOCAL_PAGE_STEP);
  const listRef = React.useRef<HTMLUListElement>(null);

  const isAsyncServer = Boolean(onSearchQueryChange);
  const all = React.useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const filtered = React.useMemo(
    () => (isAsyncServer ? all : filterOptions(all, query)),
    [all, isAsyncServer, query],
  );
  const visibleItems = React.useMemo(
    () => (isAsyncServer ? filtered : filtered.slice(0, visibleLimit)),
    [filtered, isAsyncServer, visibleLimit],
  );
  const hasLocalMore = !isAsyncServer && visibleLimit < filtered.length;
  const selected = all.find((o) => o.value === String(value));
  const triggerText = selected ? selected.label : selectedLabel || (value ? String(value) : "");

  function commit(opt: SelectOption) {
    if (opt.disabled) return;
    onValueChange?.(opt.value);
    onChange?.({ target: { value: opt.value, id, name }, currentTarget: { value: opt.value } });
    setOpen(false);
  }

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setVisibleLimit(LOCAL_PAGE_STEP);
      onSearchQueryChange?.("");
      const idx = all.findIndex((o) => o.value === String(value));
      setActive(Math.max(idx, 0));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setVisibleLimit(LOCAL_PAGE_STEP);
    setActive(visibleItems.length > 0 ? Math.max(moveHighlight(visibleItems, -1, 1), 0) : -1);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function handleQueryInput(nextQ: string) {
    setQuery(nextQ);
    onSearchQueryChange?.(nextQ);
  }

  function handleScroll(e: React.UIEvent<HTMLUListElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 48) return;
    if (hasLocalMore) {
      setVisibleLimit((prev) => Math.min(filtered.length, prev + LOCAL_PAGE_STEP));
    } else if (isAsyncServer && hasMore && !loadingMore) {
      onLoadMore?.();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => {
        const next = moveHighlight(visibleItems, a, 1);
        if (next >= visibleItems.length - 3) {
          if (hasLocalMore) setVisibleLimit((p) => Math.min(filtered.length, p + LOCAL_PAGE_STEP));
          else if (isAsyncServer && hasMore && !loadingMore) onLoadMore?.();
        }
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => moveHighlight(visibleItems, a, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = visibleItems[active];
      if (opt) commit(opt);
    }
  }

  const effectiveTotal = totalCount ?? filtered.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        title={title}
        aria-label={rest["aria-label"]}
        data-slot="search-select"
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left text-xs outline-none transition-colors hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !triggerText && "text-muted-foreground")}>
          {triggerText || (placeholder ?? "")}
        </span>
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-56 gap-1.5 p-1.5">
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            // biome-ignore lint/a11y/noAutofocus: search box must take focus when the list opens
            autoFocus
            value={query}
            onChange={(e) => handleQueryInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-xs outline-none focus-visible:border-ring"
          />
        </div>
        <ul ref={listRef} role="listbox" onScroll={handleScroll} className="max-h-64 overflow-y-auto">
          {visibleItems.length === 0 ? (
            <li className="text-muted-foreground px-2 py-3 text-center text-xs">
              {loadingMore ? "Загрузка…" : emptyText}
            </li>
          ) : (
            visibleItems.map((opt, idx) => (
              <li
                key={`${opt.value}-${idx}`}
                role="option"
                aria-selected={opt.value === String(value)}
                aria-disabled={opt.disabled}
                data-index={idx}
                onMouseEnter={() => setActive(idx)}
                onClick={() => commit(opt)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-xs",
                  idx === active && "bg-accent text-accent-foreground",
                  opt.disabled && "pointer-events-none opacity-50",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {opt.value === String(value) ? <CheckIcon className="size-3.5 shrink-0" /> : null}
              </li>
            ))
          )}
          {loadingMore ? (
            <li className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Подгрузка списка…
            </li>
          ) : hasLocalMore || hasMore ? (
            <li
              onClick={() => {
                if (hasLocalMore) setVisibleLimit((p) => Math.min(filtered.length, p + LOCAL_PAGE_STEP));
                else onLoadMore?.();
              }}
              className="cursor-pointer border-t border-border/40 px-2 py-1.5 text-center font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              Показано {visibleItems.length} из {effectiveTotal} • прокрутите или нажмите для подгрузки
            </li>
          ) : effectiveTotal > LOCAL_PAGE_STEP ? (
            <li className="border-t border-border/40 px-2 py-1 text-center font-mono text-[10px] text-muted-foreground">
              Загружены все ({visibleItems.length})
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
