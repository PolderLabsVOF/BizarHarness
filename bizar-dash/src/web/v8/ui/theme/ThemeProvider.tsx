import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Theme modes.
 *   - 'system'  → follows `prefers-color-scheme` media query, stored as `data-theme="light|dark"` on <html>.
 *   - 'light'   → forces light.
 *   - 'dark'    → forces dark.
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  /** The user's chosen mode (may be 'system'). */
  mode: ThemeMode;
  /** The active theme after resolving 'system' against the OS preference. */
  resolved: ResolvedTheme;
  /** Persist a new mode. */
  setMode: (mode: ThemeMode) => void;
  /** Cycle through light → dark → system → light. Wired to the toolbar toggle. */
  cycle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'bizar:theme';

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return systemPrefersDark() ? 'dark' : 'light';
}

function applyThemeAttribute(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['theme'] = resolved;
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** Override default mode on first render (still persists on change). */
  defaultMode?: ThemeMode;
}

export function ThemeProvider({ children, defaultMode }: ThemeProviderProps): JSX.Element {
  const [mode, setModeState] = useState<ThemeMode>(() => defaultMode ?? readStoredMode());
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Subscribe to system preference changes when in 'system' mode.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Apply to <html data-theme="…"> so tokens.css overrides win over media query.
  useEffect(() => {
    applyThemeAttribute(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const cycle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
