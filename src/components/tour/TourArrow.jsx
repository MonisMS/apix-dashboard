'use client';

/**
 * The bubble's pointer.
 *
 * Joyride positions its own arrow correctly; only the shape was wrong. It
 * renders a filled, borderless triangle as a sibling of the tooltip, so a
 * bordered card ended up with an unbordered spike hanging off it. This draws
 * the same triangle with the card's border on the two slanted edges, then
 * paints over the flat edge in the surface colour to erase the card's own
 * border underneath -- which is what makes it read as one speech bubble
 * rather than a box with a sticker on it.
 *
 * Joyride bails and renders nothing if the dimensions do not match what it
 * computed, so width/height are derived from the `base`/`size` it passes in.
 */
export function TourArrow({ base, placement, size }) {
  const side = String(placement || 'bottom').split('-')[0];
  const horizontal = side === 'top' || side === 'bottom';
  const w = horizontal ? base : size;
  const h = horizontal ? size : base;

  const geometry = {
    top: { body: `0,0 ${base / 2},${size} ${base},0`, seam: `0,0 ${base},0` },
    bottom: { body: `0,${size} ${base / 2},0 ${base},${size}`, seam: `0,${size} ${base},${size}` },
    left: { body: `0,0 ${size},${base / 2} 0,${base}`, seam: `0,0 0,${base}` },
    right: { body: `${size},0 0,${base / 2} ${size},${base}`, seam: `${size},0 ${size},${base}` },
  }[side];

  if (!geometry) return null;

  return (
    <svg width={w} height={h} style={{ display: 'block' }} aria-hidden="true">
      <polygon points={geometry.body} fill="var(--popover)" />
      <polyline points={geometry.body} fill="none" stroke="var(--border)" strokeWidth="1" />
      <polyline points={geometry.seam} fill="none" stroke="var(--popover)" strokeWidth="2.5" />
    </svg>
  );
}
