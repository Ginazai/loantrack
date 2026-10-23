import {
  Add,
  CheckmarkFilled,
  ChevronDown,
  ChevronUp,
  Close,
  ErrorFilled,
  DocumentBlank,
  Time,
} from "@carbon/icons-react";
import {
  Button,
  ContentSwitcher,
  InlineLoading,
  SkeletonText,
  Switch,
  Tag,
  TextArea,
  TextInput,
} from "@carbon/react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loanRequestsApi } from "../../api";
import type { LoanRequest, LoanRequestFormData } from "../../types";
import { getApiErrorMessage } from "../../utils/apiError";
import { formatCurrency, formatDate } from "../../utils/dateUtils";
import { Drawer, EmptyState, Notice, PageHeader } from "../../components/common";

type Filter = "all" | "requested" | "under_review" | "approved" | "rejected";
const FILTERS: Filter[] = ["all", "requested", "under_review", "approved", "rejected"];
const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  requested: "Pending",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
};

type TagType = "magenta" | "blue" | "green" | "red" | "gray";

const STATUS_META: Record<string, { type: TagType; Icon: React.ElementType; label: string }> = {
  requested:    { type: "magenta", Icon: Time,            label: "Pending"      },
  under_review: { type: "blue",    Icon: Time,            label: "Under Review" },
  approved:     { type: "green",   Icon: CheckmarkFilled, label: "Approved"     },
  rejected:     { type: "red",     Icon: ErrorFilled,     label: "Rejected"     },
};

function RequestBadge({ status }: { status: string }) {
  const { type, Icon, label } = STATUS_META[status] ?? { type: "gray" as TagType, Icon: Time, label: status };
  return (
    <Tag size="sm" type={type} renderIcon={Icon}>
      {label}
    </Tag>
  );
}

function RequestLoanModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<LoanRequestFormData>({ account_name: "", borrow_amount: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!form.account_name || !form.borrow_amount) { setError("Fill all required fields"); return; }
    setSaving(true); setError(null);
    try {
      await loanRequestsApi.create(form);
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Failed to submit"));
    } finally { setSaving(false); }
  };

  return (
    <Drawer title="New Loan Request" onClose={onClose}>
      <form
        className="lt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        {error && <Notice kind="error">{error}</Notice>}
        <TextInput
          id="request-name"
          labelText="Loan Name / Purpose"
          placeholder="e.g. Home renovation"
          value={form.account_name}
          onChange={(e) => setForm({ ...form, account_name: e.target.value })}
        />
        <TextInput
          id="request-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          labelText="Amount (USD)"
          helperText="Interest rate and payment schedule are set by the lender when your request is approved."
          value={form.borrow_amount || ""}
          onChange={(e) => setForm({ ...form, borrow_amount: Number(e.target.value) })}
        />
        <TextArea
          id="request-reason"
          labelText="Reason (optional)"
          rows={3}
          placeholder="Why do you need this loan?"
          value={form.reason ?? ""}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" kind="secondary" size="xl" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="xl" disabled={saving}>
            {saving ? <InlineLoading description="Submitting…" /> : "Submit Request"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function RequestCard({ req, onCancel }: { req: LoanRequest; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cancellable = req.status === "requested" || req.status === "under_review";
  const detailId = `request-detail-${req.id}`;

  return (
    <article
      className={`lt-item${
        req.status === "approved"
          ? " lt-item--success"
          : req.status === "under_review"
            ? " lt-item--info"
            : req.status === "requested"
              ? " lt-item--attention"
              : ""
      }`}
    >
      <div className="lt-item__top">
        <div className="lt-item__main">
          <div className="lt-row">
            <RequestBadge status={req.status} />
            <h2 className="lt-item__title">{req.account_name}</h2>
          </div>
          <div className="lt-item__meta">
            <span>{formatCurrency(Number(req.borrow_amount))}</span>
            {req.rate !== null && req.cycle !== null ? (
              <>
                <span>{(Number(req.rate) * 100).toFixed(2)}%</span>
                <span>{req.cycle === 15 ? "Bi-monthly" : "Monthly"}</span>
              </>
            ) : (
              <span>Terms set upon approval</span>
            )}
            <span>Submitted {formatDate(req.created_at)}</span>
          </div>
        </div>
        <div className="lt-row" style={{ flexWrap: "nowrap", gap: 0 }}>
          {(req.reason || req.rejection_reason) && (
            <Button
              kind="ghost"
              size="md"
              hasIconOnly
              renderIcon={expanded ? ChevronUp : ChevronDown}
              iconDescription={expanded ? "Hide details" : "Show details"}
              tooltipPosition="left"
              aria-expanded={expanded}
              aria-controls={detailId}
              onClick={() => setExpanded(!expanded)}
            />
          )}
          {cancellable && (
            <Button
              kind="danger--ghost"
              size="md"
              hasIconOnly
              renderIcon={Close}
              iconDescription="Cancel request"
              tooltipPosition="left"
              onClick={() => onCancel(req.id)}
            />
          )}
        </div>
      </div>

      {expanded && (
        <div className="lt-item__detail lt-stack lt-stack--tight" id={detailId}>
          {req.reason && (
            <div>
              <p className="lt-eyebrow">Your Reason</p>
              <p>{req.reason}</p>
            </div>
          )}
          {req.status === "rejected" && req.rejection_reason && (
            <Notice kind="error" title="Rejection reason">
              {req.rejection_reason}
            </Notice>
          )}
          {req.status === "approved" && (
            <div className="lt-row">
              <CheckmarkFilled size={16} className="lt-success-icon" aria-hidden="true" />
              <span>
                Approved {req.reviewed_at ? `on ${formatDate(req.reviewed_at)}` : ""} · Loan account created
              </span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function MyRequestsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [showModal, setShowModal] = useState(false);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["my-requests"],
    queryFn: () => loanRequestsApi.listMine(),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => loanRequestsApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-requests"] }),
  });

  const active = requests.filter((r) => r.status === "requested" || r.status === "under_review");
  const canRequest = active.length < 3;

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);

  const counts: Record<string, number> = { all: requests.length };
  for (const r of requests) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return (
    <div className="lt-page lt-page--narrow lt-stack lt-stack--loose">
      <PageHeader
        title="My Requests"
        subtitle={`${active.length} active · ${3 - active.length} slot${3 - active.length !== 1 ? "s" : ""} remaining`}
        action={
          <Button size="md" renderIcon={Add} onClick={() => setShowModal(true)} disabled={!canRequest}>
            New Request
          </Button>
        }
      />

      <ContentSwitcher
        size="md"
        selectedIndex={FILTERS.indexOf(filter)}
        onChange={({ name }) => setFilter(name as Filter)}
      >
        {FILTERS.map((s) => (
          <Switch
            key={s}
            name={s}
            text={`${FILTER_LABEL[s]}${counts[s] > 0 ? ` (${counts[s]})` : ""}`}
          />
        ))}
      </ContentSwitcher>

      {isLoading ? (
        <div aria-busy="true" aria-label="Loading requests">
          <SkeletonText paragraph lineCount={4} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="lt-panel">
          <EmptyState
            Icon={DocumentBlank}
            title={filter === "all" ? "No requests yet." : `No ${filter.replace("_", " ")} requests.`}
            description={filter === "all" ? "Submit a request and the lender will review it." : undefined}
            action={
              filter === "all" && canRequest ? (
                <Button onClick={() => setShowModal(true)} renderIcon={Add}>
                  Submit your first request
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="lt-stack lt-stack--tight">
          {filtered.map((req) => (
            <RequestCard key={req.id} req={req} onCancel={(id) => cancelMutation.mutate(id)} />
          ))}
        </div>
      )}

      {!canRequest && (
        <Notice kind="warning">
          You have {active.length}/3 active requests. Cancel or wait for one to be reviewed before submitting another.
        </Notice>
      )}

      {showModal && (
        <RequestLoanModal
          onClose={() => setShowModal(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["my-requests"] })}
        />
      )}
    </div>
  );
}
