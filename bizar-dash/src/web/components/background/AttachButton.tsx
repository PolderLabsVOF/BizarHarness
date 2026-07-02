// src/components/background/AttachButton.tsx — small reusable tmux attach button
// v3.22.0
//
// Renders a primary button with two affordances:
//   1. "Run" — POST /api/background/:id/open-terminal to spawn the system
//      terminal emulator with the tmux attach command.
//   2. "Copy" — ghost button to copy the command to clipboard.
//
// Safety: the "run" endpoint only accepts commands that start with
// `tmux attach -t ` (server-side whitelist). The `command` prop is
// only used for clipboard copy; the POST endpoint reconstructs the
// command server-side from the tmux session name.

import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { Button } from '../Button';
import { useToast } from '../Toast';
import { api } from '../../lib/api';

type AttachButtonProps = {
  /** The full `tmux attach -t <session>` command. Used for clipboard copy. */
  command: string;
  /** Button label. Defaults to "Attach". */
  label?: string;
  /** Instance id, sent in the POST body so the server validates the session. */
  instanceId: string;
};

export function AttachButton({
  command,
  label = 'Attach',
  instanceId,
}: AttachButtonProps) {
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  // Client-side pre-check: only allow tmux attach commands.
  const valid = /^tmux attach -t /.test(command);

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success('Command copied');
    } catch {
      toast.error('Could not copy');
    }
  };

  const runInTerminal = async () => {
    if (!valid || !instanceId) return;
    setOpening(true);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>(
        `/background/${encodeURIComponent(instanceId)}/open-terminal`,
        { emulator: 'system' },
      );
      if (res.ok) {
        toast.success('Opening terminal…');
      } else {
        toast.error(res.error || 'Failed to open terminal');
        // Fallback: copy the command.
        await copyCommand();
      }
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
      // Fallback: copy on network error.
      await copyCommand();
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="attach-button-group">
      <Button
        variant="primary"
        size="sm"
        onClick={runInTerminal}
        loading={opening}
        disabled={!valid}
        title={valid ? 'Open in system terminal' : 'Invalid attach command'}
      >
        <ExternalLink size={14} /> {label}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={copyCommand}
        disabled={!command}
        title="Copy attach command"
      >
        <Copy size={14} />
      </Button>
    </div>
  );
}
