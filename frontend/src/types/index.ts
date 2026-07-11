export type UserRole = "admin" | "user";
export type AccountStatus = "open" | "active" | "paid" | "closed";
export type PaymentMethod = "auto" | "manual";
export type WebhookEventType =
  | "payment.added"
  | "status.changed"
  | "account.created"
  | "account.updated"
  | "account.purged";

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

export interface LoanAccount {
  id: string;
  account_name: string;
  borrower_name: string;
  borrow_amount: string;
  rate: string;
  cycle: 15 | 30;
  status: AccountStatus;
  close_reason: string | null;
  start_date: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  // enriched by service layer
  current_balance: string | null;
  next_due_date: string | null;
}

export interface Payment {
  id: string;
  account_id: string;
  amount: string;
  balance_before: string;
  interests_accrued: string;
  balance_after: string;
  payment_date: string;
  next_due_date: string | null;
  method: PaymentMethod;
  created_at: string;
}

export interface WebhookConfig {
  id: string;
  account_id: string | null;
  target_url: string;
  events: WebhookEventType[];
  is_active: boolean;
  created_at: string;
}

export interface LoanRequest {
  id: string;
  user_id: string;
  account_name: string;
  borrow_amount: string;
  rate: string;
  cycle: 15 | 30;
  reason: string | null;
  status: "requested" | "under_review" | "approved" | "rejected";
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

export interface LoanRequestFormData {
  account_name: string;
  borrow_amount: number;
  rate: number; // UI % → /100 before send
  cycle: 15 | 30;
  reason?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

// Form input types
export interface LoginFormData {
  email: string;
  password: string;
}

export interface AccountFormData {
  account_name: string;
  borrow_amount: number;
  rate: number;
  cycle: 15 | 30;
  start_date: string;
  linked_user_id?: string;
  status?: AccountStatus;
}

export interface PaymentFormData {
  amount: number;
  payment_date?: string;
  method: PaymentMethod;
}

export interface WebhookFormData {
  target_url: string;
  events: WebhookEventType[];
}

export interface UserCreateFormData {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}
