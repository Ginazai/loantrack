import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Payment } from "../../types";
import { formatCurrency, formatDate } from "../../utils/dateUtils";

interface ChartRow {
  date: string;
  balance: number;
  interest: number;
  payment: number;
}

function buildChartData(payments: Payment[], borrowAmount: string): ChartRow[] {
  const rows: ChartRow[] = [
    { date: "Start", balance: parseFloat(borrowAmount), interest: 0, payment: 0 },
  ];
  for (const p of payments) {
    rows.push({
      date: formatDate(p.payment_date),
      balance: parseFloat(p.balance_after),
      interest: parseFloat(p.interests_accrued),
      payment: parseFloat(p.amount),
    });
  }
  return rows;
}

// ── Balance Over Time ─────────────────────────────────────────────────────────

export function BalanceChart({
  payments,
  borrowAmount,
}: {
  payments: Payment[];
  borrowAmount: string;
}) {
  const data = buildChartData(payments, borrowAmount);

  return (
    <div className="bg-base-100 rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold mb-4">Balance Over Time</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="oklch(var(--p))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="oklch(var(--p))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--bc)/0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 11 }}
            width={55}
          />
          <Tooltip
            formatter={(value: number) => [formatCurrency(value), "Balance"]}
            contentStyle={{
              borderRadius: "0.5rem",
              border: "1px solid oklch(var(--bc)/0.15)",
              background: "oklch(var(--b1))",
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="oklch(var(--p))"
            strokeWidth={2}
            fill="url(#balanceGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Interest Per Cycle ────────────────────────────────────────────────────────

export function InterestChart({ payments }: { payments: Payment[] }) {
  const data = payments.map((p) => ({
    date: formatDate(p.payment_date),
    interest: parseFloat(p.interests_accrued),
    payment: parseFloat(p.amount),
  }));

  return (
    <div className="bg-base-100 rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold mb-4">Interest & Payments per Cycle</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(var(--bc)/0.1)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} width={55} />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatCurrency(value),
              name === "interest" ? "Interest" : "Payment",
            ]}
            contentStyle={{
              borderRadius: "0.5rem",
              border: "1px solid oklch(var(--bc)/0.15)",
              background: "oklch(var(--b1))",
            }}
          />
          <Bar dataKey="payment" fill="oklch(var(--p))" radius={[4, 4, 0, 0]} />
          <Bar dataKey="interest" fill="oklch(var(--er)/0.7)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
