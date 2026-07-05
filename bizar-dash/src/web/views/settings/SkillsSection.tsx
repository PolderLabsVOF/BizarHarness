// src/web/views/settings/SkillsSection.tsx
// Placeholder — Skills paths + refresh to be added in a future PR.
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';

export function SkillsSection() {
  return (
    <Card id="settings-skills" data-section="skills">
      <CardTitle>Skills</CardTitle>
      <CardMeta>Manage agent skill paths and refresh available skills.</CardMeta>
      <p className="muted" style={{ fontSize: 12 }}>
        Skills configuration is coming soon.
      </p>
    </Card>
  );
}
