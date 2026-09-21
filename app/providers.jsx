'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';

import { TourProvider, useTour } from '@/components/tour/TourContext';
import { GuidedTour } from '@/components/tour/GuidedTour';

// next-themes replaces the hand-rolled useDarkMode state. It writes the same
// 'apix-theme' key with the same 'dark'/'light' values, so existing visitors
// keep their preference, and it injects a blocking script that sets the class
// before first paint — which the old implementation could not do.
export default function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // Without this every navigation between dashboard pages refetched
            // everything from scratch, because the default staleTime is 0.
            // The index is published once a day, so a five-minute client cache
            // makes moving around the dashboard instant without ever showing a
            // level from a superseded vintage.
            staleTime: 5 * 60 * 1000,
            gcTime: 30 * 60 * 1000,
            retry: 1,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="apix-theme"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {/* The tour lives here, above the router's page subtree, so a single
            Joyride instance survives every client navigation and keeps its own
            step position across router.push. Mounting it inside AppLayout
            could not work: that unmounts when you leave the console, and does
            not exist on the landing page at all. */}
        <TourProvider>
          {children}
          <TourMount />
        </TourProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

/** Bridges the tour context into the single Joyride instance. */
function TourMount() {
  const { running, runId, stop } = useTour();
  return <GuidedTour running={running} runId={runId} onStop={stop} />;
}
