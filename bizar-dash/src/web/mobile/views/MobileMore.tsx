// src/mobile/views/MobileMore.tsx — mobile More tab: agents, plans, projects, config.
import { Bot, FileText, Folder, Sliders, ChevronRight } from 'lucide-react';
import type { Snapshot } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
  setActiveTab: (id: string) => void;
};

export function MobileMore({ snapshot, setActiveTab }: Props) {
  const agents = snapshot.agents || [];
  const plans = snapshot.plans || [];
  const projects = snapshot.projects || [];
  const mods = snapshot.mods || [];

  return (
    <div className="mobile-view">
      {/* Agents */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">
          <Bot size={14} /> Agents ({agents.length})
        </h3>
        <div className="mobile-card-list">
          {agents.slice(0, 10).map((a) => (
            <div key={a.name} className="mobile-list-item">
              <div className="mobile-list-icon">
                <Bot size={16} />
              </div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{a.name}</span>
                <span className="mobile-list-meta">{a.model || a.mode || '—'}</span>
              </div>
              <div className="mobile-list-badge" data-status={a.status || 'idle'}>
                {a.status || 'idle'}
              </div>
            </div>
          ))}
          {agents.length === 0 && (
            <p className="mobile-empty-inline">No agents configured.</p>
          )}
        </div>
      </section>

      {/* Plans */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">
          <FileText size={14} /> Plans ({plans.length})
        </h3>
        <div className="mobile-card-list">
          {plans.slice(0, 10).map((p) => (
            <div key={p.slug} className="mobile-list-item">
              <div className="mobile-list-icon">
                <FileText size={16} />
              </div>
              <div className="mobile-list-content">
                <span className="mobile-list-title">{p.title}</span>
                <span className="mobile-list-meta">{p.status} · {p.source}</span>
              </div>
            </div>
          ))}
          {plans.length === 0 && (
            <p className="mobile-empty-inline">No plans yet.</p>
          )}
        </div>
      </section>

      {/* Projects */}
      {projects.length > 0 && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">
            <Folder size={14} /> Projects ({projects.length})
          </h3>
          <div className="mobile-card-list">
            {projects.slice(0, 8).map((p) => (
              <div key={p.id} className="mobile-list-item">
                <div className="mobile-list-icon">
                  <Folder size={16} />
                </div>
                <div className="mobile-list-content">
                  <span className="mobile-list-title">{p.name}</span>
                  <span className="mobile-list-meta">{p.status}</span>
                </div>
                {snapshot.activeProject?.id === p.id && (
                  <span className="mobile-active-badge">active</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mods */}
      {mods.length > 0 && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">
            <Sliders size={14} /> Mods ({mods.length})
          </h3>
          <div className="mobile-card-list">
            {mods.slice(0, 10).map((m) => (
              <div key={m.id} className="mobile-list-item">
                <div className="mobile-list-icon">
                  <Sliders size={16} />
                </div>
                <div className="mobile-list-content">
                  <span className="mobile-list-title">{m.name}</span>
                  <span className="mobile-list-meta">v{m.version}</span>
                </div>
                <span className={`mobile-list-badge ${m.enabled ? 'badge-on' : 'badge-off'}`}>
                  {m.enabled ? 'on' : 'off'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer links */}
      <div className="mobile-more-footer">
        <a href="/?desktop=1" className="mobile-more-link">
          Switch to Desktop <ChevronRight size={14} />
        </a>
      </div>
    </div>
  );
}
