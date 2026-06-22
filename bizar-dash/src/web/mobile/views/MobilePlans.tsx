// src/mobile/views/MobilePlans.tsx — plan list with tap-to-open.
import { useEffect, useState } from 'react';
import { FileText, Plus, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';
import type { Plan, Snapshot } from '../../lib/types';
import { MobileModal } from '../components/MobileModal';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
  onOpenPlan: (slug: string) => void;
};

export function MobilePlans({ snapshot, onBack, onOpenPlan }: Props) {
  const [plans, setPlans] = useState<Plan[]>(snapshot.plans || []);
  const [loading, setLoading] = useState(!snapshot.plans);
  const [filter, setFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');

  const reload = async () => {
    try {
      const data = await api.get<{ plans: Plan[] }>('/plans');
      setPlans(data.plans || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async () => {
    if (!newSlug.trim()) return;
    try {
      const result = await api.post<{ slug: string }>('/plans', {
        slug: newSlug.trim(),
        title: newTitle.trim() || undefined,
      });
      setNewOpen(false);
      setNewSlug('');
      setNewTitle('');
      onOpenPlan(result.slug);
    } catch {
      // best-effort
    }
  };

  const filtered = filter.trim()
    ? plans.filter((p) =>
        (p.title || p.slug || '').toLowerCase().includes(filter.toLowerCase()),
      )
    : plans;

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search plans…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => reload()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* New plan */}
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="mobile-btn"
          style={{ width: '100%' }}
          onClick={() => setNewOpen(true)}
        >
          <Plus size={14} /> New Plan
        </button>
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <FileText size={40} />
          <p>No plans yet.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((p) => (
            <button
              key={p.slug}
              type="button"
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => onOpenPlan(p.slug)}
            >
              <div className="mobile-list-icon"><FileText size={16} /></div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{p.title || p.slug}</span>
                <span className="mobile-list-meta">
                  {p.status} · {p.source}
                  {p.elementCount != null ? ` · ${p.elementCount} elements` : ''}
                  {p.commentCount != null ? ` · ${p.commentCount} comments` : ''}
                </span>
              </div>
              <span className={`mobile-list-badge`} data-status={p.status}>{p.status}</span>
            </button>
          ))}
        </div>
      )}

      <MobileModal open={newOpen} onClose={() => setNewOpen(false)} title="New Plan" actions={
        <button type="submit" form="new-plan-form" className="mobile-btn" style={{ width: '100%' }}>
          <Plus size={14} /> Create
        </button>
      }>
        <form id="new-plan-form" onSubmit={(e) => { e.preventDefault(); createPlan(); }} className="mobile-task-form">
          <label className="mobile-field-label">Slug *</label>
          <input
            className="mobile-input"
            type="text"
            placeholder="my-plan"
            pattern="[a-z0-9][a-z0-9-]{0,63}"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            autoFocus
            required
          />
          <label className="mobile-field-label">Title (optional)</label>
          <input
            className="mobile-input"
            type="text"
            placeholder="My Plan"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </form>
      </MobileModal>
    </div>
  );
}
