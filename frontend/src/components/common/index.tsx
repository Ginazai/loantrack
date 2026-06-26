import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { AccountStatus } from "../../types";

// ── Status Badge ──────────────────────────────────────────────────────────────

const statusConfig: Record<AccountStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "badge-info" },
  active: { label: "Active", className: "badge-success" },
  paid: { label: "Paid", className: "badge-neutral" },
  closed: { label: "Closed", className: "badge-error" },
};

export function StatusBadge({ status }: { status: AccountStatus }) {
  const cfg = statusConfig[status] ?? { label: status, className: "badge-ghost" };
  return <span className={`badge badge-sm ${cfg.className}`}>{cfg.label}</span>;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

export function StatCard({
  title,
  value,
  desc,
  Icon,
}: {
  title: string;
  value: string;
  desc?: string;
  Icon?: LucideIcon;
}) {
  return (
    <div className="stat bg-base-100 rounded-2xl shadow-sm">
      <div className="stat-figure text-primary">
        {Icon && <Icon className="w-8 h-8" />}
      </div>
      <div className="stat-title text-base-content/60">{title}</div>
      <div className="stat-value text-lg font-bold">{value}</div>
      {desc && <div className="stat-desc">{desc}</div>}
    </div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmWord?: string;
  onConfirm: () => void;
  onCancel: () => void;
  dangerous?: boolean;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  confirmWord,
  onConfirm,
  onCancel,
  dangerous = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const canConfirm = !confirmWord || typed === confirmWord;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-base-100 rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="font-bold text-lg mb-2">{title}</h3>
        <p className="text-base-content/70 text-sm mb-4">{message}</p>

        {confirmWord && (
          <div className="mb-4">
            <label className="label">
              <span className="label-text text-sm">
                Type <strong>{confirmWord}</strong> to confirm
              </span>
            </label>
            <input
              className="input input-bordered input-sm w-full"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmWord}
            />
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`btn btn-sm ${dangerous ? "btn-error" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-base-content/60 text-sm mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
