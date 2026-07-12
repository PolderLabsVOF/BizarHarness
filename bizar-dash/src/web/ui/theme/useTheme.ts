/*
 * useTheme.ts — Hook accessor for the ThemeContext.
 *
 * Throws if consumed outside a <ThemeProvider>. This is intentional: a
 * missing provider is a developer error rather than a runtime fallback,
 * so the consumer fails fast during development instead of silently
 * returning the wrong theme.
 */

import { useContext } from 'react';
import { ThemeContext, type ThemeContextValue } from './ThemeProvider';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error(
      'useTheme must be used inside a <ThemeProvider>. ' +
        'Wrap your app root in <ThemeProvider> before calling useTheme().',
    );
  }
  return ctx;
}
