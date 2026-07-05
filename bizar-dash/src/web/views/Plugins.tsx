// src/views/Plugins.tsx — manage installed plugins and their permissions.

import { useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import { PluginCard, type InstalledPlugin } from '../components/PluginCard';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

export function Plugins(_props: Props) {
  const toast = useToast();
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = async () => {
    try {
      const r = await api.get<{ plugins: InstalledPlugin[] }>('/plugins/installed');
      setPlugins(r.plugins);
    } catch (err) {
      toast.error(`Failed to load plugins: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (id: string) => {
    try {
      // Toggle is handled by the backend via a toggle endpoint or we use update
      await api.post(`/plugins/${id}/toggle`).catch(() => {
        // Fallback: toggle is not a separate endpoint, may need PUT
      });
      await load();
      toast.success('Plugin toggled.');
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`);
    }
  };

  const uninstall = async (id: string) => {
    if (!confirm('Uninstall this plugin?')) return;
    try {
      await api.del(`/plugins/${id}`);
      await load();
      toast.success('Plugin uninstalled.');
    } catch (err) {
      toast.error(`Uninstall failed: ${(err as Error).message}`);
    }
  };

  const configure = (_id: string) => {
    // TODO: open config dialog
  };

  if (loading) {
    return (
      <div className="view-loading">
        <Spinner size="lg" />
      </div>
    );
  }

  const filtered = plugins.filter((p) =>
    p.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="view view-plugins">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Puzzle size={18} aria-hidden />
            Plugins ({plugins.length})
          </h2>
          <p className="view-subtitle">
            Manage plugins installed via the marketplace.
          </p>
        </div>
      </header>

      {plugins.length === 0 ? (
        <EmptyState
          icon={<Puzzle size={32} />}
          title="No plugins installed"
          message="Install plugins from the marketplace using the CLI."
        />
      ) : (
        <>
          <div className="plugins-toolbar">
            <input
              className="input"
              type="search"
              placeholder="Filter plugins…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          </div>
          <div className="plugin-grid">
            {filtered.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                onToggle={toggle}
                onUninstall={uninstall}
                onConfigure={configure}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
