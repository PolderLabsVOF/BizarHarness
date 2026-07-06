/**
 * tests/views/Memory.test.tsx
 *
 * v6.x — Memory UI tests focused on the vault path loader fix.
 * Before this fix, the ConfigPanel and MemorySection hardcoded the vault
 * path to '' and rendered "(loading…)" forever. After the fix, they fetch
 * /api/memory/status and render the actual path or a "not initialised"
 * placeholder, plus an Initialise button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '../../src/web/components/Toast';
import { ModalProvider } from '../../src/web/components/Modal';
import { MemoryOverview } from '../../src/web/views/memory/MemoryOverview';
import { ConfigPanel } from '../../src/web/views/memory/ConfigPanel';
import { MemorySection } from '../../src/web/views/settings/MemorySection';
import { api } from '../../src/web/lib/api';

vi.mock('../../src/web/lib/api', () => {
  const get = vi.fn();
  return {
    api: {
      get,
      put: vi.fn(),
      post: vi.fn(),
      del: vi.fn(),
      setToken: vi.fn(),
      probeAuthStatus: vi.fn(),
    },
    ApiError: class ApiError extends Error {
      status: number;
      constructor(status: number, message: string) {
        super(message);
        this.status = status;
      }
    },
  };
});

const Harness = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <ModalProvider>{children}</ModalProvider>
  </ToastProvider>
);

describe('MemoryOverview vault path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the resolved vault path from /memory/status', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/status') return Promise.resolve({
        initialized: true,
        mode: 'local-only',
        vaultRoot: '/Users/test/.bizar_memory',
        noteCount: 5,
        gitClean: true,
        branch: 'main',
      });
      if (url === '/memory/health') return Promise.resolve({
        score: 90,
        status: 'healthy',
        checks: [],
        message: 'all good',
      });
      if (url === '/memory/lightrag/stats') return Promise.resolve({
        running: false, pid: null, host: '127.0.0.1', port: 9621, indexedApprox: 0, queryCountLast24h: 0, lastReindexAt: null,
      });
      if (url === '/memory/storage') return Promise.resolve({ total: 1024, breakdown: [] });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <MemoryOverview refreshKey={0} onRefresh={vi.fn()} setActiveSubPanel={vi.fn()} />
      </Harness>,
    );

    await waitFor(() => {
      const el = screen.getByTestId('memory-overview-vault-path');
      expect(el.textContent).toContain('/Users/test/.bizar_memory');
    });
  });

  it('shows "not initialised" when status reports initialized=false', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/status') return Promise.resolve({
        initialized: false, mode: null, projectId: null, vaultRoot: null,
      });
      if (url === '/memory/health') return Promise.resolve({
        score: 0, status: 'unconfigured', checks: [], message: 'not initialised',
      });
      if (url === '/memory/lightrag/stats') return Promise.resolve({
        running: false, pid: null, host: '127.0.0.1', port: 9621, indexedApprox: 0, queryCountLast24h: 0, lastReindexAt: null,
      });
      if (url === '/memory/storage') return Promise.resolve({ total: 0, breakdown: [] });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <MemoryOverview refreshKey={0} onRefresh={vi.fn()} setActiveSubPanel={vi.fn()} />
      </Harness>,
    );

    await waitFor(() => {
      const el = screen.getByTestId('memory-overview-vault-path');
      expect(el.textContent?.toLowerCase()).toContain('not initialised');
    });
  });
});

describe('ConfigPanel vault path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render "(loading…)" forever — shows actual vault path', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/config/global') return Promise.resolve({
        config: { git: { remoteUrl: '' } },
      });
      if (url === '/memory/status') return Promise.resolve({
        initialized: true, vaultRoot: '/Users/test/.bizar_memory', mode: 'local-only',
      });
      if (url === '/memory/git/status') return Promise.resolve({ ok: false });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <ConfigPanel refreshKey={0} />
      </Harness>,
    );

    await waitFor(() => {
      const el = screen.getByTestId('memory-current-vault-path');
      expect(el.textContent).toContain('/Users/test/.bizar_memory');
    });

    // Sanity: the legacy "(loading…)" string is no longer rendered.
    expect(screen.queryByText('(loading…)')).not.toBeInTheDocument();
  });

  it('shows an "Initialise default" button when not initialised', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/config/global') return Promise.resolve({ config: {} });
      if (url === '/memory/status') return Promise.resolve({ initialized: false, vaultRoot: null });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <ConfigPanel refreshKey={0} />
      </Harness>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('memory-init-vault')).toBeInTheDocument();
    });
  });

  it('triggers /memory/init when "Initialise default" is clicked', async () => {
    const post = vi.fn().mockResolvedValue({ ok: true });
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/config/global') return Promise.resolve({ config: {} });
      if (url === '/memory/status') return Promise.resolve({ initialized: false, vaultRoot: null });
      return Promise.resolve(null);
    });
    (api.post as ReturnType<typeof vi.fn>) = post;

    const user = userEvent.setup();
    render(
      <Harness>
        <ConfigPanel refreshKey={0} />
      </Harness>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('memory-init-vault')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('memory-init-vault'));
    expect(post).toHaveBeenCalledWith('/memory/init', expect.anything());
  });
});

describe('MemorySection (settings) vault path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the vault path from /memory/status (was hardcoded to "")', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/config/global') return Promise.resolve({ config: { git: { remoteUrl: '' } } });
      if (url === '/memory/status') return Promise.resolve({
        initialized: true, vaultRoot: '/home/test/.bizar_memory', mode: 'local-only',
      });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <MemorySection />
      </Harness>,
    );

    await waitFor(() => {
      const el = screen.getByTestId('settings-memory-vault-path');
      expect(el.textContent).toContain('/home/test/.bizar_memory');
    });
  });

  it('shows an Initialise button when the vault is not initialised', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/memory/config/global') return Promise.resolve({ config: {} });
      if (url === '/memory/status') return Promise.resolve({ initialized: false, vaultRoot: null });
      return Promise.resolve(null);
    });

    render(
      <Harness>
        <MemorySection />
      </Harness>,
    );

    await waitFor(() => {
      const el = screen.getByTestId('settings-memory-vault-path');
      expect(el.textContent?.toLowerCase()).toContain('not initialised');
      expect(screen.getByRole('button', { name: /initialise/i })).toBeInTheDocument();
    });
  });
});