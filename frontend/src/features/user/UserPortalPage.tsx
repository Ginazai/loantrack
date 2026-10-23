import {
  Book,
  Calendar,
  ChevronDown,
  ChevronUp,
  Currency,
  WarningAltFilled,
  Catalog,
} from "@carbon/icons-react";
import { Button, ProgressBar, SkeletonText, Tag } from "@carbon/react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, paymentsApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { formatCurrency, formatDate, formatRate, isOverdue } from "../../utils/dateUtils";
import type { LoanAccount, Payment } from "../../types";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "../../components/common";
import { BalanceChart } from "../accounts/Charts";

function LoanCard({ account }: { account: LoanAccount }) {
  const [expanded, setExpanded] = useState(false);
  const overdue = isOverdue(account.next_due_date);

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", account.id],
    queryFn: () => paymentsApi.list(account.id),
    enabled: expanded,
  });

  const principal = Number(account.borrow_amount);
  const balance = Number(account.current_balance ?? principal);
  const pct = Math.min(100, Math.max(0, ((principal - balance) / principal) * 100));
  const detailId = `loan-detail-${account.id}`;

  return (
    <article className={`lt-loan${overdue ? " lt-loan--overdue" : ""}`}>
      <div className="lt-loan__top">
        <div>
          <div className="lt-row">
            <h2 className="lt-loan__name">{account.account_name}</h2>
            <StatusBadge status={account.status} />
            {overdue && (
              <Tag size="sm" type="magenta" renderIcon={WarningAltFilled}>
                Overdue
              </Tag>
            )}
          </div>
          <p className="lt-loan__meta">
            Since {formatDate(account.start_date)} · {formatRate(account.rate)} / {account.cycle} days
          </p>
        </div>
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
      </div>

      <div className="lt-loan__figures">
        {[
          { label: "Balance", value: formatCurrency(balance), danger: false },
          { label: "Original", value: formatCurrency(principal), danger: false },
          { label: "Next Due", value: account.next_due_date ? formatDate(account.next_due_date) : "—", danger: overdue },
        ].map(({ label, value, danger }) => (
          <div key={label} className="lt-figure">
            <p className="lt-figure__label">{label}</p>
            <p className={`lt-figure__value${danger ? " lt-danger-text" : ""}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="lt-loan__progress">
        <ProgressBar
          size="small"
          label="Paid off"
          value={pct}
          max={100}
          helperText={`${pct.toFixed(1)}%`}
        />
      </div>

      {expanded && (
        <div className="lt-loan__detail lt-stack" id={detailId}>
          {payments.length > 0 && (
            <BalanceChart payments={payments} borrowAmount={account.borrow_amount} />
          )}
          <div>
            <h3 className="lt-eyebrow" style={{ marginBlockEnd: "0.5rem" }}>Payment History</h3>
            {payments.length === 0 ? (
              <p className="lt-muted">No payments yet.</p>
            ) : (
              <div>
                {[...payments].reverse().map((p: Payment) => (
                  <div key={p.id} className="lt-ledger-row">
                    <div>
                      <p className="lt-ledger-row__amount">+{formatCurrency(Number(p.amount))}</p>
                      <p className="lt-link-list__sub">
                        {formatDate(p.payment_date)} · Interest: {formatCurrency(Number(p.interests_accrued))}
                      </p>
                    </div>
                    <div style={{ textAlign: "end" }}>
                      <p className="lt-link-list__sub">Balance after</p>
                      <p className="lt-link-list__name">{formatCurrency(Number(p.balance_after))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default function UserPortalPage() {
  const { user } = useAuthStore();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accountsApi.list(),
  });

  const open = accounts.filter((a) => a.status === "open" || a.status === "active");
  const closed = accounts.filter((a) => a.status === "closed" || a.status === "paid");
  const totalBalance = open.reduce((s, a) => s + Number(a.current_balance ?? a.borrow_amount), 0);
  const earliest = open
    .filter((a) => a.next_due_date)
    .sort((a, b) => (a.next_due_date ?? "").localeCompare(b.next_due_date ?? ""))[0];

  return (
    <div className="lt-page lt-page--narrow lt-stack lt-stack--loose">
      <PageHeader
        title={`${user?.full_name?.split(" ")[0]}'s Loans`}
        subtitle={new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      />

      {!isLoading && open.length > 0 && (
        <section className="lt-kpis lt-kpis--3" aria-label="Loan summary">
          <StatCard title="Total Balance" value={formatCurrency(totalBalance)} Icon={Currency} />
          <StatCard title="Active Loans" value={String(open.length)} Icon={Catalog} />
          <StatCard
            title="Next Due"
            value={earliest ? formatDate(earliest.next_due_date!) : "—"}
            Icon={Calendar}
          />
        </section>
      )}

      {isLoading ? (
        <div aria-busy="true" aria-label="Loading loans">
          <SkeletonText heading width="40%" />
          <SkeletonText paragraph lineCount={4} />
        </div>
      ) : accounts.length === 0 ? (
        <div className="lt-panel">
          <EmptyState
            Icon={Book}
            title="No loans yet."
            description="Submit a loan request to get started."
          />
        </div>
      ) : (
        <div className="lt-stack lt-stack--tight">
          {open.map((a) => <LoanCard key={a.id} account={a} />)}
          {closed.length > 0 && (
            <>
              <h2 className="lt-eyebrow" style={{ marginBlockStart: "1.5rem" }}>Closed / Paid</h2>
              {closed.map((a) => <LoanCard key={a.id} account={a} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
