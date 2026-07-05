// src/web/mobile/MobilePlugins.tsx — v5.4 mobile installed plugins list with search.
import { useEffect, useState } from 'react';
import { Puzzle, Search } from 'lucide-react';
import { api } from '../lib/api';
import { PluginPermissions } from '../components/PluginPermissions';
import type { InstalledPlugin } from '../components/PluginCard';

export function MobilePlugins() {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get<{ plugins: InstalledPlugin[] }>('/plugins/installed')
      .then((r) => setPlugins(r.plugins ?? []))
      .catch(() => {/* best-effort */})
      .finally(() => setLoading(false));
  }, []);

  const filtered = plugins.filter(
    (p) => !search || p.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="mobile-loading">
        <p>Loading plugins…</p>
      </div>
    );
  }

  return (
    <div className="mobile-plugins">
      <div className="mobile-plugins-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search installed plugins…"
          aria-label="Search plugins"
        />
      </div>

      <div className="mobile-plugins-list">
        {filtered.length === 0 ? (
          <div className="mobile-empty">
            <Puzzle size={32} />
            <p>{search ? `No plugins match "${search}".` : 'No plugins installed.'}</p>
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="mobile-plugin-card">
              <div className="mobile-plugin-card-head">
                <div className="mobile-plugin-name">{p.name}</div>
                <div className="mobile-plugin-version">v{p.version}</div>
              </div>
              {p.description && (
                <p className="mobile-plugin-description">{p.description}</p>
              )}
              <PluginPermissions permissions={p.permissions ?? []} />
              <div className="mobile-plugin-stats">
                {p.invocations ?? 0} invocations
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
