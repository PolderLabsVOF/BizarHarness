// src/web/views/settings/MemorySection.tsx
// Placeholder — LightRAG / Obsidian / git memory config to be added in a future PR.
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';

export function MemorySection() {
  return (
    <Card id="settings-memory" data-section="memory">
      <CardTitle>Memory</CardTitle>
      <CardMeta>Configure LightRAG, Obsidian vault, and git integration.</CardMeta>
      <p className="muted" style={{ fontSize: 12 }}>
        Memory configuration is coming soon.
      </p>
    </Card>
  );
}
