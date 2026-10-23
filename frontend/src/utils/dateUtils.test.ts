import { describe, it, expect } from "vitest";
import {
  nextCycleDate,
  advanceCycle,
  getNextDueDate,
  upcomingCycleDates,
  formatDate,
  formatCurrency,
  formatRate,
  isOverdue,
} from "./dateUtils";

describe("nextCycleDate", () => {
  it("returns the 15th when day is before the 15th", () => {
    const result = nextCycleDate(new Date(2026, 5, 3)); // June 3
    expect(result).toEqual(new Date(2026, 5, 15));
  });

  it("returns the same day when exactly on the 15th", () => {
    // Mirrors the backend's next_cycle_date: "on or after", same-day counts.
    const result = nextCycleDate(new Date(2026, 5, 15));
    expect(result).toEqual(new Date(2026, 5, 15));
  });

  it("returns the thirtieth when day is between 16 and the thirtieth", () => {
    const result = nextCycleDate(new Date(2026, 5, 20)); // June 20
    expect(result).toEqual(new Date(2026, 5, 30));
  });

  it("returns next month's 15th when past the thirtieth", () => {
    const result = nextCycleDate(new Date(2026, 0, 31)); // Jan 31
    expect(result).toEqual(new Date(2026, 1, 15)); // Feb 15
  });

  it("uses the last day of February for short months", () => {
    const result = nextCycleDate(new Date(2026, 1, 20)); // Feb 20, 2026 (non-leap)
    expect(result).toEqual(new Date(2026, 1, 28));
  });

  it("uses Feb 29 in a leap year", () => {
    const result = nextCycleDate(new Date(2028, 1, 20)); // 2028 is a leap year
    expect(result).toEqual(new Date(2028, 1, 29));
  });
});

describe("advanceCycle", () => {
  it("advances from the 15th to the thirtieth of the same month", () => {
    expect(advanceCycle(new Date(2026, 5, 15))).toEqual(new Date(2026, 5, 30));
  });

  it("advances from the thirtieth to next month's 15th", () => {
    expect(advanceCycle(new Date(2026, 5, 30))).toEqual(new Date(2026, 6, 15));
  });

  it("advances from Feb 28 (non-leap) to March 15", () => {
    expect(advanceCycle(new Date(2026, 1, 28))).toEqual(new Date(2026, 2, 15));
  });
});

describe("getNextDueDate", () => {
  it("skips to the next cycle when reference IS a cycle date", () => {
    // Unlike nextCycleDate (on-or-after), getNextDueDate means "strictly after".
    const result = getNextDueDate(new Date(2026, 5, 15));
    expect(result).toEqual(new Date(2026, 5, 30));
  });

  it("returns the next cycle date when reference is not itself a cycle date", () => {
    const result = getNextDueDate(new Date(2026, 5, 3));
    expect(result).toEqual(new Date(2026, 5, 15));
  });
});

describe("upcomingCycleDates", () => {
  it("returns the requested count of dates in order", () => {
    const dates = upcomingCycleDates(4, new Date(2026, 0, 1));
    expect(dates).toEqual([
      new Date(2026, 0, 15),
      new Date(2026, 0, 30),
      new Date(2026, 1, 15),
      new Date(2026, 1, 28),
    ]);
  });

  it("defaults to 6 dates", () => {
    expect(upcomingCycleDates(undefined, new Date(2026, 0, 1))).toHaveLength(6);
  });
});

describe("formatDate", () => {
  it("formats a Date object", () => {
    expect(formatDate(new Date(2026, 0, 15))).toBe("Jan 15, 2026");
  });

  it("formats an ISO date string", () => {
    expect(formatDate("2026-01-15")).toBe("Jan 15, 2026");
  });
});

describe("formatCurrency", () => {
  it("formats a number as USD", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
  });

  it("formats a string value", () => {
    expect(formatCurrency("1000.00")).toBe("$1,000.00");
  });

  it("formats zero correctly", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negative values", () => {
    expect(formatCurrency(-50)).toBe("-$50.00");
  });
});

describe("formatRate", () => {
  it("converts a decimal rate to a percentage string", () => {
    expect(formatRate(0.05)).toBe("5.00%");
  });

  it("works from a string input", () => {
    expect(formatRate("0.1")).toBe("10.00%");
  });

  it("handles small rates with rounding", () => {
    expect(formatRate(0.0001)).toBe("0.01%");
  });
});

describe("isOverdue", () => {
  it("returns false for null", () => {
    expect(isOverdue(null)).toBe(false);
  });

  it("returns true for a date far in the past", () => {
    expect(isOverdue("2020-01-01")).toBe(true);
  });

  it("returns false for a date far in the future", () => {
    expect(isOverdue("2099-01-01")).toBe(false);
  });
});
