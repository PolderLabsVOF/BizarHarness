import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Inline } from '../../../src/web/ui/primitives/Inline';

describe('Inline', () => {
  it('renders as a row with wrap by default', () => {
    const { container } = render(<Inline data-testid="i">a</Inline>);
    const el = screen.getByTestId('i');
    expect(el).toHaveClass('inline', 'wrap');
    expect(el).not.toHaveClass('inline-col');
  });

  it('uses gap-3 by default', () => {
    render(<Inline data-testid="i" />);
    expect(screen.getByTestId('i')).toHaveClass('gap-3');
  });

  it('switches direction to column', () => {
    render(<Inline direction="column" data-testid="i" />);
    expect(screen.getByTestId('i')).toHaveClass('inline-col');
  });

  it('applies nowrap when wrap is false', () => {
    render(<Inline wrap={false} data-testid="i" />);
    expect(screen.getByTestId('i')).toHaveClass('nowrap');
  });

  it('forwards alignment props', () => {
    render(<Inline align="baseline" justify="end" data-testid="i" />);
    const el = screen.getByTestId('i');
    expect(el).toHaveClass('align-baseline', 'justify-end');
  });
});
