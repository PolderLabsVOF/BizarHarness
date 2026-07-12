import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from './ThemeProvider.js';
import { useTheme } from './useTheme.js';

/**
 * ThemeProvider tests — verifies mode cycling, localStorage persistence,
 * and the `data-theme` attribute on <html>.
 *
 * The test harness's matchMedia stub returns `matches: false`, so the
 * 'system' mode always resolves to 'light'. Tests pin the starting mode
 * via the `defaultMode` prop to avoid that ambiguity.
 */

function Probe(): JSX.Element {
  const { mode, resolved, setMode, cycle } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setMode('dark')}>set-dark</button>
      <button type="button" onClick={cycle}>cycle</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset['theme'] = '';
});

describe('ThemeProvider', () => {
  it('resolves forced light to light and stamps data-theme on <html>', () => {
    render(
      <ThemeProvider defaultMode="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('resolves forced dark to dark and stamps data-theme on <html>', () => {
    render(
      <ThemeProvider defaultMode="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('setMode persists to localStorage and updates the attribute', () => {
    render(
      <ThemeProvider defaultMode="light">
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByText('set-dark').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(window.localStorage.getItem('bizar:theme')).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('cycle goes light → dark → system → light', () => {
    render(
      <ThemeProvider defaultMode="light">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('mode').textContent).toBe('light');

    act(() => screen.getByText('cycle').click());
    expect(screen.getByTestId('mode').textContent).toBe('dark');

    act(() => screen.getByText('cycle').click());
    expect(screen.getByTestId('mode').textContent).toBe('system');

    act(() => screen.getByText('cycle').click());
    expect(screen.getByTestId('mode').textContent).toBe('light');
  });
});
