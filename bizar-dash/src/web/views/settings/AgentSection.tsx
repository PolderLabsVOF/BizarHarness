// src/web/views/settings/AgentSection.tsx
import React, { useEffect, useState } from 'react';
import { Server as ServerIcon, Globe, Save } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Button } from '../../components/Button';
import { AutosaveField } from '../../components/AutosaveField';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';

type Props = {
  settings: Settings;
  patchAgents: (patch: Partial<Settings['agents']>) => void;
  patchDashboard: (patch: Partial<Settings['dashboard']>) => void;
  /** Called after state is patched; parent debounces the API save */
  autoSave?: (key: keyof Settings, value: Settings[keyof Settings]) => void;
};

export function AgentSection({ settings, patchAgents, patchDashboard, autoSave }: Props) {
  const toast = useToast();
  const [pluginOptions, setPluginOptions] = useState<Record<string, number>>({});

  useEffect(() => {
    api.get<Record<string, number>>('/settings/plugin-options')
      .then(setPluginOptions)
      .catch(() => { /* not persisted yet — use defaults */ });
  }, []);

  const onSavePluginOptions = async () => {
    try {
      await api.put('/settings/plugin-options', pluginOptions);
      toast.success('Saved — restart cline for changes to take effect.');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  };

  const onCleanupBackground = async () => {
    try {
      const r = await fetch('/api/background/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxAgeDays: 7 }),
      });
      const result = await r.json();
      toast.success(`Cleaned up ${result.deleted} old instances.`);
    } catch (err) {
      toast.error(`Cleanup failed: ${(err as Error).message}`);
    }
  };

  return (
    <>
      {/* Agents */}
      <Card id="settings-agents" data-section="agents">
        <CardTitle><ServerIcon size={14} /> Agent Behavior</CardTitle>
        <CardMeta>Limits and timeouts for background agent dispatch.</CardMeta>
        <div className="form-row">
          <label htmlFor="agents-maxParallel">
            Max parallel agents
            <span className="meta-badge">default: 6</span>
          </label>
          <input
            id="agents-maxParallel"
            type="number"
            min={1}
            max={20}
            value={settings.agents?.maxParallel ?? 6}
            onChange={(e) => patchAgents({ maxParallel: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 6)) })}
          />
        </div>
        <div className="form-row">
          <label htmlFor="agents-stuckThresholdMs">
            Stuck threshold (ms)
            <span className="meta-badge">default: 600000 (10 min)</span>
          </label>
          <input
            id="agents-stuckThresholdMs"
            type="number"
            min={60000}
            max={3600000}
            step={60000}
            value={settings.agents?.stuckThresholdMs ?? 600000}
            onChange={(e) => patchAgents({ stuckThresholdMs: Math.max(60000, Math.min(3600000, parseInt(e.target.value, 10) || 600000)) })}
          />
        </div>
        <label className="checkbox-row" data-setting-id="agents.autoRestart">
          <input
            type="checkbox"
            checked={!!settings.agents?.autoRestart}
            onChange={(e) => patchAgents({ autoRestart: e.target.checked })}
          />
          <span>Auto-restart stuck agents</span>
        </label>
      </Card>

      {/* Dashboard */}
      <Card id="settings-dashboard" data-section="dashboard">
        <CardTitle><Globe size={14} /> Dashboard</CardTitle>
        <CardMeta>Controls how <code>bizar</code> starts up.</CardMeta>
        <label className="checkbox-row" data-setting-id="dashboard.autoLaunchWeb">
          <input
            type="checkbox"
            checked={settings.dashboard.autoLaunchWeb !== false}
            onChange={(e) => patchDashboard({ autoLaunchWeb: e.target.checked })}
          />
          <span>Auto-launch web UI alongside TUI</span>
        </label>

        <div className="field" data-setting-id="dashboard.projectsDirectory" style={{ marginTop: 'var(--space-4)' }}>
          <label className="field-label" htmlFor="set-projects-directory">Projects directory</label>
          <input
            id="set-projects-directory"
            className="input"
            type="text"
            placeholder="/home/user/projects"
            value={settings.dashboard.projectsDirectory ?? ''}
            onChange={(e) => patchDashboard({ projectsDirectory: e.target.value })}
          />
          <p className="field-help">
            New projects created via the dashboard will land here, and existing project
            directories inside this folder are auto-recognized on startup.
          </p>
          {settings.dashboard.projectsDirectory && (
            <>
              {!/^\/|^[A-Za-z]:/.test(settings.dashboard.projectsDirectory) && (
                <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 4 }}>
                  Path should be absolute (start with / on Linux/Mac, or a drive letter on Windows).
                </p>
              )}
              {settings.dashboard.projectsDirectory.includes('..') && (
                <p style={{ color: 'var(--error)', fontSize: 11, marginTop: 4 }}>
                  Path traversal not allowed — this will be rejected server-side.
                </p>
              )}
            </>
          )}
        </div>

        {/* allowedRoots textarea */}
        <div className="field" data-setting-id="dashboard.allowedRoots" style={{ marginTop: 'var(--space-4)' }}>
          <label className="field-label" htmlFor="set-allowed-roots">
            Additional allowed roots <span className="muted">(advanced)</span>
          </label>
          {/* key= forces re-mount when allowedRoots changes externally (e.g. reset/reload) */}
          <AutosaveField
            key={settings.dashboard.allowedRoots?.join('\n')}
            initialValue={(settings.dashboard.allowedRoots ?? []).join('\n')}
            delay={1500}
            saveFn={async (v) => {
              const lines = v.split('\n').map((l) => l.trim()).filter(Boolean);
              patchDashboard({ allowedRoots: lines });
              autoSave?.('dashboard', { allowedRoots: lines } as Settings['dashboard']);
            }}
            render={({ value, onChange, onBlur }) => (
              <textarea
                id="set-allowed-roots"
                className="textarea"
                rows={4}
                placeholder="/workspace&#10;/srv/projects"
                value={value}
                onChange={e => onChange(e.target.value)}
                onBlur={onBlur}
              />
            )}
          />
          <p className="field-help">
            Optional. Add filesystem roots beyond your home directory that the file
            browser and project scanner can access. Each path must be inside your
            home directory. One per line.
          </p>
          {(() => {
            const rawLines = (settings.dashboard.allowedRoots ?? []).join('\n').split('\n');
            const warnings: { key: string; msg: React.ReactNode }[] = [];
            rawLines.forEach((line, i) => {
              if (!line.trim()) return;
              if (!/^\/|^[A-Za-z]:/.test(line)) {
                warnings.push({
                  key: `noabs-${i}`,
                  msg: (
                    <p style={{ color: 'var(--warning)', fontSize: 11, marginTop: 2 }}>
                      Line {i + 1}: &quot;{line}&quot; — should be absolute (start with / or a drive letter).
                    </p>
                  ),
                });
              }
              if (line.includes('..')) {
                warnings.push({
                  key: `dots-${i}`,
                  msg: (
                    <p style={{ color: 'var(--error)', fontSize: 11, marginTop: 2 }}>
                      Line {i + 1}: &quot;{line}&quot; — contains '..' (server will reject this).
                    </p>
                  ),
                });
              }
            });
            return warnings.map((w) => w.msg);
          })()}
        </div>
      </Card>

      {/* Background agents */}
      <Card id="settings-background" data-section="background">
        <CardTitle><ServerIcon size={14} /> Background Agents</CardTitle>
        <CardMeta>Tune plugin options. Changes take effect on next plugin restart.</CardMeta>

        <div className="form-row">
          <label htmlFor="bg-maxConcurrent">
            Max concurrent instances
            <span className="meta-badge">default: 8</span>
          </label>
          <input
            id="bg-maxConcurrent"
            type="number"
            min={1}
            max={32}
            value={pluginOptions.maxConcurrentInstances ?? 8}
            onChange={(e) => setPluginOptions((cur) => ({ ...cur, maxConcurrentInstances: Math.max(1, Math.min(32, parseInt(e.target.value, 10) || 8)) }))}
          />
          <small className="muted">Plugin option: <code>maxConcurrentInstances</code></small>
        </div>

        <div className="form-row">
          <label htmlFor="bg-toolCallCap">
            Tool-call cap
            <span className="meta-badge">default: 500</span>
          </label>
          <input
            id="bg-toolCallCap"
            type="number"
            min={1}
            max={5000}
            value={pluginOptions.backgroundToolCallCap ?? 500}
            onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundToolCallCap: Math.max(1, Math.min(5000, parseInt(e.target.value, 10) || 500)) }))}
          />
          <small className="muted">Plugin option: <code>backgroundToolCallCap</code></small>
        </div>

        <div className="form-row">
          <label htmlFor="bg-stallTimeout">
            Stall timeout (ms)
            <span className="meta-badge">default: 180000</span>
          </label>
          <input
            id="bg-stallTimeout"
            type="number"
            min={10000}
            max={600000}
            step={1000}
            value={pluginOptions.backgroundStallTimeoutMs ?? 180000}
            onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundStallTimeoutMs: Math.max(10000, Math.min(600000, parseInt(e.target.value, 10) || 180000)) }))}
          />
          <small className="muted">Plugin option: <code>backgroundStallTimeoutMs</code></small>
        </div>

        <div className="form-row">
          <label htmlFor="bg-thinkingLoopTimeout">
            Thinking-loop timeout (ms)
            <span className="meta-badge">default: 300000</span>
          </label>
          <input
            id="bg-thinkingLoopTimeout"
            type="number"
            min={30000}
            max={900000}
            step={1000}
            value={pluginOptions.backgroundThinkingLoopTimeoutMs ?? 300000}
            onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundThinkingLoopTimeoutMs: Math.max(30000, Math.min(900000, parseInt(e.target.value, 10) || 300000)) }))}
          />
          <small className="muted">Plugin option: <code>backgroundThinkingLoopTimeoutMs</code></small>
        </div>

        <div className="form-row">
          <label htmlFor="bg-maxInterventions">
            Max interventions
            <span className="meta-badge">default: 1</span>
          </label>
          <input
            id="bg-maxInterventions"
            type="number"
            min={1}
            max={3}
            value={pluginOptions.backgroundMaxInterventions ?? 1}
            onChange={(e) => setPluginOptions((cur) => ({ ...cur, backgroundMaxInterventions: Math.max(1, Math.min(3, parseInt(e.target.value, 10) || 1)) }))}
          />
          <small className="muted">Plugin option: <code>backgroundMaxInterventions</code></small>
        </div>

        <div className="form-row">
          <Button variant="secondary" size="sm" onClick={onSavePluginOptions}>
            <Save size={14} /> Save plugin options
          </Button>
          <Button variant="secondary" size="sm" onClick={onCleanupBackground}>
            Cleanup old instances (&gt;7 days)
          </Button>
        </div>

        <div className="form-row">
          <small>Plugin options are read at startup. Save changes and run <code>bizar update</code> to apply.</small>
        </div>
      </Card>
    </>
  );
}
