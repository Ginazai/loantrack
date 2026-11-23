import client from "./client";
import type {
  AccountMapping,
  ImportBatch,
  ImportCommitResult,
  ImportPreview,
  LoanAccount,
  LoginFormData,
  LoanRequest,
  LoanRequestFormData,
  LoanRequestReviewData,
  Payment,
  PaymentAttachment,
  PaymentFormData,
  SelfUpdateData,
  TokenResponse,
  User,
  UserCreateFormData,
  UserUpdateData,
  WebhookConfig,
  WebhookConfigCreated,
  WebhookFormData,
  AccountFormData,
} from "../types";

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (data: LoginFormData) =>
    client.post<TokenResponse>("/auth/login", data).then((r) => r.data),

  me: () => client.get<User>("/auth/me").then((r) => r.data),

  updateMe: (data: SelfUpdateData) =>
    client.patch<User>("/auth/me", data).then((r) => r.data),

  // No refresh() here on purpose: the refresh token is an httpOnly cookie the browser attaches
  // itself, so callers never touch it. Token renewal lives in api/client.ts (refreshSession).

  // The cookie identifies the session, so this works even if the access token has expired.
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

// ── Authenticated file downloads ──────────────────────────────────────────────

/** Hand a blob to the browser as a file save, via a throwaway object URL. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download an authenticated endpoint as a file.
 *
 * Auth is a bearer header held in memory (the refresh cookie is scoped to /auth), so a plain
 * link or window.open() reaches the endpoint with no Authorization header and gets a 401 in a
 * new tab. Fetching through the authenticated client also gets the 401-refresh retry and the
 * cold-start wait for free. The filename is chosen here rather than read from
 * Content-Disposition, which a cross-origin API does not expose to scripts.
 */
async function downloadFile(path: string, filename: string) {
  const res = await client.get(path, { responseType: "blob" });
  saveBlob(res.data as Blob, filename);
}

// ── Payment attachments (ADR-005 — stored as bytea, streamed through here) ────

export const attachmentsApi = {
  list: (accountId: string, paymentId: string) =>
    client
      .get<PaymentAttachment[]>(`/accounts/${accountId}/payments/${paymentId}/attachments`)
      .then((r) => r.data),

  upload: (accountId: string, paymentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return client
      .post<PaymentAttachment>(
        `/accounts/${accountId}/payments/${paymentId}/attachments`,
        form,
        { headers: { "Content-Type": "multipart/form-data" } },
      )
      .then((r) => r.data);
  },

  delete: (accountId: string, paymentId: string, attachmentId: string) =>
    client.delete(`/accounts/${accountId}/payments/${paymentId}/attachments/${attachmentId}`),

  // See downloadFile: a plain link would carry no Authorization header and get a 401.
  download: (accountId: string, paymentId: string, attachmentId: string, filename: string) =>
    downloadFile(`/accounts/${accountId}/payments/${paymentId}/attachments/${attachmentId}`, filename),
};

// ── Webhooks (per-account) ────────────────────────────────────────────────────

export const webhooksApi = {
  list: (accountId: string) =>
    client.get<WebhookConfig[]>(`/accounts/${accountId}/webhooks`).then((r) => r.data),

  // The response carries the signing secret. This is the only time it is available.
  create: (accountId: string, data: WebhookFormData) =>
    client
      .post<WebhookConfigCreated>(`/accounts/${accountId}/webhooks`, data)
      .then((r) => r.data),

  rotateSecret: (accountId: string, webhookId: string) =>
    client
      .post<WebhookConfigCreated>(`/accounts/${accountId}/webhooks/${webhookId}/rotate-secret`)
      .then((r) => r.data),

  delete: (accountId: string, webhookId: string) =>
    client.delete(`/accounts/${accountId}/webhooks/${webhookId}`),
};

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminApi = {
  listUsers: () => client.get<User[]>("/admin/users").then((r) => r.data),

  createUser: (data: UserCreateFormData) =>
    client.post<User>("/admin/users", data).then((r) => r.data),

  updateUser: (id: string, data: UserUpdateData) =>
    client.patch<User>(`/admin/users/${id}`, data).then((r) => r.data),

  deleteUser: (id: string) => client.delete(`/admin/users/${id}`),

  getUserAccounts: (userId: string) =>
    client.get<LoanAccount[]>(`/admin/users/${userId}/accounts`).then((r) => r.data),

  listGlobalWebhooks: () =>
    client.get<WebhookConfig[]>("/admin/webhooks").then((r) => r.data),

  createGlobalWebhook: (data: WebhookFormData) =>
    client.post<WebhookConfigCreated>("/admin/webhooks", data).then((r) => r.data),

  rotateGlobalWebhookSecret: (webhookId: string) =>
    client
      .post<WebhookConfigCreated>(`/admin/webhooks/${webhookId}/rotate-secret`)
      .then((r) => r.data),

  deleteGlobalWebhook: (webhookId: string) =>
    client.delete(`/admin/webhooks/${webhookId}`),

  toggleGlobalWebhook: (webhookId: string, is_active: boolean) =>
    client.patch<WebhookConfig>(`/admin/webhooks/${webhookId}`, { is_active }).then((r) => r.data),

  deleteRequest: (id: string) => client.delete(`/admin/requests/${id}`),

  // CSV exports. Not window.open(): that sends no Authorization header (see downloadFile).
  exportAccountsCsv: () => downloadFile("/admin/export/accounts.csv", "accounts.csv"),
  exportPaymentsCsv: () => downloadFile("/admin/export/payments.csv", "payments.csv"),
  exportAccountFullCsv: (accountId: string) =>
    downloadFile(`/admin/export/accounts/${accountId}/full.csv`, `account-${accountId}.csv`),
};

// ── Loan Requests ─────────────────────────────────────────────────────────────

export const loanRequestsApi = {
  listMine: () => client.get<LoanRequest[]>("/loan-requests").then((r) => r.data),

  create: (data: LoanRequestFormData) =>
    client.post<LoanRequest>("/loan-requests", data).then((r) => r.data),

  cancel: (id: string) => client.delete(`/loan-requests/${id}`),

  // Admin
  listAll: () => client.get<LoanRequest[]>("/loan-requests/admin/all").then((r) => r.data),

  open: (id: string) => client.get<LoanRequest>(`/loan-requests/admin/${id}/open`).then((r) => r.data),

  // rate/cycle are the lender's terms, set here at approval — required by
  // the backend when status="approved", ignored otherwise.
  review: (id: string, data: LoanRequestReviewData) =>
    client
      .patch<LoanRequest>(`/loan-requests/admin/${id}`, {
        ...data,
        rate: data.rate !== undefined ? data.rate / 100 : undefined,
      })
      .then((r) => r.data),
};

// ── Imports (ADR-004) ─────────────────────────────────────────────────────────

export const importsApi = {
  preview: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return client
      .post<ImportPreview>("/admin/imports/preview", form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  commit: (batchId: string, mappings: AccountMapping[]) =>
    client
      .post<ImportCommitResult>(`/admin/imports/${batchId}/commit`, { mappings })
      .then((r) => r.data),

  list: () => client.get<ImportBatch[]>("/admin/imports").then((r) => r.data),

  get: (batchId: string) => client.get<ImportBatch>(`/admin/imports/${batchId}`).then((r) => r.data),
};
