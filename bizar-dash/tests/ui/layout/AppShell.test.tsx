import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AppShell } from '../../../src/web/ui/layout/AppShell';

describe('AppShell', () => {
  it('renders topbar, sidebar, and main content', () => {
    render(
      <AppShell
        topbar={<div>Topbar slot</div>}
        sidebar={<div>Sidebar slot</div>}
      >
        <div>Page body</div>
      </AppShell>,
    );
    expect(screen.getByText('Topbar slot')).toBeInTheDocument();
    expect(screen.getByText('Sidebar slot')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
  });

  it('applies the collapsed modifier when sidebarCollapsed=true', () => {
    const { container } = render(
      <AppShell sidebar={<div>Sidebar slot</div>} sidebarCollapsed>
        <div>Body</div>
      </AppShell>,
    );
    const sidebar = container.querySelector('.bizar-app-shell__sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(sidebar?.className).toContain('bizar-app-shell__sidebar--collapsed');
    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders without a sidebar when none provided', () => {
    const { container } = render(<AppShell>Body only</AppShell>);
    expect(
      container.querySelector('.bizar-app-shell__sidebar'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Body only')).toBeInTheDocument();
  });

  it('places children inside the main content area', () => {
    const { container } = render(
      <AppShell>
        <p>In main</p>
      </AppShell>,
    );
    const main = container.querySelector('.bizar-app-shell__main');
    expect(main).toBeInTheDocument();
    expect(main?.contains(screen.getByText('In main'))).toBe(true);
  });
});
