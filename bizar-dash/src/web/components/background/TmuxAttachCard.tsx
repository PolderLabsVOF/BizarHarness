// src/components/background/TmuxAttachCard.tsx — per-instance tmux attach card
// v3.22.0
//
// Shows the tmux session name, a "Copy attach command" button, and
// an "Open in terminal" button that POSTs to /api/background/:id/open-terminal.
// When tmux is missing on the host, shows a friendly warning instead.

import { useState } from 'react';
import { Copy, Terminal, AlertTriangle } from 'lucide-react';
import { Button } from '../Button';
import { Card } from '../Card';
import { useToast } from '../Toast';
import { api } from '../../lib/api';
import type { BgInstance } from '../../lib/types';

type TmuxAttachCardProps = {
  instance: BgInstance;
};

export function TmuxAttachCard({ instance }: TmuxAttachCardProps) {
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  const sessionName = instance.tmuxSession;
  const attachCommand = sessionName ? `tmux attach -t ${sessionName}` : null;

  const copyCommand = async () => {
    if (!attachCommand) return;
    try {
      await navigator.clipboard.writeText(attachCommand);
      toast.success('Attach command copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const openTerminal = async () => {
    if (!instance.instanceId || !sessionName) return;
    setOpening(true);
    try {
      const result = await api.post<{ ok: boolean; command: string; error?: string }>(
        `/background/${encodeURIComponent(instance.instanceId)}/open-terminal`,
        { emulator: 'system' },
      );
      if (result.ok) {
        toast.success('Opening terminal…');
      } else {
        toast.error(result.error || 'Failed to open terminal');
        // Fallback: copy the command so the user can paste it manually.
        if (attachCommand) {
          try {
            await navigator.clipboard.writeText(attachCommand);
            toast.success('Command copied to clipboard');
          } catch { /* noop */ }
        }
      }
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
      // Fallback: copy command on network error.
      if (attachCommand) {
        try {
          await navigator.clipboard.writeText(attachCommand);
          toast.success('Command copied to clipboard');
        } catch { /* noop */ }
      }
    } finally {
      setOpening(false);
    }
  };

  // Don't render anything if there's no tmux session to attach to.
  if (!sessionName) {
    return (
      <Card variant="outlined" className="bg-tmux-card bg-tmux-card-warn">
        <div className="bg-tmux-card-header">
          <AlertTriangle size={14} />
          <span>No tmux session</span>
        </div>
        <p className="bg-tmux-hint muted">
          This instance does not have a tmux session attached.
          Sessions are created automatically when a background agent starts.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="outlined" className="bg-tmux-card">
      <div className="bg-tmux-card-header">
        <Terminal size={14} />
        <span>tmux session</span>
        {instance.tmuxActive !== false ? (
          <span className="badge badge-success">live</span>
        ) : (
          <span className="badge badge-warning">inactive</span>
        )}
      </div>

      <code className="mono bg-tmux-session-name">{sessionName}</code>

      <p className="muted bg-tmux-hint">
        Attach to the agent's tmux session from a terminal on the host
        running the dashboard.
      </p>

      <div className="bg-tmux-card-actions">
        <Button variant="ghost" size="sm" onClick={copyCommand} title="Copy attach command">
          <Copy size={14} /> Copy
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={openTerminal}
          loading={opening}
          title="Open in system terminal"
        >
          <Terminal size={14} /> Open terminal
        </Button>
      </div>
    </Card>
  );
}
