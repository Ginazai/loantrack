import type { ElementType } from "react";

interface Props {
  title: string;
  value: string;
  desc?: string;
  /** Any Carbon icon component. */
  Icon?: ElementType;
  /** `danger` flags something that needs attention. */
  tone?: "default" | "danger";
}

/** A single KPI. Lay several out inside `.lt-kpis` so they share hairline gutters. */
export function StatCard({ title, value, desc, Icon, tone = "default" }: Props) {
  return (
    <div className={`lt-kpi${tone !== "default" ? ` lt-kpi--${tone}` : ""}`}>
      <div className="lt-kpi__head">
        <span className="lt-kpi__label">{title}</span>
        {Icon && <Icon className="lt-kpi__icon" size={20} aria-hidden="true" />}
      </div>
      <div>
        <p className="lt-kpi__value">{value}</p>
        {desc && <p className="lt-kpi__desc">{desc}</p>}
      </div>
    </div>
  );
}
