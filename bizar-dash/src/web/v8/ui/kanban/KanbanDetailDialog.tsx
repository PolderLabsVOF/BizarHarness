import { useEffect, useMemo, useState } from 'react';
import { Play, Archive, Trash2, Timer, Copy, GitBranch, User, Tag as TagIcon, ListTree, Link2, History, X as XIcon, Save } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
} from '../feedback/Dialog.js';
import { Button } from '../controls/Button.js';
import { IconButton } from '../controls/IconButton.js';
import { Input } from '../controls/Input.js';
import { Textarea } from '../controls/Textarea.js';
import { Field } from '../controls/Field.js';
import { Select, SelectTrigger, SelectContent, SelectItem } from '../controls/Select.js';
import { Badge } from '../data/Badge.js';
import { Timeline, type TimelineItem } from '../data/Timeline.js';
import { KanbanProgress } from './KanbanProgress.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { Task } from '../../data/types.js';

/**
 * KanbanDetailDialog — full-edit surface for a single task.
 *
 * Opens via the "Open detail" context-menu action or by clicking a
 * card. Edits are persisted via `PUT /api/tasks/:id` on Save.
 * Mutations available without saving: Start agent (queued → doing),
 * Archive, Delete (with confirm).
 *
 * Reads live progress/timer state via the `task` prop — the view is
 * expected to keep it fresh from the WebSocket.
 */

export type TaskStatus = NonNullable<Task['status']>;
export type TaskPriority = NonNullable<Task['priority']>;

export interface TaskActivityEntry {
  id?: string;
  type?: string;
  ts?: string;
  data?: unknown;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'queued', label: 'Queued' },
  { value: 'doing', label: 'In progress' },
  { value: 'blocked', label: 'In review' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; tone: BadgeProps['tone'] }[] = [
  { value: 'low', label: 'Low', tone: 'neutral' },
  { value: 'medium', label: 'Medium', tone: 'info' },
  { value: 'high', label: 'High', tone: 'warning' },
  { value: 'urgent', label: 'Urgent', tone: 'danger' },
];

type BadgeProps = import('../data/Badge.js').BadgeProps;

export interface KanbanDetailDialogProps {
  /** The task to display. `null` closes the dialog. */
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called whenever the task is mutated (save / status change / etc). */
  onTaskUpdated?: (task: Task) => void;
  /** Called after the task is deleted. */
  onTaskDeleted?: (taskId: string) => void;
}

function toneForPriority(p?: TaskPriority): BadgeProps['tone'] {
  switch (p) {
    case 'urgent':
      return 'danger';
    case 'high':
      return 'warning';
    case 'low':
      return 'neutral';
    case 'medium':
    default:
      return 'info';
  }
}

function activityToTimeline(activity: readonly TaskActivityEntry[] | undefined): TimelineItem[] {
  if (!activity || activity.length === 0) return [];
  const items: TimelineItem[] = [];
  // The store caps history at 100; we render the latest 30.
  const recent = activity.slice(-30).reverse();
  for (const a of recent) {
    const type = a.type ?? 'event';
    const ts = a.ts ? new Date(a.ts) : null;
    const meta = ts ? ts.toLocaleString() : '';
    let title = type;
    let description: string | undefined;
    let tone: TimelineItem['tone'] = 'neutral';
    switch (type) {
      case 'created':
        title = 'Task created';
        tone = 'info';
        break;
      case 'status':
        title = 'Status changed';
        description = JSON.stringify(a.data ?? {});
        tone = 'info';
        break;
      case 'comment':
        title = 'Comment added';
        tone = 'neutral';
        break;
      case 'progress':
        title = 'Progress updated';
        description = a.data ? JSON.stringify(a.data) : undefined;
        tone = 'accent';
        break;
      case 'completed':
        title = 'Completed';
        tone = 'success';
        break;
      case 'timer-start':
        title = 'Timer started';
        tone = 'info';
        break;
      case 'timer-stop':
        title = 'Timer stopped';
        description = a.data ? JSON.stringify(a.data) : undefined;
        tone = 'neutral';
        break;
      default:
        title = type;
    }
    items.push({
      id: a.id ?? `${type}-${a.ts ?? ''}`,
      title,
      description,
      meta,
      tone,
    });
  }
  return items;
}

export function KanbanDetailDialog(props: KanbanDetailDialogProps): JSX.Element {
  const { task, open, onOpenChange, onTaskUpdated, onTaskDeleted } = props;

  // Editable buffer. Reset whenever a new task is opened.
  const [draft, setDraft] = useState<Task | null>(task);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    setDraft(task);
    setError(null);
    setNewTag('');
  }, [task?.id]);

  const tags = useMemo<string[]>(() => (Array.isArray(draft?.tags) ? (draft!.tags as string[]) : []), [draft]);
  const subtasks = useMemo<string[]>(() => (Array.isArray(draft?.subtasks) ? (draft!.subtasks as string[]) : []), [draft]);
  const dependencies = useMemo<string[]>(
    () => (Array.isArray(draft?.dependencies) ? (draft!.dependencies as string[]) : []),
    [draft],
  );
  const progress = (draft?.metadata?.progress as number | undefined) ?? undefined;
  const currentStep = (draft?.metadata?.currentStep as string | undefined) ?? undefined;
  const progressAgent = (draft?.metadata?.progressAgent as string | undefined) ?? undefined;
  const activity = (draft?.activity as TaskActivityEntry[] | undefined) ?? undefined;

  if (!task || !draft) {
    return <Dialog open={open} onOpenChange={onOpenChange}><span /></Dialog>;
  }

  const setField = <K extends keyof Task>(key: K, value: Task[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await fetchJson<Task>(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PUT',
        body: {
          title: draft.title,
          description: draft.description,
          status: draft.status,
          priority: draft.priority,
          assignee: draft.assignee,
          branch: draft.branch,
          tags,
          subtasks,
          dependencies,
          dueDate: draft.due ?? null,
        },
      });
      onTaskUpdated?.(updated);
      setDraft(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onStartAgent = async () => {
    setBusy('start');
    setError(null);
    try {
      const result = await fetchJson<{ task: Task }>(
        `/api/tasks/${encodeURIComponent(task.id)}/start`,
        { method: 'POST' },
      );
      onTaskUpdated?.(result.task);
      setDraft(result.task);
    } catch (err) {
      if (err instanceof FetchError) setError(err.message);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onToggleTimer = async () => {
    setBusy('timer');
    setError(null);
    try {
      const updated = await fetchJson<Task>(`/api/tasks/${encodeURIComponent(task.id)}/timer`, {
        method: 'POST',
      });
      onTaskUpdated?.(updated);
      setDraft(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onArchive = async () => {
    setBusy('archive');
    setError(null);
    try {
      const updated = await fetchJson<Task>(`/api/tasks/${encodeURIComponent(task.id)}/archive`, {
        method: 'POST',
      });
      onTaskUpdated?.(updated);
      setDraft(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setBusy('delete');
    setError(null);
    try {
      await fetchJson(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      onTaskDeleted?.(task.id);
      setConfirmDelete(false);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const onCopyLink = () => {
    if (typeof window === 'undefined') return;
    const url = `${window.location.origin}${window.location.pathname}#task/${task.id}`;
    void navigator.clipboard?.writeText(url);
  };

  const addTag = () => {
    const t = newTag.trim();
    if (t === '' || tags.includes(t)) return;
    setField('tags', [...tags, t]);
    setNewTag('');
  };

  const removeTag = (idx: number) => {
    setField(
      'tags',
      tags.filter((_, i: number) => i !== idx),
    );
  };

  const isQueued = draft.status === 'queued';
  const isArchived = draft.status === 'archived';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="lg"
          title={draft.title || 'Untitled task'}
          description={`Task ${task.id}`}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <Field id="title" label="Title" required>
                <Input
                  id="title"
                  value={draft.title ?? ''}
                  onChange={(e) => setField('title', e.target.value)}
                  size="md"
                  invalid={(draft.title?.length ?? 0) === 0}
                />
              </Field>

              <Field id="description" label="Description" hint="Markdown supported (rendered elsewhere).">
                <Textarea
                  id="description"
                  rows={5}
                  value={draft.description ?? ''}
                  onChange={(e) => setField('description', e.target.value)}
                />
              </Field>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <Field id="status" label="Status">
                  <Select value={draft.status ?? 'queued'} onValueChange={(v) => setField('status', v as TaskStatus)}>
                    <SelectTrigger id="status" />
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="priority" label="Priority">
                  <Select
                    value={draft.priority ?? 'medium'}
                    onValueChange={(v) => setField('priority', v as TaskPriority)}
                  >
                    <SelectTrigger id="priority" />
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <Field id="assignee" label="Assignee" hint="Agent name (e.g. atlas, odin).">
                  <Input
                    id="assignee"
                    value={draft.assignee ?? ''}
                    onChange={(e) => setField('assignee', e.target.value || undefined)}
                    leftAddon={<User size={12} aria-hidden="true" />}
                    placeholder="unassigned"
                  />
                </Field>
                <Field id="branch" label="Branch">
                  <Input
                    id="branch"
                    value={draft.branch ?? ''}
                    onChange={(e) => setField('branch', e.target.value || undefined)}
                    leftAddon={<GitBranch size={12} aria-hidden="true" />}
                    placeholder="feature/…"
                  />
                </Field>
              </div>

              <Field id="due" label="Due">
                <Input
                  id="due"
                  type="date"
                  value={(draft.due ?? '').slice(0, 10)}
                  onChange={(e) => setField('due', e.target.value || undefined)}
                />
              </Field>

              <Field id="tags" label="Tags" hint="Comma-free: press Enter to add.">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  {tags.map((t, i) => (
                    <Badge key={`${t}-${i}`} tone="info" size="sm">
                      <TagIcon size={10} aria-hidden="true" />
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(i)}
                        aria-label={`Remove tag ${t}`}
                        style={{
                          background: 'transparent',
                          border: 0,
                          color: 'inherit',
                          padding: 0,
                          marginLeft: 2,
                          cursor: 'pointer',
                          display: 'inline-flex',
                        }}
                      >
                        <XIcon size={10} aria-hidden="true" />
                      </button>
                    </Badge>
                  ))}
                  <Input
                    size="sm"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="add tag…"
                    style={{ width: 120 }}
                  />
                </div>
              </Field>

              <Field id="subtasks" label="Subtasks" hint="Comma-separated ids of subtasks.">
                <Input
                  id="subtasks"
                  value={subtasks.join(', ')}
                  onChange={(e) =>
                    setField(
                      'subtasks',
                      e.target.value
                        .split(',')
                        .map((s: string) => s.trim())
                        .filter(Boolean),
                    )
                  }
                  leftAddon={<ListTree size={12} aria-hidden="true" />}
                />
              </Field>

              <Field id="dependencies" label="Dependencies" hint="Comma-separated ids that must finish first.">
                <Input
                  id="dependencies"
                  value={dependencies.join(', ')}
                  onChange={(e) =>
                    setField(
                      'dependencies',
                      e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    )
                  }
                  leftAddon={<Link2 size={12} aria-hidden="true" />}
                />
              </Field>
            </div>

            <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                }}
              >
                {progress !== undefined && (
                  <KanbanProgress
                    value={progress}
                    caption={currentStep ?? 'Progress'}
                    label={`${Math.round(progress)}%`}
                    tone={progress >= 100 ? 'success' : 'accent'}
                    layout="block"
                  />
                )}
                {progressAgent !== undefined && progressAgent !== '' && (
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                    Worked by <strong style={{ color: 'var(--fg)' }}>{progressAgent}</strong>
                  </div>
                )}
                {isQueued && (
                  <Button
                    fullWidth
                    variant="primary"
                    leftIcon={<Play size={14} aria-hidden="true" />}
                    loading={busy === 'start'}
                    onClick={onStartAgent}
                  >
                    Start agent
                  </Button>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Timer size={14} aria-hidden="true" />}
                    loading={busy === 'timer'}
                    onClick={onToggleTimer}
                    fullWidth
                  >
                    {task.timerStart ? 'Stop timer' : 'Start timer'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Copy size={14} aria-hidden="true" />}
                    onClick={onCopyLink}
                    aria-label="Copy task link"
                  >
                    <span />
                  </Button>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <Button
                    size="sm"
                    variant="secondary"
                    leftIcon={<Archive size={14} aria-hidden="true" />}
                    loading={busy === 'archive'}
                    onClick={onArchive}
                    fullWidth
                    disabled={isArchived}
                  >
                    {isArchived ? 'Archived' : 'Archive'}
                  </Button>
                  <IconButton
                    aria-label="Delete task"
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>

              <div
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--fs-13)',
                    fontWeight: 600,
                    color: 'var(--fg)',
                  }}
                >
                  <History size={14} aria-hidden="true" /> Activity
                </div>
                {activityToTimeline(activity).length === 0 ? (
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-subtle)' }}>
                    No activity yet.
                  </div>
                ) : (
                  <Timeline items={activityToTimeline(activity)} />
                )}
              </div>
            </aside>
          </div>

          {error !== null && (
            <div
              role="alert"
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-3)',
                background: 'color-mix(in oklch, var(--danger) 12%, transparent)',
                border: '1px solid color-mix(in oklch, var(--danger) 40%, transparent)',
                borderRadius: 'var(--radius)',
                color: 'var(--danger)',
                fontSize: 'var(--fs-13)',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
              marginTop: 'var(--space-5)',
              borderTop: '1px solid var(--border)',
              paddingTop: 'var(--space-4)',
            }}
          >
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              leftIcon={<Save size={14} aria-hidden="true" />}
              loading={saving}
              onClick={onSave}
            >
              Save changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm" title="Delete this task?" hideClose>
          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 0 }}>
            This permanently removes the task and its history. You can't undo this.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <AlertDialogCancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" loading={busy === 'delete'} onClick={onDelete}>
                Delete task
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
