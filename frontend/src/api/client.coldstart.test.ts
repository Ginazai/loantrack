import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import client, { warmUpBackend } from "./client";
import { MAX_COLD_RETRIES, resetWakeStateForTests } from "./coldStart";
import { useAuthStore } from "../stores/authStore";
import { useConnectionStore } from "../stores/connectionStore";

type Cfg = { headers: Record<string, string>; url?: string; method?: string };

const ok = (config: Cfg, data: unknown = { ok: true }) =>
  Promise.resolve({ data, status: 200, statusText: "OK", headers: {}, config });

const fail = (config: Cfg, status: number, data: unknown = "") =>
  Promise.reject(
    new axios.AxiosError("failed", "ERR_BAD_RESPONSE", config as never, {}, {
      status,
      data,
      statusText: "",
      headers: {},
      config: config as never,
    }),
  );

/** Fails with `status` for the first `times` calls, then succeeds. */
function sleepyBackend(times: number, status = 502) {
  let calls = 0;
  return vi.fn((c: Cfg) => (++calls <= times ? fail(c, status) : ok(c, { awake: true })));
}

describe("cold-start retries in the API client", () => {
  const originalAdapter = client.defaults.adapter;
  const location = { href: "/accounts" };

  beforeEach(() => {
    resetWakeStateForTests();
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: "access", refreshToken: "refresh", user: null });
    useConnectionStore.setState({ waking: false });
    location.href = "/accounts";
    vi.stubGlobal("location", location);
  });

  afterEach(() => {
    client.defaults.adapter = originalAdapter;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps trying while the backend wakes up, then succeeds, and shows/hides the banner", async () => {
    const adapter = sleepyBackend(3);
    client.defaults.adapter = adapter as never;

    const pending = client.get("/accounts");
    await vi.advanceTimersByTimeAsync(1);
    expect(useConnectionStore.getState().waking).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    const res = await pending;

    expect(res.data).toEqual({ awake: true });
    expect(adapter).toHaveBeenCalledTimes(4);
    expect(useConnectionStore.getState().waking).toBe(false);
  });

  it("gives up after MAX_COLD_RETRIES, surfaces the real error, and clears the banner", async () => {
    const adapter = sleepyBackend(Infinity);
    client.defaults.adapter = adapter as never;

    const pending = client.get("/accounts");
    const assertion = expect(pending).rejects.toMatchObject({ response: { status: 502 } });
    await vi.advanceTimersByTimeAsync(300_000);
    await assertion;

    expect(adapter).toHaveBeenCalledTimes(1 + MAX_COLD_RETRIES);
    expect(useConnectionStore.getState().waking).toBe(false);
  });

  it("retries a login that hit a sleeping backend", async () => {
    const adapter = sleepyBackend(2);
    client.defaults.adapter = adapter as never;

    const pending = client.post("/auth/login", { email: "a@b.co", password: "x" });
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it("does NOT resend a payment after a 502 (it might already have been recorded)", async () => {
    const adapter = sleepyBackend(Infinity, 502);
    client.defaults.adapter = adapter as never;

    await expect(client.post("/accounts/1/payments", { amount: "10" })).rejects.toMatchObject({
      response: { status: 502 },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().waking).toBe(false);
  });

  it("does resend a payment after a 503 (known not processed)", async () => {
    const adapter = sleepyBackend(1, 503);
    client.defaults.adapter = adapter as never;

    const pending = client.post("/accounts/1/payments", { amount: "10" });
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it("does not retry real application errors", async () => {
    const adapter = vi.fn((c: Cfg) => fail(c, 422, { detail: "bad" }));
    client.defaults.adapter = adapter as never;

    await expect(client.get("/accounts")).rejects.toMatchObject({ response: { status: 422 } });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it("shows the API's own rate-limit error immediately instead of waiting a minute", async () => {
    const adapter = vi.fn((c: Cfg) =>
      fail(c, 429, { error: "Rate limit exceeded: 5 per 1 minute" }),
    );
    client.defaults.adapter = adapter as never;

    await expect(client.post("/auth/login", {})).rejects.toMatchObject({
      response: { status: 429 },
    });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState().waking).toBe(false);
  });

  it("does not log the user out when the token refresh hits a sleeping backend", async () => {
    // Access token expired AND backend asleep: the original request 401s, then the
    // refresh call gets a 502 once before the backend is up.
    client.defaults.adapter = ((c: Cfg) =>
      c.headers.Authorization === "Bearer new-access" ? ok(c, { n: 1 }) : fail(c, 401)) as never;
    const post = vi
      .spyOn(axios, "post")
      .mockRejectedValueOnce(
        new axios.AxiosError("bad gateway", "ERR_BAD_RESPONSE", undefined, {}, {
          status: 502,
          data: "",
          statusText: "",
          headers: {},
          config: {} as never,
        }),
      )
      .mockResolvedValueOnce({ data: { access_token: "new-access", refresh_token: "new-refresh" } });

    const pending = client.get("/accounts");
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({ data: { n: 1 } });
    expect(post).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().accessToken).toBe("new-access");
    expect(location.href).toBe("/accounts"); // not redirected to /login
  });

  it("warmUpBackend pings /health and never throws, even when it fails", async () => {
    const adapter = vi.fn((c: Cfg) => fail(c, 500));
    client.defaults.adapter = adapter as never;

    expect(() => warmUpBackend()).not.toThrow();
    await vi.advanceTimersByTimeAsync(1);

    expect(adapter.mock.calls[0][0].url).toBe("/health");
  });
});

/**
 * Render's free tier answers a request that comes from ANOTHER RENDER SERVICE (our nginx
 * proxy) to a sleeping service with an instant 502 and never wakes it. Only a request that
 * arrives from outside Render, i.e. from the user's browser straight to the backend's public
 * URL, starts it (confirmed against three independent community reports; see ADR-009).
 * This fake platform encodes that rule, so the suite fails if the client only retries
 * through the proxy.
 */
describe("sleeping backend that only wakes for direct browser requests (Render free tier)", () => {
  const originalAdapter = client.defaults.adapter;
  const BACKEND = "https://loantrack-api.onrender.com";
  let awake: boolean;
  let directWakePings: number;

  beforeEach(() => {
    resetWakeStateForTests();
    vi.useFakeTimers();
    awake = false;
    directWakePings = 0;
    useAuthStore.setState({ accessToken: "access", refreshToken: "refresh", user: null });
    useConnectionStore.setState({ waking: false });

    // Through nginx: instant 502 until the backend is up. Never wakes it.
    client.defaults.adapter = ((c: Cfg) => (awake ? ok(c, { awake: true }) : fail(c, 502))) as never;

    // Browser fetches: runtime config from nginx, and the direct no-cors wake ping.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/runtime-config.json")) {
          return new Response(JSON.stringify({ backendUrl: `${BACKEND}/` }), { status: 200 });
        }
        if (String(url) === `${BACKEND}/api/v1/health`) {
          directWakePings += 1;
          setTimeout(() => (awake = true), 40_000); // ~40 s to boot after the first direct hit
          return new Response("", { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  });

  afterEach(() => {
    client.defaults.adapter = originalAdapter;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("wakes the backend with a direct request and then succeeds through the proxy", async () => {
    const pending = client.get("/accounts");
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(pending).resolves.toMatchObject({ data: { awake: true } });
    expect(directWakePings).toBeGreaterThan(0);
    expect(useConnectionStore.getState().waking).toBe(false);
  });

  it("sends the wake ping with no-cors and no credentials, to the backend's public URL", async () => {
    const pending = client.get("/accounts");
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;

    const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([u]) => u === `${BACKEND}/api/v1/health`,
    )!;
    expect(call[1]).toMatchObject({ mode: "no-cors", credentials: "omit" });
  });

  it("warmUpBackend wakes the backend directly, before any request has failed", async () => {
    warmUpBackend();
    await vi.advanceTimersByTimeAsync(1);

    expect(directWakePings).toBe(1);
  });

  it("still works (just without a wake ping) when no runtime config is served, e.g. docker compose", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>spa fallback</html>", { status: 200 })),
    );
    awake = true; // local dev: backend is never asleep
    await expect(client.get("/accounts")).resolves.toMatchObject({ status: 200 });
  });
});
