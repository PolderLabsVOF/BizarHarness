/**
 * v8/views/ClaudeSessions/ClaudeSessionsView.tsx — Sprint S39, v9.3.0.
 *
 * Claude Code session explorer. Lists sessions on disk (via
 * /api/claude-sessions), lets the user create a new one via Sheet
 * (POST /api/claude-sessions/new), inline-rename (PATCH
 * /api/claude-sessions/:id), inline-confirm delete (DELETE
 * /api/claude-sessions/:id), and opens a right Drawer with the
 * session detail (ClaudeSessionDetail).
 */

import { useCallback, useState } from 'react';
import { Plus, Trash2, Pencil, RefreshCcw, MessageSquareText } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetClose, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';
import type { ClaudeSession } from '../../data/types.js';
import { ClaudeSessionDetail } from './ClaudeSessionDetail.js';

interface SessionsPayload {
  sessions: ClaudeSession[];
}

export function ClaudeSessionsView(): JSX.Element {
  const payload = useFetch<SessionsPayload>('/api/claude-sessions');
  const [creating, setCreating] = useState<boolean>(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const sessions = payload.data?.sessions ?? [];

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  return (
    <Stack gap={4} data-testid="claude-sessions-view">
      <ViewHeader
        title="Claude sessions"
        description="Claude Code session explorer. Each row is a session directory under ~/.claude/sessions/."
        actions={
          <Inline align="center" gap={2}>
            <Button variant="ghost" onClick={() => void refresh()} data-testid="claude-sessions-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="claude-sessions-new">
              <Plus size={14} aria-hidden /> New session
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {payload.loading && sessions.length === 0 ? (
            <Stack gap={2}>
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
            </Stack>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText size={28} aria-hidden />}
              title="No Claude sessions"
              description="Create one to start a multi-turn conversation with Claude Code."
            />
          ) : (
            <Stack gap={2}>
              {sessions.map((s) => (
                <SessionRow key={s.id} session={s} onRefresh={refresh} onOpen={setDetailId} />
              ))}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={creating} onOpenChange={setCreating}>
        <SheetContent side="right" title="New Claude session" description="Spawn a Claude Code session via the runner.">
          <NewSessionForm
            onCreated={(id) => {
              setCreating(false);
              refresh();
              setDetailId(id);
            }}
            onCancel={() => setCreating(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={detailId !== null} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent side="right" title="Session detail" description={detailId ?? ''}>
          {detailId !== null && <ClaudeSessionDetail sessionId={detailId} />}
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function SessionRow({
  session,
  onRefresh,
  onOpen,
}: {
  session: ClaudeSession;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}): JSX.Element {
  const [renaming, setRenaming] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(session.title ?? '');
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async (): Promise<void> => {
    if (!title.trim()) return;
    setError(null);
    try {
      await fetchJson(`/api/claude-sessions/${session.id}`, {
        method: 'PATCH',
        body: { title: title.trim() },
      });
      setRenaming(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const resume = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/claude-sessions/${id}/resume`, { method: 'POST', body: {} });
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  const remove = async (): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/claude-sessions/${session.id}`, { method: 'DELETE' });
      setConfirmDelete(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <div
      data-testid={`claude-session-row-${session.id}`}
      style={{
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface-0)',
      }}
    >
      <Inline align="center" justify="between" gap={3}>
        <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
          {renaming ? (
            <Inline gap={1}>
              <Input
                value={title}
                data-testid={`claude-session-rename-input-${session.id}`}
                onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
              />
              <Button variant="primary" onClick={() => void rename()} data-testid={`claude-session-rename-submit-${session.id}`}>Save</Button>
              <Button variant="ghost" onClick={() => { setRenaming(false); setTitle(session.title ?? ''); }}>Cancel</Button>
            </Inline>
          ) : (
            <Inline align="center" gap={2}>
              <strong style={{ fontSize: 'var(--fs-13)' }}>{session.title || session.id}</strong>
              {session.agent && (
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>
                  @{session.agent}
                </span>
              )}
            </Inline>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {session.id}
          </span>
          {error !== null && (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
          )}
        </Stack>
        <Inline gap={1}>
          <Button variant="primary" onClick={() => void resume(session.id)} data-testid={`claude-session-resume-${session.id}`} aria-label={`Resume ${session.id}`}>
            Resume
          </Button>
          <Button variant="ghost" onClick={() => onOpen(session.id)} data-testid={`claude-session-open-${session.id}`}>
            Open
          </Button>
          <Button
            variant="ghost"
            onClick={() => { setRenaming(true); setTitle(session.title ?? ''); }}
            data-testid={`claude-session-rename-${session.id}`}
            aria-label={`Rename session ${session.id}`}
          >
            <Pencil size={14} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmDelete((cur) => !cur)}
            data-testid={`claude-session-delete-${session.id}`}
            aria-label={`Delete session ${session.id}`}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </Inline>
      </Inline>
      {confirmDelete && (
        <Inline gap={1} style={{ marginTop: 'var(--space-2)' }}>
          <Button variant="danger" onClick={() => void remove()} data-testid={`claude-session-confirm-delete-${session.id}`}>
            Confirm delete
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)} data-testid={`claude-session-cancel-delete-${session.id}`}>
            Cancel
          </Button>
        </Inline>
      )}
    </div>
  );
}

function NewSessionForm({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [title, setTitle] = useState<string>('');
  const [agent, setAgent] = useState<string>('general');
  const [prompt, setPrompt] = useState<string>('');
  const [directory, setDirectory] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!agent.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ id: string }>('/api/claude-sessions/new', {
        method: 'POST',
        body: {
          title: title.trim() || null,
          agent: agent.trim(),
          prompt: prompt.trim(),
          directory: directory.trim() || undefined,
        },
      });
      onCreated(res.id);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Title (optional)</span>
        <Input
          value={title}
          data-testid="claude-sessions-new-title"
          onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Agent</span>
        <Input
          value={agent}
          data-testid="claude-sessions-new-agent"
          onChange={(e) => setAgent((e.target as HTMLInputElement).value)}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Seed prompt</span>
        <textarea
          value={prompt}
          rows={4}
          data-testid="claude-sessions-new-prompt"
          onChange={(e) => setPrompt((e.target as HTMLTextAreaElement).value)}
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-13)',
            resize: 'vertical',
          }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Working directory (optional)</span>
        <Input
          value={directory}
          data-testid="claude-sessions-new-directory"
          onChange={(e) => setDirectory((e.target as HTMLInputElement).value)}
        />
      </label>
      {error !== null && (
        <span role="alert" data-testid="claude-sessions-new-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
          {error}
        </span>
      )}
      <Inline justify="end" gap={2}>
        <SheetClose asChild>
          <Button variant="ghost" onClick={onCancel} data-testid="claude-sessions-new-cancel">Cancel</Button>
        </SheetClose>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || !agent.trim() || !prompt.trim()}
          data-testid="claude-sessions-new-submit"
        >
          Create
        </Button>
      </Inline>
    </Stack>
  );
}