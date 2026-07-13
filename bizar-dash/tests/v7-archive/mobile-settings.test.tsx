/**
 * tests/mobile-settings.test.tsx
 *
 * v5.4 — Component tests for the mobile settings accordion view.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MobileSettings } from '../src/web/mobile/MobileSettings';
import type { Settings, Snapshot } from '../src/web/lib/types';

// ─── Mock sub-components that make API calls ────────────────────────────────

vi.mock('../src/web/views/settings/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="general-section">GeneralSection</div>,
}));

vi.mock('../src/web/views/settings/EnvVarsSection', () => ({
  EnvVarsSection: () => <div data-testid="env-vars-section">EnvVarsSection</div>,
}));

vi.mock('../src/web/views/settings/MemorySection', () => ({
  MemorySection: () => <div data-testid="memory-section">MemorySection</div>,
}));

vi.mock('../src/web/views/settings/SystemLlmSection', () => ({
  SystemLlmSection: () => <div data-testid="system-llm-section">SystemLlmSection</div>,
}));

vi.mock('../src/web/views/settings/UpdatesSection', () => ({
  UpdatesSection: () => <div data-testid="updates-section">UpdatesSection</div>,
}));

vi.mock('../src/web/views/settings/HeadroomSection', () => ({
  HeadroomSection: () => <div data-testid="headroom-section">HeadroomSection</div>,
}));

vi.mock('../src/web/components/TailscaleSettings', () => ({
  TailscaleSettings: () => <div data-testid="tailscale-section">TailscaleSettings</div>,
}));

vi.mock('../src/web/views/settings/ActivitySection', () => ({
  ActivitySection: () => <div data-testid="about-section">AboutSection</div>,
}));

// ─── Test data ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: Settings = {
  theme: {
    mode: 'dark',
    accent: '#8b5cf6',
    success: '#3fb950',
    warning: '#f0883e',
    error: '#f85149',
    info: '#58a6ff',
    fontFamily: 'sans-serif',
    fontSize: 14,
    compactMode: false,
    animations: true,
  },
  ui: {
    layout: 'topnav',
    showHeader: true,
    showStatusBar: true,
    defaultTab: 'overview',
  },
  defaultAgent: 'odin',
  defaultModel: '',
  notifications: { onAgentComplete: false, onPlanApproval: false },
  dashboard: { autoLaunchWeb: false },
  service: { enabled: false, autostart: false },
  about: { version: '5.4.0', homepage: 'https://github.com/DrB0rk/BizarHarness', license: 'MIT' },
  agents: { maxParallel: 6, stuckThresholdMs: 600000, autoRestart: false },
  personalization: { displayName: '', role: '', team: '', aboutMe: '', preferences: '' },
  workflow: { artifactsEnabled: true, agentsDecideAutonomously: false, chatAutonomous: false },
  headroom: { enabled: false, autoInstall: true, port: 8787, host: '127.0.0.1', outputShaper: false, telemetry: false, budget: 0, backend: 'anthropic', autoStart: true, autoWrap: true, routeAllProviders: true },
};

const SNAPSHOT_WITH_PROVIDERS: Snapshot = {
  agents: [],
  artifacts: [],
  projects: [],
  activeProject: null,
  config: { path: '', data: null, raw: '', exists: false },
  settings: { path: '', data: DEFAULT_SETTINGS, exists: true },
  tasks: [],
  mods: [],
  schedules: [],
  providers: [
    { id: 'p1', name: 'OpenAI', enabled: true, kind: 'openai', models: [] },
    { id: 'p2', name: 'Anthropic', enabled: true, kind: 'anthropic', models: [] },
  ],
  mcps: [],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MobileSettings', () => {
  const onSettingsChange = vi.fn();
  const autoSave = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all 9 settings sections', () => {
    render(
      <MobileSettings
        settings={DEFAULT_SETTINGS}
        onSettingsChange={onSettingsChange}
        autoSave={autoSave}
        snapshot={SNAPSHOT_WITH_PROVIDERS}
      />,
    );

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('AI Providers')).toBeInTheDocument();
    expect(screen.getByText('Environment Variables')).toBeInTheDocument();
    expect(screen.getByText('Memory Vault')).toBeInTheDocument();
    expect(screen.getByText('System LLM')).toBeInTheDocument();
    expect(screen.getByText('Updates')).toBeInTheDocument();
    expect(screen.getByText('Headroom')).toBeInTheDocument();
    expect(screen.getByText('Tailscale')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('filters sections by search query', async () => {
    const user = userEvent.setup();
    render(
      <MobileSettings
        settings={DEFAULT_SETTINGS}
        onSettingsChange={onSettingsChange}
        autoSave={autoSave}
      />,
    );

    const searchInput = screen.getByRole('textbox', { name: /search settings/i });
    await user.type(searchInput, 'provider');

    // Only "AI Providers" matches
    expect(screen.getByText('AI Providers')).toBeInTheDocument();
    expect(screen.queryByText('General')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory Vault')).not.toBeInTheDocument();
  });

  it('expands/collapses section on click', async () => {
    const user = userEvent.setup();
    render(
      <MobileSettings
        settings={DEFAULT_SETTINGS}
        onSettingsChange={onSettingsChange}
        autoSave={autoSave}
      />,
    );

    // Initially nothing is expanded
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();

    // Click General — expands it
    await user.click(screen.getByText('General'));
    expect(screen.getByTestId('general-section')).toBeInTheDocument();

    // Click again — collapses
    await user.click(screen.getByText('General'));
    expect(screen.queryByTestId('general-section')).not.toBeInTheDocument();
  });

  it('shows "2 configured" for AI Providers when snapshot has 2 providers', () => {
    render(
      <MobileSettings
        settings={DEFAULT_SETTINGS}
        onSettingsChange={onSettingsChange}
        autoSave={autoSave}
        snapshot={SNAPSHOT_WITH_PROVIDERS}
      />,
    );

    expect(screen.getByText('2 configured')).toBeInTheDocument();
  });
});
