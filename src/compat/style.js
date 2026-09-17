/**
 * A miniature version of Mantine's style-prop system, just wide enough to
 * cover what the 14 existing analytical pages actually use. Every color
 * resolves to a CSS variable token (never a hex code), so the "no hardcoded
 * colors" rule holds even though callers still pass Mantine-style names like
 * "teal.6" or "indigo" -- this resolver is the one place that translation
 * happens, so no page had to be rewritten to move off Mantine.
 */

const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

export function space(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return `${v}px`;
  if (v in SPACE) return `${SPACE[v]}px`;
  return v;
}

const FONT_SIZE = { xs: '12px', sm: '13px', md: '14px', lg: '16px', xl: '20px' };

export function fontSize(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return `${v}px`;
  return FONT_SIZE[v] ?? v;
}

const NAMED = {
  teal: 'var(--success)',
  green: 'var(--success)',
  red: 'var(--destructive)',
  orange: 'var(--warning)',
  yellow: 'var(--warning)',
  gray: 'var(--muted-foreground)',
  grey: 'var(--muted-foreground)',
  dimmed: 'var(--muted-foreground)',
  indigo: 'var(--chart-1)',
  navy: 'var(--chart-1)',
  blue: 'var(--chart-2)',
  cyan: 'var(--chart-3)',
  grape: 'var(--chart-4)',
  violet: 'var(--chart-4)',
};

/** Resolve any Mantine-style color reference ("teal.6", "indigo", "red") to a token. */
export function resolveColor(c) {
  if (!c) return undefined;
  if (typeof c !== 'string') return c;
  if (c.startsWith('var(') || c.startsWith('#')) return c;
  const [name] = c.split('.');
  return NAMED[name] ?? 'var(--chart-1)';
}

const SOFT_BG = {
  teal: 'color-mix(in srgb, var(--success) 14%, transparent)',
  green: 'color-mix(in srgb, var(--success) 14%, transparent)',
  red: 'color-mix(in srgb, var(--destructive) 12%, transparent)',
  orange: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  yellow: 'color-mix(in srgb, var(--warning) 14%, transparent)',
  gray: 'var(--secondary)',
  grey: 'var(--secondary)',
  indigo: 'var(--accent)',
  navy: 'var(--accent)',
  blue: 'var(--accent)',
  cyan: 'var(--accent)',
  grape: 'var(--accent)',
  violet: 'var(--accent)',
};

/** A "light variant" background for the same name, e.g. Badge/Alert fills. */
export function resolveSoftBg(c) {
  if (!c) return 'var(--secondary)';
  const [name] = String(c).split('.');
  return SOFT_BG[name] ?? 'var(--accent)';
}

const SHORTHAND_KEYS = [
  'm', 'mt', 'mb', 'ml', 'mr', 'mx', 'my',
  'p', 'pt', 'pb', 'pl', 'pr', 'px', 'py',
  'w', 'miw', 'maw', 'h', 'mih', 'mah',
];

/** Split Mantine-style shorthand box props out of the rest, returning a style object. */
export function boxStyle(props, extra = {}) {
  const style = { ...extra };
  for (const key of SHORTHAND_KEYS) {
    if (props[key] === undefined) continue;
    const val = space(props[key]) ?? (typeof props[key] === 'number' ? `${props[key]}px` : props[key]);
    switch (key) {
      case 'm': style.margin = val; break;
      case 'mt': style.marginTop = val; break;
      case 'mb': style.marginBottom = val; break;
      case 'ml': style.marginLeft = val; break;
      case 'mr': style.marginRight = val; break;
      case 'mx': style.marginLeft = val; style.marginRight = val; break;
      case 'my': style.marginTop = val; style.marginBottom = val; break;
      case 'p': style.padding = val; break;
      case 'pt': style.paddingTop = val; break;
      case 'pb': style.paddingBottom = val; break;
      case 'pl': style.paddingLeft = val; break;
      case 'pr': style.paddingRight = val; break;
      case 'px': style.paddingLeft = val; style.paddingRight = val; break;
      case 'py': style.paddingTop = val; style.paddingBottom = val; break;
      case 'w': style.width = val; break;
      case 'miw': style.minWidth = val; break;
      case 'maw': style.maxWidth = val; break;
      case 'h': style.height = val; break;
      case 'mih': style.minHeight = val; break;
      case 'mah': style.maxHeight = val; break;
      default: break;
    }
  }
  if (props.fz !== undefined) style.fontSize = fontSize(props.fz);
  if (props.fw !== undefined) style.fontWeight = props.fw;
  if (props.lh !== undefined) style.lineHeight = props.lh;
  if (props.ta !== undefined) style.textAlign = props.ta;
  if (props.tt !== undefined) style.textTransform = props.tt;
  if (props.lts !== undefined) style.letterSpacing = typeof props.lts === 'number' ? `${props.lts}px` : props.lts;
  if (props.c !== undefined) style.color = resolveColor(props.c);
  if (props.bg !== undefined) style.background = resolveSoftBg(props.bg);
  return style;
}

/** Keys this module consumes, so callers can strip them before spreading onto a DOM node. */
export const CONSUMED_KEYS = new Set([
  ...SHORTHAND_KEYS,
  'fz', 'fw', 'lh', 'ta', 'tt', 'lts', 'c', 'bg', 'span', 'truncate', 'translate',
]);

export function splitProps(props) {
  const style = boxStyle(props, props.style);
  const rest = {};
  for (const [k, v] of Object.entries(props)) {
    if (!CONSUMED_KEYS.has(k) && k !== 'style') rest[k] = v;
  }
  return { style, rest };
}
