// src/web/components/UsageTable.tsx
//
// Sortable compact table for per-model usage breakdown.
//
// Props:
//   rows: PerModelRow[]
//   sortKey: string
//   sortDir: 'asc' | 'desc'
//   onSort: (key: string) => void

import { cn } from '../lib/utils';

export type PerModelRow = {
  providerId: string;
  modelId: string;
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  errors: number;
  avgLatencyMs: number;
};

type Props = {
  rows: PerModelRow[];
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
};

function SortHeader({ label, col, sortKey, sortDir, onSort }: {
  label: string; col: string; sortKey: string; sortDir: 'asc' | 'desc'; onSort: (k: string) => void;
}) {
  const active = sortKey === col;
  return (
    <th
      className={cn('usage-sort-header', active && 'is-active')}
      onClick={() => onSort(col)}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span>{label}</span>
      <span className="usage-sort-icon">
        {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
      </span>
    </th>
  );
}

export function UsageTable({ rows, sortKey, sortDir, onSort }: Props) {
  return (
    <div className="usage-table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <SortHeader label="Model"        col="modelId"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Requests"    col="requests"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Prompt Tok"  col="promptTokens"    sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Compl Tok"   col="completionTokens" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Total Tok"   col="totalTokens"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Avg Latency" col="avgLatencyMs"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Errors"     col="errors"          sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="usage-table-empty">No data for this range</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.providerId}::${row.modelId}`}>
                <td className="usage-table-model">
                  <code>{row.modelId}</code>
                </td>
                <td className="mono">{row.requests.toLocaleString()}</td>
                <td className="mono">{row.promptTokens.toLocaleString()}</td>
                <td className="mono">{row.completionTokens.toLocaleString()}</td>
                <td className="mono">{row.totalTokens.toLocaleString()}</td>
                <td className="mono">{row.avgLatencyMs}ms</td>
                <td className={cn('mono', row.errors > 0 && 'is-err')}>
                  {row.errors > 0 ? row.errors : '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
