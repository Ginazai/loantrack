import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { refreshSession } from "./client";
import { useAuthStore } from "../stores/authStore";

describe("refreshSession", () => {
  let postSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, status: "unknown" });
    postSpy = vi.spyOn(axios, "post");
  });
  afterEach(() => {
    postSpy.mockRestore();
    delete (navigator as any).locks;
  });

  it("stores the new access token in memory and marks the session authenticated", async () => {
    postSpy.mockResolvedValue({ data: { access_token: "fresh" } });
    await expect(refreshSession()).resolves.toBe("fresh");
    expect(useAuthStore.getState().accessToken).toBe("fresh");
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("shares one network call between concurrent callers", async () => {
    let resolve!: (v: unknown) => void;
    postSpy.mockReturnValue(new Promise((r) => (resolve = r)) as never);

    const a = refreshSession();
    const b = refreshSession();
    resolve({ data: { access_token: "fresh" } });

    expect(await a).toBe("fresh");
    expect(await b).toBe("fresh");
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it("allows a new refresh once the previous one settled", async () => {
    postSpy.mockResolvedValue({ data: { access_token: "one" } });
    await refreshSession();
    postSpy.mockResolvedValue({ data: { access_token: "two" } });
    await expect(refreshSession()).resolves.toBe("two");
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it("does not wedge after a failure", async () => {
    postSpy.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(refreshSession()).rejects.toBeTruthy();
    postSpy.mockResolvedValue({ data: { access_token: "again" } });
    await expect(refreshSession()).resolves.toBe("again");
  });

  it("holds the browser-wide lock while refreshing, so two tabs never spend the same cookie", async () => {
    const order: string[] = [];
    (navigator as any).locks = {
      request: vi.fn(async (_name: string, fn: () => Promise<unknown>) => {
        order.push("lock acquired");
        const out = await fn();
        order.push("lock released");
        return out;
      }),
    };
    postSpy.mockImplementation(async () => {
      order.push("refresh request");
      return { data: { access_token: "fresh" } };
    });

    await refreshSession();

    expect((navigator as any).locks.request).toHaveBeenCalledWith(
      "loantrack-refresh",
      expect.any(Function),
    );
    expect(order).toEqual(["lock acquired", "refresh request", "lock released"]);
  });

  it("sends no body and no token: the refresh token is the httpOnly cookie", async () => {
    postSpy.mockResolvedValue({ data: { access_token: "fresh" } });
    await refreshSession();
    const [, body] = postSpy.mock.calls[0];
    expect(body).toBeUndefined();
  });
});
