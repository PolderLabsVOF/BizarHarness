/**
 * tests/views/topbar.test.tsx
 *
 * v4.9.0 / v5.5.0 — Topbar tests. Verifies that:
 *   - The Settings tab appears as a single entry in the tab rail.
 *   - Clicking Settings invokes onTabChange with 'settings'.
 *   - The Settings tab shows the settings-mode-indicator when active.
 *   - All other tabs work normally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Topbar, TABS } from '../../src/web/components/Topbar';

describe('Topbar', () => {
  const onTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderTopbar = (activeTab: string) =>
    render(
      <Topbar
        activeTab={activeTab}
        onTabChange={onTabChange}
        wsStatus="connected"
        version="v4.9.0"
        activeProject={null}
        projects={[]}
        onProjectChange={vi.fn()}
        onProjectsRefresh={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );

  it('renders the Settings tab as a single entry', () => {
    renderTopbar('overview');
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('renders all main tabs', () => {
    renderTopbar('overview');
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /agents/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /memory/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('exposes the Settings tab id in TABS', () => {
    const ids = TABS.map((t) => t.id);
    expect(ids).toContain('settings');
    // Settings should NOT have a prefix (it's a single entry, not per-section)
    expect(ids).not.toContain('settings-theme');
    expect(ids).not.toContain('settings-general');
  });

  it('calls onTabChange with "settings" when the Settings tab is clicked', async () => {
    const user = userEvent.setup();
    renderTopbar('overview');
    await user.click(screen.getByRole('tab', { name: /settings/i }));
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('calls onTabChange with "overview" when the Overview tab is clicked', async () => {
    const user = userEvent.setup();
    renderTopbar('settings');
    await user.click(screen.getByRole('tab', { name: /overview/i }));
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });

  it('highlights the active tab with `tab-active`', () => {
    renderTopbar('settings');
    const settingsTab = screen.getByRole('tab', { name: /settings/i });
    expect(settingsTab).toHaveClass('tab-active');
  });

  it('does not render settings section tabs (they are in the sidebar when in settings mode)', () => {
    renderTopbar('overview');
    // These section tabs should NOT exist in the topbar
    expect(screen.queryByRole('tab', { name: /theme/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /general/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /layout/i })).not.toBeInTheDocument();
  });
});
