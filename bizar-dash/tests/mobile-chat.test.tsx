/**
 * tests/mobile-chat.test.tsx
 *
 * v5.4 — Mobile chat smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MobileChat } from '../src/web/mobile/MobileChat';
import type { Snapshot, Settings, ChatMessage, ChatSession } from '../src/web/lib/types';

const mockSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  overview: {
    counts: { agents: 0, plans: 0, projects: 0, sessions: 0, activeProject: null },
    recentActivity: [],
    versions: { node: '', platform: '', projectRoot: '', bizarRoot: '' },
    generatedAt: new Date().toISOString(),
  },
  agents: [],
  artifacts: [],
  projects: [],
  activeProject: null,
  config: { path: '', data: {}, raw: '', exists: false },
  settings: {
    path: '',
    data: {
      theme: {
        mode: 'dark',
        accent: '#8b5cf6',
        success: '#3fb950',
        warning: '#d29922',
        error: '#f85149',
        info: '#58a6ff',
        fontFamily: '',
        fontSize: 14,
        compactMode: false,
        animations: true,
      },
      ui: { layout: 'topnav', showHeader: true, showStatusBar: true, defaultTab: '' },
      defaultAgent: 'odin',
      defaultModel: '',
      notifications: { onAgentComplete: false, onPlanApproval: false },
      dashboard: { autoLaunchWeb: false },
      service: { enabled: false, autostart: false },
      about: { version: '', homepage: '', license: '' },
      agents: { maxParallel: 1, stuckThresholdMs: 0, autoRestart: false },
      personalization: { displayName: '', role: '', team: '', aboutMe: '', preferences: '' },
      workflow: { artifactsEnabled: false, agentsDecideAutonomously: false, chatAutonomous: false },
    } as Settings,
    exists: false,
  },
  tasks: [],
  mods: [],
  schedules: [],
  providers: [],
  mcps: [],
  ...overrides,
});

describe('MobileChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the chat shell', () => {
    render(<MobileChat snapshot={mockSnapshot()} settings={mockSnapshot().settings!.data} />);
    expect(document.querySelector('.chat-shell')).toBeInTheDocument();
  });

  it('shows the top bar with project name', () => {
    const snap = mockSnapshot({
      activeProject: { id: 'proj-1', name: 'My Project', path: '/test', status: 'active' },
    });
    render(<MobileChat snapshot={snap} settings={snap.settings!.data} />);
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('renders composer with send button', () => {
    render(<MobileChat snapshot={mockSnapshot()} settings={mockSnapshot().settings!.data} />);
    expect(document.querySelector('.chat-composer-pill')).toBeInTheDocument();
  });
});
