import { CheckmarkFilled, ChevronUp, Close, DocumentAdd, TrashCan, View } from "@carbon/icons-react";
import {
  Button,
  ContentSwitcher,
  InlineLoading,
  Layer,
  Select,
  SelectItem,
  SkeletonText,
  Switch,
  Tag,
  TextArea,
  TextInput,
} from "@carbon/react";
import { useEffect, useState } from "react";
import { adminApi, loanRequestsApi } from "../../api";
import type { LoanRequest } from "../../types";
import { formatCurrency, formatDate } from "../../utils/dateUtils";
import { ConfirmDialog, EmptyState, Notice, PageHeader } from "../../components/common";

type TagType = "magenta" | "blue" | "green" | "red";

const STATUS_TAG: Record<string, TagType> = {
  requested: "magenta",
  under_review: "blue",
  approved: "green",
  rejected: "red",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Pending",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
};

const FILTERS = ["all", "requested", "under_review", "approved", "rejected"] as const;
type Filter = (typeof FILTERS)[number];

export default function RequestsPage() {
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  // Lender terms — set by the admin here, at approval time, never by the
  // borrower's original request (see docs: loan request scope change).
  const [approvalTerms, setApprovalTerms] = useState<Record<string, { rate: number; cycle: 15 | 30 }>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);
  // Inline validation message per request (replaces window.alert).
  const [formError, setFormError] = useState<Record<string, string>>({});

  useEffect(() => {
    loanRequestsApi.listAll().then(setRequests).finally(() => setLoading(false));
  }, []);

  const handleOpen = async (req: LoanRequest) => {
    if (req.status !== "requested") {
      setExpanded(expanded === req.id ? null : req.id);
      return;
    }
    const updated = await loanRequestsApi.open(req.id);
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setExpanded(req.id);
  };

  const handleDeleteRequest = async (id: string) => {
    await adminApi.deleteRequest(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setDeleteRequestId(null);
  };

  const handleReview = async (req: LoanRequest, status: "approved" | "rejected") => {
    if (status === "rejected" && !rejectionReason[req.id]) {
      setFormError({ ...formError, [req.id]: "Please provide a rejection reason" });
      return;
    }
    const terms = approvalTerms[req.id];
    if (status === "approved" && (!terms?.rate || !terms?.cycle)) {
      setFormError({ ...formError, [req.id]: "Set an interest rate and payment frequency before approving" });
      return;
    }
    setFormError({ ...formError, [req.id]: "" });
    setActing(req.id);
    try {
      const updated = await loanRequestsApi.review(req.id, {
        status,
        rejection_reason: status === "rejected" ? rejectionReason[req.id] : undefined,
        rate: status === "approved" ? terms.rate : undefined,
        cycle: status === "approved" ? terms.cycle : undefined,
      });
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setExpanded(null);
    } finally {
      setActing(null);
    }
  };

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const pending = requests.filter((r) => r.status === "requested" || r.status === "under_review").length;

  return (
    <div className="lt-page lt-stack lt-stack--loose">
      <PageHeader
        title="Loan Requests"
        subtitle={
          pending > 0
            ? `${pending} request${pending !== 1 ? "s need" : " needs"} attention`
            : "All requests reviewed"
        }
      />

      <div className="lt-filter-switcher">
        <ContentSwitcher
          size="md"
          selectedIndex={FILTERS.indexOf(filter)}
          onChange={({ name }) => setFilter(name as Filter)}
        >
          {FILTERS.map((s) => (
            <Switch key={s} name={s} text={s === "all" ? "All" : STATUS_LABEL[s]} />
          ))}
        </ContentSwitcher>
      </div>

      {loading ? (
        <div aria-busy="true" aria-label="Loading requests">
          <SkeletonText paragraph lineCount={4} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="lt-panel">
          <EmptyState
            Icon={DocumentAdd}
            title="No requests found."
            description={filter === "all" ? "Borrower loan requests will appear here." : "No requests match this status."}
          />
        </div>
      ) : (
        <div className="lt-stack lt-stack--tight">
          {filtered.map((req) => (
            <article
              key={req.id}
              className={`lt-item${
                req.status === "requested"
                  ? " lt-item--attention"
                  : req.status === "under_review"
                    ? " lt-item--info"
                    : ""
              }`}
            >
              <div className="lt-item__top">
                <div className="lt-item__main">
                  <div className="lt-row">
                    <Tag size="sm" type={STATUS_TAG[req.status]}>
                      {STATUS_LABEL[req.status]}
                    </Tag>
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
                      <span>Terms not yet set</span>
                    )}
                    <span>Submitted {formatDate(req.created_at)}</span>
                  </div>
                </div>
                <div className="lt-item__actions">
                  <Button
                    kind="ghost"
                    size="md"
                    renderIcon={expanded === req.id ? ChevronUp : View}
                    aria-expanded={expanded === req.id}
                    onClick={() => handleOpen(req)}
                  >
                    {req.status === "requested" ? "Review" : "Details"}
                  </Button>
                  <Button
                    kind="danger--ghost"
                    size="md"
                    hasIconOnly
                    renderIcon={TrashCan}
                    iconDescription="Delete request"
                    tooltipPosition="left"
                    onClick={() => setDeleteRequestId(req.id)}
                  />
                </div>
              </div>

              {expanded === req.id && (
                <div className="lt-item__detail lt-stack">
                  {req.reason && (
                    <div className="lt-quote-box">
                      <p className="lt-quote-box__label">Borrower&apos;s Reason</p>
                      <p>{req.reason}</p>
                    </div>
                  )}

                  {req.status === "rejected" && req.rejection_reason && (
                    <Notice kind="error" title="Rejection reason">
                      {req.rejection_reason}
                    </Notice>
                  )}

                  {req.status === "under_review" && (
                    <Layer>
                      <div className="lt-stack">
                        <div className="lt-quote-box">
                          <p className="lt-quote-box__label">Set lender terms (required to approve)</p>
                          <div className="lt-form__grid">
                            <TextInput
                              id={`rate-${req.id}`}
                              type="number"
                              min="0.01"
                              max="100"
                              step="0.01"
                              inputMode="decimal"
                              labelText="Interest Rate (%)"
                              value={approvalTerms[req.id]?.rate ?? ""}
                              onChange={(e) =>
                                setApprovalTerms({
                                  ...approvalTerms,
                                  [req.id]: { cycle: approvalTerms[req.id]?.cycle ?? 15, rate: Number(e.target.value) },
                                })
                              }
                            />
                            <Select
                              id={`cycle-${req.id}`}
                              labelText="Payment Frequency"
                              value={approvalTerms[req.id]?.cycle ?? 15}
                              onChange={(e) =>
                                setApprovalTerms({
                                  ...approvalTerms,
                                  [req.id]: { rate: approvalTerms[req.id]?.rate ?? 0, cycle: Number(e.target.value) as 15 | 30 },
                                })
                              }
                            >
                              <SelectItem value={15} text="Bi-monthly (15 days)" />
                              <SelectItem value={30} text="Monthly (30 days)" />
                            </Select>
                          </div>
                        </div>

                        <TextArea
                          id={`reject-${req.id}`}
                          labelText="Rejection Reason (required if rejecting)"
                          rows={2}
                          placeholder="Explain why this request is being rejected..."
                          value={rejectionReason[req.id] ?? ""}
                          onChange={(e) => setRejectionReason({ ...rejectionReason, [req.id]: e.target.value })}
                        />

                        {formError[req.id] && <Notice kind="error">{formError[req.id]}</Notice>}

                        <div className="lt-row lt-row--end lt-row--flush">
                          <Button
                            kind="danger"
                            renderIcon={Close}
                            onClick={() => handleReview(req, "rejected")}
                            disabled={acting === req.id}
                          >
                            Reject
                          </Button>
                          <Button
                            renderIcon={acting === req.id ? undefined : CheckmarkFilled}
                            onClick={() => handleReview(req, "approved")}
                            disabled={acting === req.id}
                          >
                            {acting === req.id ? <InlineLoading description="Working…" /> : "Approve & create loan"}
                          </Button>
                        </div>
                      </div>
                    </Layer>
                  )}

                  {req.status === "approved" && (
                    <div className="lt-row">
                      <CheckmarkFilled size={16} className="lt-success-icon" aria-hidden="true" />
                      <span>
                        Approved {req.reviewed_at ? `on ${formatDate(req.reviewed_at)} ` : ""}· Loan account created
                      </span>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {deleteRequestId && (
        <ConfirmDialog
          title="Delete Request"
          message="This will permanently delete this loan request record."
          confirmLabel="Delete request"
          dangerous
          onConfirm={() => handleDeleteRequest(deleteRequestId)}
          onCancel={() => setDeleteRequestId(null)}
        />
      )}
    </div>
  );
}
