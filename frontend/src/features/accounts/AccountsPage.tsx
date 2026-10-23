import { Add, Download, Receipt, SearchLocate } from "@carbon/icons-react";
import { Button, DataTableSkeleton, MenuButton, MenuItem, Search, SelectableTag } from "@carbon/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, adminApi } from "../../api";
import { Drawer, EmptyState, Notice, PageHeader } from "../../components/common";
import type { AccountFormData, AccountStatus } from "../../types";
import { AccountForm } from "./AccountForm";
import { AccountsTable } from "./AccountsTable";
import { getApiErrorMessage } from "../../utils/apiError";

const STATUS_FILTERS: { value: AccountStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "paid", label: "Paid" },
  { value: "closed", label: "Closed" },
];

export function AccountsPage() {
  const qc = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<AccountStatus[]>([]);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts", selectedStatuses, search],
    queryFn: () =>
      accountsApi.list({
        status: selectedStatuses.length ? selectedStatuses : undefined,
        search: search || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: AccountFormData) => accountsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setShowCreate(false);
    },
  });

  const toggleStatus = (status: AccountStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  const filtered = selectedStatuses.length > 0 || search !== "";

  return (
    <div className="lt-page lt-stack lt-stack--loose">
      <PageHeader
        title="Loan Accounts"
        subtitle="Manage and track all borrower accounts."
        action={
          <>
            <MenuButton label="Export" kind="tertiary" size="md" menuAlignment="bottom-end">
              <MenuItem label="Accounts only (.csv)" onClick={() => adminApi.exportAccountsCsv()} />
              <MenuItem label="All payments (.csv)" onClick={() => adminApi.exportPaymentsCsv()} />
            </MenuButton>
            <Button size="md" renderIcon={Add} onClick={() => setShowCreate(true)}>
              New Account
            </Button>
          </>
        }
      />

      <section className="lt-panel" aria-label="Accounts">
        <div className="lt-toolbar-chips" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => {
            const isAll = f.value === "all";
            const on = isAll ? selectedStatuses.length === 0 : selectedStatuses.includes(f.value as AccountStatus);
            return (
              <SelectableTag
                key={f.value}
                text={f.label}
                size="md"
                selected={on}
                onChange={() => (isAll ? setSelectedStatuses([]) : toggleStatus(f.value as AccountStatus))}
              />
            );
          })}
          <div className="lt-spacer lt-toolbar-search">
            <Search
              size="md"
              labelText="Search accounts"
              placeholder="Search accounts..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
            />
          </div>
        </div>

        <p className="lt-field-note lt-count" role="status" aria-live="polite">
          {isLoading ? "Loading accounts…" : `${accounts.length} account${accounts.length !== 1 ? "s" : ""} found`}
        </p>

        {isLoading ? (
          <DataTableSkeleton
            columnCount={8}
            rowCount={8}
            showHeader={false}
            showToolbar={false}
            aria-label="Loading accounts"
          />
        ) : accounts.length === 0 ? (
          filtered ? (
            <EmptyState
              Icon={SearchLocate}
              title="No matching accounts"
              description="Nothing matches the current search and status filters."
              action={
                <Button
                  kind="tertiary"
                  onClick={() => {
                    setSelectedStatuses([]);
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              Icon={Receipt}
              title="No accounts yet"
              description="Create a loan account to start tracking balances, interest and payments."
              action={
                <Button renderIcon={Add} onClick={() => setShowCreate(true)}>
                  New Account
                </Button>
              }
            />
          )
        ) : (
          <AccountsTable accounts={accounts} variant="full" />
        )}
      </section>

      {showCreate && (
        <Drawer title="New Loan Account" onClose={() => setShowCreate(false)} width="lg">
          <AccountForm
            onSubmit={async (data) => {
              await createMutation.mutateAsync(data);
            }}
            onCancel={() => setShowCreate(false)}
            isLoading={createMutation.isPending}
          />
          {createMutation.isError && (
            <div style={{ marginBlockStart: "1rem" }}>
              <Notice kind="error" title="Couldn’t create account">
                {getApiErrorMessage(createMutation.error, "Failed to create account")}
              </Notice>
            </div>
          )}
        </Drawer>
      )}
    </div>
  );
}
