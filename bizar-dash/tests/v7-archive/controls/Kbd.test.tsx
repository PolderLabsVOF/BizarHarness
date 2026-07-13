import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Kbd } from '../../../src/web/ui/controls/Kbd';

describe('Kbd', () => {
  it('renders its children as text content', () => {
    render(<Kbd>K</Kbd>);
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('renders a <kbd> element with the kbd class', () => {
    const { container } = render(<Kbd>X</Kbd>);
    const el = container.querySelector('kbd');
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('kbd');
  });

  it('passes through HTML attributes', () => {
    render(
      <Kbd id="shortcut-1" data-testid="k">
        ⌘
      </Kbd>,
    );
    const el = screen.getByTestId('k');
    expect(el.id).toBe('shortcut-1');
    expect(el.tagName).toBe('KBD');
  });

  it('combines user className with the kbd class via cx', () => {
    render(
      <Kbd data-testid="k" className="extra">
        K
      </Kbd>,
    );
    const el = screen.getByTestId('k');
    expect(el).toHaveClass('kbd');
    expect(el).toHaveClass('extra');
  });
});
