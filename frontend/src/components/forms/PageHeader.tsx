import { Breadcrumb, BreadcrumbItem } from "@carbon/react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  to?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** Shown beside the title, e.g. a status tag. */
  badge?: React.ReactNode;
  /** Trail leading to this page. The current page is the last crumb and is not a link. */
  breadcrumbs?: Crumb[];
}

export function PageHeader({ title, subtitle, action, badge, breadcrumbs }: Props) {
  return (
    <header className="lt-page-header">
      <div className="lt-page-header__titles">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumb noTrailingSlash>
            {breadcrumbs.map((c, i) => {
              const current = i === breadcrumbs.length - 1;
              return (
                <BreadcrumbItem key={c.label} isCurrentPage={current}>
                  {c.to && !current ? <Link to={c.to}>{c.label}</Link> : c.label}
                </BreadcrumbItem>
              );
            })}
          </Breadcrumb>
        )}
        <div className="lt-page-header__title-row">
          <h1 className="lt-page-header__title">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="lt-page-header__subtitle">{subtitle}</p>}
      </div>
      {action && <div className="lt-page-header__actions">{action}</div>}
    </header>
  );
}
