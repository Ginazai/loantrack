import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardPage } from "./DashboardPage";
import { accountsApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { makeAccount, makeAdmin } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({ accountsApi: { list: vi.fn() } }));
const list = accountsApi.list as unknown as ReturnType<typeof vi.fn>;

const OVERDUE = "2020-01-15";
const FUTURE = "2999-01-15";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "t", user: makeAdmin({ full_name: "Ada Lovelace" }) });
  });

  it("greets the admin by first name", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("heading", { name: "Ada's Ledger" })).toBeInTheDocument();
  });

  it("shows loading placeholders until accounts arrive", async () => {
    list.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<DashboardPage />);
    expect(screen.getByLabelText("Loading summary")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByLabelText("Portfolio summary")).toBeNull();
  });

  describe("with accounts", () => {
    beforeEach(() => {
      list.mockResolvedValue([
        makeAccount({ id: "a1", account_name: "Overdue Loan", borrow_amount: "1000.00", current_balance: "500.00", next_due_date: OVERDUE, status: "active" }),
        makeAccount({ id: "a2", account_name: "Fresh Loan", borrow_amount: "2000.00", current_balance: null, next_due_date: FUTURE, status: "open" }),
        makeAccount({ id: "a3", account_name: "Old Loan", borrow_amount: "300.00", status: "closed", next_due_date: null }),
      ]);
    });

    it("summarises active loans, outstanding balance, overdue count and totals", async () => {
      renderWithProviders(<DashboardPage />);
      const summary = await screen.findByLabelText("Portfolio summary");
      const s = within(summary);
      // Active (active+open) = 2, of which 1 is "open"
      expect(s.getByText("Active Loans").parentElement!.parentElement).toHaveTextContent("21 open");
      // Outstanding: 500 (balance) + 2000 (no balance → principal); of 3,000 principal
      expect(s.getByText("$2,500.00")).toBeInTheDocument();
      expect(s.getByText("of $3,000.00")).toBeInTheDocument();
      expect(s.getByText("Needs attention")).toBeInTheDocument();
      expect(s.getByText("1 closed")).toBeInTheDocument();
    });

    it("lists overdue accounts with a link to each", async () => {
      renderWithProviders(<DashboardPage />);
      const panel = (await screen.findByRole("heading", { name: "Overdue Payments" })).closest("section")!;
      const link = within(panel).getByRole("link", { name: /Overdue Loan/ });
      expect(link).toHaveAttribute("href", "/accounts/a1");
      expect(within(panel).getByText("$500.00")).toBeInTheDocument();
      expect(within(panel).getByText("Due Jan 15, 2020")).toBeInTheDocument();
      expect(within(panel).queryByText("Fresh Loan")).toBeNull();
    });

    it("shows recent accounts in the table", async () => {
      renderWithProviders(<DashboardPage />);
      const table = await screen.findByRole("table", { name: "Recent accounts" });
      expect(within(table).getByText("Fresh Loan")).toBeInTheDocument();
      expect(within(table).getByText("Old Loan")).toBeInTheDocument();
    });

    it("'View all' navigates to the accounts page", async () => {
      renderWithProviders(<DashboardPage />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "View all" }));
      expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
    });
  });

  it("omits the overdue panel and says everything is current when nothing is late", async () => {
    list.mockResolvedValue([makeAccount({ next_due_date: FUTURE })]);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("All current")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Overdue Payments" })).toBeNull();
  });

  it("limits the recent list to 8 accounts", async () => {
    list.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => makeAccount({ id: `a${i}`, account_name: `Loan ${i}` })),
    );
    renderWithProviders(<DashboardPage />);
    const table = await screen.findByRole("table", { name: "Recent accounts" });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 8); // header + 8
  });

  it("offers to create the first account when there are none", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create your first account" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
  });
});
