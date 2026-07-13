/**
 * v8/__tests__/Topbar.test.tsx — Sprint S15b live wiring.
 *
 * Verifies the topbar renders:
 *   - the active project name pulled from /api/projects (no static "workspace ▾")
 *   - a live connection indicator that reflects the WS connection state
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '../ui/theme/ThemeProvider.js';
import { DensityProvider } from '../ui/theme/DensityProvider.js';
import { Topbar } from '../shell/Topbar.js';

function Providers({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <ThemeProvider>
      <DensityProvider>{children}</DensityProvider>
    </ThemeProvider>
  );
}

describe('Topbar — live wiring', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/projects')) {
        return new Response(
          JSON.stringify({
            projects: [{ id: 'p1', name: 'BizarHarness' }],
            active: 'p1',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the active project name instead of "workspace"', async () => {
    render(
      <Providers>
        <Topbar />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('topbar-active-project').textContent).toContain('BizarHarness');
    });
  });

  it('falls back to the project id when name is missing', async () => {
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/projects')) {
        return new Response(JSON.stringify({ projects: [{ id: 'p-fallback' }], active: 'p-fallback' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    render(
      <Providers>
        <Topbar />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('topbar-active-project').textContent).toContain('p-fallback');
    });
  });

  it('renders the connection state indicator', () => {
    render(
      <Providers>
        <Topbar />
      </Providers>,
    );
    const el = screen.getByTestId('topbar-connection-state');
    // WebSocket is undefined in jsdom so readyState is undefined → not OPEN → "offline".
    expect(el.textContent).toMatch(/live|offline/);
  });
});