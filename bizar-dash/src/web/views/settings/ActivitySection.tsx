// src/web/views/settings/ActivitySection.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Activity, Search, Eye, RefreshCw, Info } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../../components/Card';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { Settings } from '../../lib/types';

type Props = {
  about: Settings['about'];
};

function ActivityLogCard() {
  const toast = useToast();
  const [items, setItems] = useState<Array<{ kind?: string; ts?: string; slug?: string; message?: string }>>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [log, hid] = await Promise.all([
        api.get<{ items: Array<{ kind?: string; ts?: string; slug?: string; message?: string }> }>('/activity'),
        api.get<{ hidden: string[] }>('/activity/hidden'),
      ]);
      setItems(Array.isArray(log.items) ? log.items : []);
      setHidden(new Set(hid.hidden || []));
    } catch (err) {
      toast.error(`Load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const keyOf = (it: { kind?: string; ts?: string; slug?: string }, idx: number) => {
    const k = `${it.kind || ''}|${it.ts || ''}|${it.slug || ''}|${idx}`;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = ((h << 5) - h + k.charCodeAt(i)) | 0;
    return Math.abs(h).toString(16).padStart(8, '0').slice(0, 16);
  };

  const onRestoreAll = async () => {
    try {
      await api.del('/activity/hide');
      setHidden(new Set());
      toast.success('All hidden activity restored.');
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  const onRestoreOne = async (key: string) => {
    try {
      await api.del(`/activity/hide/${encodeURIComponent(key)}`);
      const next = new Set(hidden);
      next.delete(key);
      setHidden(next);
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`);
    }
  };

  const filtered = items.filter((it, idx) => {
    const k = keyOf(it, idx);
    if (!showHidden && hidden.has(k)) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return [it.kind, it.slug, it.message].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
  });

  return (
    <Card id="settings-activity-log" data-section="activity-log">
      <CardTitle>
        <Activity size={14} /> Activity log
        <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
          {items.length} total · {hidden.size} hidden
        </span>
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={refresh} title="Reload">
          <RefreshCw size={12} />
        </Button>
      </CardTitle>
      <CardMeta>
        Full history from <code>~/.bizar/activity.log</code>. Hiding an item in the Overview only hides it there — the entry stays here.
      </CardMeta>

      <div className="activity-log-toolbar">
        <div className="activity-log-search">
          <Search size={12} />
          <input
            type="text"
            className="input"
            placeholder="Filter by kind, slug, or message…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <label className="activity-log-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Show hidden
        </label>
        <Button
          variant="ghost"
          size="sm"
          disabled={hidden.size === 0}
          onClick={onRestoreAll}
          title="Restore all hidden items to the Overview"
        >
          <Eye size={12} /> Restore all
        </Button>
      </div>

      {loading ? (
        <div className="muted" style={{ padding: '12px 0', fontSize: 12 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="muted" style={{ padding: '12px 0', fontSize: 12 }}>
          {items.length === 0 ? 'No activity yet.' : 'No items match the current filter.'}
        </div>
      ) : (
        <div className="activity-log-table-wrap">
          <table className="activity-log-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Detail</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((it, idx) => {
                const k = keyOf(it, idx);
                const isHidden = hidden.has(k);
                return (
                  <tr key={`${it.ts}-${idx}`} className={cn(isHidden && 'activity-log-row-hidden')}>
                    <td className="activity-log-kind">{it.kind || 'activity'}</td>
                    <td className="activity-log-detail">
                      {it.message || it.slug || '—'}
                    </td>
                    <td className="activity-log-time mono">
                      {it.ts ? new Date(it.ts).toLocaleString() : '—'}
                    </td>
                    <td>
                      {isHidden ? (
                        <Button variant="ghost" size="sm" onClick={() => onRestoreOne(k)} title="Restore to Overview">
                          <Eye size={12} />
                        </Button>
                      ) : (
                        <span className="activity-log-state-tag">shown</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <div className="muted" style={{ fontSize: 11, padding: '8px 0' }}>
              Showing first 200 of {filtered.length}.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AboutCard({ about }: Props) {
  return (
    <Card id="settings-about" data-section="about">
      <CardTitle><Info size={14} /> About</CardTitle>
      <CardMeta>Build metadata.</CardMeta>
      <dl className="about-table">
        <dt>Version</dt>
        <dd className="mono">{about?.version || '—'}</dd>
        <dt>Homepage</dt>
        <dd>
          <a href={about?.homepage || 'https://github.com/DrB0rk/BizarHarness'} target="_blank" rel="noopener noreferrer">
            {about?.homepage || 'https://github.com/DrB0rk/BizarHarness'}
          </a>
        </dd>
        <dt>License</dt>
        <dd>{about?.license || 'MIT'}</dd>
      </dl>
    </Card>
  );
}

export function ActivitySection({ about }: Props) {
  return (
    <>
      <ActivityLogCard />
      <AboutCard about={about} />
    </>
  );
}
