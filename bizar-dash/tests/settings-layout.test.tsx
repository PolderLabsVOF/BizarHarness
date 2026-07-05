/**
 * tests/settings-layout.test.tsx
 *
 * v4.9.0 — Integration tests for the settings sidebar layout mode.
 * Verifies that when settingsMode is active, the sidebar shows SettingsNav
 * and clicking sections updates the active section.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../src/web/components/Sidebar';
import type { TabDef } from '../src/web/components/Topbar';
import { LayoutDashboard, MessageSquare, Sliders } from 'lucide-react';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'settings', label: 'Settings', icon: Sliders },
];

describe('Sidebar — settingsMode', () => {
  const onTabChange = vi.fn();
  const onSettingsSectionChange = vi.fn();
  const onExitSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders normal tab rail when settingsMode is false', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="overview"
        onTabChange={onTabChange}
        settingsMode={false}
      />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument();
  });

  it('renders SettingsNav instead of tab rail when settingsMode is true', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="settings"
        onTabChange={onTabChange}
        settingsMode={true}
        settingsActiveSection={null}
        onSettingsSectionChange={onSettingsSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    // Should NOT show the normal tab rail
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    // Should show the back button
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    // Should show section groups (use selector to avoid duplicate text matches)
    expect(screen.getByText('General', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
    expect(screen.getByText('Core', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
  });

  it('shows Back button that calls onExitSettings', async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        tabs={TABS}
        activeTab="settings"
        onTabChange={onTabChange}
        settingsMode={true}
        settingsActiveSection={null}
        onSettingsSectionChange={onSettingsSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    await user.click(screen.getByText('Back'));
    expect(onExitSettings).toHaveBeenCalledTimes(1);
  });

  it('highlights the active section when settingsActiveSection is set', () => {
    render(
      <Sidebar
        tabs={TABS}
        activeTab="settings"
        onTabChange={onTabChange}
        settingsMode={true}
        settingsActiveSection="theme"
        onSettingsSectionChange={onSettingsSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    const themeBtn = screen.getByRole('button', { name: /theme/i });
    expect(themeBtn).toHaveClass('settings-nav-item-active');
  });

  it('calls onSettingsSectionChange when a section is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        tabs={TABS}
        activeTab="settings"
        onTabChange={onTabChange}
        settingsMode={true}
        settingsActiveSection={null}
        onSettingsSectionChange={onSettingsSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: /memory/i }));
    expect(onSettingsSectionChange).toHaveBeenCalledWith('memory');
  });

  it('calls onTabChange when a normal sidebar tab is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Sidebar
        tabs={TABS}
        activeTab="overview"
        onTabChange={onTabChange}
        settingsMode={false}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /chat/i }));
    expect(onTabChange).toHaveBeenCalledWith('chat');
  });
});
