import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuth } from "./useAuth";
import { useConfirm } from "./useConfirm";
import { useAuthStore } from "../stores/authStore";
import { makeAdmin, makeUser } from "../test/factories";

describe("useAuth", () => {
  beforeEach(() => useAuthStore.setState({ accessToken: null, user: null, status: "anonymous" }));

  it("reports a logged-out visitor", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current).toEqual({ user: null, isAuthenticated: false, isAdmin: false });
  });

  it("reports an authenticated regular user as non-admin", () => {
    const user = makeUser();
    useAuthStore.setState({ accessToken: "t", user });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.user).toEqual(user);
  });

  it("reports an admin", () => {
    useAuthStore.setState({ accessToken: "t", user: makeAdmin() });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAdmin).toBe(true);
  });
});

describe("useConfirm", () => {
  it("starts with no target", () => {
    const { result } = renderHook(() => useConfirm());
    expect(result.current.target).toBeNull();
  });

  it("ask sets the target and cancel clears it", () => {
    const { result } = renderHook(() => useConfirm());
    act(() => result.current.ask("item-7"));
    expect(result.current.target).toBe("item-7");
    act(() => result.current.cancel());
    expect(result.current.target).toBeNull();
  });
});
