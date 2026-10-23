import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPage } from "./AccountsPage";
import { accountsApi, adminApi } from "../../api";
import { makeAccount } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  accountsApi: { list: vi.fn(), create: vi.fn() },
  adminApi: { exportAccountsCsv: vi.fn(), exportPaymentsCsv: vi.fn() },
}));

// AccountForm has its own tests; stub it so these tests cover the page's wiring.
vi.mock("./AccountForm", () => ({
  AccountForm: ({ onSubmit, onCancel }: { onSubmit: (d: unknown) => Promise<void>; onCancel: () => void }) => (
    <div>
      <button onClick={() => onSubmit({ account_name: "Stub" }).catch(() => {})}>stub-submit</button>
      <button onClick={onCancel}>stub-cancel</button>
    </div>
  ),
}));

const list = accountsApi.list as unknown as ReturnType<typeof vi.fn>;
const create = accountsApi.create as unknown as ReturnType<typeof vi.fn>;
const filters = () => within(screen.getByRole("group", { name: "Filter by status" }));
const lastListArgs = () => list.mock.calls[list.mock.calls.length - 1][0];

describe("AccountsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([
      makeAccount({ id: "a1", account_name: "Alpha" }),
      makeAccount({ id: "a2", account_name: "Beta" }),
    ]);
  });

  it("lists accounts and reports how many were found", async () => {
    renderWithProviders(<AccountsPage />);
    expect(await screen.findByText("2 accounts found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alpha" })).toBeInTheDocument();
    expect(lastListArgs()).toEqual({ status: undefined, search: undefined });
  });

  it("uses the singular for exactly one account", async () => {
    list.mockResolvedValue([makeAccount()]);
    renderWithProviders(<AccountsPage />);
    expect(await screen.findByText("1 account found")).toBeInTheDocument();
  });

  it("announces loading", () => {
    list.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<AccountsPage />);
    expect(screen.getByText("Loading accounts…")).toBeInTheDocument();
  });

  it("filters by one or more statuses and resets with 'All'", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await screen.findByText("2 accounts found");

    await user.click(filters().getByText("Open"));
    await waitFor(() => expect(lastListArgs().status).toEqual(["open"]));
    await user.click(filters().getByText("Paid"));
    await waitFor(() => expect(lastListArgs().status).toEqual(["open", "paid"]));
    await user.click(filters().getByText("Open")); // toggle off
    await waitFor(() => expect(lastListArgs().status).toEqual(["paid"]));
    await user.click(filters().getByText("All"));
    await waitFor(() => expect(lastListArgs().status).toBeUndefined());
  });

  it("searches by text", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await screen.findByText("2 accounts found");
    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "bob");
    await waitFor(() => expect(lastListArgs().search).toBe("bob"));
  });

  it("clears the search with the clear button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    await screen.findByText("2 accounts found");
    await user.type(screen.getByRole("searchbox", { name: "Search accounts" }), "bob");
    await user.click(screen.getByRole("button", { name: /clear search/i }));
    await waitFor(() => expect(lastListArgs().search).toBeUndefined());
  });

  it("offers 'Clear filters' when a filter matches nothing", async () => {
    const user = userEvent.setup();
    list.mockResolvedValueOnce([makeAccount()]).mockResolvedValue([]);
    renderWithProviders(<AccountsPage />);
    await screen.findByText("1 account found");
    await user.click(filters().getByText("Closed"));
    expect(await screen.findByText("No matching accounts")).toBeInTheDocument();

    list.mockResolvedValue([makeAccount()]);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastListArgs()).toEqual({ status: undefined, search: undefined }));
    expect(await screen.findByText("1 account found")).toBeInTheDocument();
  });

  it("shows a first-run empty state that opens the create drawer", async () => {
    list.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<AccountsPage />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    const emptyState = screen.getByText("No accounts yet").closest("div")!.parentElement!;
    await user.click(within(emptyState).getByRole("button", { name: "New account" }));
    expect(screen.getByRole("dialog", { name: "New Loan Account" })).toBeInTheDocument();
  });

  describe("creating an account", () => {
    it("submits through the API, closes the drawer and refreshes the list", async () => {
      create.mockResolvedValue(makeAccount());
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await screen.findByText("2 accounts found");
      await user.click(screen.getByRole("button", { name: "New account" }));
      await user.click(screen.getByRole("button", { name: "stub-submit" }));

      await waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls[0][0]).toEqual({ account_name: "Stub" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Loan Account" })).toBeNull());
      expect(list.mock.calls.length).toBeGreaterThan(1);
    });

    it("keeps the drawer open and shows the server error on failure", async () => {
      create.mockRejectedValue({ response: { data: { detail: "Duplicate name" } } });
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await screen.findByText("2 accounts found");
      await user.click(screen.getByRole("button", { name: "New account" }));
      await user.click(screen.getByRole("button", { name: "stub-submit" }));

      expect(await screen.findByText("Couldn’t create account")).toBeInTheDocument();
      expect(screen.getByText("Duplicate name")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "New Loan Account" })).toBeInTheDocument();
    });

    it("cancel closes the drawer", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await screen.findByText("2 accounts found");
      await user.click(screen.getByRole("button", { name: "New account" }));
      await user.click(screen.getByRole("button", { name: "stub-cancel" }));
      expect(screen.queryByRole("dialog", { name: "New Loan Account" })).toBeNull();
    });
  });

  describe("export menu", () => {
    it("exports accounts", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await user.click(await screen.findByRole("button", { name: "Export" }));
      await user.click(await screen.findByRole("menuitem", { name: "Accounts only (.csv)" }));
      expect(adminApi.exportAccountsCsv).toHaveBeenCalledTimes(1);
    });

    it("exports payments", async () => {
      const user = userEvent.setup();
      renderWithProviders(<AccountsPage />);
      await user.click(await screen.findByRole("button", { name: "Export" }));
      await user.click(await screen.findByRole("menuitem", { name: "All payments (.csv)" }));
      expect(adminApi.exportPaymentsCsv).toHaveBeenCalledTimes(1);
    });
  });
});
