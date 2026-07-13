// tests/ui/data/Sparkline.test.tsx — Wave 2B

import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Sparkline } from '../../../src/web/ui/data/Sparkline';

describe('Sparkline', () => {
  it('renders an svg with the configured width/height/viewBox', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3, 4, 5]} width={120} height={30} />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '120');
    expect(svg).toHaveAttribute('height', '30');
    expect(svg).toHaveAttribute('viewBox', '0 0 120 30');
    expect(svg).toHaveAttribute('role', 'img');
  });

  it('draws a line + area path with non-empty `d`', () => {
    const { container } = render(<Sparkline data={[2, 4, 1, 7, 3]} />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
    const line = container.querySelector('.bd-sparkline__line');
    const area = container.querySelector('.bd-sparkline__fill');
    expect(line?.getAttribute('d')).toMatch(/^M/);
    expect(area?.getAttribute('d')).toMatch(/^M/);
  });

  it('renders nothing when data is empty (no paths)', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelectorAll('path').length).toBe(0);
  });

  it('applies the supplied stroke / fill colours', () => {
    const { container } = render(
      <Sparkline
        data={[1, 2, 3]}
        stroke="var(--chart-2)"
        fill="var(--info-subtle)"
      />,
    );
    const line = container.querySelector('.bd-sparkline__line');
    const area = container.querySelector('.bd-sparkline__fill');
    expect(line).toHaveAttribute('stroke', 'var(--chart-2)');
    expect(area).toHaveAttribute('fill', 'var(--info-subtle)');
  });

  it('accepts a custom aria-label', () => {
    const { container } = render(
      <Sparkline data={[1, 2, 3]} ariaLabel="Latency over time" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Latency over time');
  });
});
