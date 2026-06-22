// src/components/VisualPlanDialog.tsx — Dialog for /visual-plan command.

import { Button } from './Button';

type VisualPlanDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

export function VisualPlanDialog({ data, onClose }: VisualPlanDialogProps) {
  const enabled = data?.enabled as boolean | undefined;
  const previousEnabled = data?.previousEnabled as boolean | undefined;
  const mode = data?.mode as string | undefined;
  const defaultTemplate = data?.defaultTemplate as string | undefined;
  const lastUsedSlug = data?.lastUsedSlug as string | null | undefined;

  const wasToggled = mode === 'toggle';

  return (
    <div>
      {wasToggled ? (
        <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
          Visual plan mode has been <strong>{enabled ? 'enabled' : 'disabled'}</strong>.
          {enabled
            ? ' The agent will create a plan and wait for your feedback on complex tasks.'
            : ' The agent will work without a visual plan canvas.'}
        </p>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 8, fontWeight: 600 }}>
            Visual Plan: <span style={{ color: enabled ? 'var(--color-success)' : 'var(--color-muted)' }}>
              {enabled ? 'ON' : 'OFF'}
            </span>
          </p>
          <p style={{ lineHeight: 1.6, color: 'var(--color-muted)', fontSize: 13 }}>
            When enabled, the agent creates a visual plan and waits for your feedback before proceeding with complex tasks.
          </p>
          {defaultTemplate && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-muted)' }}>
              Default template: <code>{defaultTemplate}</code>
            </p>
          )}
          {lastUsedSlug && (
            <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>
              Last used plan: <code>{lastUsedSlug}</code>
            </p>
          )}
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-muted)' }}>
            Use <code>/visual-plan on</code> or <code>/visual-plan off</code> to toggle.
          </p>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
