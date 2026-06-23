/**
 * Discriminated error model for the BizarHarness SDK.
 *
 * Errors are RETURNED (not thrown) by default, matching the opencode SDK
 * pattern. Set `throwOnError: true` in the client config to opt into
 * throwing.
 *
 * Discriminate via the `name` field:
 *
 *   const result = await client.sessions.get({ sessionId });
 *   if (isBizarError(result)) {
 *     switch (result.name) {
 *       case "DashboardError": ...
 *       case "ConnectionError": ...
 *       case "APIError": ...
 *     }
 *   }
 */

export type PluginError = {
  name: "PluginError";
  data: {
    code: string;
    message: string;
  };
};

export type DashboardError = {
  name: "DashboardError";
  data: {
    statusCode: number;
    message: string;
  };
};

export type ConnectionError = {
  name: "ConnectionError";
  data: {
    message: string;
    cause?: unknown;
  };
};

export type APIError = {
  name: "APIError";
  data: {
    statusCode: number;
    isRetryable: boolean;
    message: string;
    responseBody?: string;
  };
};

export type BizarError = PluginError | DashboardError | ConnectionError | APIError;

/**
 * Type guard: narrows `unknown` to `BizarError`.
 */
export function isBizarError(value: unknown): value is BizarError {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { name?: unknown };
  if (typeof v.name !== "string") return false;
  return (
    v.name === "PluginError" ||
    v.name === "DashboardError" ||
    v.name === "ConnectionError" ||
    v.name === "APIError"
  );
}

/**
 * Convenience: build a ConnectionError from a thrown fetch failure.
 */
export function connectionErrorFrom(err: unknown): ConnectionError {
  if (err instanceof Error) {
    return {
      name: "ConnectionError",
      data: { message: err.message, cause: err },
    };
  }
  return {
    name: "ConnectionError",
    data: { message: String(err), cause: err },
  };
}

/**
 * Convenience: build a DashboardError from a non-OK HTTP response.
 */
export function dashboardErrorFrom(status: number, body: string): DashboardError {
  let message = `HTTP ${status}`;
  try {
    const parsed = JSON.parse(body) as { data?: { message?: string }; message?: string };
    if (parsed.data?.message) message = parsed.data.message;
    else if (parsed.message) message = parsed.message;
  } catch {
    // body wasn't JSON; fall back to status-only message
  }
  return {
    name: "DashboardError",
    data: { statusCode: status, message },
  };
}

/**
 * Convenience: build an APIError from a 5xx or specific 4xx response.
 * 5xx and 429 are retryable.
 */
export function apiErrorFrom(status: number, body: string): APIError {
  const isRetryable = status >= 500 || status === 429;
  return {
    name: "APIError",
    data: {
      statusCode: status,
      isRetryable,
      message: `Dashboard API returned ${status}`,
      responseBody: body,
    },
  };
}
