import { useCallback, useEffect, useState } from 'react';

const KEY = 'apix-theme';

function initial() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored === 'dark';
  } catch {
    /* localStorage unavailable (private mode, etc.) -- fall through to system preference */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Class-based dark mode, persisted, defaulting to light per the plan's institutional-seriousness call. */
export function useDarkMode() {
  const [dark, setDark] = useState(initial);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return [dark, toggle];
}
