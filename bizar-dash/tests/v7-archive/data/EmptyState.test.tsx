// tests/ui/data/EmptyState.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Inbox } from 'lucide-react';
import { EmptyState } from '../../../src/web/ui/data/EmptyState';

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <EmptyState
        title="Empty"
        description="Add a thing to get started"
      />,
    );
    expect(screen.getByText('Add a thing to get started')).toBeInTheDocument();
  });

  it('renders a custom icon when provided', () => {
    render(
      <EmptyState
        title="Empty"
        icon={<Inbox data-testid="empty-icon" />}
      />,
    );
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('renders a default lucide icon when none is provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // Default is a Cloud icon — assert the icon slot exists at minimum.
    expect(container.querySelector('.bd-state__icon')).toBeInTheDocument();
  });

  it('renders an action button that fires onClick', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add item', onClick }}
      />,
    );
    await userEvent.click(screen.getByText('Add item'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('supports inline mode (no large centred padding)', () => {
    const { container } = render(<EmptyState title="Empty" inline />);
    expect(container.querySelector('.bd-state--inline')).toBeInTheDocument();
  });
});
