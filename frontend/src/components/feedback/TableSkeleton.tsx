import { DataTableSkeleton } from "@carbon/react";

interface Props {
  columns: number;
  rows?: number;
  /** Announced to assistive tech, e.g. "Loading accounts". */
  label: string;
}

/**
 * Loading placeholder for a table. Wraps Carbon's skeleton in a fluid container so it can
 * never be wider than its panel (Carbon's own is a fixed ~96px per column).
 */
export function TableSkeleton({ columns, rows = 5, label }: Props) {
  return (
    <div className="lt-table-skeleton">
      <DataTableSkeleton
        columnCount={columns}
        rowCount={rows}
        showHeader={false}
        showToolbar={false}
        aria-label={label}
      />
    </div>
  );
}
