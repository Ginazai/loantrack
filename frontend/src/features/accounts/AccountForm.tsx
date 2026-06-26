import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { LoanAccount, AccountFormData, User, UserCreateFormData } from "../../types";
import { upcomingCycleDates, formatDate } from "../../utils/dateUtils";
import { adminApi } from "../../api";
import { useAuthStore } from "../../stores/authStore";
import { ChevronDown, Loader2, UserPlus, CheckCircle2 } from "lucide-react";

const schema = z.object({
  account_name: z.string().min(1, "Required"),
  borrow_amount: z.coerce.number().positive("Must be positive"),
  rate: z.coerce.number().positive("Must be positive").max(100, "Max 100%"),
  cycle: z.coerce.number().refine((v) => v === 15 || v === 30) as z.ZodType<15 | 30>,
  start_date: z.string().min(1, "Required"),
  linked_user_id: z.string().optional(),
});

interface Props {
  account?: LoanAccount;
  onSubmit: (data: AccountFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function AccountForm({ account, onSubmit, onCancel, isLoading }: Props) {
  const isEdit = !!account;
  const preview = upcomingCycleDates(4);
  const { user: currentUser } = useAuthStore();
  const isAdmin = currentUser?.role === "admin";

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState<UserCreateFormData>({
    email: "", password: "", full_name: "", role: "user",
  });
  const [creatingUser, setCreatingUser] = useState(false);
  const [createdUser, setCreatedUser] = useState<User | null>(null);
  const [userError, setUserError] = useState<string | null>(null);

  useEffect(() => {
    if (isAdmin && !isEdit) {
      setLoadingUsers(true);
      adminApi.listUsers()
        .then((all) => setUsers(all.filter((u) => u.role === "user")))
        .finally(() => setLoadingUsers(false));
    }
  }, [isAdmin, isEdit]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(schema),
    defaultValues: account
      ? {
          account_name: account.account_name,
          borrow_amount: parseFloat(account.borrow_amount),
          rate: parseFloat(account.rate) * 100,
          cycle: account.cycle,
          start_date: account.start_date,
        }
      : {
          cycle: 15,
          start_date: new Date().toISOString().split("T")[0],
        },
  });

  const handleUserSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedUserId(val);
    if (val === "__new__") {
      setShowNewUser(true);
      setCreatedUser(null);
      setValue("linked_user_id", undefined);
    } else {
      setShowNewUser(false);
      setValue("linked_user_id", val || undefined);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.full_name) {
      setUserError("All fields required");
      return;
    }
    setCreatingUser(true);
    setUserError(null);
    try {
      const created = await adminApi.createUser(newUser);
      setCreatedUser(created);
      setUsers((prev) => [...prev, created]);
      setSelectedUserId(created.id);
      setValue("linked_user_id", created.id);
      setShowNewUser(false);
    } catch (e: any) {
      setUserError(e?.response?.data?.detail || "Failed to create user");
    } finally {
      setCreatingUser(false);
    }
  };

  const lbl = "label-text text-xs font-semibold uppercase tracking-wide";
  const inp = (err?: any) => `input input-bordered input-sm w-full ${err ? "input-error" : ""}`;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Admin: User assignment */}
      {isAdmin && !isEdit && (
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-primary/60">
            Assign to Borrower
          </p>

          {/* Existing user dropdown */}
          <div className="form-control">
            <label className="label py-1">
              <span className={lbl}>Select User Account</span>
            </label>
            <div className="relative">
              <select
                className="select select-bordered select-sm w-full appearance-none pr-8"
                value={selectedUserId}
                onChange={handleUserSelect}
                disabled={loadingUsers}
              >
                <option value="">— Assign to myself (admin) —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} · {u.email}
                  </option>
                ))}
                <option value="__new__">＋ Create a new user…</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-base-content/40" />
            </div>
          </div>

          {/* Created user confirmation */}
          {createdUser && (
            <div className="flex items-center gap-2 text-success text-sm bg-success/10 border border-success/20 rounded-md px-3 py-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>
                <strong>{createdUser.full_name}</strong> created and linked · invite email can be sent via webhook
              </span>
            </div>
          )}

          {/* Inline new user form */}
          {showNewUser && (
            <div className="border border-base-300 rounded-md bg-base-100 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <UserPlus className="w-3.5 h-3.5 text-base-content/40" />
                <span className="text-xs font-bold uppercase tracking-widest text-base-content/40">
                  New User Details
                </span>
              </div>

              {userError && (
                <div className="alert alert-error py-2 text-xs">{userError}</div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-1">
                    <span className={lbl}>Full Name</span>
                  </label>
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Jane Smith"
                    value={newUser.full_name}
                    onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  />
                </div>
                <div className="form-control">
                  <label className="label py-1">
                    <span className={lbl}>Email</span>
                  </label>
                  <input
                    className="input input-bordered input-sm"
                    type="email"
                    placeholder="jane@example.com"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  />
                </div>
                <div className="form-control sm:col-span-2">
                  <label className="label py-1">
                    <span className={lbl}>Temporary Password</span>
                  </label>
                  <input
                    className="input input-bordered input-sm"
                    type="password"
                    placeholder="Min. 8 characters"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => { setShowNewUser(false); setSelectedUserId(""); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs gap-1.5"
                  onClick={handleCreateUser}
                  disabled={creatingUser}
                >
                  {creatingUser
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <UserPlus className="w-3 h-3" />}
                  Create & Link
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main loan fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="form-control">
          <label className="label py-1"><span className={lbl}>Account Name</span></label>
          <input className={inp(errors.account_name)} placeholder="e.g. Personal Loan – June" {...register("account_name")} />
          {errors.account_name && <span className="label-text-alt text-error text-xs mt-0.5">{errors.account_name.message}</span>}
        </div>

        <div className="form-control">
          <label className="label py-1"><span className={lbl}>Principal Amount</span></label>
          <label className="input input-bordered input-sm flex items-center gap-2">
            <span className="text-base-content/40 font-mono">$</span>
            <input type="number" step="0.01" min="0" className="grow font-mono" placeholder="0.00" disabled={isEdit} {...register("borrow_amount")} />
          </label>
          {errors.borrow_amount && <span className="label-text-alt text-error text-xs mt-0.5">{errors.borrow_amount.message}</span>}
          {isEdit && <span className="text-xs text-warning mt-0.5">Principal is locked after creation</span>}
        </div>

        <div className="form-control">
          <label className="label py-1"><span className={lbl}>Interest Rate</span></label>
          <label className="input input-bordered input-sm flex items-center gap-2">
            <input type="number" step="0.01" min="0.01" max="100" className="grow font-mono" placeholder="5.00" {...register("rate")} />
            <span className="text-base-content/40 font-mono">%</span>
          </label>
          {errors.rate && <span className="label-text-alt text-error text-xs mt-0.5">{errors.rate.message}</span>}
        </div>

        <div className="form-control">
          <label className="label py-1"><span className={lbl}>Payment Frequency</span></label>
          <select className="select select-bordered select-sm" disabled={isEdit} {...register("cycle")}>
            <option value={15}>Bi-monthly (15 days)</option>
            <option value={30}>Monthly (30 days)</option>
          </select>
        </div>

        <div className="form-control">
          <label className="label py-1"><span className={lbl}>Start Date</span></label>
          <input type="date" className={inp(errors.start_date)} disabled={isEdit} {...register("start_date")} />
          {errors.start_date && <span className="label-text-alt text-error text-xs mt-0.5">{errors.start_date.message}</span>}
        </div>
      </div>

      {!isEdit && (
        <div className="bg-base-200 rounded-md p-4">
          <p className="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-2">
            Upcoming Cycle Dates
          </p>
          <div className="flex flex-wrap gap-2">
            {preview.map((d) => (
              <span key={d.toISOString()} className="badge badge-outline badge-sm font-mono">
                {formatDate(d)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="submit" className={`btn btn-primary btn-sm ${isLoading ? "loading" : ""}`}>
          {isEdit ? "Save Changes" : "Create Account"}
        </button>
      </div>
    </form>
  );
}
