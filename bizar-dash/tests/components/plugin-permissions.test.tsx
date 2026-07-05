// tests/components/plugin-permissions.test.tsx — PluginPermissions and PluginCard unit tests.

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PluginPermissions } from '../../src/web/components/PluginPermissions';
import { PluginCard } from '../../src/web/components/PluginCard';

describe('PluginPermissions', () => {
  it('renders each permission as a chip', () => {
    render(<PluginPermissions permissions={['net', 'fs']} />);
    expect(screen.getByText('Network access')).toBeInTheDocument();
    expect(screen.getByText('Filesystem')).toBeInTheDocument();
  });

  it('shows unknown permission with default label', () => {
    render(<PluginPermissions permissions={['unknown_perm']} />);
    expect(screen.getByText('unknown_perm')).toBeInTheDocument();
  });

  it('handles empty permissions array', () => {
    const { container } = render(<PluginPermissions permissions={[]} />);
    expect(container.querySelector('.plugin-permissions')).toBeInTheDocument();
    expect(container.querySelectorAll('.permission-chip')).toHaveLength(0);
  });
});

describe('PluginCard', () => {
  const defaultPlugin = {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    permissions: ['net', 'fs'],
    invocations: 42,
    lastInvokedAt: '2026-07-05T10:00:00Z',
    enabled: true,
  };

  it('renders name, version, description', () => {
    render(
      <PluginCard
        plugin={defaultPlugin}
        onToggle={vi.fn()}
        onUninstall={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Plugin')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0 · test-plugin')).toBeInTheDocument();
    expect(screen.getByText('A test plugin')).toBeInTheDocument();
  });

  it('calls onToggle when toggle clicked', async () => {
    const onToggle = vi.fn();
    render(
      <PluginCard
        plugin={defaultPlugin}
        onToggle={onToggle}
        onUninstall={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('switch');
    toggle.click();
    expect(onToggle).toHaveBeenCalledWith('test-plugin');
  });

  it('calls onUninstall when uninstall clicked', () => {
    const onUninstall = vi.fn();
    render(
      <PluginCard
        plugin={defaultPlugin}
        onToggle={vi.fn()}
        onUninstall={onUninstall}
        onConfigure={vi.fn()}
      />,
    );
    screen.getByText('Uninstall').click();
    expect(onUninstall).toHaveBeenCalledWith('test-plugin');
  });

  it('calls onConfigure when configure clicked', () => {
    const onConfigure = vi.fn();
    render(
      <PluginCard
        plugin={defaultPlugin}
        onToggle={vi.fn()}
        onUninstall={vi.fn()}
        onConfigure={onConfigure}
      />,
    );
    screen.getByText('Configure').click();
    expect(onConfigure).toHaveBeenCalledWith('test-plugin');
  });
});
