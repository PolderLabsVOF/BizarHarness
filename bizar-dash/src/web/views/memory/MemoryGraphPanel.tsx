// src/web/views/memory/MemoryGraphPanel.tsx — Memory Graph panel (v4.9).
//
// Interactive SVG knowledge graph spanning LightRAG entities + Obsidian wikilinks.

import React, { useCallback, useEffect, useState } from 'react';
import { Network, RefreshCw } from 'lucide-react';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { MemoryGraphView, type GraphNode, type GraphData } from './MemoryGraphView';
import { MemoryGraphLegend } from './MemoryGraphLegend';

type GraphResponse = {
  nodes: GraphNode[];
  edges: Array<{ source: string; target: string; type: string; weight: number }>;
  totalNodes: number;
  totalEdges: number;
};

type Props = { refreshKey: number };

export function MemoryGraphPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [depth, setDepth] = useState(2);
  const [root, setRoot] = useState('');
  const [stats, setStats] = useState<{ totalNodes: number; totalEdges: number } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (root) params.set('root', root);
      params.set('depth', String(depth));
      const res = await api.get<GraphResponse>(`/memory/graph?${params}`);
      setData({ nodes: res.nodes || [], edges: res.edges || [] });
      setStats({ totalNodes: res.totalNodes ?? res.nodes?.length ?? 0, totalEdges: res.totalEdges ?? res.edges?.length ?? 0 });
    } catch (err) {
      setError((err as Error).message);
      toast.error(`Graph load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [root, depth, toast]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph, refreshKey]);

  const onNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
  }, []);

  // Filter nodes by label.
  const filteredData = filter.trim()
    ? {
        nodes: data.nodes.filter((n) => n.label.toLowerCase().includes(filter.toLowerCase())),
        edges: data.edges.filter(
          (e) =>
            data.nodes.some((n) => n.id === e.source && n.label.toLowerCase().includes(filter.toLowerCase())) ||
            data.nodes.some((n) => n.id === e.target && n.label.toLowerCase().includes(filter.toLowerCase())),
        ),
      }
    : data;

  return (
    <div className="memory-panel-content">
      {/* ── Controls ─────────────────────────────────────────────── */}
      <Card>
        <CardTitle>
          <Network size={14} /> Memory Graph
        </CardTitle>
        <CardMeta>Interactive knowledge graph — LightRAG entities + Obsidian wikilinks. Drag to pan, scroll to zoom.</CardMeta>

        <div className="memory-graph-controls">
          <div className="memory-graph-search-row">
            <label htmlFor="graph-filter" className="sr-only">Filter nodes</label>
            <input
              id="graph-filter"
              type="text"
              className="input"
              placeholder="Filter nodes…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <input
              type="text"
              className="input"
              placeholder="Root note id (optional)"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              style={{ maxWidth: 240 }}
              title="Start from a specific note"
            />
            <label htmlFor="graph-depth" className="sr-only">Depth</label>
            <span className="muted text-sm" style={{ whiteSpace: 'nowrap' }}>
              Depth
              <input
                id="graph-depth"
                type="range"
                min={1}
                max={3}
                value={depth}
                onChange={(e) => setDepth(parseInt(e.target.value, 10))}
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
              />
              {depth}
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={fetchGraph}
              title="Refresh graph"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'memory-spin' : ''} />
            </button>
          </div>

          <MemoryGraphLegend />
        </div>
      </Card>

      {/* ── Graph canvas ─────────────────────────────────────────── */}
      <Card>
        {loading && !data.nodes.length ? (
          <div className="view-loading">
            <Spinner size="lg" />
            <p>Loading graph…</p>
          </div>
        ) : error && !data.nodes.length ? (
          <div className="muted text-sm">Failed to load graph: {error}</div>
        ) : data.nodes.length === 0 ? (
          <div className="muted text-sm">
            No graph data available. Index some notes first with LightRAG or add wikilinks to your vault.
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <MemoryGraphView
              data={filteredData}
              onNodeClick={onNodeClick}
              className="memory-graph-canvas-svg"
            />
            {filter && (
              <div className="text-xs muted" style={{ marginTop: 4 }}>
                Showing {filteredData.nodes.length} of {data.nodes.length} nodes
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Node detail ──────────────────────────────────────────── */}
      {selectedNode && (
        <Card>
          <CardTitle>{selectedNode.label}</CardTitle>
          <CardMeta>
            <code>{selectedNode.id}</code>
          </CardMeta>
          <dl className="memory-config-row">
            <dt>Type</dt>
            <dd><code>{selectedNode.type}</code></dd>
            <dt>Group</dt>
            <dd><code>{selectedNode.group}</code></dd>
            <dt>Size</dt>
            <dd>{selectedNode.size}</dd>
          </dl>
        </Card>
      )}

      {/* ── Stats footer ─────────────────────────────────────────── */}
      {stats && (
        <Card>
          <div className="memory-graph-stats">
            <span>{stats.totalNodes} node{stats.totalNodes !== 1 ? 's' : ''}</span>
            <span className="muted">·</span>
            <span>{stats.totalEdges} edge{stats.totalEdges !== 1 ? 's' : ''}</span>
            {filter && <span className="muted">· {filteredData.nodes.length} shown</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
