import type { ElementType, ReactNode } from "react";

interface Props {
  Icon: ElementType;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Center in the container (single-column pages) or left-align (inside panels). */
  center?: boolean;
}

/** A composed empty view: what's missing, why it matters, and the next step. */
export function EmptyState({ Icon, title, description, action, center = false }: Props) {
  return (
    <div className={`lt-empty${center ? " lt-empty--center" : ""}`} role="status">
      <Icon className="lt-empty__icon" size={48} aria-hidden="true" />
      <h3 className="lt-empty__title">{title}</h3>
      {description && <p className="lt-empty__body">{description}</p>}
      {action && <div className="lt-empty__action">{action}</div>}
    </div>
  );
}
