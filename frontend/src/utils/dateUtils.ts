import {
  format,
  addMonths,
  setDate,
  getDaysInMonth,
  isAfter,
  isSameDay,
  parseISO,
} from "date-fns";

/** Return the 30th of a month, or last day if the month is shorter. */
function monthThirtieth(year: number, month: number): Date {
  const lastDay = getDaysInMonth(new Date(year, month, 1));
  return new Date(year, month, Math.min(30, lastDay));
}

/** Return the next cycle date (15th or 30th) on or after fromDate. */
export function nextCycleDate(fromDate: Date): Date {
  const y = fromDate.getFullYear();
  const m = fromDate.getMonth();
  const d = fromDate.getDate();

  if (d <= 15) return new Date(y, m, 15);

  const thirtieth = monthThirtieth(y, m);
  if (fromDate <= thirtieth) return thirtieth;

  // Past the thirtieth — next month's 15th
  const next = addMonths(new Date(y, m, 1), 1);
  return new Date(next.getFullYear(), next.getMonth(), 15);
}

/** Advance from one cycle date to the next. */
export function advanceCycle(current: Date): Date {
  const y = current.getFullYear();
  const m = current.getMonth();

  if (current.getDate() === 15) {
    return monthThirtieth(y, m);
  }
  // current is a "thirtieth"
  const next = addMonths(new Date(y, m, 1), 1);
  return new Date(next.getFullYear(), next.getMonth(), 15);
}

/** Return the next cycle date strictly after reference. */
export function getNextDueDate(reference: Date): Date {
  const candidate = nextCycleDate(reference);
  if (isSameDay(candidate, reference)) return advanceCycle(candidate);
  return candidate;
}

/** Return the next N upcoming cycle dates from today. */
export function upcomingCycleDates(count = 6, from?: Date): Date[] {
  const dates: Date[] = [];
  let current = nextCycleDate(from ?? new Date());
  for (let i = 0; i < count; i++) {
    dates.push(current);
    current = advanceCycle(current);
  }
  return dates;
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? parseISO(d) : d;
  return format(date, "MMM d, yyyy");
}

export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatRate(rate: string | number): string {
  const num = typeof rate === "string" ? parseFloat(rate) : rate;
  return `${(num * 100).toFixed(2)}%`;
}

export function isOverdue(nextDueDate: string | null): boolean {
  if (!nextDueDate) return false;
  return isAfter(new Date(), parseISO(nextDueDate));
}
