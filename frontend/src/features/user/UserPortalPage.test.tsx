import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserPortalPage from "./UserPortalPage";
import { accountsApi, paymentsApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { makeAccount, makePayment, makeUser } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  accountsApi: { list: vi.fn() },
  paymentsApi: { list: vi.fn() },
}));
vi.mock("../accounts/Charts", () => ({
  BalanceChart: () => <div data-testid="balance-chart" />,
}));

const list = accountsApi.list as unknown as ReturnType<typeof vi.fn>;
const payments = paymentsApi.list as unknown as ReturnType<typeof vi.fn>;

describe("UserPortalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "t", user: makeUser({ full_name: "Grace Hopper" }) });
    payments.mockResolvedValue([]);
  });

  it("titles the page with the borrower's first name", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<UserPortalPage />);
    expect(await screen.findByRole("heading", { name: "Grace's Loans" })).toBeInTheDocument();
  });

  it("shows a loading placeholder and no summary while loading", () => {
    list.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<UserPortalPage />);
    expect(screen.getByLabelText("Loading loans")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByLabelText("Loan summary")).toBeNull();
  });

  it("explains how to get started when there are no loans", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<UserPortalPage />);
    expect(await screen.findByText("No loans yet.")).toBeInTheDocument();
    expect(screen.getByText("Submit a loan request to get started.")).toBeInTheDocument();
  });

  describe("with loans", () => {
    beforeEach(() => {
      list.mockResolvedValue([
        makeAccount({ id: "a1", account_name: "Car", borrow_amount: "1000.00", current_balance: "400.00", next_due_date: "2999-03-01", status: "active" }),
        makeAccount({ id: "a2", account_name: "Boat", borrow_amount: "2000.00", current_balance: null, next_due_date: "2999-02-01", status: "open" }),
        makeAccount({ id: "a3", account_name: "Bike", borrow_amount: "100.00", current_balance: "0.00", next_due_date: null, status: "paid" }),
      ]);
    });

    it("summarises balance, active loans and the earliest due date for open loans only", async () => {
      renderWithProviders(<UserPortalPage />);
      const summary = within(await screen.findByLabelText("Loan summary"));
      expect(summary.getByText("$2,400.00")).toBeInTheDocument(); // 400 + 2000
      expect(summary.getByText("Active Loans").closest("div")!.parentElement).toHaveTextContent("2");
      expect(summary.getByText("Feb 1, 2999")).toBeInTheDocument();
    });

    it("separates open loans from closed/paid ones", async () => {
      renderWithProviders(<UserPortalPage />);
      expect(await screen.findByRole("heading", { name: "Closed / Paid" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Car" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Bike" })).toBeInTheDocument();
    });

    it("computes paid-off progress from principal and balance", async () => {
      renderWithProviders(<UserPortalPage />);
      await screen.findByRole("heading", { name: "Car" });
      expect(screen.getByText("60.0%")).toBeInTheDocument(); // (1000-400)/1000
      expect(screen.getByText("0.0%")).toBeInTheDocument(); // Boat: no payments yet
      expect(screen.getByText("100.0%")).toBeInTheDocument(); // Bike: fully paid
    });

    it("does not fetch payments until a loan is expanded", async () => {
      renderWithProviders(<UserPortalPage />);
      await screen.findByRole("heading", { name: "Car" });
      expect(payments).not.toHaveBeenCalled();
    });

    it("expands to an empty history message, then collapses", async () => {
      const user = userEvent.setup();
      renderWithProviders(<UserPortalPage />);
      await screen.findByRole("heading", { name: "Car" });
      await user.click(screen.getAllByRole("button", { name: "Show details" })[0]);
      expect(await screen.findByText("No payments yet.")).toBeInTheDocument();
      expect(payments).toHaveBeenCalledWith("a1");
      expect(screen.queryByTestId("balance-chart")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Hide details" }));
      expect(screen.queryByText("No payments yet.")).toBeNull();
    });

    it("expands to a chart and the payment ledger, newest first", async () => {
      payments.mockResolvedValue([
        makePayment({ id: "p1", amount: "100.00", payment_date: "2026-01-10", balance_after: "900.00", interests_accrued: "5.00" }),
        makePayment({ id: "p2", amount: "200.00", payment_date: "2026-02-10", balance_after: "700.00", interests_accrued: "4.00" }),
      ]);
      const user = userEvent.setup();
      renderWithProviders(<UserPortalPage />);
      await screen.findByRole("heading", { name: "Car" });
      await user.click(screen.getAllByRole("button", { name: "Show details" })[0]);

      expect(await screen.findByTestId("balance-chart")).toBeInTheDocument();
      const amounts = screen.getAllByText(/^\+\$/).map((n) => n.textContent);
      expect(amounts).toEqual(["+$200.00", "+$100.00"]);
      expect(screen.getByText("$700.00")).toBeInTheDocument();
    });
  });

  it("flags an overdue loan", async () => {
    list.mockResolvedValue([makeAccount({ next_due_date: "2020-01-01" })]);
    renderWithProviders(<UserPortalPage />);
    expect(await screen.findByText("Overdue")).toBeInTheDocument();
  });

  it("shows a dash for next due when no open loan has a due date", async () => {
    list.mockResolvedValue([makeAccount({ next_due_date: null })]);
    renderWithProviders(<UserPortalPage />);
    const summary = within(await screen.findByLabelText("Loan summary"));
    expect(summary.getByText("—")).toBeInTheDocument();
  });
});
