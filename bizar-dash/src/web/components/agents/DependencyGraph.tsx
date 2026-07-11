// src/web/components/agents/DependencyGraph.tsx — DAG of plan step dependencies.
//
// v6.4.0 — F-036 (Goal Planner UI). Uses @xyflow/react (already in
// Bizar deps) to render the plan's step graph. Falls back to a
// hand-rolled table when no plan is supplied.
import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch } from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../Card';
import { Tag } from '../Tag';
import type { Plan } from '../../lib/goapPlanner';

interface Props {
  plan: Plan | null;
}

function StepNode({ data }: NodeProps<Node<{ label: string; action: string; agent: string }>>) {
  return (
    <div className={`dep-node is-${(data as { action?: string }).action || 'research'}`}>
      <Handle type="target" position={Position.Left} className="dep-handle" />
      <div className="dep-node-action">{(data as { action?: string }).action}</div>
      <div className="dep-node-label">{(data as { label?: string }).label}</div>
      <div className="dep-node-agent">@{(data as { agent?: string }).agent}</div>
      <Handle type="source" position={Position.Right} className="dep-handle" />
    </div>
  );
}

const nodeTypes = { step: StepNode };

export function DependencyGraph({ plan }: Props) {
  const nodes: Node[] = useMemo(() => {
    if (!plan) return [];
    const n = plan.steps.length;
    // Lay out nodes in a horizontal flow based on dep depth.
    const depths = new Map<string, number>();
    const computeDepth = (id: string, stack = new Set<string>()): number => {
      const cached = depths.get(id);
      if (cached !== undefined) return cached;
      if (stack.has(id)) return 0;
      stack.add(id);
      const step = plan.steps.find((s) => s.id === id);
      if (!step || step.deps.length === 0) {
        depths.set(id, 0);
        stack.delete(id);
        return 0;
      }
      let max = 0;
      for (const dep of step.deps) {
        const d = computeDepth(dep, stack);
        if (d > max) max = d;
      }
      depths.set(id, max + 1);
      stack.delete(id);
      return max + 1;
    };
    for (const s of plan.steps) computeDepth(s.id);

    const byDepth = new Map<number, string[]>();
    for (const s of plan.steps) {
      const d = depths.get(s.id) ?? 0;
      const arr = byDepth.get(d) || [];
      arr.push(s.id);
      byDepth.set(d, arr);
    }
    const nodesOut: Node[] = [];
    for (const [depth, ids] of byDepth) {
      const total = ids.length;
      ids.forEach((id, i) => {
        const step = plan.steps.find((s) => s.id === id);
        if (!step) return;
        const xOffset = 60 + depth * 220;
        const yOffset = 40 + (i - (total - 1) / 2) * 90;
        nodesOut.push({
          id: step.id,
          type: 'step',
          position: { x: xOffset, y: yOffset },
          data: {
            label: step.title,
            action: step.action,
            agent: step.agent,
          },
        });
      });
    }
    void n;
    return nodesOut;
  }, [plan]);

  const edges: Edge[] = useMemo(() => {
    if (!plan) return [];
    return plan.steps.flatMap((step) =>
      step.deps.map((dep) => ({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
        animated: true,
      })),
    );
  }, [plan]);

  if (!plan) {
    return (
      <Card className="dep-graph" data-testid="dep-graph">
        <CardTitle>
          <GitBranch size={14} aria-hidden /> Dependency graph
        </CardTitle>
        <CardMeta>Submit a goal to render the dependency DAG.</CardMeta>
      </Card>
    );
  }

  if (plan.steps.length === 0) {
    return (
      <Card className="dep-graph" data-testid="dep-graph">
        <CardTitle>
          <GitBranch size={14} aria-hidden /> Dependency graph
        </CardTitle>
        <CardMeta>Empty plan — nothing to render.</CardMeta>
      </Card>
    );
  }

  return (
    <Card className="dep-graph" data-testid="dep-graph">
      <div className="dep-graph-header">
        <CardTitle>
          <GitBranch size={14} aria-hidden /> Dependency graph
        </CardTitle>
        <Tag variant="info">{plan.steps.length} nodes</Tag>
        <Tag variant="accent">{edges.length} edges</Tag>
      </div>
      <CardMeta>Plan step DAG · {plan.goal.slice(0, 80)}</CardMeta>
      <div className="dep-graph-canvas" data-testid="dep-graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </Card>
  );
}

export default DependencyGraph;