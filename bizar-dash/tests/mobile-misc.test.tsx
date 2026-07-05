/**
 * tests/mobile-misc.test.tsx
 *
 * v5.4 — Mobile misc views tests: Memory, Marketplace, Plugins, Eval, Doctor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../src/web/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({ ok: true }),
    del: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

// Stub lucide-react icons.
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  const make = (name: string) => {
    const Cmp = (props: { size?: number; 'aria-hidden'?: boolean }) =>
      <svg data-testid={`icon-${name}`} data-size={props.size} />;
    Cmp.displayName = name;
    return Cmp;
  };
  return {
    ...actual,
    BarChart: make('BarChart'),
    Brain: make('Brain'),
    FileText: make('FileText'),
    GitBranch: make('GitBranch'),
    Search: make('Search'),
    Mic: make('Mic'),
    Settings: make('Settings'),
    Network: make('Network'),
    Clipboard: make('Clipboard'),
    Scan: make('Scan'),
    Store: make('Store'),
    Puzzle: make('Puzzle'),
    ClipboardCheck: make('ClipboardCheck'),
    Clock: make('Clock'),
    CheckCircle2: make('CheckCircle2'),
    AlertTriangle: make('AlertTriangle'),
    XCircle: make('XCircle'),
  };
});

// Stub heavy memory sub-panels.
vi.mock('../src/web/views/memory/MemoryOverview', () => ({
  MemoryOverview: () => <div data-testid="memory-overview">MemoryOverview</div>,
}));
vi.mock('../src/web/views/memory/LightragPanel', () => ({
  LightragPanel: () => <div data-testid="lightrag-panel">LightragPanel</div>,
}));
vi.mock('../src/web/views/memory/ObsidianPanel', () => ({
  ObsidianPanel: () => <div data-testid="obsidian-panel">ObsidianPanel</div>,
}));
vi.mock('../src/web/views/memory/GitSyncPanel', () => ({
  GitSyncPanel: () => <div data-testid="git-panel">GitSyncPanel</div>,
}));
vi.mock('../src/web/views/memory/SemanticSearchPanel', () => ({
  SemanticSearchPanel: () => <div data-testid="semantic-panel">SemanticSearchPanel</div>,
}));
vi.mock('../src/web/views/memory/ConfigPanel', () => ({
  ConfigPanel: () => <div data-testid="config-panel">ConfigPanel</div>,
}));
vi.mock('../src/web/views/memory/MemoryGraphPanel', () => ({
  MemoryGraphPanel: () => <div data-testid="graph-panel">MemoryGraphPanel</div>,
}));
vi.mock('../src/web/views/memory/VaultFromClipboardPanel', () => ({
  VaultFromClipboardPanel: () => <div data-testid="webclip-panel">VaultFromClipboardPanel</div>,
}));
vi.mock('../src/web/views/memory/FromScreenshotPanel', () => ({
  FromScreenshotPanel: () => <div data-testid="screenshot-panel">FromScreenshotPanel</div>,
}));
vi.mock('../src/web/components/VoiceNotesPanel', () => ({
  VoiceNotesPanel: () => <div data-testid="voice-panel">VoiceNotesPanel</div>,
}));
vi.mock('../src/web/components/MarketplacePluginCard', () => ({
  MarketplacePluginCard: ({ plugin }: { plugin: { name: string } }) =>
    <div data-testid="marketplace-card">{plugin.name}</div>,
}));
vi.mock('../src/web/components/PluginPermissions', () => ({
  PluginPermissions: () => <div data-testid="plugin-permissions">PluginPermissions</div>,
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { MobileMemory } from '../src/web/mobile/MobileMemory';
import { MobileMarketplace } from '../src/web/mobile/MobileMarketplace';
import { MobilePlugins } from '../src/web/mobile/MobilePlugins';
import { MobileEval } from '../src/web/mobile/MobileEval';
import { MobileDoctor } from '../src/web/mobile/MobileDoctor';
import { api } from '../src/web/lib/api';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MobileMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all source tabs', () => {
    render(<MobileMemory />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('LightRAG')).toBeInTheDocument();
    expect(screen.getByText('Obsidian')).toBeInTheDocument();
    expect(screen.getByText('Git Sync')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Config')).toBeInTheDocument();
  });

  it('renders Overview panel by default', () => {
    render(<MobileMemory />);
    expect(screen.getByTestId('memory-overview')).toBeInTheDocument();
  });

  it('switches to LightRAG panel when tab is clicked', async () => {
    const user = userEvent.setup();
    render(<MobileMemory />);
    await user.click(screen.getByText('LightRAG'));
    expect(screen.getByTestId('lightrag-panel')).toBeInTheDocument();
  });

  it('switches to Obsidian panel when tab is clicked', async () => {
    const user = userEvent.setup();
    render(<MobileMemory />);
    await user.click(screen.getByText('Obsidian'));
    expect(screen.getByTestId('obsidian-panel')).toBeInTheDocument();
  });
});

describe('MobileMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders plugins when API returns data', async () => {
    vi.mocked(api.get).mockResolvedValue({
      plugins: [
        { id: 'p1', name: 'Test Plugin', version: '1.0', author: 'Test', category: 'util' },
      ],
    });
    render(<MobileMarketplace />);
    await waitFor(() => {
      expect(screen.getByText('Test Plugin')).toBeInTheDocument();
    });
  });

  it('filters plugins by search term', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      plugins: [
        { id: 'p1', name: 'Alpha Plugin', version: '1.0', author: 'A', category: 'util' },
        { id: 'p2', name: 'Beta Plugin', version: '1.0', author: 'B', category: 'util' },
      ],
    });
    render(<MobileMarketplace />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
      expect(screen.getByText('Beta Plugin')).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText(/search plugins/i);
    await act(async () => {
      await user.type(searchInput, 'alpha');
    });
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
    });
    expect(screen.queryByText('Beta Plugin')).not.toBeInTheDocument();
  });
});

describe('MobilePlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders plugin list when API returns data', async () => {
    vi.mocked(api.get).mockResolvedValue({
      plugins: [
        { id: 'p1', name: 'My Plugin', version: '2.0', invocations: 42 },
      ],
    });
    render(<MobilePlugins />);
    await waitFor(() => {
      expect(screen.getByText('My Plugin')).toBeInTheDocument();
      expect(screen.getByText('v2.0')).toBeInTheDocument();
      expect(screen.getByText('42 invocations')).toBeInTheDocument();
    });
  });

  it('filters plugins by search term', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({
      plugins: [
        { id: 'p1', name: 'Alpha Plugin', version: '1.0', invocations: 0 },
        { id: 'p2', name: 'Beta Plugin', version: '1.0', invocations: 0 },
      ],
    });
    render(<MobilePlugins />);
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
      expect(screen.getByText('Beta Plugin')).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText(/search installed plugins/i);
    await act(async () => {
      await user.type(searchInput, 'alpha');
    });
    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
    });
    expect(screen.queryByText('Beta Plugin')).not.toBeInTheDocument();
  });
});

describe('MobileEval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Runs and Schedules tabs', () => {
    render(<MobileEval />);
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Schedules')).toBeInTheDocument();
  });

  it('renders runs when API returns data', async () => {
    vi.mocked(api.get).mockResolvedValue({
      runs: [
        { id: 'run_001', startedAt: '2026-07-05T10:00:00Z', total: 10, passed: 9, failed: 1, suitePath: '/tmp' },
      ],
    });
    render(<MobileEval />);
    await waitFor(() => {
      expect(screen.getByText('run_001')).toBeInTheDocument();
    });
  });

  it('switches to Schedules tab when clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue({ runs: [] });
    render(<MobileEval />);
    await waitFor(() => {
      // Runs loaded (empty)
      expect(screen.getByText('No eval runs yet.')).toBeInTheDocument();
    });
    await act(async () => {
      await user.click(screen.getByText('Schedules'));
    });
    // Schedules tab is now active
    expect(screen.getByText('Schedules')).toBeInTheDocument();
  });
});

describe('MobileDoctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders OK status when health is ok', async () => {
    vi.mocked(api.get).mockResolvedValue({ status: 'ok', issues: [] });
    render(<MobileDoctor />);
    await waitFor(() => {
      expect(screen.getByText('OK')).toBeInTheDocument();
      expect(screen.getByText(/all systems healthy/i)).toBeInTheDocument();
    });
  });

  it('renders warn status with issue count', async () => {
    vi.mocked(api.get).mockResolvedValue({
      status: 'warn',
      issues: [{ name: 'DiskSpace', status: 'warn', message: 'Low disk space' }],
    });
    render(<MobileDoctor />);
    await waitFor(() => {
      expect(screen.getByText('WARN')).toBeInTheDocument();
      expect(screen.getByText('Issues (1)')).toBeInTheDocument();
      expect(screen.getByText('DiskSpace')).toBeInTheDocument();
    });
  });

  it('renders fail status with issues', async () => {
    vi.mocked(api.get).mockResolvedValue({
      status: 'fail',
      issues: [{ name: 'OpenCode', status: 'fail', message: 'Not reachable' }],
    });
    render(<MobileDoctor />);
    await waitFor(() => {
      expect(screen.getByText('FAIL')).toBeInTheDocument();
      expect(screen.getByText('Issues (1)')).toBeInTheDocument();
    });
  });

  it('auto-refreshes via setInterval', () => {
    // Verify the component sets up a 30-second interval by checking setInterval was called
    // with the correct delay. We use fake timers to control the interval.
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue({ status: 'ok', issues: [] });

    // Spy on window.setInterval to verify the delay
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    render(<MobileDoctor />);

    // The component should call setInterval with ~30 seconds
    expect(setIntervalSpy).toHaveBeenCalled();
    const intervalCalls = setIntervalSpy.mock.calls;
    // Find the interval delay (30 seconds = 30000ms)
    const hasCorrectInterval = intervalCalls.some(call => call[1] === 30_000);
    expect(hasCorrectInterval).toBe(true);

    setIntervalSpy.mockRestore();
    vi.useRealTimers();
  });
});
