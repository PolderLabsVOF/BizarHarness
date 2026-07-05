import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Spinner } from '../../src/web/components/Spinner';

describe('Spinner', () => {
  it('renders with default size', () => {
    const { container } = render(<Spinner />);
    const spinner = container.firstChild;
    expect(spinner).toHaveClass('spinner');
    expect(spinner).toHaveClass('spinner-md');
  });

  it('renders with custom size', () => {
    const { container } = render(<Spinner size="lg" />);
    expect(container.firstChild).toHaveClass('spinner-lg');
  });

  it('has role="status" for accessibility', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has default aria-label', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
  });

  it('accepts a custom aria-label', () => {
    render(<Spinner label="Please wait" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Please wait');
  });
});
