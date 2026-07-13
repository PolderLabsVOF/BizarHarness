// tests/BackgroundAgents.test.tsx — v5.x component tests for the
// rewired BackgroundAgents view and SpawnAgentModal. Uses
// @testing-library/react and the dashboard's vitest setup.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackgroundAgents } from '../src/web/views/BackgroundAgents';
import { ToastProvider } from '../src/web/components/Toast';

// --- API mock ------------------------------------------------------------

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('../src/web/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

vi.mock('../src/web/lib/ws', () => ({
  Ws: class {
    constructor() {}
    on() { return () => {}; }
    onStatus() { return () => {}; }
    close() {}
  },
}));

// --- Helpers -------------------------------------------------------------

const dummySnapshot = {} as any;
const dummySettings = {} as any;

function wrap(node: React.ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPost.mockReset();
  // Default: list returns empty.
  mockApiGet.mockImplementation(async (path: string) => {
    if (path === '/background') return { instances: [], status: { dir: '/tmp', exists: false, count: 0 } };
    if (path.includes('/tool-calls')) return { toolCalls: [] };
    if (path.includes('/output')) return { output: '', available: false };
    if (path.includes('/tmux')) return { session: 'bgr_x', exists: false, attachCommand: 'tmux attach -t bgr_x', attachUrl: 'tmux://bgr_x' };
    return {};
  });
});

// --- Tests ---------------------------------------------------------------

describe('BackgroundAgents — v5.x integration', () => {
  it('renders empty state with a Spawn action', async () => {
    render(wrap(<BackgroundAgents snapshot={dummySnapshot} settings={dummySettings} activeTab="background" setActiveTab={() => {}} refreshSnapshot={async () => {}} />));
    await waitFor(() =>
      expect(screen.getByText(/No active background agents/i)).toBeInTheDocument(),
    );
    expect(screen.getAllByRole('button', { name: /Spawn/i }).length).toBeGreaterThan(0);
  });

  it('renders an active card with pause + steer buttons', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/background') {
        return {
          instances: [
            {
              instanceId: 'bgr_running_x',
              status: 'running',
              agent: 'mimir',
              prompt: 'say hi',
              startedAt: Date.now() - 5000,
              toolCallCount: 0,
              tmuxSession: 'bgr_running_x',
              tmuxActive: false,
            },
          ],
          status: { dir: '/tmp', exists: true, count: 1 },
        };
      }
      return {};
    });
    render(wrap(<BackgroundAgents snapshot={dummySnapshot} settings={dummySettings} activeTab="background" setActiveTab={() => {}} refreshSnapshot={async () => {}} />));
    await waitFor(() => expect(screen.getByText('mimir')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Pause/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Steer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kill/i })).toBeInTheDocument();
  });

  it('renders a paused card with resume instead of pause', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/background') {
        return {
          instances: [
            {
              instanceId: 'bgr_paused_x',
              status: 'paused',
              agent: 'mimir',
              prompt: 'paused run',
              startedAt: Date.now() - 5000,
              toolCallCount: 0,
            },
          ],
          status: { dir: '/tmp', exists: true, count: 1 },
        };
      }
      return {};
    });
    render(wrap(<BackgroundAgents snapshot={dummySnapshot} settings={dummySettings} activeTab="background" setActiveTab={() => {}} refreshSnapshot={async () => {}} />));
    await waitFor(() => expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Pause/i })).not.toBeInTheDocument();
  });

  it('progress bar shows when instance.progress is set', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/background') {
        return {
          instances: [
            {
              instanceId: 'bgr_progress_x',
              status: 'running',
              agent: 'mimir',
              prompt: 'step',
              startedAt: Date.now(),
              toolCallCount: 1,
              progress: 42,
              progressMessage: 'halfway through',
            },
          ],
          status: { dir: '/tmp', exists: true, count: 1 },
        };
      }
      return {};
    });
    render(wrap(<BackgroundAgents snapshot={dummySnapshot} settings={dummySettings} activeTab="background" setActiveTab={() => {}} refreshSnapshot={async () => {}} />));
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument());
    expect(screen.getByText(/halfway through/i)).toBeInTheDocument();
  });

  it('pause button calls pause endpoint', async () => {
    mockApiGet.mockImplementation(async (path: string) => {
      if (path === '/background') {
        return {
          instances: [{ instanceId: 'bgr_x', status: 'running', agent: 'mimir', prompt: 'p', startedAt: Date.now(), toolCallCount: 0 }],
          status: { dir: '/tmp', exists: true, count: 1 },
        };
      }
      return {};
    });
    mockApiPost.mockResolvedValue({ ok: true });
    render(wrap(<BackgroundAgents snapshot={dummySnapshot} settings={dummySettings} activeTab="background" setActiveTab={() => {}} refreshSnapshot={async () => {}} />));
    const btn = await waitFor(() => screen.getByRole('button', { name: /Pause/i }));
    await userEvent.click(btn);
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/background/bgr_x/pause', {});
    });
  });
});
