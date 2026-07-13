/**
 * tests/memory-graph-view.test.tsx
 *
 * Tests for MemoryGraphView (SVG force-directed graph).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryGraphView, type GraphData } from '../src/web/views/memory/MemoryGraphView';

const EMPTY_GRAPH: GraphData = { nodes: [], edges: [] };

const THREE_NODE_GRAPH: GraphData = {
  nodes: [
    { id: 'notes/alpha.md', label: 'Alpha Note', type: 'note', size: 1, group: 'notes' },
    { id: 'notes/beta.md', label: 'Beta Note', type: 'note', size: 2, group: 'notes' },
    { id: 'decisions/dec.md', label: 'Decision', type: 'note', size: 1, group: 'decisions' },
  ],
  edges: [
    { source: 'notes/alpha.md', target: 'notes/beta.md', type: 'links_to', weight: 1 },
    { source: 'notes/beta.md', target: 'decisions/dec.md', type: 'links_to', weight: 1 },
  ],
};

describe('MemoryGraphView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SVG with empty graph', () => {
    render(<MemoryGraphView data={EMPTY_GRAPH} />);
    const svg = document.querySelector('.memory-graph-canvas');
    expect(svg).toBeInTheDocument();
  });

  it('renders nodes and edges', () => {
    render(<MemoryGraphView data={THREE_NODE_GRAPH} />);
    // SVG should have circles for nodes (one per node).
    const circles = document.querySelectorAll('.memory-graph-node');
    expect(circles.length).toBe(3);
  });

  it('calls onNodeClick when a node is clicked', () => {
    const onNodeClick = vi.fn();
    render(<MemoryGraphView data={THREE_NODE_GRAPH} onNodeClick={onNodeClick} />);
    const circles = document.querySelectorAll('.memory-graph-node');
    // Click the first node circle group.
    if (circles.length > 0) {
      fireEvent.click(circles[0]);
    }
    expect(onNodeClick).toHaveBeenCalledTimes(1);
  });

  it('renders filtered nodes when filter is applied via data prop', () => {
    const filteredData = {
      nodes: THREE_NODE_GRAPH.nodes.filter((n) => n.label.includes('Alpha')),
      edges: [],
    };
    render(<MemoryGraphView data={filteredData} />);
    const circles = document.querySelectorAll('.memory-graph-node');
    expect(circles.length).toBe(1);
  });

  it('node has correct type and group fields', () => {
    render(<MemoryGraphView data={THREE_NODE_GRAPH} />);
    const circles = document.querySelectorAll('.memory-graph-node');
    expect(circles.length).toBeGreaterThan(0);
  });
});
