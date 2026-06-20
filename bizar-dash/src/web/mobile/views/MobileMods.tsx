// src/mobile/views/MobileMods.tsx — mods list with detail sheet.
import { useEffect, useState } from 'react';
import { Sliders, RefreshCw, Power, Search, RotateCw } from 'lucide-react';
import { api } from '../../lib/api';
import type { Mod, Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
};

export function MobileMods({ snapshot, onBack }: Props) {
  const [mods, setMods] = useState<Mod[]>(snapshot.mods || []);
  const [loading, setLoading] = useState(!snapshot.mods);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [detailMod, setDetailMod] = useState<Mod | null>(null);

  const reload = async () => {
    try {
      const data = await api.get<{ mods: Mod[] }>('/mods');
      setMods(data.mods || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.mods) {
      setMods(snapshot.mods);
      setLoading(false);
    } else {
      reload();
    }
  }, [snapshot.mods]);

  const toggleMod = async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/mods/${encodeURIComponent(id)}`, { enabled });
      setMods((cur) => cur.map((m) => (m.id === id ? { ...m, enabled } : m)));
      if (detailMod?.id === id) setDetailMod((m) => m ? { ...m, enabled } : m);
    } catch {
      // best-effort
    }
  };

  const filtered = mods.filter((m) => {
    if (statusFilter === 'enabled' && !m.enabled) return false;
    if (statusFilter === 'disabled' && m.enabled) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search mods…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => reload()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="mobile-search-scopes">
        {(['all', 'enabled', 'disabled'] as const).map((s) => (
          <button key={s} type="button" className={`mobile-scope-chip ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <Sliders size={40} />
          <p>No mods found.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => setDetailMod(m)}
            >
              <div className="mobile-list-icon"><Sliders size={16} /></div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{m.name}</span>
                <span className="mobile-list-meta">v{m.version} · {m.author}</span>
              </div>
              <span className={`mobile-list-badge ${m.enabled ? 'badge-on' : 'badge-off'}`}>
                {m.enabled ? 'on' : 'off'}
              </span>
            </div>
          ))}
        </div>
      )}

      {detailMod && (
        <MobileBottomSheet
          open={true}
          onClose={() => setDetailMod(null)}
          title={detailMod.name}
          actions={
            <div className="mobile-task-detail-actions">
              <button
                type="button"
                className="mobile-btn"
                style={{ flex: 1 }}
                onClick={() => { if (detailMod) toggleMod(detailMod.id, !detailMod.enabled); }}
              >
                <Power size={14} /> {detailMod.enabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          }
        >
          <div className="mobile-agent-detail">
            <p className="mobile-agent-detail-desc">{detailMod.description || 'No description.'}</p>
            <div className="mobile-agent-detail-meta">
              <div className="mobile-task-detail-row"><span>Version</span><span className="mono">{detailMod.version}</span></div>
              <div className="mobile-task-detail-row"><span>Author</span><span>{detailMod.author}</span></div>
              <div className="mobile-task-detail-row"><span>Bizar</span><span className="mono">{detailMod.bizar}</span></div>
              <div className="mobile-task-detail-row"><span>Type</span><span>{detailMod.type}</span></div>
              <div className="mobile-task-detail-row"><span>Permissions</span><span>{detailMod.permissions.length}</span></div>
              {detailMod.installedAt && (
                <div className="mobile-task-detail-row"><span>Installed</span><span>{new Date(detailMod.installedAt).toLocaleDateString()}</span></div>
              )}
            </div>
          </div>
        </MobileBottomSheet>
      )}
    </div>
  );
}
