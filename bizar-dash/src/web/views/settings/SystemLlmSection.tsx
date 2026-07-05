// src/web/views/settings/SystemLlmSection.tsx
import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import type { Settings } from '../../lib/types';

type Props = {
  settings: Settings;
  patchTop: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

export function SystemLlmSection({ settings, patchTop }: Props) {
  return (
    <Card id="settings-system-llm" data-section="system-llm">
      <CardTitle><Sparkles size={14} /> System LLM API</CardTitle>
      <CardMeta>
        Configures the LLM used for automatic title generation, prompt enhancement,
        summarization, and other system-level calls.
      </CardMeta>

      <label className="checkbox-row" data-setting-id="systemLlm.enabled">
        <input
          type="checkbox"
          checked={!!settings.systemLlm?.enabled}
          onChange={(e) => {
            const cur = settings.systemLlm || { enabled: true, provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' };
            patchTop('systemLlm', { ...cur, enabled: e.target.checked });
          }}
        />
        <span>Enable system LLM calls</span>
      </label>

      <div className="field" data-setting-id="systemLlm.provider" style={{ marginTop: 'var(--space-3)' }}>
        <label className="field-label" htmlFor="set-system-llm-provider">Provider</label>
        <select
          id="set-system-llm-provider"
          className="select"
          value={settings.systemLlm?.provider || 'opencode'}
          onChange={(e) => {
            const cur = settings.systemLlm || { enabled: true, provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' };
            patchTop('systemLlm', { ...cur, provider: e.target.value });
          }}
        >
          <option value="opencode">Opencode</option>
          <option value="openrouter">OpenRouter</option>
          <option value="minimax">MiniMax</option>
        </select>
      </div>

      <div className="field" data-setting-id="systemLlm.model">
        <label className="field-label" htmlFor="set-system-llm-model">Model</label>
        <input
          id="set-system-llm-model"
          className="input mono"
          type="text"
          placeholder="opencode/deepseek-v4-flash-free"
          value={settings.systemLlm?.model || 'opencode/deepseek-v4-flash-free'}
          onChange={(e) => {
            const cur = settings.systemLlm || { enabled: true, provider: 'opencode', model: 'opencode/deepseek-v4-flash-free' };
            patchTop('systemLlm', { ...cur, model: e.target.value });
          }}
        />
        <p className="field-help">
          The API key is read from <code>auth.json</code> for the selected provider.
          Leave the default model for best results.
        </p>
      </div>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <h4 style={{ margin: '0 0 var(--space-2)' }}>Features using this API</h4>
        <ul className="settings-feature-list" style={{ margin: 0, paddingLeft: 'var(--space-4)', lineHeight: 1.8 }}>
          <li>Auto-title generation for new chat sessions</li>
          <li>Auto-title generation for new tasks</li>
          <li>&quot;Enhance prompt&quot; button in the task input</li>
          <li>&quot;Enhance prompt&quot; button in the chat composer</li>
          <li className="muted" style={{ fontSize: 12 }}>Future: summarization, name generation, and more</li>
        </ul>
      </div>
    </Card>
  );
}
