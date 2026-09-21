'use client';

import { cn } from '@/lib/utils';

/**
 * The key for any colour that carries meaning.
 *
 * House rule: if a colour encodes something, the page says what it encodes,
 * in words, near the mark. Colour alone is not an encoding -- it fails for
 * colourblind readers, in print, and in forced-colours mode -- and a reader
 * who has to infer that green means "up" is guessing at official statistics.
 */
export function ColorKey({ items = [], note, className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground', className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-4 shrink-0 border border-border"
            style={{ background: it.color, ...(it.style ?? {}) }}
            aria-hidden="true"
          />
          {it.label}
        </span>
      ))}
      {note && <span className="text-muted-foreground/80">{note}</span>}
    </div>
  );
}
