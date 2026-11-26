export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Case-insensitive substring match on label or value; empty query returns all options. */
export function filterOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
}

/** Next enabled index when moving the keyboard highlight; wraps around, returns -1 when nothing is selectable. */
export function moveHighlight(options: readonly SelectOption[], current: number, delta: 1 | -1): number {
  const n = options.length;
  if (n === 0) return -1;
  let idx = current;
  for (let step = 0; step < n; step++) {
    idx = (idx + delta + n) % n;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}
