'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The small circled "i" that sits beside a figure and explains it in plain
 * language on hover or focus.
 *
 * The audience for this dashboard includes people who will not know what a
 * Jevons elementary aggregate or a thin cell is, and should not have to. Every
 * number that carries a term of art gets one of these.
 *
 * It is a real <button>, not a hover-only <span>, so the explanation is
 * reachable by keyboard and announced by a screen reader -- and so it works on
 * touch, where there is no hover at all and a tooltip that only opens on
 * pointer-enter is invisible.
 */
export function InfoDot({ label, children, className, side = 'top' }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // The tooltip body repeats as the accessible name, so a screen
            // reader gets the explanation rather than the word "info".
            aria-label={`What is ${label}? ${typeof children === 'string' ? children : ''}`}
            className={cn(
              'inline-flex size-3.5 shrink-0 items-center justify-center rounded-full',
              'text-muted-foreground/70 transition-colors hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              className,
            )}
            onClick={(e) => e.preventDefault()}
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[260px] text-pretty leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A label with its explanation attached -- the common case in a KPI row. */
export function LabelWithInfo({ label, info, className }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {label}
      <InfoDot label={label}>{info}</InfoDot>
    </span>
  );
}
