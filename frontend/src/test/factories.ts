import type {
  LoanAccount,
  LoanRequest,
  Payment,
  PaymentAttachment,
  User,
  WebhookConfig,
} from "../types";

export const makeUser = (o: Partial<User> = {}): User => ({
  id: "user-1",
  email: "user@test.dev",
  full_name: "Regular User",
  role: "user",
  is_active: true,
  last_login: null,
  created_at: "2026-01-01T00:00:00Z",
  ...o,
});

export const makeAdmin = (o: Partial<User> = {}): User =>
  makeUser({ id: "admin-1", email: "admin@test.dev", full_name: "Admin User", role: "admin", ...o });

export const makeAccount = (o: Partial<LoanAccount> = {}): LoanAccount => ({
  id: "acc-1",
  user_id: "user-1",
  account_name: "Home Loan",
  borrower_name: "Regular User",
  borrow_amount: "1000.00",
  rate: "0.05",
  cycle: 15,
  start_date: "2026-01-01",
  status: "active",
  current_balance: "500.00",
  next_due_date: "2999-01-15",
  close_reason: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  ...o,
});

export const makePayment = (o: Partial<Payment> = {}): Payment => ({
  id: "pay-1",
  account_id: "acc-1",
  amount: "200.00",
  balance_before: "1000.00",
  interests_accrued: "25.00",
  balance_after: "825.00",
  payment_date: "2026-02-01",
  next_due_date: "2026-02-15",
  method: "manual",
  created_at: "2026-02-01T00:00:00Z",
  attachment_count: 0,
  ...o,
});

export const makeRequest = (o: Partial<LoanRequest> = {}): LoanRequest => ({
  id: "req-1",
  user_id: "user-1",
  account_name: "Roof repair",
  borrow_amount: "2500.00",
  rate: null,
  cycle: null,
  reason: null,
  status: "requested",
  rejection_reason: null,
  created_at: "2026-03-01T00:00:00Z",
  updated_at: "2026-03-01T00:00:00Z",
  reviewed_at: null,
  ...o,
});

export const makeWebhook = (o: Partial<WebhookConfig> = {}): WebhookConfig => ({
  id: "wh-1",
  account_id: null,
  target_url: "https://hooks.example.com/abc",
  events: ["payment.added"],
  is_active: true,
  created_at: "2026-01-05T00:00:00Z",
  ...o,
});

export const makeAttachment = (o: Partial<PaymentAttachment> = {}): PaymentAttachment => ({
  id: "att-1",
  payment_id: "pay-1",
  original_filename: "receipt.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  uploaded_by: "admin-1",
  created_at: "2026-02-02T00:00:00Z",
  ...o,
});
