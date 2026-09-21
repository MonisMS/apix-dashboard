'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Joyride, EVENTS, STATUS } from 'react-joyride';
import { toast } from 'sonner';

import { get } from '../../api';
import { TourTooltip } from '../TourTooltip';
import { TourArrow } from './TourArrow';
import { STEPS, TOUR_ROUTES, nav } from './steps';

/**
 * The single Joyride instance, mounted once in app/providers.jsx.
 *
 * Everything below that Joyride reads is a module-level constant. This
 * component re-renders on every navigation (it sits above the router's page
 * subtree), and Joyride deep-merges its props each render -- inline object
 * literals here would churn the floating-ui options on every route change.
 */

const TOUR_OPTIONS = {
  // Was passed as styles={{ options: ... }}, a prop path that does not exist
  // in react-joyride v3, so every one of these values was silently discarded
  // and the tour rendered with library defaults: a white arrow, the default
  // overlay, and z-index 100 (underneath our own sidebar layers).
  // v3 renamed disableBeacon -> skipBeacon. Without it the tour renders a
  // pulsing dot that has to be clicked before the first bubble appears, which
  // for a guided walkthrough just looks like nothing happened.
  skipBeacon: true,
  zIndex: 2000,
  backgroundColor: 'var(--popover)',
  textColor: 'var(--popover-foreground)',
  arrowColor: 'var(--popover)',
  primaryColor: 'var(--primary)',
  // A scrim, not a themed surface. Deriving it from --foreground meant that
  // in dark mode it resolved to near-WHITE at 55% -- the silver haze that
  // made the page painful to look at. A dim-out must be dark in both themes.
  overlayColor: 'rgba(0, 0, 0, 0.55)',
  spotlightPadding: 8,
  spotlightRadius: 10,
  arrowSize: 12,
  arrowBase: 22,
  offset: 12,
  // 88 = the 52px console header plus breathing room, applied once here
  // rather than 120 blanket-applied to every step as it was before.
  scrollOffset: 64,
  scrollToFirstStep: true,
  // Our own wait is 7s; Joyride's default abort is 5s and would cut it short.
  beforeTimeout: 12000,
  targetWaitTimeout: 1500,
  // A stray click during a demo must not end the tour.
  overlayClickAction: false,
  closeButtonAction: 'skip',
};

const FLOATING = {
  // Cross-axis shift is deliberately OFF. For a bottom placement the cross
  // axis is vertical, so enabling it slid the bubble up over the block it was
  // describing whenever space was tight. Let flip move it above instead --
  // the bubble must never sit on top of the highlight.
  shiftOptions: { padding: 16, crossAxis: false },
  flipOptions: {
    padding: 16,
    // Below first. Only if there is genuinely no room does it go above --
    // never to the side, where it would sit across the highlighted block.
    fallbackPlacements: ['bottom', 'top'],
    fallbackStrategy: 'bestFit',
  },
};

// Joyride's default loader is position:fixed at 48x48 with no offsets, which
// pins the spinner to the top-left corner of the window. It is visible during
// every cross-page wait, so it has to be centred.
const TOUR_STYLES = {
  loader: { position: 'fixed', inset: 0, height: '100%', width: '100%' },
};

/** Query keys mirror src/api.js useApi(): [name, params ?? null]. */
const WARM = [
  ['index', '/index'], ['collection', '/collection'], ['methodology', '/methodology'],
  ['weights', '/weights'], ['cleaning', '/cleaning'], ['validation', '/validation'],
];

export function GuidedTour({ running, runId, onStop }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // The steps are module constants, so they reach the router through this.
  nav.push = router.push.bind(router);
  nav.prefetch = router.prefetch.bind(router);

  // Warm every page the tour visits the moment it starts. With the client's
  // 5-minute staleTime each page then paints from cache and the readiness
  // wait returns on its first tick, so the timeout path stays theoretical.
  useEffect(() => {
    if (!running) return;
    TOUR_ROUTES.forEach((r) => {
      try { router.prefetch(r); } catch { /* prefetch is best-effort */ }
    });
    WARM.forEach(([key, path]) => {
      queryClient.prefetchQuery({
        queryKey: [key, null],
        queryFn: () => get(path),
        staleTime: 60_000,
      }).catch(() => {});
    });
  }, [running, router, queryClient]);

  return (
    <Joyride
      key={runId}
      run={running}
      steps={STEPS}
      continuous
      showSkipButton
      showProgress={false}
      disableFocusTrap
      tooltipComponent={TourTooltip}
      arrowComponent={TourArrow}
      options={TOUR_OPTIONS}
      floatingOptions={FLOATING}
      styles={TOUR_STYLES}
      onEvent={(data) => {
        // Uncontrolled on purpose: Joyride only auto-advances past a missing
        // target when it owns the index. Passing stepIndex would turn a slow
        // page into a tour that visibly hangs.
        if (data?.type === EVENTS.TARGET_NOT_FOUND) {
          if (data.index >= data.size - 1) onStop?.();
          else toast.message('Skipping ahead', { description: 'That page is still loading.' });
          return;
        }
        if (data?.status === STATUS.FINISHED || data?.status === STATUS.SKIPPED) onStop?.();
      }}
    />
  );
}
