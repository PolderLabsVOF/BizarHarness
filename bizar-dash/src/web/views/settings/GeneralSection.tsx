// src/web/views/settings/GeneralSection.tsx
import React from 'react';
import { Layout as LayoutIcon } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { cn } from '../../lib/utils';
import type { Settings } from '../../lib/types';

type Props = {
  settings: Settings;
  patchUi: (patch: Partial<Settings['ui']>) => void;
  patchTop: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

const LAYOUTS = [
  { id: 'topnav', label: 'Top nav' },
  { id: 'sidebar', label: 'Sidebar' },
  { id: 'both', label: 'Both' },
] as const;

export function GeneralSection({ settings, patchUi, patchTop }: Props) {
  return (
    <>
      {/* UI Layout */}
      <Card id="settings-layout" data-section="layout">
        <CardTitle><LayoutIcon size={14} /> UI layout</CardTitle>
        <CardMeta>Choose how the dashboard's navigation is presented.</CardMeta>
        <div className="layout-row" data-setting-id="ui.layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={cn('layout-card', settings.ui.layout === l.id && 'layout-card-active')}
              onClick={() => patchUi({ layout: l.id })}
            >
              <span className="layout-card-label">{l.label}</span>
            </button>
          ))}
        </div>
        <label className="checkbox-row" data-setting-id="ui.showHeader">
          <input
            type="checkbox"
            checked={settings.ui.showHeader}
            onChange={(e) => patchUi({ showHeader: e.target.checked })}
          />
          <span>Show header</span>
        </label>
        <label className="checkbox-row" data-setting-id="ui.showStatusBar">
          <input
            type="checkbox"
            checked={settings.ui.showStatusBar}
            onChange={(e) => patchUi({ showStatusBar: e.target.checked })}
          />
          <span>Show status bar</span>
        </label>
        <div className="field" data-setting-id="ui.defaultTab">
          <label className="field-label">Default tab</label>
          <select
            className="select"
            value={settings.ui.defaultTab}
            onChange={(e) => patchUi({ defaultTab: e.target.value })}
          >
            <option value="overview">Overview</option>
            <option value="chat">Chat</option>
            <option value="agents">Agents</option>
            <option value="artifacts">Plans</option>
            <option value="projects">Projects</option>
            <option value="tasks">Tasks</option>
            <option value="config">Config</option>
            <option value="settings">Settings</option>
            <option value="mods">Mods</option>
            <option value="schedules">Schedules</option>
          </select>
        </div>
      </Card>

      {/* General */}
      <Card id="settings-general" data-section="general">
        <CardTitle>General</CardTitle>
        <CardMeta>Default agent + model override.</CardMeta>
        <div className="field" data-setting-id="defaultAgent">
          <label className="field-label" htmlFor="set-default-agent">Default agent</label>
          <input
            id="set-default-agent"
            className="input"
            type="text"
            placeholder="e.g. odin"
            value={settings.defaultAgent || ''}
            onChange={(e) => patchTop('defaultAgent', e.target.value)}
          />
        </div>
        <div className="field" data-setting-id="defaultModel">
          <label className="field-label" htmlFor="set-default-model">Model override</label>
          <input
            id="set-default-model"
            className="input"
            type="text"
            placeholder="(leave empty for provider default)"
            value={settings.defaultModel || ''}
            onChange={(e) => patchTop('defaultModel', e.target.value)}
          />
        </div>
      </Card>
    </>
  );
}
