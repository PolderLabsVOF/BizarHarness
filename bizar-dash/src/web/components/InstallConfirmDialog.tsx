// src/web/components/InstallConfirmDialog.tsx — confirmation dialog for installing a marketplace plugin.

import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useModal } from './Modal';
import { Button } from './Button';
import { PluginPermissions } from './PluginPermissions';
import type { MarketplacePlugin } from './MarketplacePluginCard';

export type InstallConfirmDialogProps = {
  plugin: MarketplacePlugin;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  installing: boolean;
};

export function InstallConfirmDialog({ plugin, onConfirm, onCancel, installing }: InstallConfirmDialogProps) {
  const modal = useModal();
  // Track the plugin id we've opened the modal for, so we don't re-open on every render.
  const openedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!plugin) return;
    // Only open if we haven't already opened for this plugin.
    if (openedForRef.current === plugin.id) return;
    openedForRef.current = plugin.id;

    modal.open({
      title: `Install ${plugin.name}?`,
      width: 480,
      onClose: () => {
        openedForRef.current = null;
        onCancel();
      },
      children: (
        <div className="install-confirm">
          <h3>{plugin.name} v{plugin.version}</h3>
          {plugin.description && <p>{plugin.description}</p>}

          <div className="install-warning">
            <AlertTriangle size={16} />
            <p>This plugin will run code on your machine. It requests these permissions:</p>
          </div>

          <PluginPermissions permissions={plugin.permissions ?? []} />

          <div className="install-confirm-actions">
            <Button onClick={onCancel} disabled={installing}>Cancel</Button>
            <Button variant="primary" onClick={onConfirm} disabled={installing}>
              {installing ? 'Installing...' : 'Install'}
            </Button>
          </div>
        </div>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin, installing]);

  // This component manages its own modal state via useModal.
  // Render nothing in the React tree — the modal is rendered via portal.
  return null;
}
