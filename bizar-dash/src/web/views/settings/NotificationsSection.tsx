// src/web/views/settings/NotificationsSection.tsx
import React from 'react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import type { Settings } from '../../lib/types';

type Props = {
  settings: Settings;
  patchNotifications: (patch: Partial<Settings['notifications']>) => void;
};

export function NotificationsSection({ settings, patchNotifications }: Props) {
  return (
    <Card id="settings-notifications" data-section="notifications">
      <CardTitle>Notifications</CardTitle>
      <CardMeta>Toast triggers inside the dashboard.</CardMeta>
      <label className="checkbox-row" data-setting-id="notifications.onAgentComplete">
        <input
          type="checkbox"
          checked={!!settings.notifications.onAgentComplete}
          onChange={(e) => patchNotifications({ onAgentComplete: e.target.checked })}
        />
        <span>Notify when an agent invocation completes</span>
      </label>
      <label className="checkbox-row" data-setting-id="notifications.onPlanApproval">
        <input
          type="checkbox"
          checked={!!settings.notifications.onPlanApproval}
          onChange={(e) => patchNotifications({ onPlanApproval: e.target.checked })}
        />
        <span>Notify when a plan needs approval</span>
      </label>
    </Card>
  );
}
