import { ShieldCheck } from "lucide-react";
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Target URL</span>
        </label>
        <input
          className={`input input-bordered input-sm ${errors.target_url ? "input-error" : ""}`}
          placeholder="https://your-n8n-instance.com/webhook/..."
          {...register("target_url")}
        />
        {errors.target_url && (
          <label className="label">
            <span className="label-text-alt text-error">{errors.target_url.message}</span>
          </label>
        )}
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text font-medium">Events to Subscribe</span>
        </label>
        <Controller
          name="events"
          control={control}
          render={({ field }) => (
            <div className="space-y-2">
              {ALL_EVENTS.map((ev) => {
                const checked = (field.value as string[]).includes(ev.value);
                return (
                  <label
                    key={ev.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-base-300 hover:border-base-content/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary checkbox-sm mt-0.5"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...(field.value as string[]), ev.value]
                          : (field.value as string[]).filter((v) => v !== ev.value);
                        field.onChange(next);
                      }}
                    />
                    <div>
                      <p className="text-sm font-medium">{ev.label}</p>
                      <p className="text-xs text-base-content/50">{ev.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        />
        {errors.events && (
          <label className="label">
            <span className="label-text-alt text-error">{errors.events.message}</span>
          </label>
        )}
      </div>

      <div className="bg-base-200 rounded-xl p-3 text-xs text-base-content/60 space-y-1">
        <p className="font-semibold flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" />
          Security
        </p>
        <p>
          Each webhook request is signed with an HMAC-SHA256 signature sent in the{" "}
          <code className="bg-base-300 px-1 rounded">X-Webhook-Signature</code> header. Verify
          this on your n8n / Pipedream workflow to authenticate the request.
        </p>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={`btn btn-primary btn-sm ${isLoading ? "loading" : ""}`}
        >
          Save Webhook
        </button>
      </div>
    </form>
  );
}
