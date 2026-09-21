/**
 * Drop-in replacements for the subset of @mantine/core the 14 pre-existing
 * analytical pages import. Built on Tailwind + our CSS-variable tokens, not
 * Mantine -- this is what let those pages keep their exact JSX during the
 * shadcn/ui migration (see the rebuild plan, "restyle only if it breaks").
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { boxStyle, resolveColor, resolveSoftBg, splitProps } from './style';

const GAP = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28 };
function gapPx(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return `${v}px`;
  return `${GAP[v] ?? 12}px`;
}

export function Stack({ gap = 'md', children, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <div
      className={cn('flex flex-col', className)}
      style={{ gap: gapPx(gap), ...s, ...style }}
      {...r}
    >
      {children}
    </div>
  );
}

export function Group({
  gap = 'md', justify, align = 'center', wrap = 'wrap', children, className, style, ...rest
}) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <div
      className={cn('flex', className)}
      style={{
        gap: gapPx(gap),
        justifyContent: justify,
        alignItems: align,
        flexWrap: wrap === 'nowrap' ? 'nowrap' : 'wrap',
        ...s,
        ...style,
      }}
      {...r}
    >
      {children}
    </div>
  );
}

export function SimpleGrid({ cols, spacing = 'md', children, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  // Tailwind's responsive grid-cols-N utilities only exist for the class names
  // literally present in source, so an arbitrary { sm: 4 } (or any count this
  // file doesn't special-case) silently produced no responsive class at all
  // and fell through to a single column at every width. A CSS auto-fit grid
  // sidesteps that: it reflows to however many columns fit >= the narrowest
  // requested count's implied width, with no breakpoint enumeration needed.
  const maxCols = typeof cols === 'object'
    ? Math.max(cols.base ?? 1, cols.sm ?? 1, cols.md ?? 1, cols.lg ?? 1)
    : (cols ?? 1);
  const minWidth = Math.max(140, Math.floor(720 / maxCols));
  return (
    <div
      className={cn('grid', className)}
      style={{
        gap: gapPx(spacing),
        gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
        ...s,
        ...style,
      }}
      {...r}
    >
      {children}
    </div>
  );
}

export function Divider({ orientation = 'horizontal', visibleFrom, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  const hideClass = visibleFrom === 'sm' ? 'hidden sm:block' : '';
  return orientation === 'vertical' ? (
    <div className={cn('w-px self-stretch bg-border', hideClass, className)} style={{ ...s, ...style }} {...r} />
  ) : (
    <div className={cn('h-px w-full bg-border', hideClass, className)} style={{ ...s, ...style }} {...r} />
  );
}

const TITLE_SIZE = { 1: '1.375rem', 2: '0.9375rem', 3: '1.0625rem', 4: '0.9375rem' };
export function Title({ order = 1, children, className, style, ...rest }) {
  const Tag = `h${Math.min(order, 6)}`;
  const { style: s, rest: r } = splitProps(rest);
  return (
    <Tag
      className={cn('font-semibold tracking-tight text-balance', className)}
      style={{ fontSize: TITLE_SIZE[order] ?? '1rem', lineHeight: 1.3, ...s, ...style }}
      {...r}
    >
      {children}
    </Tag>
  );
}

export function Text({
  size = 'sm', span, component: Component, truncate, children, className, style, ...rest
}) {
  const Tag = Component ?? (span ? 'span' : 'p');
  const { style: s, rest: r } = splitProps(rest);
  return (
    <Tag
      className={cn(truncate && 'truncate', className)}
      style={{ fontSize: undefined, ...boxStyle({ fz: size }), ...s, ...style }}
      {...r}
    >
      {children}
    </Tag>
  );
}

export function Anchor({ children, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <a className={cn('text-primary underline-offset-4 hover:underline', className)} style={{ ...s, ...style }} {...r}>
      {children}
    </a>
  );
}

export function Code({ block, children, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  const Tag = block ? 'pre' : 'code';
  return (
    <Tag
      className={cn(
        'font-mono text-xs rounded-none bg-muted text-foreground',
        block ? 'block overflow-x-auto p-3 whitespace-pre-wrap' : 'px-1.5 py-0.5',
        className,
      )}
      style={{ ...s, ...style }}
      {...r}
    >
      {children}
    </Tag>
  );
}

export function VisuallyHidden({ children }) {
  return <span className="sr-only">{children}</span>;
}

export function Badge({
  children, color = 'gray', variant = 'light', size = 'sm', leftSection, className, style, ...rest
}) {
  const { style: s, rest: r } = splitProps(rest);
  const soft = { color: resolveColor(color), background: resolveSoftBg(color) };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5',
        className,
      )}
      style={{ ...soft, ...s, ...style }}
      {...r}
    >
      {leftSection}
      {children}
    </span>
  );
}

export function Alert({ color = 'navy', title, icon, children, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  const soft = color === 'navy'
    ? { background: 'var(--accent)', color: 'var(--accent-foreground)' }
    : { background: resolveSoftBg(color), color: 'var(--foreground)' };
  return (
    <div
      role="alert"
      className={cn('rounded-[10px] border border-border p-4', className)}
      style={{ ...soft, ...s, ...style }}
      {...r}
    >
      <div className="flex gap-2">
        {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
        <div className="min-w-0 flex-1">
          {title && <div className="mb-1 text-sm font-semibold">{title}</div>}
          {typeof children === 'string' ? <p className="text-sm">{children}</p> : children}
        </div>
      </div>
    </div>
  );
}

export function Paper({ children, p = 'lg', className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <div
      className={cn('rounded-[10px] border border-border bg-card text-card-foreground overflow-hidden', className)}
      style={{ padding: p === 0 ? 0 : undefined, ...boxStyle({ p: p === 0 ? 0 : 'lg' }), ...s, ...style }}
      {...r}
    >
      {children}
    </div>
  );
}

export function Card({ children, p = 'lg', withBorder = true, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <div
      className={cn('rounded-[10px] bg-card text-card-foreground', withBorder && 'border border-border', className)}
      style={{ ...boxStyle({ p }), ...s, ...style }}
      {...r}
    >
      {children}
    </div>
  );
}

export function ScrollArea({ children, className, style, ...rest }) {
  return (
    <div className={cn('overflow-auto', className)} style={style} {...rest}>
      {children}
    </div>
  );
}

export function Skeleton({ height = 20, className, style }) {
  return (
    <div
      className={cn('animate-pulse rounded-[10px] bg-muted', className)}
      style={{ height, ...style }}
    />
  );
}

export function Button({ children, variant = 'filled', size, onClick, className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  const isSubtle = variant === 'subtle';
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center rounded-none text-sm font-medium',
        'transition-[background-color,color,transform] duration-150 active:scale-[0.97]',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        size === 'compact-sm' ? 'h-7 px-2 text-xs' : 'h-9 px-3',
        isSubtle
          ? 'text-primary hover:bg-accent'
          : 'bg-primary text-primary-foreground hover:opacity-90',
        className,
      )}
      style={{ ...s, ...style }}
      {...r}
    >
      {children}
    </button>
  );
}

export function List({ children, size = 'sm', className, style, ...rest }) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    <ul className={cn('list-disc pl-5', className)} style={{ ...boxStyle({ fz: size }), ...s, ...style }} {...r}>
      {children}
    </ul>
  );
}
List.Item = function ListItem({ children }) {
  return <li className="text-sm leading-relaxed">{children}</li>;
};

export function Progress({ children }) {
  const child = React.Children.count(children) === 1 ? React.Children.only(children) : null;
  const value = child?.props?.value;
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={typeof value === 'number' ? Math.round(value) : undefined}
    >
      {children}
    </div>
  );
}
Progress.Root = Progress;
Progress.Section = function ProgressSection({ value, color = 'teal' }) {
  return (
    <div style={{ width: `${value || 0}%`, background: resolveColor(color) }} />
  );
};

export function Tooltip({ label, children }) {
  return (
    <span title={typeof label === 'string' ? label : undefined} className="inline-block">
      {children}
    </span>
  );
}

export function SegmentedControl({ value, onChange, data = [], size, className, ...rest }) {
  return (
    <div
      className={cn('inline-flex rounded-full border border-border bg-muted p-0.5 text-xs', className)}
      role="group"
      {...rest}
    >
      {data.map((opt) => {
        const optValue = typeof opt === 'string' ? opt : opt.value;
        const optLabel = typeof opt === 'string' ? opt : opt.label;
        const active = optValue === value;
        return (
          <button
            key={optValue}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(optValue)}
            className={cn(
              'rounded-full px-2.5 py-1 font-medium transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              active ? 'bg-card text-foreground font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {optLabel}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Table ---- */

export function Table({
  children, striped, layout, className, style,
  // Consumed, not forwarded: these are Mantine spacing props with no effect
  // here (Th/Td carry their own padding), and spreading them onto <table>
  // made React warn "does not recognize the verticalSpacing prop" on every
  // page that renders a table.
  verticalSpacing, horizontalSpacing, variant, withTableBorder,
  ...rest
}) {
  const { style: s, rest: r } = splitProps(rest);
  return (
    // Every table scrolls horizontally WITHIN its own card, never the page.
    // The forced minWidth wrappers were removed because they made desktop
    // tables scroll sideways for no reason; without any wrapper, though, a
    // table wider than a phone was simply clipped by the card's
    // overflow-x:hidden, so on /carriers the day-on-day column sat at 728px
    // in a 376px viewport with no way to reach it. An auto wrapper with no
    // min-width gives both: nothing to scroll on a desktop, a scrollable
    // table on a phone.
    <div className="w-full max-w-full overflow-x-auto">
      <table
        className={cn('w-full border-collapse text-sm', striped && 'apix-table-striped', className)}
        style={{ tableLayout: layout, ...s, ...style }}
        {...r}
      >
        {children}
      </table>
    </div>
  );
}
Table.Thead = function Thead({ children }) {
  return <thead className="border-b border-border text-left">{children}</thead>;
};
Table.Tbody = function Tbody({ children }) {
  return <tbody>{children}</tbody>;
};
Table.Tr = function Tr({ children, onClick, style, bg, ...rest }) {
  return (
    <tr
      onClick={onClick}
      style={{ background: bg ? resolveSoftBg(bg) : undefined, ...style }}
      className={cn('border-b border-border last:border-0', onClick && 'cursor-pointer hover:bg-accent/50')}
      {...rest}
    >
      {children}
    </tr>
  );
};
Table.Th = function Th({ children, ta, w, className, style, ...rest }) {
  return (
    <th
      className={cn(
        'px-3 py-2 first:pl-6 last:pr-6 font-mono text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
        ta === 'right' && 'text-right',
        className,
      )}
      style={{ width: typeof w === 'number' ? `${w}px` : w, ...style }}
      {...rest}
    >
      {children}
    </th>
  );
};
Table.Td = function Td({ children, ta, className, style, ...rest }) {
  return (
    <td
      className={cn('px-3 py-2 first:pl-6 last:pr-6', ta === 'right' && 'text-right', className)}
      style={style}
      {...rest}
    >
      {children}
    </td>
  );
};
Table.ScrollContainer = function ScrollContainer({ minWidth, children }) {
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>{children}</div>
    </div>
  );
};

/* ---- Tabs ---- */

const TabsCtx = React.createContext(null);
export function Tabs({ defaultValue, children }) {
  const [value, setValue] = React.useState(defaultValue);
  return <TabsCtx.Provider value={{ value, setValue }}>{children}</TabsCtx.Provider>;
}
Tabs.List = function TabsList({ children, mb, className, ...rest }) {
  // Forwards the remaining props like every other wrapper here. It used to
  // drop them, so a data-* attribute put on a Tabs.List never reached the DOM.
  const { style: s, rest: r } = splitProps(rest);
  return (
    <div
      className={cn('flex gap-1 border-b border-border', className)}
      style={{ ...boxStyle({ mb }), ...s }}
      {...r}
    >
      {children}
    </div>
  );
};
Tabs.Tab = function TabsTab({ value, children, onClick, ...rest }) {
  const ctx = React.useContext(TabsCtx);
  const active = ctx?.value === value;
  const disabled = rest['data-disabled'];
  return (
    <button
      type="button"
      onClick={(e) => {
        if (disabled) { onClick?.(e); return; }
        ctx?.setValue(value);
        onClick?.(e);
      }}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground',
        disabled && 'cursor-not-allowed opacity-50',
      )}
      {...rest}
    >
      {children}
    </button>
  );
};
Tabs.Panel = function TabsPanel({ value, children }) {
  const ctx = React.useContext(TabsCtx);
  if (ctx?.value !== value) return null;
  return <div className="pt-4">{children}</div>;
};
