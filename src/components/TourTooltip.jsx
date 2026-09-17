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
  return (
    <div
      {...tooltipProps}
      className="w-[min(92vw,380px)] border border-border bg-popover p-5 text-popover-foreground"
    >
      <div className="flex items-start justify-between gap-3">
        {step.title && <h2 className="font-serif text-lg font-semibold leading-snug">{step.title}</h2>}
        <button
          {...closeProps}
          className="-mr-1 -mt-1 shrink-0 rounded-none p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {step.content && <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.content}</div>}

      <div className="mt-4 flex items-center justify-between gap-3">
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
