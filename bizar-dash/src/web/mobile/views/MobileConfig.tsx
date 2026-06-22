// src/mobile/views/MobileConfig.tsx — config key-value editor with type-aware inputs.
import { useEffect, useState } from 'react';
import { Sliders, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { api } from '../../lib/api';

type ConfigEntry = {
  key: string;
  value: unknown;
  type: 'boolean' | 'number' | 'string' | 'object' | 'array' | 'unknown';
  defaultValue?: unknown;
};

type Props = {
  onBack: () => void;
};

export function MobileConfig({ onBack }: Props) {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api.get<Record<string, unknown>>('/config');
      const entries: ConfigEntry[] = Object.entries(data).map(([key, value]) => ({
        key,
        value,
        type: detectType(value),
      }));
      setEntries(entries);
      setEditing(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v])));
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const detectType = (v: unknown): ConfigEntry['type'] => {
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (Array.isArray(v)) return 'array';
    if (v && typeof v === 'object') return 'object';
    return 'unknown';
  };

  const handleChange = (key: string, value: unknown) => {
    setEditing((cur) => ({ ...cur, [key]: value }));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await api.patch('/config', editing);
      await load();
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  const resetRow = (key: string, defaultValue?: unknown) => {
    setEditing((cur) => ({ ...cur, [key]: defaultValue }));
  };

  const renderInput = (entry: ConfigEntry) => {
    const value = editing[entry.key];
    switch (entry.type) {
      case 'boolean':
        return (
          <label className="mobile-toggle">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => handleChange(entry.key, e.target.checked)}
            />
            <span className="mobile-toggle-slider" />
          </label>
        );
      case 'number':
        return (
          <input
            className="mobile-input mobile-input-sm"
            type="number"
            inputMode="numeric"
            value={String(value ?? '')}
            onChange={(e) => handleChange(entry.key, Number(e.target.value))}
          />
        );
      case 'string':
        return (
          <input
            className="mobile-input mobile-input-sm"
            type="text"
            value={String(value ?? '')}
            onChange={(e) => handleChange(entry.key, e.target.value)}
          />
        );
      case 'object':
      case 'array':
        return (
          <textarea
            className="mobile-input mobile-input-sm"
            rows={2}
            value={JSON.stringify(value ?? null, null, 2)}
            onChange={(e) => {
              try {
                handleChange(entry.key, JSON.parse(e.target.value));
              } catch {
                // invalid JSON
              }
            }}
          />
        );
      default:
        return <span className="mobile-setting-value mono">{String(value ?? 'null')}</span>;
    }
  };

  return (
    <div className="mobile-view">
      <div className="mobile-tasks-toolbar">
        <span style={{ fontSize: 14, color: 'var(--text-muted)', flex: 1 }}>{entries.length} config entries</span>
        <button type="button" className="mobile-icon-btn" onClick={() => load()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
        <button
          type="button"
          className="mobile-btn"
          disabled={saving}
          onClick={() => saveAll()}
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save all'}
        </button>
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : entries.length === 0 ? (
        <div className="mobile-empty">
          <Sliders size={40} />
          <p>No config entries.</p>
        </div>
      ) : (
        <div className="mobile-config-list">
          {entries.map((entry) => (
            <div key={entry.key} className="mobile-config-row">
              <div className="mobile-config-key">
                <span className="mono">{entry.key}</span>
                <span className="mobile-config-type">{entry.type}</span>
              </div>
              <div className="mobile-config-value">
                {renderInput(entry)}
              </div>
              <button
                type="button"
                className="mobile-icon-btn"
                onClick={() => resetRow(entry.key, entry.defaultValue)}
                aria-label="Reset to default"
                title="Reset"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
