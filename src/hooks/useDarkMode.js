'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Class-based dark mode, persisted. Backed by next-themes (see app/providers)
 * rather than reading localStorage directly: the old version did that inside a
 * useState initializer, which runs during render and throws on the server.
 *
 * The [dark, toggle] shape is unchanged so call sites did not have to move.
 */
export function useDarkMode() {
  const { resolvedTheme, setTheme } = useTheme();

  // The server cannot know the visitor's theme, so the first client render must
  // match the server's. Report light until mounted, then flip.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === 'dark';

  const toggle = useCallback(
    () => setTheme(dark ? 'light' : 'dark'),
    [dark, setTheme],
  );

  return [dark, toggle];
}
