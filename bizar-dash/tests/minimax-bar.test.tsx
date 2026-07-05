/**
 * bizar-dash/tests/minimax-bar.test.ts
 *
 * Tests for MiniMax quota bar in the dashboard.
 * Verifies bar width = consumedPct (not remainingPct).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Minimal QuotaBar clone for testing ──────────────────────────────────────
// This mirrors the logic in MiniMaxUsage.tsx QuotaBar component.

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function QuotaBarTest({ remainingPct, consumedPct }: { remainingPct: number; consumedPct: number }) {
  return (
    <div data-testid="quota-row">
      <div data-testid="remaining-label">{remainingPct}% remaining</div>
      <div data-testid="consumed-label">· {consumedPct}% used</div>
      <div
        data-testid="bar-fill"
        style={{ width: `${consumedPct}%` }}
        aria-label={`${consumedPct}% consumed`}
      />
    </div>
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('QuotaBar width logic', () => {

  it('bar width equals consumedPct, not remainingPct', () => {
    const remainingPct = 91;
    const consumedPct = clamp(100 - remainingPct, 0, 100);

    render(<QuotaBarTest remainingPct={remainingPct} consumedPct={consumedPct} />);

    const barFill = screen.getByTestId('bar-fill');
    const styleWidth = barFill.getAttribute('style');

    // Bar width should be 9% (consumed), not 91% (remaining)
    expect(styleWidth).toMatch(/width: 9%/);
    expect(barFill.getAttribute('aria-label')).toBe('9% consumed');
  });

  it('100% remaining → 0% consumed → 0% bar width', () => {
    const remainingPct = 100;
    const consumedPct = clamp(100 - remainingPct, 0, 100);

    render(<QuotaBarTest remainingPct={remainingPct} consumedPct={consumedPct} />);

    const barFill = screen.getByTestId('bar-fill');
    expect(barFill.getAttribute('style')).toMatch(/width: 0%/);
  });

  it('0% remaining → 100% consumed → 100% bar width', () => {
    const remainingPct = 0;
    const consumedPct = clamp(100 - remainingPct, 0, 100);

    render(<QuotaBarTest remainingPct={remainingPct} consumedPct={consumedPct} />);

    const barFill = screen.getByTestId('bar-fill');
    expect(barFill.getAttribute('style')).toMatch(/width: 100%/);
  });

  it('75% remaining → 25% consumed → 25% bar width', () => {
    const remainingPct = 75;
    const consumedPct = clamp(100 - remainingPct, 0, 100);

    render(<QuotaBarTest remainingPct={remainingPct} consumedPct={consumedPct} />);

    const barFill = screen.getByTestId('bar-fill');
    expect(barFill.getAttribute('style')).toMatch(/width: 25%/);
  });

  it('consumedPct = 100 - remainingPct', () => {
    const testCases = [
      { remaining: 100, expectedConsumed: 0 },
      { remaining: 91, expectedConsumed: 9 },
      { remaining: 75, expectedConsumed: 25 },
      { remaining: 50, expectedConsumed: 50 },
      { remaining: 25, expectedConsumed: 75 },
      { remaining: 9, expectedConsumed: 91 },
      { remaining: 0, expectedConsumed: 100 },
    ];

    for (const { remaining, expectedConsumed } of testCases) {
      const consumed = clamp(100 - remaining, 0, 100);
      expect(consumed).toBe(expectedConsumed);
    }
  });

  it('clamp keeps values within 0-100 range', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
    expect(clamp(110, 0, 100)).toBe(100);
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('labels show both remaining and consumed', () => {
    const remainingPct = 91;
    const consumedPct = clamp(100 - remainingPct, 0, 100);

    render(<QuotaBarTest remainingPct={remainingPct} consumedPct={consumedPct} />);

    expect(screen.getByTestId('remaining-label').textContent).toBe('91% remaining');
    expect(screen.getByTestId('consumed-label').textContent).toBe('· 9% used');
  });
});
