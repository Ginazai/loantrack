import { describe, it, expect } from "vitest";
import { getApiErrorMessage } from "./apiError";

describe("getApiErrorMessage", () => {
  it("returns a plain string detail unchanged", () => {
    const error = { response: { data: { detail: "Incorrect email or password" } } };
    expect(getApiErrorMessage(error)).toBe("Incorrect email or password");
  });

  it("extracts a readable message from a single FastAPI validation error", () => {
    // Regression test: this exact shape used to crash the component when
    // rendered directly as {error} — "Objects are not valid as a React child".
    const error = {
      response: {
        data: {
          detail: [
            {
              loc: ["body", "password"],
              msg: "String should have at least 8 characters",
              type: "string_too_short",
            },
          ],
        },
      },
    };
    expect(getApiErrorMessage(error)).toBe(
      "password: String should have at least 8 characters"
    );
  });

  it("joins multiple validation errors into one readable string", () => {
    const error = {
      response: {
        data: {
          detail: [
            { loc: ["body", "email"], msg: "field required" },
            { loc: ["body", "password"], msg: "field required" },
          ],
        },
      },
    };
    expect(getApiErrorMessage(error)).toBe("email: field required; password: field required");
  });

  it("handles a validation error with no loc field gracefully", () => {
    const error = { response: { data: { detail: [{ msg: "Something broke" }] } } };
    expect(getApiErrorMessage(error)).toBe("Something broke");
  });

  it("falls back to the provided default when detail is missing", () => {
    const error = { response: { data: {} } };
    expect(getApiErrorMessage(error, "Custom fallback")).toBe("Custom fallback");
  });

  it("falls back to the generic default when no fallback is provided", () => {
    expect(getApiErrorMessage({})).toBe("Something went wrong");
  });

  it("handles a network error distinctly", () => {
    const error = { message: "Network Error" };
    expect(getApiErrorMessage(error)).toBe(
      "Can't reach the server — check your connection and try again"
    );
  });

  it("handles a completely malformed error object without throwing", () => {
    expect(() => getApiErrorMessage(null)).not.toThrow();
    expect(() => getApiErrorMessage(undefined)).not.toThrow();
    expect(() => getApiErrorMessage("just a string")).not.toThrow();
    expect(getApiErrorMessage(null)).toBe("Something went wrong");
  });

  it("ignores an empty string detail and falls back", () => {
    const error = { response: { data: { detail: "" } } };
    expect(getApiErrorMessage(error, "fallback")).toBe("fallback");
  });

  it("ignores an empty array detail and falls back", () => {
    const error = { response: { data: { detail: [] } } };
    expect(getApiErrorMessage(error, "fallback")).toBe("fallback");
  });
});
