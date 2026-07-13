import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Sheet, SheetContent } from '../feedback/Sheet.js';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { Button } from '../controls/Button.js';
import { Input } from '../controls/Input.js';
import { Textarea } from '../controls/Textarea.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../controls/Select.js';
import { Skeleton } from '../feedback/Skeleton.js';
import { Badge } from '../data/Badge.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Task } from '../../data/types.js';

/**
 * TaskDetail — right-side Drawer for editing a single task. Sprint S17.
 *
 * Source-of-truth lives on the backend (tasks-store). Each edit PATCHes
 * `/api/tasks/:id` and the server re-broadcasts the canonical state via
 * `tasks:change`. The Drawer stays open while the WS round-trip resolves
 * so optimistic UI + canonical merge feels seamless.
 */

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const STATUS_OPTIONS = [
  { value: 'queued', label: 'Backlog' },
  { value: 'doing', label: 'In progress' },
  { value: 'blocked', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

export interface TaskDetailProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function TaskDetail(props: TaskDetailProps): JSX.Element {
  const { task, open, onOpenChange, onDeleted } = props;
  const [title, setTitle] = useState<string>(task.title);
  const [description, setDescription] = useState<string>(task.description || '');
  const [priority, setPriority] = useState<string>(task.priority || 'medium');
  const [status, setStatus] = useState<string>(task.status || 'queued');
  const [assignee, setAssignee] = useState<string>(task.assignee || '');
  const [due, setDue] = useState<string>(task.due || '');
  const [branch, setBranch] = useState<string>(task.branch || '');
  const [comment, setComment] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setTitle(task.title);
      setDescription(task.description || '');
      setPriority(task.priority || 'medium');
      setStatus(task.status || 'queued');
      setAssignee(task.assignee || '');
      setDue(task.due || '');
      setBranch(task.branch || '');
      setComment('');
      setMessage(null);
      setError(null);
    }
  }, [open, task]);

  const patch = async (body: Record<string, unknown>, label: string): Promise<void> => {
    setBusy(label);
    setMessage(null);
    setError(null);
    try {
      await fetchJson(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        body,
      });
      setMessage(`${label} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveTitle = (): void => {
    if (title.trim() && title !== task.title) void patch({ title: title.trim() }, 'Title');
  };
  const saveDescription = (): void => {
    if (description !== (task.description || '')) void patch({ description }, 'Description');
  };
  const savePriority = (v: string): void => {
    setPriority(v);
    if (v !== task.priority) void patch({ priority: v }, 'Priority');
  };
  const saveStatus = (v: string): void => {
    setStatus(v);
    if (v !== task.status) void patch({ status: v }, 'Status');
  };
  const saveAssignee = (): void => {
    const v = assignee.trim();
    if (v !== (task.assignee || '')) void patch({ assignee: v }, 'Assignee');
  };
  const saveDue = (): void => {
    const v = due.trim();
    if (v !== (task.due || '')) void patch({ due: v }, 'Due');
  };
  const saveBranch = (): void => {
    const v = branch.trim();
    if (v !== (task.branch || '')) void patch({ branch: v }, 'Branch');
  };

  const addComment = async (): Promise<void> => {
    const v = comment.trim();
    if (!v) return;
    setBusy('comment');
    setError(null);
    try {
      await fetchJson(`/api/tasks/${encodeURIComponent(task.id)}/comments`, {
        method: 'POST',
        body: { text: v },
      });
      setComment('');
      setMessage('Comment added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const removeTask = async (): Promise<void> => {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Delete task "${task.title}"? This is irreversible.`)
      : true;
    if (!ok) return;
    setDeleting(true);
    try {
      await fetchJson(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="Edit task">
        <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
          <Stack gap={2}>
            <label htmlFor="task-title" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Title
            </label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              disabled={busy !== null}
            />
          </Stack>

          <Stack gap={2}>
            <label htmlFor="task-status" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Status
            </label>
            <Select value={status} onValueChange={saveStatus}>
              <SelectTrigger id="task-status" size="sm" placeholder="Status" />
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Stack>

          <Inline gap={2}>
            <Stack gap={2} style={{ flex: 1 }}>
              <label htmlFor="task-priority" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Priority
              </label>
              <Select value={priority} onValueChange={savePriority}>
                <SelectTrigger id="task-priority" size="sm" placeholder="Priority" />
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <label htmlFor="task-due" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Due
              </label>
              <Input
                id="task-due"
                type="date"
                value={due ? due.slice(0, 10) : ''}
                onChange={(e) => setDue(e.target.value)}
                onBlur={saveDue}
                disabled={busy !== null}
              />
            </Stack>
          </Inline>

          <Inline gap={2}>
            <Stack gap={2} style={{ flex: 1 }}>
              <label htmlFor="task-assignee" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Assignee
              </label>
              <Input
                id="task-assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                onBlur={saveAssignee}
                placeholder="agent name (blank = unassigned)"
                disabled={busy !== null}
              />
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <label htmlFor="task-branch" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Branch
              </label>
              <Input
                id="task-branch"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onBlur={saveBranch}
                placeholder="feature/foo"
                disabled={busy !== null}
              />
            </Stack>
          </Inline>

          <Stack gap={2}>
            <label htmlFor="task-description" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Description
            </label>
            <Textarea
              id="task-description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              disabled={busy !== null}
              placeholder="What's the work, why, how to verify…"
            />
          </Stack>

          <Stack gap={2}>
            <label htmlFor="task-comment" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Add comment
            </label>
            <Inline gap={2} align="start">
              <Textarea
                id="task-comment"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Leave a progress note…"
                disabled={busy !== null}
                style={{ flex: 1 }}
              />
              <Button variant="secondary" onClick={() => { void addComment(); }} disabled={!comment.trim() || busy !== null}>
                <Plus size={14} aria-hidden /> Comment
              </Button>
            </Inline>
          </Stack>

          <Stack gap={2}>
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Metadata</div>
            <Inline gap={1} wrap>
              {task.metadata?.goalId !== undefined && typeof task.metadata.goalId === 'string' && (
                <Badge tone="info" title={`Linked to goal ${String(task.metadata.goalId)}`}>
                  goal: {String(task.metadata.goalId)}
                </Badge>
              )}
              {task.metadata?.krId !== undefined && typeof task.metadata.krId === 'string' && (
                <Badge tone="info" title={`Linked to KR ${String(task.metadata.krId)}`}>
                  kr: {String(task.metadata.krId)}
                </Badge>
              )}
              {task.id && <Badge tone="neutral" title={task.id}>id: {task.id}</Badge>}
            </Inline>
          </Stack>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
            <Button variant="danger" onClick={() => { void removeTask(); }} disabled={deleting || busy !== null}>
              <Trash2 size={14} aria-hidden /> {deleting ? 'Deleting…' : 'Delete task'}
            </Button>
          </div>

          {message !== null && (
            <div role="status" style={{ fontSize: 'var(--fs-12)', color: 'var(--success)' }}>{message}</div>
          )}
          {error !== null && (
            <div role="alert" style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>{error}</div>
          )}
          {busy !== null && <Skeleton style={{ height: 12 }} />}
        </Stack>
      </SheetContent>
    </Sheet>
  );
}
