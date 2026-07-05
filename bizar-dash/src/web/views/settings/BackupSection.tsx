// src/web/views/settings/BackupSection.tsx
// Consumes BackupRestore from thor-backup if available; shows a placeholder otherwise.
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';

export function BackupSection() {
  return (
    <Card id="settings-backup" data-section="backup">
      <CardTitle>Backup &amp; Restore</CardTitle>
      <CardMeta>Export and restore your Bizar configuration.</CardMeta>
      <p className="muted" style={{ fontSize: 12 }}>
        Backup and restore is coming soon.
      </p>
    </Card>
  );
}
