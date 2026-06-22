// src/mobile/views/MobileSkills.tsx — skills list with detail sheet.
import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, Power } from 'lucide-react';
import { api } from '../../lib/api';
import type { Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';

type Skill = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  source: string;
  enabled?: boolean;
};

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
};

const CATEGORIES = ['languages', 'framework', 'design', 'testing', 'devops', 'data', 'security', 'integration'];

export function MobileSkills({ snapshot, onBack }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ skills: Skill[] }>('/skills');
      setSkills(data.skills || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleSkill = async (id: string, enabled: boolean) => {
    try {
      await api.patch(`/skills/${encodeURIComponent(id)}`, { enabled });
      setSkills((cur) => cur.map((s) => (s.id === id ? { ...s, enabled } : s)));
      if (detailSkill?.id === id) setDetailSkill((s) => s ? { ...s, enabled } : s);
    } catch {
      // best-effort
    }
  };

  const filtered = skills.filter((s) => {
    if (categoryFilter && s.category !== categoryFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search skills…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => load()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="mobile-search-scopes">
        <button type="button" className={`mobile-scope-chip ${!categoryFilter ? 'active' : ''}`} onClick={() => setCategoryFilter('')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={`mobile-scope-chip ${categoryFilter === c ? 'active' : ''}`} onClick={() => setCategoryFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <Sparkles size={40} />
          <p>No skills found.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => setDetailSkill(s)}
            >
              <div className="mobile-list-icon"><Sparkles size={16} /></div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{s.name}</span>
                <span className="mobile-list-meta">{s.category} · v{s.version}</span>
              </div>
              <span className={`mobile-list-badge ${s.enabled ? 'badge-on' : 'badge-off'}`}>
                {s.enabled ? 'on' : 'off'}
              </span>
            </button>
          ))}
        </div>
      )}

      {detailSkill && (
        <MobileBottomSheet
          open={true}
          onClose={() => setDetailSkill(null)}
          title={detailSkill.name}
          actions={
            <button
              type="button"
              className={`mobile-btn ${detailSkill.enabled ? 'mobile-btn-secondary' : ''}`}
              style={{ width: '100%' }}
              onClick={() => { if (detailSkill) toggleSkill(detailSkill.id, !detailSkill.enabled); }}
            >
              <Power size={14} /> {detailSkill.enabled ? 'Disable' : 'Enable'}
            </button>
          }
        >
          <div className="mobile-agent-detail">
            <p className="mobile-agent-detail-desc">{detailSkill.description || 'No description.'}</p>
            <div className="mobile-agent-detail-meta">
              <div className="mobile-task-detail-row"><span>Category</span><span>{detailSkill.category}</span></div>
              <div className="mobile-task-detail-row"><span>Version</span><span className="mono">{detailSkill.version}</span></div>
              <div className="mobile-task-detail-row"><span>Source</span><span>{detailSkill.source}</span></div>
              {detailSkill.tags.length > 0 && (
                <div className="mobile-task-detail-row">
                  <span>Tags</span>
                  <span>{detailSkill.tags.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        </MobileBottomSheet>
      )}
    </div>
  );
}
