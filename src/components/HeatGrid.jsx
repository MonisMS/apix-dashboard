'use client';

import { cn } from '@/lib/utils';

/**
 * A route x day matrix that fits its container and shows its numbers.
 *
 * Replaces the MatrixChart usage on /heatmap, which had two defects that made
 * the page unreadable rather than merely plain:
 *
 *  1. No colour ramp existed. The scales were written Mantine-style
 *     ('indigo.1' ... 'indigo.9'), but compat/style.js resolveColor splits on
 *     '.' and throws the shade away, so all five steps resolved to the SAME
 *     token. Every cell was one flat colour and the fill encoded nothing.
 *  2. The "no data" colour resolved to --muted-foreground, which is also what
 *     the diverging midpoint resolved to, so "not applicable" and "no change"
 *     were indistinguishable.
 *
 * Ramps here are computed with color-mix() over theme tokens, so there is
 * still no hardcoded colour and dark mode is a real re-step rather than an
 * inversion.
 *
 * Every cell carries its value as text. That is not decoration: the diverging
 * pair is red/green, which separates by only ~7.6 CVD dE in light mode, and a
 * red-green scale without secondary encoding is unreadable for a deuteranopic
 * viewer. The printed number is the secondary encoding, and it also gives the
 * near-zero cells -- which sit at ~1.16:1 against the surface -- something
 * legible in them.
 */

/** Cell background for a value normalised to [-1, 1] (diverging) or [0, 1]. */
function fill(t, diverging) {
  if (t === null) return 'transparent';
  const pct = Math.round(Math.min(1, Math.abs(t)) * 100);
  if (!diverging) {
    // Sequential: one hue, light -> dark, mixed against the card surface.
    return `color-mix(in oklab, var(--chart-2) ${pct}%, var(--card))`;
  }
  const pole = t < 0 ? 'var(--destructive)' : 'var(--success)';
  // Diverging: two hues with a neutral, low-chroma midpoint.
  return `color-mix(in oklab, ${pole} ${pct}%, var(--muted))`;
}

/** Ink that stays legible once the fill gets strong. */
function ink(t, diverging) {
  if (t === null) return 'var(--muted-foreground)';
  if (Math.abs(t) <= 0.55) return 'var(--foreground)';
  if (!diverging) return 'var(--success-foreground)';
  return t < 0 ? 'var(--destructive-foreground)' : 'var(--success-foreground)';
}

export function HeatGrid({
  xLabels = [],
  yLabels = [],
  cells = [],
  diverging = false,
  format = (v) => String(v),
  naLabel = 'not applicable',
  naTitle,
}) {
  const byKey = new Map(cells.map((c) => [`${c.y}|${c.x}`, c.value]));
  const values = cells.map((c) => c.value).filter((v) => v !== null && v !== undefined);
  const maxAbs = values.length ? Math.max(...values.map((v) => Math.abs(v))) : 1;
  const max = values.length ? Math.max(...values) : 1;
  const min = values.length ? Math.min(...values) : 0;
  const norm = (v) => {
    if (v === null || v === undefined) return null;
    if (diverging) return maxAbs ? v / maxAbs : 0;
    return max === min ? 1 : (v - min) / (max - min);
  };

  return (
    <div
      className="grid w-full gap-px text-[11px]"
      style={{ gridTemplateColumns: `minmax(64px, max-content) repeat(${xLabels.length}, minmax(0, 1fr))` }}
      role="table"
      aria-label="Route by collection day"
    >
      <div role="columnheader" className="sticky left-0 z-10 bg-card" />
      {xLabels.map((x) => (
        <div
          key={x}
          role="columnheader"
          className="truncate px-1 pb-1 text-center text-[10px] text-muted-foreground"
          title={x}
        >
          {x}
        </div>
      ))}

      {yLabels.map((y) => (
        <div key={y} className="contents" role="row">
          <div
            role="rowheader"
            className="sticky left-0 z-10 flex items-center whitespace-nowrap bg-card pr-2 font-medium"
          >
            {y}
          </div>
          {xLabels.map((x) => {
            const raw = byKey.get(`${y}|${x}`);
            const v = raw === undefined ? null : raw;
            const t = norm(v);
            const na = v === null;
            return (
              <div
                key={x}
                role="cell"
                title={na ? (naTitle ?? `${y} · ${x} — ${naLabel}`) : `${y} · ${x} — ${format(v)}`}
                aria-label={na ? `${y}, ${x}, ${naLabel}` : `${y}, ${x}, ${format(v)}`}
                className={cn(
                  'flex h-7 items-center justify-center overflow-hidden px-0.5 tabular-nums',
                  na && 'border border-dashed border-border',
                )}
                style={
                  na
                    ? {
                        // Hatched, not tinted: "not applicable" must not be
                        // mistakable for a value near the middle of the scale.
                        backgroundImage:
                          'repeating-linear-gradient(45deg, var(--muted) 0 3px, transparent 3px 6px)',
                        color: 'var(--muted-foreground)',
                      }
                    : { background: fill(t, diverging), color: ink(t, diverging) }
                }
              >
                {na ? '–' : format(v)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Scale key: the two poles, the midpoint, and the not-applicable hatch. */
export function HeatLegend({ diverging, min, max, format, naLabel = 'not applicable' }) {
  const swatch = (bg, extra) => (
    <span className="inline-block h-3 w-6 border border-border" style={{ background: bg, ...extra }} />
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {diverging ? (
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">{format(min)}</span>
          {swatch('color-mix(in oklab, var(--destructive) 100%, var(--muted))')}
          {swatch('color-mix(in oklab, var(--destructive) 45%, var(--muted))')}
          {swatch('var(--muted)')}
          {swatch('color-mix(in oklab, var(--success) 45%, var(--muted))')}
          {swatch('color-mix(in oklab, var(--success) 100%, var(--muted))')}
          <span className="tabular-nums">{format(max)}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">{format(min)}</span>
          {[15, 40, 65, 90].map((p) => (
            <span key={p}>{swatch(`color-mix(in oklab, var(--chart-2) ${p}%, var(--card))`)}</span>
          ))}
          <span className="tabular-nums">{format(max)}</span>
        </span>
      )}
      <span className="flex items-center gap-1.5">
        {swatch('transparent', {
          backgroundImage: 'repeating-linear-gradient(45deg, var(--muted) 0 3px, transparent 3px 6px)',
        })}
        {naLabel}
      </span>
    </div>
  );
}
