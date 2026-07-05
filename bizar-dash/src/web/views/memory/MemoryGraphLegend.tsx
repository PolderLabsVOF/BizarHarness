// src/web/views/memory/MemoryGraphLegend.tsx — color legend for node groups.

import React from 'react';
import { cn } from '../../lib/utils';

const LEGEND_ITEMS = [
  { color: '#8b5cf6', label: 'Note / Default' },
  { color: '#34d399', label: 'Entity (LightRAG)' },
  { color: '#fbbf24', label: 'Concept (LightRAG)' },
  { color: '#f87171', label: 'Root / Ungrouped' },
];

type Props = { className?: string };

export function MemoryGraphLegend({ className }: Props) {
  return (
    <div className={cn('memory-graph-legend', className)}>
      {LEGEND_ITEMS.map((item) => (
        <span key={item.label} className="memory-graph-legend-item">
          <span
            className="memory-graph-legend-dot"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
