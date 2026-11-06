import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountForm } from "./AccountForm";
import { adminApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import type { LoanAccount, User } from "../../types";

vi.mock("../../api", () => ({
  adminApi: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
  },
}));

const adminUser: User = {
  id: "admin-1",
  email: "admin@test.dev",
  full_name: "Admin User",
  role: "admin",
  is_active: true,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
};

const regularUser: User = {
  id: "user-1",
  email: "user@test.dev",
  full_name: "Regular User",
  role: "user",
  is_active: true,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
};

const sampleAccount: LoanAccount = {
  id: "acc-1",
  user_id: "user-1",
  account_name: "Existing Loan",
  borrower_name: "Regular User",
  borrow_amount: "1000.00",
  rate: "0.05",
  cycle: 15,
  start_date: "2026-01-01",
  status: "active",
  current_balance: "900.00",
  next_due_date: "2026-02-15",
  close_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("AccountForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: "x", refreshToken: "y", user: regularUser });
  });

  it("renders the base fields for a non-admin user creating an account", () => {
    render(<AccountForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByPlaceholderText("e.g. Personal Loan – June")).toBeInTheDocument();
    expect(screen.getByText("Create account")).toBeInTheDocument();
    // No admin-only "Assign to Borrower" section for a regular user.
    expect(screen.queryByText("Assign to Borrower")).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<AccountForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows validation errors for empty required fields on submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AccountForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByText("Create account"));

    expect(await screen.findAllByText("Required")).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits valid data for a simple (non-admin) creation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AccountForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("e.g. Personal Loan – June"), "My Loan");
    await user.type(screen.getByPlaceholderText("0.00"), "500");
    await user.type(screen.getByPlaceholderText("5.00"), "5");
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-01-01" } });

    await user.click(screen.getByText("Create account"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.account_name).toBe("My Loan");
    expect(submitted.borrow_amount).toBe(500);
  });

  describe("admin creating an account for another user", () => {
    beforeEach(() => {
      useAuthStore.setState({ accessToken: "x", refreshToken: "y", user: adminUser });
      (adminApi.listUsers as any).mockResolvedValue([regularUser]);
    });

    it("loads and shows existing users in the assignment dropdown", async () => {
      render(<AccountForm onSubmit={vi.fn()} onCancel={vi.fn()} />);
      expect(await screen.findByText("Assign to Borrower")).toBeInTheDocument();
      await waitFor(() => expect(adminApi.listUsers).toHaveBeenCalled());
      expect(await screen.findByText(/Regular User/)).toBeInTheDocument();
    });

    it("REGRESSION: creating a new inline user links the account to that user, not the admin", async () => {
      // This is the exact bug: linked_user_id was only ever set via
      // setValue() on a field that was never register()'d, so it could
      // silently fail to reach the submitted payload. The fix was a real
      // registered hidden input tracked by react-hook-form.
      const user = userEvent.setup();
      const createdUser: User = {
        id: "new-user-1",
        email: "new@test.dev",
        full_name: "Newly Created",
        role: "user",
        is_active: true,
        last_login: null,
        created_at: "2026-01-01T00:00:00Z",
      };
      (adminApi.createUser as any).mockResolvedValue(createdUser);
      const onSubmit = vi.fn().mockResolvedValue(undefined);

      render(<AccountForm onSubmit={onSubmit} onCancel={vi.fn()} />);
      await screen.findByText("Assign to Borrower");

      await user.selectOptions(
        screen.getByDisplayValue("— Assign to myself (admin) —"),
        "__new__"
      );
      await user.type(screen.getByPlaceholderText("Jane Smith"), "Newly Created");
      await user.type(screen.getByPlaceholderText("jane@example.com"), "new@test.dev");
      await user.type(screen.getByPlaceholderText("Min. 8 characters"), "Password123!");
      await user.click(screen.getByText(/Create.*Link/i).closest("button") ?? screen.getByRole("button", { name: /create/i }));

      await waitFor(() => expect(adminApi.createUser).toHaveBeenCalled());
      await screen.findByText(/created and linked/);

      // Now fill the rest of the form and submit — the critical assertion.
      await user.type(screen.getByPlaceholderText("e.g. Personal Loan – June"), "Loan for New User");
      await user.type(screen.getByPlaceholderText("0.00"), "500");
      await user.type(screen.getByPlaceholderText("5.00"), "5");
      const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: "2026-01-01" } });
      await user.click(screen.getByText("Create account"));

      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      const submitted = onSubmit.mock.calls[0][0];
      expect(submitted.linked_user_id).toBe("new-user-1");
    });
  });

  describe("editing an existing account", () => {
    it("pre-fills fields and locks the principal amount", () => {
      render(<AccountForm account={sampleAccount} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByDisplayValue("Existing Loan")).toBeInTheDocument();
      expect(screen.getByText("Save changes")).toBeInTheDocument();
      expect(screen.getByText("Principal is locked after creation")).toBeInTheDocument();

      const principalInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
      expect(principalInput).toBeDisabled();
    });

    it("shows a status selector only when editing", () => {
      render(<AccountForm account={sampleAccount} onSubmit={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText("Status")).toBeInTheDocument();
    });
  });
});
