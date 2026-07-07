/**
 * Typed wrappers for cline SDK entities.
 *
 * We declare shapes structurally so that:
 *   1. The package compiles even when `@cline/sdk` is not installed.
 *   2. The shapes are stable regardless of which version of the upstream
 *      SDK is installed (the upstream types are very complex and couple us
 *      to internal class structure we don't need).
 */

export interface ClineSession {
  id: string;
  slug?: string;
  projectID?: string;
  workspaceID?: string;
  directory?: string;
  path?: string;
  parentID?: string;
  title?: string;
  agent?: string;
  model?: {
    id: string;
    providerID: string;
    variant?: string;
  };
  time?: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
}

export interface ClineMessage {
  info?: {
    id?: string;
    role?: string;
    time?: {
      created?: number;
    };
  };
  id?: string;
  role?: string;
  parts?: ClinePart[];
  text?: string;
  content?: string;
}

export type ClinePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; result: unknown }
  | { type: "agent"; text: string }
  | { type: "subtask"; text: string }
  | { type: "file"; path: string; content?: string }
  | { type: "step_start" | "step_finish" | "snapshot" | "patch" | "retry" | "compaction"; [key: string]: unknown };

export interface ClineEvent {
  type: string;
  sessionID?: string;
  messageID?: string;
  part?: ClinePart;
  data?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}
