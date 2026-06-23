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
