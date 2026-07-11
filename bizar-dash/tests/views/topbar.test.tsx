/**
 * tests/views/topbar.test.tsx
 *
 * v8.0 — Topbar tests. The Topbar no longer carries navigation
 * (sidebar owns tabs). The Topbar is now a single 48px row with:
 *   - Brand (logo + title)
 *   - Breadcrumb separator
 *   - Project selector
 *   - Search trigger (Cmd/Ctrl+K)
 *   - WebSocket status indicator
 *
 * Tests verify these primitives render and behave correctly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Topbar, TABS } from '../../src/web/components/Topbar';
import type { ProjectRecord } from '../../src/web/lib/types';

const PROJECT: ProjectRecord = {
  id: 'proj-1',
  name: 'demo-app',
  path: '/tmp/demo-app',
  status: 'ready',
  createdAt: 0,
};

describe('Topbar', () => {
  const onProjectChange = vi.fn();
  const onProjectsRefresh = vi.fn();
  const onOpenSearch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderTopbar = () =>
    render(
      <Topbar
        wsStatus="connected"
        activeProject={PROJECT}
        projects={[PROJECT]}
        onProjectChange={onProjectChange}
        onProjectsRefresh={onProjectsRefresh}
        onOpenSearch={onOpenSearch}
      />,
    );

  it('renders the brand title', () => {
    renderTopbar();
    expect(screen.getByText('Bizar')).toBeInTheDocument();
  });

  it('renders the breadcrumb separator', () => {
    renderTopbar();
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('renders the active project name', () => {
    renderTopbar();
    expect(screen.getByText('demo-app')).toBeInTheDocument();
  });

  it('renders "(no project)" when no active project is set', () => {
    render(
      <Topbar
        wsStatus="connected"
        activeProject={null}
        projects={[]}
        onProjectChange={onProjectChange}
        onProjectsRefresh={onProjectsRefresh}
        onOpenSearch={onOpenSearch}
      />,
    );
    expect(screen.getByText('(no project)')).toBeInTheDocument();
  });

  it('renders a search trigger button', () => {
    renderTopbar();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('calls onOpenSearch when the search trigger is clicked', async () => {
    const user = userEvent.setup();
    renderTopbar();
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it('renders the WebSocket status indicator', () => {
    renderTopbar();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('does not render any navigation tabs (sidebar owns those)', () => {
    renderTopbar();
    expect(screen.queryByRole('tab', { name: /overview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /chat/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /settings/i })).not.toBeInTheDocument();
  });

  it('still exports TABS for the Sidebar to consume', () => {
    expect(TABS).toBeInstanceOf(Array);
    const ids = TABS.map((t) => t.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('chat');
    expect(ids).toContain('settings');
  });
});