import { useCallback, useMemo, useRef } from "react";
import { AgGridReact } from "@ag-grid-community/react";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import type { ColDef } from "@ag-grid-community/core";
import { useNavigate } from "react-router-dom";
import type { LoanAccount, AccountStatus } from "../../types";
import { formatCurrency, formatDate, formatRate, isOverdue } from "../../utils/dateUtils";
import { StatusBadge } from "../../components/common";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

interface Props {
  accounts: LoanAccount[];
}

export function AccountSpreadsheet({ accounts }: Props) {
  const navigate = useNavigate();
  const gridRef = useRef<AgGridReact>(null);

  const columnDefs: ColDef<LoanAccount>[] = useMemo(
    () => [
      {
        field: "account_name",
        headerName: "Account",
        flex: 2,
        minWidth: 150,
        cellClass: "font-medium",
      },
      {
        field: "borrower_name",
        headerName: "Borrower",
        flex: 2,
        minWidth: 130,
      },
      {
        field: "borrow_amount",
        headerName: "Principal",
        flex: 1,
        minWidth: 110,
        valueFormatter: (p) => formatCurrency(p.value),
        type: "numericColumn",
      },
      {
        field: "current_balance",
        headerName: "Balance",
        flex: 1,
        minWidth: 110,
        valueFormatter: (p) => (p.value ? formatCurrency(p.value) : "—"),
        type: "numericColumn",
        cellStyle: (p) => {
          if (parseFloat(p.value) <= 0) return { color: "var(--su)" };
          if (parseFloat(p.value) > parseFloat(p.data?.borrow_amount ?? "0"))
            return { color: "var(--er)" };
          return null;
        },
      },
      {
        field: "rate",
        headerName: "Rate",
        width: 90,
        valueFormatter: (p) => formatRate(p.value),
        type: "numericColumn",
      },
      {
        field: "next_due_date",
        headerName: "Next Due",
        flex: 1,
        minWidth: 120,
        valueFormatter: (p) => (p.value ? formatDate(p.value) : "—"),
        cellStyle: (p) => {
          if (!isOverdue(p.value)) return null;
          return { color: "var(--er)", fontWeight: "600" };
        },
      },
      {
        field: "status",
        headerName: "Status",
        width: 100,
        cellRenderer: (p: { value: AccountStatus }) => <StatusBadge status={p.value} />,
      },
      {
        field: "start_date",
        headerName: "Started",
        flex: 1,
        minWidth: 110,
        valueFormatter: (p) => formatDate(p.value),
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: true, resizable: true, suppressMovable: false }),
    []
  );

  const onRowClicked = useCallback(
    (e: { data: LoanAccount }) => navigate(`/accounts/${e.data.id}`),
    [navigate]
  );

  return (
    <div
      className="ag-theme-alpine rounded-xl overflow-hidden border border-base-200"
      style={{ height: 480 }}
    >
      <AgGridReact
        ref={gridRef}
        rowData={accounts}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        modules={[ClientSideRowModelModule]}
        rowSelection="single"
        onRowClicked={onRowClicked}
        animateRows
        pagination
        paginationPageSize={20}
        rowClass="cursor-pointer"
      />
    </div>
  );
}
