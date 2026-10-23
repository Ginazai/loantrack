import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyRequestsPage from "./MyRequestsPage";
import { loanRequestsApi } from "../../api";
import { makeRequest } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  loanRequestsApi: { listMine: vi.fn(), create: vi.fn(), cancel: vi.fn() },
}));
const api = loanRequestsApi as unknown as Record<"listMine" | "create" | "cancel", ReturnType<typeof vi.fn>>;

const pending = makeRequest({ id: "r1", account_name: "Roof", status: "requested", reason: "Leaky roof" });
const review = makeRequest({ id: "r2", account_name: "Car", status: "under_review" });
const approved = makeRequest({
  id: "r3", account_name: "Boat", status: "approved", rate: "0.0500", cycle: 15, reason: "Fun",
  reviewed_at: "2026-03-05T00:00:00Z",
});
const rejected = makeRequest({
  id: "r4", account_name: "Yacht", status: "rejected", rate: "0.0700", cycle: 30, rejection_reason: "Too large",
});

describe("MyRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listMine.mockResolvedValue([]);
    api.cancel.mockResolvedValue({});
  });

  it("shows a loading placeholder", () => {
    api.listMine.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<MyRequestsPage />);
    expect(screen.getByLabelText("Loading requests")).toHaveAttribute("aria-busy", "true");
  });

  it("shows the empty state with a call to action and 3 free slots", async () => {
    renderWithProviders(<MyRequestsPage />);
    expect(await screen.findByText("No requests yet.")).toBeInTheDocument();
    expect(screen.getByText("0 active · 3 slots remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit your first request" })).toBeInTheDocument();
  });

  describe("with requests", () => {
    beforeEach(() => api.listMine.mockResolvedValue([pending, review, approved, rejected]));

    it("lists every request with its status, amount and terms", async () => {
      renderWithProviders(<MyRequestsPage />);
      expect(await screen.findByRole("heading", { name: "Roof" })).toBeInTheDocument();
      expect(screen.getAllByText("Terms set upon approval")).toHaveLength(2);
      expect(screen.getByText("5.00%")).toBeInTheDocument();
      expect(screen.getByText("Bi-monthly")).toBeInTheDocument();
      expect(screen.getByText("7.00%")).toBeInTheDocument();
      expect(screen.getByText("Monthly")).toBeInTheDocument();
    });

    it("reports slots remaining from the active (pending + under review) requests", async () => {
      renderWithProviders(<MyRequestsPage />);
      expect(await screen.findByText("2 active · 1 slot remaining")).toBeInTheDocument();
    });

    it("shows counts in the filter tabs", async () => {
      renderWithProviders(<MyRequestsPage />);
      expect(await screen.findByRole("tab", { name: "All (4)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Pending (1)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Rejected (1)" })).toBeInTheDocument();
    });

    it("filters by status", async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      await user.click(await screen.findByRole("tab", { name: "Approved (1)" }));
      expect(screen.getByRole("heading", { name: "Boat" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Roof" })).toBeNull();
    });

    it("explains an empty filter result without offering a CTA", async () => {
      api.listMine.mockResolvedValue([pending]);
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      await user.click(await screen.findByRole("tab", { name: "Under Review" }));
      expect(screen.getByText("No under review requests.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Submit your first request" })).toBeNull();
    });

    it("cancels an active request", async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      await screen.findByRole("heading", { name: "Roof" });
      const roof = screen.getByRole("heading", { name: "Roof" }).closest("article")!;
      await user.click(within(roof).getByRole("button", { name: "Cancel request" }));
      await waitFor(() => expect(api.cancel).toHaveBeenCalled());
      expect(api.cancel.mock.calls[0][0]).toBe("r1");
    });

    it("does not offer cancel on approved or rejected requests", async () => {
      renderWithProviders(<MyRequestsPage />);
      const boat = (await screen.findByRole("heading", { name: "Boat" })).closest("article")!;
      expect(within(boat).queryByRole("button", { name: "Cancel request" })).toBeNull();
    });

    it("reveals the borrower's reason", async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      const roof = (await screen.findByRole("heading", { name: "Roof" })).closest("article")!;
      await user.click(within(roof).getByRole("button", { name: "Show details" }));
      expect(within(roof).getByText("Your Reason")).toBeInTheDocument();
      expect(within(roof).getByText("Leaky roof")).toBeInTheDocument();
      await user.click(within(roof).getByRole("button", { name: "Hide details" }));
      expect(within(roof).queryByText("Leaky roof")).toBeNull();
    });

    it("reveals the rejection reason", async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      const yacht = (await screen.findByRole("heading", { name: "Yacht" })).closest("article")!;
      await user.click(within(yacht).getByRole("button", { name: "Show details" }));
      expect(within(yacht).getByText("Too large")).toBeInTheDocument();
    });

    it("confirms approval with the review date", async () => {
      const user = userEvent.setup();
      renderWithProviders(<MyRequestsPage />);
      const boat = (await screen.findByRole("heading", { name: "Boat" })).closest("article")!;
      await user.click(within(boat).getByRole("button", { name: "Show details" }));
      expect(within(boat).getByText(/Approved on Mar 5, 2026 · Loan account created/)).toBeInTheDocument();
    });
  });

  it("blocks new requests once 3 are active and says why", async () => {
    api.listMine.mockResolvedValue([
      makeRequest({ id: "a" }), makeRequest({ id: "b" }), makeRequest({ id: "c", status: "under_review" }),
    ]);
    renderWithProviders(<MyRequestsPage />);
    expect(await screen.findByText(/You have 3\/3 active requests/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New request" })).toBeDisabled();
    expect(screen.getByText("3 active · 0 slots remaining")).toBeInTheDocument();
  });

  it("renders an unknown status with the raw value", async () => {
    api.listMine.mockResolvedValue([makeRequest({ status: "mystery" as never })]);
    renderWithProviders(<MyRequestsPage />);
    expect(await screen.findByText("mystery")).toBeInTheDocument();
  });

  describe("new request drawer", () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithProviders(<MyRequestsPage />);
      await user.click(await screen.findByRole("button", { name: "New request" }));
      return screen.getByRole("dialog", { name: "New Loan Request" });
    };

    it("requires a name and amount", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Submit request" }));
      expect(await within(dialog).findByText("Fill all required fields")).toBeInTheDocument();
      expect(api.create).not.toHaveBeenCalled();
    });

    it("submits the request, closes, and refreshes the list", async () => {
      api.create.mockResolvedValue(makeRequest());
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Loan Name / Purpose"), "Roof");
      await user.type(within(dialog).getByLabelText("Amount (USD)"), "2500");
      await user.type(within(dialog).getByLabelText("Reason (optional)"), "Leak");
      await user.click(within(dialog).getByRole("button", { name: "Submit request" }));

      await waitFor(() =>
        expect(api.create).toHaveBeenCalledWith({ account_name: "Roof", borrow_amount: 2500, reason: "Leak" }),
      );
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Loan Request" })).toBeNull());
      expect(api.listMine).toHaveBeenCalledTimes(2);
    });

    it("shows the server error and stays open on failure", async () => {
      api.create.mockRejectedValue({ response: { data: { detail: "Limit reached" } } });
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.type(within(dialog).getByLabelText("Loan Name / Purpose"), "Roof");
      await user.type(within(dialog).getByLabelText("Amount (USD)"), "10");
      await user.click(within(dialog).getByRole("button", { name: "Submit request" }));
      expect(await within(dialog).findByText("Limit reached")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "New Loan Request" })).toBeInTheDocument();
    });

    it("Cancel closes without submitting", async () => {
      const user = userEvent.setup();
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "New Loan Request" })).toBeNull();
      expect(api.create).not.toHaveBeenCalled();
    });

    it("can be opened from the empty-state button", async () => {
      renderWithProviders(<MyRequestsPage />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Submit your first request" }));
      expect(screen.getByRole("dialog", { name: "New Loan Request" })).toBeInTheDocument();
    });
  });
});
