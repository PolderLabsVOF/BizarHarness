import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Topbar } from '../../../src/web/ui/layout/Topbar';

describe('Topbar', () => {
  it('renders brand, center, and right slots', () => {
    render(
      <Topbar
        brand={<span>Bizar</span>}
        center={<input placeholder="Search" />}
        right={<button>Account</button>}
      />,
    );
    expect(screen.getByText('Bizar')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('applies sticky modifier by default', () => {
    const { container } = render(<Topbar brand={<span>B</span>} />);
    const topbar = container.querySelector('.bizar-topbar');
    expect(topbar?.className).toContain('bizar-topbar--sticky');
  });

  it('removes sticky class when sticky=false', () => {
    const { container } = render(<Topbar brand={<span>B</span>} sticky={false} />);
    const topbar = container.querySelector('.bizar-topbar');
    expect(topbar?.className).not.toContain('bizar-topbar--sticky');
  });

  it('applies a custom height via inline style', () => {
    const { container } = render(<Topbar brand={<span>B</span>} height={64} />);
    const topbar = container.querySelector('.bizar-topbar') as HTMLElement;
    expect(topbar.style.height).toBe('64px');
  });

  it('renders with role="banner"', () => {
    render(<Topbar brand={<span>B</span>} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
