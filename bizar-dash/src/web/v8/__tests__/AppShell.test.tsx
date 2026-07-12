import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { AppShell } from '../shell/AppShell.js';

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('AppShell', () => {
  it('renders a <main id="main"> landmark', () => {
    render(
      <Providers>
        <AppShell>
          <p>body content</p>
        </AppShell>
      </Providers>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
  });

  it('makes <main> programmatically focusable (tabIndex={-1})', () => {
    render(
      <Providers>
        <AppShell>
          <p>body</p>
        </AppShell>
      </Providers>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('forwards ref to the <main> element', () => {
    let captured: HTMLElement | null = null;
    render(
      <Providers>
        <AppShell
          ref={(el) => {
            captured = el;
          }}
        >
          <p>body</p>
        </AppShell>
      </Providers>,
    );
    expect(captured).not.toBeNull();
    expect(captured?.tagName).toBe('MAIN');
  });

  it('renders Topbar by default when no topbar prop is given', () => {
    render(
      <Providers>
        <AppShell>
          <p>body</p>
        </AppShell>
      </Providers>,
    );
    // Topbar renders a <header role="banner">.
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders Sidebar by default when no sidebar prop is given', () => {
    render(
      <Providers>
        <AppShell>
          <p>body</p>
        </AppShell>
      </Providers>,
    );
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });
});