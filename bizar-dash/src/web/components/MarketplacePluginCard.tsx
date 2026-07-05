// src/web/components/MarketplacePluginCard.tsx — card for a plugin listed in the marketplace.

import { Card, CardTitle, CardMeta } from './Card';
import { Button } from './Button';
import { PluginPermissions } from './PluginPermissions';

export type MarketplacePlugin = {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  category: string;
  tags?: string[];
  permissions?: string[];
};

export type MarketplacePluginCardProps = {
  plugin: MarketplacePlugin;
  onInstall: () => void;
  onView: () => void;
};

export function MarketplacePluginCard({ plugin, onInstall, onView }: MarketplacePluginCardProps) {
  return (
    <Card className="marketplace-plugin-card">
      <div className="marketplace-plugin-head">
        <div>
          <CardTitle>{plugin.name}</CardTitle>
          <CardMeta>v{plugin.version} · {plugin.category}</CardMeta>
        </div>
        <div className="marketplace-plugin-author">{plugin.author}</div>
      </div>
      {plugin.description && (
        <p className="marketplace-plugin-description">{plugin.description}</p>
      )}
      {plugin.tags && plugin.tags.length > 0 && (
        <div className="marketplace-plugin-tags">
          {plugin.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}
      <PluginPermissions permissions={plugin.permissions ?? []} />
      <div className="marketplace-plugin-actions">
        <Button onClick={onView}>Details</Button>
        <Button variant="primary" onClick={onInstall}>Install</Button>
      </div>
    </Card>
  );
}
