import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { accountsApi, paymentsApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { formatCurrency, formatDate, formatRate, isOverdue } from "../../utils/dateUtils";
import type { LoanAccount, Payment } from "../../types";
import {
  AlertCircle, BookOpen, CalendarDays,
  ChevronDown, ChevronUp, CircleDollarSign, TrendingDown,
} from "lucide-react";
import { StatusBadge } from "../../components/common";
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

  return (
    <div className={`card bg-base-100 shadow border ${overdue ? "border-warning/40 card-ledger-warning" : "border-base-300 card-ledger"}`}>
      <div className="card-body p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-base">{account.account_name}</h2>
              <StatusBadge status={account.status} />
              {overdue && (
                <span className="badge badge-warning badge-sm gap-1">
                  <AlertCircle className="w-3 h-3" />Overdue
                </span>
              )}
            </div>
            <p className="text-xs text-base-content/40 mt-0.5">
              Since {formatDate(account.start_date)} · {formatRate(account.rate)} / {account.cycle} days
            </p>
          </div>
          <button className="btn btn-ghost btn-sm btn-square" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            { label: "Balance",   value: formatCurrency(balance),   cls: "text-base-content" },
            { label: "Original",  value: formatCurrency(principal),  cls: "text-base-content/70" },
            { label: "Next Due",  value: account.next_due_date ? formatDate(account.next_due_date) : "—", cls: overdue ? "text-warning" : "text-base-content" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-base-200 rounded-md px-3 py-2.5">
              <p className="text-xs text-base-content/50 uppercase tracking-wide font-semibold">{label}</p>
              <p className={`stat-value-mono text-sm font-bold mt-0.5 ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-base-content/40 mb-1">
            <span>Paid off</span>
            <span className="font-mono font-semibold text-success">{pct.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-base-300 rounded-full h-1.5">
            <div className="bg-success h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-base-200">
          {payments.length > 0 && (
            <div className="p-5 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-3">Balance Over Time</p>
              <BalanceChart payments={payments} borrowAmount={account.borrow_amount} />
            </div>
          )}
          <div className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-3">Payment History</p>
            {payments.length === 0 ? (
              <p className="text-sm text-base-content/40 text-center py-4 italic">No payments yet.</p>
            ) : (
              <div className="space-y-2">
                {[...payments].reverse().map((p: Payment) => (
                  <div key={p.id} className="flex items-center justify-between text-sm bg-base-200 rounded-md px-3 py-2">
                    <div>
                      <p className="font-mono font-semibold text-success">+{formatCurrency(Number(p.amount))}</p>
                      <p className="text-xs text-base-content/40">
                        {formatDate(p.payment_date)} · Interest: {formatCurrency(Number(p.interests_accrued))}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-base-content/50">Balance after</p>
                      <p className="font-mono text-sm font-semibold">{formatCurrency(Number(p.balance_after))}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
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
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {user?.full_name?.split(" ")[0]}'s Loans
        </h1>
        <p className="text-xs text-base-content/40 font-mono mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {!isLoading && open.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex items-center gap-2 text-base-content/50 mb-1">
                <CircleDollarSign className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Total Balance</span>
              </div>
              <p className="stat-value-mono text-xl font-bold">{formatCurrency(totalBalance)}</p>
            </div>
          </div>
          <div className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex items-center gap-2 text-base-content/50 mb-1">
                <TrendingDown className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Active Loans</span>
              </div>
              <p className="stat-value-mono text-xl font-bold text-primary">{open.length}</p>
            </div>
          </div>
          <div className="card bg-base-100 border border-base-300 shadow-sm">
            <div className="card-body p-4">
              <div className="flex items-center gap-2 text-base-content/50 mb-1">
                <CalendarDays className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Next Due</span>
              </div>
              <p className="stat-value-mono text-sm font-bold">
                {earliest ? formatDate(earliest.next_due_date!) : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center"><span className="loading loading-spinner loading-md text-primary" /></div>
      ) : accounts.length === 0 ? (
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body p-12 text-center">
            <BookOpen className="w-10 h-10 mx-auto text-base-content/20 mb-3" />
            <p className="text-sm text-base-content/40">No loans yet.</p>
            <p className="text-xs text-base-content/25 mt-1">Submit a loan request to get started.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((a) => <LoanCard key={a.id} account={a} />)}
          {closed.length > 0 && (
            <>
              <hr className="border-dashed border-base-300 my-2" />
              <p className="text-xs font-semibold uppercase tracking-wider text-base-content/30 px-1">Closed / Paid</p>
              {closed.map((a) => <LoanCard key={a.id} account={a} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
