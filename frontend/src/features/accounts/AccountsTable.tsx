import { WarningAltFilled } from "@carbon/icons-react";
import {
  DataTable,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { StatusBadge } from "../../components/common";
import type { LoanAccount } from "../../types";
import { formatCurrency, formatDate, formatRate, isOverdue } from "../../utils/dateUtils";

interface Props {
  accounts: LoanAccount[];
  /** `summary` is the compact dashboard list; `full` adds every column, sorting and paging. */
  variant?: "summary" | "full";
  pageSize?: number;
}

type ColKey =
  | "account_name"
  | "borrower_name"
  | "borrow_amount"
  | "current_balance"
  | "rate"
  | "next_due_date"
  | "status"
  | "start_date";

const NUMERIC: ColKey[] = ["borrow_amount", "current_balance", "rate"];

const FULL_COLS: { key: ColKey; header: string }[] = [
  { key: "account_name", header: "Account" },
  { key: "borrower_name", header: "Borrower" },
  { key: "borrow_amount", header: "Principal" },
  { key: "current_balance", header: "Balance" },
  { key: "rate", header: "Rate" },
  { key: "next_due_date", header: "Next Due" },
  { key: "status", header: "Status" },
  { key: "start_date", header: "Started" },
];

const SUMMARY_COLS = FULL_COLS.filter((c) =>
  ["account_name", "borrower_name", "current_balance", "next_due_date", "status"].includes(c.key)
);

/** Sort on the raw value (number / ISO date / string), not on the formatted cell text. */
function compareRaw(a: unknown, b: unknown, { sortDirection }: { sortDirection: string }) {
  const nullish = (v: unknown) => v === null || v === undefined || v === "";
  let r: number;
  if (nullish(a) && nullish(b)) r = 0;
  else if (nullish(a)) r = 1; // empty values sink to the bottom in either direction
  else if (nullish(b)) r = -1;
  else if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  if (nullish(a) || nullish(b)) return r;
  return sortDirection === "DESC" ? -r : r;
}

export function AccountsTable({ accounts, variant = "full", pageSize = 20 }: Props) {
  const navigate = useNavigate();
  const full = variant === "full";
  const cols = full ? FULL_COLS : SUMMARY_COLS;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const rows = useMemo(
    () =>
      accounts.map((a) => ({
        id: a.id,
        account_name: a.account_name,
        borrower_name: a.borrower_name,
        borrow_amount: Number(a.borrow_amount),
        // Summary view falls back to principal when no balance is recorded yet.
        current_balance:
          a.current_balance != null
            ? Number(a.current_balance)
            : full
              ? null
              : Number(a.borrow_amount),
        rate: Number(a.rate),
        next_due_date: a.next_due_date ?? "",
        status: a.status,
        start_date: a.start_date,
      })),
    [accounts, full]
  );

  // A filter/search change can leave us past the last page.
  const lastPage = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(page, lastPage);

  const renderCell = (key: ColKey, a: LoanAccount) => {
    switch (key) {
      case "account_name":
        return (
          <Link
            to={`/accounts/${a.id}`}
            className="lt-table-link"
            onClick={(e) => e.stopPropagation()}
          >
            {a.account_name}
          </Link>
        );
      case "borrow_amount":
        return formatCurrency(a.borrow_amount);
      case "current_balance": {
        const raw = a.current_balance ?? (full ? null : a.borrow_amount);
        if (raw == null) return "—";
        const n = Number.parseFloat(raw);
        const cls =
          n <= 0 ? "lt-success-text" : n > Number.parseFloat(a.borrow_amount) ? "lt-danger-text" : "";
        return <span className={cls}>{formatCurrency(raw)}</span>;
      }
      case "rate":
        return formatRate(a.rate);
      case "next_due_date": {
        if (!a.next_due_date) return "—";
        const late = isOverdue(a.next_due_date);
        return late ? (
          <span className="lt-danger-text lt-inline-icon">
            <WarningAltFilled size={16} aria-hidden="true" />
            {formatDate(a.next_due_date)}
            <span className="lt-visually-hidden"> (overdue)</span>
          </span>
        ) : (
          formatDate(a.next_due_date)
        );
      }
      case "status":
        return <StatusBadge status={a.status} />;
      case "start_date":
        return formatDate(a.start_date);
      default:
        return String(a[key as keyof LoanAccount] ?? "");
    }
  };

  return (
    <DataTable
      rows={rows}
      headers={cols}
      isSortable={full}
      size="lg"
      sortRow={compareRaw as any}
    >
      {({ rows: sorted, headers, getTableProps, getHeaderProps, getRowProps }: any) => {
        const visible = full
          ? sorted.slice((safePage - 1) * size, safePage * size)
          : sorted;
        return (
          <div className="lt-table-wrap">
            <Table {...getTableProps()} aria-label={full ? "Loan accounts" : "Recent accounts"}>
              <TableHead>
                <TableRow>
                  {headers.map((h: { key: ColKey; header: string }) => {
                    const { key: _k, ...headerProps } = getHeaderProps({ header: h });
                    return (
                      <TableHeader
                        key={h.key}
                        {...headerProps}
                        className={NUMERIC.includes(h.key) ? "lt-num" : undefined}
                      >
                        {h.header}
                      </TableHeader>
                    );
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((row: any) => {
                  const a = byId.get(row.id)!;
                  const { key: _k, ...rowProps } = getRowProps({ row });
                  return (
                    <TableRow
                      key={row.id}
                      {...rowProps}
                      className="lt-clickable"
                      onClick={() => navigate(`/accounts/${row.id}`)}
                    >
                      {row.cells.map((cell: { id: string; info: { header: ColKey } }) => (
                        <TableCell
                          key={cell.id}
                          className={NUMERIC.includes(cell.info.header) ? "lt-num" : undefined}
                        >
                          {renderCell(cell.info.header, a)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {full && rows.length > 10 && (
              <Pagination
                page={safePage}
                pageSize={size}
                pageSizes={[10, 20, 50]}
                totalItems={rows.length}
                itemsPerPageText="Rows per page"
                onChange={({ page: p, pageSize: s }: { page: number; pageSize: number }) => {
                  setPage(p);
                  setSize(s);
                }}
              />
            )}
          </div>
        );
      }}
    </DataTable>
  );
}
