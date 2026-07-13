import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { App } from '../App.js';

function Providers({
  children,
  theme = 'dark',
}: {
  children: React.ReactNode;
  theme?: 'light' | 'dark' | 'system';
}): JSX.Element {
  return (
    <ThemeProvider defaultMode={theme}>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders the Overview view by default', async () => {
    render(
      <Providers>
        <App />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /overview/i })).toBeInTheDocument();
    });
  });

  it('clicking a sidebar item swaps the main view', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App />
      </Providers>,
    );
    // Initial view loads asynchronously (Suspense-lazy), wait for it.
    await screen.findByRole('heading', { level: 1, name: /overview/i });

    await user.click(screen.getByRole('button', { name: /^Goals$/i }));

    expect(await screen.findByRole('heading', { level: 1, name: /^goals$/i })).toBeInTheDocument();
  });

  it('clicking Tasks swaps the view to the kanban', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <App />
      </Providers>,
    );
    await screen.findByRole('heading', { level: 1, name: /overview/i });

    await user.click(screen.getByRole('button', { name: /^Tasks$/i }));

    // TasksView renders the kanban column headers (no 'To do' anymore).
    expect(await screen.findByText(/Backlog/i)).toBeInTheDocument();
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Done/i)).toBeInTheDocument();
  });

  it('marks the active sidebar item with aria-current="page"', async () => {
    render(
      <Providers>
        <App />
      </Providers>,
    );
    await screen.findByRole('heading', { level: 1, name: /overview/i });

    // Overview is initial → it's the active one.
    const overview = screen.getByRole('button', { name: /^Overview$/i });
    expect(overview).toHaveAttribute('aria-current', 'page');

    const tasks = screen.getByRole('button', { name: /^Tasks$/i });
    expect(tasks).not.toHaveAttribute('aria-current');
  });

  it('toggling theme flips data-theme on <html>', () => {
    render(
      <Providers theme="dark">
        <App />
      </Providers>,
    );
    expect(document.documentElement.dataset['theme']).toBe('dark');
    // ThemeToggle cycles dark → system → light → dark.
    const themeBtn = screen.getByRole('button', { name: /theme/i });
    act(() => {
      themeBtn.click();
    });
    // After cycling from dark, the resolved theme in jsdom (prefers-color-scheme=light)
    // becomes 'light', so data-theme is 'light'.
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});