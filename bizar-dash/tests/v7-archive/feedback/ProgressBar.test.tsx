import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from '../../../src/web/ui/feedback/ProgressBar';

describe('ProgressBar', () => {
  it('renders with role="progressbar"', () => {
    render(<ProgressBar value={50} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('reports aria-valuenow/aria-valuemin/aria-valuemax', () => {
    render(<ProgressBar value={40} max={200} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '200');
  });

  it('renders the fill at the correct percentage width', () => {
    const { container } = render(<ProgressBar value={25} max={100} />);
    const fill = container.querySelector('.bizar-progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('clamps value to max', () => {
    const { container } = render(<ProgressBar value={150} max={100} />);
    const fill = container.querySelector('.bizar-progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('clamps value to 0 (negative input)', () => {
    const { container } = render(<ProgressBar value={-10} />);
    const fill = container.querySelector('.bizar-progress__fill') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('omits aria-valuenow for indeterminate', () => {
    render(<ProgressBar indeterminate />);
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  it('applies the indeterminate modifier class', () => {
    const { container } = render(<ProgressBar indeterminate />);
    expect(
      container.querySelector('.bizar-progress--indeterminate'),
    ).toBeInTheDocument();
  });

  it('applies a size modifier', () => {
    const { container } = render(<ProgressBar size="lg" />);
    expect(container.querySelector('.bizar-progress--lg')).toBeInTheDocument();
  });

  it('renders the label above the bar when provided', () => {
    render(<ProgressBar value={10} label="Uploading" />);
    expect(screen.getByText('Uploading')).toBeInTheDocument();
  });

  it('applies a variant modifier to the fill', () => {
    const { container } = render(<ProgressBar variant="danger" />);
    expect(
      container.querySelector('.bizar-progress__fill--danger'),
    ).toBeInTheDocument();
  });
});
