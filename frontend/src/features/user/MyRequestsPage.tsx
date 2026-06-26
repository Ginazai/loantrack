import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { loanRequestsApi } from "../../api";
import type { LoanRequest, LoanRequestFormData } from "../../types";
import {
  FileText, Plus, X, Clock, CheckCircle2, XCircle,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { formatCurrency, formatDate } from "../../utils/dateUtils";

type Filter = "all" | "requested" | "under_review" | "approved" | "rejected";

const STATUS_META: Record<string, { badge: string; Icon: React.ElementType; label: string }> = {
  requested:    { badge: "badge-warning",  Icon: Clock,         label: "Pending"      },
  under_review: { badge: "badge-info",     Icon: Clock,         label: "Under Review" },
  approved:     { badge: "badge-success",  Icon: CheckCircle2,  label: "Approved"     },
  rejected:     { badge: "badge-error",    Icon: XCircle,       label: "Rejected"     },
};

function RequestBadge({ status }: { status: string }) {
  const { badge, Icon, label } = STATUS_META[status] ?? { badge: "badge-ghost", Icon: Clock, label: status };
  return (
    <span className={`badge badge-sm gap-1 ${badge}`}>
      <Icon className="w-2.5 h-2.5" />{label}
    </span>
  );
}

function RequestLoanModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<LoanRequestFormData>({ account_name: "", borrow_amount: 0, rate: 5, cycle: 15 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lbl = "label-text text-xs font-semibold uppercase tracking-wide";

  const handleSubmit = async () => {
    if (!form.account_name || !form.borrow_amount) { setError("Fill all required fields"); return; }
    setSaving(true); setError(null);
    try {
      await loanRequestsApi.create(form);
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to submit");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-base-100 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold">New Loan Request</h3>
          <button className="btn btn-ghost btn-sm btn-square" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        {error && <div className="alert alert-error py-2 text-sm mb-4">{error}</div>}
        <div className="space-y-3">
          <div className="form-control">
            <label className="label py-1"><span className={lbl}>Loan Name / Purpose</span></label>
            <input className="input input-bordered input-sm" placeholder="e.g. Home renovation" value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label py-1"><span className={lbl}>Amount</span></label>
              <label className="input input-bordered input-sm flex items-center gap-1.5">
                <span className="text-base-content/40 font-mono text-xs">$</span>
                <input type="number" min="0" step="0.01" className="grow font-mono" value={form.borrow_amount || ""} onChange={(e) => setForm({ ...form, borrow_amount: Number(e.target.value) })} />
              </label>
            </div>
            <div className="form-control">
              <label className="label py-1"><span className={lbl}>Rate %</span></label>
              <label className="input input-bordered input-sm flex items-center gap-1.5">
                <input type="number" min="0.01" max="100" step="0.01" className="grow font-mono" value={form.rate} onChange={(e) => setForm({ ...form, rate: Number(e.target.value) })} />
                <span className="text-base-content/40 font-mono text-xs">%</span>
              </label>
            </div>
          </div>
          <div className="form-control">
            <label className="label py-1"><span className={lbl}>Payment Frequency</span></label>
            <select className="select select-bordered select-sm" value={form.cycle} onChange={(e) => setForm({ ...form, cycle: Number(e.target.value) as 15 | 30 })}>
              <option value={15}>Bi-monthly (15 days)</option>
              <option value={30}>Monthly (30 days)</option>
            </select>
          </div>
          <div className="form-control">
            <label className="label py-1"><span className={lbl}>Reason <span className="text-base-content/30">(optional)</span></span></label>
            <textarea className="textarea textarea-bordered textarea-sm text-sm" rows={2} placeholder="Why do you need this loan?" value={form.reason ?? ""} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={saving}>
            {saving ? <span className="loading loading-spinner loading-xs" /> : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestCard({ req, onCancel }: { req: LoanRequest; onCancel: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cancellable = req.status === "requested" || req.status === "under_review";

  return (
    <div className={`card bg-base-100 border shadow-sm ${
      req.status === "rejected" ? "border-error/20" :
      req.status === "approved" ? "border-success/20 card-ledger-success" :
      req.status === "under_review" ? "card-ledger border-base-300" :
      "card-ledger-warning border-warning/20"
    }`}>
      <div className="card-body p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <RequestBadge status={req.status} />
              <span className="font-semibold text-sm">{req.account_name}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-base-content/50 font-mono">
              <span>{formatCurrency(Number(req.borrow_amount))}</span>
              <span>{(Number(req.rate) * 100).toFixed(2)}%</span>
              <span>{req.cycle === 15 ? "Bi-monthly" : "Monthly"}</span>
              <span>Submitted {formatDate(req.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {(req.reason || req.rejection_reason) && (
              <button className="btn btn-ghost btn-xs" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
            {cancellable && (
              <button className="btn btn-ghost btn-xs text-error" onClick={() => onCancel(req.id)} title="Cancel request">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-base-200 space-y-2">
            {req.reason && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-1">Your Reason</p>
                <p className="text-sm text-base-content/70">{req.reason}</p>
              </div>
            )}
            {req.status === "rejected" && req.rejection_reason && (
              <div className="bg-error/5 border border-error/15 rounded-md p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-error/60 mb-1">Rejection Reason</p>
                <p className="text-sm text-error/80">{req.rejection_reason}</p>
              </div>
            )}
            {req.status === "approved" && (
              <div className="flex items-center gap-2 text-success text-xs">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Approved {req.reviewed_at ? `on ${formatDate(req.reviewed_at)}` : ""} · Loan account created
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Requests</h1>
          <p className="text-sm text-base-content/50 mt-0.5">
            {active.length} active · {3 - active.length} slot{3 - active.length !== 1 ? "s" : ""} remaining
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={() => setShowModal(true)}
          disabled={!canRequest}
          title={!canRequest ? "Max 3 active requests" : ""}
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {(["all", "requested", "under_review", "approved", "rejected"] as Filter[]).map((s) => (
          <button
            key={s}
            className={`btn btn-xs gap-1.5 ${filter === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter(s)}
          >
            {{ all: "All", requested: "Pending", under_review: "Under Review", approved: "Approved", rejected: "Rejected" }[s]}
            {counts[s === "all" ? "all" : s] > 0 && (
              <span className={`badge badge-xs ${filter === s ? "badge-primary-content bg-white/20" : "badge-ghost"}`}>
                {counts[s === "all" ? "all" : s] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="p-10 text-center"><span className="loading loading-spinner loading-md text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body p-12 text-center">
            <FileText className="w-10 h-10 mx-auto text-base-content/20 mb-3" />
            <p className="text-sm text-base-content/40">
              {filter === "all" ? "No requests yet." : `No ${filter.replace("_", " ")} requests.`}
            </p>
            {filter === "all" && canRequest && (
              <button className="btn btn-primary btn-sm mt-4 mx-auto" onClick={() => setShowModal(true)}>
                Submit your first request
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => (
            <RequestCard key={req.id} req={req} onCancel={(id) => cancelMutation.mutate(id)} />
          ))}
        </div>
      )}

      {!canRequest && (
        <p className="text-xs text-center text-warning">
          You have {active.length}/3 active requests. Cancel or wait for one to be reviewed before submitting another.
        </p>
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
