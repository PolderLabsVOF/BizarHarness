// src/web/views/settings/EnvVarsSection.tsx
// Placeholder — EnvVarManager integration to be added in a future PR.
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';

export function EnvVarsSection() {
  return (
    <Card id="settings-env-vars" data-section="env-vars">
      <CardTitle>Environment Variables</CardTitle>
      <CardMeta>Configure environment variables for the Bizar runtime.</CardMeta>
      <p className="muted" style={{ fontSize: 12 }}>
        Environment variable management is coming soon.
      </p>
    </Card>
  );
}
