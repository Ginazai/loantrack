import { useEffect, useState } from "react";
import { adminApi, loanRequestsApi } from "../../api";
import type { LoanRequest } from "../../types";
import { CheckCircle2, XCircle, Eye, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { formatCurrency, formatDate } from "../../utils/dateUtils";
import { ConfirmDialog } from "../../components/common";

const STATUS_BADGE: Record<string, string> = {
  requested: "badge-warning",
  under_review: "badge-info",
  approved: "badge-success",
  rejected: "badge-error",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Pending",
  under_review: "Under Review",
  approved: "Approved",
  rejected: "Rejected",
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<LoanRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "requested" | "under_review" | "approved" | "rejected">("all");
  const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);

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
      alert("Please provide a rejection reason");
      return;
    }
    setActing(req.id);
    try {
      const updated = await loanRequestsApi.review(req.id, {
        status,
        rejection_reason: status === "rejected" ? rejectionReason[req.id] : undefined,
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
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Loan Requests</h1>
          <p className="text-sm text-base-content/50 mt-0.5">
            {pending > 0 ? (
              <span className="text-warning font-semibold">{pending} request{pending !== 1 ? "s" : ""} need attention</span>
            ) : "All requests reviewed"}
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "requested", "under_review", "approved", "rejected"] as const).map((s) => (
            <button
              key={s}
              className={`btn btn-xs ${filter === s ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? "All" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center"><span className="loading loading-spinner loading-md text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body p-10 text-center text-base-content/40 text-sm">No requests found.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => (
            <div key={req.id} className={`card bg-base-100 border shadow-sm ${
              req.status === "requested" ? "border-warning/40 card-ledger-warning" :
              req.status === "under_review" ? "border-info/40 card-ledger" : "border-base-300"
            }`}>
              <div className="card-body p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`badge badge-sm ${STATUS_BADGE[req.status]}`}>
                        {STATUS_LABEL[req.status]}
                      </span>
                      <span className="font-semibold text-sm">{req.account_name}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-base-content/50 font-mono">
                      <span>{formatCurrency(Number(req.borrow_amount))}</span>
                      <span>{(Number(req.rate) * 100).toFixed(2)}%</span>
                      <span>{req.cycle === 15 ? "Bi-monthly" : "Monthly"}</span>
                      <span>Submitted {formatDate(req.created_at)}</span>
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm gap-1"
                    onClick={() => handleOpen(req)}
                  >
                    {expanded === req.id ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {req.status === "requested" ? "Review" : "Details"}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm text-error"
                    onClick={() => setDeleteRequestId(req.id)}
                    title="Delete request"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {expanded === req.id && (
                  <div className="mt-4 pt-4 border-t border-base-200 space-y-4">
                    {req.reason && (
                      <div className="bg-base-200 rounded-md p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-1">Borrower's Reason</p>
                        <p className="text-sm">{req.reason}</p>
                      </div>
                    )}

                    {req.status === "rejected" && req.rejection_reason && (
                      <div className="bg-error/10 border border-error/20 rounded-md p-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-error/60 mb-1">Rejection Reason</p>
                        <p className="text-sm text-error/80">{req.rejection_reason}</p>
                      </div>
                    )}

                    {(req.status === "under_review") && (
                      <div className="space-y-3">
                        <div className="form-control">
                          <label className="label py-1">
                            <span className="label-text text-xs font-semibold uppercase tracking-wide">
                              Rejection Reason <span className="text-base-content/30">(required if rejecting)</span>
                            </span>
                          </label>
                          <textarea
                            className="textarea textarea-bordered textarea-sm text-sm"
                            rows={2}
                            placeholder="Explain why this request is being rejected..."
                            value={rejectionReason[req.id] ?? ""}
                            onChange={(e) => setRejectionReason({ ...rejectionReason, [req.id]: e.target.value })}
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            className="btn btn-error btn-sm gap-1.5"
                            onClick={() => handleReview(req, "rejected")}
                            disabled={acting === req.id}
                          >
                            <XCircle className="w-4 h-4" /> Reject
                          </button>
                          <button
                            className="btn btn-success btn-sm gap-1.5"
                            onClick={() => handleReview(req, "approved")}
                            disabled={acting === req.id}
                          >
                            {acting === req.id ? <span className="loading loading-spinner loading-xs" /> : <CheckCircle2 className="w-4 h-4" />}
                            Approve & Create Loan
                          </button>
                        </div>
                      </div>
                    )}

                    {req.status === "approved" && (
                      <div className="flex items-center gap-2 text-success text-sm">
                        <CheckCircle2 className="w-4 h-4" />
                        Approved {req.reviewed_at ? `on ${formatDate(req.reviewed_at)}` : ""}· Loan account created
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {deleteRequestId && (
        <ConfirmDialog
          title="Delete Request"
          message="This will permanently delete this loan request record."
          confirmLabel="Delete Request"
          dangerous
          onConfirm={() => handleDeleteRequest(deleteRequestId)}
          onCancel={() => setDeleteRequestId(null)}
        />
      )}
    </div>
  );
}
