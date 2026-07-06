/**
 * tests/views/sidebar.test.tsx
 *
 * v6.x — Sidebar tests. Each settings section is its own top-level tab;
 * there is no longer a `settingsMode` toggle or sub-nav render path.
 * The Sidebar always renders the regular `.sidebar-tab` rail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../../src/web/components/Sidebar';
import type { TabDef } from '../../src/web/components/Topbar';
import { LayoutDashboard, MessageSquare, Bot } from 'lucide-react';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'agents', label: 'Agents', icon: Bot },
];

const SETTINGS_TABS: TabDef[] = [
  { id: 'settings-theme', label: 'Theme', icon: LayoutDashboard },
  { id: 'settings-general', label: 'General', icon: MessageSquare },
];

describe('Sidebar', () => {
  const onTabChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the regular tab rail', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /agents/i })).toBeInTheDocument();
  });

  it('does not render the legacy SettingsNav back button', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.queryByRole('button', { name: /exit settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });

  it('highlights the active tab', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="chat"
        onTabChange={onTabChange}
      />,
    );
    const chatTab = screen.getByRole('tab', { name: /chat/i });
    expect(chatTab).toHaveClass('sidebar-tab-active');
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        tabs={TABS}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /chat/i }));
    expect(onTabChange).toHaveBeenCalledWith('chat');
  });

  it('renders settings sections as their own tabs', () => {
    render(
      <Sidebar
        tabs={[...TABS, ...SETTINGS_TABS]}
        activeTab="settings-theme"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('tab', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /general/i })).toBeInTheDocument();
    const themeTab = screen.getByRole('tab', { name: /theme/i });
    expect(themeTab).toHaveClass('sidebar-tab-active');
  });

  it('renders mod views under a "Mods" divider', () => {
    const modTab: TabDef & { isMod?: boolean } = {
      id: 'graphify:web',
      label: 'Graph',
      icon: LayoutDashboard,
      isMod: true,
    };
    render(
      <Sidebar
        tabs={[...TABS, modTab]}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByText('Mods')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /graph/i })).toBeInTheDocument();
  });
});