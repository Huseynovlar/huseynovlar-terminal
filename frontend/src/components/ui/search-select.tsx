import * as React from "react";

import { cn } from "cn";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { filterOptions, moveHighlight, type SelectOption } from "@/lib/select-options";

type ChangeLike = { target: { value: string; id?: string; name?: string }; currentTarget: { value: string } };

export interface SearchSelectProps {
  value?: string;
  onChange?: (event: ChangeLike) => void;
  onValueChange?: (value: string) => void;
  options?: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
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
 * Custom searchable combobox. Replaces every native <select> in the app.
 * Accepts <option> children and a select-style onChange(event) so call sites stay unchanged.
 */
export function SearchSelect({
  value = "",
  onChange,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "—",
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
  const listRef = React.useRef<HTMLUListElement>(null);

  const all = React.useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const filtered = React.useMemo(() => filterOptions(all, query), [all, query]);
  const selected = all.find((o) => o.value === String(value));

  function commit(opt: SelectOption) {
    if (opt.disabled) return;
    onValueChange?.(opt.value);
    onChange?.({ target: { value: opt.value, id, name }, currentTarget: { value: opt.value } });
    setOpen(false);
  }

  React.useEffect(() => {
    if (open) {
      setQuery("");
      const idx = all.findIndex((o) => o.value === String(value));
      setActive(Math.max(idx, 0));
    }
  }, [open, all, value]);

  React.useEffect(() => {
    setActive(filtered.length > 0 ? Math.max(moveHighlight(filtered, -1, 1), 0) : -1);
  }, [filtered.length, query]);

  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => moveHighlight(filtered, a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => moveHighlight(filtered, a, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) commit(opt);
    }
  }

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
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : (placeholder ?? "")}
        </span>
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-48 gap-1.5 p-1.5">
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            // biome-ignore lint/a11y/noAutofocus: search box must take focus when the list opens
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={searchPlaceholder}
            className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-7 text-xs outline-none focus-visible:border-ring"
          />
        </div>
        <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="text-muted-foreground px-2 py-2 text-center text-xs">{emptyText}</li>
          ) : (
            filtered.map((opt, idx) => (
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
        </ul>
      </PopoverContent>
    </Popover>
  );
}
