// src/components/HelpDialog.tsx — Dialog for /help and /bizar commands.

import { Button } from './Button';

type HelpDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

type CmdEntry = { cmd: string; desc: string };

export function HelpDialog({ data, onClose }: HelpDialogProps) {
  const commands = (data?.commands as CmdEntry[]) ?? [];
  const templates = (data?.templates as string[]) ?? [];
  const statuses = (data?.statuses as string[]) ?? [];

  return (
    <div>
      {commands.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 13 }}>
          <tbody>
            {commands.map((entry) => (
              <tr key={entry.cmd} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>
                  <code style={{ fontSize: 12 }}>{entry.cmd}</code>
                </td>
                <td style={{ padding: '5px 0', color: 'var(--color-muted)' }}>{entry.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ marginBottom: 16, color: 'var(--color-muted)' }}>No commands available.</p>
      )}

      {templates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Available templates:</p>
          <p style={{ fontSize: 13 }}>{templates.join(', ')}</p>
        </div>
      )}

      {statuses.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 4 }}>Available statuses:</p>
          <p style={{ fontSize: 13 }}>{statuses.join(', ')}</p>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
