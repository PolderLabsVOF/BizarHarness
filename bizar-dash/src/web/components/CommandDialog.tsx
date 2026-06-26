// src/components/CommandDialog.tsx — Generic dialog wrapper that routes to the
// correct specific dialog component based on the DialogDescriptor's `component` field.

import { VisualPlanDialog } from './VisualPlanDialog';
import { ArtifactCreateDialog } from './ArtifactCreateDialog';
import { ArtifactListDialog } from './ArtifactListDialog';
import { HelpDialog } from './HelpDialog';
import { AuditDialog } from './AuditDialog';
import type { DialogDescriptor } from '../lib/types';

export type { DialogDescriptor };

function GenericDialog({ dialog, onClose }: { dialog: DialogDescriptor; onClose: () => void }) {
  if (!dialog.data) {
    return (
      <div>
        <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
          {`Command: ${dialog.command}`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  const { message, detail, url } = dialog.data as { message?: string; detail?: string; url?: string };

  return (
    <div>
      <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
        {message ?? `Command: ${dialog.command}`}
      </p>
      {detail && (
        <p style={{ marginBottom: 16, color: 'var(--color-muted)', fontSize: 13 }}>
          {detail}
        </p>
      )}
      {url && (
        <p style={{ marginBottom: 16 }}>
          <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
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
    case 'visual-artifact':
      return <VisualPlanDialog data={dialog.data} onClose={onClose} />;
    case 'artifact-create':
      return <ArtifactCreateDialog data={dialog.data} onClose={onClose} />;
    case 'artifact-list':
      return <ArtifactListDialog data={dialog.data} onClose={onClose} />;
    case 'help':
      return <HelpDialog data={dialog.data} onClose={onClose} />;
    case 'audit':
      return <AuditDialog data={dialog.data} onClose={onClose} />;
    default:
      return <GenericDialog dialog={dialog} onClose={onClose} />;
  }
}
