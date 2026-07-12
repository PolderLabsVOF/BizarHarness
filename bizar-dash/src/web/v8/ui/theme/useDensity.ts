import { useContext } from 'react';
import { DensityContext, type DensityContextValue } from './DensityProvider.js';

/**
 * useDensity — read & mutate UI density (comfortable / compact).
 *
 * Throws if used outside of a <DensityProvider>.
 */
export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (ctx === null) {
    throw new Error('useDensity must be used inside <DensityProvider>.');
  }
  return ctx;
}