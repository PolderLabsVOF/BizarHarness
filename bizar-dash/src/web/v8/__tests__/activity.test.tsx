import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GitMerge } from 'lucide-react';
import { ActivityFeed, type ActivityItem } from '../ui/activity/ActivityFeed';

const items: ActivityItem[] = [
  {
    id: 'a1',
    icon: <GitMerge size={14} aria-hidden="true" />,
    title: 'Merged PR #42',
    description: 'Add OKLch token system',
    meta: '2m ago',
    tone: 'success',
  },
  {
    id: 'a2',
    title: 'Agent run started',
    description: 'Atlas — "Wire v8 routing"',
    meta: '5m ago',
    tone: 'info',
  },
  {
    id: 'a3',
    title: 'CI failed',
    description: 'tests/a11y/forms.test.tsx',
    meta: '1h ago',
    tone: 'danger',
  },
];

describe('ActivityFeed', () => {
  it('renders all items with title and meta', () => {
    render(<ActivityFeed items={items} />);
    expect(screen.getByText(/Merged PR #42/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent run started/i)).toBeInTheDocument();
    expect(screen.getByText(/CI failed/i)).toBeInTheDocument();
    expect(screen.getByText(/2m ago/i)).toBeInTheDocument();
    expect(screen.getByText(/5m ago/i)).toBeInTheDocument();
    expect(screen.getByText(/1h ago/i)).toBeInTheDocument();
  });

  it('renders as an ordered list', () => {
    const { container } = render(<ActivityFeed items={items} />);
    expect(container.querySelector('ol')).not.toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('shows descriptions when provided', () => {
    render(<ActivityFeed items={items} />);
    expect(screen.getByText(/Add OKLch token system/i)).toBeInTheDocument();
    expect(screen.getByText(/Atlas — "Wire v8 routing"/i)).toBeInTheDocument();
  });

  it('renders the empty node when no items', () => {
    render(<ActivityFeed items={[]} empty={<div>All quiet.</div>} />);
    expect(screen.getByText(/All quiet\./i)).toBeInTheDocument();
  });

  it('hides description when not provided', () => {
    render(<ActivityFeed items={[{ id: 'a', title: 'Single' }]} />);
    expect(screen.getByText(/single/i)).toBeInTheDocument();
  });
});