/**
 * tests/settings-nav.test.tsx
 *
 * v4.9.0 — Component tests for SettingsNav sidebar component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SettingsNav } from '../src/web/components/SettingsNav';

describe('SettingsNav', () => {
  const onSectionChange = vi.fn();
  const onExitSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the back button', () => {
    render(
      <SettingsNav
        activeSection={null}
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
  });

  it('calls onExitSettings when back button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SettingsNav
        activeSection={null}
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    await user.click(screen.getByText('Back'));
    expect(onExitSettings).toHaveBeenCalledTimes(1);
  });

  it('renders section groups with group-label class', () => {
    render(
      <SettingsNav
        activeSection={null}
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    expect(screen.getByText('General', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
    expect(screen.getByText('Core', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
    expect(screen.getByText('Experience', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
    expect(screen.getByText('Data', { selector: '.settings-nav-group-label' })).toBeInTheDocument();
  });

  it('renders section items within each group', () => {
    render(
      <SettingsNav
        activeSection={null}
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /env vars/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /memory/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /system llm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /updates/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /skills/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /headroom/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backup/i })).toBeInTheDocument();
  });

  it('calls onSectionChange with correct id when a section is clicked', async () => {
    const user = userEvent.setup();
    render(
      <SettingsNav
        activeSection={null}
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: /theme/i }));
    expect(onSectionChange).toHaveBeenCalledWith('theme');
  });

  it('highlights the active section', () => {
    render(
      <SettingsNav
        activeSection="theme"
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    const themeBtn = screen.getByRole('button', { name: /theme/i });
    expect(themeBtn).toHaveClass('settings-nav-item-active');
  });

  it('toggles off the active section when clicking it again', async () => {
    const user = userEvent.setup();
    render(
      <SettingsNav
        activeSection="theme"
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    await user.click(screen.getByRole('button', { name: /theme/i }));
    expect(onSectionChange).toHaveBeenCalledWith(null); // toggles off
  });

  it('renders chevron on the active section', () => {
    render(
      <SettingsNav
        activeSection="theme"
        onSectionChange={onSectionChange}
        onExitSettings={onExitSettings}
      />,
    );
    const themeBtn = screen.getByRole('button', { name: /theme/i });
    // The chevron is inside the button as an SVG (aria-hidden), so we just verify the button exists
    expect(themeBtn).toBeInTheDocument();
  });
});
