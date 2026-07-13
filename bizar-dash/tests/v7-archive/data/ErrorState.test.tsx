// tests/ui/data/ErrorState.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ErrorState } from '../../../src/web/ui/data/ErrorState';

describe('ErrorState', () => {
  it('renders the default title when none is provided', () => {
    render(<ErrorState error="boom" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders a custom title', () => {
    render(<ErrorState title="Custom title" error="boom" />);
    expect(screen.getByText('Custom title')).toBeInTheDocument();
  });

  it('renders the string error', () => {
    render(<ErrorState error="Network unreachable" />);
    expect(screen.getByText('Network unreachable')).toBeInTheDocument();
  });

  it('renders the Error.message when given an Error', () => {
    render(<ErrorState error={new Error('Service down')} />);
    expect(screen.getByText('Service down')).toBeInTheDocument();
  });

  it('falls back to Error.name when message is empty', () => {
    const e = new Error();
    e.name = 'FatalError';
    render(<ErrorState error={e} />);
    expect(screen.getByText('FatalError')).toBeInTheDocument();
  });

  it('fires onRetry when the retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorState error="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has role=alert', () => {
    render(<ErrorState error="boom" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
