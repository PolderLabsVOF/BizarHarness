// src/components/TaskCreateSheet.tsx — bottom sheet for creating tasks.
import { useState } from 'react';
import { Button } from './Button';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

interface Props {
  workspaceId?: string;
  onClose: () => void;
  onCreated: () => void;
}

export function TaskCreateSheet({ workspaceId, onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { title, description, priority };
      if (workspaceId) payload.workspaceId = workspaceId;
      await api.post('/tasks', payload);
      onCreated();
      onClose();
    } catch {
      // best-effort — parent handles refresh via onCreated
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet-bottom" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-handle" />
        <h2 id="sheet-title" className="sheet-title">New Task</h2>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title..."
          className="sheet-input"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)..."
          className="sheet-textarea"
          rows={3}
        />
        <div className="sheet-priority">
          {(['low', 'medium', 'high'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={cn('sheet-priority-btn', priority === p && 'is-active', `is-${p}`)}
              onClick={() => setPriority(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={submitting || !title.trim()}>
            {submitting ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </>
  );
}
