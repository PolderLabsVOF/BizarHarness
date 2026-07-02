/**
 * BizarHarness SDK client factory.
 *
 * Mirrors the opencode SDK pattern: a single `createBizarClient(config)`
 * call returns a typed client with resource-grouped methods. The client
 * handles auth header injection, response unwrapping, and error mapping
 * via the discriminated BizarError union.
 *
 * Reference: https://opencode.ai/docs/sdk/ (createOpencodeClient).
 */

import {
  apiErrorFrom,
  connectionErrorFrom,
  dashboardErrorFrom,
  type BizarError,
} from "./errors.js";
import { subscribeEvents, type EventSubscription } from "./events.js";
import type {
  DashboardEvent,
  Health,
  Plan,
  Project,
  Session,
  SessionCreate,
  SessionListQuery,
} from "./types.js";

export interface BizarClientConfig {
  baseUrl: string;
  password: string;
  /** Injectable fetch for testing. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** When true, errors are thrown. Default false (return BizarError). */
  throwOnError?: boolean;
  /** Extra headers to attach to every request. */
  headers?: Record<string, string>;
}

export interface SessionsResource {
  list(query?: SessionListQuery): Promise<Session[] | BizarError>;
  get(input: { sessionId: string }): Promise<Session | BizarError>;
  create(input: SessionCreate): Promise<Session | BizarError>;
  abort(input: { sessionId: string }): Promise<null | BizarError>;
}

export interface ProjectsResource {
  list(): Promise<Project[] | BizarError>;
}

export interface PlansResource {
  list(): Promise<Plan[] | BizarError>;
}

export interface EventsResource {
  subscribe(opts?: { signal?: AbortSignal; since?: number }): Promise<EventSubscription>;
  publish(event: DashboardEvent): Promise<null | BizarError>;
}

export interface HealthResource {
  check(): Promise<Health | BizarError>;
}

export interface BizarClient {
  sessions: SessionsResource;
  projects: ProjectsResource;
  plans: PlansResource;
  events: EventsResource;
  health: HealthResource;
  /** Change the base URL after the client was created. */
  setBaseUrl(url: string): void;
}

export function createBizarClient(config: BizarClientConfig): BizarClient {
  const fetchImpl = config.fetch ?? fetch;
  const authHeader = makeAuthHeader(config.password);
  const baseHeaders: Record<string, string> = {
    Authorization: authHeader,
    Accept: "application/json",
    ...(config.headers ?? {}),
  };

  async function request<T>(
    method: string,
    path: string,
    init?: { body?: unknown; query?: Record<string, string | number | undefined> },
  ): Promise<T | BizarError> {
    const url = new URL(path, config.baseUrl);
    if (init?.query) {
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = { ...baseHeaders };
    let body: string | undefined;
    if (init?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body,
      });
    } catch (err) {
      const error = connectionErrorFrom(err);
      if (config.throwOnError) throw error;
      return error;
    }

    if (response.status === 204) {
      return null as T;
    }

    const text = await response.text();

    if (!response.ok) {
      // 5xx and 429 → APIError (retryable); everything else → DashboardError.
      const error =
        response.status >= 500 || response.status === 429
          ? apiErrorFrom(response.status, text)
          : dashboardErrorFrom(response.status, text);
      if (config.throwOnError) throw error;
      return error;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Empty body or non-JSON; return null for caller to handle.
      return null as T;
    }
  }

  return {
    sessions: {
      list: (query) =>
        request<Session[]>("GET", "/sessions", { query: query as Record<string, string | number | undefined> }),
      get: ({ sessionId }) =>
        request<Session>("GET", `/sessions/${encodeURIComponent(sessionId)}`),
      create: (input) => request<Session>("POST", "/sessions", { body: input }),
      abort: ({ sessionId }) =>
        request<null>("DELETE", `/sessions/${encodeURIComponent(sessionId)}`),
    },
    projects: {
      list: () => request<Project[]>("GET", "/projects"),
    },
    plans: {
      list: () => request<Plan[]>("GET", "/plans"),
    },
    events: {
      subscribe: (opts) => subscribeEvents(config.baseUrl, authHeader, opts, fetchImpl),
      publish: (event) => request<null>("POST", "/event", { body: event }),
    },
    health: {
      check: async () => {
        const url = new URL("/health", config.baseUrl);
        try {
          const r = await fetchImpl(url.toString(), { method: "GET" });
          if (!r.ok) return dashboardErrorFrom(r.status, await r.text());
          return (await r.json()) as Health;
        } catch (err) {
          const e = connectionErrorFrom(err);
          if (config.throwOnError) throw e;
          return e;
        }
      },
    },
    setBaseUrl(url: string) {
      config.baseUrl = url;
    },
  };
}

/**
 * Build the `Authorization: Basic …` header value.
 * Username is `opencode` per the opencode convention used by BizarHarness.
 */
function makeAuthHeader(password: string): string {
  const credentials = `opencode:${password}`;
  // Buffer.from is available in both Node (≥ 16) and Bun.
  const encoded = Buffer.from(credentials, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}
