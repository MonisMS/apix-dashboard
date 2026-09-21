'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Who is running the tour.
 *
 * Deliberately tiny. The step index is NOT kept here: <Joyride> is mounted in
 * app/providers.jsx, above the App Router's page subtree, so it never unmounts
 * on a client navigation and keeps its own position across every router.push.
 * Storing a second copy of that here would only create two things to
 * disagree.
 *
 * `runId` exists so "restart" is a remount: bumping it gives Joyride a new key
 * and the tour always begins at step one, wherever it was abandoned.
 */
const TourCtx = createContext(null);

const IDLE = { running: false, runId: 0, start: () => {}, stop: () => {} };

export function TourProvider({ children }) {
  const [state, setState] = useState({ running: false, runId: 0 });

  const start = useCallback(
    () => setState((s) => ({ running: true, runId: s.runId + 1 })),
    [],
  );
  const stop = useCallback(() => setState((s) => ({ ...s, running: false })), []);

  const value = useMemo(() => ({ ...state, start, stop }), [state, start, stop]);
  return <TourCtx.Provider value={value}>{children}</TourCtx.Provider>;
}

/** Falls back to a no-op so a component is still usable outside the provider. */
export function useTour() {
  return useContext(TourCtx) ?? IDLE;
}
