// tests/ui/data/LoadingState.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoadingState } from '../../../src/web/ui/data/LoadingState';

describe('LoadingState', () => {
  it('renders the configured number of skeleton rows', () => {
    const { container } = render(<LoadingState rows={5} />);
    const bars = container.querySelectorAll('.bd-skeleton-row__bar');
    expect(bars.length).toBe(5);
  });

  it('defaults to 3 skeleton rows when rows is omitted', () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelectorAll('.bd-skeleton-row__bar').length).toBe(3);
  });

  it('renders a spinner + label when rows is set to 0', () => {
    const { container } = render(<LoadingState rows={0} label="Loading…" />);
    expect(container.querySelector('.bd-spinner')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders both label and skeleton rows when rows is positive', () => {
    render(<LoadingState rows={2} label="Loading…" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    const bars = document.querySelectorAll('.bd-skeleton-row__bar');
    expect(bars.length).toBe(2);
  });

  it('exposes role=status with aria-label', () => {
    render(<LoadingState rows={0} label="Fetching…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Fetching…');
  });
});
