import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from '../../../src/web/ui/primitives/VisuallyHidden';

describe('VisuallyHidden', () => {
  it('renders its children inside a span', () => {
    render(<VisuallyHidden>hidden text</VisuallyHidden>);
    const el = screen.getByText('hidden text');
    expect(el.tagName).toBe('SPAN');
  });

  it('applies the vh class for SR-only styling', () => {
    render(<VisuallyHidden>sr-only</VisuallyHidden>);
    expect(screen.getByText('sr-only')).toHaveClass('vh');
  });

  it('passes additional attributes through to the span', () => {
    render(
      <VisuallyHidden id="vh-1" data-testid="vh">
        x
      </VisuallyHidden>,
    );
    const el = screen.getByTestId('vh');
    expect(el.id).toBe('vh-1');
    expect(el).toHaveClass('vh');
  });
});
