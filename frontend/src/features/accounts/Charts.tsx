import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Payment } from "../../types";
import { formatCurrency, formatDate } from "../../utils/dateUtils";

// Carbon theme tokens resolve per theme (white / g100), so charts follow dark mode for free.
const C = {
  balance: "var(--cds-interactive)",
  payment: "var(--cds-interactive)",
  interest: "var(--cds-support-error)",
  grid: "var(--cds-border-subtle-01)",
  axis: "var(--cds-text-secondary)",
  cursor: "var(--cds-layer-hover-01)",
};

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

/** Round the Y axis to even, human steps ($5k, $10k, $25k…) with a little headroom above the data. */
function niceTicks(max: number): number[] {
  if (!isFinite(max) || max <= 0) return [0, 1, 2, 3, 4];
  const target = max * 1.05;
  const mag = Math.pow(10, Math.floor(Math.log10(target)) - 1);
  const step =
    [1, 2, 2.5, 5, 10, 20, 25, 50, 100].map((m) => m * mag).find((s) => Math.ceil(target / s) <= 5) ?? target;
  const n = Math.ceil(target / step);
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

const compactUsd = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : `$${v}`;

function ChartTooltip({
  active,
  payload,
  label,
  names,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
  names: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="lt-chart-tooltip">
      <div className="lt-chart-tooltip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="lt-chart-tooltip__row">
          <span className="lt-chart-tooltip__swatch" style={{ background: p.color }} aria-hidden="true" />
          <span>{names[p.dataKey] ?? p.dataKey}</span>
          <strong style={{ marginInlineStart: "auto", paddingInlineStart: "1rem" }}>
            {formatCurrency(p.value)}
          </strong>
        </div>
      ))}
    </div>
  );
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
  const ticks = niceTicks(Math.max(...data.map((d) => d.balance)));

  return (
    <figure className="lt-chart" style={{ margin: 0 }}>
      <figcaption className="lt-chart__title">Balance Over Time</figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke={C.grid} tickLine={false} />
          <YAxis
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={compactUsd}
            tick={{ fontSize: 12 }}
            width={52}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: C.axis, strokeDasharray: "2 2" }}
            content={<ChartTooltip names={{ balance: "Balance" }} />}
          />
          <Area
            type="stepAfter"
            dataKey="balance"
            stroke={C.balance}
            strokeWidth={2}
            fill={C.balance}
            fillOpacity={0.12}
            dot={{ r: 3, fill: C.balance, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}

// ── Interest Per Cycle ────────────────────────────────────────────────────────

export function InterestChart({ payments }: { payments: Payment[] }) {
  const data = payments.map((p) => ({
    date: formatDate(p.payment_date),
    interest: parseFloat(p.interests_accrued),
    payment: parseFloat(p.amount),
  }));
  const ticks = niceTicks(Math.max(...data.map((d) => Math.max(d.interest, d.payment))));

  return (
    <figure className="lt-chart" style={{ margin: 0 }}>
      <figcaption className="lt-chart__title">Interest & Payments per Cycle</figcaption>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }} barGap={2}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke={C.grid} tickLine={false} />
          <YAxis
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
            tickFormatter={compactUsd}
            tick={{ fontSize: 12 }}
            width={52}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: C.cursor }}
            content={<ChartTooltip names={{ interest: "Interest", payment: "Payment" }} />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="square"
            iconSize={8}
            formatter={(v: string) => (v === "interest" ? "Interest" : "Payment")}
          />
          <Bar dataKey="payment" fill={C.payment} isAnimationActive={false} />
          <Bar dataKey="interest" fill={C.interest} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
