import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("ht-shimmer-bar rounded-md bg-muted/75", className)}
      {...props}
    />
  );
}

function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="space-y-2.5 rounded-xl border border-border/60 bg-card p-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card p-3">
      <div className="grid gap-3 border-b border-border/50 pb-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="h-3.5 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3 py-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-6 w-14" />
        </div>
      </div>
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      </div>
      <CardGridSkeleton count={4} />
      <TableSkeleton rows={5} cols={4} />
    </div>
  );
}

export { CardGridSkeleton, ChartSkeleton, PageSkeleton, Skeleton, TableSkeleton };
