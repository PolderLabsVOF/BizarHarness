/**
 * Type definitions matching .bizar/research/OPENAPI_SPEC.yaml.
 *
 * Hand-written in v0.7.0-alpha.1. In v0.7.1 these will be auto-generated
 * via @hey-api/openapi-ts. Keep this file in sync with OPENAPI_SPEC.yaml
 * until codegen is wired.
 */

// ─── Session ────────────────────────────────────────────────────────────

export type SessionStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "killed"
  | "timed_out";

export type Session = {
  id: string;
  opencodeSessionId?: string;
  agent: string;
  status: SessionStatus;
  parentId?: string;
  model?: string;
  error?: string;
  toolCallCount: number;
  resultPreview?: string;
  worktree: string;
  createdAt: number;
  updatedAt: number;
};

export type SessionCreate = {
  agent: string;
  prompt: string;
  model?: string;
  parentId?: string;
  timeoutMs?: number;
};

export type SessionListQuery = {
  status?: SessionStatus;
  agent?: string;
  limit?: number;
};

// ─── Project ────────────────────────────────────────────────────────────

export type Project = {
  id: string;
  name: string;
  path: string;
  bankId?: string;
};

// ─── Plan ───────────────────────────────────────────────────────────────

export type PlanStatus = "draft" | "approved" | "rejected" | "in-progress" | "done";

export type Plan = {
  slug: string;
  title: string;
  status: PlanStatus;
  createdAt?: number;
  updatedAt?: number;
};

// ─── Part (discriminated by `type`) ─────────────────────────────────────

export type TextPart = {
  type: "text";
  text: string;
};

export type ToolCallPart = {
  type: "tool_call";
  toolName: string;
  args: Record<string, unknown>;
};

export type ToolResultPart = {
  type: "tool_result";
  toolName: string;
  result: Record<string, unknown>;
  isError?: boolean;
};

export type ReasoningPart = {
  type: "reasoning";
  text: string;
};

export type Part = TextPart | ToolCallPart | ToolResultPart | ReasoningPart;

// ─── Event (discriminated by `type`) ────────────────────────────────────

export type DashboardConnectedEvent = {
  type: "dashboard.connected";
  properties: Record<string, never>;
};

export type SessionCreatedEvent = {
  type: "session.created";
  properties: {
    sessionId: string;
    agent: string;
  };
};

export type SessionUpdatedEvent = {
  type: "session.updated";
  properties: {
    sessionId: string;
    status: SessionStatus;
  };
};

export type SessionIdleEvent = {
  type: "session.idle";
  properties: {
    sessionId: string;
  };
};

export type SessionErrorEvent = {
  type: "session.error";
  properties: {
    sessionId: string;
    error: string;
  };
};

export type MessagePartUpdatedEvent = {
  type: "message.part.updated";
  properties: {
    sessionId: string;
    messageId: string;
    part: Part;
  };
};

export type ToolExecutedEvent = {
  type: "tool.executed";
  properties: {
    sessionId: string;
    toolName: string;
    durationMs?: number;
  };
};

export type PlanUpdatedEvent = {
  type: "plan.updated";
  properties: {
    slug: string;
    status: PlanStatus;
  };
};

export type DashboardEvent =
  | DashboardConnectedEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | SessionIdleEvent
  | SessionErrorEvent
  | MessagePartUpdatedEvent
  | ToolExecutedEvent
  | PlanUpdatedEvent;

// ─── Health ─────────────────────────────────────────────────────────────

export type Health = {
  status: "ok" | "degraded";
  uptime: number;
  version: string;
};
