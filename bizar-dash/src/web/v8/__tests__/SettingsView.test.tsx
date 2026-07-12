import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { SettingsView } from '../views/Settings/SettingsView.js';

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('SettingsView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders all 16 sections', () => {
    render(<Providers><SettingsView /></Providers>);
    for (const title of [
      'General',
      'Theme',
      'Density',
      'Density rules',
      'Command palette',
      'Keyboard',
      'Notifications',
      'Storage',
      'Plugins',
      'MCP servers',
      'Skills',
      'Hooks',
      'Activity',
      'Memory',
      'Privacy',
      'Advanced',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${title}$`, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the active nav item with aria-current', () => {
    render(<Providers><SettingsView /></Providers>);
    const generalNav = screen.getByRole('button', { name: /^General$/i });
    expect(generalNav).toHaveAttribute('aria-current', 'true');
  });

  it('clicking a left-rail nav entry calls scrollIntoView on the section element', async () => {
    const user = userEvent.setup();
    // Spy on Element.prototype.scrollIntoView so we can assert the call.
    const scrollSpy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    try {
      render(<Providers><SettingsView /></Providers>);
      const themeNav = screen.getByRole('button', { name: /^Theme$/i });
      await user.click(themeNav);
      // handleSelect uses requestAnimationFrame — flush it.
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      expect(scrollSpy).toHaveBeenCalled();
      const arg = scrollSpy.mock.calls[0]?.[0] as ScrollIntoViewOptions | undefined;
      expect(arg?.behavior).toBe('smooth');
      expect(arg?.block).toBe('start');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('updates activeId when a different nav item is clicked', async () => {
    const user = userEvent.setup();
    render(<Providers><SettingsView /></Providers>);
    const densityNav = screen.getByRole('button', { name: /^Density$/i });
    await user.click(densityNav);
    expect(densityNav).toHaveAttribute('aria-current', 'true');
    const generalNav = screen.getByRole('button', { name: /^General$/i });
    expect(generalNav).not.toHaveAttribute('aria-current');
  });
});