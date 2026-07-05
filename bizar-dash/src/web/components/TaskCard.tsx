// src/components/TaskCard.tsx — mobile-friendly task card with expandable details.
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Task } from '../lib/types';

interface Props {
  task: Task;
  workspaceId?: string;
}

export function TaskCard({ task, workspaceId }: Props) {
  const [expanded, setExpanded] = useState(false);

  const handleTransition = async (to: string) => {
    try {
      await api.post(`/tasks/${encodeURIComponent(task.id)}/transition`, { to });
    } catch {
      // best-effort — parent will refresh
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this task?')) return;
    try {
      await api.del(`/tasks/${encodeURIComponent(task.id)}`);
    } catch {
      // best-effort — parent will refresh
    }
  };

  return (
    <div className={cn('task-card-mobile', `is-${task.status === 'queued' ? 'todo' : task.status}`)}>
      <div className="task-card-mobile-head" onClick={() => setExpanded(!expanded)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}>
        <div className={cn('task-card-mobile-status', `is-${task.status === 'queued' ? 'todo' : task.status}`)} />
        <div className="task-card-mobile-body">
          <div className="task-card-mobile-title">{task.title}</div>
          {task.priority && task.priority !== 'normal' && (
            <span className={cn('task-priority-badge', `is-${task.priority}`)}>{task.priority}</span>
          )}
        </div>
        <ChevronRight size={16} className={cn('task-chevron', expanded && 'is-rotated')} />
      </div>
      {expanded && (
        <div className="task-card-mobile-details">
          {task.description && <p className="task-card-mobile-desc">{task.description}</p>}
          <div className="task-card-mobile-meta">
            {task.assignee && <span>@{task.assignee}</span>}
            {task.dueDate && <span>{new Date(task.dueDate).toLocaleDateString()}</span>}
            {task.tags?.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
          <div className="task-card-mobile-actions">
            {task.status !== 'doing' && (
              <Button size="sm" onClick={() => handleTransition('doing')}>Start</Button>
            )}
            {task.status !== 'done' && (
              <Button size="sm" onClick={() => handleTransition('done')}>Done</Button>
            )}
            <Button size="sm" variant="danger" onClick={handleDelete}>Delete</Button>
          </div>
        </div>
      )}
    </div>
  );
}
