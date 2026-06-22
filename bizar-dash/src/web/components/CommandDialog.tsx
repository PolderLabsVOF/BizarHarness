// src/components/CommandDialog.tsx — Generic dialog wrapper that routes to the
// correct specific dialog component based on the DialogDescriptor's `component` field.

import { VisualPlanDialog } from './VisualPlanDialog';
import { PlanCreateDialog } from './PlanCreateDialog';
import { PlanListDialog } from './PlanListDialog';
import { HelpDialog } from './HelpDialog';
import { AuditDialog } from './AuditDialog';
import type { DialogDescriptor } from '../lib/types';

export type { DialogDescriptor };

function GenericDialog({ dialog, onClose }: { dialog: DialogDescriptor; onClose: () => void }) {
  return (
    <div>
      <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
        {(dialog.data?.message as string) ?? `Command: ${dialog.command}`}
      </p>
      {(dialog.data?.detail as string) && (
        <p style={{ marginBottom: 16, color: 'var(--color-muted)', fontSize: 13 }}>
          {dialog.data.detail as string}
        </p>
      )}
      {(dialog.data?.url as string) && (
        <p style={{ marginBottom: 16 }}>
          <a href={dialog.data.url as string} target="_blank" rel="noopener noreferrer">
            {dialog.data.url as string}
          </a>
        </p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function CommandDialog({ dialog, onClose }: { dialog: DialogDescriptor; onClose: () => void }) {
  switch (dialog.component) {
    case 'visual-plan':
      return <VisualPlanDialog data={dialog.data} onClose={onClose} />;
    case 'plan-create':
      return <PlanCreateDialog data={dialog.data} onClose={onClose} />;
    case 'plan-list':
      return <PlanListDialog data={dialog.data} onClose={onClose} />;
    case 'help':
      return <HelpDialog data={dialog.data} onClose={onClose} />;
    case 'audit':
      return <AuditDialog data={dialog.data} onClose={onClose} />;
    default:
      return <GenericDialog dialog={dialog} onClose={onClose} />;
  }
}
