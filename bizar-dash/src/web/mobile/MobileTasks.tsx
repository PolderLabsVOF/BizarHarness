// src/mobile/MobileTasks.tsx — filter-tab task list with search and FAB create sheet.
import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { cx } from '../ui/utils/cx';
import { TaskCard } from '../components/TaskCard';
import { TaskCreateSheet } from '../components/TaskCreateSheet';
import type { Snapshot } from '../lib/types';

type Filter = 'all' | 'todo' | 'doing' | 'done' | 'failed';

interface Props {
  snapshot: Snapshot;
  refreshSnapshot: () => Promise<void>;
  userId?: string;
  workspaceId?: string;
}

export function MobileTasks({ snapshot, refreshSnapshot, userId, workspaceId }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const tasks = (snapshot?.tasks || []).filter((t) => {
    if (filter === 'todo' && t.status !== 'queued' && t.status !== 'todo') return false;
    if (filter === 'doing' && t.status !== 'doing') return false;
    if (filter === 'done' && t.status !== 'done') return false;
    if (filter === 'failed' && t.status !== 'failed' && t.status !== 'blocked') return false;
    if (search && !(t.title || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts: Record<Filter, number> = {
    all: snapshot?.tasks?.length || 0,
    todo: snapshot?.tasks?.filter((t) => t.status === 'queued' || t.status === 'todo').length || 0,
    doing: snapshot?.tasks?.filter((t) => t.status === 'doing').length || 0,
    done: snapshot?.tasks?.filter((t) => t.status === 'done').length || 0,
    failed: snapshot?.tasks?.filter((t) => t.status === 'failed' || t.status === 'blocked').length || 0,
  };

  return (
    <div className="mobile-tasks">
      <div className="mobile-tasks-search">
        <Search size={16} className="mobile-tasks-search-icon" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tasks..."
          className="mobile-tasks-search-input"
        />
      </div>

      <div className="mobile-tasks-tabs">
        {(['all', 'todo', 'doing', 'done', 'failed'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={cx('mobile-tasks-tab', filter === f && 'is-active')}
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="mobile-tasks-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="mobile-tasks-list">
        {tasks.length === 0 ? (
          <p className="mobile-empty">No tasks. Create one to get started.</p>
        ) : (
          tasks.map((t) => (
            <TaskCard key={t.id} task={t} workspaceId={workspaceId} />
          ))
        )}
      </div>

      <button
        type="button"
        className="mobile-fab"
        onClick={() => setShowCreate(true)}
        aria-label="Create new task"
      >
        <Plus size={24} />
      </button>

      {showCreate && (
        <TaskCreateSheet
          workspaceId={workspaceId}
          onClose={() => setShowCreate(false)}
          onCreated={refreshSnapshot}
        />
      )}
    </div>
  );
}
