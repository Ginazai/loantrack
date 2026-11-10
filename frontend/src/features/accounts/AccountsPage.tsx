import { Add, Download, Receipt, SearchLocate } from "@carbon/icons-react";
import { Button, ContentSwitcher, MenuButton, MenuItem, Search, Switch } from "@carbon/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, adminApi } from "../../api";
import { Drawer, EmptyState, Notice, PageHeader, TableSkeleton } from "../../components/common";
import type { AccountFormData, AccountStatus } from "../../types";
import { AccountForm } from "./AccountForm";
import { AccountsTable } from "./AccountsTable";
import { getApiErrorMessage } from "../../utils/apiError";

type StatusFilter = AccountStatus | "all";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "active", label: "Active" },
  { value: "paid", label: "Paid" },
  { value: "closed", label: "Closed" },
];

export function AccountsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts", status, search],
    queryFn: () =>
      accountsApi.list({
        status: status === "all" ? undefined : [status],
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

  const filtered = status !== "all" || search !== "";

  // Closing the drawer also clears a failed attempt's error so it doesn't reappear on reopen.
  const closeCreate = () => {
    setShowCreate(false);
    createMutation.reset();
  };

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
              New account
            </Button>
          </>
        }
      />

      {/* Same status filter as the Loan Requests page. */}
      <div className="lt-filter-switcher" role="group" aria-label="Filter by status">
        <ContentSwitcher
          size="md"
          selectedIndex={STATUS_FILTERS.findIndex((f) => f.value === status)}
          onChange={({ name }) => setStatus(name as StatusFilter)}
        >
          {STATUS_FILTERS.map((f) => (
            <Switch key={f.value} name={f.value} text={f.label} />
          ))}
        </ContentSwitcher>
      </div>

      <section className="lt-panel" aria-label="Accounts">
        <div className="lt-toolbar">
          <div className="lt-toolbar-search">
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
          <TableSkeleton columns={5} rows={8} label="Loading accounts" />
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
                    setStatus("all");
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
                  New account
                </Button>
              }
            />
          )
        ) : (
          <AccountsTable accounts={accounts} variant="full" />
        )}
      </section>

      {showCreate && (
        <Drawer
          title="New Loan Account"
          onClose={closeCreate}
          width="lg"
          notice={
            createMutation.isError ? (
              <Notice kind="error" title="Couldn’t create account">
                {getApiErrorMessage(createMutation.error, "Failed to create account")}
              </Notice>
            ) : undefined
          }
        >
          <AccountForm
            onSubmit={async (data) => {
              await createMutation.mutateAsync(data);
            }}
            onCancel={closeCreate}
            isLoading={createMutation.isPending}
          />
        </Drawer>
      )}
    </div>
  );
}
