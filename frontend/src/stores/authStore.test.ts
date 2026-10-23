import { describe, it, expect, beforeEach } from "vitest";
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
    useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });
  });

  it("starts logged out", () => {
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setTokens makes isAuthenticated true", () => {
    useAuthStore.getState().setTokens("access-123", "refresh-456");
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe("access-123");
    expect(state.refreshToken).toBe("refresh-456");
    expect(state.isAuthenticated()).toBe(true);
  });

  it("setUser stores the user", () => {
    useAuthStore.getState().setUser(sampleUser);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });

  it("logout clears tokens and user", () => {
    useAuthStore.getState().setTokens("access-123", "refresh-456");
    useAuthStore.getState().setUser(sampleUser);

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });
});
