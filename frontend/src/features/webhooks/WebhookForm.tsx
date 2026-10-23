import { Button, Checkbox, InlineLoading, TextInput } from "@carbon/react";
import { Notice } from "../../components/feedback";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { WebhookEventType, WebhookFormData } from "../../types";

const ALL_EVENTS: { value: WebhookEventType; label: string; desc: string }[] = [
  { value: "payment.added", label: "Payment Added", desc: "Fires when a payment is recorded" },
  {
    value: "status.changed",
    label: "Status Changed",
    desc: "Fires when account status transitions",
  },
  {
    value: "account.created",
    label: "Account Created",
    desc: "Fires when a new account is opened",
  },
  {
    value: "account.updated",
    label: "Account Updated",
    desc: "Fires when account details change",
  },
  { value: "account.purged", label: "Account Purged", desc: "Fires before a hard delete" },
  { value: "cycle.closed", label: "Cycle Closed", desc: "Fires when a billing cycle closes, even with no payment that day" },
];

const schema = z.object({
  target_url: z.string().url("Must be a valid URL"),
  events: z.array(z.string()).min(1, "Select at least one event"),
});

interface Props {
  onSubmit: (data: WebhookFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
}

export function WebhookForm({ onSubmit, onCancel, isLoading }: Props) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<WebhookFormData>({
    resolver: zodResolver(schema),
    defaultValues: { events: ["payment.added"] },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="lt-form">
      <TextInput
        id="webhook-url"
        labelText="Target URL"
        placeholder="https://your-n8n-instance.com/webhook/..."
        invalid={!!errors.target_url}
        invalidText={errors.target_url?.message}
        {...register("target_url")}
      />

      <Controller
        name="events"
        control={control}
        render={({ field }) => (
          <fieldset className="lt-fieldset">
            <legend className="cds--label">Events to Subscribe</legend>
            <div className="lt-stack lt-stack--tight">
              {ALL_EVENTS.map((ev) => {
                const checked = (field.value as string[]).includes(ev.value);
                return (
                  <div key={ev.value} className={`lt-option-card${checked ? " lt-option-card--checked" : ""}`}>
                    <Checkbox
                      id={`wh-event-${ev.value}`}
                      labelText={ev.label}
                      checked={checked}
                      onChange={(_, { checked: next }) =>
                        field.onChange(
                          next
                            ? [...(field.value as string[]), ev.value]
                            : (field.value as string[]).filter((v) => v !== ev.value)
                        )
                      }
                    />
                    <p className="lt-option-card__desc">{ev.desc}</p>
                  </div>
                );
              })}
            </div>
            {errors.events && <p className="cds--form-requirement" style={{ display: "block", maxBlockSize: "none" }}>{errors.events.message}</p>}
          </fieldset>
        )}
      />

      <Notice kind="info" title="Security">
        Each webhook request is signed with an HMAC-SHA256 signature sent in the{" "}
        <code>X-Webhook-Signature</code> header. Verify this on your n8n / Pipedream workflow to
        authenticate the request.
      </Notice>

      <div className="lt-form__actions lt-form__actions--bleed">
        <Button type="button" kind="secondary" size="xl" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xl" disabled={isLoading}>
          {isLoading ? <InlineLoading description="Saving…" /> : "Save Webhook"}
        </Button>
      </div>
    </form>
  );
}
