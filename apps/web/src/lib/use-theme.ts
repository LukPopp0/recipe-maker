// Light/dark theme toggle (2-state, persisted). Until the user makes a
// choice, the app follows the OS via the prefers-color-scheme media query in
// index.css; the first toggle pins an explicit theme by stamping
// data-theme on <html> and saving it. A stored choice is re-applied before
// first paint by the inline script in index.html, so this hook only needs to
// derive the initial state and handle toggles.
import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable - fall through to the OS preference.
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('theme', next);
      } catch {
        // Persistence is best-effort; the in-session theme still applies.
      }
      return next;
    });
  }, []);

  return [theme, toggleTheme];
}
