// tests/ui/data/BarChart.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BarChart } from '../../../src/web/ui/data/BarChart';

const DATA = [
  { label: 'Tasks', value: 12 },
  { label: 'Agents', value: 4 },
  { label: 'Mods', value: 8, color: 'var(--chart-2)' },
];

describe('BarChart', () => {
  it('renders one row per datum with label + value', () => {
    render(<BarChart data={DATA} />);
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(screen.getByText('Mods')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('bar widths are scaled to the max value when maxValue is omitted', () => {
    const { container } = render(<BarChart data={DATA} />);
    const bars = container.querySelectorAll('.bd-bar-chart__bar');
    expect(bars.length).toBe(3);
    const widths = Array.from(bars).map((b) => b.getAttribute('style') ?? '');
    // Tasks 12 → 100%, Agents 4 → ~33.3%, Mods 8 → ~66.7%.
    // Floating-point rounding means the exact substring may have many
    // decimals, so use coarse matches.
    expect(widths[0]).toMatch(/width:\s*100(?:\.0+)?%/);
    expect(widths[1]).toMatch(/width:\s*33\.3+%/);
    expect(widths[2]).toMatch(/width:\s*66\.6+%/);
  });

  it('honours an explicit maxValue', () => {
    const { container } = render(<BarChart data={DATA} maxValue={24} />);
    const first = container.querySelector('.bd-bar-chart__bar');
    expect(first?.getAttribute('style')).toContain('50%');
  });

  it('applies per-bar colour overrides', () => {
    const { container } = render(<BarChart data={DATA} />);
    const bars = container.querySelectorAll('.bd-bar-chart__bar');
    expect(bars[0]).toHaveStyle({ background: 'var(--chart-1)' });
    expect(bars[2]).toHaveStyle({ background: 'var(--chart-2)' });
  });

  it('hides labels and value header when showLabels is false', () => {
    render(<BarChart data={DATA} showLabels={false} />);
    expect(screen.queryByText('Tasks')).toBeNull();
    expect(screen.queryByText('12')).toBeNull();
  });
});
