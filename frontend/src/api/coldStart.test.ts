import { describe, it, expect } from "vitest";
import axios, { AxiosError } from "axios";
import { MAX_COLD_RETRIES, retryDelayMs, shouldRetryColdStart } from "./coldStart";

function httpError(status: number, opts: { method?: string; data?: unknown } = {}) {
  const config = { method: opts.method ?? "get", headers: {} } as never;
  return new axios.AxiosError("failed", "ERR_BAD_RESPONSE", config, {}, {
    status,
    data: opts.data ?? "",
    statusText: "",
    headers: {},
    config,
  });
}

function networkError(method = "get"): AxiosError {
  return new axios.AxiosError("Network Error", "ERR_NETWORK", { method, headers: {} } as never);
}

describe("shouldRetryColdStart", () => {
  it.each([502, 503, 504])("retries a GET that got %i", (status) => {
    expect(shouldRetryColdStart(httpError(status), 0)).toBe(true);
  });

  it("retries a GET that got no response at all", () => {
    expect(shouldRetryColdStart(networkError(), 0)).toBe(true);
  });

  it("retries a 429 that came from the proxy (not our API)", () => {
    expect(shouldRetryColdStart(httpError(429, { data: "<html>Too Many Requests</html>" }), 0)).toBe(true);
  });

  it("does NOT retry the API's own rate limit, so the real message reaches the user", () => {
    const own = httpError(429, { method: "post", data: { error: "Rate limit exceeded: 5 per 1 minute" } });
    expect(shouldRetryColdStart(own, 0, true)).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422, 500])("does not retry a %i", (status) => {
    expect(shouldRetryColdStart(httpError(status), 0)).toBe(false);
  });

  it("ignores errors that are not axios errors", () => {
    expect(shouldRetryColdStart(new Error("boom"), 0)).toBe(false);
  });

  it("stops after MAX_COLD_RETRIES attempts", () => {
    expect(shouldRetryColdStart(httpError(502), MAX_COLD_RETRIES - 1)).toBe(true);
    expect(shouldRetryColdStart(httpError(502), MAX_COLD_RETRIES)).toBe(false);
  });

  describe("non-idempotent requests (e.g. recording a payment)", () => {
    it("are NOT resent after 502/504 or a dropped connection: they may have been processed", () => {
      expect(shouldRetryColdStart(httpError(502, { method: "post" }), 0)).toBe(false);
      expect(shouldRetryColdStart(httpError(504, { method: "post" }), 0)).toBe(false);
      expect(shouldRetryColdStart(networkError("post"), 0)).toBe(false);
    });

    it("are resent after 503 or a proxy 429, which mean the request was not processed", () => {
      expect(shouldRetryColdStart(httpError(503, { method: "post" }), 0)).toBe(true);
      expect(shouldRetryColdStart(httpError(429, { method: "delete", data: "" }), 0)).toBe(true);
    });

    it("login/refresh are always safe to resend", () => {
      expect(shouldRetryColdStart(httpError(502, { method: "post" }), 0, true)).toBe(true);
      expect(shouldRetryColdStart(networkError("post"), 0, true)).toBe(true);
    });
  });
});

describe("retryDelayMs", () => {
  it("backs off over roughly a minute in total", () => {
    const total = Array.from({ length: MAX_COLD_RETRIES }, (_, i) => retryDelayMs(i + 1)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeGreaterThanOrEqual(50_000);
    expect(total).toBeLessThanOrEqual(70_000);
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(MAX_COLD_RETRIES));
  });

  it("honours Retry-After when it is longer, capped at 15 s", () => {
    expect(retryDelayMs(1, "6")).toBe(6000);
    expect(retryDelayMs(1, "600")).toBe(15_000);
  });

  it("ignores a Retry-After shorter than the schedule or malformed", () => {
    expect(retryDelayMs(3, "1")).toBe(retryDelayMs(3));
    expect(retryDelayMs(1, "soon")).toBe(retryDelayMs(1));
    expect(retryDelayMs(1, null)).toBe(retryDelayMs(1));
  });
});
