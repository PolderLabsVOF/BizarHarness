import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryVault, type MemoryEntry } from '../ui/memory/MemoryVault';

const entries: MemoryEntry[] = [
  {
    id: 'm1',
    content: 'The dashboard rewrite runs on the v8 component tree under `bizar-dash/src/web/v8/`.',
    tags: ['dashboard', 'rewrite'],
    scope: 'project',
    updatedAt: 'Just now',
  },
  {
    id: 'm2',
    content: 'User prefers OKLch colors and minimal visual flair. Token-driven styling only.',
    tags: ['preferences'],
    scope: 'global',
    updatedAt: '3 days ago',
  },
];

describe('MemoryVault', () => {
  it('renders every entry with content and updatedAt', () => {
    render(<MemoryVault entries={entries} />);
    expect(
      screen.getByText(/The dashboard rewrite runs on the v8 component tree/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/User prefers OKLch colors and minimal visual flair/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/just now/i)).toBeInTheDocument();
    expect(screen.getByText(/3 days ago/i)).toBeInTheDocument();
  });

  it('shows scope badges (Project / Global)', () => {
    render(<MemoryVault entries={entries} />);
    expect(screen.getByText(/^Project$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Global$/i)).toBeInTheDocument();
  });

  it('renders tags when provided', () => {
    render(<MemoryVault entries={entries} />);
    expect(screen.getByText(/^dashboard$/i)).toBeInTheDocument();
    expect(screen.getByText(/^preferences$/i)).toBeInTheDocument();
  });

  it('invokes onOpen with the clicked entry', async () => {
    const onOpen = vi.fn();
    render(<MemoryVault entries={entries} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /The dashboard rewrite/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
  });

  it('renders the empty node when no entries', () => {
    render(<MemoryVault entries={[]} empty={<div>No memos yet.</div>} />);
    expect(screen.getByText(/No memos yet\./i)).toBeInTheDocument();
  });
});