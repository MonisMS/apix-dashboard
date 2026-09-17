/** Formatting helpers. Functions, not components. */

export const idx = (v) =>
  v === null || v === undefined ? '—' : Number(v).toFixed(2);

export const pct = (v, digits = 2) =>
  v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(digits)}%`;

export const rupees = (v) =>
  v === null || v === undefined
    ? '—'
    : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const count = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN');

export const sharePct = (v, digits = 2) =>
  v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(digits)}%`;

/**
 * '2026-09-10' -> '10 Sep'.
 *
 * en-IN, matching the numbers. It used to be en-GB here and en-IN in `count`
 * and `rupees`, so one page mixed two locales' conventions. The locale is
 * pinned rather than taken from the browser on purpose: this is an Indian
 * official-statistics dashboard, and a fare in lakh/crore grouping should not
 * reformat itself for whoever opens it.
 */
export const shortDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const deltaColor = (v) =>
  v === null || v === undefined ? 'gray' : v >= 0 ? 'teal' : 'red';

/** Day-on-day change between the last two points of a series. */
export const lastChange = (points) => {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1];
  return last.pct_change_1p ?? null;
};

export const lastLevel = (points) =>
  points && points.length ? points[points.length - 1].level : null;

/** Turn API points into the {date, value} rows Mantine charts expect. */
export const toChartData = (points, key = 'APIx') =>
  (points ?? []).map((p) => ({ date: shortDate(p.period_start), [key]: p.level }));
