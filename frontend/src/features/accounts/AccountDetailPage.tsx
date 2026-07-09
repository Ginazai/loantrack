import {
  ArrowLeft,
  Download,
  Inbox,
  Link2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, adminApi, paymentsApi, webhooksApi } from "../../api";
import { ConfirmDialog, PageHeader, StatusBadge } from "../../components/common";
import {
  formatCurrency,
  formatDate,
  formatRate,
  isOverdue,
} from "../../utils/dateUtils";
import type { AccountFormData, PaymentFormData, WebhookFormData } from "../../types";
import { AccountForm } from "./AccountForm";
import { BalanceChart, InterestChart } from "./Charts";
import { PaymentForm } from "../payments/PaymentForm";
import { WebhookForm } from "../webhooks/WebhookForm";
import { useAuthStore } from "../../stores/authStore";

type Tab = "overview" | "payments" | "webhooks" | "settings";

export function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("overview");
  const [showPayment, setShowPayment] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showPurge, setShowPurge] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: account, isLoading } = useQuery({
    queryKey: ["account", id],
    queryFn: () => accountsApi.get(id!),
    enabled: !!id,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", id],
    queryFn: () => paymentsApi.list(id!),
    enabled: !!id,
  });

  const { data: webhooks = [] } = useQuery({
    queryKey: ["webhooks", id],
    queryFn: () => webhooksApi.list(id!),
    enabled: !!id && tab === "webhooks",
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const addPayment = useMutation({
    mutationFn: (data: PaymentFormData) => paymentsApi.add(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["payments", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowPayment(false);
    },
  });

  const updateAccount = useMutation({
    mutationFn: (data: AccountFormData) => accountsApi.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      setShowEdit(false);
    },
  });

  const closeAccount = useMutation({
    mutationFn: () => accountsApi.close(id!, closeReason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowClose(false);
    },
  });

  const purgeAccount = useMutation({
    mutationFn: () => accountsApi.purge(id!, isAdmin),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      navigate("/accounts");
    },
  });

  const deletePayment = useMutation({
    mutationFn: (paymentId: string) => paymentsApi.delete(id!, paymentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments", id] });
      qc.invalidateQueries({ queryKey: ["account", id] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setDeletePaymentId(null);
    },
  });

  const addWebhook = useMutation({
    mutationFn: (data: WebhookFormData) => webhooksApi.create(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks", id] });
      setShowWebhook(false);
    },
  });

  const deleteWebhook = useMutation({
    mutationFn: (wid: string) => webhooksApi.delete(id!, wid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", id] }),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading || !account) {
    return (
      <div className="flex justify-center py-20">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  const canAddPayment = ["open", "active"].includes(account.status);
  const canClose = !["paid", "closed"].includes(account.status);
  const canPurge = account.status === "closed";

  // Use the most recent payment's balance_after as the authoritative current balance
  // if it exists — this is always in sync with what the ledger recorded.
  const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
  const displayBalance = lastPayment
    ? lastPayment.balance_after
    : (account.current_balance ?? account.borrow_amount);

  const progressPct = Math.max(
    0,
    Math.min(
      100,
      ((parseFloat(account.borrow_amount) - parseFloat(String(displayBalance))) /
        parseFloat(account.borrow_amount)) *
        100
    )
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <button
            className="btn btn-ghost btn-xs mb-2 -ml-2 gap-1"
            onClick={() => navigate("/accounts")}
          >
            <ArrowLeft className="w-3 h-3" />
            Accounts
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{account.account_name}</h1>
            <StatusBadge status={account.status} />
          </div>
          <p className="text-base-content/60 text-sm mt-0.5">
            Borrower:{" "}
            <span className="font-medium text-base-content">{account.borrower_name}</span>
            {" · "}Started {formatDate(account.start_date)}
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          {canAddPayment && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowPayment(true)}>
              + Record Payment
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(true)}>
            Edit
          </button>
          {canClose && (
            <button
              className="btn btn-warning btn-sm btn-outline"
              onClick={() => setShowClose(true)}
            >
              Close
            </button>
          )}
          {canPurge && (
            <button
              className="btn btn-error btn-sm btn-outline"
              onClick={() => setShowPurge(true)}
            >
              Purge
            </button>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Principal", value: formatCurrency(account.borrow_amount) },
          {
            label: "Current Balance",
            value: formatCurrency(displayBalance),
            highlight: true,
          },
          { label: "Interest Rate", value: formatRate(account.rate) },
          {
            label: "Next Due",
            value: account.next_due_date ? formatDate(account.next_due_date) : "—",
            warn: isOverdue(account.next_due_date),
          },
        ].map((m) => (
          <div key={m.label} className="bg-base-100 rounded-2xl p-4 shadow-sm">
            <p className="text-xs text-base-content/50 uppercase tracking-wide">{m.label}</p>
            <p
              className={`font-bold text-lg mt-0.5 ${
                m.warn ? "text-error" : m.highlight ? "text-primary" : ""
              }`}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {/* Repayment progress */}
      <div className="bg-base-100 rounded-2xl p-4 shadow-sm">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium">Repayment Progress</span>
          <span className="text-base-content/60">{progressPct.toFixed(1)}% paid off</span>
        </div>
        <progress className="progress progress-primary w-full" value={progressPct} max={100} />
      </div>

      {/* Tabs */}
      <div className="tabs tabs-boxed bg-base-200 w-fit">
        {(["overview", "payments", "webhooks", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? "tab-active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BalanceChart payments={payments} borrowAmount={account.borrow_amount} />
          <InterestChart payments={payments} />
        </div>
      )}

      {/* Tab: Payments */}
      {tab === "payments" && (
        <div className="bg-base-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-base-200">
            <h2 className="font-semibold">Payment Ledger</h2>
            {canAddPayment && (
              <button className="btn btn-primary btn-xs" onClick={() => setShowPayment(true)}>
                + Record Payment
              </button>
            )}
          </div>

          {payments.length === 0 ? (
            <div className="text-center py-12 text-base-content/50">
              <Inbox className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No payments recorded yet.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Date</th>
                      <th className="text-right">Balance Before</th>
                      <th className="text-right">Interest</th>
                      <th className="text-right">Payment</th>
                      <th className="text-right">Balance After</th>
                      <th>Next Due</th>
                      <th>Mode</th>
                      {isAdmin && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, i) => (
                      <tr key={p.id} className="hover">
                        <td className="text-base-content/40">{i + 1}</td>
                        <td className="font-medium">{formatDate(p.payment_date)}</td>
                        <td className="text-right font-mono text-sm">
                          {formatCurrency(p.balance_before)}
                        </td>
                        <td className="text-right font-mono text-sm text-error">
                          +{formatCurrency(p.interests_accrued)}
                        </td>
                        <td className="text-right font-mono text-sm text-success font-semibold">
                          −{formatCurrency(p.amount)}
                        </td>
                        <td className="text-right font-mono text-sm font-bold">
                          {formatCurrency(p.balance_after)}
                        </td>
                        <td className="text-sm text-base-content/60">
                          {p.next_due_date ? formatDate(p.next_due_date) : "—"}
                        </td>
                        <td>
                          <span className="badge badge-xs badge-outline">{p.method}</span>
                        </td>
                        {isAdmin && (
                          <td>
                            <button
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => setDeletePaymentId(p.id)}
                              title="Delete payment"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isAdmin && (
                <div className="flex justify-end pt-1">
                  <button
                    className="btn btn-ghost btn-xs gap-1.5 text-base-content/50"
                    onClick={() => adminApi.exportAccountFullCsv(id!)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export with payments (.csv)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Webhooks */}
      {tab === "webhooks" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-base-content/60">
              Post real-time events to n8n, Pipedream, or any HTTP endpoint.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setShowWebhook(true)}>
              + Add Webhook
            </button>
          </div>

          {webhooks.length === 0 ? (
            <div className="bg-base-100 rounded-2xl p-8 text-center text-base-content/50">
              <Link2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No webhooks configured.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {webhooks.map((wh) => (
                <div
                  key={wh.id}
                  className="bg-base-100 rounded-2xl p-4 shadow-sm flex items-start justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{wh.target_url}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {wh.events.map((ev) => (
                        <span key={ev} className="badge badge-xs badge-outline">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`badge badge-xs ${
                        wh.is_active ? "badge-success" : "badge-ghost"
                      }`}
                    >
                      {wh.is_active ? "active" : "inactive"}
                    </span>
                    <button
                      className="btn btn-ghost btn-xs text-error"
                      onClick={() => deleteWebhook.mutate(wh.id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Settings */}
      {tab === "settings" && (
        <div className="bg-base-100 rounded-2xl p-5 shadow-sm space-y-3">
          <h2 className="font-semibold mb-4">Account Settings</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              ["Account ID", account.id],
              ["Created", formatDate(account.created_at)],
              ["Last Updated", formatDate(account.updated_at)],
              ["Cycle", account.cycle === 15 ? "Bi-monthly (15th & 30th)" : "Monthly (30th)"],
              ["Close Reason", account.close_reason ?? "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-base-content/50">{k}</dt>
                <dd className="font-medium break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-5">Record Payment</h2>
            <PaymentForm
              account={account}
              onSubmit={async (data) => { await addPayment.mutateAsync(data); }}
              onCancel={() => setShowPayment(false)}
              isLoading={addPayment.isPending}
            />
            {addPayment.isError && (
              <div className="alert alert-error mt-3 text-sm py-2">
                <span>
                  {(addPayment.error as any)?.response?.data?.detail ??
                    "Failed to record payment"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-5">Edit Account</h2>
            <AccountForm
              account={account}
              onSubmit={async (data) => { await updateAccount.mutateAsync(data); }}
              onCancel={() => setShowEdit(false)}
              isLoading={updateAccount.isPending}
            />
          </div>
        </div>
      )}

      {showClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-2">Close Account</h2>
            <p className="text-sm text-base-content/60 mb-4">
              This will mark the account as closed. You can optionally add a reason.
            </p>
            <textarea
              className="textarea textarea-bordered w-full text-sm"
              rows={3}
              placeholder="Reason for closing (optional)"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowClose(false)}>
                Cancel
              </button>
              <button
                className={`btn btn-warning btn-sm ${closeAccount.isPending ? "loading" : ""}`}
                onClick={() => closeAccount.mutate()}
              >
                Close Account
              </button>
            </div>
          </div>
        </div>
      )}

      {showPurge && (
        <ConfirmDialog
          title="Permanently Delete Account"
          message={
            isAdmin && account.status !== "closed"
              ? "This account is still active. Force-deleting will remove it and ALL payment history permanently."
              : "This will hard-delete the account and all its payment history. This action cannot be undone."
          }
          confirmLabel="Delete Forever"
          confirmWord={account.account_name}
          dangerous
          onConfirm={() => purgeAccount.mutate()}
          onCancel={() => setShowPurge(false)}
        />
      )}

      {deletePaymentId && (
        <ConfirmDialog
          title="Delete Payment"
          message="This will permanently remove this payment record. The account balance will be recalculated on next load."
          confirmLabel="Delete Payment"
          dangerous
          onConfirm={() => deletePayment.mutate(deletePaymentId)}
          onCancel={() => setDeletePaymentId(null)}
        />
      )}

      {showWebhook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-5">Add Webhook</h2>
            <WebhookForm
              onSubmit={async (data) => { await addWebhook.mutateAsync(data); }}
              onCancel={() => setShowWebhook(false)}
              isLoading={addWebhook.isPending}
            />
          </div>
        </div>
      )}
    </div>
  );
}
