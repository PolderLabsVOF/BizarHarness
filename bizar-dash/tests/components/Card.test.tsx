import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Card, CardTitle, CardMeta } from '../../src/web/components/Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Hello</Card>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('has expected class name', () => {
    const { container } = render(<Card>Test</Card>);
    expect(container.firstChild).toHaveClass('card');
  });

  it('applies variant classes', () => {
    const { container, rerender } = render(<Card variant="elevated">Test</Card>);
    expect(container.firstChild).toHaveClass('card-elevated');

    rerender(<Card variant="outlined">Test</Card>);
    expect(container.firstChild).toHaveClass('card-outlined');

    rerender(<Card variant="filled">Test</Card>);
    expect(container.firstChild).toHaveClass('card-filled');
  });

  it('renders CardTitle and CardMeta', () => {
    render(
      <Card>
        <CardTitle>My Title</CardTitle>
        <CardMeta>Meta info</CardMeta>
      </Card>,
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
    expect(screen.getByText('Meta info')).toBeInTheDocument();
  });

  it('sets interactive class when interactive prop is true', () => {
    const { container } = render(<Card interactive>Clickable</Card>);
    expect(container.firstChild).toHaveClass('card-interactive');
  });
});
