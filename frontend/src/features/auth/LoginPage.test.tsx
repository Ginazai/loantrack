import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";

vi.mock("../../api", () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: null, user: null, status: "anonymous" });
  });

  it("renders the sign-in form", () => {
    renderLoginPage();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  it("logs in successfully and navigates to the dashboard", async () => {
    const user = userEvent.setup();
    (authApi.login as any).mockResolvedValue({
      access_token: "access-123",
    });
    (authApi.me as any).mockResolvedValue({
      id: "u1",
      email: "test@test.dev",
      full_name: "Test",
      role: "user",
      is_active: true,
      last_login: null,
      created_at: "2026-01-01T00:00:00Z",
    });

    renderLoginPage();
    await user.type(screen.getByPlaceholderText("you@example.com"), "test@test.dev");
    await user.type(screen.getByPlaceholderText("••••••••"), "CorrectPassword123!");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
    expect(useAuthStore.getState().accessToken).toBe("access-123");
    expect(useAuthStore.getState().status).toBe("authenticated");
    // Nothing from the login response is persisted to browser storage.
    expect(JSON.stringify({ ...localStorage })).not.toContain("access-123");
  });

  it("shows a plain-string error message on wrong credentials, without crashing", async () => {
    // Regression test for the 422/401-crash bug: the backend's detail can
    // be a plain string (typical for a 401) OR an array of validation
    // errors (typical for a 422) — either way the component must render a
    // message, never throw "Objects are not valid as a React child".
    const user = userEvent.setup();
    (authApi.login as any).mockRejectedValue({
      response: { status: 401, data: { detail: "Incorrect email or password" } },
    });

    renderLoginPage();
    await user.type(screen.getByPlaceholderText("you@example.com"), "test@test.dev");
    await user.type(screen.getByPlaceholderText("••••••••"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Incorrect email or password")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows a readable error even when the backend returns a 422 validation-array shape", async () => {
    const user = userEvent.setup();
    (authApi.login as any).mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }],
        },
      },
    });

    renderLoginPage();
    await user.type(screen.getByPlaceholderText("you@example.com"), "test@test.dev");
    await user.type(screen.getByPlaceholderText("••••••••"), "whatever");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    // Must not throw during render — getByText succeeding at all proves
    // the component survived rendering an array-shaped `detail`.
    expect(
      await screen.findByText("email: value is not a valid email address")
    ).toBeInTheDocument();
  });

  it("does not navigate away when login fails", async () => {
    const user = userEvent.setup();
    (authApi.login as any).mockRejectedValue({
      response: { status: 401, data: { detail: "Incorrect email or password" } },
    });

    renderLoginPage();
    await user.type(screen.getByPlaceholderText("you@example.com"), "test@test.dev");
    await user.type(screen.getByPlaceholderText("••••••••"), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByText("Incorrect email or password");
    expect(navigateMock).not.toHaveBeenCalled();
    // The form is still here to retry with — not replaced by a blank/crashed tree.
    expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument();
  });

  it("shows a client-side validation error for an invalid email, without calling the API", async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByPlaceholderText("you@example.com"), "not-an-email");
    await user.type(screen.getByPlaceholderText("••••••••"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Invalid email")).toBeInTheDocument();
    expect(authApi.login).not.toHaveBeenCalled();
  });
});
