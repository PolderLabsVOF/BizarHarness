/*
 * ThemeProvider.tsx — Theme context for the Bizar design system (Wave 1).
 *
 * Owns three values: the user-selected `theme` preference ('light' | 'dark'
 * | 'system'), the resolved `resolvedTheme` actually applied to <html>, and
 * the actions `setTheme` / `toggle`. The 'system' preference follows the
 * OS preference-color-scheme via a MediaQueryList subscription that is only
 * attached while the preference is 'system' (no listener leak when the user
 * has pinned 'light' or 'dark').
 *
 * Persists `theme` (not resolvedTheme) to localStorage under the key
 * 'bizar-theme' so the OS-mode subscription can still re-evaluate each
 * session. Renders no DOM — it is a pure context provider.
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';

export type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'bizar-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // ignore quota / privacy errors and fall back to OS preference
  }
  return 'system';
}

function resolveSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyResolvedTheme(resolved: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-bizar-theme', resolved);
}

export type ThemeProviderProps = {
  children: ReactNode;
  /** Override the localStorage lookup. Used by tests / Storybook. */
  defaultTheme?: Theme;
};

export function ThemeProvider({
  children,
  defaultTheme,
}: ThemeProviderProps): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>(
    defaultTheme ?? getInitialTheme,
  );
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(
    resolveSystemTheme,
  );

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // Sync once on mount in case the OS preference changed while
    // the provider was unmounted.
    setSystemTheme(mql.matches ? 'dark' : 'light');

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, t);
      }
    } catch {
      // ignore storage failures (privacy mode, quota)
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      // 'system' is set explicitly — only toggle between resolved modes
      // when the user invokes toggle(). This matches Supabase's pattern.
      const current: 'light' | 'dark' =
        prev === 'system' ? systemTheme : prev;
      const next: Theme = current === 'light' ? 'dark' : 'light';
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, [systemTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggle }),
    [theme, resolvedTheme, setTheme, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
