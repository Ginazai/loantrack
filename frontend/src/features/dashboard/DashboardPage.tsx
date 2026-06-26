import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Inbox,
  TrendingDown,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { accountsApi } from "../../api";
import { StatusBadge } from "../../components/common";
import { useAuthStore } from "../../stores/authStore";
import { formatCurrency, formatDate, isOverdue } from "../../utils/dateUtils";

function StatTile({
  title,
  value,
  sub,
  Icon,
  accent = false,
  danger = false,
}: {
  title: string;
  value: string;
  sub?: string;
  Icon: React.ElementType;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`card bg-base-100 shadow-sm border ${
        danger ? "border-error/30 card-ledger-warning" : accent ? "card-ledger border-base-300" : "border-base-300"
      }`}
    >
      <div className="card-body p-4 gap-0">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-base-content/40">
            {title}
          </span>
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center ${
              danger ? "bg-error/10 text-error" : accent ? "bg-primary/10 text-primary" : "bg-base-200 text-base-content/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </div>
        </div>
        <p className="stat-value-mono text-2xl font-bold leading-none">{value}</p>
        {sub && <p className="text-xs text-base-content/40 mt-1.5 font-mono">{sub}</p>}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accountsApi.list(),
  });

  const active = accounts.filter((a) => a.status === "active" || a.status === "open");
  const overdue = active.filter((a) => isOverdue(a.next_due_date));
  const totalOutstanding = active.reduce(
    (sum, a) => sum + parseFloat(a.current_balance ?? a.borrow_amount),
    0
  );
  const totalPrincipal = active.reduce(
    (sum, a) => sum + parseFloat(a.borrow_amount),
    0
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {user?.full_name?.split(" ")[0]}'s Ledger
        </h1>
        <p className="text-sm text-base-content/40 mt-0.5 font-mono">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          title="Active Loans"
          value={String(active.length)}
          sub={`${accounts.filter((a) => a.status === "open").length} open`}
          Icon={ClipboardList}
          accent
        />
        <StatTile
          title="Outstanding"
          value={formatCurrency(totalOutstanding)}
          sub={`of ${formatCurrency(totalPrincipal)}`}
          Icon={TrendingDown}
        />
        <StatTile
          title="Overdue"
          value={String(overdue.length)}
          sub={overdue.length > 0 ? "Needs attention" : "All current"}
          Icon={overdue.length > 0 ? AlertTriangle : CheckCircle2}
          danger={overdue.length > 0}
        />
        <StatTile
          title="Total Accounts"
          value={String(accounts.length)}
          sub={`${accounts.filter((a) => a.status === "closed").length} closed`}
          Icon={BarChart3}
        />
      </div>

      {/* Overdue */}
      {overdue.length > 0 && (
        <div className="card bg-error/5 border border-error/20">
          <div className="card-body p-5">
            <h2 className="text-sm font-bold text-error flex items-center gap-2 mb-3 uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4" />
              Overdue Payments
            </h2>
            <div className="space-y-2">
              {overdue.map((a) => (
                <Link
                  key={a.id}
                  to={`/accounts/${a.id}`}
                  className="flex items-center justify-between bg-base-100 rounded-md px-4 py-3 hover:shadow-sm transition-shadow border border-base-200"
                >
                  <div>
                    <p className="font-semibold text-sm">{a.account_name}</p>
                    <p className="text-xs text-base-content/40">{a.borrower_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="stat-value-mono font-bold text-sm text-error">
                      {formatCurrency(a.current_balance ?? a.borrow_amount)}
                    </p>
                    <p className="text-xs text-error/60 font-mono">
                      Due {a.next_due_date ? formatDate(a.next_due_date) : "—"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent accounts */}
      <div className="card bg-base-100 shadow-sm border border-base-300">
        <div className="card-body p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sm uppercase tracking-wider text-base-content/60">
              Recent Accounts
            </h2>
            <Link to="/accounts" className="btn btn-ghost btn-xs gap-1 text-primary">
              View all
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md text-primary" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-10 text-base-content/40">
              <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No accounts yet.</p>
              <Link to="/accounts" className="btn btn-primary btn-sm mt-4">
                Create your first account
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr className="bg-base-200 text-xs uppercase tracking-wider text-base-content/40">
                    <th className="rounded-l-md">Account</th>
                    <th>Borrower</th>
                    <th className="text-right">Balance</th>
                    <th>Next Due</th>
                    <th className="rounded-r-md">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.slice(0, 8).map((a) => (
                    <tr
                      key={a.id}
                      className="hover cursor-pointer border-t border-base-200"
                      onClick={() => navigate(`/accounts/${a.id}`)}
                    >
                      <td className="font-medium">{a.account_name}</td>
                      <td className="text-base-content/60 text-sm">{a.borrower_name}</td>
                      <td className="text-right stat-value-mono text-sm font-semibold">
                        {formatCurrency(a.current_balance ?? a.borrow_amount)}
                      </td>
                      <td
                        className={`text-sm font-mono ${
                          isOverdue(a.next_due_date) ? "text-error font-semibold" : "text-base-content/60"
                        }`}
                      >
                        {a.next_due_date ? formatDate(a.next_due_date) : "—"}
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
