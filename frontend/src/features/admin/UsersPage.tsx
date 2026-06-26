import { useEffect, useState } from "react";
import { adminApi } from "../../api";
import type { User, UserCreateFormData } from "../../types";
import { UserPlus, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { ConfirmDialog } from "../../components/common";

const EVENTS = ["account.created", "payment.added", "status.changed", "account.updated", "account.purged"];

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userAccounts, setUserAccounts] = useState<Record<string, any[]>>({});
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [form, setForm] = useState<UserCreateFormData>({
    email: "",
    password: "",
    full_name: "",
    role: "user",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.listUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.full_name) {
      setError("All fields required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const user = await adminApi.createUser(form);
      setUsers((prev) => [user, ...prev]);
      setShowCreate(false);
      setForm({ email: "", password: "", full_name: "", role: "user" });
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: User) => {
    const updated = await adminApi.updateUser(user.id, { is_active: !user.is_active });
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  const handleDeleteUser = async (id: string) => {
    await adminApi.deleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setDeleteUserId(null);
  };

  const toggleExpand = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    if (!userAccounts[userId]) {
      const accounts = await adminApi.getUserAccounts(userId);
      setUserAccounts((prev) => ({ ...prev, [userId]: accounts }));
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-sm text-base-content/50 mt-0.5">
            Manage borrower accounts and access
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={() => setShowCreate(!showCreate)}
        >
          <UserPlus className="w-4 h-4" />
          New User
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card bg-base-100 shadow border border-base-300 card-ledger">
          <div className="card-body p-5">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-base-content/50 mb-4">
              Create New User
            </h3>
            {error && (
              <div className="alert alert-error py-2 text-sm">{error}</div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text text-xs font-semibold uppercase tracking-wide">
                    Full Name
                  </span>
                </label>
                <input
                  className="input input-bordered input-sm"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text text-xs font-semibold uppercase tracking-wide">
                    Email
                  </span>
                </label>
                <input
                  className="input input-bordered input-sm"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text text-xs font-semibold uppercase tracking-wide">
                    Temporary Password
                  </span>
                </label>
                <input
                  className="input input-bordered input-sm"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min. 8 characters"
                />
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text text-xs font-semibold uppercase tracking-wide">
                    Role
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "user" })}
                >
                  <option value="user">User (borrower)</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreate}
                disabled={saving}
              >
                {saving ? <span className="loading loading-spinner loading-xs" /> : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="card bg-base-100 shadow border border-base-300 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <span className="loading loading-spinner loading-md text-primary" />
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-base-content/40 text-sm">No users yet.</div>
        ) : (
          <table className="table table-sm">
            <thead>
              <tr className="bg-base-200 text-xs uppercase tracking-wider text-base-content/50">
                <th className="pl-5">User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className="text-right pr-5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <>
                  <tr key={user.id} className="hover border-t border-base-200">
                    <td className="pl-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                          <span className="text-xs font-bold text-primary">
                            {user.full_name?.[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-sm">{user.full_name}</p>
                          <p className="text-xs text-base-content/40 font-mono">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge badge-sm font-mono uppercase tracking-wider ${
                        user.role === "admin" ? "badge-secondary" : "badge-ghost"
                      }`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-sm ${user.is_active ? "badge-success" : "badge-error"} badge-outline`}>
                        {user.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="text-xs text-base-content/40 font-mono">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="text-right pr-5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="btn btn-ghost btn-xs gap-1"
                          onClick={() => toggleExpand(user.id)}
                          title="View accounts"
                        >
                          {expandedUser === user.id ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                          Loans
                        </button>
                        <button
                          className={`btn btn-ghost btn-xs gap-1 ${user.is_active ? "text-warning" : "text-success"}`}
                          onClick={() => toggleActive(user)}
                          title={user.is_active ? "Deactivate" : "Activate"}
                        >
                          {user.is_active ? (
                            <ToggleRight className="w-4 h-4" />
                          ) : (
                            <ToggleLeft className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          className="btn btn-ghost btn-xs text-error"
                          onClick={() => setDeleteUserId(user.id)}
                          title="Delete user"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedUser === user.id && (
                    <tr key={`${user.id}-accounts`} className="bg-base-200/60">
                      <td colSpan={5} className="px-5 py-3">
                        {!userAccounts[user.id] ? (
                          <span className="loading loading-dots loading-xs" />
                        ) : userAccounts[user.id].length === 0 ? (
                          <p className="text-xs text-base-content/40 italic">No loan accounts</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {userAccounts[user.id].map((acc: any) => (
                              <div
                                key={acc.id}
                                className="bg-base-100 border border-base-300 rounded-md px-3 py-2 text-xs"
                              >
                                <p className="font-semibold">{acc.account_name}</p>
                                <p className="text-base-content/50 font-mono">
                                  ${Number(acc.borrow_amount).toLocaleString()} ·{" "}
                                  <span
                                    className={`${
                                      acc.status === "open" || acc.status === "active"
                                        ? "text-success"
                                        : "text-error"
                                    }`}
                                  >
                                    {acc.status}
                                  </span>
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteUserId && (
        <ConfirmDialog
          title="Delete User"
          message="This will permanently delete the user and all their loan accounts and payment history. This cannot be undone."
          confirmLabel="Delete User"
          confirmWord={users.find((u) => u.id === deleteUserId)?.full_name}
          dangerous
          onConfirm={() => handleDeleteUser(deleteUserId)}
          onCancel={() => setDeleteUserId(null)}
        />
      )}
    </div>
  );
}
