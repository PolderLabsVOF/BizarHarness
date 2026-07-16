/**
 * NewSessionModal — shared new-session Sheet, extracted from
 * ClaudeSessionsView so ChatView can reuse the same form.
 */

import { useState } from 'react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetClose, SheetContent } from '../../ui/feedback/Sheet.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface NewSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function NewSessionModal({ open, onOpenChange, onCreated }: NewSessionModalProps): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" title="New Claude session" description="Spawn a Claude Code session via the runner.">
        <NewSessionForm
          onCreated={(id) => {
            onOpenChange(false);
            onCreated(id);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

interface NewSessionFormProps {
  onCreated: (id: string) => void;
  onCancel: () => void;
}

export function NewSessionForm({ onCreated, onCancel }: NewSessionFormProps): JSX.Element {
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
          onChange={(e) => setPrompt(e.target.value)}
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
