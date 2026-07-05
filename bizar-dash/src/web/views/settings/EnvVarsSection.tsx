// src/web/views/settings/EnvVarsSection.tsx
import React from 'react';
import { KeyRound } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { EnvVarManager } from '../../components/EnvVarManager';

export function EnvVarsSection() {
  return (
    <Card id="settings-env-vars" data-section="env-vars">
      <CardTitle><KeyRound size={14} /> Environment Variables</CardTitle>
      <CardMeta>Manage BIZAR_* env vars (API keys, secrets). Values are stored in <code>~/.config/bizar/env.json</code> (mode 0600).</CardMeta>
      <EnvVarManager />
    </Card>
  );
}
