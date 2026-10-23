import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentForm } from "./PaymentForm";
import type { LoanAccount } from "../../types";

const account: LoanAccount = {
  id: "acc-1",
  user_id: "user-1",
  account_name: "Test Loan",
  borrower_name: "Jane Doe",
  borrow_amount: "1000.00",
  rate: "0.05",
  cycle: 15,
  start_date: "2026-01-01",
  status: "active",
  current_balance: "750.00",
  next_due_date: "2026-02-15",
  close_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("PaymentForm", () => {
  it("shows the current balance and next due date", () => {
    render(<PaymentForm account={account} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("$750.00")).toBeInTheDocument();
  });

  it("defaults to auto mode with no visible date picker", () => {
    render(<PaymentForm account={account} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Auto" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it("switching to manual mode reveals the date picker", async () => {
    const user = userEvent.setup();
    render(<PaymentForm account={account} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByText("Manual"));
    expect(document.querySelector('input[type="date"]')).toBeInTheDocument();
  });

  it("submits in auto mode without a payment_date field", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PaymentForm account={account} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("0.00"), "100");
    await user.click(screen.getByText("Record Payment"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.method).toBe("auto");
    expect(submitted.payment_date).toBeUndefined();
    expect(submitted.amount).toBe(100);
  });

  it("submits in manual mode with the selected payment_date", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PaymentForm account={account} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByText("Manual"));
    await user.type(screen.getByPlaceholderText("0.00"), "50");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-01-20" } });

    await user.click(screen.getByText("Record Payment"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.method).toBe("manual");
    expect(submitted.payment_date).toBe("2026-01-20");
  });

  it("rejects a zero or negative amount", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PaymentForm account={account} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("0.00"), "0");
    await user.click(screen.getByText("Record Payment"));

    expect(await screen.findByText("Must be greater than 0")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<PaymentForm account={account} onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("clicking an upcoming-cycle badge sets the date in manual mode", async () => {
    const user = userEvent.setup();
    render(<PaymentForm account={account} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByText("Manual"));

    const badges = screen.getAllByText(/\w+ \d+, \d{4}/);
    await user.click(badges[0]);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput.value).not.toBe("");
  });
});
