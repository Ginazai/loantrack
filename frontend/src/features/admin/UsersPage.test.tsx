import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UsersPage from "./UsersPage";
import { adminApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { makeAccount, makeAdmin, makeUser } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  adminApi: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    getUserAccounts: vi.fn(),
  },
}));
const api = adminApi as unknown as Record<
  "listUsers" | "createUser" | "updateUser" | "deleteUser" | "getUserAccounts",
  ReturnType<typeof vi.fn>
>;

const me = makeAdmin({ id: "admin-1", full_name: "Admin User", email: "admin@test.dev" });
const bob = makeUser({ id: "user-2", full_name: "Bob Borrower", email: "bob@test.dev" });

const row = async (name: string) =>
  (await screen.findByText(name)).closest("tr")! as HTMLElement;

describe("UsersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "t", user: me });
    api.listUsers.mockResolvedValue([me, bob]);
  });

  it("shows a loading placeholder", () => {
    api.listUsers.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<UsersPage />);
    expect(screen.getByLabelText("Loading users")).toBeInTheDocument();
  });

  it("shows an empty state that opens the create drawer", async () => {
    api.listUsers.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);
    expect(await screen.findByText("No users yet.")).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "Users" });
    await user.click(within(section).getByRole("button", { name: "New user" }));
    expect(screen.getByRole("dialog", { name: "Create New User" })).toBeInTheDocument();
  });

  it("lists users with role and status", async () => {
    renderWithProviders(<UsersPage />);
    const bobRow = await row("Bob Borrower");
    expect(within(bobRow).getByText("bob@test.dev")).toBeInTheDocument();
    expect(within(bobRow).getByText("user")).toBeInTheDocument();
    expect(within(bobRow).getByText("Active")).toBeInTheDocument();
    expect(within(await row("Admin User")).getByText("admin")).toBeInTheDocument();
  });

  describe("activating / deactivating", () => {
    it("deactivates an active user and updates the row", async () => {
      api.updateUser.mockResolvedValue({ ...bob, is_active: false });
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      const bobRow = await row("Bob Borrower");
      await user.click(within(bobRow).getByRole("switch", { name: "Bob Borrower is active" }));
      await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("user-2", { is_active: false }));
      expect(await within(bobRow).findByText("Inactive")).toBeInTheDocument();
      expect(within(bobRow).getByRole("switch", { name: "Bob Borrower is inactive" })).toBeInTheDocument();
    });

    it("reactivates an inactive user", async () => {
      api.listUsers.mockResolvedValue([{ ...bob, is_active: false }]);
      api.updateUser.mockResolvedValue(bob);
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await user.click(await screen.findByRole("switch", { name: "Bob Borrower is inactive" }));
      await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("user-2", { is_active: true }));
    });
  });

  describe("creating a user", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithProviders(<UsersPage />);
      await screen.findByText("Bob Borrower");
      await user.click(screen.getByRole("button", { name: "New user" }));
      return screen.getByRole("dialog", { name: "Create New User" });
    };

    it("requires every field", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Create user" }));
      expect(await within(dialog).findByText("All fields required")).toBeInTheDocument();
      expect(api.createUser).not.toHaveBeenCalled();
    });

    it("creates the user, shows them first and closes", async () => {
      const created = makeUser({ id: "user-3", full_name: "Cara New", email: "cara@test.dev" });
      api.createUser.mockResolvedValue(created);
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Full Name"), "Cara New");
      await user.type(within(dialog).getByLabelText("Email"), "cara@test.dev");
      await user.type(within(dialog).getByLabelText("Temporary Password"), "temp-pass-1");
      await user.selectOptions(within(dialog).getByLabelText("Role"), "admin");
      await user.click(within(dialog).getByRole("button", { name: "Create user" }));

      await waitFor(() =>
        expect(api.createUser).toHaveBeenCalledWith({
          email: "cara@test.dev", password: "temp-pass-1", full_name: "Cara New", role: "admin",
        }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create New User" })).toBeNull());
      const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent);
      expect(names[0]).toContain("Cara New");
    });

    it("shows the server error and stays open", async () => {
      api.createUser.mockRejectedValue({ response: { data: { detail: "Email already registered" } } });
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Full Name"), "X");
      await user.type(within(dialog).getByLabelText("Email"), "bob@test.dev");
      await user.type(within(dialog).getByLabelText("Temporary Password"), "temp-pass-1");
      await user.click(within(dialog).getByRole("button", { name: "Create user" }));
      expect(await within(dialog).findByText("Email already registered")).toBeInTheDocument();
    });

    it("cancel closes the drawer", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Create New User" })).toBeNull();
    });
  });

  describe("editing a user", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>, who = "Bob Borrower") => {
      renderWithProviders(<UsersPage />);
      const r = await row(who);
      await user.click(within(r).getByRole("button", { name: "Edit user" }));
      return screen.getByRole("dialog", { name: "Edit User" });
    };

    it("prefills the form", async () => {
      const dialog = await open(userEvent.setup());
      expect(within(dialog).getByLabelText("Full Name")).toHaveValue("Bob Borrower");
      expect(within(dialog).getByLabelText("Email")).toHaveValue("bob@test.dev");
      expect(within(dialog).getByLabelText("Role")).toHaveValue("user");
    });

    it("closes without calling the API when nothing changed", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(api.updateUser).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Edit User" })).toBeNull();
    });

    it("requires a name and email", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.clear(within(dialog).getByLabelText("Full Name"));
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(await within(dialog).findByText("Name and email are required")).toBeInTheDocument();
      expect(api.updateUser).not.toHaveBeenCalled();
    });

    it("rejects a new password shorter than 8 characters", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Reset Password"), "short");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(await within(dialog).findByText("New password must be at least 8 characters")).toBeInTheDocument();
      expect(api.updateUser).not.toHaveBeenCalled();
    });

    it("sends only what changed and updates the row", async () => {
      api.updateUser.mockResolvedValue({ ...bob, full_name: "Robert Borrower" });
      const user = userEvent.setup();
      const dialog = await open(user);
      const name = within(dialog).getByLabelText("Full Name");
      await user.clear(name);
      await user.type(name, "  Robert Borrower  ");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith("user-2", { full_name: "Robert Borrower" }));
      expect(await screen.findByText("Robert Borrower")).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Edit User" })).toBeNull();
    });

    it("can change email, role and password together", async () => {
      api.updateUser.mockResolvedValue(bob);
      const user = userEvent.setup();
      const dialog = await open(user);
      const email = within(dialog).getByLabelText("Email");
      await user.clear(email);
      await user.type(email, "new@test.dev");
      await user.selectOptions(within(dialog).getByLabelText("Role"), "admin");
      await user.type(within(dialog).getByLabelText("Reset Password"), "brand-new-pass");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      await waitFor(() =>
        expect(api.updateUser).toHaveBeenCalledWith("user-2", {
          email: "new@test.dev", role: "admin", password: "brand-new-pass",
        }),
      );
    });

    it("shows the server error", async () => {
      api.updateUser.mockRejectedValue({ response: { data: { detail: "Email in use" } } });
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Full Name"), "x");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      expect(await within(dialog).findByText("Email in use")).toBeInTheDocument();
    });

    it("prevents an admin from demoting themselves and syncs their session on save", async () => {
      api.updateUser.mockResolvedValue({ ...me, full_name: "Admin Renamed" });
      const user = userEvent.setup();
      const dialog = await open(user, "Admin User");
      expect(within(dialog).getByLabelText("Role")).toBeDisabled();
      expect(within(dialog).getByText("You can't remove your own admin role.")).toBeInTheDocument();

      const name = within(dialog).getByLabelText("Full Name");
      await user.clear(name);
      await user.type(name, "Admin Renamed");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(useAuthStore.getState().user?.full_name).toBe("Admin Renamed"));
    });

    it("does not touch the session when editing someone else", async () => {
      api.updateUser.mockResolvedValue({ ...bob, full_name: "Someone Else" });
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Full Name"), "!");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(api.updateUser).toHaveBeenCalled());
      expect(useAuthStore.getState().user?.full_name).toBe("Admin User");
    });

    it("cancel closes the drawer", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Edit User" })).toBeNull();
    });
  });

  describe("deleting a user", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithProviders(<UsersPage />);
      const r = await row("Bob Borrower");
      await user.click(within(r).getByRole("button", { name: "Delete user" }));
      return screen.getByRole("dialog", { name: "Delete User" });
    };

    it("requires typing the user's full name before it can be confirmed", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      const confirm = within(dialog).getByRole("button", { name: "Delete user" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText("Bob Borrower"), "Bob");
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText("Bob Borrower"), " Borrower");
      expect(confirm).toBeEnabled();
    });

    it("deletes the user and removes the row", async () => {
      api.deleteUser.mockResolvedValue({});
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByPlaceholderText("Bob Borrower"), "Bob Borrower");
      await user.click(within(dialog).getByRole("button", { name: "Delete user" }));
      await waitFor(() => expect(api.deleteUser).toHaveBeenCalledWith("user-2"));
      await waitFor(() => expect(screen.queryByText("Bob Borrower")).toBeNull());
    });

    it("keeps the user when cancelled", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(api.deleteUser).not.toHaveBeenCalled();
      expect(screen.getByText("Bob Borrower")).toBeInTheDocument();
    });
  });

  describe("expanding a user's loans", () => {
    const expandBtn = () => screen.findByRole("button", { name: "Show loans for Bob Borrower" });

    it("loads and lists the user's accounts with links", async () => {
      api.getUserAccounts.mockResolvedValue([
        makeAccount({ id: "a1", account_name: "Car", borrow_amount: "12000.00", status: "active" }),
        makeAccount({ id: "a2", account_name: "Old", borrow_amount: "50.00", status: "closed" }),
      ]);
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await user.click(await expandBtn());

      const link = await screen.findByRole("link", { name: /Car/ });
      expect(link).toHaveAttribute("href", "/accounts/a1");
      expect(link).toHaveTextContent("$12,000");
      expect(screen.getByText("closed")).toHaveClass("lt-danger-text");
      expect(api.getUserAccounts).toHaveBeenCalledWith("user-2");
    });

    it("says so when the user has no loans", async () => {
      api.getUserAccounts.mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await user.click(await expandBtn());
      expect(await screen.findByText("No loan accounts")).toBeInTheDocument();
    });

    it("shows a loading indicator while fetching", async () => {
      api.getUserAccounts.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await user.click(await expandBtn());
      expect(await screen.findByText("Loading loans…")).toBeInTheDocument();
    });

    it("collapses, and does not refetch on re-expand", async () => {
      api.getUserAccounts.mockResolvedValue([]);
      const user = userEvent.setup();
      renderWithProviders(<UsersPage />);
      await user.click(await expandBtn());
      await screen.findByText("No loan accounts");
      await user.click(await expandBtn());
      expect(screen.queryByText("No loan accounts")).toBeNull();
      await user.click(await expandBtn());
      expect(await screen.findByText("No loan accounts")).toBeInTheDocument();
      expect(api.getUserAccounts).toHaveBeenCalledTimes(1);
    });
  });
});
