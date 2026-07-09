import type { AccountStatus } from "../../types";
const cfg: Record<AccountStatus, { label: string; cls: string }> = {
  open:   { label: "Open",   cls: "badge-info"    },
  active: { label: "Active", cls: "badge-success"  },
  paid:   { label: "Paid",   cls: "badge-neutral"  },
  closed: { label: "Closed", cls: "badge-error"    },
};
export function StatusBadge({ status }: { status: AccountStatus }) {
  const c = cfg[status] ?? { label: status, cls: "badge-ghost" };
  return <span className={`badge badge-sm ${c.cls}`}>{c.label}</span>;
}
