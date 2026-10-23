import {
  ArrowRight,
  Catalog,
  CheckmarkFilled,
  DataTable as DataTableIcon,
  Money,
  Receipt,
  WarningAltFilled,
} from "@carbon/icons-react";
import { Button, DataTableSkeleton, SkeletonText } from "@carbon/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { accountsApi } from "../../api";
import { EmptyState, PageHeader, StatCard } from "../../components/common";
import { useAuthStore } from "../../stores/authStore";
import { formatCurrency, formatDate, isOverdue } from "../../utils/dateUtils";
import { AccountsTable } from "../accounts/AccountsTable";

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
  const totalPrincipal = active.reduce((sum, a) => sum + parseFloat(a.borrow_amount), 0);

  return (
    <div className="lt-page lt-stack lt-stack--loose">
      <PageHeader
        title={`${user?.full_name?.split(" ")[0]}'s Ledger`}
        subtitle={new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      />

      {/* Stats */}
      {isLoading ? (
        <div className="lt-kpis" aria-busy="true" aria-label="Loading summary">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="lt-kpi">
              <SkeletonText width="40%" />
              <SkeletonText heading width="60%" />
            </div>
          ))}
        </div>
      ) : (
        <section className="lt-kpis" aria-label="Portfolio summary">
          <StatCard
            title="Active Loans"
            value={String(active.length)}
            desc={`${accounts.filter((a) => a.status === "open").length} open`}
            Icon={Catalog}
          />
          <StatCard
            title="Outstanding"
            value={formatCurrency(totalOutstanding)}
            desc={`of ${formatCurrency(totalPrincipal)}`}
            Icon={Money}
          />
          <StatCard
            title="Overdue"
            value={String(overdue.length)}
            desc={overdue.length > 0 ? "Needs attention" : "All current"}
            Icon={overdue.length > 0 ? WarningAltFilled : CheckmarkFilled}
            tone={overdue.length > 0 ? "danger" : "default"}
          />
          <StatCard
            title="Total Accounts"
            value={String(accounts.length)}
            desc={`${accounts.filter((a) => a.status === "closed").length} closed`}
            Icon={DataTableIcon}
          />
        </section>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <section className="lt-panel lt-panel--alert" aria-labelledby="overdue-heading">
          <div className="lt-panel__header">
            <h2 className="lt-panel__title" id="overdue-heading">
              <WarningAltFilled size={20} className="lt-danger-icon" aria-hidden="true" />
              Overdue Payments
            </h2>
          </div>
          <ul className="lt-link-list">
            {overdue.map((a) => (
              <li key={a.id}>
                <Link to={`/accounts/${a.id}`}>
                  <div>
                    <div className="lt-link-list__name">{a.account_name}</div>
                    <div className="lt-link-list__sub">{a.borrower_name}</div>
                  </div>
                  <div>
                    <div className="lt-link-list__amount lt-danger-text">
                      {formatCurrency(a.current_balance ?? a.borrow_amount)}
                    </div>
                    <div className="lt-link-list__sub">
                      Due {a.next_due_date ? formatDate(a.next_due_date) : "—"}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent accounts */}
      <section className="lt-panel" aria-labelledby="recent-heading">
        <div className="lt-panel__header">
          <h2 className="lt-panel__title" id="recent-heading">
            Recent Accounts
          </h2>
          <Button kind="ghost" size="md" renderIcon={ArrowRight} onClick={() => navigate("/accounts")}>
            View all
          </Button>
        </div>

        {isLoading ? (
          <DataTableSkeleton
            columnCount={5}
            rowCount={5}
            showHeader={false}
            showToolbar={false}
            aria-label="Loading accounts"
          />
        ) : accounts.length === 0 ? (
          <EmptyState
            Icon={Receipt}
            title="No accounts yet"
            description="Create the first loan account to start tracking balances, interest and payments."
            action={
              <Button onClick={() => navigate("/accounts")} renderIcon={ArrowRight}>
                Create your first account
              </Button>
            }
          />
        ) : (
          <AccountsTable accounts={accounts.slice(0, 8)} variant="summary" />
        )}
      </section>
    </div>
  );
}
