import { describe, it, expect } from "vitest";
import { isAuthEndpoint } from "./client";

describe("isAuthEndpoint", () => {
  // Regression coverage for the login-reload bug: a 401 from these specific
  // endpoints is an expected, user-facing outcome (wrong password, expired
  // refresh token) and must NOT trigger the token-refresh-retry flow, which
  // was hard-redirecting to /login before the LoginPage's own error state
  // could ever render.

  it("matches the login endpoint", () => {
    expect(isAuthEndpoint("/auth/login")).toBe(true);
  });

  it("matches the refresh endpoint", () => {
    expect(isAuthEndpoint("/auth/refresh")).toBe(true);
  });

  it("matches when the endpoint is part of a fuller URL", () => {
    expect(isAuthEndpoint("http://localhost/api/v1/auth/login")).toBe(true);
  });

  it("does not match unrelated endpoints", () => {
    expect(isAuthEndpoint("/accounts")).toBe(false);
    expect(isAuthEndpoint("/auth/me")).toBe(false);
    expect(isAuthEndpoint("/admin/users")).toBe(false);
  });

  it("handles undefined safely", () => {
    expect(isAuthEndpoint(undefined)).toBe(false);
  });

  it("handles an empty string safely", () => {
    expect(isAuthEndpoint("")).toBe(false);
  });
});
