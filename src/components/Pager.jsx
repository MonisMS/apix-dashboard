'use client';

import { Button } from '@/components/ui/button';

/**
 * Page controls for a long table.
 *
 * The tariffs table used `markets.slice(0, 80)` against 118 markets, so 38
 * were silently dropped while the page header still claimed 118 -- the kind
 * of quiet truncation that makes a reader distrust everything else on the
 * page. Paging shows all of them and says which ones are on screen.
 */
export function Pager({ page, pageSize, total, onPage, unit = 'rows' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3">
      <span className="text-xs text-muted-foreground">
        Showing <span className="tabular font-medium text-foreground">{from}–{to}</span> of{' '}
        <span className="tabular font-medium text-foreground">{total}</span> {unit}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
