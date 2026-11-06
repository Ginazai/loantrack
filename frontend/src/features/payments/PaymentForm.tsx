import { InlineLoading, Button, ContentSwitcher, OperationalTag, Switch, Tag, TextInput } from "@carbon/react";
import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
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
    resolver: zodResolver(schema) as unknown as Resolver<PaymentFormData>, // coerce => zod input is unknown
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
    <form onSubmit={handleSubmit(handleFormSubmit)} noValidate className="lt-form">
      {/* Balance summary */}
      <div className="lt-kpis lt-kpis--2 lt-kpis--compact">
        <div className="lt-kpi">
          <span className="lt-kpi__label">Current Balance</span>
          <p className="lt-kpi__value">{formatCurrency(currentBalance)}</p>
        </div>
        <div className="lt-kpi">
          <span className="lt-kpi__label">Next Due</span>
          <p className="lt-kpi__value">{formatDate(nextDue)}</p>
        </div>
      </div>

      {/* Amount */}
      <TextInput
        id="payment-amount"
        type="number"
        step="0.01"
        min="0.01"
        inputMode="decimal"
        labelText="Payment Amount (USD)"
        placeholder="0.00"
        invalid={!!errors.amount}
        invalidText={errors.amount?.message}
        {...register("amount")}
      />

      {/* Method toggle */}
      <fieldset className="lt-fieldset">
        <legend className="cds--label">Payment Mode</legend>
        <ContentSwitcher
          size="md"
          selectedIndex={method === "manual" ? 1 : 0}
          onChange={({ name }) => setValue("method", name as "auto" | "manual")}
        >
          <Switch name="auto" text="Auto" />
          <Switch name="manual" text="Manual" />
        </ContentSwitcher>
        <p className="lt-field-note lt-mt-xs">
          {method === "auto"
            ? "Date is automatically set to the next cycle date."
            : "Pick any date — interest still applies per the cycle schedule."}
        </p>
      </fieldset>

      {/* Date picker (manual only) */}
      {method === "manual" && (
        <TextInput
          id="payment-date"
          type="date"
          labelText="Payment Date"
          max={new Date().toISOString().split("T")[0]}
          {...register("payment_date")}
        />
      )}

      {/* Upcoming cycle preview */}
      <div>
        <p className="lt-eyebrow">
          Upcoming Cycles
        </p>
        <div className="lt-row">
          {upcoming.map((d) =>
            method === "manual" ? (
              <OperationalTag
                key={d.toISOString()}
                text={formatDate(d)}
                size="md"
                onClick={() => setValue("payment_date", d.toISOString().split("T")[0])}
              />
            ) : (
              <Tag key={d.toISOString()} type="outline" size="md">
                {formatDate(d)}
              </Tag>
            )
          )}
        </div>
      </div>

      <div className="lt-form__actions lt-form__actions--bleed">
        <Button type="button" kind="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={isLoading}>
          {isLoading ? <InlineLoading description="Recording…" /> : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
