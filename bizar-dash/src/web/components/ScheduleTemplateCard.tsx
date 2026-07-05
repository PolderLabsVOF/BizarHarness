// src/components/ScheduleTemplateCard.tsx — template preview card for the Schedules Templates tab.

import { Card, CardTitle, CardMeta } from './Card';
import { Button } from './Button';

export type ScheduleTemplate = {
  id: string;
  name: string;
  description: string;
  type: 'cron' | 'interval' | 'once' | 'webhook';
  schedule?: string;
  intervalMs?: number;
  action: {
    type: 'command' | 'agent' | 'webhook';
    target?: string;
    prompt?: string;
    method?: string;
  };
  tags?: string[];
  source?: string;
  templateFile?: string;
};

type Props = {
  template: ScheduleTemplate;
  onUse: (template: ScheduleTemplate) => void;
};

function formatSchedule(template: ScheduleTemplate): string {
  if (template.type === 'cron' && template.schedule) {
    return `cron: ${template.schedule}`;
  }
  if (template.type === 'interval') {
    const ms = template.intervalMs || 0;
    const secs = ms / 1000;
    if (secs >= 3600) return `every ${secs / 3600}h`;
    if (secs >= 60) return `every ${secs / 60}m`;
    return `every ${secs}s`;
  }
  return template.type;
}

export function ScheduleTemplateCard({ template, onUse }: Props) {
  return (
    <Card className="schedule-template-card">
      <div className="schedule-template-header">
        <CardTitle>{template.name}</CardTitle>
        {template.tags && template.tags.length > 0 && (
          <div className="schedule-template-tags">
            {template.tags.map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        )}
      </div>
      <CardMeta>{template.description}</CardMeta>
      <div className="schedule-template-summary">
        <code>{formatSchedule(template)}</code>
        {' · '}
        <code>{template.action.type}</code>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onUse(template)}
        aria-label={`Use template: ${template.name}`}
      >
        Use this template
      </Button>
    </Card>
  );
}
