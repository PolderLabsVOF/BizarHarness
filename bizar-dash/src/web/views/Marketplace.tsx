// src/web/views/Marketplace.tsx — browse and install plugins from the marketplace registry.

import { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { MarketplacePluginCard, type MarketplacePlugin } from '../components/MarketplacePluginCard';
import { InstallConfirmDialog } from '../components/InstallConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';

type RegistryResponse = {
  plugins: MarketplacePlugin[];
};

export function Marketplace() {
  const toast = useToast();
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [installing, setInstalling] = useState<MarketplacePlugin | null>(null);
  const [selected, setSelected] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<RegistryResponse>('/plugins/registry')
      .then((r) => setRegistry(r))
      .catch((err) => toast.error(`Failed to load marketplace: ${err.message}`))
      .finally(() => setLoading(false));
  }, [toast]);

  const install = async (plugin: MarketplacePlugin) => {
    setInstalling(plugin);
    try {
      await api.post('/plugins/install', { pluginId: plugin.id });
      toast.success(`${plugin.name} installed`);
      setInstalling(null);
      setSelected(null);
    } catch (err) {
      toast.error(`Install failed: ${(err as Error).message}`);
      setInstalling(null);
    }
  };

  const plugins = registry?.plugins ?? [];
  const filtered = plugins.filter(
    (p) =>
      (!search || p.name.toLowerCase().includes(search.toLowerCase())) &&
      (!category || p.category === category),
  );
  const categories = [...new Set(plugins.map((p) => p.category))];

  if (loading) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="view view-marketplace">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Store size={18} aria-hidden />
            Plugin Marketplace
          </h2>
          <p className="view-subtitle">
            Discover and install plugins from the community registry.
          </p>
        </div>
      </header>

      <div className="marketplace-search-row">
        <input
          className="input"
          type="search"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="category-chips">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={!category ? 'active' : ''}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={category === c ? 'active' : ''}
          >
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Store size={32} />}
          title="No plugins found"
          message={search ? `No plugins match "${search}".` : 'The marketplace is empty.'}
        />
      ) : (
        <div className="marketplace-grid">
          {filtered.map((p) => (
            <MarketplacePluginCard
              key={p.id}
              plugin={p}
              onInstall={() => setSelected(p)}
              onView={() => setSelected(p)}
            />
          ))}
        </div>
      )}

      {selected && (
        <InstallConfirmDialog
          plugin={selected}
          onConfirm={() => install(selected)}
          onCancel={() => setSelected(null)}
          installing={installing?.id === selected.id || false}
        />
      )}
    </div>
  );
}
