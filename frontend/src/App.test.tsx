import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
import App from "./App";
import { useAuthStore } from "./stores/authStore";
import { makeAdmin, makeUser } from "./test/factories";
import { LocationDisplay } from "./test/utils";

// Stub every screen: these tests are about routing and guards only.
vi.mock("./components/layout/DashboardLayout", () => ({
  DashboardLayout: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));
vi.mock("./features/auth/LoginPage", () => ({ LoginPage: () => <div>login page</div> }));
vi.mock("./features/dashboard/DashboardPage", () => ({ DashboardPage: () => <div>dashboard page</div> }));
vi.mock("./features/accounts/AccountsPage", () => ({ AccountsPage: () => <div>accounts page</div> }));
vi.mock("./features/accounts/AccountDetailPage", () => ({ AccountDetailPage: () => <div>account detail page</div> }));
vi.mock("./features/admin/UsersPage", () => ({ default: () => <div>users page</div> }));
vi.mock("./features/admin/RequestsPage", () => ({ default: () => <div>admin requests page</div> }));
vi.mock("./features/admin/WebhooksAdminPage", () => ({ default: () => <div>webhooks page</div> }));
vi.mock("./features/admin/ImportsPage", () => ({ default: () => <div>imports page</div> }));
vi.mock("./features/user/UserPortalPage", () => ({ default: () => <div>my loans page</div> }));
vi.mock("./features/user/MyRequestsPage", () => ({ default: () => <div>my requests page</div> }));

const go = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <LocationDisplay />
    </MemoryRouter>,
  );
const path = () => screen.getByTestId("location").textContent;

const logIn = (user = makeAdmin()) => useAuthStore.setState({ accessToken: "t", refreshToken: "r", user });
const logOut = () => useAuthStore.setState({ accessToken: null, refreshToken: null, user: null });

describe("App routing", () => {
  beforeEach(logOut);

  describe("signed out", () => {
    it("shows the login page at /login", () => {
      go("/login");
      expect(screen.getByText("login page")).toBeInTheDocument();
    });

    it.each(["/", "/dashboard", "/accounts", "/accounts/abc", "/admin/users", "/my-loans", "/my-requests"])(
      "redirects %s to /login",
      (route) => {
        go(route);
        expect(path()).toBe("/login");
        expect(screen.getByText("login page")).toBeInTheDocument();
      },
    );

    it("redirects unknown URLs to login (via /)", () => {
      go("/does/not/exist");
      expect(path()).toBe("/login");
    });
  });

  describe("signed in as an admin", () => {
    beforeEach(() => logIn(makeAdmin()));

    it("sends / to the dashboard", () => {
      go("/");
      expect(path()).toBe("/dashboard");
      expect(screen.getByText("dashboard page")).toBeInTheDocument();
    });

    it.each([
      ["/dashboard", "dashboard page"],
      ["/accounts", "accounts page"],
      ["/accounts/abc", "account detail page"],
      ["/admin/users", "users page"],
      ["/admin/requests", "admin requests page"],
      ["/admin/webhooks", "webhooks page"],
      ["/admin/imports", "imports page"],
      ["/my-loans", "my loans page"],
      ["/my-requests", "my requests page"],
    ])("can open %s", (route, text) => {
      go(route);
      expect(path()).toBe(route);
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.getByTestId("layout")).toBeInTheDocument();
    });

    it("sends unknown URLs to the dashboard", () => {
      go("/nope");
      expect(path()).toBe("/dashboard");
    });
  });

  describe("signed in as a borrower", () => {
    beforeEach(() => logIn(makeUser()));

    it("sends / to my loans", () => {
      go("/");
      expect(path()).toBe("/my-loans");
      expect(screen.getByText("my loans page")).toBeInTheDocument();
    });

    it.each(["/my-loans", "/my-requests"])("can open %s", (route) => {
      go(route);
      expect(path()).toBe(route);
    });

    it.each(["/dashboard", "/accounts", "/accounts/abc", "/admin/users", "/admin/requests", "/admin/webhooks", "/admin/imports"])(
      "is bounced from admin-only %s to my loans",
      (route) => {
        go(route);
        expect(path()).toBe("/my-loans");
        expect(screen.getByText("my loans page")).toBeInTheDocument();
      },
    );
  });
});
