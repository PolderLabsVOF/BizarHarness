import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { useTheme } from '../ui/theme/useTheme.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { useDensity } from '../ui/theme/useDensity.js';
import type { ReactNode } from 'react';

function wrapperFactory(mode?: 'light' | 'dark' | 'system') {
  return ({ children }: { children: ReactNode }) => (
    <ThemeProvider defaultMode={mode}>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with the given defaultMode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapperFactory('dark') });
    expect(result.current.mode).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });

  it('persists setMode to localStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapperFactory() });
    act(() => result.current.setMode('light'));
    expect(window.localStorage.getItem('bizar:theme')).toBe('light');
    expect(result.current.mode).toBe('light');
  });

  it('cycles light → dark → system → light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapperFactory('light') });
    expect(result.current.mode).toBe('light');

    act(() => result.current.cycle());
    expect(result.current.mode).toBe('dark');

    act(() => result.current.cycle());
    expect(result.current.mode).toBe('system');

    act(() => result.current.cycle());
    expect(result.current.mode).toBe('light');
  });

  it('writes data-theme to documentElement on mount', () => {
    renderHook(() => useTheme(), { wrapper: wrapperFactory('dark') });
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});

describe('DensityProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to comfortable', () => {
    const { result } = renderHook(() => useDensity(), { wrapper: wrapperFactory() });
    expect(result.current.density).toBe('comfortable');
  });

  it('toggle flips between comfortable and compact', () => {
    const { result } = renderHook(() => useDensity(), { wrapper: wrapperFactory() });
    act(() => result.current.toggle());
    expect(result.current.density).toBe('compact');
    expect(window.localStorage.getItem('bizar:density')).toBe('compact');

    act(() => result.current.toggle());
    expect(result.current.density).toBe('comfortable');
  });

  it('writes data-density to documentElement', () => {
    renderHook(() => useDensity(), { wrapper: wrapperFactory() });
    expect(document.documentElement.dataset['density']).toBe('comfortable');
  });
});

describe('hook usage outside provider', () => {
  it('useTheme throws when used without a provider', () => {
    // suppress React's error boundary log
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/);
    } finally {
      spy.mockRestore();
    }
  });

  it('useDensity throws when used without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useDensity())).toThrow(/DensityProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});