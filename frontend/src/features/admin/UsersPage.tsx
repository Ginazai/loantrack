import { Add, Edit, TrashCan, UserMultiple } from "@carbon/icons-react";
import {
  Button,
  InlineLoading,
  PasswordInput,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableExpandHeader,
  TableExpandRow,
  TableExpandedRow,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Toggle,
} from "@carbon/react";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api";
import type { User, UserCreateFormData, UserRole, UserUpdateData } from "../../types";
import { useAuthStore } from "../../stores/authStore";
import { getApiErrorMessage } from "../../utils/apiError";
import { ConfirmDialog, Drawer, EmptyState, Notice, PageHeader, TableSkeleton } from "../../components/common";

function EditUserDrawer({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: User;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (u: User) => void;
}) {
  const [form, setForm] = useState({ full_name: user.full_name, email: user.email, role: user.role, password: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const full_name = form.full_name.trim();
    const email = form.email.trim();
    if (!full_name || !email) { setError("Name and email are required"); return; }
    const changes: UserUpdateData = {};
    if (full_name !== user.full_name) changes.full_name = full_name;
    if (email !== user.email) changes.email = email;
    if (form.role !== user.role) changes.role = form.role;
    if (form.password) {
      if (form.password.length < 8) { setError("New password must be at least 8 characters"); return; }
      changes.password = form.password;
    }
    if (Object.keys(changes).length === 0) { onClose(); return; }
    setSaving(true); setError(null);
    try {
      onSaved(await adminApi.updateUser(user.id, changes));
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Failed to update user"));
    } finally { setSaving(false); }
  };

  return (
    <Drawer title="Edit User" onClose={onClose}>
      <form
        className="lt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {error && <Notice kind="error">{error}</Notice>}
        <TextInput
          id="edit-user-name"
          labelText="Full Name"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
        <TextInput
          id="edit-user-email"
          type="email"
          labelText="Email"
          helperText="Changing this changes the address the user signs in with."
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <PasswordInput
          id="edit-user-password"
          labelText="Reset Password"
          helperText="Leave blank to keep the current password. Resetting signs the user out of other sessions."
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Select
          id="edit-user-role"
          labelText="Role"
          helperText={isSelf ? "You can't remove your own admin role." : undefined}
          disabled={isSelf}
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
        >
          <SelectItem value="user" text="User (borrower)" />
          <SelectItem value="admin" text="Admin" />
        </Select>
        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" kind="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? <InlineLoading description="Saving…" /> : "Save changes"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: User) => void }) {
  const [form, setForm] = useState<UserCreateFormData>({ email: "", password: "", full_name: "", role: "user" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!form.email || !form.password || !form.full_name) { setError("All fields required"); return; }
    setSaving(true); setError(null);
    try {
      const user = await adminApi.createUser(form);
      onCreated(user);
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Failed to create user"));
    } finally { setSaving(false); }
  };

  return (
    <Drawer title="Create New User" onClose={onClose}>
      <form
        className="lt-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        {error && <Notice kind="error">{error}</Notice>}
        <TextInput
          id="user-name"
          labelText="Full Name"
          placeholder="Jane Smith"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
        <TextInput
          id="user-email"
          type="email"
          labelText="Email"
          placeholder="jane@example.com"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <PasswordInput
          id="user-password"
          labelText="Temporary Password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Select
          id="user-role"
          labelText="Role"
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "user" })}
        >
          <SelectItem value="user" text="User (borrower)" />
          <SelectItem value="admin" text="Admin" />
        </Select>
        <div className="lt-form__actions lt-form__actions--bleed">
          <Button type="button" kind="secondary" size="lg" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="lg" disabled={saving}>
            {saving ? <InlineLoading description="Creating…" /> : "Create user"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userAccounts, setUserAccounts] = useState<Record<string, any[]>>({});
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const setAuthUser = useAuthStore((s) => s.setUser);

  useEffect(() => {
    adminApi.listUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

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
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (!userAccounts[userId]) {
      const accounts = await adminApi.getUserAccounts(userId);
      setUserAccounts((prev) => ({ ...prev, [userId]: accounts }));
    }
  };

  return (
    <div className="lt-page lt-page--medium lt-stack lt-stack--loose">
      <PageHeader
        title="Users"
        subtitle="Manage borrower accounts and access"
        action={
          <Button size="md" renderIcon={Add} onClick={() => setShowCreate(true)}>
            New user
          </Button>
        }
      />

      <section className="lt-panel" aria-label="Users">
        {loading ? (
          <TableSkeleton columns={5} rows={5} label="Loading users" />
        ) : users.length === 0 ? (
          <EmptyState
            Icon={UserMultiple}
            title="No users yet."
            description="Create a borrower login to link loan accounts and let them track balances."
            action={<Button renderIcon={Add} onClick={() => setShowCreate(true)}>New user</Button>}
          />
        ) : (
          <div className="lt-table-wrap">
            <Table size="lg" aria-label="Users">
              <TableHead>
                <TableRow>
                  <TableExpandHeader aria-label="Expand to show loans" />
                  <TableHeader>User</TableHeader>
                  <TableHeader>Role</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Joined</TableHeader>
                  <TableHeader>
                    <span className="lt-visually-hidden">Actions</span>
                  </TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <Fragment key={user.id}>
                    <TableExpandRow
                      isExpanded={expandedUser === user.id}
                      onExpand={() => toggleExpand(user.id)}
                      aria-label={`Show loans for ${user.full_name}`}
                    >
                      <TableCell>
                        <div className="lt-link-list__name">{user.full_name}</div>
                        <div className="lt-link-list__sub lt-mono">{user.email}</div>
                      </TableCell>
                      <TableCell>
                        <Tag size="sm" type={user.role === "admin" ? "blue" : "gray"}>
                          {user.role}
                        </Tag>
                      </TableCell>
                      <TableCell>
                        <Tag size="sm" type={user.is_active ? "green" : "red"}>
                          {user.is_active ? "Active" : "Inactive"}
                        </Tag>
                      </TableCell>
                      <TableCell className="lt-tnum">{new Date(user.created_at).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="lt-table-actions">
                          <Toggle
                            id={`active-${user.id}`}
                            size="sm"
                            hideLabel
                            labelText=""
                            aria-label={`${user.full_name} is ${user.is_active ? "active" : "inactive"}`}
                            toggled={user.is_active}
                            onToggle={() => toggleActive(user)}
                          />
                          <Button
                            kind="ghost"
                            size="sm"
                            hasIconOnly
                            renderIcon={Edit}
                            iconDescription="Edit user"
                            tooltipPosition="left"
                            onClick={() => setEditUser(user)}
                          />
                          <Button
                            kind="danger--ghost"
                            size="sm"
                            hasIconOnly
                            renderIcon={TrashCan}
                            iconDescription="Delete user"
                            tooltipPosition="left"
                            onClick={() => setDeleteUserId(user.id)}
                          />
                        </div>
                      </TableCell>
                    </TableExpandRow>
                    {expandedUser === user.id && (
                      <TableExpandedRow colSpan={6}>
                        {!userAccounts[user.id] ? (
                          <InlineLoading description="Loading loans…" />
                        ) : userAccounts[user.id].length === 0 ? (
                          <p className="lt-muted">No loan accounts</p>
                        ) : (
                          <ul className="lt-chip-links">
                            {userAccounts[user.id].map((acc: any) => (
                              <li key={acc.id}>
                                <Link to={`/accounts/${acc.id}`} className="lt-chip-link">
                                  <span className="lt-link-list__name">{acc.account_name}</span>
                                  <span className="lt-link-list__sub lt-num">
                                    ${Number(acc.borrow_amount).toLocaleString()} ·{" "}
                                    <span className={acc.status === "open" || acc.status === "active" ? "" : "lt-danger-text"}>
                                      {acc.status}
                                    </span>
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableExpandedRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={(u) => setUsers((prev) => [u, ...prev])}
        />
      )}

      {editUser && (
        <EditUserDrawer
          user={editUser}
          isSelf={editUser.id === currentUserId}
          onClose={() => setEditUser(null)}
          onSaved={(u) => {
            setUsers((prev) => prev.map((x) => (x.id === u.id ? u : x)));
            if (u.id === currentUserId) setAuthUser(u);
          }}
        />
      )}

      {deleteUserId && (
        <ConfirmDialog
          title="Delete User"
          message="This will permanently delete the user and all their loan accounts and payment history."
          confirmLabel="Delete user"
          confirmWord={users.find((u) => u.id === deleteUserId)?.full_name}
          dangerous
          onConfirm={() => handleDeleteUser(deleteUserId)}
          onCancel={() => setDeleteUserId(null)}
        />
      )}
    </div>
  );
}
