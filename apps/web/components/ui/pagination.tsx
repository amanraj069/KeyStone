"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  className?: string;
}

/** Prev/next arrows plus numbered pages, collapsing the middle behind an ellipsis once there are too many to show. */
export function Pagination({ page, pageCount, onPage, className }: PaginationProps) {
  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-1", className)}>
      <Button variant="outline" size="icon-sm" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      {pageNumbers(page, pageCount).map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1.5 text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <Button
            key={p}
            variant={p === page ? "default" : "ghost"}
            size="icon-sm"
            onClick={() => onPage(p)}
            aria-current={p === page ? "page" : undefined}
            className="text-xs tabular-nums"
          >
            {p}
          </Button>
        ),
      )}
      <Button variant="outline" size="icon-sm" disabled={page === pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </nav>
  );
}

/** First, last, current ± 1 always shown; everything else collapses behind an ellipsis. */
function pageNumbers(page: number, pageCount: number): (number | "…")[] {
  const keep = new Set([1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push("…");
    result.push(p);
  });
  return result;
}
