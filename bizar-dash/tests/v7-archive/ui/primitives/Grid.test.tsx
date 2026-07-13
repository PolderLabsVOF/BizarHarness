import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Grid } from '../../../src/web/ui/primitives/Grid';

describe('Grid', () => {
  it('renders a grid container with default 1 column', () => {
    render(<Grid data-testid="g" />);
    const el = screen.getByTestId('g');
    expect(el).toHaveClass('grid', 'cols-1');
  });

  it('applies the requested column count class', () => {
    render(<Grid cols={3} data-testid="g" />);
    expect(screen.getByTestId('g')).toHaveClass('cols-3');
  });

  it('applies gap class from prop', () => {
    render(<Grid cols={2} gap={5} data-testid="g" />);
    expect(screen.getByTestId('g')).toHaveClass('gap-5');
  });

  it('switches to autoFit class when autoFit is true', () => {
    render(<Grid autoFit cols={4} data-testid="g" />);
    const el = screen.getByTestId('g');
    expect(el).toHaveClass('grid-autofit');
    expect(el).not.toHaveClass('cols-4');
  });

  it('renders children inside the grid', () => {
    render(
      <Grid>
        <div data-testid="cell">x</div>
      </Grid>,
    );
    expect(screen.getByTestId('cell')).toBeInTheDocument();
  });
});
