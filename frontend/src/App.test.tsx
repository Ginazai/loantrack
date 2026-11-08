import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet } from "react-router-dom";
import App from "./App";
import { useAuthStore } from "./stores/authStore";
import { restoreSession } from "./api/session";
import { makeAdmin, makeUser } from "./test/factories";
import { LocationDisplay } from "./test/utils";

// The real one talks to the server; each test says how the restore ends.
vi.mock("./api/session", () => ({ restoreSession: vi.fn() }));
const restore = vi.mocked(restoreSession);

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

const logIn = (user = makeAdmin()) =>
  useAuthStore.setState({ accessToken: "t", user, status: "authenticated" });
// "anonymous" = the session restore on page load already ran and found nobody signed in.
const logOut = () => useAuthStore.setState({ accessToken: null, user: null, status: "anonymous" });
// A fresh page load: nothing in memory yet, the server has not been asked.
const freshPageLoad = () =>
  useAuthStore.setState({ accessToken: null, user: null, status: "unknown" });

describe("App routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restore.mockResolvedValue(undefined);
    logOut();
  });

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

  describe("reloading the page", () => {
    // The access token only lives in memory, so every reload starts signed out locally. The
    // refresh cookie is what proves the session is still alive, and only the server can say.
    const restoredAs = (user: ReturnType<typeof makeAdmin>) =>
      restore.mockImplementation(async () => {
        useAuthStore.getState().setAccessToken("fresh");
        // The token arrives before the profile does, as in the real restore.
        await Promise.resolve();
        useAuthStore.getState().setUser(user);
      });

    beforeEach(freshPageLoad);

    it("asks the server to restore the session before deciding anything", () => {
      restore.mockReturnValue(new Promise(() => {}));
      go("/accounts");
      expect(restore).toHaveBeenCalledTimes(1);
    });

    it("holds the page instead of redirecting to /login while it waits", () => {
      restore.mockReturnValue(new Promise(() => {}));
      go("/accounts");
      expect(screen.getByRole("status")).toHaveTextContent(/restoring your session/i);
      expect(path()).toBe("/accounts");
      expect(screen.queryByText("login page")).not.toBeInTheDocument();
    });

    it("keeps an admin on the admin page they reloaded", async () => {
      restoredAs(makeAdmin());
      go("/admin/users");
      expect(await screen.findByText("users page")).toBeInTheDocument();
      expect(path()).toBe("/admin/users"); // not bounced to /my-loans while the profile loaded
    });

    it("keeps a borrower on their page", async () => {
      restoredAs(makeUser());
      go("/my-requests");
      expect(await screen.findByText("my requests page")).toBeInTheDocument();
      expect(path()).toBe("/my-requests");
    });

    it("sends the visitor to /login only once the server says there is no session", async () => {
      restore.mockImplementation(async () => useAuthStore.getState().logout());
      go("/accounts");
      expect(await screen.findByText("login page")).toBeInTheDocument();
      expect(path()).toBe("/login");
    });

    it("does not ask again when the session is already known", () => {
      logIn(makeAdmin());
      go("/dashboard");
      logOut();
      go("/dashboard");
      expect(restore).not.toHaveBeenCalled();
    });
  });
});
