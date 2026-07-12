import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusDot } from '../../../src/web/ui/feedback/StatusDot';

describe('StatusDot', () => {
  it('renders with the success color when variant=success', () => {
    const { container } = render(<StatusDot variant="success" />);
    expect(container.querySelector('.bizar-status-dot--success')).toBeInTheDocument();
  });

  it.each([
    ['neutral', 'bizar-status-dot--neutral'],
    ['info', 'bizar-status-dot--info'],
    ['warning', 'bizar-status-dot--warning'],
    ['danger', 'bizar-status-dot--danger'],
  ] as const)('applies the %s variant modifier', (variant, cls) => {
    const { container } = render(<StatusDot variant={variant} />);
    expect(container.querySelector(`.${cls}`)).toBeInTheDocument();
  });

  it('applies the pulse class when pulse is true', () => {
    const { container } = render(<StatusDot pulse />);
    expect(container.querySelector('.bizar-status-dot--pulse')).toBeInTheDocument();
  });

  it('applies the sm size class', () => {
    const { container } = render(<StatusDot size="sm" />);
    expect(container.querySelector('.bizar-status-dot--sm')).toBeInTheDocument();
  });

  it('uses role=status and aria-label when label is provided', () => {
    render(<StatusDot variant="success" label="Live" />);
    const dot = screen.getByRole('status');
    expect(dot).toHaveAttribute('aria-label', 'Live');
  });

  it('renders as a <span>', () => {
    const { container } = render(<StatusDot />);
    expect(container.querySelector('span.bizar-status-dot')).toBeInTheDocument();
  });
});
