/**
 * tests/views/Marketplace.test.tsx
 *
 * v6.x — Marketplace view tests. Verifies the new UX:
 *   - Loading state shows a "Fetching registry from <url>" message.
 *   - Success state surfaces the registry source URL.
 *   - Empty state shows a friendly "No plugins published yet" message.
 *   - Refresh button re-fetches the registry.
 *   - Category filter works (still works after the rewrite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';
import { Marketplace } from '../../src/web/views/Marketplace';
import { api, ApiError } from '../../src/web/lib/api';

vi.mock('../../src/web/lib/api', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    api: { get, put: vi.fn(), post, del: vi.fn(), setToken: vi.fn(), probeAuthStatus: vi.fn() },
    ApiError: class ApiError extends Error {
      status: number;
      data: unknown;
      constructor(status: number, message: string, data: unknown = null) {
        super(message);
        this.status = status;
        this.data = data;
      }
    },
  };
});

const Harness = () => (
  <ToastProvider>
    <ModalProvider>
      <Marketplace />
    </ModalProvider>
  </ToastProvider>
);

const samplePlugins = [
  {
    id: 'plugin-a',
    name: 'Plugin A',
    version: '1.0.0',
    author: 'Alice',
    description: 'First test plugin',
    category: 'Utilities',
    tags: ['tool'],
    permissions: [],
  },
  {
    id: 'plugin-b',
    name: 'Plugin B',
    version: '0.2.1',
    author: 'Bob',
    description: 'Second test plugin',
    category: 'Integrations',
    tags: ['github'],
    permissions: ['net'],
  },
];

describe('Marketplace view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state while the registry is being fetched', () => {
    (api.get as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves
    render(<Harness />);
    expect(screen.getByTestId('marketplace-loading')).toBeInTheDocument();
    // Both the subtitle ("Fetching registry from the community server…")
    // and the spinner paragraph mention "Fetching registry"; assert the
    // spinner paragraph specifically.
    const loading = screen.getByTestId('marketplace-loading');
    expect(loading.textContent?.toLowerCase()).toContain('fetching');
  });

  it('surfaces the registry source URL after a successful fetch', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      plugins: samplePlugins,
      registry: { source: 'https://github.com/DrB0rk/bizar-mods', updatedAt: null },
    });

    render(<Harness />);

    await waitFor(() => {
      const source = screen.getByTestId('marketplace-source');
      expect(source.textContent).toContain('https://github.com/DrB0rk/bizar-mods');
    });

    // Plugin count pill
    const count = screen.getByTestId('marketplace-count');
    expect(count.textContent).toMatch(/2 plugins/);
  });

  it('shows a "cached" notice when the server reports cached data', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      plugins: samplePlugins,
      registry: { source: 'https://github.com/DrB0rk/bizar-mods', updatedAt: null },
      cached: true,
      cacheTimestamp: Date.now() - 1000 * 60 * 30, // 30 min ago
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-cache-notice')).toBeInTheDocument();
    });
    expect(screen.getByTestId('marketplace-cache-notice').textContent?.toLowerCase()).toContain('cached');
  });

  it('renders a friendly empty state when the registry has zero plugins', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      plugins: [],
      registry: { source: 'https://github.com/DrB0rk/bizar-mods', updatedAt: null },
    });

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText(/no plugins published yet/i)).toBeInTheDocument();
    });
  });

  it('renders a registry-unreachable error state on failure', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiError(502, 'all registry URLs failed', { registryUrl: 'https://github.com/DrB0rk/bizar-mods' }),
    );

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText(/registry unreachable/i)).toBeInTheDocument();
    });
    // URL surfaced in error state
    expect(screen.getByText(/github\.com\/DrB0rk\/bizar-mods/i)).toBeInTheDocument();
  });

  it('re-fetches the registry when the Refresh button is clicked', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      plugins: samplePlugins,
      registry: { source: 'https://github.com/DrB0rk/bizar-mods', updatedAt: null },
    });

    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-source')).toBeInTheDocument();
    });

    (api.get as ReturnType<typeof vi.fn>).mockClear();
    await user.click(screen.getByTestId('marketplace-refresh'));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
  });

  it('filters plugins by category when a chip is clicked', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      plugins: samplePlugins,
      registry: { source: 'https://github.com/DrB0rk/bizar-mods', updatedAt: null },
    });

    const user = userEvent.setup();
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId('marketplace-grid')).toBeInTheDocument();
    });

    // Initially both plugins visible.
    expect(screen.getByText('Plugin A')).toBeInTheDocument();
    expect(screen.getByText('Plugin B')).toBeInTheDocument();

    // Click the Integrations chip — only Plugin B should remain.
    await user.click(screen.getByTestId('marketplace-category-integrations'));
    await waitFor(() => {
      expect(screen.queryByText('Plugin A')).not.toBeInTheDocument();
      expect(screen.getByText('Plugin B')).toBeInTheDocument();
    });

    // Reset filter via "All" chip — both visible again.
    await user.click(screen.getByTestId('marketplace-category-all'));
    await waitFor(() => {
      expect(screen.getByText('Plugin A')).toBeInTheDocument();
      expect(screen.getByText('Plugin B')).toBeInTheDocument();
    });
  });
});