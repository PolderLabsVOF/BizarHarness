// src/mobile/views/MobileSettings.tsx — mobile settings tab.
import type { Settings, Snapshot } from '../../lib/types';

type Props = {
  settings: Settings;
  snapshot: Snapshot | null;
};

export function MobileSettings({ settings, snapshot }: Props) {
  const theme = settings.theme;
  const ui = settings.ui;

  return (
    <div className="mobile-view">
      {/* Theme */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Appearance</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Theme</span>
            <span className="mobile-setting-value">{theme.mode}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Accent color</span>
            <span className="mobile-setting-value">
              <span
                style={{
                  display: 'inline-block',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: theme.accent,
                  verticalAlign: 'middle',
                }}
              />
              {' '}
              {theme.accent}
            </span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Animations</span>
            <span className="mobile-setting-value">{theme.animations ? 'On' : 'Off'}</span>
          </div>
        </div>
      </section>

      {/* Project */}
      {snapshot?.activeProject && (
        <section className="mobile-section">
          <h3 className="mobile-section-title">Project</h3>
          <div className="mobile-card">
            <div className="mobile-setting-row">
              <span className="mobile-setting-label">Active</span>
              <span className="mobile-setting-value">{snapshot.activeProject.name}</span>
            </div>
            <div className="mobile-setting-row">
              <span className="mobile-setting-label">Path</span>
              <span className="mobile-setting-value mono">{snapshot.activeProject.path}</span>
            </div>
          </div>
        </section>
      )}

      {/* Chat defaults */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">Chat Defaults</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Default Agent</span>
            <span className="mobile-setting-value">@{settings.defaultAgent || 'odin'}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Default Model</span>
            <span className="mobile-setting-value">{settings.defaultModel || '(auto)'}</span>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mobile-section">
        <h3 className="mobile-section-title">About</h3>
        <div className="mobile-card">
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Version</span>
            <span className="mobile-setting-value mono">{settings.about?.version || 'v3.5.0'}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Agents</span>
            <span className="mobile-setting-value">{snapshot?.agents?.length || 0}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Tasks</span>
            <span className="mobile-setting-value">{snapshot?.tasks?.length || 0}</span>
          </div>
          <div className="mobile-setting-row">
            <span className="mobile-setting-label">Plans</span>
            <span className="mobile-setting-value">{snapshot?.plans?.length || 0}</span>
          </div>
        </div>
      </section>

      {/* Switch to desktop */}
      <div className="mobile-view-footer">
        <a href="/?desktop=1" className="mobile-btn mobile-btn-secondary">
          Switch to Desktop
        </a>
      </div>
    </div>
  );
}
