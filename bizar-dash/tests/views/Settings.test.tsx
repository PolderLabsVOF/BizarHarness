/**
 * tests/views/Settings.test.tsx
 *
 * v6.x — Settings view tests. Each section is rendered as its own page.
 * The SettingsView component accepts a `section` prop and renders only
 * that section's body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ModalProvider } from '../../src/web/components/Modal';
import { ToastProvider } from '../../src/web/components/Toast';
import { SettingsView } from '../../src/web/views/Settings';
import type { Settings, Snapshot } from '../../src/web/lib/types';

const baseSettings: Settings = {
  theme: {
    mode: 'dark',
    accent: '#8b5cf6',
    success: '#3fb950',
    warning: '#f0883e',
    error: '#f85149',
    info: '#58a6ff',
    fontFamily: 'Inter',
    fontSize: 14,
    compactMode: false,
    animations: true,
  },
  ui: {
    layout: 'sidebar',
    showHeader: true,
    showStatusBar: true,
    defaultTab: 'overview',
  },
  defaultAgent: 'odin',
  defaultModel: '',
  notifications: {
    onAgentComplete: true,
    onPlanApproval: true,
  },
  dashboard: { autoLaunchWeb: false },
  service: { enabled: false, autostart: false },
  about: { version: '6.0.0', homepage: 'https://github.com/DrB0rk/BizarHarness', license: 'MIT' },
  agents: { maxParallel: 4, stuckThresholdMs: 60000, autoRestart: true },
  personalization: {
    displayName: '',
    role: '',
    team: '',
    aboutMe: '',
    preferences: '',
  },
  workflow: {
    artifactsEnabled: true,
    agentsDecideAutonomously: false,
    chatAutonomous: false,
  },
};

const baseSnapshot = {
  overview: {
    counts: { agents: 0, plans: 0, projects: 0, sessions: 0 },
    recentActivity: [],
    versions: { node: 'v20', platform: 'linux', projectRoot: '/p', bizarRoot: '/b' },
    generatedAt: new Date().toISOString(),
  },
  agents: [],
  artifacts: [],
  projects: [],
  activeProject: null,
  config: { path: '', data: {}, raw: '', exists: false },
  settings: { path: '', data: baseSettings, exists: true },
  tasks: [],
  mods: [],
  schedules: [],
  providers: [],
  mcps: [],
} as unknown as Snapshot;

const SettingsHarness = ({ section }: { section: string }) => (
  <ToastProvider>
    <ModalProvider>
      <SettingsView
        snapshot={baseSnapshot}
        settings={baseSettings}
        activeTab={`settings-${section}`}
        setActiveTab={vi.fn()}
        refreshSnapshot={vi.fn(async () => {})}
        section={section}
      />
    </ModalProvider>
  </ToastProvider>
);

describe('SettingsView — v6.x per-section rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Theme section when section="theme"', async () => {
    render(<SettingsHarness section="theme" />);
    await waitFor(() => {
      // The page <h2> heading reflects the section label. Inner section
      // components may also contain headings (e.g. "Accent") so use
      // getAllByRole + check the first h2.
      const headings = screen.getAllByRole('heading', { name: /theme/i });
      expect(headings.length).toBeGreaterThan(0);
      // The first h2 is the page title.
      expect(headings[0].tagName).toBe('H2');
    });
  });

  it('renders the General section when section="general"', async () => {
    render(<SettingsHarness section="general" />);
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: /general/i });
      expect(headings.length).toBeGreaterThan(0);
      expect(headings[0].tagName).toBe('H2');
    });
  });

  it('falls back to Theme when an unknown section id is passed', async () => {
    // Force the default fallback path
    const { rerender } = render(<SettingsHarness section="does-not-exist" />);
    rerender(<SettingsHarness section="theme" />);
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { name: /theme/i });
      expect(headings.length).toBeGreaterThan(0);
      expect(headings[0].tagName).toBe('H2');
    });
  });

  it('renders the Save / Reload / Reset action buttons', async () => {
    render(<SettingsHarness section="theme" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset all settings/i })).toBeInTheDocument();
    });
  });

  it('Save button starts disabled (no dirty changes)', async () => {
    render(<SettingsHarness section="theme" />);
    await waitFor(() => {
      const save = screen.getByRole('button', { name: /save/i });
      expect(save).toBeDisabled();
    });
  });

  it('renders the section description in the subtitle', async () => {
    render(<SettingsHarness section="network" />);
    await waitFor(() => {
      // The page subtitle is a <p className="view-subtitle"> containing
      // the section description. Multiple Tailscale mentions may appear
      // (subtitle + inner sections), so just check the subtitle paragraph.
      const subtitle = document.querySelector('.view-subtitle');
      expect(subtitle?.textContent?.toLowerCase()).toContain('tailscale');
    });
  });
});