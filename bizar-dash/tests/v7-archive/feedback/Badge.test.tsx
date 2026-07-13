import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from '../../../src/web/ui/feedback/Badge';

describe('Badge', () => {
  it('renders its children text', () => {
    render(<Badge>Beta</Badge>);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('applies the neutral variant by default', () => {
    const { container } = render(<Badge>x</Badge>);
    expect(container.querySelector('.bizar-badge--neutral')).toBeInTheDocument();
  });

  it.each([
    ['info', 'bizar-badge--info'],
    ['success', 'bizar-badge--success'],
    ['warning', 'bizar-badge--warning'],
    ['danger', 'bizar-badge--danger'],
    ['accent', 'bizar-badge--accent'],
  ] as const)('applies the %s variant modifier', (variant, cls) => {
    const { container } = render(<Badge variant={variant}>x</Badge>);
    expect(container.querySelector(`.${cls}`)).toBeInTheDocument();
  });

  it('applies the sm size modifier', () => {
    const { container } = render(<Badge size="sm">x</Badge>);
    expect(container.querySelector('.bizar-badge--sm')).toBeInTheDocument();
  });

  it('applies the md size by default', () => {
    const { container } = render(<Badge>x</Badge>);
    expect(container.querySelector('.bizar-badge--md')).toBeInTheDocument();
  });

  it('renders as a <span>', () => {
    const { container } = render(<Badge>x</Badge>);
    expect(container.querySelector('span.bizar-badge')).toBeInTheDocument();
  });
});
