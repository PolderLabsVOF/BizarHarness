/**
 * tests/settings-mode-wiring.test.tsx
 *
 * v4.9.0 — Wiring tests for settings mode.
 * Verifies:
 * 1. Topbar Settings tab calls onTabChange('settings') when clicked
 * 2. Sidebar renders SettingsNav when settingsMode is true
 * 3. Sidebar renders normal tab rail when settingsMode is false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Sidebar } from '../src/web/components/Sidebar';
import { Topbar, TABS } from '../src/web/components/Topbar';
import type { TabDef } from '../src/web/components/Topbar';

// Minimal tabs for testing (first 4 tabs from TABS)
const TEST_TABS: TabDef[] = TABS.slice(0, 4);

describe('Settings mode wiring', () => {
  describe('Topbar', () => {
    it('calls onTabChange with "settings" when the Settings tab is clicked', async () => {
      const onTabChange = vi.fn();
      const user = userEvent.setup();

      render(
        <Topbar
          activeTab="overview"
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

      // Find and click the Settings tab
      const settingsTab = screen.getByRole('tab', { name: /settings/i });
      await user.click(settingsTab);

      expect(onTabChange).toHaveBeenCalledWith('settings');
    });

    it('calls onTabChange with "overview" when the Overview tab is clicked', async () => {
      const onTabChange = vi.fn();
      const user = userEvent.setup();

      render(
        <Topbar
          activeTab="settings"
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

      const overviewTab = screen.getByRole('tab', { name: /overview/i });
      await user.click(overviewTab);

      expect(onTabChange).toHaveBeenCalledWith('overview');
    });
  });

  describe('Sidebar', () => {
    const onTabChange = vi.fn();
    const onSettingsSectionChange = vi.fn();
    const onExitSettings = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders SettingsNav when settingsMode is true', () => {
      render(
        <Sidebar
          tabs={TEST_TABS}
          activeTab="settings"
          onTabChange={onTabChange}
          settingsMode={true}
          settingsActiveSection={null}
          onSettingsSectionChange={onSettingsSectionChange}
          onExitSettings={onExitSettings}
        />,
      );

      // SettingsNav should be visible (renders the back button)
      expect(screen.getByRole('button', { name: /exit settings/i })).toBeInTheDocument();
      // Normal tab rail should NOT be visible
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('renders normal tab rail when settingsMode is false', () => {
      render(
        <Sidebar
          tabs={TEST_TABS}
          activeTab="overview"
          onTabChange={onTabChange}
          settingsMode={false}
        />,
      );

      // Tab rail should be visible
      expect(screen.getByRole('tablist')).toBeInTheDocument();
      // SettingsNav should NOT be visible
      expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    });

    it('exits settings mode when back button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <Sidebar
          tabs={TEST_TABS}
          activeTab="settings"
          onTabChange={onTabChange}
          settingsMode={true}
          settingsActiveSection={null}
          onSettingsSectionChange={onSettingsSectionChange}
          onExitSettings={onExitSettings}
        />,
      );

      await user.click(screen.getByRole('button', { name: /exit settings/i }));
      expect(onExitSettings).toHaveBeenCalledTimes(1);
    });

    it('calls onTabChange when a tab is clicked while in settingsMode=false', async () => {
      const user = userEvent.setup();
      render(
        <Sidebar
          tabs={TEST_TABS}
          activeTab="overview"
          onTabChange={onTabChange}
          settingsMode={false}
        />,
      );

      // Click the Chat tab
      await user.click(screen.getByRole('tab', { name: /chat/i }));
      expect(onTabChange).toHaveBeenCalledWith('chat');
    });
  });
});
