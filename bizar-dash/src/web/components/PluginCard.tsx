// src/web/components/PluginCard.tsx — card for one installed plugin with toggle, configure, and uninstall.

import { Card, CardTitle, CardMeta } from './Card';
import { Button } from './Button';
import { Toggle } from './Toggle';
import { PluginPermissions } from './PluginPermissions';

export type InstalledPlugin = {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions?: string[];
  config?: Record<string, unknown>;
  methodCount?: number;
  invocations?: number;
  lastInvokedAt?: string | null;
  enabled?: boolean;
};

export type PluginCardProps = {
  plugin: InstalledPlugin;
  onToggle: (id: string) => void;
  onUninstall: (id: string) => void;
  onConfigure: (id: string) => void;
};

export function PluginCard({ plugin, onToggle, onUninstall, onConfigure }: PluginCardProps) {
  return (
    <Card>
      <div className="plugin-card-head">
        <div>
          <CardTitle>{plugin.name}</CardTitle>
          <CardMeta>
            v{plugin.version} · {plugin.id}
          </CardMeta>
        </div>
        <Toggle
          checked={plugin.enabled ?? true}
          onChange={() => onToggle(plugin.id)}
          aria-label={`Toggle ${plugin.name} enabled`}
        />
      </div>
      {plugin.description && (
        <p className="plugin-description">{plugin.description}</p>
      )}
      <PluginPermissions permissions={plugin.permissions ?? []} />
      <div className="plugin-card-actions">
        <Button size="sm" onClick={() => onConfigure(plugin.id)}>
          Configure
        </Button>
        <Button size="sm" variant="danger" onClick={() => onUninstall(plugin.id)}>
          Uninstall
        </Button>
      </div>
      <div className="plugin-card-stats">
        {plugin.invocations ?? 0} invocations
        {plugin.lastInvokedAt
          ? ` · last used ${plugin.lastInvokedAt}`
          : ' · never used'}
      </div>
    </Card>
  );
}
