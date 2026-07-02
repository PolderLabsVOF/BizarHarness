/**
 * Public API for @polderlabs/bizar-sdk.
 */

export { createBizarClient } from "./client.js";
export type {
  BizarClient,
  BizarClientConfig,
  SessionsResource,
  ProjectsResource,
  PlansResource,
  EventsResource,
  HealthResource,
} from "./client.js";

export type { EventSubscription, EventSubscriptionOptions } from "./events.js";

export {
  isBizarError,
  connectionErrorFrom,
  dashboardErrorFrom,
  apiErrorFrom,
} from "./errors.js";
export type {
  BizarError,
  PluginError,
  DashboardError,
  ConnectionError,
  APIError,
  OpencodeConnectionError,
} from "./errors.js";

export type {
  // Session
  Session,
  SessionStatus,
  SessionCreate,
  SessionListQuery,
  // Project
  Project,
  // Plan
  Plan,
  PlanStatus,
  // Part
  Part,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  // Event
  DashboardEvent,
  DashboardConnectedEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionIdleEvent,
  SessionErrorEvent,
  MessagePartUpdatedEvent,
  ToolExecutedEvent,
  PlanUpdatedEvent,
  // Health
  Health,
} from "./types.js";

export { SDK_VERSION } from "./version.js";

// Opencode SDK — wraps the opencode serve child with a typed interface.
// Tries `@opencode-ai/sdk` first; falls back to a thin fetch wrapper.
export { createOpencodeSdk } from "./opencode.js";
export type { OpencodeSdk, OpencodeSdkConfig } from "./opencode.js";

export { subscribeOpencodeEvents } from "./opencode-events.js";
export type {
  OpencodeEventEnvelope,
  OpencodeEventSubscribeOptions,
} from "./opencode-events.js";

export type {
  OpencodeSession,
  OpencodeMessage,
  OpencodePart,
  OpencodeEvent,
} from "./opencode-types.js";
