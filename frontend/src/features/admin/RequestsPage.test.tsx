import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestsPage from "./RequestsPage";
import { adminApi, loanRequestsApi } from "../../api";
import { makeRequest } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

vi.mock("../../api", () => ({
  adminApi: { deleteRequest: vi.fn() },
  loanRequestsApi: { listAll: vi.fn(), open: vi.fn(), review: vi.fn() },
}));
const lr = loanRequestsApi as unknown as Record<"listAll" | "open" | "review", ReturnType<typeof vi.fn>>;
const deleteRequest = adminApi.deleteRequest as unknown as ReturnType<typeof vi.fn>;

const requested = makeRequest({ id: "r1", account_name: "Roof", status: "requested", reason: "Leaky roof" });
const underReview = makeRequest({ id: "r2", account_name: "Car", status: "under_review", reason: "Commute" });
const approved = makeRequest({ id: "r3", account_name: "Boat", status: "approved", rate: "0.0500", cycle: 15, reviewed_at: "2026-03-05T00:00:00Z" });
const rejected = makeRequest({ id: "r4", account_name: "Yacht", status: "rejected", rate: "0.0700", cycle: 30, rejection_reason: "Too large", reason: "Fun" });

const card = async (name: string) => (await screen.findByRole("heading", { name })).closest("article")! as HTMLElement;

describe("RequestsPage (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lr.listAll.mockResolvedValue([requested, underReview, approved, rejected]);
  });

  it("shows a loading placeholder", () => {
    lr.listAll.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<RequestsPage />);
    expect(screen.getByLabelText("Loading requests")).toHaveAttribute("aria-busy", "true");
  });

  it("shows an empty state and 'all reviewed' when there are no requests", async () => {
    lr.listAll.mockResolvedValue([]);
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText("No requests found.")).toBeInTheDocument();
    expect(screen.getByText("Borrower loan requests will appear here.")).toBeInTheDocument();
    expect(screen.getByText("All requests reviewed")).toBeInTheDocument();
  });

  it("counts requests needing attention (pending + under review)", async () => {
    renderWithProviders(<RequestsPage />);
    expect(await screen.findByText(/2 requests need attention/)).toBeInTheDocument();
  });

  it("shows the terms for decided requests and a placeholder otherwise", async () => {
    renderWithProviders(<RequestsPage />);
    await card("Boat");
    expect(screen.getAllByText("Terms not yet set")).toHaveLength(2);
    expect(screen.getByText("5.00%")).toBeInTheDocument();
    expect(screen.getByText("Bi-monthly")).toBeInTheDocument();
    expect(screen.getByText("7.00%")).toBeInTheDocument();
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("filters by status and explains an empty filter", async () => {
    const user = userEvent.setup();
    lr.listAll.mockResolvedValue([requested]);
    renderWithProviders(<RequestsPage />);
    await card("Roof");
    await user.click(screen.getByRole("tab", { name: "Approved" }));
    expect(screen.getByText("No requests match this status.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Pending" }));
    expect(screen.getByRole("heading", { name: "Roof" })).toBeInTheDocument();
  });

  describe("opening a pending request", () => {
    it("marks it under review on the server and reveals the review form", async () => {
      lr.open.mockResolvedValue({ ...requested, status: "under_review" });
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const roof = await card("Roof");
      await user.click(within(roof).getByRole("button", { name: "Review" }));

      expect(lr.open).toHaveBeenCalledWith("r1");
      expect(await within(roof).findByText("Borrower's Reason")).toBeInTheDocument();
      expect(within(roof).getByText("Leaky roof")).toBeInTheDocument();
      expect(within(roof).getByLabelText("Interest Rate (%)")).toBeInTheDocument();
      expect(within(roof).getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
    });
  });

  describe("details", () => {
    it("toggles details for an under-review request without calling the API", async () => {
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const car = await card("Car");
      await user.click(within(car).getByRole("button", { name: "Details" }));
      expect(within(car).getByText("Commute")).toBeInTheDocument();
      await user.click(within(car).getByRole("button", { name: "Details" }));
      expect(within(car).queryByText("Commute")).toBeNull();
      expect(lr.open).not.toHaveBeenCalled();
    });

    it("shows the rejection reason on a rejected request", async () => {
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const yacht = await card("Yacht");
      await user.click(within(yacht).getByRole("button", { name: "Details" }));
      expect(within(yacht).getByText("Too large")).toBeInTheDocument();
    });

    it("confirms approval with the review date", async () => {
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const boat = await card("Boat");
      await user.click(within(boat).getByRole("button", { name: "Details" }));
      expect(within(boat).getByText(/Approved on Mar 5, 2026 · Loan account created/)).toBeInTheDocument();
    });

    it("omits the date when the review date is unknown", async () => {
      lr.listAll.mockResolvedValue([{ ...approved, reviewed_at: null }]);
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const boat = await card("Boat");
      await user.click(within(boat).getByRole("button", { name: "Details" }));
      expect(within(boat).getByText(/Approved · Loan account created/)).toBeInTheDocument();
    });
  });

  describe("reviewing an under-review request", () => {
    const openCar = async (user: ReturnType<typeof userEvent.setup>) => {
      renderWithProviders(<RequestsPage />);
      const car = await card("Car");
      await user.click(within(car).getByRole("button", { name: "Details" }));
      return car;
    };

    it("requires a reason to reject", async () => {
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.click(within(car).getByRole("button", { name: "Reject" }));
      expect(await within(car).findByText("Please provide a rejection reason")).toBeInTheDocument();
      expect(lr.review).not.toHaveBeenCalled();
    });

    it("rejects with the typed reason and no terms", async () => {
      lr.review.mockResolvedValue({ ...underReview, status: "rejected", rejection_reason: "Too risky" });
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.type(within(car).getByLabelText(/Rejection Reason/), "Too risky");
      await user.click(within(car).getByRole("button", { name: "Reject" }));

      await waitFor(() =>
        expect(lr.review).toHaveBeenCalledWith("r2", {
          status: "rejected", rejection_reason: "Too risky", rate: undefined, cycle: undefined,
        }),
      );
      expect(await within(card_(car)).findByText("Rejected")).toBeInTheDocument();
      expect(within(car).queryByLabelText("Interest Rate (%)")).toBeNull(); // collapsed
    });

    it("requires a rate before approving", async () => {
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      expect(
        await within(car).findByText("Set an interest rate and payment frequency before approving"),
      ).toBeInTheDocument();
      expect(lr.review).not.toHaveBeenCalled();
    });

    it("also blocks approval when only the frequency was chosen", async () => {
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.selectOptions(within(car).getByLabelText("Payment Frequency"), "30");
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      expect(await within(car).findByText(/Set an interest rate/)).toBeInTheDocument();
    });

    it("approves with the default bi-monthly cycle", async () => {
      lr.review.mockResolvedValue({ ...underReview, status: "approved", rate: "0.0500", cycle: 15 });
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.type(within(car).getByLabelText("Interest Rate (%)"), "5");
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      await waitFor(() =>
        expect(lr.review).toHaveBeenCalledWith("r2", {
          status: "approved", rejection_reason: undefined, rate: 5, cycle: 15,
        }),
      );
      expect(await within(card_(car)).findByText("Approved")).toBeInTheDocument();
    });

    it("approves with a monthly cycle when chosen", async () => {
      lr.review.mockResolvedValue({ ...underReview, status: "approved", rate: "0.0800", cycle: 30 });
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.selectOptions(within(car).getByLabelText("Payment Frequency"), "30");
      await user.type(within(car).getByLabelText("Interest Rate (%)"), "8");
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      await waitFor(() =>
        expect(lr.review).toHaveBeenCalledWith("r2", expect.objectContaining({ rate: 8, cycle: 30 })),
      );
    });

    it("clears a previous validation error once the input is valid", async () => {
      lr.review.mockResolvedValue({ ...underReview, status: "approved", rate: "0.0500", cycle: 15 });
      const user = userEvent.setup();
      const car = await openCar(user);
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      await within(car).findByText(/Set an interest rate/);
      await user.type(within(car).getByLabelText("Interest Rate (%)"), "5");
      await user.click(within(car).getByRole("button", { name: "Approve & create loan" }));
      await waitFor(() => expect(lr.review).toHaveBeenCalled());
      expect(within(car).queryByText(/Set an interest rate/)).toBeNull();
    });
  });

  describe("deleting", () => {
    it("asks for confirmation, then deletes and removes the card", async () => {
      deleteRequest.mockResolvedValue({});
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const roof = await card("Roof");
      await user.click(within(roof).getByRole("button", { name: "Delete request" }));
      const dialog = screen.getByRole("dialog", { name: "Delete Request" });
      await user.click(within(dialog).getByRole("button", { name: "Delete request" }));

      await waitFor(() => expect(deleteRequest).toHaveBeenCalledWith("r1"));
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Roof" })).toBeNull());
      expect(screen.queryByRole("dialog", { name: "Delete Request" })).toBeNull();
    });

    it("keeps the request when the dialog is cancelled", async () => {
      const user = userEvent.setup();
      renderWithProviders(<RequestsPage />);
      const roof = await card("Roof");
      await user.click(within(roof).getByRole("button", { name: "Delete request" }));
      await user.click(within(screen.getByRole("dialog", { name: "Delete Request" })).getByRole("button", { name: "Cancel" }));
      expect(deleteRequest).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "Roof" })).toBeInTheDocument();
    });
  });
});

/** After a review the card is re-rendered; re-find it by its heading's article. */
function card_(old: HTMLElement) {
  return (screen.getByRole("heading", { name: within(old).getByRole("heading").textContent! }).closest("article") ??
    old) as HTMLElement;
}
