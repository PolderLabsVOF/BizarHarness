// src/components/KillConfirmDialog.tsx — confirmation dialog for killing bg instances.
// Provides both a JSX component and a convenience `openKillConfirmDialog` function.

import { Button } from './Button';
import type { ModalApi } from './Modal';

export type KillConfirmDialogProps = {
  instanceId: string;
  instanceName?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
};

/**
 * Render inline inside a modal body. Usage:
 *
 *   modal.open({
 *     title: 'Kill background instance?',
 *     children: (
 *       <KillConfirmDialog
 *         instanceId="bgr_abc"
 *         onConfirm={async () => { await killIt(); modal.close(); }}
 *         onClose={() => modal.close()}
 *       />
 *     ),
 *   });
 */
export function KillConfirmDialog({ instanceId, instanceName, onConfirm, onClose }: KillConfirmDialogProps) {
  return (
    <div>
      <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
        Instance <code>{instanceId}</code>
        {instanceName ? <> ({instanceName})</> : null} will be terminated.
        This cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="danger"
          onClick={async () => {
            await onConfirm();
            onClose();
          }}
        >
          Kill
        </Button>
      </div>
    </div>
  );
}

/**
 * Convenience wrapper: open a kill-confirmation modal programmatically.
 * Calls `DELETE /api/background/${instanceId}` on confirm and shows a toast.
 */
export function openKillConfirmDialog(
  modal: ModalApi,
  toast: { success: (msg: string, duration?: number) => void; error: (msg: string) => void },
  instanceId: string,
  instanceName?: string,
  onSuccess?: () => void,
) {
  modal.open({
    title: `Kill instance?`,
    width: 400,
    children: (
      <KillConfirmDialog
        instanceId={instanceId}
        instanceName={instanceName}
        onConfirm={async () => {
          try {
            const r = await fetch(`/api/background/${encodeURIComponent(instanceId)}`, { method: 'DELETE' });
            const data = await r.json();
            if (data.ok) {
              toast.success(`Instance ${instanceId} killed.`);
              onSuccess?.();
            } else {
              toast.error(`Kill failed: ${data.error || 'unknown error'}`);
            }
          } catch (err) {
            toast.error(`Kill failed: ${(err as Error).message}`);
          }
        }}
        onClose={() => modal.close()}
      />
    ),
  });
}
