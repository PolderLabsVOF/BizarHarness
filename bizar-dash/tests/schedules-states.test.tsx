/**
 * bizar-dash/tests/schedules-states.test.tsx
 *
 * Exercises the three primary render branches of SchedulesView:
 * loading (Skeleton), error (ErrorState), and empty (EmptyState),
 * plus edge cases for the standalone EmptyState / ErrorState components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

// ─── Mock Sheet before importing SchedulesView ────────────────────────────────
// SchedulesView imports Sheet which uses Radix dialog — mock it to avoid
// useLayoutEffect SSR warnings and simplify the tree.
vi.mock('../src/web/v8/ui/feedback/Sheet.js', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── SchedulesView imports ─────────────────────────────────────────────────────
import { SchedulesView } from '../src/web/v8/views/Schedules/SchedulesView.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const defaultSched = [
  {
    id: 's1',
    name: 'Daily digest',
    type: 'cron' as const,
    schedule: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRun: null,
    lastResult: null,
    lastError: null,
    nextRun: new Date(Date.now() + 86400000).toISOString(),
    action: { type: 'agent' as const, prompt: 'Run the daily digest' },
  },
];

// ─── Branch: loading ───────────────────────────────────────────────────────────

describe('loading branch', () => {
  beforeEach(() => {
    // Never resolves — useFetch stays in loading state.
    global.fetch = vi.fn(() => new Promise(() => {}));
  });

  afterEach(() => { global.fetch = vi.fn(); });

  it('shows Skeleton while fetching and no live data', async () => {
    render(<SchedulesView />);
    await waitFor(() => document.querySelector('[class*="skeleton"]'));
    expect(document.querySelector('[class*="skeleton"]')).toBeInTheDocument();
  });
});

// ─── Branch: error ─────────────────────────────────────────────────────────────

describe('error branch', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.reject(new Error('Network failure')));
  });

  afterEach(() => { global.fetch = vi.fn(); });

  it('shows ErrorState when the fetch rejects', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByTestId('error-state'));
    expect(screen.getByTestId('error-state')).toBeInTheDocument();
  });

  it('ErrorState retry button triggers refetch', async () => {
    const user = userEvent.setup();
    render(<SchedulesView />);
    await waitFor(() => screen.getByTestId('error-state'));
    // Initially one fetch call (rejected), refetch should trigger a second call.
    await user.click(screen.getByTestId('error-state-retry'));
    await waitFor(() => {
      // fetch was called at least twice: initial + one retry
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ─── Branch: empty ─────────────────────────────────────────────────────────────

describe('empty branch', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => { global.fetch = vi.fn(); });

  it('shows EmptyState when fetch returns an empty array', async () => {
    render(<SchedulesView />);
    await waitFor(() => screen.getByText(/no schedules/i));
    expect(screen.getByText(/no schedules/i)).toBeInTheDocument();
  });

  it('shows schedule list when fetch returns data', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(defaultSched), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(<SchedulesView />);
    await waitFor(() => screen.getByText('Daily digest'));
    expect(screen.getByText('Daily digest')).toBeInTheDocument();
  });
});

// ─── Edge: ErrorState standalone ──────────────────────────────────────────────

import { ErrorState } from '../src/web/v8/ui/feedback/ErrorState.js';

describe('ErrorState component edges', () => {
  it('renders without crashing when error is null', () => {
    const { container } = render(<ErrorState error={null} onRetry={() => {}} />);
    expect(container).toBeTruthy();
  });

  it('renders without crashing when error is an Error instance', () => {
    const { container } = render(
      <ErrorState error={new Error('oops')} onRetry={() => {}} />,
    );
    expect(container).toBeTruthy();
  });

  it('renders without crashing when error is a plain string', () => {
    const { container } = render(
      <ErrorState error="plain string error" onRetry={() => {}} />,
    );
    expect(container).toBeTruthy();
  });
});

// ─── Edge: EmptyState standalone ───────────────────────────────────────────────

import { EmptyState } from '../src/web/v8/ui/feedback/EmptyState.js';

describe('EmptyState component edges', () => {
  it('renders with minimal props (title only)', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container).toBeTruthy();
  });

  it('renders with icon, title, and description', () => {
    const { getByText } = render(
      <EmptyState
        icon={<span data-testid="mock-icon" />}
        title="No results"
        description="Try a different filter."
      />,
    );
    expect(getByText('No results')).toBeInTheDocument();
    expect(getByText('Try a different filter.')).toBeInTheDocument();
  });
});
