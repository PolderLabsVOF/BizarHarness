// tests/ui/navigation/NavLink.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Home } from 'lucide-react';
import { NavLink } from '../../../src/web/ui/navigation/NavLink';

describe('NavLink', () => {
  it('renders an <a> when href is provided', () => {
    render(<NavLink icon={Home} label="Home" href="/home" />);
    const anchor = screen.getByRole('link', { name: /home/i });
    expect(anchor.tagName).toBe('A');
    expect(anchor).toHaveAttribute('href', '/home');
  });

  it('renders a <button> when only onClick is provided', () => {
    const onClick = vi.fn();
    render(<NavLink icon={Home} label="Trigger" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /trigger/i });
    expect(btn.tagName).toBe('BUTTON');
  });

  it('fires onClick when the button is clicked', async () => {
    const onClick = vi.fn();
    render(<NavLink icon={Home} label="X" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: /x/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders a <div> when neither href nor onClick is provided', () => {
    const { container } = render(<NavLink icon={Home} label="Plain" />);
    const link = container.querySelector('.bd-nav-link');
    expect(link).toBeInTheDocument();
    expect(link?.tagName).toBe('DIV');
  });

  it('applies active state styling', () => {
    const { container } = render(
      <NavLink icon={Home} label="Active" href="/x" active />,
    );
    expect(container.querySelector('.bd-nav-link--active')).toBeInTheDocument();
    const anchor = screen.getByRole('link');
    expect(anchor).toHaveAttribute('aria-current', 'page');
  });

  it('renders a badge when supplied', () => {
    render(<NavLink icon={Home} label="Tasks" href="/t" badge={7} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('applies disabled state and blocks navigation', () => {
    const { container } = render(
      <NavLink icon={Home} label="Locked" href="/locked" disabled />,
    );
    const anchor = container.querySelector('a')!;
    expect(anchor).toHaveAttribute('aria-disabled', 'true');
    expect(anchor.getAttribute('href')).toBeNull();
    expect(anchor).toHaveClass('bd-nav-link--disabled');
  });
});
