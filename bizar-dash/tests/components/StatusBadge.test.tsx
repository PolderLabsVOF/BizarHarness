import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../../src/web/components/StatusBadge';

describe('StatusBadge', () => {
  it('renders with default neutral kind', () => {
    const { container } = render(<StatusBadge>Default</StatusBadge>);
    expect(container.firstChild).toHaveClass('badge');
    expect(container.firstChild).toHaveClass('badge-neutral');
  });

  it('renders with each variant class', () => {
    const variants = ['success', 'warning', 'error', 'info', 'accent'] as const;
    for (const kind of variants) {
      const { container, unmount } = render(<StatusBadge kind={kind}>{kind}</StatusBadge>);
      expect(container.firstChild).toHaveClass(`badge-${kind}`);
      unmount();
    }
  });

  it('renders children', () => {
    render(<StatusBadge>Active</StatusBadge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows dot element when dot prop is true', () => {
    const { container } = render(<StatusBadge dot>With dot</StatusBadge>);
    expect(container.querySelector('.badge-dot')).toBeInTheDocument();
  });

  it('does not show dot when dot prop is false', () => {
    const { container } = render(<StatusBadge>No dot</StatusBadge>);
    expect(container.querySelector('.badge-dot')).not.toBeInTheDocument();
  });
});
