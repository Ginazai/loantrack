export type UserRole = "admin" | "user";
export type AccountStatus = "open" | "active" | "paid" | "closed";
export type PaymentMethod = "auto" | "manual" | "import";
export type WebhookEventType =
  | "payment.added"
  | "status.changed"
  | "account.created"
  | "account.updated"
  | "account.purged"
  | "cycle.closed";

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
  attachment_count: number;
}

export interface PaymentAttachment {
  id: string;
  payment_id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
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

// ── Imports (ADR-004) ────────────────────────────────────────────────────────

export type ImportFormat = "legacy_ledger_csv" | "native_csv";
export type ImportAction = "create" | "existing" | "skip";

export interface ParsedAccountPreview {
  source_ref: string;
  suggested_account_name: string;
  borrow_amount: string;
  start_date: string;
  rate: string | null;
  borrower_name: string | null;
  payment_count: number;
  suggested_existing_account_id: string | null;
}

export interface ImportParseError {
  row_number: number | null;
  message: string;
}

export interface ImportPreview {
  batch_id: string;
  format: ImportFormat;
  accounts: ParsedAccountPreview[];
  unmatched_payment_refs: string[];
  total_payments_parsed: number;
  error_count: number;
  errors: ImportParseError[];
}

export interface AccountMapping {
  source_ref: string;
  action: ImportAction;
  existing_account_id?: string;
  account_name?: string;
  borrower_name?: string;
  linked_user_id?: string;
  rate?: number; // 0..1
}

export interface ImportRowResult {
  row_number: number | null;
  interpretation: string;
  result: "ok" | "error" | "skipped";
  error_message: string | null;
}

export interface ImportBatch {
  id: string;
  source_filename: string;
  format: ImportFormat;
  status: "previewed" | "committed" | "failed";
  summary: Record<string, number>;
  created_at: string;
  committed_at: string | null;
}

export interface ImportCommitResult {
  batch: ImportBatch;
  rows: ImportRowResult[];
}
