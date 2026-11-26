import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ai-research-assistant:theme';

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// Persists the user's theme choice (light/dark/system) in localStorage so
// it survives refresh and re-login (this is a browser-level preference,
// not stored per-account in the database — appropriate for a project this
// size). "system" tracks the OS preference live via matchMedia.
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return undefined;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable — theme just won't persist across sessions */
    }
  }, []);

  return [theme, setTheme];
}
