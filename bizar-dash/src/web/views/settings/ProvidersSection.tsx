// src/web/views/settings/ProvidersSection.tsx
// Placeholder — ProvidersPanel integration to be added in a future PR.
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';

export function ProvidersSection() {
  return (
    <Card id="settings-providers" data-section="providers">
      <CardTitle>AI Providers</CardTitle>
      <CardMeta>Configure API keys and endpoints for AI providers.</CardMeta>
      <p className="muted" style={{ fontSize: 12 }}>
        Provider management is coming soon.
      </p>
    </Card>
  );
}
