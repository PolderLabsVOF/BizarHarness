import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Separator } from '../../../src/web/ui/primitives/Separator';

describe('Separator', () => {
  it('renders an <hr> by default in horizontal orientation', () => {
    const { container } = render(<Separator />);
    const hr = container.querySelector('hr');
    expect(hr).toBeInTheDocument();
    expect(hr).toHaveClass('separator');
  });

  it('applies the vertical orientation class to <hr>', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const hr = container.querySelector('hr');
    expect(hr).toHaveClass('separator-vertical');
  });

  it('renders a labelled separator as a div with role=separator', () => {
    const { container } = render(<Separator label="OR" />);
    const el = container.querySelector('[role="separator"]');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('separator-with-label');
    expect(el).toHaveTextContent('OR');
  });

  it('sets aria-orientation on the labelled variant', () => {
    const { container } = render(
      <Separator label="AND" orientation="horizontal" />,
    );
    const el = container.querySelector('[role="separator"]');
    expect(el?.getAttribute('aria-orientation')).toBe('horizontal');
  });
});
