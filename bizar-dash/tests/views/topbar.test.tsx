/**
 * tests/views/topbar.test.tsx
 *
 * v6.x — Topbar tests. Verifies that:
 *   - Each settings section is exposed as its own tab in TABS.
 *   - The Settings tab itself is gone (replaced by per-section tabs).
 *   - The settings divider visually separates system tabs from settings tabs.
 *   - Clicking a tab invokes onTabChange with the tab id.
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
        version="v6.0.0"
        activeProject={null}
        projects={[]}
        onProjectChange={vi.fn()}
        onProjectsRefresh={vi.fn()}
        onOpenSearch={vi.fn()}
      />,
    );

  it('exposes each settings section as its own top-level tab', () => {
    renderTopbar('overview');
    // Spot-check a few section tabs
    expect(screen.getByRole('tab', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /layout/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /env vars/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /auth/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /system llm/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /headroom/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /activity log/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /workspaces/i })).toBeInTheDocument();
  });

  it('does not expose a legacy "Settings" parent tab', () => {
    renderTopbar('overview');
    // The plain "Settings" tab is gone — replaced by `settings-*` tabs.
    expect(screen.queryByRole('tab', { name: /^settings$/i })).not.toBeInTheDocument();
  });

  it('renders a settings-group divider with a "Settings" label', () => {
    const { container } = renderTopbar('overview');
    const separator = container.querySelector('.tab-separator-settings');
    expect(separator).toBeInTheDocument();
    expect(separator?.textContent).toMatch(/settings/i);
  });

  it('exposes the tab ids in TABS', () => {
    const ids = TABS.map((t) => t.id);
    expect(ids).toContain('settings-theme');
    expect(ids).toContain('settings-general');
    expect(ids).toContain('settings-layout');
    expect(ids).toContain('settings-env-vars');
    expect(ids).toContain('settings-network');
    expect(ids).toContain('settings-notifications');
    expect(ids).toContain('settings-auth');
    expect(ids).toContain('settings-agents');
    expect(ids).toContain('settings-system-llm');
    expect(ids).toContain('settings-headroom');
    expect(ids).toContain('settings-updates');
    expect(ids).toContain('settings-activity-log');
    expect(ids).toContain('settings-workspaces');
    expect(ids).not.toContain('settings');
  });

  it('calls onTabChange with the section id when a settings section tab is clicked', async () => {
    const user = userEvent.setup();
    renderTopbar('overview');
    await user.click(screen.getByRole('tab', { name: /theme/i }));
    expect(onTabChange).toHaveBeenCalledWith('settings-theme');
  });

  it('calls onTabChange with "overview" when the Overview tab is clicked', async () => {
    const user = userEvent.setup();
    renderTopbar('settings-theme');
    await user.click(screen.getByRole('tab', { name: /overview/i }));
    expect(onTabChange).toHaveBeenCalledWith('overview');
  });

  it('highlights the active tab with `tab-active`', () => {
    renderTopbar('settings-theme');
    const themeTab = screen.getByRole('tab', { name: /theme/i });
    expect(themeTab).toHaveClass('tab-active');
  });
});