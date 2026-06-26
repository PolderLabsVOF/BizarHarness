// src/components/ArtifactListDialog.tsx — Dialog for /plan list command.

import { Button } from './Button';

type ArtifactListDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

export function ArtifactListDialog({ data, onClose }: ArtifactListDialogProps) {
  const plans = (data?.plans as string[]) ?? [];
  const count = (data?.count as number) ?? plans.length;

  const handleOpen = (slug: string) => {
    window.open(`/artifacts/${slug}/`, '_blank');
  };

  return (
    <div>
      {plans.length === 0 ? (
        <p style={{ marginBottom: 16, color: 'var(--color-muted)' }}>
          No plans found in this worktree. Use <code>/artifact new &lt;slug&gt;</code> to create one.
        </p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 12, fontSize: 13, color: 'var(--color-muted)' }}>
            {count} plan{count !== 1 ? 's' : ''} in this worktree:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {plans.map((slug) => (
              <li
                key={slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <code style={{ fontSize: 13 }}>{slug}</code>
                <Button variant="ghost" size="sm" onClick={() => handleOpen(slug)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
