import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAuthStore } from "./authStore";
import type { User } from "../types";

const sampleUser: User = {
  id: "u1",
  email: "test@test.dev",
  full_name: "Test User",
  role: "user",
  is_active: true,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
};

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null, status: "unknown" });
  });

  it("starts with the session undetermined, not signed out", () => {
    // After a reload we can't tell yet: the refresh cookie is invisible to scripts.
    expect(useAuthStore.getState().status).toBe("unknown");
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setAccessToken makes isAuthenticated true and marks the session authenticated", () => {
    useAuthStore.getState().setAccessToken("access-123");
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe("access-123");
    expect(state.status).toBe("authenticated");
    expect(state.isAuthenticated()).toBe(true);
  });

  it("setUser stores the user", () => {
    useAuthStore.getState().setUser(sampleUser);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });

  it("logout clears the token and user and marks the session anonymous", () => {
    useAuthStore.getState().setAccessToken("access-123");
    useAuthStore.getState().setUser(sampleUser);

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.status).toBe("anonymous");
    expect(state.isAuthenticated()).toBe(false);
  });

  describe("browser storage", () => {
    it("never writes the access token, the user, or any token to localStorage/sessionStorage", () => {
      useAuthStore.getState().setAccessToken("secret-access-token");
      useAuthStore.getState().setUser(sampleUser);

      for (const store of [localStorage, sessionStorage]) {
        const dump = JSON.stringify({ ...store });
        expect(dump).not.toContain("secret-access-token");
        expect(dump).not.toContain(sampleUser.email);
      }
      expect(localStorage.getItem("auth")).toBeNull();
    });

    it("removes the tokens an older version persisted under the \"auth\" key", async () => {
      localStorage.setItem(
        "auth",
        JSON.stringify({ state: { accessToken: "old", refreshToken: "old-refresh" } }),
      );
      vi.resetModules();
      await import("./authStore"); // module load = the one-time cleanup
      expect(localStorage.getItem("auth")).toBeNull();
    });
  });
});
