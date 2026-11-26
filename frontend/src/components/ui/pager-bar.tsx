import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export const DEFAULT_PAGE_SIZE = 25;

interface PagerBarProps {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onPage: (page: number) => void;
}

/** Simple prev/next pager; page is 1-based. */
export function PagerBar({ page, pageSize, total, onPage }: PagerBarProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="text-muted-foreground flex items-center justify-between px-3 py-2 text-xs tabular-nums">
      <span>
        {from}–{to} / {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button size="xs" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
