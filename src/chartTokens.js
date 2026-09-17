/**
 * Chart color constants, kept for pages that import them directly. Values
 * are CSS variable references so nothing here is a hardcoded color -- see
 * src/index.css for the actual token definitions.
 */
export const CHART = 'var(--chart-1)';
export const CHART_MUTED = 'var(--muted-foreground)';

/** Sequential, same family -- never a rainbow. */
export const SERIES_COLORS = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)',
];

export const UP = 'var(--success)';
export const DOWN = 'var(--destructive)';
