/**
 * Tests for the discriminated error model.
 */

import { describe, it, expect } from "vitest";
import {
  isBizarError,
  connectionErrorFrom,
  dashboardErrorFrom,
  apiErrorFrom,
} from "../src/errors.js";

describe("isBizarError", () => {
  it("returns true for PluginError", () => {
    expect(
      isBizarError({
        name: "PluginError",
        data: { code: "X", message: "y" },
      }),
    ).toBe(true);
  });

  it("returns true for DashboardError", () => {
    expect(
      isBizarError({
        name: "DashboardError",
        data: { statusCode: 401, message: "unauth" },
      }),
    ).toBe(true);
  });

  it("returns true for ConnectionError", () => {
    expect(
      isBizarError({
        name: "ConnectionError",
        data: { message: "fetch failed" },
      }),
    ).toBe(true);
  });

  it("returns true for APIError", () => {
    expect(
      isBizarError({
        name: "APIError",
        data: { statusCode: 500, isRetryable: true, message: "boom" },
      }),
    ).toBe(true);
  });

  it("returns false for unknown shapes", () => {
    expect(isBizarError(null)).toBe(false);
    expect(isBizarError(undefined)).toBe(false);
    expect(isBizarError("string")).toBe(false);
    expect(isBizarError({})).toBe(false);
    expect(isBizarError({ name: "OtherError" })).toBe(false);
  });
});

describe("connectionErrorFrom", () => {
  it("wraps Error instances", () => {
    const err = connectionErrorFrom(new TypeError("ECONNREFUSED"));
    expect(err.name).toBe("ConnectionError");
    expect(err.data.message).toBe("ECONNREFUSED");
    expect(err.data.cause).toBeInstanceOf(TypeError);
  });

  it("wraps non-Error values", () => {
    const err = connectionErrorFrom("weird");
    expect(err.name).toBe("ConnectionError");
    expect(err.data.message).toBe("weird");
  });
});

describe("dashboardErrorFrom", () => {
  it("extracts message from JSON body", () => {
    const err = dashboardErrorFrom(
      401,
      JSON.stringify({ data: { message: "auth failed" } }),
    );
    expect(err.name).toBe("DashboardError");
    expect(err.data.statusCode).toBe(401);
    expect(err.data.message).toBe("auth failed");
  });

  it("falls back to status-only message when body is not JSON", () => {
    const err = dashboardErrorFrom(500, "<html>error</html>");
    expect(err.data.statusCode).toBe(500);
    expect(err.data.message).toBe("HTTP 500");
  });
});

describe("apiErrorFrom", () => {
  it("marks 5xx as retryable", () => {
    const err = apiErrorFrom(502, "bad gateway");
    expect(err.name).toBe("APIError");
    expect(err.data.isRetryable).toBe(true);
  });

  it("marks 429 as retryable", () => {
    const err = apiErrorFrom(429, "rate limit");
    expect(err.data.isRetryable).toBe(true);
  });

  it("marks 4xx other than 429 as non-retryable", () => {
    const err = apiErrorFrom(400, "bad request");
    expect(err.data.isRetryable).toBe(false);
  });
});
