import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DensityProvider } from './DensityProvider.js';
import { useDensity } from './useDensity.js';

/**
 * DensityProvider tests — verifies toggle, persistence, and the
 * `data-density` attribute on <html>.
 */

function Probe(): JSX.Element {
  const { density, setDensity, toggle } = useDensity();
  return (
    <div>
      <span data-testid="density">{density}</span>
      <button type="button" onClick={() => setDensity('compact')}>set-compact</button>
      <button type="button" onClick={toggle}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset['density'] = '';
});

describe('DensityProvider', () => {
  it('defaults to comfortable', () => {
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByTestId('density').textContent).toBe('comfortable');
    expect(document.documentElement.dataset['density']).toBe('comfortable');
  });

  it('respects defaultDensity', () => {
    render(
      <DensityProvider defaultDensity="compact">
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByTestId('density').textContent).toBe('compact');
    expect(document.documentElement.dataset['density']).toBe('compact');
  });

  it('setDensity persists to localStorage and updates the attribute', () => {
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>,
    );
    act(() => screen.getByText('set-compact').click());
    expect(screen.getByTestId('density').textContent).toBe('compact');
    expect(window.localStorage.getItem('bizar:density')).toBe('compact');
    expect(document.documentElement.dataset['density']).toBe('compact');
  });

  it('toggle flips comfortable ↔ compact', () => {
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>,
    );
    expect(screen.getByTestId('density').textContent).toBe('comfortable');

    act(() => screen.getByText('toggle').click());
    expect(screen.getByTestId('density').textContent).toBe('compact');

    act(() => screen.getByText('toggle').click());
    expect(screen.getByTestId('density').textContent).toBe('comfortable');
  });
});
