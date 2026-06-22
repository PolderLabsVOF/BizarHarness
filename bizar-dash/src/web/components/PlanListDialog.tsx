// src/components/PlanListDialog.tsx — Dialog for /plan list command.

import { Button } from './Button';

type PlanListDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

export function PlanListDialog({ data, onClose }: PlanListDialogProps) {
  const plans = (data?.plans as string[]) ?? [];
  const count = (data?.count as number) ?? plans.length;

  const handleOpen = (slug: string) => {
    window.open(`/plans/${slug}/`, '_blank');
  };

  return (
    <div>
      {plans.length === 0 ? (
        <p style={{ marginBottom: 16, color: 'var(--color-muted)' }}>
          No plans found in this worktree. Use <code>/plan new &lt;slug&gt;</code> to create one.
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
