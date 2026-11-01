import { Add, Attachment, Download, Link as LinkIcon, Receipt, TrashCan } from "@carbon/icons-react";
import {
  Button,
  InlineLoading,
  Modal,
  ProgressBar,
  SkeletonText,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Tag,
  TextArea,
} from "@carbon/react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, adminApi, paymentsApi, webhooksApi } from "../../api";
import {
  ConfirmDialog,
  Drawer,
  EmptyState,
  Notice,
  PageHeader,
  StatCard,
  StatCardSkeleton,
  StatusBadge,
} from "../../components/common";
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
import { PaymentAttachmentsModal } from "../payments/PaymentAttachments";
import { WebhookForm } from "../webhooks/WebhookForm";
import { useAuthStore } from "../../stores/authStore";
import { getApiErrorMessage } from "../../utils/apiError";

type Tab = "overview" | "payments" | "webhooks" | "settings";
const TABS: Tab[] = ["overview", "payments", "webhooks", "settings"];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  payments: "Payments",
  webhooks: "Webhooks",
  settings: "Settings",
};

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
  const [attachmentsPaymentId, setAttachmentsPaymentId] = useState<string | null>(null);

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
      <div className="lt-page lt-stack lt-stack--loose" aria-busy="true" aria-label="Loading account">
        <SkeletonText heading width="30%" />
        <div className="lt-kpis">
          {[0, 1, 2, 3].map((i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <SkeletonText paragraph lineCount={4} />
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

  const late = isOverdue(account.next_due_date);

  return (
    <div className="lt-page lt-stack lt-stack--loose">
      <PageHeader
        breadcrumbs={[{ label: "Accounts", to: "/accounts" }, { label: account.account_name }]}
        title={account.account_name}
        badge={<StatusBadge status={account.status} />}
        subtitle={`Borrower: ${account.borrower_name} · Started ${formatDate(account.start_date)}`}
        action={
          <>
            {canAddPayment && (
              <Button size="md" renderIcon={Add} onClick={() => setShowPayment(true)}>
                Record payment
              </Button>
            )}
            <Button size="md" kind="tertiary" onClick={() => setShowEdit(true)}>
              Edit
            </Button>
            {canClose && (
              <Button size="md" kind="tertiary" onClick={() => setShowClose(true)}>
                Close
              </Button>
            )}
            {canPurge && (
              <Button size="md" kind="danger--tertiary" onClick={() => setShowPurge(true)}>
                Purge
              </Button>
            )}
          </>
        }
      />

      {/* Key metrics */}
      <section className="lt-kpis" aria-label="Account summary">
        <StatCard title="Principal" value={formatCurrency(account.borrow_amount)} />
        <StatCard title="Current Balance" value={formatCurrency(displayBalance)} />
        <StatCard title="Interest Rate" value={formatRate(account.rate)} />
        <StatCard
          title="Next Due"
          value={account.next_due_date ? formatDate(account.next_due_date) : "—"}
          desc={late ? "Overdue" : undefined}
          tone={late ? "danger" : "default"}
        />
      </section>

      {/* Repayment progress */}
      <div className="lt-panel lt-panel__body">
        <ProgressBar
          label="Repayment Progress"
          value={progressPct}
          max={100}
          helperText={`${progressPct.toFixed(1)}% paid off`}
        />
      </div>

      {/* Tabs — wrapped so the stack gap doesn't split the tab bar from its panel */}
      <div>
      <Tabs
        selectedIndex={TABS.indexOf(tab)}
        onChange={({ selectedIndex }: { selectedIndex: number }) => setTab(TABS[selectedIndex])}
      >
        <TabList aria-label="Account sections">
          {TABS.map((t) => (
            <Tab key={t}>{TAB_LABEL[t]}</Tab>
          ))}
        </TabList>
        <TabPanels>
          {/* Overview */}
          <TabPanel className="lt-tab-panel">
            {tab === "overview" &&
              (payments.length === 0 ? (
                <div className="lt-panel">
                  <EmptyState
                    Icon={Receipt}
                    title="No payment history yet"
                    description="Charts appear once the first payment is recorded."
                  />
                </div>
              ) : (
                <div className="lt-charts">
                  <BalanceChart payments={payments} borrowAmount={account.borrow_amount} />
                  <InterestChart payments={payments} />
                </div>
              ))}
          </TabPanel>

          {/* Payments */}
          <TabPanel className="lt-tab-panel">
            {tab === "payments" && (
              <div className="lt-panel">
                <div className="lt-panel__header">
                  <h2 className="lt-panel__title">Payment Ledger</h2>
                  {canAddPayment && (
                    <Button size="md" renderIcon={Add} onClick={() => setShowPayment(true)}>
                      Record payment
                    </Button>
                  )}
                </div>

                {payments.length === 0 ? (
                  <EmptyState
                    Icon={Receipt}
                    title="No payments recorded yet."
                    description="Each payment is split into interest and principal and appears here."
                  />
                ) : (
                  <>
                    <div className="lt-table-wrap">
                      <Table size="lg" aria-label="Payment ledger">
                        <TableHead>
                          <TableRow>
                            <TableHeader>#</TableHeader>
                            <TableHeader>Date</TableHeader>
                            <TableHeader className="lt-num">Balance Before</TableHeader>
                            <TableHeader className="lt-num">Interest</TableHeader>
                            <TableHeader className="lt-num">Payment</TableHeader>
                            <TableHeader className="lt-num">Balance After</TableHeader>
                            <TableHeader>Next Due</TableHeader>
                            <TableHeader>Mode</TableHeader>
                            <TableHeader>
                              <span className="lt-visually-hidden">Receipts</span>
                            </TableHeader>
                            {isAdmin && (
                              <TableHeader>
                                <span className="lt-visually-hidden">Delete</span>
                              </TableHeader>
                            )}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {payments.map((p, i) => (
                            <TableRow key={p.id}>
                              <TableCell className="lt-muted">{i + 1}</TableCell>
                              <TableCell>{formatDate(p.payment_date)}</TableCell>
                              <TableCell className="lt-num">{formatCurrency(p.balance_before)}</TableCell>
                              <TableCell className="lt-num">
                                +{formatCurrency(p.interests_accrued)}
                              </TableCell>
                              <TableCell className="lt-num">
                                −{formatCurrency(p.amount)}
                              </TableCell>
                              <TableCell className="lt-num">
                                <strong>{formatCurrency(p.balance_after)}</strong>
                              </TableCell>
                              <TableCell>{p.next_due_date ? formatDate(p.next_due_date) : "—"}</TableCell>
                              <TableCell>
                                <Tag size="sm" type="outline">
                                  {p.method}
                                </Tag>
                              </TableCell>
                              <TableCell>
                                <div className="lt-table-actions lt-table-actions--start">
                                  <Button
                                    kind="ghost"
                                    size="md"
                                    hasIconOnly
                                    renderIcon={Attachment}
                                    iconDescription="Comprobantes"
                                    tooltipPosition="left"
                                    onClick={() => setAttachmentsPaymentId(p.id)}
                                  />
                                  {p.attachment_count > 0 && (
                                    <span className="lt-field-note" aria-label={`${p.attachment_count} attachments`}>
                                      {p.attachment_count}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              {isAdmin && (
                                <TableCell>
                                  <Button
                                    kind="danger--ghost"
                                    size="md"
                                    hasIconOnly
                                    renderIcon={TrashCan}
                                    iconDescription="Delete payment"
                                    tooltipPosition="left"
                                    onClick={() => setDeletePaymentId(p.id)}
                                  />
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {isAdmin && (
                      <div className="lt-table-footer">
                        <Button
                          kind="ghost"
                          size="md"
                          renderIcon={Download}
                          onClick={() => adminApi.exportAccountFullCsv(id!)}
                        >
                          Export with payments (.csv)
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </TabPanel>

          {/* Webhooks */}
          <TabPanel className="lt-tab-panel">
            {tab === "webhooks" && (
              <div className="lt-stack">
                <div className="lt-row lt-row--between">
                  <p className="lt-muted">Post real-time events to n8n, Pipedream, or any HTTP endpoint.</p>
                  <Button size="md" renderIcon={Add} onClick={() => setShowWebhook(true)}>
                    Add webhook
                  </Button>
                </div>

                {webhooks.length === 0 ? (
                  <div className="lt-panel">
                    <EmptyState
                      Icon={LinkIcon}
                      title="No webhooks configured."
                      description="Add an endpoint to be notified about payments and status changes on this account."
                    />
                  </div>
                ) : (
                  <div className="lt-stack lt-stack--tight">
                    {webhooks.map((wh) => (
                      <div key={wh.id} className="lt-item">
                        <div className="lt-item__top">
                          <div className="lt-item__main">
                            <p className="lt-item__url">{wh.target_url}</p>
                            <div className="lt-row lt-row--tight">
                              {wh.events.map((ev) => (
                                <Tag key={ev} size="sm" type="outline">
                                  {ev}
                                </Tag>
                              ))}
                            </div>
                          </div>
                          <div className="lt-row">
                            <Tag size="sm" type={wh.is_active ? "green" : "gray"}>
                              {wh.is_active ? "active" : "inactive"}
                            </Tag>
                            <Button
                              kind="danger--ghost"
                              size="md"
                              hasIconOnly
                              renderIcon={TrashCan}
                              iconDescription="Delete webhook"
                              tooltipPosition="left"
                              onClick={() => deleteWebhook.mutate(wh.id)}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabPanel>

          {/* Settings */}
          <TabPanel className="lt-tab-panel">
            {tab === "settings" && (
              <section className="lt-panel lt-panel__body" aria-labelledby="settings-heading">
                <h2 className="lt-section-title" id="settings-heading">
                  Account Settings
                </h2>
                <dl className="lt-dl">
                  {[
                    ["Account ID", account.id],
                    ["Created", formatDate(account.created_at)],
                    ["Last Updated", formatDate(account.updated_at)],
                    ["Cycle", account.cycle === 15 ? "Bi-monthly (15th & 30th)" : "Monthly (30th)"],
                    ["Close Reason", account.close_reason ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd className={k === "Account ID" ? "lt-mono" : undefined}>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}

      {showPayment && (
        <Drawer title="Record Payment" onClose={() => setShowPayment(false)}>
          <PaymentForm
            account={account}
            onSubmit={async (data) => { await addPayment.mutateAsync(data); }}
            onCancel={() => setShowPayment(false)}
            isLoading={addPayment.isPending}
          />
          {addPayment.isError && (
            <div className="lt-mt-md">
              <Notice kind="error" title="Couldn’t record payment">
                {getApiErrorMessage(addPayment.error, "Failed to record payment")}
              </Notice>
            </div>
          )}
        </Drawer>
      )}

      {showEdit && (
        <Drawer title="Edit Account" onClose={() => setShowEdit(false)} width="lg">
          <AccountForm
            account={account}
            onSubmit={async (data) => { await updateAccount.mutateAsync(data); }}
            onCancel={() => setShowEdit(false)}
            isLoading={updateAccount.isPending}
          />
        </Drawer>
      )}

      {showClose && (
        <Modal
          open
          size="sm"
          modalHeading="Close Account"
          primaryButtonText={closeAccount.isPending ? "Closing…" : "Close account"}
          secondaryButtonText="Cancel"
          primaryButtonDisabled={closeAccount.isPending}
          onRequestSubmit={() => closeAccount.mutate()}
          onRequestClose={() => setShowClose(false)}
          onSecondarySubmit={() => setShowClose(false)}
        >
          <p className="lt-mb-lg">
            This will mark the account as closed. You can optionally add a reason.
          </p>
          <TextArea
            id="close-reason"
            labelText="Reason for closing (optional)"
            rows={3}
            value={closeReason}
            onChange={(e) => setCloseReason(e.target.value)}
          />
        </Modal>
      )}

      {showPurge && (
        <ConfirmDialog
          title="Permanently Delete Account"
          message={
            isAdmin && account.status !== "closed"
              ? "This account is still active. Force-deleting will remove it and ALL payment history permanently."
              : "This will hard-delete the account and all its payment history. This action cannot be undone."
          }
          confirmLabel="Delete forever"
          confirmWord={account.account_name}
          dangerous
          onConfirm={() => purgeAccount.mutate()}
          onCancel={() => setShowPurge(false)}
        />
      )}

      {attachmentsPaymentId && (
        <PaymentAttachmentsModal
          accountId={id!}
          paymentId={attachmentsPaymentId}
          isAdmin={isAdmin}
          onClose={() => setAttachmentsPaymentId(null)}
        />
      )}

      {deletePaymentId && (
        <ConfirmDialog
          title="Delete Payment"
          message="This will permanently remove this payment record. The account balance will be recalculated on next load."
          confirmLabel="Delete payment"
          dangerous
          onConfirm={() => deletePayment.mutate(deletePaymentId)}
          onCancel={() => setDeletePaymentId(null)}
        />
      )}

      {showWebhook && (
        <Drawer title="Add Webhook" onClose={() => setShowWebhook(false)}>
          <WebhookForm
            onSubmit={async (data) => { await addWebhook.mutateAsync(data); }}
            onCancel={() => setShowWebhook(false)}
            isLoading={addWebhook.isPending}
          />
        </Drawer>
      )}
    </div>
  );
}
