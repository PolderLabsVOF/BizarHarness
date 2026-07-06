// src/web/views/Marketplace.tsx — browse and install plugins from the marketplace registry.
// v6.x — Better UX: explicit loading + registry URL, refresh button, "showing
// cached" notice when the disk cache is the source, and a friendlier empty
// state when the registry returns zero plugins. The category filter chips
// are kept (they were already there but unverified).
import { useCallback, useEffect, useState } from 'react';
import { Store, RefreshCw, AlertTriangle, Wifi, Globe, Clock } from 'lucide-react';
import { MarketplacePluginCard, type MarketplacePlugin } from '../components/MarketplacePluginCard';
import { InstallConfirmDialog } from '../components/InstallConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';
import { api, ApiError } from '../lib/api';

type RegistryResponse = {
  plugins: MarketplacePlugin[];
  registry?: {
    source?: string | null;
    updatedAt?: string | null;
  };
  /** v6.x — Server indicates when this response came from the on-disk cache. */
  cached?: boolean;
  /** v6.x — When the on-disk cache was last refreshed (epoch ms). */
  cacheTimestamp?: number | null;
  /** v6.x — How many registry URLs were tried. */
  urlsTried?: number;
};

export function Marketplace() {
  const toast = useToast();
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [installing, setInstalling] = useState<MarketplacePlugin | null>(null);
  const [selected, setSelected] = useState<MarketplacePlugin | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ message: string; url?: string } | null>(null);

  const fetchRegistry = useCallback(async (opts: { refresh?: boolean } = {}) => {
    if (opts.refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await api.get<RegistryResponse>('/plugins/registry');
      setRegistry(r);
    } catch (err) {
      const e = err as ApiError;
      const data = e?.data as { registryUrl?: string } | null;
      const url = data?.registryUrl;
      const message = e?.message || 'unknown error';
      setError({ message, url });
      toast.error(`Failed to load marketplace: ${message}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

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

  const sourceUrl = registry?.registry?.source;
  const isCached = !!registry?.cached;
  const cacheTimestamp = registry?.cacheTimestamp ?? null;

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="view view-marketplace">
        <header className="view-header">
          <div className="view-header-text">
            <h2 className="view-title">
              <Store size={18} aria-hidden />
              Plugin Marketplace
            </h2>
            <p className="view-subtitle">
              Fetching registry from the community server…
            </p>
          </div>
        </header>
        <div className="view-loading" data-testid="marketplace-loading">
          <Spinner size="lg" />
          <p>Fetching registry from <code>{sourceUrl ?? 'https://github.com/DrB0rk/bizar-mods'}</code>…</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="view view-marketplace">
        <header className="view-header">
          <div className="view-header-text">
            <h2 className="view-title">
              <Store size={18} aria-hidden />
              Plugin Marketplace
            </h2>
            <p className="view-subtitle">
              Couldn't reach the community registry.
            </p>
          </div>
          <div className="view-actions">
            <Button variant="secondary" size="sm" onClick={() => fetchRegistry({ refresh: true })} disabled={refreshing}>
              {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
              Retry
            </Button>
          </div>
        </header>
        <EmptyState
          icon={<AlertTriangle size={32} />}
          title="Registry unreachable"
          message={
            <>
              <p>All registry URLs failed to respond.</p>
              {error.url && (
                <p className="mono muted" style={{ marginTop: 8, fontSize: 12 }}>
                  Last tried: {error.url}
                </p>
              )}
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>{error.message}</p>
            </>
          }
          action={
            <Button variant="primary" size="sm" onClick={() => fetchRegistry({ refresh: true })} disabled={refreshing}>
              {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />} Try again
            </Button>
          }
        />
      </div>
    );
  }

  // ── Success state ──────────────────────────────────────────────────────
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
        <div className="view-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchRegistry({ refresh: true })}
            disabled={refreshing}
            data-testid="marketplace-refresh"
          >
            {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        </div>
      </header>

      {/* Registry source banner */}
      <div className="marketplace-source-banner muted" data-testid="marketplace-source">
        <Globe size={12} aria-hidden />
        <span>
          Source:{' '}
          {sourceUrl ? (
            <code className="mono">{sourceUrl}</code>
          ) : (
            <span>community registry</span>
          )}
        </span>
        {isCached && (
          <span className="marketplace-cache-notice" data-testid="marketplace-cache-notice">
            <Clock size={12} aria-hidden /> Showing cached results
            {cacheTimestamp && ` from ${new Date(cacheTimestamp).toLocaleString()}`}
          </span>
        )}
        <span className="marketplace-count-pill" data-testid="marketplace-count">
          {plugins.length} plugin{plugins.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="marketplace-search-row">
        <input
          className="input"
          type="search"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
          aria-label="Search marketplace plugins"
        />
      </div>

      {categories.length > 0 && (
        <div className="category-chips">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={!category ? 'active' : ''}
            data-testid="marketplace-category-all"
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={category === c ? 'active' : ''}
              data-testid={`marketplace-category-${c.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={plugins.length === 0 ? <Wifi size={32} /> : <Store size={32} />}
          title={plugins.length === 0 ? 'No plugins published yet' : 'No plugins match your filter'}
          message={
            plugins.length === 0 ? (
              <>
                <p>The community registry is empty right now.</p>
                {sourceUrl && (
                  <p className="mono muted" style={{ marginTop: 8, fontSize: 12 }}>
                    Check back at <code>{sourceUrl}</code> later, or publish your own.
                  </p>
                )}
              </>
            ) : search ? (
              `No plugins match "${search}".`
            ) : category ? (
              `No plugins in "${category}".`
            ) : (
              'Try a different search or category filter.'
            )
          }
          action={
            plugins.length === 0 ? (
              <Button variant="secondary" size="sm" onClick={() => fetchRegistry({ refresh: true })} disabled={refreshing}>
                {refreshing ? <Spinner size="sm" /> : <RefreshCw size={14} />} Refresh
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="marketplace-grid" data-testid="marketplace-grid">
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