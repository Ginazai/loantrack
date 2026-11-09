import type { LoanAccount } from "../../types";

export interface RoiSummary {
  /** Principal lent out across every account, whatever its status. */
  invested: number;
  /** Everything received back (principal + interest) across every account. */
  recovered: number;
  /** recovered − invested. Negative while capital is still out in the field. */
  net: number;
  /** recovered ÷ invested, as a percentage. Passes 100 once interest pushes you into profit. */
  recoveredPct: number;
}

/**
 * Lifetime figures: settled and closed accounts count too, because the question is
 * "what did I put in, and what has come back", not "what is live right now".
 */
export function summariseRoi(accounts: LoanAccount[]): RoiSummary {
  const invested = accounts.reduce((sum, a) => sum + Number.parseFloat(a.borrow_amount), 0);
  const recovered = accounts.reduce((sum, a) => sum + Number.parseFloat(a.total_paid ?? "0"), 0);
  return {
    invested,
    recovered,
    net: recovered - invested,
    recoveredPct: invested > 0 ? (recovered / invested) * 100 : 0,
  };
}
