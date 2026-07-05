// tests/components/marketplace-plugin-card.test.tsx — MarketplacePluginCard and InstallConfirmDialog unit tests.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ModalProvider } from '../../src/web/components/Modal';
import { MarketplacePluginCard } from '../../src/web/components/MarketplacePluginCard';
import { InstallConfirmDialog } from '../../src/web/components/InstallConfirmDialog';
import { PluginPermissions } from '../../src/web/components/PluginPermissions';

const defaultPlugin = {
  id: 'test-marketplace-plugin',
  name: 'Test Marketplace Plugin',
  version: '2.1.0',
  author: 'TestAuthor',
  description: 'A test plugin for the marketplace',
  category: 'Utilities',
  tags: ['testing', 'utility'],
  permissions: ['net', 'fs'],
};

describe('MarketplacePluginCard', () => {
  it('renders name, version, description', () => {
    render(
      <MarketplacePluginCard
        plugin={defaultPlugin}
        onInstall={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Marketplace Plugin')).toBeInTheDocument();
    expect(screen.getByText('v2.1.0 · Utilities')).toBeInTheDocument();
    expect(screen.getByText('A test plugin for the marketplace')).toBeInTheDocument();
  });

  it('shows tags as chips', () => {
    render(
      <MarketplacePluginCard
        plugin={defaultPlugin}
        onInstall={vi.fn()}
        onView={vi.fn()}
      />,
    );
    expect(screen.getByText('testing')).toBeInTheDocument();
    expect(screen.getByText('utility')).toBeInTheDocument();
  });

  it('shows permissions', () => {
    render(
      <MarketplacePluginCard
        plugin={defaultPlugin}
        onInstall={vi.fn()}
        onView={vi.fn()}
      />,
    );
    // PluginPermissions renders "Network access" for 'net' and "Filesystem" for 'fs'
    expect(screen.getByText('Network access')).toBeInTheDocument();
    expect(screen.getByText('Filesystem')).toBeInTheDocument();
  });

  it('calls onInstall when Install clicked', async () => {
    const onInstall = vi.fn();
    const user = userEvent.setup();
    render(
      <MarketplacePluginCard
        plugin={defaultPlugin}
        onInstall={onInstall}
        onView={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('calls onView when Details clicked', async () => {
    const onView = vi.fn();
    const user = userEvent.setup();
    render(
      <MarketplacePluginCard
        plugin={defaultPlugin}
        onInstall={vi.fn()}
        onView={onView}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(onView).toHaveBeenCalledTimes(1);
  });
});

function InstallConfirmDialogTestHarness({ plugin, installing = false }: {
  plugin: typeof defaultPlugin;
  installing?: boolean;
}) {
  return (
    <ModalProvider>
      <InstallConfirmDialog
        plugin={plugin}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        installing={installing}
      />
    </ModalProvider>
  );
}

describe('InstallConfirmDialog', () => {
  it('renders plugin name and description', async () => {
    render(<InstallConfirmDialogTestHarness plugin={defaultPlugin} />);
    // The dialog content is rendered in a modal, check for the title
    expect(await screen.findByText('Install Test Marketplace Plugin?')).toBeInTheDocument();
    expect(screen.getByText('A test plugin for the marketplace')).toBeInTheDocument();
  });

  it('shows permissions prominently', async () => {
    render(<InstallConfirmDialogTestHarness plugin={defaultPlugin} />);
    expect(await screen.findByText('Network access')).toBeInTheDocument();
    expect(screen.getByText('Filesystem')).toBeInTheDocument();
  });

  it('disables buttons during install', async () => {
    render(<InstallConfirmDialogTestHarness plugin={defaultPlugin} installing={true} />);
    expect(await screen.findByRole('button', { name: 'Installing...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});

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
