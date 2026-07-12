import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider.js';

/**
 * useTheme — read & mutate the active theme.
 *
 * Throws if used outside of a <ThemeProvider>. This is intentional:
 * using the hook without a provider is always a bug.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return ctx;
}