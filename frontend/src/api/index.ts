import client from "./client";
import type {
  LoanAccount,
  LoginFormData,
  LoanRequest,
  LoanRequestFormData,
  Payment,
  PaymentFormData,
  TokenResponse,
  User,
  UserCreateFormData,
  WebhookConfig,
  WebhookFormData,
  AccountFormData,
} from "../types";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (data: LoginFormData) =>
    client.post<TokenResponse>("/auth/login", data).then((r) => r.data),

  me: () => client.get<User>("/auth/me").then((r) => r.data),

  updateMe: (data: { full_name?: string; password?: string }) =>
    client.patch<User>("/auth/me", data).then((r) => r.data),

  refresh: (refresh_token: string) =>
    client.post<TokenResponse>("/auth/refresh", { refresh_token }).then((r) => r.data),

  logout: () => client.post("/auth/logout"),
};

// ── Accounts ──────────────────────────────────────────────────────────────────

export const accountsApi = {
  list: (params?: { status?: string[]; search?: string }) =>
    client
      .get<LoanAccount[]>("/accounts", {
        params: { status: params?.status, search: params?.search },
        paramsSerializer: { indexes: null },
      })
      .then((r) => r.data),

  get: (id: string) => client.get<LoanAccount>(`/accounts/${id}`).then((r) => r.data),

  create: (data: AccountFormData) =>
    client
      .post<LoanAccount>("/accounts", {
        account_name: data.account_name,
        borrow_amount: data.borrow_amount,
        rate: data.rate / 100,
        cycle: data.cycle,
        start_date: data.start_date,
        linked_user_id: data.linked_user_id || undefined,
      })
      .then((r) => r.data),

  update: (id: string, data: Partial<AccountFormData>) => {
    const payload: Record<string, unknown> = {};
    if (data.account_name !== undefined) payload.account_name = data.account_name;
    if (data.rate !== undefined) payload.rate = data.rate / 100;
    if (data.status !== undefined) payload.status = data.status;
    return client.patch<LoanAccount>(`/accounts/${id}`, payload).then((r) => r.data);
  },

  close: (id: string, reason?: string) =>
    client
      .post<LoanAccount>(`/accounts/${id}/close`, { close_reason: reason })
      .then((r) => r.data),

  purge: (id: string, force = false) => client.delete(`/accounts/${id}${force ? "?force=true" : ""}`),

  cyclePreview: (id: string) =>
    client.get<string[]>(`/accounts/${id}/cycle-preview`).then((r) => r.data),
};

// ── Payments ──────────────────────────────────────────────────────────────────

export const paymentsApi = {
  list: (accountId: string) =>
    client.get<Payment[]>(`/accounts/${accountId}/payments`).then((r) => r.data),

  add: (accountId: string, data: PaymentFormData) => {
    const payload =
      data.method === "auto"
        ? { amount: data.amount, method: data.method }
        : data;
    return client.post<Payment>(`/accounts/${accountId}/payments`, payload).then((r) => r.data);
  },

  delete: (accountId: string, paymentId: string) =>
    client.delete(`/accounts/${accountId}/payments/${paymentId}`),
};

// ── Webhooks (per-account) ────────────────────────────────────────────────────

export const webhooksApi = {
  list: (accountId: string) =>
    client.get<WebhookConfig[]>(`/accounts/${accountId}/webhooks`).then((r) => r.data),

  create: (accountId: string, data: WebhookFormData) =>
    client.post<WebhookConfig>(`/accounts/${accountId}/webhooks`, data).then((r) => r.data),

  delete: (accountId: string, webhookId: string) =>
    client.delete(`/accounts/${accountId}/webhooks/${webhookId}`),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminApi = {
  listUsers: () => client.get<User[]>("/admin/users").then((r) => r.data),

  createUser: (data: UserCreateFormData) =>
    client.post<User>("/admin/users", data).then((r) => r.data),

  updateUser: (id: string, data: Partial<{ is_active: boolean; role: string; full_name: string }>) =>
    client.patch<User>(`/admin/users/${id}`, data).then((r) => r.data),

  deleteUser: (id: string) => client.delete(`/admin/users/${id}`),

  getUserAccounts: (userId: string) =>
    client.get<LoanAccount[]>(`/admin/users/${userId}/accounts`).then((r) => r.data),

  listGlobalWebhooks: () =>
    client.get<WebhookConfig[]>("/admin/webhooks").then((r) => r.data),

  createGlobalWebhook: (data: WebhookFormData) =>
    client.post<WebhookConfig>("/admin/webhooks", data).then((r) => r.data),

  deleteGlobalWebhook: (webhookId: string) =>
    client.delete(`/admin/webhooks/${webhookId}`),

  toggleGlobalWebhook: (webhookId: string, is_active: boolean) =>
    client.patch<WebhookConfig>(`/admin/webhooks/${webhookId}`, { is_active }).then((r) => r.data),

  deleteRequest: (id: string) => client.delete(`/admin/requests/${id}`),

  // CSV exports — open in new tab to trigger browser download
  exportAccountsCsv: () => window.open(`${client.defaults.baseURL}/admin/export/accounts.csv`, "_blank"),
  exportPaymentsCsv: () => window.open(`${client.defaults.baseURL}/admin/export/payments.csv`, "_blank"),
  exportAccountFullCsv: (accountId: string) =>
    window.open(`${client.defaults.baseURL}/admin/export/accounts/${accountId}/full.csv`, "_blank"),
};

// ── Loan Requests ─────────────────────────────────────────────────────────────

export const loanRequestsApi = {
  listMine: () => client.get<LoanRequest[]>("/loan-requests").then((r) => r.data),

  create: (data: LoanRequestFormData) =>
    client.post<LoanRequest>("/loan-requests", { ...data, rate: data.rate / 100 }).then((r) => r.data),

  cancel: (id: string) => client.delete(`/loan-requests/${id}`),

  // Admin
  listAll: () => client.get<LoanRequest[]>("/loan-requests/admin/all").then((r) => r.data),

  open: (id: string) => client.get<LoanRequest>(`/loan-requests/admin/${id}/open`).then((r) => r.data),

  review: (id: string, data: { status: "approved" | "rejected"; rejection_reason?: string }) =>
    client.patch<LoanRequest>(`/loan-requests/admin/${id}`, data).then((r) => r.data),
};
