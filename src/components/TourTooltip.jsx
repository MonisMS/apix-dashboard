import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Custom react-joyride tooltip, replacing Joyride's own default chrome
 * (rounded corners, generic sans font, unstyled buttons) with the app's
 * actual components and tokens -- sharp corners, serif title, mono step
 * counter, our real Button. Joyride's `styles.options` only recolors a
 * handful of CSS variables in the default renderer; it can't touch shape or
 * typography, which is why the tour looked like an unrelated widget dropped
 * onto the page.
 */
/**
 * How tall the bubble may be, given where the highlighted block ends.
 *
 * The bubble must sit clear of the block it describes, and it must stay on
 * screen. On a short viewport a tall block leaves little room underneath, and
 * a fixed max-height then pushed the card past the fold. Measuring the space
 * that actually exists and letting the body scroll into it satisfies both:
 * the header and the footer are always visible, and only the prose scrolls.
 */
function useAvailableHeight(step) {
  const [maxHeight, setMaxHeight] = useState(352);

  useEffect(() => {
    const selector = step?.spotlightTarget ?? step?.target;
    if (typeof selector !== 'string') return undefined;

    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 28;
      const room = Math.max(window.innerHeight - r.bottom - gap, r.top - gap);
      setMaxHeight(Math.max(140, Math.min(352, room)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  return maxHeight;
}

export function TourTooltip({
  backProps,
  closeProps,
  index,
  isLastStep,
  primaryProps,
  size,
  skipProps,
  step,
  tooltipProps,
}) {
  const maxHeight = useAvailableHeight(step);

  return (
    // A flex column with a bounded height, a scrolling body and a shrink-0
    // footer. Previously this set a width and nothing else, so long content
    // simply pushed the Next/Back/Skip row out of the card -- which, stacked
    // on top of steps anchored below targets taller than the window, is why
    // the controls kept ending up off-screen. Padding sits on the three rows
    // rather than the container so the scroll region clips correctly.
    <div
      {...tooltipProps}
      style={{ ...(tooltipProps?.style ?? {}), maxHeight }}
      className="flex w-[min(92vw,380px)] flex-col border border-border bg-popover text-popover-foreground"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5">
        {step.title && <h2 className="font-serif text-lg font-semibold leading-snug">{step.title}</h2>}
        <button
          {...closeProps}
          className="-mr-1 -mt-1 shrink-0 rounded-none p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {step.content && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-1 pt-2 text-sm leading-relaxed text-muted-foreground">
          {step.content}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 pb-4 pt-3">
        {size > 1 ? (
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {index + 1} of {size}
          </span>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {!isLastStep && (
            <Button size="sm" variant="ghost" {...skipProps}>
              {skipProps.children}
            </Button>
          )}
          {index > 0 && (
            <Button size="sm" variant="outline" {...backProps}>
              {backProps.children}
            </Button>
          )}
          <Button size="sm" {...primaryProps}>
            {isLastStep ? 'Done' : primaryProps.children}
          </Button>
        </div>
      </div>
    </div>
  );
}
