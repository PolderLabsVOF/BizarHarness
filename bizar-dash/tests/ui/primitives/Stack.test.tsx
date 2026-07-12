import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stack } from '../../../src/web/ui/primitives/Stack';

describe('Stack', () => {
  it('renders a column by default with gap-3', () => {
    const { container } = render(
      <Stack data-testid="s">
        <span>a</span>
      </Stack>,
    );
    const el = screen.getByTestId('s');
    expect(el).toHaveClass('stack');
    expect(el).toHaveClass('gap-3');
  });

  it('switches to row direction', () => {
    const { container } = render(<Stack direction="row" data-testid="s" />);
    expect(screen.getByTestId('s')).toHaveClass('stack-row');
  });

  it('applies alignment and justify modifiers', () => {
    const { container } = render(
      <Stack align="center" justify="between" data-testid="s" />,
    );
    const el = screen.getByTestId('s');
    expect(el).toHaveClass('align-center', 'justify-between');
  });

  it('enables flex-wrap when wrap is true', () => {
    const { container } = render(<Stack wrap data-testid="s" />);
    expect(screen.getByTestId('s')).toHaveClass('wrap');
  });

  it('renders children inside the flex container', () => {
    render(
      <Stack>
        <span data-testid="c1">a</span>
        <span data-testid="c2">b</span>
      </Stack>,
    );
    expect(screen.getByTestId('c1')).toBeInTheDocument();
    expect(screen.getByTestId('c2')).toBeInTheDocument();
  });
});
