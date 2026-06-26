import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { LoanAccount, PaymentFormData } from "../../types";
import {
  formatCurrency,
  formatDate,
  nextCycleDate,
  upcomingCycleDates,
} from "../../utils/dateUtils";

const schema = z.object({
  amount: z.coerce.number().positive("Must be greater than 0"),
  method: z.enum(["auto", "manual"]),
  payment_date: z.string().optional(),
});

interface Props {
  account: LoanAccount;
  onSubmit: (data: PaymentFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function PaymentForm({ account, onSubmit, onCancel, isLoading }: Props) {
  const nextDue = account.next_due_date
    ? new Date(account.next_due_date)
    : nextCycleDate(new Date(account.start_date));

  const upcoming = upcomingCycleDates(4);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      method: "auto",
      payment_date: nextDue.toISOString().split("T")[0],
    },
  });

  const method = watch("method");
  const currentBalance = parseFloat(account.current_balance ?? account.borrow_amount);

  useEffect(() => {
    if (method === "auto") {
      setValue("payment_date", nextDue.toISOString().split("T")[0]);
    }
  }, [method]);

  const handleFormSubmit = (data: PaymentFormData) => {
    // Never send payment_date in auto mode — backend resolves it from cycle schedule
    // This prevents the "Payment date cannot be in the future" error when nextDue is ahead
    const payload: PaymentFormData =
      data.method === "auto"
        ? { amount: data.amount, method: "auto" }
        : data;
    return onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
      {/* Balance summary */}
      <div className="bg-base-200 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-base-content/50 text-xs uppercase tracking-wide">Current Balance</p>
          <p className="font-bold text-lg">{formatCurrency(currentBalance)}</p>
        </div>
        <div>
          <p className="text-base-content/50 text-xs uppercase tracking-wide">Next Due</p>
          <p className="font-semibold">{formatDate(nextDue)}</p>
        </div>
      </div>

      {/* Amount */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Payment Amount</span>
        </label>
        <label className="input input-bordered flex items-center gap-2">
          <span className="text-base-content/50 font-medium">$</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="grow"
            placeholder="0.00"
            {...register("amount")}
          />
        </label>
        {errors.amount && (
          <label className="label">
            <span className="label-text-alt text-error">{errors.amount.message}</span>
          </label>
        )}
      </div>

      {/* Method toggle */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Payment Mode</span>
        </label>
        <div className="join">
          <button
            type="button"
            className={`join-item btn btn-sm flex-1 ${
              method === "auto" ? "btn-primary" : "btn-ghost border border-base-300"
            }`}
            onClick={() => setValue("method", "auto")}
          >
            Auto
          </button>
          <button
            type="button"
            className={`join-item btn btn-sm flex-1 ${
              method === "manual" ? "btn-primary" : "btn-ghost border border-base-300"
            }`}
            onClick={() => setValue("method", "manual")}
          >
            Manual
          </button>
        </div>
        <label className="label">
          <span className="label-text-alt text-base-content/50">
            {method === "auto"
              ? "Date is automatically set to the next cycle date."
              : "Pick any date — interest still applies per the cycle schedule."}
          </span>
        </label>
      </div>

      {/* Date picker (manual only) */}
      {method === "manual" && (
        <div className="form-control">
          <label className="label">
            <span className="label-text font-medium">Payment Date</span>
          </label>
          <input
            type="date"
            className="input input-bordered input-sm"
            max={new Date().toISOString().split("T")[0]}
            {...register("payment_date")}
          />
        </div>
      )}

      {/* Upcoming cycle preview */}
      <div>
        <p className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-2">
          Upcoming Cycles
        </p>
        <div className="flex flex-wrap gap-2">
          {upcoming.map((d) => (
            <span
              key={d.toISOString()}
              className={`badge badge-sm cursor-pointer ${
                method === "manual" ? "badge-outline hover:badge-primary" : "badge-outline"
              }`}
              onClick={() => {
                if (method === "manual") {
                  setValue("payment_date", d.toISOString().split("T")[0]);
                }
              }}
            >
              {formatDate(d)}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`btn btn-primary btn-sm ${isLoading ? "loading" : ""}`}
        >
          Record Payment
        </button>
      </div>
    </form>
  );
}
