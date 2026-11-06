import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import client from "./client";
import { useAuthStore } from "../stores/authStore";

type Cfg = { headers: Record<string, string>; url?: string };

function ok(config: Cfg, data: unknown = { ok: true }) {
  return Promise.resolve({ data, status: 200, statusText: "OK", headers: {}, config });
}
function unauthorized(config: Cfg) {
  return Promise.reject(
    new axios.AxiosError("Unauthorized", "ERR_BAD_REQUEST", config as never, {}, {
      status: 401,
      data: {},
      statusText: "Unauthorized",
      headers: {},
      config: config as never,
    }),
  );
}

describe("axios client interceptors", () => {
  const originalAdapter = client.defaults.adapter;
  let postSpy: ReturnType<typeof vi.fn>;
  const location = { href: "/accounts" };

  beforeEach(() => {
    useAuthStore.setState({ accessToken: "old-access", refreshToken: "old-refresh", user: null });
    postSpy = vi.spyOn(axios, "post") as unknown as ReturnType<typeof vi.fn>;
    location.href = "/accounts";
    vi.stubGlobal("location", location);
  });

  afterEach(() => {
    client.defaults.adapter = originalAdapter;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends the stored access token as a Bearer header", async () => {
    const adapter = vi.fn((c: Cfg) => ok(c));
    client.defaults.adapter = adapter as never;

    await client.get("/accounts");

    expect(adapter.mock.calls[0][0].headers.Authorization).toBe("Bearer old-access");
  });

  it("sends no Authorization header when logged out", async () => {
    useAuthStore.setState({ accessToken: null });
    const adapter = vi.fn((c: Cfg) => ok(c));
    client.defaults.adapter = adapter as never;

    await client.get("/accounts");

    expect(adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
  });

  it("refreshes the token on 401 and retries the original request", async () => {
    const adapter = vi.fn((c: Cfg) =>
      c.headers.Authorization === "Bearer new-access" ? ok(c, { n: 1 }) : unauthorized(c),
    );
    client.defaults.adapter = adapter as never;
    postSpy.mockResolvedValue({ data: { access_token: "new-access", refresh_token: "new-refresh" } });

    const res = await client.get("/accounts");

    expect(res.data).toEqual({ n: 1 });
    expect(postSpy).toHaveBeenCalledWith(expect.stringContaining("/auth/refresh"), {
      refresh_token: "old-refresh",
    });
    expect(useAuthStore.getState().accessToken).toBe("new-access");
    expect(useAuthStore.getState().refreshToken).toBe("new-refresh");
  });

  it("logs out and redirects to /login when the refresh itself fails", async () => {
    client.defaults.adapter = ((c: Cfg) => unauthorized(c)) as never;
    postSpy.mockRejectedValue(new Error("refresh expired"));

    await expect(client.get("/accounts")).rejects.toMatchObject({ response: { status: 401 } });

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(location.href).toBe("/login");
  });

  it("does not loop: a 401 on the retried request is rejected without a second refresh", async () => {
    client.defaults.adapter = ((c: Cfg) => unauthorized(c)) as never;
    postSpy.mockResolvedValue({ data: { access_token: "new-access", refresh_token: "r2" } });

    await expect(client.get("/accounts")).rejects.toMatchObject({ response: { status: 401 } });

    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("passes non-401 errors straight through without refreshing", async () => {
    client.defaults.adapter = ((c: Cfg) =>
      Promise.reject(
        new axios.AxiosError("boom", "ERR", c as never, {}, {
          status: 500,
          data: {},
          statusText: "",
          headers: {},
          config: c as never,
        }),
      )) as never;

    await expect(client.get("/accounts")).rejects.toMatchObject({ response: { status: 500 } });
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("does not try to refresh when /auth/login returns 401 (wrong password)", async () => {
    client.defaults.adapter = ((c: Cfg) => unauthorized(c)) as never;

    await expect(client.post("/auth/login", {})).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(location.href).toBe("/accounts"); // no hard redirect
  });

  it("queues concurrent 401s behind a single refresh call", async () => {
    const adapter = vi.fn((c: Cfg) =>
      c.headers.Authorization === "Bearer new-access" ? ok(c, c.url) : unauthorized(c),
    );
    client.defaults.adapter = adapter as never;
    let resolveRefresh!: (v: unknown) => void;
    postSpy.mockReturnValue(new Promise((r) => (resolveRefresh = r)) as never);

    const first = client.get("/a");
    const second = client.get("/b");
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0)); // let the second 401 reach the queue

    resolveRefresh({ data: { access_token: "new-access", refresh_token: "new-refresh" } });
    const [a, b] = await Promise.all([first, second]);

    expect([a.data, b.data]).toEqual(["/a", "/b"]);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
