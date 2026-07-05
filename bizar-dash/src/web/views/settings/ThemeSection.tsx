// src/web/views/settings/ThemeSection.tsx
import React from 'react';
import { Palette, Sun, Moon, Monitor } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { cn } from '../../lib/utils';
import type { Settings, ThemeName } from '../../lib/types';

type Props = {
  settings: Settings;
  patchTheme: (patch: Partial<Settings['theme']>) => void;
  patchUi: (patch: Partial<Settings['ui']>) => void;
};

const THEMES: { id: ThemeName; label: string; Icon: typeof Sun }[] = [
  { id: 'dark', label: 'Dark', Icon: Moon },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'system', label: 'System', Icon: Monitor },
];

const PRESET_THEMES = [
  { name: 'Purple', accent: '#8b5cf6' },
  { name: 'Blue', accent: '#3b82f6' },
  { name: 'Green', accent: '#10b981' },
  { name: 'Orange', accent: '#f97316' },
  { name: 'Red', accent: '#ef4444' },
  { name: 'Pink', accent: '#ec4899' },
  { name: 'Cyan', accent: '#06b6d4' },
  { name: 'Mono', accent: '#6b7280' },
];

const FONT_FAMILIES = [
  'Inter',
  'system-ui',
  'Segoe UI',
  'Roboto',
  'JetBrains Mono',
  'SF Mono',
  'Cascadia Code',
];

export function ThemeSection({ settings, patchTheme, patchUi }: Props) {
  return (
    <Card id="settings-theme" data-section="theme">
      <CardTitle><Palette size={14} /> Theme</CardTitle>
      <CardMeta>Mode, accent, and colors. Live preview as you tweak.</CardMeta>

      {/* Accent presets */}
      <div className="field" data-setting-id="theme.presets">
        <label className="field-label">Accent presets</label>
        <div className="theme-presets">
          {PRESET_THEMES.map((t) => (
            <button
              key={t.name}
              type="button"
              className={cn(
                'theme-preset',
                settings.theme.accent === t.accent && 'theme-preset-active',
              )}
              onClick={() => patchTheme({ accent: t.accent })}
              title={t.name}
            >
              <span
                className="theme-preset-swatch"
                style={{ background: t.accent }}
              />
              <span className="theme-preset-name">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mode */}
      <div className="field" data-setting-id="theme.mode">
        <label className="field-label">Mode</label>
        <div className="theme-row">
          {THEMES.map(({ id, label, Icon }) => {
            const active = settings.theme.mode === id;
            return (
              <button
                key={id}
                type="button"
                className={cn('theme-card', active && 'theme-card-active')}
                onClick={() => patchTheme({ mode: id })}
              >
                <Icon size={16} />
                <span className="theme-card-label">{label}</span>
                <span
                  className={cn(
                    'theme-card-swatch',
                    `theme-card-swatch-${id}`,
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom colors */}
      <div className="theme-colors">
        {(['accent', 'success', 'warning', 'error', 'info'] as const).map((c) => (
          <div key={c} className="field" data-setting-id={`theme.${c}`}>
            <label className="field-label">{c.charAt(0).toUpperCase() + c.slice(1)}</label>
            <div className="color-row">
              <input
                type="color"
                className="input color-input"
                value={settings.theme[c]}
                onChange={(e) => patchTheme({ [c]: e.target.value })}
                aria-label={`${c} color`}
              />
              <input
                type="text"
                className="input"
                value={settings.theme[c]}
                onChange={(e) => patchTheme({ [c]: e.target.value })}
                aria-label={`${c} color hex`}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Font */}
      <div className="field" data-setting-id="theme.fontFamily">
        <label className="field-label">Font family</label>
        <select
          className="select"
          value={settings.theme.fontFamily}
          onChange={(e) => patchTheme({ fontFamily: e.target.value })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="field" data-setting-id="theme.fontSize">
        <label className="field-label">Font size: {settings.theme.fontSize}px</label>
        <input
          type="range"
          min={12}
          max={20}
          value={settings.theme.fontSize}
          onChange={(e) => patchTheme({ fontSize: Number(e.target.value) })}
        />
      </div>

      <label className="checkbox-row" data-setting-id="theme.compactMode">
        <input
          type="checkbox"
          checked={settings.theme.compactMode}
          onChange={(e) => patchTheme({ compactMode: e.target.checked })}
        />
        <span>Compact mode (denser UI)</span>
      </label>

      <label className="checkbox-row" data-setting-id="theme.animations">
        <input
          type="checkbox"
          checked={settings.theme.animations}
          onChange={(e) => patchTheme({ animations: e.target.checked })}
        />
        <span>Enable animations</span>
      </label>
    </Card>
  );
}
