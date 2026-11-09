import { CheckmarkFilled } from "@carbon/icons-react";
import { formatCurrency } from "../../utils/dateUtils";
import type { RoiSummary } from "./roi";

const pct = (n: number) => `${n.toFixed(1)}%`;

/** How much of the money lent out has come back, at a glance. */
export function RoiPanel({ roi }: { roi: RoiSummary }) {
  const { invested, recovered, net, recoveredPct } = roi;
  const inProfit = net >= 0;
  const fill = Math.min(Math.max(recoveredPct, 0), 100);

  return (
    <section className="lt-panel lt-roi" aria-labelledby="roi-heading">
      <div className="lt-panel__header">
        <h2 className="lt-panel__title" id="roi-heading">
          Return on investment
        </h2>
        <span className="lt-roi__scope">All accounts, lifetime</span>
      </div>

      <div className="lt-panel__body lt-roi__body">
        <div className="lt-roi__headline">
          <p className="lt-roi__pct lt-tnum">{pct(recoveredPct)}</p>
          <p className="lt-roi__caption">
            {inProfit ? (
              <>
                <CheckmarkFilled size={16} className="lt-roi__ok" aria-hidden="true" />
                Fully recovered · {pct(recoveredPct - 100)} return
              </>
            ) : (
              "of invested capital recovered"
            )}
          </p>
        </div>

        <dl className="lt-roi__figures">
          <div>
            <dt>Invested</dt>
            <dd className="lt-tnum">{formatCurrency(invested)}</dd>
          </div>
          <div>
            <dt>Recovered</dt>
            <dd className="lt-tnum">{formatCurrency(recovered)}</dd>
          </div>
          <div>
            <dt>{inProfit ? "Net return" : "Still to recover"}</dt>
            <dd className={`lt-tnum${inProfit ? " lt-roi__gain" : ""}`}>
              {formatCurrency(Math.abs(net))}
            </dd>
          </div>
        </dl>

        <div
          className={`lt-roi__track${inProfit ? " lt-roi__track--complete" : ""}`}
          role="meter"
          aria-label="Share of invested capital recovered"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fill)}
          aria-valuetext={`${pct(recoveredPct)} recovered`}
        >
          <span className="lt-roi__fill" style={{ inlineSize: `${fill}%` }} />
        </div>
      </div>
    </section>
  );
}
