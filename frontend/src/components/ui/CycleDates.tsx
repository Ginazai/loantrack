import type { ReactNode } from "react";

/** "Upcoming Cycle Dates" block shared by the account and payment forms. */
export function CycleDates({ children }: { children: ReactNode }) {
  return (
    <div className="lt-form__section">
      <p className="lt-eyebrow">Upcoming Cycle Dates</p>
      <div className="lt-row">{children}</div>
    </div>
  );
}
