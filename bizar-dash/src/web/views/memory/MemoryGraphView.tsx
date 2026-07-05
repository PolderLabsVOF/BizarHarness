// src/web/views/memory/MemoryGraphView.tsx — Interactive SVG knowledge graph.
//
// No external graph library. Hand-rolled force-directed layout + SVG rendering.
// Pan: drag on canvas. Zoom: scroll wheel. Click node: onNodeClick callback.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  size: number;
  group: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
  weight: number;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type Props = {
  data: GraphData;
  onNodeClick?: (node: GraphNode) => void;
  className?: string;
};

type LayoutNode = GraphNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

const CANVAS_SIZE = 800;
const ITERATIONS = 60;

const GROUP_COLORS: Record<string, string> = {
  default: '#8b5cf6',
  note: '#8b5cf6',
  entity: '#34d399',
  concept: '#fbbf24',
  root: '#f87171',
};

function getGroupColor(group: string, type: string): string {
  return GROUP_COLORS[group] || GROUP_COLORS[type] || GROUP_COLORS.default;
}

function nodeRadius(node: GraphNode): number {
  return 6 + Math.min(node.size * 2, 10);
}

/**
 * Simple force-directed layout.
 * - Repulsion between all node pairs
 * - Spring attraction along edges
 * - Center gravity
 */
function layoutNodes(nodes: GraphNode[], edges: GraphEdge[]): LayoutNode[] {
  if (nodes.length === 0) return [];

  // Build adjacency list.
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }

  // Initialise positions in a circle.
  const layout: LayoutNode[] = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const r = CANVAS_SIZE * 0.28;
    return {
      ...n,
      x: CANVAS_SIZE / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: CANVAS_SIZE / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
    };
  });

  const pos = new Map<string, LayoutNode>();
  for (const l of layout) pos.set(l.id, l);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const t = 1 - iter / ITERATIONS; // cooling

    // Repulsion (Coulomb's law).
    for (let i = 0; i < layout.length; i++) {
      for (let j = i + 1; j < layout.length; j++) {
        const a = layout[i];
        const b = layout[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (400 * t) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring attraction along edges.
    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = 80;
      const force = (dist - ideal) * 0.08 * t;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity.
    const cx = CANVAS_SIZE / 2;
    const cy = CANVAS_SIZE / 2;
    for (const l of layout) {
      l.vx += (cx - l.x) * 0.01 * t;
      l.vy += (cy - l.y) * 0.01 * t;
    }

    // Apply velocity with damping.
    for (const l of layout) {
      l.vx *= 0.85;
      l.vy *= 0.85;
      l.x += l.vx;
      l.y += l.vy;
      // Clamp to canvas.
      l.x = Math.max(20, Math.min(CANVAS_SIZE - 20, l.x));
      l.y = Math.max(20, Math.min(CANVAS_SIZE - 20, l.y));
    }
  }

  return layout;
}

export function MemoryGraphView({ data, onNodeClick, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan/zoom state.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const lastTouchDist = useRef<number | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Compute layout once.
  const layout = useMemo(() => layoutNodes(data.nodes, data.edges), [data.nodes, data.edges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const l of layout) m.set(l.id, l);
    return m;
  }, [layout]);

  // Pan handlers.
  const onMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('.memory-graph-node')) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  }, [transform]);

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTransform((t) => ({ ...t, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }));
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Zoom handlers.
  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransform((t) => {
      const newScale = Math.max(0.2, Math.min(4, t.scale * factor));
      const scaleChange = newScale / t.scale;
      return {
        x: mx - (mx - t.x) * scaleChange,
        y: my - (my - t.y) * scaleChange,
        scale: newScale,
      };
    });
  }, []);

  // Touch zoom.
  const onTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const touches = Array.from(e.touches);
    if (touches.length === 2) {
      const [t0, t1] = touches;
      lastTouchDist.current = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    } else if (touches.length === 1) {
      dragging.current = true;
      dragStart.current = { x: touches[0].clientX, y: touches[0].clientY, tx: transform.x, ty: transform.y };
    }
  }, [transform]);

  const onTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
    const touches = Array.from(e.touches);
    if (touches.length === 2 && lastTouchDist.current !== null) {
      const [t0, t1] = touches;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const factor = dist / lastTouchDist.current;
      lastTouchDist.current = dist;
      setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(4, t.scale * factor)) }));
    } else if (touches.length === 1 && dragging.current) {
      const dx = touches[0].clientX - dragStart.current.x;
      const dy = touches[0].clientY - dragStart.current.y;
      setTransform((t) => ({ ...t, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }));
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    dragging.current = false;
    lastTouchDist.current = null;
  }, []);

  const handleNodeClick = useCallback((node: LayoutNode) => {
    setSelectedId(node.id === selectedId ? null : node.id);
    onNodeClick?.(node);
  }, [selectedId, onNodeClick]);

  const strokeWidth = Math.max(0.5, 1 / Math.log2(transform.scale + 1));

  return (
    <svg
      ref={svgRef}
      className={cn('memory-graph-canvas', className)}
      viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
      style={{ width: '100%', height: '100%', minHeight: 400, cursor: dragging.current ? 'grabbing' : 'grab' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
        {/* Edges */}
        {data.edges.map((edge, i) => {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) return null;
          const isHighlighted = hoveredId === edge.source || hoveredId === edge.target || selectedId === edge.source || selectedId === edge.target;
          return (
            <line
              key={`e-${i}`}
              x1={src.x} y1={src.y}
              x2={tgt.x} y2={tgt.y}
              stroke={isHighlighted ? '#8b5cf6' : '#2d3648'}
              strokeWidth={isHighlighted ? strokeWidth * 2 : strokeWidth}
              strokeOpacity={isHighlighted ? 0.9 : 0.5}
            />
          );
        })}

        {/* Nodes */}
        {layout.map((node) => {
          const r = nodeRadius(node);
          const color = getGroupColor(node.group, node.type);
          const isSelected = selectedId === node.id;
          const isHovered = hoveredId === node.id;
          return (
            <g
              key={node.id}
              className="memory-graph-node"
              transform={`translate(${node.x},${node.y})`}
              onClick={() => handleNodeClick(node)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Hit area */}
              <circle r={r + 6} fill="transparent" />
              {/* Glow when selected/hovered */}
              {(isSelected || isHovered) && (
                <circle r={r + 4} fill={color} fillOpacity={0.2} />
              )}
              {/* Main circle */}
              <circle
                r={r}
                fill={color}
                fillOpacity={isSelected ? 1 : 0.75}
                stroke={isSelected ? '#fff' : color}
                strokeWidth={isSelected ? 2 : 1}
              />
              {/* Label */}
              {transform.scale > 0.5 && (
                <text
                  y={r + 12}
                  textAnchor="middle"
                  fontSize={Math.max(8, Math.min(11, 10 / Math.sqrt(transform.scale)))}
                  fill="var(--text-dim, #b4bcd0)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
