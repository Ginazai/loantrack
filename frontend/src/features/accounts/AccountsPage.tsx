import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountsApi, adminApi } from "../../api";
import { ConfirmDialog, PageHeader } from "../../components/common";
import type { AccountFormData, AccountStatus } from "../../types";
import { AccountForm } from "./AccountForm";
import { AccountSpreadsheet } from "./AccountSpreadsheet";
import { Download } from "lucide-react";

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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Loan Accounts"
        subtitle="Manage and track all borrower accounts."
        action={
          <div className="flex items-center gap-2">
            <div className="dropdown dropdown-end">
              <div tabIndex={0} role="button" className="btn btn-ghost btn-sm gap-1.5">
                <Download className="w-4 h-4" />
                Export
              </div>
              <ul tabIndex={0} className="dropdown-content z-50 menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 w-52 p-1.5 mt-1">
                <li><button onClick={() => adminApi.exportAccountsCsv()}>Accounts only (.csv)</button></li>
                <li><button onClick={() => adminApi.exportPaymentsCsv()}>All payments (.csv)</button></li>
              </ul>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              + New Account
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const isAll = f.value === "all";
            const active = isAll
              ? selectedStatuses.length === 0
              : selectedStatuses.includes(f.value as AccountStatus);
            return (
              <button
                key={f.value}
                className={`btn btn-xs rounded-full ${
                  active ? "btn-primary" : "btn-ghost border border-base-300"
                }`}
                onClick={() => {
                  if (isAll) setSelectedStatuses([]);
                  else toggleStatus(f.value as AccountStatus);
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto">
          <label className="input input-bordered input-sm flex items-center gap-2">
            <svg
              className="w-3.5 h-3.5 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
              />
            </svg>
            <input
              type="text"
              className="grow w-48"
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>

      <p className="text-sm text-base-content/50">
        {accounts.length} account{accounts.length !== 1 ? "s" : ""} found
      </p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : (
        <AccountSpreadsheet accounts={accounts} />
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-base-100 rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-5">New Loan Account</h2>
            <AccountForm
              onSubmit={async (data) => { await createMutation.mutateAsync(data); }}
              onCancel={() => setShowCreate(false)}
              isLoading={createMutation.isPending}
            />
            {createMutation.isError && (
              <div className="alert alert-error mt-3 text-sm py-2">
                <span>
                  {(createMutation.error as any)?.response?.data?.detail ??
                    "Failed to create account"}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
