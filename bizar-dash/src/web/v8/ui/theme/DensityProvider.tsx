import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * UI density — affects row heights, control heights, card padding via tokens.
 *   - 'comfortable' → standard spacing (default).
 *   - 'compact'     → dense data tables, power-user mode.
 *
 * Persisted to localStorage and reflected as `data-density="…"` on <html>
 * so tokens.css rules (e.g. `--density-row-h`) swap without a re-render.
 */
export type Density = 'comfortable' | 'compact';

export interface DensityContextValue {
  density: Density;
  setDensity: (next: Density) => void;
  toggle: () => void;
}

export const DensityContext = createContext<DensityContextValue | null>(null);

const STORAGE_KEY = 'bizar:density';

function readStoredDensity(): Density {
  if (typeof window === 'undefined') return 'comfortable';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'comfortable' || raw === 'compact') return raw;
  return 'comfortable';
}

function applyDensityAttribute(density: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset['density'] = density;
}

export interface DensityProviderProps {
  children: ReactNode;
  defaultDensity?: Density;
}

export function DensityProvider({ children, defaultDensity }: DensityProviderProps): JSX.Element {
  const [density, setDensityState] = useState<Density>(() => defaultDensity ?? readStoredDensity());

  useEffect(() => {
    applyDensityAttribute(density);
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    setDensityState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggle = useCallback(() => {
    setDensityState((prev) => {
      const next: Density = prev === 'comfortable' ? 'compact' : 'comfortable';
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<DensityContextValue>(
    () => ({ density, setDensity, toggle }),
    [density, setDensity, toggle],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}