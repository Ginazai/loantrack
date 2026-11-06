import { CheckmarkFilled, UserFollow } from "@carbon/icons-react";
import {
  Button,
  FormGroup,
  InlineLoading,
  Layer,
  PasswordInput,
  Select,
  SelectItem,
  Tag,
  TextInput,
} from "@carbon/react";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { LoanAccount, AccountFormData, User, UserCreateFormData } from "../../types";
import { upcomingCycleDates, formatDate } from "../../utils/dateUtils";
import { adminApi } from "../../api";
import { Notice } from "../../components/feedback";
import { CycleDates } from "../../components/ui";
import { useAuthStore } from "../../stores/authStore";
import { getApiErrorMessage } from "../../utils/apiError";

const schema = z.object({
  account_name: z.string().min(1, "Required"),
  borrow_amount: z.coerce.number().positive("Must be positive"),
  rate: z.coerce.number().positive("Must be positive").max(100, "Max 100%"),
  cycle: z.coerce.number().refine((v) => v === 15 || v === 30) as z.ZodType<15 | 30>,
  start_date: z.string().min(1, "Required"),
  linked_user_id: z.string().optional(),
  status: z.enum(["open", "active", "paid", "closed"]).optional(),
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
    formState: { errors },
  } = useForm<AccountFormData>({
    resolver: zodResolver(schema) as unknown as Resolver<AccountFormData>, // coerce => zod input is unknown
    defaultValues: account
      ? {
          account_name: account.account_name,
          borrow_amount: parseFloat(account.borrow_amount),
          rate: parseFloat(account.rate) * 100,
          cycle: account.cycle,
          start_date: account.start_date,
          status: account.status,
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
      setUserError(getApiErrorMessage(e, "Failed to create user"));
    } finally {
      setCreatingUser(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="lt-form">
      {/* Tracked as a real registered field so setValue() calls from the
          "assign to borrower" UI below reliably reach the submitted payload —
          setValue() on a path that's never register()'d is not guaranteed to
          survive to handleSubmit's data in every react-hook-form version. */}
      <input type="hidden" {...register("linked_user_id")} />

      {/* Admin: User assignment */}
      {isAdmin && !isEdit && (
        <div className="lt-form__section">
          <FormGroup legendText="Assign to Borrower">
            <Layer>
              <div className="lt-form">
                <Select
                  id="assign-user"
                  labelText="Select User Account"
                  value={selectedUserId}
                  onChange={handleUserSelect}
                  disabled={loadingUsers}
                >
                  <SelectItem value="" text="— Assign to myself (admin) —" />
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} text={`${u.full_name} · ${u.email}`} />
                  ))}
                  <SelectItem value="__new__" text="＋ Create a new user…" />
                </Select>

                {createdUser && (
                  <Notice kind="success">
                    <strong>{createdUser.full_name}</strong> created and linked · invite email can be sent via webhook
                  </Notice>
                )}

                {showNewUser && (
                  <div className="lt-form">
                    <p className="lt-eyebrow">
                      <UserFollow size={16} className="lt-icon-inline" aria-hidden="true" />
                      New User Details
                    </p>

                    {userError && <Notice kind="error">{userError}</Notice>}

                    <div className="lt-form__grid">
                      <TextInput
                        id="new-user-name"
                        labelText="Full Name"
                        placeholder="Jane Smith"
                        value={newUser.full_name}
                        onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                      />
                      <TextInput
                        id="new-user-email"
                        type="email"
                        labelText="Email"
                        placeholder="jane@example.com"
                        value={newUser.email}
                        onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      />
                      <div className="lt-span-2">
                        <PasswordInput
                          id="new-user-password"
                          labelText="Temporary Password"
                          placeholder="Min. 8 characters"
                          value={newUser.password}
                          autoComplete="new-password"
                          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="lt-row lt-row--end">
                      <Button
                        type="button"
                        kind="ghost"
                        size="sm"
                        onClick={() => { setShowNewUser(false); setSelectedUserId(""); }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        renderIcon={creatingUser ? undefined : UserFollow}
                        onClick={handleCreateUser}
                        disabled={creatingUser}
                      >
                        {creatingUser ? <InlineLoading description="Creating…" /> : "Create & link"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Layer>
          </FormGroup>
        </div>
      )}

      {/* Main loan fields */}
      <div className="lt-form__grid">
        <TextInput
          id="account-name"
          labelText="Account Name"
          placeholder="e.g. Personal Loan – June"
          invalid={!!errors.account_name}
          invalidText={errors.account_name?.message}
          {...register("account_name")}
        />

        <TextInput
          id="account-principal"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          labelText="Principal Amount (USD)"
          placeholder="0.00"
          disabled={isEdit}
          helperText={isEdit ? "Principal is locked after creation" : undefined}
          invalid={!!errors.borrow_amount}
          invalidText={errors.borrow_amount?.message}
          {...register("borrow_amount")}
        />

        <TextInput
          id="account-rate"
          type="number"
          step="0.01"
          min="0.01"
          max="100"
          inputMode="decimal"
          labelText="Interest Rate (%)"
          placeholder="5.00"
          invalid={!!errors.rate}
          invalidText={errors.rate?.message}
          {...register("rate")}
        />

        <Select id="account-cycle" labelText="Payment Frequency" disabled={isEdit} {...register("cycle")}>
          <SelectItem value={15} text="Bi-monthly (15 days)" />
          <SelectItem value={30} text="Monthly (30 days)" />
        </Select>

        <TextInput
          id="account-start"
          type="date"
          labelText="Start Date"
          disabled={isEdit}
          invalid={!!errors.start_date}
          invalidText={errors.start_date?.message}
          {...register("start_date")}
        />

        {isEdit && (
          <Select id="account-status" labelText="Status" {...register("status")}>
            <SelectItem value="open" text="Open" />
            <SelectItem value="active" text="Active" />
            <SelectItem value="paid" text="Paid" />
            <SelectItem value="closed" text="Closed" />
          </Select>
        )}
      </div>

      {!isEdit && (
        <CycleDates>
          {preview.map((d) => (
            <Tag key={d.toISOString()} type="outline" size="md">
              {formatDate(d)}
            </Tag>
          ))}
        </CycleDates>
      )}

      <div className="lt-form__actions lt-form__actions--bleed">
        <Button type="button" kind="secondary" size="lg" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="lg" disabled={isLoading}>
          {isLoading ? (
            <InlineLoading description={isEdit ? "Saving…" : "Creating…"} />
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create account"
          )}
        </Button>
      </div>
    </form>
  );
}
