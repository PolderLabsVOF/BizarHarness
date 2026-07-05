// src/web/mobile/MobileMarketplace.tsx — v5.4 mobile plugin marketplace with search.
import { useEffect, useState } from 'react';
import { Store, Search } from 'lucide-react';
import { api } from '../lib/api';
import { MarketplacePluginCard, type MarketplacePlugin } from '../components/MarketplacePluginCard';

type RegistryResponse = {
  plugins: MarketplacePlugin[];
};

export function MobileMarketplace() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [search, setSearch] = useState('');
  const [installing, setInstalling] = useState<MarketplacePlugin | null>(null);
  const [selected, setSelected] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<RegistryResponse>('/plugins/registry')
      .then((r) => setRegistry(r))
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  const install = async (plugin: MarketplacePlugin) => {
    setInstalling(plugin);
    try {
      await api.post('/plugins/install', { pluginId: plugin.id });
      setInstalling(null);
      setSelected(null);
    } catch {
      setInstalling(null);
    }
  };

  const filtered = (registry?.plugins ?? []).filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="mobile-loading">
        <p>Loading marketplace…</p>
      </div>
    );
  }

  return (
    <div className="mobile-marketplace">
      <div className="mobile-marketplace-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search plugins…"
          aria-label="Search plugins"
        />
      </div>

      <div className="mobile-marketplace-list">
        {filtered.length === 0 ? (
          <div className="mobile-empty">
            <Store size={32} />
            <p>No plugins{search ? ` match "${search}"` : ' in marketplace'}.</p>
          </div>
        ) : (
          filtered.map((p) => (
            <MarketplacePluginCard
              key={p.id}
              plugin={p}
              onInstall={() => setSelected(p)}
              onView={() => setSelected(p)}
            />
          ))
        )}
      </div>

      {selected && (
        <div className="mobile-plugin-install-dialog">
          <div className="mobile-plugin-install-dialog-head">
            <h3>{selected.name}</h3>
            <p>{selected.description}</p>
          </div>
          <div className="mobile-plugin-install-dialog-actions">
            <button
              type="button"
              className="mobile-btn mobile-btn-secondary"
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="mobile-btn mobile-btn-primary"
              disabled={installing?.id === selected.id}
              onClick={() => install(selected)}
            >
              {installing?.id === selected.id ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
