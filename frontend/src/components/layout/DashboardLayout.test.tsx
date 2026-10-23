import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "./DashboardLayout";
import { authApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { useUIStore } from "../../stores/uiStore";
import { makeAdmin, makeUser } from "../../test/factories";
import { LocationDisplay } from "../../test/utils";

vi.mock("../../api", () => ({ authApi: { logout: vi.fn(), updateMe: vi.fn() } }));

function renderLayout(route = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/login" element={<div>login screen</div>} />
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<div>dashboard content</div>} />
          <Route path="/accounts" element={<div>accounts content</div>} />
          <Route path="/accounts/:id" element={<div>account detail content</div>} />
          <Route path="/my-loans" element={<div>my loans content</div>} />
        </Route>
      </Routes>
      <LocationDisplay />
    </MemoryRouter>,
  );
}

describe("DashboardLayout", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    (authApi.logout as any).mockResolvedValue({});
    useAuthStore.setState({ accessToken: "t", refreshToken: "r", user: makeAdmin() });
    useUIStore.setState({ theme: "light", sidebarOpen: true });
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the routed page inside the shell", () => {
    renderLayout();
    expect(screen.getByText("dashboard content")).toBeInTheDocument();
  });

  it("shows the full admin navigation to administrators", () => {
    renderLayout();
    for (const name of ["Dashboard", "Accounts", "Users", "Requests", "Webhooks", "Imports"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My Loans" })).toBeNull();
  });

  it("shows only the borrower navigation to regular users", () => {
    useAuthStore.setState({ user: makeUser() });
    renderLayout("/my-loans");
    expect(screen.getByRole("link", { name: "My Loans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My Requests" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    expect(screen.queryByText("Administration")).toBeNull();
  });

  it("marks the current section active, including nested routes", () => {
    renderLayout("/accounts/acc-9");
    expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("shows the signed-in user's name, email and role in the account panel", () => {
    renderLayout();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("admin@test.dev")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("labels non-admins as Borrower", () => {
    useAuthStore.setState({ user: makeUser() });
    renderLayout("/my-loans");
    expect(screen.getByText("Borrower")).toBeInTheDocument();
  });

  it("toggles between light and dark themes", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(useUIStore.getState().theme).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeInTheDocument();
  });

  it("opens and closes the side navigation from the menu button", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });

  it("dismisses the overlay nav after following a link on a narrow screen", async () => {
    const user = userEvent.setup();
    renderLayout();
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    expect(useUIStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });

  it("keeps the nav open after following a link on desktop", async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole("link", { name: "Accounts" }));
    expect(useUIStore.getState().sidebarOpen).toBe(true);
  });

  describe("account panel", () => {
    it("opens on click", async () => {
      const user = userEvent.setup();
      renderLayout();
      const trigger = screen.getByRole("button", { name: "Account" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      await user.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("closes on an outside click", async () => {
      const user = userEvent.setup();
      renderLayout();
      const trigger = screen.getByRole("button", { name: "Account" });
      await user.click(trigger);
      fireEvent.mouseDown(document.body);
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("stays open for clicks inside it", async () => {
      const user = userEvent.setup();
      renderLayout();
      const trigger = screen.getByRole("button", { name: "Account" });
      await user.click(trigger);
      fireEvent.mouseDown(screen.getByText("admin@test.dev"));
      expect(trigger).toHaveAttribute("aria-expanded", "true");
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      renderLayout();
      const trigger = screen.getByRole("button", { name: "Account" });
      await user.click(trigger);
      await user.keyboard("{Escape}");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    it("opens the account settings drawer and can dismiss it", async () => {
      const user = userEvent.setup();
      renderLayout();
      await user.click(screen.getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("button", { name: "Account settings" }));
      expect(screen.getByRole("dialog", { name: "Account Settings" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Account Settings" })).toBeNull();
    });

    it("signs out: calls the API, clears the session and goes to /login", async () => {
      const user = userEvent.setup();
      renderLayout();
      await user.click(screen.getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(screen.getByText("login screen")).toBeInTheDocument());
      expect(authApi.logout).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().user).toBeNull();
    });

    it("still signs out locally when the logout request fails", async () => {
      (authApi.logout as any).mockRejectedValue(new Error("network"));
      const user = userEvent.setup();
      renderLayout();
      await user.click(screen.getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(screen.getByText("login screen")).toBeInTheDocument());
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
  });
});
