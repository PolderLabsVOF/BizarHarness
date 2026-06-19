// src/mobile/views/MobileActivity.tsx — mobile activity tab: stats + recent activity.
import { RefreshCw, CheckSquare, Bot, Activity as ActivityIcon } from 'lucide-react';
import { formatRelative } from '../../lib/utils';
import type { Snapshot } from '../../lib/types';

type Props = {
  snapshot: Snapshot;
};

export function MobileActivity({ snapshot }: Props) {
  const agents = snapshot.agents || [];
  const tasks = snapshot.tasks || [];
  const activeTasks = tasks.filter((t) => t.status === 'doing' || t.status === 'queued');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <div className="mobile-view">
      {/* Quick stats */}
      <div className="mobile-stats">
        <div className="mobile-stat">
          <div className="mobile-stat-value">{agents.length}</div>
          <div className="mobile-stat-label">Agents</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{activeTasks.length}</div>
          <div className="mobile-stat-label">Active</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{doneTasks.length}</div>
          <div className="mobile-stat-label">Done</div>
        </div>
        <div className="mobile-stat">
          <div className="mobile-stat-value">{snapshot.plans?.length || 0}</div>
          <div className="mobile-stat-label">Plans</div>
        </div>
      </div>

      {/* Active agents */}
      {agents.length > 0 && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">
            <Bot size={14} /> Agents
          </h3>
          <div className="mobile-card-list">
            {agents.slice(0, 6).map((a) => (
              <div key={a.name} className="mobile-agent-card">
                <div className="mobile-agent-dot" data-status={a.status || 'idle'} />
                <div className="mobile-agent-info">
                  <span className="mobile-agent-name">{a.name}</span>
                  <span className="mobile-agent-meta">{a.status || 'idle'}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">
            <CheckSquare size={14} /> Active Tasks
          </h3>
          <div className="mobile-card-list">
            {activeTasks.slice(0, 8).map((t) => (
              <div key={t.id} className="mobile-task-card">
                <div
                  className="priority-dot"
                  style={{
                    background:
                      t.priority === 'high'
                        ? 'var(--error)'
                        : t.priority === 'low'
                          ? 'var(--text-dim)'
                          : 'var(--info)',
                  }}
                />
                <div className="task-content">
                  <div className="task-title">{t.title}</div>
                  <div className="task-meta">{t.status}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {agents.length === 0 && activeTasks.length === 0 && (
        <div className="mobile-empty">
          <ActivityIcon size={40} />
          <p>No activity yet.</p>
          <p className="muted">Start a task or chat to see things here.</p>
        </div>
      )}
    </div>
  );
}
