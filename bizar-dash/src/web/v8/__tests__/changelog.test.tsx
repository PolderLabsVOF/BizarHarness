import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { ActivityView } from '../views/Activity/ActivityView.js';

// Stub `useFetch` + `useWsMessage` so we can drive the view from a
// fixed event list. This keeps the test hermetic.
const EVENT_LIST = [
  { id: 'e1', kind: 'task.completed', title: 'Ship dashboard', description: 'v8 cutover', ts: Date.now() - 60_000, meta: { actor: 'sam' } },
  { id: 'e2', kind: 'agent.run', title: 'Atlas started work', description: 'Wire v8', ts: Date.now() - 30_000, meta: { actor: 'atlas' } },
  { id: 'e3', kind: 'git.merge', title: 'Merged PR #57', description: 'kanban redo', ts: Date.now() - 3_600_000 },
  { id: 'e4', kind: 'goal.status', title: 'Ship v8 dashboard — at-risk', ts: Date.now() - 7_200_000 },
  { id: 'e5', kind: 'settings.changed', title: 'Theme: dark', ts: Date.now() - 5 * 86_400_000 },
];

vi.mock('../data/useFetch.js', () => ({
  useFetch: () => ({ data: { events: EVENT_LIST }, error: null, loading: false, refetch: () => {} }),
}));

vi.mock('../data/useWebSocket.js', () => ({
  useWsMessage: () => {},
}));

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('ActivityView (visual changelog)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the Today / Yesterday / day labels', () => {
    render(<Providers><ActivityView /></Providers>);
    expect(screen.getByRole('heading', { name: /^Today$/ })).toBeInTheDocument();
    expect(screen.getByText(/Merged PR #57/i)).toBeInTheDocument();
    expect(screen.getByText(/Ship v8 dashboard — at-risk/i)).toBeInTheDocument();
    // The settings event is 5 days old, so it should appear under "5 days ago".
    expect(screen.getByText(/5 days ago/i)).toBeInTheDocument();
  });

  it('shows source filter chips with counts', () => {
    render(<Providers><ActivityView /></Providers>);
    // All + Tasks + Agents + Goals + Settings + Git + System chips.
    expect(screen.getByRole('button', { name: /^All \(5\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Tasks \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Agents \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Goals \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Git \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Settings \(1\)/ })).toBeInTheDocument();
  });

  it('filters to the clicked source chip', () => {
    render(<Providers><ActivityView /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: /^Tasks \(1\)/ }));
    // After filtering, only the task event title remains.
    expect(screen.getByText(/Ship dashboard/i)).toBeInTheDocument();
    expect(screen.queryByText(/Atlas started work/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Merged PR #57/i)).not.toBeInTheDocument();
  });

  it('toggles live tail switch (label updates)', () => {
    render(<Providers><ActivityView /></Providers>);
    const sw = screen.getByRole('switch', { name: /Live tail/i });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(sw).not.toBeChecked();
  });

  it('renders the Export NDJSON button', () => {
    render(<Providers><ActivityView /></Providers>);
    expect(screen.getByRole('button', { name: /Export NDJSON/i })).toBeInTheDocument();
  });
});
