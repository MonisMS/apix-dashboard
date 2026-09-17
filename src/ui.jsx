import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { pct } from './format';
import { DOWN, UP } from './chartTokens';

export function Page({ children }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

export function PageHeader({ title, description, badges = [] }) {
  return (
    <div className="mb-1 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-balance text-xl font-semibold tracking-tight">{title}</h1>
        {badges.map((b) => (
          <Badge key={b.label} variant="secondary">
            {b.label}
          </Badge>
        ))}
      </div>
      {description && <p className="max-w-xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

export function Section({ title, description, aside, flush, children, className }) {
  return (
    <div className={cn('rounded-none border border-border bg-card p-6', flush && 'p-0', className)}>
      {(title || description || aside) && (
        <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', flush && 'p-6 pb-2 mb-0')}>
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

export function Note({ color = 'navy', title, icon, children }) {
  return (
    <Alert>
      {icon}
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-[22px] font-semibold leading-tight">{value}</p>
      {hint}
    </div>
  );
}

export function Delta({ value, digits = 2 }) {
  if (value === null || value === undefined) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular text-sm font-semibold" style={{ color: value >= 0 ? UP : DOWN }}>
      {pct(value, digits)}
    </span>
  );
}

export function queryState(...queries) {
  const failed = queries.find((q) => q.isError);
  if (failed) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Could not load this page</AlertTitle>
        <AlertDescription>{failed.error?.message}</AlertDescription>
      </Alert>
    );
  }
  if (queries.some((q) => q.isLoading)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading…</span>
        <Skeleton className="h-[72px] w-full rounded-none" />
        <Skeleton className="h-[280px] w-full rounded-none" />
        <Skeleton className="h-[180px] w-full rounded-none" />
      </div>
    );
  }
  return null;
}
