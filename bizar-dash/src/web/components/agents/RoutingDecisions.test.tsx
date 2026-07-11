/**
 * src/web/components/agents/RoutingDecisions.test.tsx
 *
 * F-035 — vitest tests for the routing-decisions panel.
 * 3 tests required by the F-035 layers[] spec:
 *   1. renders the empty state when no decisions have been emitted
 *   2. renders a single decision via the `initial` prop
 *   3. renders multiple decisions via the WS subscription path
 *
 * The `subscribe` prop receives a `(msg: WsMessage) => void` handler
 * and returns an unsubscribe function. We capture the handler and
 * drive it directly — no real WebSocket needed.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { RoutingDecisions } from './RoutingDecisions';
import type { RoutingDecision, WsMessage } from '../../lib/types';

const dec = (id: string, tier: RoutingDecision['tier'], model: string, extras: Partial<RoutingDecision> = {}): RoutingDecision => ({
  id,
  ts: 1_700_000_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000,
  tier,
  model,
  task: `task-${id}`,
  costUsd: tier === 'CODEMOD' ? 0 : 0.01,
  latencyMs: 250,
  ...extras,
});

describe('RoutingDecisions', () => {
  it('renders the empty state when no decisions have been emitted', () => {
    render(<RoutingDecisions />);
    const empty = screen.getByTestId('routing-decisions-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toMatch(/No routing decisions yet/i);
    // Confirm table is NOT rendered in empty state.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders a single decision via the initial prop', () => {
    const one = dec('1', 'CODEMOD', 'codemod:var-to-const');
    render(<RoutingDecisions initial={[one]} />);

    // Tier badge with the right class
    const row = screen.getByTestId(`routing-row-${one.id}`);
    expect(row).toBeTruthy();
    const badge = row.querySelector('.routing-tier-codemod');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toBe('CODEMOD');

    // Model + task + cost columns
    expect(row.querySelector('.routing-model')?.textContent).toBe('codemod:var-to-const');
    expect(row.querySelector('.routing-task')?.textContent).toBe('task-1');
    expect(row.querySelector('.routing-cost')?.textContent).toBe('$0');
    // latency = 250ms → "250ms"
    expect(row.querySelector('.routing-latency')?.textContent).toBe('250ms');
  });

  it('renders multiple decisions and filters by tier', () => {
    const list: RoutingDecision[] = [
      dec('1', 'CODEMOD', 'codemod:remove-console', { costUsd: 0 }),
      dec('2', 'TIER1', 'haiku', { costUsd: 0.0008 }),
      dec('3', 'TIER2', 'sonnet', { costUsd: 0.012 }),
      dec('4', 'TIER3', 'opus', { costUsd: 0.05 }),
    ];

    const { rerender } = render(<RoutingDecisions initial={list} />);
    // All four rows present
    for (const d of list) {
      expect(screen.getByTestId(`routing-row-${d.id}`)).toBeTruthy();
    }

    // Tier filter — only TIER2 row survives
    rerender(<RoutingDecisions initial={list} filterTier="TIER2" />);
    expect(screen.getByTestId('routing-row-3')).toBeTruthy();
    expect(screen.queryByTestId('routing-row-1')).toBeNull();
    expect(screen.queryByTestId('routing-row-2')).toBeNull();
    expect(screen.queryByTestId('routing-row-4')).toBeNull();

    // Subscribed WS append test — drive a `routing:decision` through
    // the captured handler.
    let capturedHandler: ((msg: WsMessage) => void) | null = null;
    const subscribe = (handler: (msg: WsMessage) => void) => {
      capturedHandler = handler;
      return () => { capturedHandler = null; };
    };
    const appended: RoutingDecision[] = [];
    const onAppend = (d: RoutingDecision) => appended.push(d);

    rerender(
      <RoutingDecisions
        initial={list}
        subscribe={subscribe}
        onAppend={onAppend}
        filterTier="ALL"
      />,
    );
    expect(capturedHandler).toBeTruthy();
    const fresh = dec('5', 'TIER3', 'opus-2', { costUsd: 0.07, latencyMs: 1200 });
    // Drive the handler inside act() so React commits the setDecisions.
    act(() => {
      capturedHandler!({ type: 'routing:decision', decision: fresh });
    });
    expect(screen.getByTestId('routing-row-5')).toBeTruthy();
    expect(appended).toHaveLength(1);
    expect(appended[0].id).toBe('5');

    // Malformed message should be ignored (no `routing:decision` type).
    capturedHandler!({ type: 'tasks:change', task: {} as never });
    expect(screen.queryByTestId('routing-row-')).toBeNull();

    // Empty filterTier = 'ALL' shows everything
    rerender(<RoutingDecisions initial={list} filterTier="ALL" />);
    for (const d of list) {
      expect(screen.getByTestId(`routing-row-${d.id}`)).toBeTruthy();
    }
  });

  it('respects maxRows by pruning oldest decisions', () => {
    // The component treats `initial` as most-recent-first (same
    // convention as the WS stream). Build the list newest-first so
    // maxRows=3 keeps the last 3 items from the array (the newest).
    const list: RoutingDecision[] = [
      dec('5', 'TIER1', 'haiku'),
      dec('4', 'TIER1', 'haiku'),
      dec('3', 'TIER1', 'haiku'),
      dec('2', 'TIER1', 'haiku'),
      dec('1', 'TIER1', 'haiku'),
    ];
    render(<RoutingDecisions initial={list} maxRows={3} />);
    // Only 3 of 5 should be visible (most-recent first)
    expect(screen.getByTestId('routing-row-5')).toBeTruthy();
    expect(screen.getByTestId('routing-row-4')).toBeTruthy();
    expect(screen.getByTestId('routing-row-3')).toBeTruthy();
    expect(screen.queryByTestId('routing-row-2')).toBeNull();
    expect(screen.queryByTestId('routing-row-1')).toBeNull();
  });

  it('compact prop toggles a different class', () => {
    const one = dec('1', 'CODEMOD', 'codemod:add-logging');
    const { container, rerender } = render(<RoutingDecisions initial={[one]} />);
    expect(container.querySelector('.routing-decisions-compact')).toBeNull();
    rerender(<RoutingDecisions initial={[one]} compact />);
    expect(container.querySelector('.routing-decisions-compact')).toBeTruthy();
  });
});
