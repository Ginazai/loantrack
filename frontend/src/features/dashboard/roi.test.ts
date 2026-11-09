import { describe, it, expect } from "vitest";
import { summariseRoi } from "./roi";
import { makeAccount } from "../../test/factories";

describe("summariseRoi", () => {
  it("is all zeros with no accounts", () => {
    expect(summariseRoi([])).toEqual({ invested: 0, recovered: 0, net: 0, recoveredPct: 0 });
  });

  it("counts every account, settled or not", () => {
    const roi = summariseRoi([
      makeAccount({ borrow_amount: "1000.00", total_paid: "250.00", status: "active" }),
      makeAccount({ id: "b", borrow_amount: "1000.00", total_paid: "750.00", status: "closed" }),
    ]);
    expect(roi.invested).toBe(2000);
    expect(roi.recovered).toBe(1000);
    expect(roi.net).toBe(-1000);
    expect(roi.recoveredPct).toBe(50);
  });

  it("goes past 100% once interest pays the principal back", () => {
    const roi = summariseRoi([makeAccount({ borrow_amount: "100.00", total_paid: "112.50", status: "paid" })]);
    expect(roi.net).toBe(12.5);
    expect(roi.recoveredPct).toBe(112.5);
  });
});
