import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Sheet } from '../feedback/Sheet.js';
import { Stack } from '../primitives/Stack.js';
import { Inline } from '../primitives/Inline.js';
import { Button } from '../controls/Button.js';
import { Input } from '../controls/Input.js';
import { Select } from '../controls/Select.js';
import { Skeleton } from '../feedback/Skeleton.js';
import { Badge } from '../data/Badge.js';
import { fetchJson } from '../../data/fetcher.js';
import type { Goal } from '../../data/types.js';

/**
 * GoalDetail — Sprint S12. Right-side Drawer with editable
 * title / status / due / owner / key-results.
 *
 * Source-of-truth = `.bizar/PROGRESS.md` (per user direction). Each
 * edit PATCHes `/api/goals/:id` and the server re-broadcasts the
 * canonical state via `goals:change`.
 */

const STATUS_OPTIONS = [
  { value: 'on-track', label: 'On track' },
  { value: 'at-risk', label: 'At risk' },
  { value: 'off-track', label: 'Off track' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'active', label: 'Active' },
  { value: 'done', label: 'Done' },
];

export interface GoalDetailProps {
  goal: Goal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GoalDetail(props: GoalDetailProps): JSX.Element {
  const { goal, open, onOpenChange } = props;
  const [title, setTitle] = useState<string>(goal.title);
  const [status, setStatus] = useState<string>(goal.status);
  const [owner, setOwner] = useState<string>(goal.owner || '');
  const [due, setDue] = useState<string>(goal.due || '');
  const [newKr, setNewKr] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(goal.title);
      setStatus(goal.status);
      setOwner(goal.owner || '');
      setDue(goal.due || '');
      setMessage(null);
      setError(null);
      setNewKr('');
    }
  }, [open, goal]);

  const patch = async (body: Record<string, unknown>, label: string): Promise<void> => {
    setBusy(label);
    setMessage(null);
    setError(null);
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goal.id)}`, { method: 'PATCH', body });
      setMessage(`${label} saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const saveTitle = (): void => {
    if (title.trim() && title !== goal.title) void patch({ title: title.trim() }, 'Title');
  };
  const saveStatus = (v: string): void => {
    setStatus(v);
    if (v !== goal.status) void patch({ status: v }, 'Status');
  };
  const saveOwner = (): void => {
    const v = owner.trim();
    if (v !== (goal.owner || '')) void patch({ owner: v }, 'Owner');
  };
  const saveDue = (): void => {
    const v = due.trim();
    if (v !== (goal.due || '')) void patch({ due: v }, 'Due');
  };

  const toggleKr = async (krId: string, current: boolean): Promise<void> => {
    setBusy(`kr-${krId}`);
    setError(null);
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goal.id)}/key-results/${encodeURIComponent(krId)}`, {
        method: 'PATCH',
        body: { done: !current },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const addKr = async (): Promise<void> => {
    const v = newKr.trim();
    if (!v) return;
    setNewKr('');
    setBusy('add-kr');
    setError(null);
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goal.id)}/key-results`, {
        method: 'POST',
        body: { title: v },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const removeKr = async (krId: string): Promise<void> => {
    setBusy(`remove-${krId}`);
    setError(null);
    try {
      await fetchJson(`/api/goals/${encodeURIComponent(goal.id)}/key-results/${encodeURIComponent(krId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="right" title="Edit goal">
      <Stack gap={4} style={{ padding: 'var(--space-4)' }}>
        <Stack gap={2}>
          <label htmlFor="goal-title" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Title
          </label>
          <Inline gap={2}>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              disabled={busy !== null}
              style={{ flex: 1 }}
            />
          </Inline>
        </Stack>

        <Stack gap={2}>
          <label htmlFor="goal-status" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Status
          </label>
          <Select id="goal-status" value={status} onValueChange={saveStatus} options={STATUS_OPTIONS} />
        </Stack>

        <Inline gap={2}>
          <Stack gap={2} style={{ flex: 1 }}>
            <label htmlFor="goal-owner" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Owner
            </label>
            <Input id="goal-owner" value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={saveOwner} disabled={busy !== null} />
          </Stack>
          <Stack gap={2} style={{ flex: 1 }}>
            <label htmlFor="goal-due" style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Due
            </label>
            <Input id="goal-due" value={due} onChange={(e) => setDue(e.target.value)} onBlur={saveDue} placeholder="2026-09-30" disabled={busy !== null} />
          </Stack>
        </Inline>

        <Stack gap={2}>
          <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Key results</div>
          <Stack gap={1}>
            {goal.keyResults.length === 0 && (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>None yet.</div>
            )}
            {goal.keyResults.map((kr) => (
              <Inline key={kr.id} gap={2} align="center">
                <input
                  type="checkbox"
                  checked={kr.done}
                  onChange={() => { void toggleKr(kr.id, kr.done); }}
                  aria-label={`Toggle ${kr.title}`}
                  disabled={busy !== null}
                />
                <span style={{ flex: 1, fontSize: 'var(--fs-13)', textDecoration: kr.done ? 'line-through' : 'none' }}>
                  {kr.title}
                </span>
                {kr.assignee && <Badge tone="neutral">{kr.assignee}</Badge>}
                <Button
                  variant="ghost"
                  onClick={() => { void removeKr(kr.id); }}
                  disabled={busy !== null}
                  aria-label={`Remove ${kr.title}`}
                >
                  <Trash2 size={12} aria-hidden />
                </Button>
              </Inline>
            ))}
          </Stack>
          <Inline gap={2}>
            <Input
              value={newKr}
              onChange={(e) => setNewKr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addKr(); } }}
              placeholder="Add key result…"
              disabled={busy !== null}
              style={{ flex: 1 }}
            />
            <Button variant="secondary" onClick={() => { void addKr(); }} disabled={!newKr.trim() || busy !== null}>
              <Plus size={14} aria-hidden /> Add
            </Button>
          </Inline>
        </Stack>

        {message !== null && (
          <div role="status" style={{ fontSize: 'var(--fs-12)', color: 'var(--success)' }}>{message}</div>
        )}
        {error !== null && (
          <div role="alert" style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>{error}</div>
        )}
        {busy !== null && <Skeleton style={{ height: 12 }} />}
      </Stack>
    </Sheet>
  );
}