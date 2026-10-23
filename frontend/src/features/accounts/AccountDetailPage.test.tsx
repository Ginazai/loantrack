import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AccountDetailPage } from "./AccountDetailPage";
import { accountsApi, adminApi, paymentsApi, webhooksApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { makeAccount, makeAdmin, makePayment, makeUser, makeWebhook } from "../../test/factories";
import { LocationDisplay } from "../../test/utils";

vi.mock("../../api", () => ({
  accountsApi: { get: vi.fn(), update: vi.fn(), close: vi.fn(), purge: vi.fn() },
  paymentsApi: { list: vi.fn(), add: vi.fn(), delete: vi.fn() },
  webhooksApi: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
  adminApi: { exportAccountFullCsv: vi.fn() },
}));

// Child forms / charts / attachments have their own tests; stub them to test this page's wiring.
vi.mock("./Charts", () => ({
  BalanceChart: () => <div data-testid="balance-chart" />,
  InterestChart: () => <div data-testid="interest-chart" />,
}));
vi.mock("./AccountForm", () => ({
  AccountForm: ({ onSubmit, onCancel }: any) => (
    <div>
      <button onClick={() => onSubmit({ account_name: "Renamed" }).catch(() => {})}>submit-account</button>
      <button onClick={onCancel}>cancel-account</button>
    </div>
  ),
}));
vi.mock("../payments/PaymentForm", () => ({
  PaymentForm: ({ onSubmit, onCancel }: any) => (
    <div>
      <button onClick={() => onSubmit({ amount: 100, method: "manual" }).catch(() => {})}>submit-payment</button>
      <button onClick={onCancel}>cancel-payment</button>
    </div>
  ),
}));
vi.mock("../webhooks/WebhookForm", () => ({
  WebhookForm: ({ onSubmit, onCancel }: any) => (
    <div>
      <button onClick={() => onSubmit({ target_url: "https://x.y", events: ["payment.added"] }).catch(() => {})}>submit-webhook</button>
      <button onClick={onCancel}>cancel-webhook</button>
    </div>
  ),
}));
vi.mock("../payments/PaymentAttachments", () => ({
  PaymentAttachmentsModal: ({ paymentId, isAdmin, onClose }: any) => (
    <div data-testid="attachments">
      {paymentId}|{String(isAdmin)}
      <button onClick={onClose}>close-attachments</button>
    </div>
  ),
}));

const accounts = accountsApi as unknown as Record<"get" | "update" | "close" | "purge", ReturnType<typeof vi.fn>>;
const payments = paymentsApi as unknown as Record<"list" | "add" | "delete", ReturnType<typeof vi.fn>>;
const webhooks = webhooksApi as unknown as Record<"list" | "create" | "delete", ReturnType<typeof vi.fn>>;
const exportFull = adminApi.exportAccountFullCsv as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/accounts/acc-1"]}>
        <Routes>
          <Route path="/accounts" element={<div>accounts list page</div>} />
          <Route path="/accounts/:id" element={<AccountDetailPage />} />
        </Routes>
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const ready = () => screen.findByRole("heading", { name: "Home Loan" });
const goTab = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(await screen.findByRole("tab", { name }));

const p1 = makePayment({ id: "p1", amount: "200.00", balance_before: "1000.00", interests_accrued: "25.00", balance_after: "825.00", payment_date: "2026-02-01", next_due_date: "2026-02-15", method: "manual", attachment_count: 2 });
const p2 = makePayment({ id: "p2", amount: "100.00", balance_before: "825.00", interests_accrued: "10.00", balance_after: "735.00", payment_date: "2026-03-01", next_due_date: null, method: "auto", attachment_count: 0 });

describe("AccountDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "t", user: makeAdmin() });
    accounts.get.mockResolvedValue(makeAccount());
    payments.list.mockResolvedValue([]);
    webhooks.list.mockResolvedValue([]);
  });

  it("shows a loading skeleton until the account arrives", () => {
    accounts.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByLabelText("Loading account")).toHaveAttribute("aria-busy", "true");
  });

  describe("header and summary", () => {
    it("shows the name, status, borrower and breadcrumb", async () => {
      renderPage();
      await ready();
      expect(screen.getByText("Borrower: Regular User · Started Jan 1, 2026")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute("href", "/accounts");
    });

    it("shows principal, rate and the account's balance when there are no payments", async () => {
      renderPage();
      await ready();
      const kpis = within(screen.getByLabelText("Account summary"));
      expect(kpis.getByText("$1,000.00")).toBeInTheDocument();
      expect(kpis.getByText("$500.00")).toBeInTheDocument();
      expect(kpis.getByText("5.00%")).toBeInTheDocument();
    });

    it("falls back to the principal when no balance has been recorded", async () => {
      accounts.get.mockResolvedValue(makeAccount({ current_balance: null }));
      renderPage();
      await ready();
      const kpis = within(screen.getByLabelText("Account summary"));
      expect(kpis.getAllByText("$1,000.00")).toHaveLength(2); // principal + balance
    });

    it("prefers the latest payment's balance_after over the stored balance", async () => {
      payments.list.mockResolvedValue([p1, p2]);
      renderPage();
      await ready();
      await waitFor(() => expect(within(screen.getByLabelText("Account summary")).getByText("$735.00")).toBeInTheDocument());
      expect(screen.getByText("26.5% paid off")).toBeInTheDocument();
    });

    it("flags an overdue due date", async () => {
      accounts.get.mockResolvedValue(makeAccount({ next_due_date: "2020-01-15" }));
      renderPage();
      await ready();
      expect(screen.getByText("Jan 15, 2020")).toBeInTheDocument();
      expect(screen.getByText("Overdue")).toBeInTheDocument();
    });

    it("shows a dash when there is no due date", async () => {
      accounts.get.mockResolvedValue(makeAccount({ next_due_date: null }));
      renderPage();
      await ready();
      expect(within(screen.getByLabelText("Account summary")).getByText("—")).toBeInTheDocument();
      expect(screen.queryByText("Overdue")).toBeNull();
    });
  });

  describe("actions available per status", () => {
    const actions = () => ({
      record: screen.queryByRole("button", { name: "Record payment" }),
      edit: screen.queryByRole("button", { name: "Edit" }),
      close: screen.queryByRole("button", { name: "Close" }),
      purge: screen.queryByRole("button", { name: "Purge" }),
    });

    it.each(["open", "active"] as const)("a %s account can take payments and be closed", async (status) => {
      accounts.get.mockResolvedValue(makeAccount({ status }));
      renderPage();
      await ready();
      const a = actions();
      expect(a.record).not.toBeNull();
      expect(a.edit).not.toBeNull();
      expect(a.close).not.toBeNull();
      expect(a.purge).toBeNull();
    });

    it("a paid account can only be edited", async () => {
      accounts.get.mockResolvedValue(makeAccount({ status: "paid" }));
      renderPage();
      await ready();
      const a = actions();
      expect(a.record).toBeNull();
      expect(a.close).toBeNull();
      expect(a.purge).toBeNull();
      expect(a.edit).not.toBeNull();
    });

    it("a closed account can be purged but not paid or closed again", async () => {
      accounts.get.mockResolvedValue(makeAccount({ status: "closed" }));
      renderPage();
      await ready();
      const a = actions();
      expect(a.purge).not.toBeNull();
      expect(a.record).toBeNull();
      expect(a.close).toBeNull();
    });
  });

  describe("overview tab", () => {
    it("explains that charts need a first payment", async () => {
      renderPage();
      await ready();
      expect(screen.getByText("No payment history yet")).toBeInTheDocument();
      expect(screen.queryByTestId("balance-chart")).toBeNull();
    });

    it("shows both charts once there are payments", async () => {
      payments.list.mockResolvedValue([p1]);
      renderPage();
      expect(await screen.findByTestId("balance-chart")).toBeInTheDocument();
      expect(screen.getByTestId("interest-chart")).toBeInTheDocument();
    });
  });

  describe("payments tab", () => {
    it("shows an empty ledger with a record-payment button for open accounts", async () => {
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Payments");
      expect(screen.getByText("No payments recorded yet.")).toBeInTheDocument();
      const panel = screen.getByRole("heading", { name: "Payment Ledger" }).closest(".lt-panel")!;
      expect(within(panel as HTMLElement).getByRole("button", { name: "Record payment" })).toBeInTheDocument();
    });

    it("omits the ledger's record button on a closed account", async () => {
      accounts.get.mockResolvedValue(makeAccount({ status: "closed" }));
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Payments");
      expect(screen.queryByRole("button", { name: "Record payment" })).toBeNull();
    });

    it("lists each payment split into interest, payment and balances", async () => {
      payments.list.mockResolvedValue([p1, p2]);
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Payments");
      const table = await screen.findByRole("table", { name: "Payment ledger" });
      const rows = within(table).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(within(rows[0]).getByText("+$25.00")).toBeInTheDocument();
      expect(within(rows[0]).getByText("−$200.00")).toBeInTheDocument();
      expect(within(rows[0]).getByText("$825.00")).toBeInTheDocument();
      expect(within(rows[0]).getByText("manual")).toBeInTheDocument();
      expect(within(rows[0]).getByText("Feb 15, 2026")).toBeInTheDocument();
      expect(within(rows[1]).getByText("auto")).toBeInTheDocument();
      expect(within(rows[1]).getByText("—")).toBeInTheDocument(); // no next due
    });

    it("shows the receipt count only when there are receipts", async () => {
      payments.list.mockResolvedValue([p1, p2]);
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Payments");
      expect(await screen.findByLabelText("2 attachments")).toHaveTextContent("2");
      expect(screen.queryByLabelText("0 attachments")).toBeNull();
    });

    it("opens and closes the receipts drawer for a payment", async () => {
      payments.list.mockResolvedValue([p1]);
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Payments");
      await user.click(await screen.findByRole("button", { name: "Comprobantes" }));
      expect(screen.getByTestId("attachments")).toHaveTextContent("p1|true");
      await user.click(screen.getByRole("button", { name: "close-attachments" }));
      expect(screen.queryByTestId("attachments")).toBeNull();
    });

    describe("as an admin", () => {
      it("exports the account with payments", async () => {
        payments.list.mockResolvedValue([p1]);
        const user = userEvent.setup();
        renderPage();
        await goTab(user, "Payments");
        await user.click(await screen.findByRole("button", { name: "Export with payments (.csv)" }));
        expect(exportFull).toHaveBeenCalledWith("acc-1");
      });

      it("deletes a payment after confirming", async () => {
        payments.list.mockResolvedValue([p1]);
        payments.delete.mockResolvedValue({});
        const user = userEvent.setup();
        renderPage();
        await goTab(user, "Payments");
        await user.click(await screen.findByRole("button", { name: "Delete payment" }));
        const dialog = screen.getByRole("dialog", { name: "Delete Payment" });
        await user.click(within(dialog).getByRole("button", { name: "Delete payment" }));
        await waitFor(() => expect(payments.delete).toHaveBeenCalled());
        expect(payments.delete.mock.calls[0].slice(0, 2)).toEqual(["acc-1", "p1"]);
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Delete Payment" })).toBeNull());
      });

      it("keeps the payment when the confirmation is cancelled", async () => {
        payments.list.mockResolvedValue([p1]);
        const user = userEvent.setup();
        renderPage();
        await goTab(user, "Payments");
        await user.click(await screen.findByRole("button", { name: "Delete payment" }));
        await user.click(within(screen.getByRole("dialog", { name: "Delete Payment" })).getByRole("button", { name: "Cancel" }));
        expect(payments.delete).not.toHaveBeenCalled();
      });
    });

    describe("as a borrower", () => {
      beforeEach(() => useAuthStore.setState({ user: makeUser() }));

      it("hides delete and export", async () => {
        payments.list.mockResolvedValue([p1]);
        const user = userEvent.setup();
        renderPage();
        await goTab(user, "Payments");
        await screen.findByRole("table", { name: "Payment ledger" });
        expect(screen.queryByRole("button", { name: "Delete payment" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Export with payments (.csv)" })).toBeNull();
      });

      it("tells the receipts drawer the user is not an admin", async () => {
        payments.list.mockResolvedValue([p1]);
        const user = userEvent.setup();
        renderPage();
        await goTab(user, "Payments");
        await user.click(await screen.findByRole("button", { name: "Comprobantes" }));
        expect(screen.getByTestId("attachments")).toHaveTextContent("p1|false");
      });
    });
  });

  describe("recording a payment", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderPage();
      await ready();
      await user.click(screen.getAllByRole("button", { name: "Record payment" })[0]);
      return screen.getByRole("dialog", { name: "Record Payment" });
    };

    it("submits, closes the drawer and reloads the account and payments", async () => {
      payments.add.mockResolvedValue(p1);
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "submit-payment" }));
      await waitFor(() => expect(payments.add).toHaveBeenCalled());
      expect(payments.add.mock.calls[0].slice(0, 2)).toEqual(["acc-1", { amount: 100, method: "manual" }]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record Payment" })).toBeNull());
      await waitFor(() => expect(accounts.get.mock.calls.length).toBeGreaterThan(1));
      expect(payments.list.mock.calls.length).toBeGreaterThan(1);
    });

    it("shows the server error and keeps the drawer open", async () => {
      payments.add.mockRejectedValue({ response: { data: { detail: "Payment exceeds balance" } } });
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "submit-payment" }));
      expect(await within(dialog).findByText("Couldn’t record payment")).toBeInTheDocument();
      expect(within(dialog).getByText("Payment exceeds balance")).toBeInTheDocument();
    });

    it("cancel closes the drawer", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "cancel-payment" }));
      expect(screen.queryByRole("dialog", { name: "Record Payment" })).toBeNull();
    });
  });

  describe("editing", () => {
    it("updates the account and closes the drawer", async () => {
      accounts.update.mockResolvedValue(makeAccount());
      const user = userEvent.setup();
      renderPage();
      await ready();
      await user.click(screen.getByRole("button", { name: "Edit" }));
      await user.click(within(screen.getByRole("dialog", { name: "Edit Account" })).getByRole("button", { name: "submit-account" }));
      await waitFor(() => expect(accounts.update).toHaveBeenCalled());
      expect(accounts.update.mock.calls[0].slice(0, 2)).toEqual(["acc-1", { account_name: "Renamed" }]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit Account" })).toBeNull());
    });

    it("cancel closes the drawer without saving", async () => {
      const user = userEvent.setup();
      renderPage();
      await ready();
      await user.click(screen.getByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "cancel-account" }));
      expect(screen.queryByRole("dialog", { name: "Edit Account" })).toBeNull();
      expect(accounts.update).not.toHaveBeenCalled();
    });
  });

  describe("closing an account", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderPage();
      await ready();
      await user.click(screen.getByRole("button", { name: "Close" }));
      return screen.getByRole("dialog", { name: "Close Account" });
    };

    it("closes with the typed reason", async () => {
      accounts.close.mockResolvedValue(makeAccount({ status: "closed" }));
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Reason for closing (optional)"), "Settled early");
      await user.click(within(dialog).getByRole("button", { name: "Close account" }));
      await waitFor(() => expect(accounts.close).toHaveBeenCalledWith("acc-1", "Settled early"));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Close Account" })).toBeNull());
    });

    it("closes with no reason when the box is left empty", async () => {
      accounts.close.mockResolvedValue(makeAccount({ status: "closed" }));
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Close account" }));
      await waitFor(() => expect(accounts.close).toHaveBeenCalledWith("acc-1", undefined));
    });

    it("cancel dismisses the dialog", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Close Account" })).toBeNull();
      expect(accounts.close).not.toHaveBeenCalled();
    });
  });

  describe("purging a closed account", () => {
    beforeEach(() => accounts.get.mockResolvedValue(makeAccount({ status: "closed" })));
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderPage();
      await ready();
      await user.click(screen.getByRole("button", { name: "Purge" }));
      return screen.getByRole("dialog", { name: "Permanently Delete Account" });
    };

    it("requires typing the account name, then deletes (forced, for admins) and returns to the list", async () => {
      accounts.purge.mockResolvedValue({});
      const user = userEvent.setup();
      const dialog = await open(user);
      const confirm = within(dialog).getByRole("button", { name: "Delete forever" });
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByPlaceholderText("Home Loan"), "Home Loan");
      await user.click(confirm);
      await waitFor(() => expect(accounts.purge).toHaveBeenCalledWith("acc-1", true));
      expect(await screen.findByText("accounts list page")).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent("/accounts");
    });

    it("does not force the delete for a non-admin", async () => {
      useAuthStore.setState({ user: makeUser() });
      accounts.purge.mockResolvedValue({});
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByPlaceholderText("Home Loan"), "Home Loan");
      await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));
      await waitFor(() => expect(accounts.purge).toHaveBeenCalledWith("acc-1", false));
    });

    it("cancel keeps the account", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(accounts.purge).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Permanently Delete Account" })).toBeNull();
    });
  });

  describe("webhooks tab", () => {
    it("does not load webhooks until the tab is opened", async () => {
      renderPage();
      await ready();
      expect(webhooks.list).not.toHaveBeenCalled();
    });

    it("shows an empty state", async () => {
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Webhooks");
      expect(await screen.findByText("No webhooks configured.")).toBeInTheDocument();
      expect(webhooks.list).toHaveBeenCalledWith("acc-1");
    });

    it("lists webhooks with events and state", async () => {
      webhooks.list.mockResolvedValue([
        makeWebhook({ id: "w1", target_url: "https://a.example", events: ["payment.added", "status.changed"] }),
        makeWebhook({ id: "w2", target_url: "https://b.example", is_active: false }),
      ]);
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Webhooks");
      expect(await screen.findByText("https://a.example")).toBeInTheDocument();
      expect(screen.getByText("status.changed")).toBeInTheDocument();
      expect(screen.getByText("active")).toBeInTheDocument();
      expect(screen.getByText("inactive")).toBeInTheDocument();
    });

    it("deletes a webhook", async () => {
      webhooks.list.mockResolvedValue([makeWebhook({ id: "w1" })]);
      webhooks.delete.mockResolvedValue({});
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Webhooks");
      await user.click(await screen.findByRole("button", { name: "Delete webhook" }));
      await waitFor(() => expect(webhooks.delete).toHaveBeenCalled());
      expect(webhooks.delete.mock.calls[0].slice(0, 2)).toEqual(["acc-1", "w1"]);
    });

    it("adds a webhook through the drawer", async () => {
      webhooks.create.mockResolvedValue(makeWebhook());
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Webhooks");
      await user.click(await screen.findByRole("button", { name: "Add webhook" }));
      await user.click(within(screen.getByRole("dialog", { name: "Add Webhook" })).getByRole("button", { name: "submit-webhook" }));
      await waitFor(() => expect(webhooks.create).toHaveBeenCalled());
      expect(webhooks.create.mock.calls[0].slice(0, 2)).toEqual(["acc-1", { target_url: "https://x.y", events: ["payment.added"] }]);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add Webhook" })).toBeNull());
    });

    it("cancel closes the webhook drawer", async () => {
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Webhooks");
      await user.click(await screen.findByRole("button", { name: "Add webhook" }));
      await user.click(screen.getByRole("button", { name: "cancel-webhook" }));
      expect(screen.queryByRole("dialog", { name: "Add Webhook" })).toBeNull();
    });
  });

  describe("settings tab", () => {
    it("shows identifiers and a bi-monthly cycle", async () => {
      accounts.get.mockResolvedValue(makeAccount({ cycle: 15, close_reason: null }));
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Settings");
      const settings = within(await screen.findByRole("region", { name: "Account Settings" }));
      expect(settings.getByText("acc-1")).toBeInTheDocument();
      expect(settings.getByText("Bi-monthly (15th & 30th)")).toBeInTheDocument();
      expect(settings.getByText("Jan 2, 2026")).toBeInTheDocument();
      expect(settings.getByText("—")).toBeInTheDocument();
    });

    it("shows a monthly cycle and the close reason", async () => {
      accounts.get.mockResolvedValue(makeAccount({ cycle: 30, status: "closed", close_reason: "Settled early" }));
      const user = userEvent.setup();
      renderPage();
      await goTab(user, "Settings");
      const settings = within(await screen.findByRole("region", { name: "Account Settings" }));
      expect(settings.getByText("Monthly (30th)")).toBeInTheDocument();
      expect(settings.getByText("Settled early")).toBeInTheDocument();
    });
  });
});
